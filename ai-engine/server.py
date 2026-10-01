"""
server.py - Motor de Inteligencia Artificial para Auditoría de Mesas de Casino (Wisi Space)
Detecta cartas, reconoce jugadas (Baccarat, Blackjack, Poker), aplica reglas oficiales,
calcula scores en tiempo real y guarda eventos con aprendizaje activo.
"""

import os
import sys
import time
import base64
import json
import threading
from datetime import datetime
import cv2
import numpy as np
import requests
from flask import Flask, jsonify, Response, request
from ultralytics import YOLO
import torch

sys.stdout.reconfigure(line_buffering=True)
app = Flask(__name__)

# --- CONFIGURACIÓN DE RUTAS Y MODELO ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, 'models')
AUTO_TRAIN_DIR = os.path.join(BASE_DIR, 'data_aprendizaje')
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(AUTO_TRAIN_DIR, exist_ok=True)

# Buscar modelo best.pt
MODEL_PATH = os.path.join(MODELS_DIR, 'best.pt')
if not os.path.exists(MODEL_PATH):
    fallback_path = r'C:\Users\antho\Downloads\ia_wisi_space\best.pt'
    if os.path.exists(fallback_path):
        MODEL_PATH = fallback_path

print(f"📦 Cargando modelo YOLO desde: {MODEL_PATH}")
device = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"🚀 Dispositivo de inferencia IA: {device.upper()}")
model = YOLO(MODEL_PATH)

# Configuración backend Wisi
WISI_API_URL = os.environ.get('WISI_API_URL', 'http://127.0.0.1:3030/api/cecom')

# Almacenes de streaming en vivo
mesas_config = {}       # { mesa_uuid: { ip, canal, usuario, clave, juego, nombre } }
frames_actuales = {}    # { mesa_uuid: frame }
estado_stream = {}      # { mesa_uuid: 'activo' | 'conectando' | 'error' }
live_results = {}       # { mesa_uuid: { estado, ganador, scoreP, scoreB, punto, banca, ... } }
historial_guardado = {} # { mesa_uuid: ultimo_detalle }

# ====================================================================
# MOTORES DE REGLAS DE CASINO (BACCARAT, BLACKJACK, POKER)
# ====================================================================

def calcular_valor_carta_baccarat(val_str):
    v = str(val_str).strip().upper()
    if 'BACK' in v:
        return None
    if any(x in v for x in ['10', 'J', 'Q', 'K', '0']):
        return 0
    if 'AS' in v or v == 'A':
        return 1
    digits = ''.join(c for c in v if c.isdigit())
    return int(digits) if digits else 0

def motor_baccarat(punto_cards, banca_cards):
    """
    Reglas oficiales de Punto y Banca / Baccarat internacional
    """
    def sum_bac(cards):
        tot = 0
        for c in cards:
            val = calcular_valor_carta_baccarat(c.get('val', ''))
            if val is not None:
                tot += val
        return tot % 10

    sP = sum_bac(punto_cards)
    sB = sum_bac(banca_cards)
    nP = len(punto_cards)
    nB = len(banca_cards)

    if nP < 2 or nB < 2:
        return {
            "win": "ESPERANDO",
            "scoreP": sP,
            "scoreB": sB,
            "listo": False,
            "descripcion": "Repartiendo cartas iniciales"
        }

    # Natural 8 o 9 (No se piden más cartas)
    if sP >= 8 or sB >= 8:
        ganador = "BANCA" if sB > sP else ("PUNTO" if sP > sB else "EMPATE (TIE)")
        return {
            "win": ganador,
            "scoreP": sP,
            "scoreB": sB,
            "listo": True,
            "natural": True,
            "descripcion": f"Natural ({sP} a {sB})"
        }

    pideP = False
    pideB = False

    # Regla de Punto: Pide con 0-5, Planta con 6-7
    if sP <= 5:
        pideP = True

    # Regla de Banca
    if not pideP:
        # Si Punto se planta (6-7), Banca pide con 0-5 y planta con 6-7
        if sB <= 5:
            pideB = True
    elif nP >= 3:
        # Si Punto pidió una 3ra carta, se evalúa el valor de esa 3ra carta
        v3P = calcular_valor_carta_baccarat(punto_cards[2].get('val', ''))
        if v3P is None:
            v3P = 0
        if sB <= 2:
            pideB = True
        elif sB == 3 and v3P != 8:
            pideB = True
        elif sB == 4 and v3P in [2, 3, 4, 5, 6, 7]:
            pideB = True
        elif sB == 5 and v3P in [4, 5, 6, 7]:
            pideB = True
        elif sB == 6 and v3P in [6, 7]:
            pideB = True

    esperaP = 3 if pideP else 2
    esperaB = 3 if pideB else 2
    terminado = (nP == esperaP) and (nB == esperaB)

    ganador = "BANCA" if sB > sP else ("PUNTO" if sP > sB else "EMPATE (TIE)")
    return {
        "win": ganador,
        "scoreP": sP,
        "scoreB": sB,
        "listo": terminado,
        "natural": False,
        "descripcion": f"Punto: {sP} vs Banca: {sB}"
    }

