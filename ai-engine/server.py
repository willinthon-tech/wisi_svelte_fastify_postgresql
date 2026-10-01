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

# Configuración backend Wisi (Producción y Local)
WISI_API_URLS = [
    os.environ.get('WISI_API_URL', 'https://wisi.space/api/cecom'),
    'http://127.0.0.1:3030/api/cecom'
]

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

def resolve_game_type(mesa_nombre, juego_nombre):
    """
    Resuelve con precisión el juego analizando tanto el nombre de la mesa (ej: PK 3, PB 1)
    como la categoría asignada, evitando que mesas de Poker Caribeño se confundan con Baccarat.
    """
    txt = f"{mesa_nombre or ''} {juego_nombre or ''}".upper()
    if any(k in txt for k in ['PK', 'POKER', 'CARIBE', 'STUD']):
        return 'POKER_CARIBENO'
    if any(k in txt for k in ['PB', 'BACCARAT', 'PUNTO', 'BANCA']):
        return 'BACCARAT'
    if any(k in txt for k in ['BJ', 'BLACKJACK', '21']):
        return 'BLACKJACK'
    if any(k in txt for k in ['TX', 'TEXAS', 'HOLDEM']):
        return 'TEXAS_BONUS'
    if any(k in txt for k in ['RA', 'RULETA', 'ROULETTE']):
        return 'RULETA'
    return 'BACCARAT'