def motor_blackjack(jugador_cards, dealer_cards):
    def sum_bj(cards):
        tot = 0
        aces = 0
        for c in cards:
            v = str(c.get('val', '')).strip().upper()
            if any(x in v for x in ['10', 'J', 'Q', 'K']):
                tot += 10
            elif 'AS' in v or v == 'A':
                aces += 1
            else:
                digits = ''.join(ch for ch in v if ch.isdigit())
                tot += int(digits) if digits else 0
        for _ in range(aces):
            if tot + 11 <= 21:
                tot += 11
            else:
                tot += 1
        return tot

    sJ = sum_bj(jugador_cards)
    sD = sum_bj(dealer_cards)
    terminado = sJ > 21 or (sD >= 17 and len(jugador_cards) >= 2)

    if sJ > 21:
        res = "DEALER GANA (JUGADOR SE PASO)"
    elif sD > 21:
        res = "JUGADOR GANA (DEALER SE PASO)"
    elif sD >= 17:
        if sD > sJ:
            res = "DEALER GANA"
        elif sJ > sD:
            res = "JUGADOR GANA"
        else:
            res = "EMPATE"
    else:
        res = "JUGANDO"

    return {
        "win": res,
        "scoreP": sJ,
        "scoreB": sD,
        "listo": terminado,
        "descripcion": f"Jugador: {sJ} vs Dealer: {sD}"
    }

# ====================================================================
# WORKER RTSP MULTIHILO POR CÁMARA
# ====================================================================

def stream_worker(mesa_uuid, url_rtsp):
    print(f"📹 [RTSP Worker] Conectando a {mesa_uuid}: {url_rtsp}")
    cap = cv2.VideoCapture(url_rtsp)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    consecutive_failures = 0

    while True:
        # Verificar si la mesa sigue configurada
        if mesa_uuid not in mesas_config:
            cap.release()
            break

        if not cap.isOpened():
            estado_stream[mesa_uuid] = 'error'
            time.sleep(4)
            cap = cv2.VideoCapture(url_rtsp)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            consecutive_failures = 0
            continue

        ret, frame = cap.read()
        if ret and frame is not None and frame.size > 0:
            frames_actuales[mesa_uuid] = frame
            estado_stream[mesa_uuid] = 'activo'
            consecutive_failures = 0
        else:
            consecutive_failures += 1
            if consecutive_failures >= 40:
                estado_stream[mesa_uuid] = 'error'
                cap.release()
                time.sleep(2)
                cap = cv2.VideoCapture(url_rtsp)
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                consecutive_failures = 0
            else:
                time.sleep(0.02)
                continue

        time.sleep(0.03)

# ====================================================================
# BUCLE DE INFERENCIA CONTINUA IA + REGLAS DE JUEGO
# ====================================================================

def ai_inference_loop():
    print("🧠 [AI Inference Loop] Iniciando análisis continuo de mesas...")
    while True:
        for mesa_uuid, cfg in list(mesas_config.items()):
            if estado_stream.get(mesa_uuid) != 'activo':
                continue

            frame = frames_actuales.get(mesa_uuid)
            if frame is None:
                continue

            try:
                # Inferencia con YOLO (imgsz=1280 para máxima resolución y detección nítida de cartas)
                results = model(frame, verbose=False, conf=0.35, iou=0.25, imgsz=1280)

                raw_cards = []
                guardar_por_duda = False

                for box in results[0].boxes:
                    cls_id = int(box.cls[0])
                    name = model.names[cls_id].upper()
                    conf = round(float(box.conf[0]), 2)

                    # Si la confianza es dudosa (35% a 65%), marcar para aprendizaje activo
                    if 0.35 <= conf <= 0.65:
                        guardar_por_duda = True

                    x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
                    cx = (x1 + x2) / 2
                    cy = (y1 + y2) / 2

                    raw_cards.append({
                        "val": name,
                        "box": [x1, y1, x2, y2],
                        "cx": cx,
                        "cy": cy,
                        "conf": conf
                    })

                # Ordenar cartas de izquierda a derecha por posición horizontal (cx)
                raw_cards.sort(key=lambda c: c['cx'])
                count = len(raw_cards)
                detections = []
                estado_mesa = "NORMAL"

                if count == 0:
                    estado_mesa = "ESPERANDO"
                    punto_list = []
                    banca_list = []
                elif count >= 8:
                    estado_mesa = "BARAJO"
                    punto_list = []
                    banca_list = []
                else:
                    gaps = [raw_cards[i+1]['cx'] - raw_cards[i]['cx'] for i in range(count - 1)]
                    max_gap = max(gaps) if gaps else 0

                    if count > 1 and max_gap < 20:
                        estado_mesa = "RECOGIENDO"
                    elif count < 4:
                        estado_mesa = "REPARTIENDO"
                    else:
                        estado_mesa = "NORMAL"

                    # Separación de zonas (Banca / Punto)
                    m_gap = -1
                    idx_divisor = max(1, count // 2)
                    for i, g in enumerate(gaps):
                        if g > m_gap:
                            m_gap = g
                            idx_divisor = i + 1

                    banca_list = raw_cards[:idx_divisor]
                    punto_list = raw_cards[idx_divisor:]

                    for c in banca_list:
                        detections.append({**c, "zone": "banca"})
                    for c in punto_list:
                        detections.append({**c, "zone": "punto"})

                # Ejecutar motor de reglas según juego de la mesa
                juego = (cfg.get('juego') or 'baccarat').lower()
                if 'black' in juego:
                    resultado = motor_blackjack(punto_list, banca_list)
                else:
                    resultado = motor_baccarat(punto_list, banca_list)

                # Generar snapshot con cajas delimitadoras dibujadas
                img_plot = frame.copy()
                for det in detections:
                    x1, y1, x2, y2 = det['box']
                    color = (0, 255, 255) if det['zone'] == "banca" else (255, 100, 0)
                    cv2.rectangle(img_plot, (x1, y1), (x2, y2), color, 3)

                    label = f"{det['val']} ({det['conf']})"
                    (w, h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
                    cv2.rectangle(img_plot, (x1, y1 - h - 12), (x1 + w, y1), color, -1)
                    cv2.putText(img_plot, label, (x1, y1 - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)

                # Guardar frame para aprendizaje activo si hubo duda o baja confianza
                if guardar_por_duda and count > 0:
                    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                    duda_path = os.path.join(AUTO_TRAIN_DIR, f"duda_{ts}_{mesa_uuid[:6]}.jpg")
                    cv2.imwrite(duda_path, frame)

                # Convertir imagen a base64 ligera para transmisión
                _, buf = cv2.imencode('.jpg', img_plot, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
                b64_img = base64.b64encode(buf).decode('utf-8')

                det_p_str = ', '.join([c['val'] for c in punto_list])
                det_b_str = ', '.join([c['val'] for c in banca_list])
                detalle_mano = f"P:[{det_p_str}] B:[{det_b_str}]"

                # Guardar estado vivo en memoria
                live_results[mesa_uuid] = {
                    "mesa_uuid": mesa_uuid,
                    "mesa_nombre": cfg.get('nombre'),
                    "juego": cfg.get('juego'),
                    "estado_mesa": estado_mesa,
                    "resultado": resultado,
                    "punto": punto_list,
                    "banca": banca_list,
                    "detalle": detalle_mano,
                    "scoreP": resultado.get('scoreP', 0),
                    "scoreB": resultado.get('scoreB', 0),
                    "ganador": resultado.get('win', 'ESPERANDO'),
                    "image_b64": b64_img,
                    "timestamp": time.time(),
                    "hora": datetime.now().strftime("%H:%M:%S")
                }

                # Auto-guardado en base de datos si la mano está lista y no se ha guardado
                if resultado.get('listo') and estado_mesa == 'NORMAL' and (punto_list or banca_list):
                    ultimo = historial_guardado.get(mesa_uuid)
                    if detalle_mano != ultimo:
                        historial_guardado[mesa_uuid] = detalle_mano
                        enviar_evento_a_wisi(mesa_uuid, cfg, resultado, detalle_mano, b64_img)

            except Exception as e:
                print(f"❌ Error en inferencia de mesa {mesa_uuid}: {e}")

        time.sleep(0.4)

def enviar_evento_a_wisi(mesa_uuid, cfg, resultado, detalle_mano, b64_img):
    """
    Envía la jugada analizada con Inteligencia Artificial a la base de datos de Wisi
    """
    try:
        payload = {
            "sala_uuid": cfg.get('sala_uuid'),
            "mesa_uuid": mesa_uuid,
            "mesa_nombre": cfg.get('nombre'),
            "juego_nombre": cfg.get('juego'),
            "tipo_evento": "JUGADA",
            "descripcion": f"{resultado.get('win')} ({resultado.get('scoreP')} a {resultado.get('scoreB')}) | {detalle_mano}",
            "nivel_alerta": "INFO",
            "es_novedad": False,
            "detalles": {
                "score_punto": resultado.get('scoreP'),
                "score_banca": resultado.get('scoreB'),
                "ganador": resultado.get('win'),
                "detalle_cartas": detalle_mano,
                "natural": resultado.get('natural', False),
                "imagen_captura": f"data:image/jpeg;base64,{b64_img[:500]}..." # truncada en BD por tamaño
            }
        }
        res = requests.post(f"{WISI_API_URL}/ia-eventos", json=payload, timeout=5)
        if res.status_code in [200, 201]:
            print(f"✅ [IA Wisi] Jugada registrada en mesa {cfg.get('nombre')}: {resultado.get('win')} ({resultado.get('scoreP')} a {resultado.get('scoreB')})")
    except Exception as err:
        print(f"⚠️ Error enviando evento a Wisi Fastify: {err}")

# ====================================================================
# RUTAS DE API FLASK Y CONTROLADORES CORS
# ====================================================================

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        res = Response()
        res.headers['Access-Control-Allow-Origin'] = '*'
        res.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS, PUT, DELETE'
        res.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
        return res

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS, PUT, DELETE'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    return response

@app.route('/status', methods=['GET'])
def get_status():
    return jsonify({
        "status": "online",
        "device": device,
        "mesas_conectadas": len(mesas_config),
        "streams_activos": sum(1 for s in estado_stream.values() if s == 'activo'),
        "estados": estado_stream
    })

@app.route('/sync_mesas', methods=['POST'])
def sync_mesas_endpoint():
    data = request.get_json(force=True, silent=True) or {}
    mesas_list = data.get('mesas', [])
    actualizar_mesas(mesas_list)
    return jsonify({"success": True, "count": len(mesas_config)})

@app.route('/mesa/<mesa_uuid>', methods=['GET'])
def get_mesa_live(mesa_uuid):
    res = live_results.get(mesa_uuid)
    if not res:
        return jsonify({"error": "Mesa no analizada todavía", "estado": estado_stream.get(mesa_uuid, 'desconocido')}), 404
    return jsonify(res)

@app.route('/all_mesas', methods=['GET'])
def get_all_mesas():
    return jsonify(live_results)

@app.route('/stream/<mesa_uuid>')
def stream_mjpeg(mesa_uuid):
    """
    Emite un flujo continuo MJPEG con las cajas delimitadoras de YOLO y datos de la jugada
    """
    def generate():
        while True:
            res = live_results.get(mesa_uuid)
            if res and res.get('image_b64'):
                try:
                    img_bytes = base64.b64decode(res['image_b64'])
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + img_bytes + b'\r\n')
                except Exception:
                    pass
            time.sleep(0.08)
    return Response(generate(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/feedback', methods=['POST'])
def save_feedback():
    """
    Permite al auditor registrar una corrección o guardar la imagen actual para reentrenamiento activo
    """
    try:
        data = request.get_json(force=True, silent=True) or {}
        mesa_uuid = data.get('mesa_uuid')
        nota = data.get('nota', 'manual_feedback')
        frame = frames_actuales.get(mesa_uuid)
        if frame is not None and frame.size > 0:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            path = os.path.join(AUTO_TRAIN_DIR, f"feedback_{ts}_{mesa_uuid[:6]}.jpg")
            cv2.imwrite(path, frame)
            # Guardar metadatos JSON junto a la imagen
            json_path = os.path.join(AUTO_TRAIN_DIR, f"feedback_{ts}_{mesa_uuid[:6]}.json")
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            return jsonify({"success": True, "saved_to": path})
        return jsonify({"success": False, "error": "No hay frame disponible"}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


def actualizar_mesas(mesas_list):
    for m in mesas_list:
        uuid = m.get('uuid') or m.get('mesa_uuid') or m.get('id')
        ip = m.get('dispositivo_ip')
        canal = m.get('numero_canal')
        usuario = m.get('dispositivo_usuario') or 'admin'
        clave = m.get('dispositivo_clave') or ''
        juego = m.get('juego_nombre') or 'Baccarat'
        nombre = m.get('mesa_nombre') or m.get('nombre') or f"Mesa {canal}"
        sala_uuid = m.get('sala_uuid')

        if not uuid or not ip or not canal:
            continue

        mesas_config[uuid] = {
            "ip": ip,
            "canal": canal,
            "usuario": usuario,
            "clave": clave,
            "juego": juego,
            "nombre": nombre,
            "sala_uuid": sala_uuid
        }

        # Iniciar thread RTSP si no existe
        if uuid not in estado_stream:
            url_rtsp = f"rtsp://{usuario}:{clave}@{ip}:554/Streaming/Channels/{canal}01"
            estado_stream[uuid] = 'conectando'
            threading.Thread(target=stream_worker, args=(uuid, url_rtsp), daemon=True).start()

def cargar_mesas_desde_fastify():
    try:
        r = requests.get(f"{WISI_API_URL}/mesas-con-camaras", timeout=5)
        if r.status_code == 200:
            data = r.json().get('data', [])
            print(f"📥 [Wisi Config] {len(data)} mesas con cámaras obtenidas del backend")
            actualizar_mesas(data)
    except Exception as e:
        print(f"⚠️ No se pudo sincronizar automáticamente con backend Wisi: {e}")

if __name__ == '__main__':
    cargar_mesas_desde_fastify()
    threading.Thread(target=ai_inference_loop, daemon=True).start()
    app.run(host='0.0.0.0', port=5005, threaded=True)