def motor_poker_caribeno(cards):
    """
    Reglas oficiales de Poker Caribeño (Caribbean Stud Poker).
    Evalúa las 5 cartas de la Casa y la regla de calificación:
    La Casa sólo califica con As-Rey o una jugada superior (Par, Trío, etc.).
    """
    card_ranks = {
        '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
        'J': 11, 'Q': 12, 'K': 13, 'AS': 14, 'A': 14
    }

    up_cards = [c for c in cards if 'BACK' not in str(c.get('val', '')).upper()]
    back_count = sum(1 for c in cards if 'BACK' in str(c.get('val', '')).upper())

    if len(cards) < 5 or back_count > 0:
        up_vals = [c.get('val') for c in up_cards]
        return {
            "win": "REPARTIENDO",
            "califica": None,
            "jugada": f"Dealer muestra: {', '.join(up_vals)}" if up_vals else "Cartas en proceso",
            "listo": False,
            "descripcion": f"Repartiendo ({len(up_cards)} descubiertas, {back_count} cubiertas)"
        }

    ranks = []
    for c in cards:
        v = str(c.get('val', '')).strip().upper()
        r = card_ranks.get(v)
        if not r:
            digits = ''.join(ch for ch in v if ch.isdigit())
            r = int(digits) if digits else 0
        if r > 0:
            ranks.append(r)

    ranks.sort(reverse=True)
    if len(ranks) < 5:
        return {
            "win": "MANO_EN_PROCESO",
            "califica": False,
            "jugada": "Alineando cartas del Dealer",
            "listo": False,
            "descripcion": f"{len(ranks)} de 5 cartas identificadas"
        }

    counts = {}
    for r in ranks:
        counts[r] = counts.get(r, 0) + 1

    freqs = sorted(counts.items(), key=lambda x: (x[1], x[0]), reverse=True)
    rank_names = {14: 'As', 13: 'K', 12: 'Q', 11: 'J', 10: '10', 9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2'}

    is_straight = False
    if len(set(ranks)) == 5:
        if ranks[0] - ranks[4] == 4 or ranks == [14, 5, 4, 3, 2]:
            is_straight = True

    jugada = ""
    califica = False

    if freqs[0][1] == 4:
        jugada = f"Poker de {rank_names.get(freqs[0][0])}"
        califica = True
    elif freqs[0][1] == 3 and freqs[1][1] == 2:
        jugada = f"Full House ({rank_names.get(freqs[0][0])} y {rank_names.get(freqs[1][0])})"
        califica = True
    elif is_straight:
        jugada = f"Escalera al {rank_names.get(ranks[0])}"
        califica = True
    elif freqs[0][1] == 3:
        jugada = f"Trío de {rank_names.get(freqs[0][0])}"
        califica = True
    elif freqs[0][1] == 2 and freqs[1][1] == 2:
        jugada = f"Doble Par ({rank_names.get(freqs[0][0])} y {rank_names.get(freqs[1][0])})"
        califica = True
    elif freqs[0][1] == 2:
        jugada = f"Par de {rank_names.get(freqs[0][0])}"
        califica = True
    else:
        has_ace = 14 in ranks
        has_king = 13 in ranks
        if has_ace and has_king:
            jugada = f"As y Rey ({rank_names.get(ranks[2])} kicker)"
            califica = True
        else:
            jugada = f"{rank_names.get(ranks[0])} Mayor"
            califica = False

    estado_ganador = "CASA CALIFICA" if califica else "CASA NO CALIFICA"
    return {
        "win": estado_ganador,
        "califica": califica,
        "jugada": jugada,
        "listo": True,
        "descripcion": f"{estado_ganador}: {jugada}"
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
                # Determinar juego exacto de la mesa
                tipo_juego = resolve_game_type(cfg.get('nombre'), cfg.get('juego'))

                # Inferencia con YOLO (imgsz=1280 para máxima resolución y detección nítida de cartas)
                results = model(frame, verbose=False, conf=0.35, iou=0.25, imgsz=1280)

                raw_cards = []
                guardar_por_duda = False

                for box in results[0].boxes:
                    cls_id = int(box.cls[0])
                    name = model.names[cls_id].upper()
                    conf = round(float(box.conf[0]), 2)

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

                raw_cards.sort(key=lambda c: c['cx'])
                count = len(raw_cards)
                detections = []
                estado_mesa = "NORMAL"

                if count == 0:
                    estado_mesa = "ESPERANDO"
                    punto_list = []
                    banca_list = []
                elif count >= 8 and tipo_juego != 'POKER_CARIBENO':
                    estado_mesa = "BARAJO"
                    punto_list = []
                    banca_list = []
                else:
                    gaps = [raw_cards[i+1]['cx'] - raw_cards[i]['cx'] for i in range(count - 1)]
                    max_gap = max(gaps) if gaps else 0

                    if count > 1 and max_gap < 20:
                        estado_mesa = "RECOGIENDO"
                    elif count < (5 if tipo_juego == 'POKER_CARIBENO' else 4):
                        estado_mesa = "REPARTIENDO"
                    else:
                        estado_mesa = "NORMAL"

                    m_gap = -1
                    idx_divisor = max(1, count // 2)
                    for i, g in enumerate(gaps):
                        if g > m_gap:
                            m_gap = g
                            idx_divisor = i + 1

                    banca_list = raw_cards[:idx_divisor]
                    punto_list = raw_cards[idx_divisor:]

                # Ejecutar motor de reglas según juego
                if tipo_juego == 'POKER_CARIBENO':
                    juego_label = "Poker Caribeño"
                    resultado = motor_poker_caribeno(raw_cards)
                    detalle_mano = resultado.get('jugada', '')
                    for c in raw_cards:
                        detections.append({**c, "zone": "dealer"})

                    live_results[mesa_uuid] = {
                        "mesa_uuid": mesa_uuid,
                        "mesa_nombre": cfg.get('nombre'),
                        "juego": juego_label,
                        "juego_tipo": "POKER_CARIBENO",
                        "estado_mesa": estado_mesa,
                        "resultado": resultado,
                        "dealer_cards": raw_cards,
                        "dealer_jugada": resultado.get('jugada'),
                        "califica": resultado.get('califica'),
                        "detalle": detalle_mano,
                        "ganador": resultado.get('win', 'ESPERANDO'),
                        "scoreP": 0,
                        "scoreB": 0,
                        "punto": [],
                        "banca": [],
                        "image_b64": "",
                        "timestamp": time.time(),
                        "hora": datetime.now().strftime("%H:%M:%S")
                    }
                elif tipo_juego == 'BLACKJACK':
                    juego_label = "Blackjack"
                    resultado = motor_blackjack(punto_list, banca_list)
                    detalle_mano = f"J:[{', '.join([c['val'] for c in punto_list])}] D:[{', '.join([c['val'] for c in banca_list])}]"
                    for c in banca_list:
                        detections.append({**c, "zone": "dealer"})
                    for c in punto_list:
                        detections.append({**c, "zone": "jugador"})

                    live_results[mesa_uuid] = {
                        "mesa_uuid": mesa_uuid,
                        "mesa_nombre": cfg.get('nombre'),
                        "juego": juego_label,
                        "juego_tipo": "BLACKJACK",
                        "estado_mesa": estado_mesa,
                        "resultado": resultado,
                        "punto": punto_list,
                        "banca": banca_list,
                        "detalle": detalle_mano,
                        "scoreP": resultado.get('scoreP', 0),
                        "scoreB": resultado.get('scoreB', 0),
                        "ganador": resultado.get('win', 'JUGANDO'),
                        "image_b64": "",
                        "timestamp": time.time(),
                        "hora": datetime.now().strftime("%H:%M:%S")
                    }
                else: # BACCARAT
                    juego_label = "Baccarat"
                    resultado = motor_baccarat(punto_list, banca_list)
                    det_p_str = ', '.join([c['val'] for c in punto_list])
                    det_b_str = ', '.join([c['val'] for c in banca_list])
                    detalle_mano = f"P:[{det_p_str}] B:[{det_b_str}]"
                    for c in banca_list:
                        detections.append({**c, "zone": "banca"})
                    for c in punto_list:
                        detections.append({**c, "zone": "punto"})

                    live_results[mesa_uuid] = {
                        "mesa_uuid": mesa_uuid,
                        "mesa_nombre": cfg.get('nombre'),
                        "juego": juego_label,
                        "juego_tipo": "BACCARAT",
                        "estado_mesa": estado_mesa,
                        "resultado": resultado,
                        "punto": punto_list,
                        "banca": banca_list,
                        "detalle": detalle_mano,
                        "scoreP": resultado.get('scoreP', 0),
                        "scoreB": resultado.get('scoreB', 0),
                        "ganador": resultado.get('win', 'ESPERANDO'),
                        "image_b64": "",
                        "timestamp": time.time(),
                        "hora": datetime.now().strftime("%H:%M:%S")
                    }

                # Generar snapshot con cajas delimitadoras dibujadas
                img_plot = frame.copy()
                for det in detections:
                    x1, y1, x2, y2 = det['box']
                    zone = det.get('zone', '')
                    if zone == "banca":
                        color = (0, 0, 255) # Rojo Banca
                    elif zone == "punto":
                        color = (255, 120, 0) # Azul Punto
                    elif zone == "dealer":
                        color = (0, 215, 255) # Oro Casa / Dealer
                    else:
                        color = (0, 255, 0)

                    cv2.rectangle(img_plot, (x1, y1), (x2, y2), color, 3)
                    label = f"{det['val']} ({det['conf']})"
                    (w, h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
                    cv2.rectangle(img_plot, (x1, y1 - h - 12), (x1 + w, y1), color, -1)
                    cv2.putText(img_plot, label, (x1, y1 - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)

                # Convertir imagen a base64 ligera para transmisión
                _, buf = cv2.imencode('.jpg', img_plot, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                b64_img = base64.b64encode(buf).decode('utf-8')
                live_results[mesa_uuid]["image_b64"] = b64_img

                # Guardar frame para aprendizaje activo si hubo duda o baja confianza
                if guardar_por_duda and count > 0:
                    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                    duda_path = os.path.join(AUTO_TRAIN_DIR, f"duda_{ts}_{mesa_uuid[:6]}.jpg")
                    cv2.imwrite(duda_path, frame)

                # Auto-guardado en base de datos si la mano está lista y no se ha guardado
                if resultado.get('listo') and estado_mesa == 'NORMAL' and raw_cards:
                    ultimo = historial_guardado.get(mesa_uuid)
                    if detalle_mano != ultimo:
                        historial_guardado[mesa_uuid] = detalle_mano
                        enviar_evento_a_wisi(mesa_uuid, cfg, resultado, detalle_mano, b64_img, juego_label)

            except Exception as e:
                print(f"❌ Error en inferencia de mesa {mesa_uuid}: {e}")

        time.sleep(0.4)

def enviar_evento_a_wisi(mesa_uuid, cfg, resultado, detalle_mano, b64_img, juego_label='Baccarat'):
    """
    Envía la jugada analizada con Inteligencia Artificial a la base de datos de Wisi
    """
    try:
        if juego_label == "Poker Caribeño":
            desc = f"Poker Caribeño - {resultado.get('win')}: {detalle_mano}"
        elif juego_label == "Blackjack":
            desc = f"Blackjack - {resultado.get('win')} | {detalle_mano}"
        else:
            desc = f"{resultado.get('win')} ({resultado.get('scoreP')} a {resultado.get('scoreB')}) | {detalle_mano}"

        payload = {
            "sala_uuid": cfg.get('sala_uuid'),
            "mesa_uuid": mesa_uuid,
            "mesa_nombre": cfg.get('nombre'),
            "juego_nombre": juego_label,
            "tipo_evento": "JUGADA",
            "descripcion": desc,
            "nivel_alerta": "INFO",
            "es_novedad": False,
            "detalles": {
                "score_punto": resultado.get('scoreP', 0),
                "score_banca": resultado.get('scoreB', 0),
                "ganador": resultado.get('win'),
                "califica": resultado.get('califica'),
                "dealer_jugada": resultado.get('jugada'),
                "detalle_cartas": detalle_mano,
                "natural": resultado.get('natural', False),
                "imagen_captura": f"data:image/jpeg;base64,{b64_img[:500]}..." # truncada en BD por tamaño
            }
        }
        for api_url in WISI_API_URLS:
            try:
                res = requests.post(f"{api_url}/ia-eventos", json=payload, timeout=4)
                if res.status_code in [200, 201]:
                    print(f"✅ [IA Wisi] Jugada registrada en {api_url} para mesa {cfg.get('nombre')}: {desc}")
                    break
            except Exception:
                pass
    except Exception as err:
        print(f"⚠️ Error procesando evento Wisi: {err}")

def sync_to_cloud_worker():
    """
    Sincroniza continuamente los resultados de detección IA en tiempo real hacia el backend central de Wisi.
    Esto permite que cualquier usuario o máquina cliente con la app de Windows pueda ver la detección
    de cartas, jugadas y streaming aunque no tenga Python ni el modelo ejecutándose localmente.
    """
    print("🌐 [Cloud Sync] Iniciando sincronización de IA hacia el backend central...")
    endpoints = [
        "https://wisi.space/api/cecom/ia-live-sync",
        "http://127.0.0.1:3030/api/cecom/ia-live-sync"
    ]
    while True:
        try:
            if live_results:
                payload = { "mesas": live_results }
                for ep in endpoints:
                    try:
                        requests.post(ep, json=payload, timeout=2.5)
                    except Exception:
                        pass
        except Exception:
            pass
        time.sleep(1.2)

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
    for api_url in WISI_API_URLS:
        try:
            r = requests.get(f"{api_url}/mesas-con-camaras", timeout=5)
            if r.status_code == 200:
                data = r.json().get('data', [])
                if data:
                    print(f"📥 [Wisi Config] {len(data)} mesas con cámaras obtenidas de {api_url}")
                    actualizar_mesas(data)
                    return
        except Exception:
            pass
    print("⚠️ No se pudo sincronizar automáticamente con backend Wisi en ninguna URL")

if __name__ == '__main__':
    cargar_mesas_desde_fastify()
    threading.Thread(target=ai_inference_loop, daemon=True).start()
    threading.Thread(target=sync_to_cloud_worker, daemon=True).start()
    app.run(host='0.0.0.0', port=5005, threaded=True)
