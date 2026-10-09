"""
server.py - Motor de Inteligencia Artificial para Auditoría de Mesas de Casino (Wisi Space)
Detecta cartas, reconoce jugadas (Baccarat, Blackjack, Poker), aplica reglas oficiales,
calcula scores en tiempo real y guarda eventos con aprendizaje activo.
"""

import os
import sys
import socket

# Forzar RTSP TCP en puerto 554 con timeout rápido para evitar congelamientos en red local
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|buffer_size;1024000|max_delay;500000|stimeout;2500000"

import time
import base64
import json
import threading
from datetime import datetime
import cv2
import numpy as np
import requests
from requests.auth import HTTPDigestAuth
from flask import Flask, jsonify, Response, request
from ultralytics import YOLO
import torch

sys.stdout.reconfigure(line_buffering=True)
app = Flask(__name__)

# --- CONFIGURACIÓN DE RUTAS Y MODELO ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, 'models')
AUTO_TRAIN_DIR = os.path.join(BASE_DIR, 'data_aprendizaje')
LEARNED_GLYPHS_DIR = os.path.join(MODELS_DIR, 'learned_glyphs')
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(AUTO_TRAIN_DIR, exist_ok=True)
os.makedirs(LEARNED_GLYPHS_DIR, exist_ok=True)

# Buscar modelo best.pt
MODEL_PATH = os.path.join(MODELS_DIR, 'best.pt')
if not os.path.exists(MODEL_PATH):
    fallback_path = r'C:\Users\antho\Downloads\ia_wisi_space\best.pt'
    if os.path.exists(fallback_path):
        MODEL_PATH = fallback_path

print(f"📦 Cargando modelo YOLO desde: {MODEL_PATH}")
device = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"🚀 Dispositivo de inferencia IA: {device.upper()}")
if device == 'cpu':
    torch.set_num_threads(8)
model = YOLO(MODEL_PATH)

# Configuración backend Wisi (Producción y Local)
WISI_API_URLS = [
    os.environ.get('WISI_API_URL', 'https://wisi.space/api/cecom'),
    'http://127.0.0.1:3030/api/cecom'
]

# Almacenes de streaming en vivo
mesas_config = {}       # { mesa_uuid: { ip, canal, usuario, clave, juego, nombre } }
frames_actuales = {}    # { mesa_uuid: frame }
live_jpeg_buffers = {}  # { mesa_uuid: bytes_jpeg } para streaming MJPEG fluido en vivo
live_annotations = {}   # { mesa_uuid: { cards, ribbons, chips, estado, resultado } }
estado_stream = {}      # { mesa_uuid: 'activo' | 'conectando' | 'error' }
reconnect_requests = set()
mesa_completed_rounds = {} # { mesa_uuid: { resultado, detalle, listo, saved, ready_time } }
live_results = {}       # { mesa_uuid: { estado, ganador, scoreP, scoreB, punto, banca, ... } }
historial_guardado = {} # { mesa_uuid: ultimo_detalle }

def make_placeholder_frame(mesa_nombre="Mesa", mensaje="Sincronizando cámara..."):
    """
    Genera un fotograma nítido de respaldo en memoria para evitar pantallas negras o flujos corruptos.
    """
    img = np.zeros((360, 640, 3), dtype=np.uint8)
    img[:] = (20, 24, 30) # Fondo oscuro moderno
    cv2.rectangle(img, (12, 12), (628, 348), (40, 50, 65), 2)
    # Badge superior
    cv2.rectangle(img, (20, 20), (230, 52), (38, 166, 154), -1)
    cv2.putText(img, "WISI AI CASINO VISION", (28, 42), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 2, cv2.LINE_AA)
    # Nombre de mesa
    cv2.putText(img, str(mesa_nombre).upper(), (30, 115), cv2.FONT_HERSHEY_SIMPLEX, 0.95, (255, 255, 255), 2, cv2.LINE_AA)
    # Mensaje de estado
    cv2.putText(img, str(mensaje), (30, 175), cv2.FONT_HERSHEY_SIMPLEX, 0.70, (0, 215, 255), 2, cv2.LINE_AA)
    # Indicador de red
    cv2.putText(img, "Transmisión Substream • Red LAN • Puerto 554 / ISAPI", (30, 230), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (148, 163, 184), 1, cv2.LINE_AA)
    cv2.putText(img, "Presione 🔄 Refrescar si la cámara tarda en sincronizar", (30, 310), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (100, 116, 139), 1, cv2.LINE_AA)
    _, b = cv2.imencode('.jpg', img, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
    return b.tobytes()

def preprocesar_filtro_mesa(crop_bgr):
    """
    Aplica una máscara de filtros adaptativos en OpenCV:
    - Realza el contraste de cartas blancas sobre el paño
    - Mitiga destellos de lámparas cenitales mediante CLAHE en luminancia (LAB)
    - Destaca números y palos descoloridos
    """
    if crop_bgr is None or crop_bgr.size == 0:
        return crop_bgr
    try:
        lab = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2LAB)
        l_ch, a_ch, b_ch = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
        l_eq = clahe.apply(l_ch)
        enhanced = cv2.cvtColor(cv2.merge((l_eq, a_ch, b_ch)), cv2.COLOR_LAB2BGR)
        return enhanced
    except Exception:
        return crop_bgr

def calcular_puestos_mesa(w_f, tipo_juego='BACCARAT'):
    """
    Mapeo geométrico de los puestos en mesa de cartas:
    - Puestos 1 al N ordenados de IZQUIERDA A DERECHA.
    - Secuencia de pago y liquidación de croupier: de DERECHA A IZQUIERDA (N -> 1).
    """
    if tipo_juego == 'BACCARAT':
        puestos_labels = [1, 2, 3, 5, 6, 7]
    else:
        puestos_labels = [1, 2, 3, 4, 5, 6, 7]

    num_p = len(puestos_labels)
    step = (w_f * 0.76) / float(num_p)
    puestos = []
    start_x = w_f * 0.12
    for i, p_num in enumerate(puestos_labels):
        x_min = start_x + i * step
        x_max = x_min + step
        puestos.append({
            "puesto": p_num,
            "x_min": x_min,
            "x_max": x_max,
            "cx": (x_min + x_max) / 2,
            "orden_reparto": i + 1,       # 1..N Izquierda a Derecha
            "orden_pago": num_p - i       # N..1 Derecha a Izquierda
        })
    return puestos

# ====================================================================
# MOTOR DE APRENDIZAJE ACTIVO, DESAMBIGUACIÓN Y ESTABILIZACIÓN DE CARTAS
# ====================================================================

def extract_rank_glyph(card_bgr):
    """Extrae y normaliza el glifo de índice (32x48) de la esquina superior izquierda."""
    if card_bgr is None or card_bgr.size == 0:
        return None
    h, w = card_bgr.shape[:2]
    crop = card_bgr[int(h * 0.03):int(h * 0.30), int(w * 0.04):int(w * 0.32)]
    if crop.size == 0:
        return None
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(4, 4))
    gray = clahe.apply(gray)
    thresh = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, 
                                   cv2.THRESH_BINARY_INV, 15, 6)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    cleaned = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
    return cv2.resize(cleaned, (32, 48), interpolation=cv2.INTER_AREA)

def count_card_pips(card_bgr):
    """Cuenta pips (símbolos de palos) en el área central de la carta mediante Otsu adaptativo."""
    if card_bgr is None or card_bgr.size == 0:
        return 0
    h, w = card_bgr.shape[:2]
    center = card_bgr[int(h * 0.12):int(h * 0.88), int(w * 0.12):int(w * 0.88)]
    if center.size == 0:
        return 0
    gray = cv2.cvtColor(center, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = (h * w) * 0.0015
    max_area = (h * w) * 0.08
    valid = [c for c in contours if min_area < cv2.contourArea(c) < max_area]
    return len(valid)

class CardRankVerifier:
    """
    Verificador Inteligente de Rango y Aprendizaje Activo:
    - Aprende automáticamente las fuentes/cartas reales de cada cámara en vivo
    - Resuelve pares de confusión críticos: 5 vs AS, 2 vs 4, 5 vs 7, 10 vs 7
    - Realiza matching multiescala con plantillas aprendidas
    """
    def __init__(self, templates_dir):
        self.templates_dir = templates_dir
        os.makedirs(templates_dir, exist_ok=True)
        self.learned_templates = {}
        self.load_templates()

    def load_templates(self):
        self.learned_templates = {}
        if not os.path.exists(self.templates_dir):
            return
        for f in os.listdir(self.templates_dir):
            if f.endswith('.png') or f.endswith('.jpg'):
                parts = f.replace('.png', '').replace('.jpg', '').split('_')
                if len(parts) >= 2 and parts[0] == 'glyph':
                    rank = parts[1].upper()
                    img = cv2.imread(os.path.join(self.templates_dir, f), cv2.IMREAD_GRAYSCALE)
                    if img is not None:
                        self.learned_templates.setdefault(rank, []).append(img)
        total = sum(len(v) for v in self.learned_templates.values())
        print(f"📚 [CardRankVerifier] {total} plantillas de naipes cargadas ({len(self.learned_templates)} rangos).")

    def auto_learn(self, card_bgr, rank, conf):
        """Aprende de forma autónoma durante el juego en vivo si la detección es sólida (>= 0.85)."""
        if card_bgr is None or conf < 0.85 or rank in ['BACK', '']:
            return
        rank = rank.upper()
        existing = self.learned_templates.get(rank, [])
        if len(existing) >= 6:
            return
        glyph = extract_rank_glyph(card_bgr)
        if glyph is None:
            return
        filename = f"glyph_{rank.lower()}_{int(time.time()*1000)%100000}.png"
        filepath = os.path.join(self.templates_dir, filename)
        cv2.imwrite(filepath, glyph)
        self.learned_templates.setdefault(rank, []).append(glyph)

    def verify_and_disambiguate(self, card_bgr, raw_rank, conf):
        raw_rank = raw_rank.upper()
        if raw_rank in ['BACK', ''] or card_bgr is None or card_bgr.size == 0:
            return raw_rank, conf

        glyph = extract_rank_glyph(card_bgr)
        if glyph is None:
            return raw_rank, conf

        # 1. Matching con biblioteca de aprendizaje activo
        best_match_rank = None
        best_match_score = -1.0
        for r, tmpls in self.learned_templates.items():
            for t in tmpls:
                res = cv2.matchTemplate(glyph, t, cv2.TM_CCOEFF_NORMED)
                score = float(res[0][0])
                if score > best_match_score:
                    best_match_score = score
                    best_match_rank = r

        if best_match_score >= 0.80 and best_match_rank is not None:
            return best_match_rank, max(conf, round(best_match_score, 2))

        # 2. Análisis topológico y pips interiores para desambiguación precisa
        pips = count_card_pips(card_bgr)
        h_g, w_g = glyph.shape
        base_strip = glyph[int(h_g * 0.78):, :]
        base_span = np.sum(np.any(base_strip > 128, axis=0)) / float(w_g)

        # Caso A: 5 vs AS (un As tiene 1 solo pip central, el 5 tiene 5 pips)
        if raw_rank in ['5', 'AS', 'A']:
            if pips >= 4:
                return '5', max(conf, 0.78)
            elif pips <= 2:
                return 'AS', max(conf, 0.78)

        # Caso B: 2 vs 4 (el 2 tiene base inferior horizontal > 48%; el 4 tiene tallo vertical derecho)
        if raw_rank in ['2', '4']:
            if base_span > 0.48 or (1 <= pips <= 3):
                return '2', max(conf, 0.78)
            elif base_span < 0.35 or pips >= 4:
                return '4', max(conf, 0.78)

        # Caso C: 5 vs 7 (el 5 tiene bucle inferior izquierdo; el 7 es diagonal simple sin bucle)
        if raw_rank in ['5', '7']:
            bot_left = glyph[int(h_g * 0.60):, :w_g // 2]
            if np.mean(bot_left > 128) > 0.08 or (4 <= pips <= 6):
                return '5', max(conf, 0.78)
            elif pips >= 7:
                return '7', max(conf, 0.78)

        # Caso D: 10 vs 7 (un 10 tiene 2 caracteres '1' y '0', ancho total > 62% o >= 9 pips)
        if raw_rank in ['7', '10']:
            span = np.sum(np.any(glyph > 128, axis=0)) / float(w_g)
            if span > 0.62 or pips >= 8:
                return '10', max(conf, 0.82)

        return raw_rank, conf

class MesaTemporalCardStabilizer:
    """
    Rastreador Temporal de Cartas por Mesa:
    - Agrupa observaciones por proximidad geométrica (dx, dy)
    - Vota por mayoría ponderada de confianza a lo largo de fotogramas
    - Elimina parpadeos momentáneos por reflejos de luz o manos de clientes
    """
    def __init__(self):
        self.tracks = {}

    def update(self, mesa_uuid, detected_cards, now_ts):
        mesa_tracks = self.tracks.setdefault(mesa_uuid, [])
        # Purgar tracks expirados (> 2.5s)
        mesa_tracks = [t for t in mesa_tracks if (now_ts - t['last_seen']) < 2.5]

        updated_cards = []
        for c in detected_cards:
            cx, cy = c['cx'], c['cy']
            val = c['val']
            conf = c['conf']

            best_track = None
            min_dist = 60.0
            for t in mesa_tracks:
                dist = np.hypot(t['cx'] - cx, t['cy'] - cy)
                if dist < min_dist:
                    min_dist = dist
                    best_track = t

            if best_track is not None:
                best_track['cx'] = cx
                best_track['cy'] = cy
                best_track['box'] = c['box']
                best_track['last_seen'] = now_ts
                best_track['history'].append((val, conf))
                if len(best_track['history']) > 8:
                    best_track['history'].pop(0)

                votes = {}
                for v_name, v_conf in best_track['history']:
                    votes[v_name] = votes.get(v_name, 0.0) + v_conf
                stable_val = max(votes.items(), key=lambda x: x[1])[0]
                best_track['stable_rank'] = stable_val

                c_copy = dict(c)
                c_copy['val'] = stable_val
                updated_cards.append(c_copy)
            else:
                new_track = {
                    'cx': cx,
                    'cy': cy,
                    'box': c['box'],
                    'history': [(val, conf)],
                    'stable_rank': val,
                    'last_seen': now_ts
                }
                mesa_tracks.append(new_track)
                updated_cards.append(c)

        self.tracks[mesa_uuid] = mesa_tracks
        return updated_cards

def partition_baccarat_hands(raw_cards, w_f):
    """
    Partición Espacial Dinámica e Inteligente para Baccarat (Punto y Banca):
    - BANCA se ubica a la izquierda (menor cx).
    - PUNTO se ubica a la derecha (mayor cx).
    - Utiliza agrupamiento espacial 1D (clustering por distancia entre naipes).
    - Si solo hay 1 grupo (ej: 2 cartas en Punto o 2 cartas en Banca), asigna TODO el grupo al lado correspondiente.
      NUNCA JAMÁS divide arbitrariamente una sola mano de 2 cartas entre Banca y Punto.
    - Máximo 3 cartas por bando (reglas oficiales de Baccarat).
    """
    count = len(raw_cards)
    if count == 0:
        return [], []

    cards_sorted = sorted(raw_cards, key=lambda c: c['cx'])
    divider_x = w_f * 0.475

    if count >= 6:
        return cards_sorted[:3], cards_sorted[3:6]

    intra_hand_threshold = 0.058 * w_f
    clusters = []
    curr_cluster = [cards_sorted[0]]
    for i in range(1, count):
        gap = cards_sorted[i]['cx'] - cards_sorted[i-1]['cx']
        if gap < intra_hand_threshold:
            curr_cluster.append(cards_sorted[i])
        else:
            clusters.append(curr_cluster)
            curr_cluster = [cards_sorted[i]]
    clusters.append(curr_cluster)

    banca = []
    punto = []

    for cluster in clusters:
        cluster_cx = sum(c['cx'] for c in cluster) / float(len(cluster))
        if cluster_cx < divider_x:
            banca.extend(cluster)
        else:
            punto.extend(cluster)

    return banca[:3], punto[:3]

card_rank_verifier = CardRankVerifier(LEARNED_GLYPHS_DIR)
card_temporal_stabilizer = MesaTemporalCardStabilizer()

# ====================================================================
# MOTORES DE REGLAS DE CASINO (BACCARAT, BLACKJACK, POKER)
# ====================================================================

def parse_card_info(val_str):
    """
    Parsea universalmente cualquier detección de carta:
    - 52 cartas con palo ej: '10H', 'AS', 'KD', '7C', 'QC'
    - 14 clases básicas ej: '10', 'AS', 'K', '7'
    - Carta boca abajo: 'BACK'
    """
    raw = str(val_str or '').strip().upper()
    if not raw or 'BACK' in raw:
        return {
            'raw': raw or 'BACK',
            'is_back': True,
            'rank_str': 'BACK',
            'rank_num': 0,
            'suit': None,
            'suit_symbol': '',
            'baccarat_val': None,
            'blackjack_val': None,
            'display': '🂠 [CUBIERTA]'
        }

    suit = None
    suit_symbol = ''
    # Si termina en C (Trébol), D (Diamante), H (Corazón), S (Pica)
    if len(raw) >= 2 and raw[-1] in ['C', 'D', 'H', 'S']:
        suit = raw[-1]
        suit_symbol = {'C': '♣', 'D': '♦', 'H': '♥', 'S': '♠'}.get(suit, '')
        core = raw[:-1]
    else:
        core = raw

    if core in ['A', 'AS']:
        rank_str = 'A'
        rank_num = 14
        baccarat_val = 1
        blackjack_val = 11
    elif core == 'K':
        rank_str = 'K'
        rank_num = 13
        baccarat_val = 0
        blackjack_val = 10
    elif core == 'Q':
        rank_str = 'Q'
        rank_num = 12
        baccarat_val = 0
        blackjack_val = 10
    elif core == 'J':
        rank_str = 'J'
        rank_num = 11
        baccarat_val = 0
        blackjack_val = 10
    elif core == '10':
        rank_str = '10'
        rank_num = 10
        baccarat_val = 0
        blackjack_val = 10
    else:
        digits = ''.join(c for c in core if c.isdigit())
        num = int(digits) if digits else 0
        rank_str = str(num) if num else core
        rank_num = num
        baccarat_val = num % 10
        blackjack_val = num

    return {
        'raw': raw,
        'is_back': False,
        'rank_str': rank_str,
        'rank_num': rank_num,
        'suit': suit,
        'suit_symbol': suit_symbol,
        'baccarat_val': baccarat_val,
        'blackjack_val': blackjack_val,
        'display': f"{rank_str}{suit_symbol}"
    }

def motor_baccarat(punto_cards, banca_cards):
    """
    Reglas oficiales de Punto y Banca / Baccarat internacional.
    En Baccarat NUNCA puede haber más de 3 cartas por bando (máximo 6 cartas en total).
    """
    punto_cards = punto_cards[:3]
    banca_cards = banca_cards[:3]

    def sum_bac(cards):
        tot = 0
        for c in cards:
            parsed = parse_card_info(c.get('val', ''))
            v = parsed.get('baccarat_val')
            if v is not None:
                tot += v
        return tot % 10

    sP = sum_bac(punto_cards)
    sB = sum_bac(banca_cards)
    nP = len(punto_cards)
    nB = len(banca_cards)

    if nP == 0 and nB == 0:
        return {
            "win": "SIN JUGADA",
            "scoreP": 0,
            "scoreB": 0,
            "listo": False,
            "natural": False,
            "tipo_evento": "JUGADA",
            "descripcion": "Mesa despejada (Sin jugada activa)"
        }

    # Verificar si alguna carta aún está boca abajo (cliente ligando o squeeze)
    has_back = any(parse_card_info(c.get('val', '')).get('is_back') for c in (punto_cards + banca_cards))
    if has_back:
        return {
            "win": "LIGANDO",
            "scoreP": sP,
            "scoreB": sB,
            "listo": False,
            "natural": False,
            "tipo_evento": "JUGADA",
            "descripcion": f"Ligando cartas ({nP} Punto, {nB} Banca descubiertas)"
        }

    if nP < 2 or nB < 2:
        return {
            "win": "REPARTIENDO",
            "scoreP": sP,
            "scoreB": sB,
            "listo": False,
            "natural": False,
            "tipo_evento": "JUGADA",
            "descripcion": f"Repartiendo cartas ({nP} Punto, {nB} Banca)"
        }

    # Natural 8 o 9 (Termina de inmediato al recibir 2 cartas cada lado)
    if (nP == 2 and nB == 2) and (sP >= 8 or sB >= 8):
        ganador = "BANCA" if sB > sP else ("PUNTO" if sP > sB else "EMPATE (TIE)")
        return {
            "win": ganador,
            "scoreP": sP,
            "scoreB": sB,
            "listo": True,
            "natural": True,
            "tipo_evento": "JUGADA",
            "descripcion": f"Natural ({sB} a {sP})",
            "puestos_detalle": {
                "ganador": ganador,
                "puestos": [1, 2, 3, 5, 6, 7],
                "banca_resultado": "GANA (Pago 1:1, comisión 5%)" if ganador == "BANCA" else ("EMPATE / PUSH" if "EMPATE" in ganador else "PIERDE"),
                "punto_resultado": "GANA (Pago 1:1)" if ganador == "PUNTO" else ("EMPATE / PUSH" if "EMPATE" in ganador else "PIERDE"),
                "tie_resultado": "GANA (Pago 8:1)" if "EMPATE" in ganador else "PIERDE"
            }
        }

    pideP = (sP <= 5)
    pideB = False

    # Regla de Tercera Carta Oficial de Baccarat
    if not pideP:
        if sB <= 5:
            pideB = True
    elif nP >= 3:
        p3 = parse_card_info(punto_cards[2].get('val', ''))
        v3P = p3.get('baccarat_val', 0) if p3.get('baccarat_val') is not None else 0
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
    terminado = (nP >= esperaP) and (nB >= esperaB)

    # Si ambas manos ya tienen 2 cartas y ambas plantan (ej: 6 y 7, o 6 y 6)
    if (nP == 2 and nB == 2) and (not pideP and not pideB):
        terminado = True

    ganador = "BANCA" if sB > sP else ("PUNTO" if sP > sB else "EMPATE (TIE)")
    return {
        "win": ganador,
        "scoreP": sP,
        "scoreB": sB,
        "listo": terminado,
        "natural": False,
        "tipo_evento": "JUGADA",
        "descripcion": f"Banca: {sB} vs Punto: {sP}",
        "puestos_detalle": {
            "ganador": ganador,
            "puestos": [1, 2, 3, 5, 6, 7],
            "banca_resultado": "GANA (Pago 1:1, comisión 5%)" if ganador == "BANCA" else ("EMPATE / PUSH" if "EMPATE" in ganador else "PIERDE"),
            "punto_resultado": "GANA (Pago 1:1)" if ganador == "PUNTO" else ("EMPATE / PUSH" if "EMPATE" in ganador else "PIERDE"),
            "tie_resultado": "GANA (Pago 8:1)" if "EMPATE" in ganador else "PIERDE"
        }
    }

def motor_blackjack(jugador_cards, dealer_cards):
    def sum_bj(cards):
        tot = 0
        aces = 0
        for c in cards:
            parsed = parse_card_info(c.get('val', ''))
            v = parsed.get('blackjack_val')
            if v == 11:
                aces += 1
            elif v is not None:
                tot += v
        for _ in range(aces):
            if tot + 11 <= 21:
                tot += 11
            else:
                tot += 1
        return tot

    if not jugador_cards and not dealer_cards:
        return {
            "win": "SIN JUGADA",
            "scoreP": 0,
            "scoreB": 0,
            "listo": False,
            "tipo_evento": "JUGADA",
            "descripcion": "Mesa despejada (Sin jugada activa)"
        }

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
        "tipo_evento": "JUGADA",
        "descripcion": f"Jugador: {sJ} vs Dealer: {sD}"
    }

def resolve_game_type(mesa_nombre, juego_nombre):
    """
    Resuelve con precisión el juego analizando tanto el nombre de la mesa (ej: TXB 1, RA 1, PK 3, PB 1)
    como la categoría asignada en base de datos.
    """
    m_name = (mesa_nombre or '').upper().strip()
    j_name = (juego_nombre or '').upper().strip()
    txt = f"{m_name} {j_name}"

    # 1. Ruleta Americana (RA 1, RA 2, RULETA, ROULETTE)
    if m_name.startswith('RA') or m_name.startswith('RT') or any(k in txt for k in ['RULETA', 'ROULETTE']):
        return 'RULETA'

    # 2. Texas Hold'em Bonus (TXB 1, TX 1, TEXAS, HOLDEM, BONUS) - ¡NO confundir con Poker Caribeño!
    if m_name.startswith('TX') or m_name.startswith('TB') or any(k in txt for k in ['TEXAS', 'HOLDEM', 'TXB']):
        return 'TEXAS_BONUS'
    if 'BONUS' in txt and not any(k in txt for k in ['BACCARAT', 'PB']):
        return 'TEXAS_BONUS'

    # 3. Poker Caribeño (PK 3, POKER, CARIBE, STUD) - Sólo si no es Texas
    if m_name.startswith('PK') or any(k in txt for k in ['CARIBE', 'STUD']):
        return 'POKER_CARIBENO'
    if 'POKER' in txt and not any(k in txt for k in ['TEXAS', 'HOLDEM', 'TXB']):
        return 'POKER_CARIBENO'

    # 4. Blackjack (BJ 1, BLACKJACK, 21)
    if m_name.startswith('BJ') or any(k in txt for k in ['BLACKJACK', '21']):
        return 'BLACKJACK'

    # 5. Baccarat (PB 1, PB 2, BACCARAT, PUNTO, BANCA)
    if m_name.startswith('PB') or any(k in txt for k in ['BACCARAT', 'PUNTO', 'BANCA']):
        return 'BACCARAT'

    # Fallback por nombre configurado explícito
    if 'RULETA' in j_name or 'ROULETTE' in j_name:
        return 'RULETA'
    if 'TEXAS' in j_name or 'BONUS' in j_name:
        return 'TEXAS_BONUS'
    if 'POKER' in j_name or 'CARIBE' in j_name:
        return 'POKER_CARIBENO'
    if 'BLACKJACK' in j_name:
        return 'BLACKJACK'
    return 'BACCARAT'

def motor_poker_caribeno(cards):
    """
    Reglas oficiales de Poker Caribeño (Caribbean Stud Poker).
    Evalúa las 5 cartas de la Casa (Dealer) con Rango y Figura (Palo/Pinta):
      - Flor Imperial (Royal Flush): 100:1
      - Escalera de Color (Straight Flush): 50:1
      - Poker (Four of a Kind): 20:1
      - Full House: 7:1
      - Color (Flush): 5:1
      - Escalera (Straight): 4:1
      - Trío (Three of a Kind): 3:1
      - Doble Par (Two Pair): 2:1
      - Par (One Pair): 1:1
      - As y Rey (Calificación mínima): 1:1
      - Menor a As-Rey: NO CALIFICA (Paga Ante 1:1, Subida Push)
    """
    parsed = [parse_card_info(c.get('val')) for c in cards]
    up_cards = [c for c in parsed if not c['is_back']]
    back_cards = [c for c in parsed if c['is_back']]

    if len(cards) == 0:
        return {
            "win": "SIN JUGADA",
            "califica": None,
            "jugada": "",
            "listo": False,
            "tipo_evento": "JUGADA",
            "descripcion": "Mesa despejada (Sin jugada activa)"
        }

    if len(cards) < 5 or len(back_cards) > 0:
        up_display = [c['display'] for c in up_cards]
        return {
            "win": "REPARTIENDO",
            "califica": None,
            "jugada": f"Dealer muestra: {', '.join(up_display)}" if up_display else "Cartas en proceso",
            "listo": False,
            "tipo_evento": "JUGADA",
            "descripcion": f"Repartiendo ({len(up_cards)} descubiertas, {len(back_cards)} cubiertas)"
        }

    ranks = [c['rank_num'] for c in up_cards if c['rank_num'] > 0]
    suits = [c['suit'] for c in up_cards if c['suit'] is not None]

    if len(ranks) < 5:
        return {
            "win": "MANO_EN_PROCESO",
            "califica": False,
            "jugada": "Alineando cartas del Dealer",
            "listo": False,
            "tipo_evento": "JUGADA",
            "descripcion": f"{len(ranks)} de 5 cartas identificadas"
        }

    ranks.sort(reverse=True)
    counts = {}
    for r in ranks:
        counts[r] = counts.get(r, 0) + 1
    freqs = sorted(counts.items(), key=lambda x: (x[1], x[0]), reverse=True)

    rank_names = {14: 'As', 13: 'K', 12: 'Q', 11: 'J', 10: '10', 9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2'}

    # ¿Es color? (5 cartas con palo conocido y todas del mismo palo)
    is_flush = (len(suits) == 5 and len(set(suits)) == 1)

    # ¿Es escalera?
    is_straight = False
    if len(set(ranks)) == 5:
        if ranks[0] - ranks[4] == 4:
            is_straight = True
        elif ranks == [14, 5, 4, 3, 2]: # Escalera rueda (Wheel A-2-3-4-5)
            is_straight = True

    jugada = ""
    califica = False
    pago = ""

    # Jerarquía estricta de Poker Caribeño
    if is_flush and is_straight and ranks[0] == 14 and ranks[1] == 13:
        suit_sym = up_cards[0].get('suit_symbol', '')
        jugada = f"Flor Imperial {suit_sym} (Royal Flush)"
        califica = True
        pago = "Paga 100:1"
    elif is_flush and is_straight:
        suit_sym = up_cards[0].get('suit_symbol', '')
        jugada = f"Escalera de Color {suit_sym} al {rank_names.get(ranks[0])}"
        califica = True
        pago = "Paga 50:1"
    elif freqs[0][1] == 4:
        jugada = f"Póker de {rank_names.get(freqs[0][0])}"
        califica = True
        pago = "Paga 20:1"
    elif freqs[0][1] == 3 and freqs[1][1] == 2:
        jugada = f"Full House ({rank_names.get(freqs[0][0])} y {rank_names.get(freqs[1][0])})"
        califica = True
        pago = "Paga 7:1"
    elif is_flush:
        suit_sym = up_cards[0].get('suit_symbol', '')
        jugada = f"Color {suit_sym} (Flush al {rank_names.get(ranks[0])})"
        califica = True
        pago = "Paga 5:1"
    elif is_straight:
        jugada = f"Escalera al {rank_names.get(ranks[0])}"
        califica = True
        pago = "Paga 4:1"
    elif freqs[0][1] == 3:
        jugada = f"Trío de {rank_names.get(freqs[0][0])}"
        califica = True
        pago = "Paga 3:1"
    elif freqs[0][1] == 2 and freqs[1][1] == 2:
        jugada = f"Doble Par ({rank_names.get(freqs[0][0])} y {rank_names.get(freqs[1][0])})"
        califica = True
        pago = "Paga 2:1"
    elif freqs[0][1] == 2:
        jugada = f"Par de {rank_names.get(freqs[0][0])}"
        califica = True
        pago = "Paga 1:1"
    else:
        has_ace = 14 in ranks
        has_king = 13 in ranks
        if has_ace and has_king:
            jugada = f"As y Rey ({rank_names.get(ranks[2])} kicker)"
            califica = True
            pago = "Paga 1:1"
        else:
            jugada = f"{rank_names.get(ranks[0])} Mayor"
            califica = False
            pago = "No Califica (Paga Ante 1:1)"

    estado_ganador = "CASA CALIFICA" if califica else "CASA NO CALIFICA"
    return {
        "win": estado_ganador,
        "califica": califica,
        "jugada": jugada,
        "pago": pago,
        "listo": True,
        "tipo_evento": "JUGADA",
        "descripcion": f"{estado_ganador}: {jugada} ({pago})"
    }

def motor_texas_bonus(cards):
    """
    Reglas oficiales de Texas Hold'em Bonus:
    - Evalúa las cartas comunitarias (Flop, Turn, River) y de jugadores/dealer.
    - Croupier califica con al menos UN PAR:
      'ANTE EMPUJA SI EL CROUPIER TIENE MENOS DE UN PAR'
    - Tabla de Pagos de Bonus TRIPS en paño:
      Escalera Real (50:1), Escalera de Color (40:1), Póker (30:1),
      Full House (8:1), Color (7:1), Escalera (4:1), Trío (3:1)
    """
    if len(cards) == 0:
        return {
            "win": "SIN JUGADA",
            "califica": None,
            "jugada": "",
            "listo": False,
            "tipo_evento": "JUGADA",
            "descripcion": "Mesa despejada (Sin jugada activa)"
        }

    parsed = [parse_card_info(c.get('val')) for c in cards]
    up_cards = [c for c in parsed if not c['is_back']]

    if len(up_cards) < 2:
        return {
            "win": "REPARTIENDO",
            "califica": None,
            "jugada": "Iniciando mano",
            "listo": False,
            "tipo_evento": "JUGADA",
            "descripcion": f"Repartiendo cartas iniciales ({len(cards)} en paño)"
        }

    import itertools
    rank_names = {14: 'As', 13: 'K', 12: 'Q', 11: 'J', 10: '10', 9: '9', 8: '8', 7: '7', 6: '6', 5: '5', 4: '4', 3: '3', 2: '2'}

    # Si hay entre 2 y 4 cartas: fase inicial
    if len(up_cards) < 5:
        ranks = sorted([c['rank_num'] for c in up_cards if c['rank_num'] > 0], reverse=True)
        counts = {}
        for r in ranks: counts[r] = counts.get(r, 0) + 1
        freqs = sorted(counts.items(), key=lambda x: (x[1], x[0]), reverse=True)
        has_pair = freqs and freqs[0][1] >= 2
        jugada_parcial = f"Par de {rank_names.get(freqs[0][0])}" if has_pair else f"{rank_names.get(ranks[0]) if ranks else ''} Mayor"
        return {
            "win": "REPARTIENDO",
            "califica": has_pair,
            "jugada": jugada_parcial,
            "listo": False,
            "tipo_evento": "JUGADA",
            "descripcion": f"Fase de apuestas ({len(up_cards)} cartas descubiertas)"
        }

    # Con 5 o más cartas (hasta 7)
    comb_source = up_cards[:7]
    best_score = (-1,)
    best_jugada = ""
    best_pago = ""
    best_califica = False

    for comb in itertools.combinations(comb_source, min(5, len(comb_source))):
        c_ranks = sorted([c['rank_num'] for c in comb if c['rank_num'] > 0], reverse=True)
        c_suits = [c['suit'] for c in comb if c['suit'] is not None]
        if len(c_ranks) < 5:
            continue
        c_counts = {}
        for r in c_ranks: c_counts[r] = c_counts.get(r, 0) + 1
        c_freqs = sorted(c_counts.items(), key=lambda x: (x[1], x[0]), reverse=True)

        is_flush = (len(c_suits) == 5 and len(set(c_suits)) == 1)
        is_straight = False
        if len(set(c_ranks)) == 5:
            if c_ranks[0] - c_ranks[4] == 4: is_straight = True
            elif c_ranks == [14, 5, 4, 3, 2]: is_straight = True

        score = (0,)
        jugada = ""
        pago = ""
        califica = True

        if is_flush and is_straight and c_ranks[0] == 14 and c_ranks[1] == 13:
            score = (9, 14)
            jugada = "Flor Imperial (Royal Flush)"
            pago = "Trips: 50:1"
        elif is_flush and is_straight:
            score = (8, c_ranks[0])
            jugada = f"Escalera de Color al {rank_names.get(c_ranks[0])}"
            pago = "Trips: 40:1"
        elif c_freqs[0][1] == 4:
            score = (7, c_freqs[0][0], c_freqs[1][0])
            jugada = f"Póker de {rank_names.get(c_freqs[0][0])}"
            pago = "Trips: 30:1"
        elif c_freqs[0][1] == 3 and c_freqs[1][1] == 2:
            score = (6, c_freqs[0][0], c_freqs[1][0])
            jugada = f"Full House ({rank_names.get(c_freqs[0][0])} y {rank_names.get(c_freqs[1][0])})"
            pago = "Trips: 8:1"
        elif is_flush:
            score = (5, c_ranks)
            jugada = f"Color (Flush al {rank_names.get(c_ranks[0])})"
            pago = "Trips: 7:1"
        elif is_straight:
            score = (4, c_ranks[0])
            jugada = f"Escalera al {rank_names.get(c_ranks[0])}"
            pago = "Trips: 4:1"
        elif c_freqs[0][1] == 3:
            score = (3, c_freqs[0][0], [x[0] for x in c_freqs[1:]])
            jugada = f"Trío de {rank_names.get(c_freqs[0][0])}"
            pago = "Trips: 3:1"
        elif c_freqs[0][1] == 2 and c_freqs[1][1] == 2:
            score = (2, c_freqs[0][0], c_freqs[1][0], c_freqs[2][0])
            jugada = f"Doble Par ({rank_names.get(c_freqs[0][0])} y {rank_names.get(c_freqs[1][0])})"
        elif c_freqs[0][1] == 2:
            score = (1, c_freqs[0][0], [x[0] for x in c_freqs[1:]])
            jugada = f"Par de {rank_names.get(c_freqs[0][0])}"
        else:
            score = (0, c_ranks)
            jugada = f"{rank_names.get(c_ranks[0])} Mayor"
            califica = False  # Ante empuja si croupier < 1 par

        if score > best_score:
            best_score = score
            best_jugada = jugada
            best_pago = pago
            best_califica = califica

    if not best_jugada:
        best_jugada = "Evaluando mesa"
        best_califica = False

    estado_win = "CALIFICA (≥ 1 PAR)" if best_califica else "NO CALIFICA (< 1 PAR • ANTE EMPUJA)"
    return {
        "win": estado_win,
        "califica": best_califica,
        "jugada": best_jugada,
        "pago": best_pago,
        "listo": len(up_cards) >= 5,
        "tipo_evento": "JUGADA",
        "descripcion": f"{best_jugada} • {estado_win} {f'({best_pago})' if best_pago else ''}"
    }

def motor_ruleta():
    """
    Ruleta Americana (American Roulette con 0, 00 y 36 números).
    No utiliza cartas. Monitorea actividad de paño y cilindro.
    """
    return {
        "win": "SIN JUGADA",
        "califica": None,
        "jugada": "Ruleta Americana",
        "listo": False,
        "tipo_evento": "MONITOREO",
        "descripcion": "Cilindro y paño de Ruleta Americana activo"
    }

# ====================================================================
# WORKER RTSP MULTIHILO POR CÁMARA
# ====================================================================

def fetch_isapi_frame(ip, canal, usuario, clave):
    try:
        url = f"http://{ip}/ISAPI/Streaming/channels/{canal}01/picture"
        r = requests.get(url, auth=HTTPDigestAuth(usuario, clave), timeout=1.8)
        if r.status_code == 200 and len(r.content) > 1000:
            arr = np.frombuffer(r.content, np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if img is not None and img.size > 0:
                return img
    except Exception:
        pass
    return None

def check_rtsp_port_open(ip, port=554, timeout=0.6):
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(timeout)
        s.connect((ip, int(port)))
        s.close()
        return True
    except Exception:
        return False

def stream_worker(mesa_uuid, url_rtsp):
    cfg_init = mesas_config.get(mesa_uuid, {})
    m_name = cfg_init.get('nombre', 'Mesa')
    if mesa_uuid not in live_jpeg_buffers:
        live_jpeg_buffers[mesa_uuid] = make_placeholder_frame(m_name, "Iniciando señal...")
    print(f"📹 [Stream Worker RTSP 554] Iniciando flujo continuo en {mesa_uuid}: {url_rtsp}")
    cap = None
    consecutive_failures = 0
    last_reconnect_attempt = 0

    def conectar_rtsp():
        nonlocal cap, consecutive_failures, last_reconnect_attempt
        if cap:
            try: cap.release()
            except Exception: pass
            cap = None

        cfg = mesas_config.get(mesa_uuid, {})
        ip_chk = cfg.get('ip')
        if ip_chk and not check_rtsp_port_open(ip_chk, 554, timeout=0.6):
            estado_stream[mesa_uuid] = 'desconectado'
            live_jpeg_buffers[mesa_uuid] = make_placeholder_frame(m_name, f"IP {ip_chk} inaccesible en red LAN local")
            last_reconnect_attempt = time.time()
            return False

        try:
            c = cv2.VideoCapture(url_rtsp, cv2.CAP_FFMPEG)
            c.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            if c.isOpened():
                cap = c
                consecutive_failures = 0
                last_reconnect_attempt = time.time()
                estado_stream[mesa_uuid] = 'activo'
                return True
        except Exception as e_c:
            print(f"⚠️ [Stream Worker] Error abriendo RTSP {mesa_uuid}: {e_c}")
        return False

    conectar_rtsp()

    while True:
        if mesa_uuid not in mesas_config:
            if cap:
                try: cap.release()
                except Exception: pass
            break

        # Atención inmediata a solicitud de refresco manual
        if mesa_uuid in reconnect_requests:
            reconnect_requests.discard(mesa_uuid)
            print(f"🔄 [Stream Worker] Reconexión manual forzada para {m_name}...")
            live_jpeg_buffers[mesa_uuid] = make_placeholder_frame(m_name, "Reconectando cámara...")
            conectar_rtsp()
            time.sleep(0.1)
            continue

        cfg = mesas_config.get(mesa_uuid, {})
        ip = cfg.get('ip')
        canal = cfg.get('canal')
        usuario = cfg.get('usuario') or 'admin'
        clave = cfg.get('clave') or ''

        frame = None
        ret = False

        if cap and cap.isOpened():
            try:
                ret, frame = cap.read()
            except Exception:
                ret = False

        if ret and frame is not None and frame.size > 0:
            consecutive_failures = 0
            frames_actuales[mesa_uuid] = frame
            estado_stream[mesa_uuid] = 'activo'

            # Generar fotograma continuo en vivo (~25 FPS) para MJPEG con overlay IA en tiempo real
            try:
                hp, wp = frame.shape[:2]
                target_w = 704
                target_h = max(10, int(hp * (target_w / float(wp))))
                disp_frame = cv2.resize(frame, (target_w, target_h), interpolation=cv2.INTER_CUBIC)

                ann = live_annotations.get(mesa_uuid)
                if ann:
                    cards = ann.get('cards', [])
                    for c in cards:
                        if c.get('norm_box'):
                            nb = c['norm_box']
                            b = [int(nb[0] * target_w), int(nb[1] * target_h), int(nb[2] * target_w), int(nb[3] * target_h)]
                        else:
                            b = [int(v * (target_w / float(wp))) for v in c.get('box', [])]

                        if len(b) == 4:
                            val_str = str(c.get('val', '')).strip()
                            zone = c.get('zone', '')
                            # Color por zona / rol
                            if zone == 'banca':
                                col = (60, 60, 255) # Rojo Banca
                            elif zone == 'punto':
                                col = (255, 170, 0) # Cyan Punto
                            elif zone == 'dealer':
                                col = (0, 215, 255) # Oro Dealer
                            else:
                                col = (0, 255, 120) # Verde Jugador / Mano

                            cv2.rectangle(disp_frame, (b[0], b[1]), (b[2], b[3]), col, 2)

                            font = cv2.FONT_HERSHEY_SIMPLEX
                            f_scale = 0.65
                            f_thick = 2
                            (tw, th), _ = cv2.getTextSize(val_str, font, f_scale, f_thick)
                            badge_y2 = max(th + 8, b[1])
                            badge_y1 = badge_y2 - th - 8
                            cv2.rectangle(disp_frame, (b[0], badge_y1), (b[0] + tw + 10, badge_y2), col, -1)
                            cv2.putText(disp_frame, val_str, (b[0] + 5, badge_y2 - 5), font, f_scale, (0, 0, 0), f_thick, cv2.LINE_AA)

                    # Si hay cintas de cartas desplegadas (Presentación de Mazo)
                    for rb in ann.get('ribbons', []):
                        r_norm = [int(rb[0] * (target_w / float(wp))), int(rb[1] * (target_h / float(hp))),
                                  int(rb[2] * (target_w / float(wp))), int(rb[3] * (target_h / float(hp)))]
                        cv2.rectangle(disp_frame, (r_norm[0], r_norm[1]), (r_norm[2], r_norm[3]), (255, 200, 0), 2)
                        cv2.putText(disp_frame, "CARTAS DESPLEGADAS", (r_norm[0] + 6, max(22, r_norm[1] - 6)),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 200, 0), 2, cv2.LINE_AA)

                    # Si hay presentación de fichas de banca
                    for cb in ann.get('chips', []):
                        c_norm = [int(cb[0] * (target_w / float(wp))), int(cb[1] * (target_h / float(hp))),
                                  int(cb[2] * (target_w / float(wp))), int(cb[3] * (target_h / float(hp)))]
                        cv2.rectangle(disp_frame, (c_norm[0], c_norm[1]), (c_norm[2], c_norm[3]), (0, 215, 255), 2)

                    # Indicador de estado LIGANDO (Squeeze de cartas)
                    if ann.get('estado_mesa') == 'LIGANDO_CARTAS':
                        cv2.rectangle(disp_frame, (int(target_w * 0.25), 10), (int(target_w * 0.75), 42), (255, 170, 0), -1)
                        cv2.putText(disp_frame, "LIGANDO CARTAS (CLIENTE SQUEEZE)", (int(target_w * 0.26), 33),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.58, (0, 0, 0), 2, cv2.LINE_AA)

                # Indicador inferior sutil de puestos y pagos (Puestos 1..N de Izquierda a Derecha, Pagos <-- Derecha a Izquierda)
                cv2.putText(disp_frame, "PUESTOS 1-7  |  PAGOS: 7 -> 1 <--", (15, target_h - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.42, (180, 200, 220), 1, cv2.LINE_AA)

                _, buf = cv2.imencode('.jpg', disp_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
                live_jpeg_buffers[mesa_uuid] = buf.tobytes()
            except Exception:
                pass

            time.sleep(0.015)
        else:
            consecutive_failures += 1

            if consecutive_failures >= 4 and ip and canal:
                snap = fetch_isapi_frame(ip, canal, usuario, clave)
                if snap is not None and snap.size > 0:
                    frames_actuales[mesa_uuid] = snap
                    estado_stream[mesa_uuid] = 'activo'

            now = time.time()
            if (consecutive_failures >= 10 or not cap or not cap.isOpened()) and (now - last_reconnect_attempt > 20.0):
                last_reconnect_attempt = now
                consecutive_failures = 0
                if conectar_rtsp():
                    print(f"✅ [Stream Worker] Flujo RTSP conectado para {cfg.get('nombre', mesa_uuid)}")

            time.sleep(0.08)

# ====================================================================
# BUCLE DE INFERENCIA CONTINUA IA + REGLAS DE JUEGO
# ====================================================================

# ====================================================================
# DETECCIÓN DE PRESENTACIÓN DE BANCA (ARQUEO / INVENTARIO DE FICHAS)
# ====================================================================

banca_presentation_memory = {}

def detectar_fichas_banca(frame, tipo_juego='BACCARAT'):
    """
    Retorna False para evitar falsos positivos de líneas y tapete en mesas vacías.
    Las mesas vacías se reportan limpiamente como SIN JUGADA (EN ESPERA).
    """
    return False, []

cartas_presentation_memory = {}
barajo_memory = {}

def detectar_presentacion_o_barajo(frame, tipo_juego='BACCARAT', yolo_cards=None):
    """
    Detecta los estados operativos de mesa:
    1. PRESENTANDO CARTAS: Naipes extendidos en abanicos/cintas BOCA ARRIBA para verificar mazo completo.
    2. BARAJO DE CARTAS: Naipes esparcidos BOCA ABAJO por toda la mesa para mezcla/lavado.
    """
    if frame is None or frame.size == 0 or tipo_juego == 'RULETA':
        return False, False, []

    h, w = frame.shape[:2]
    card_count = len(yolo_cards) if yolo_cards else 0

    # 1. Si YOLO detectó 8 o más cartas físicas dispersas:
    if card_count >= 8:
        back_count = sum(1 for c in yolo_cards if 'BACK' in str(c.get('val', '')).upper())
        if back_count >= 6 or (back_count / max(1, card_count)) >= 0.5:
            return False, True, []
        xs = [c['cx'] for c in yolo_cards]
        w_span = max(xs) - min(xs)
        if w_span > w * 0.40:
            return True, False, []

    # 2. Análisis del paño para abanicos/cintas de barajas completas (cuando 6-8 mazos están desplegados):
    # En este estado los naipes se solapan continuamente formando cintas semicirculares con >11% de blanco y gran anchura
    y1, y2 = int(0.20 * h), int(0.75 * h)
    x1, x2 = int(0.15 * w), int(0.85 * w)
    felt = frame[y1:y2, x1:x2]
    if felt.size == 0:
        return False, False, []

    hsv = cv2.cvtColor(felt, cv2.COLOR_BGR2HSV)
    white_mask = (hsv[:,:,1] < 65) & (hsv[:,:,2] > 160)
    white_pct = np.mean(white_mask) * 100

    if white_pct >= 11.0:
        kernel_h = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 5))
        closed = cv2.morphologyEx(white_mask.astype(np.uint8), cv2.MORPH_CLOSE, kernel_h)
        contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        felt_w = felt.shape[1]
        for cnt in contours:
            bx, by, bw, bh = cv2.boundingRect(cnt)
            if (bw / float(felt_w)) >= 0.60 and bh >= 20:
                orig_x1 = x1 + bx
                orig_y1 = y1 + by
                orig_x2 = x1 + bx + bw
                orig_y2 = y1 + by + bh
                return True, False, [[orig_x1, orig_y1, orig_x2, orig_y2]]

    return False, False, []

def calc_box_iou(box1, box2):
    x1, y1 = max(box1[0], box2[0]), max(box1[1], box2[1])
    x2, y2 = min(box1[2], box2[2]), min(box1[3], box2[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    a1 = max(0, box1[2] - box1[0]) * max(0, box1[3] - box1[1])
    a2 = max(0, box2[2] - box2[0]) * max(0, box2[3] - box2[1])
    u = a1 + a2 - inter
    return inter / float(u) if u > 0 else 0.0

def deduplicate_boxes(cards_list):
    filtered = []
    for c in sorted(cards_list, key=lambda x: x['conf'], reverse=True):
        overlap = False
        for fc in filtered:
            iou = calc_box_iou(c['box'], fc['box'])
            center_dist = ((c['cx'] - fc['cx'])**2 + (c['cy'] - fc['cy'])**2)**0.5
            if iou > 0.55 or center_dist < 10:
                overlap = True
                break
        if not overlap:
            filtered.append(c)
    filtered.sort(key=lambda c: c['cx'])
    return filtered

mesa_round_memory = {}
mesa_hand_stability = {}

def ai_inference_loop():
    print("🧠 [AI Inference Loop] Iniciando análisis continuo de mesas...")
    while True:
        for mesa_uuid, cfg in list(mesas_config.items()):
            if estado_stream.get(mesa_uuid) != 'activo':
                continue

            ip = cfg.get('ip')
            canal = cfg.get('canal')
            usuario = cfg.get('usuario') or 'admin'
            clave = cfg.get('clave') or ''

            frame = frames_actuales.get(mesa_uuid)
            if frame is None and ip and canal:
                frame_hd = fetch_isapi_frame(ip, canal, usuario, clave)
                if frame_hd is not None and frame_hd.size > 0:
                    frame = frame_hd

            if frame is None:
                continue

            try:
                # Determinar juego exacto de la mesa
                tipo_juego = resolve_game_type(cfg.get('nombre'), cfg.get('juego'))

                h_f, w_f = frame.shape[:2]

                # 1. CENTRADO DE MESA POR SOFTWARE (ZOOM DIGITAL 1.8X - 2.5X EN EL PAÑO DE CARTAS)
                # En lugar de enviar la vista gran angular completa (con techos, dealer y piso),
                # centramos y recortamos el área activa de juego donde se sitúan las cartas.
                if tipo_juego in ['BACCARAT', 'BLACKJACK', 'POKER_CARIBENO', 'TEXAS_BONUS']:
                    crop_y1 = int(0.14 * h_f)
                    crop_y2 = int(0.82 * h_f)
                    crop_x1 = int(0.10 * w_f)
                    crop_x2 = int(0.90 * w_f)
                else:
                    crop_y1, crop_y2, crop_x1, crop_x2 = 0, h_f, 0, w_f

                crop_roi = frame[crop_y1:crop_y2, crop_x1:crop_x2]
                if crop_roi is None or crop_roi.size == 0:
                    crop_roi = frame
                    crop_y1, crop_y2, crop_x1, crop_x2 = 0, h_f, 0, w_f

                # 2. MÁSCARA DE FILTRO ADAPTATIVO (CLAHE EN ESPACIO LAB)
                # Resalta el blanco de naipes, números y palos (♠ ♥ ♦ ♣) mitigando reflejos de luces
                crop_filtrado = preprocesar_filtro_mesa(crop_roi)
                h_c, w_c = crop_filtrado.shape[:2]

                target_w = min(1440, max(800, w_c))
                infer_scale = target_w / float(w_c)
                infer_frame = cv2.resize(crop_filtrado, (target_w, int(h_c * infer_scale)), interpolation=cv2.INTER_LINEAR)

                with torch.inference_mode():
                    results = model(infer_frame, verbose=False, conf=0.18, iou=0.45, imgsz=960)

                box_scale = 1.0 / infer_scale
                raw_cards = []
                guardar_por_duda = False

                for box in results[0].boxes:
                    cls_id = int(box.cls[0])
                    name = model.names[cls_id].upper()
                    conf = round(float(box.conf[0]), 2)

                    bx1, by1, bx2, by2 = [int(v * box_scale) for v in box.xyxy[0].tolist()]
                    # Mapeo a coordenadas globales absolutas del frame completo
                    gx1 = max(0, min(w_f - 1, crop_x1 + bx1))
                    gy1 = max(0, min(h_f - 1, crop_y1 + by1))
                    gx2 = max(0, min(w_f, crop_x1 + bx2))
                    gy2 = max(0, min(h_f, crop_y1 + by2))
                    cx = (gx1 + gx2) / 2
                    cy = (gy1 + gy2) / 2

                    # Desambiguación y verificación de rango por aprendizaje activo y topología
                    card_crop = frame[gy1:gy2, gx1:gx2]
                    v_name, v_conf = card_rank_verifier.verify_and_disambiguate(card_crop, name, conf)
                    if v_conf >= 0.85 and v_name not in ['BACK', '']:
                        card_rank_verifier.auto_learn(card_crop, v_name, v_conf)

                    if 0.20 <= v_conf <= 0.45:
                        guardar_por_duda = True

                    raw_cards.append({
                        "val": v_name,
                        "box": [gx1, gy1, gx2, gy2],
                        "norm_box": [gx1 / float(w_f), gy1 / float(h_f), gx2 / float(w_f), gy2 / float(h_f)],
                        "cx": cx,
                        "cy": cy,
                        "conf": v_conf
                    })

                # Deduplicación de detecciones nativas y estabilización temporal
                raw_cards = deduplicate_boxes(raw_cards)
                now_ts = time.time()
                raw_cards = card_temporal_stabilizer.update(mesa_uuid, raw_cards, now_ts)

                count = len(raw_cards)
                detections = []
                estado_mesa = "NORMAL"

                now_ts = time.time()
                mem = mesa_round_memory.get(mesa_uuid)

                if count > 0:
                    if not mem or (now_ts - mem.get('last_seen', 0) > 4.0):
                        mesa_round_memory[mesa_uuid] = {
                            'cards': raw_cards,
                            'last_seen': now_ts,
                            'count': count
                        }
                    else:
                        # Si antes teníamos más cartas y de repente disminuyó (ej: brazo del dealer tapando),
                        # retenemos las cartas anteriores durante hasta 2.5 segundos
                        if count < mem.get('count', 0) and (now_ts - mem.get('last_seen', 0) < 2.5):
                            raw_cards = mem['cards']
                            count = len(raw_cards)
                        else:
                            mem['cards'] = raw_cards
                            mem['count'] = count
                            mem['last_seen'] = now_ts
                else:
                    # count == 0: Si la mesa se despejó, limpiar en 1.5s
                    if mem and (now_ts - mem.get('last_seen', 0) < 1.5):
                        raw_cards = mem['cards']
                        count = len(raw_cards)
                    else:
                        mesa_round_memory.pop(mesa_uuid, None)
                        mesa_hand_stability.pop(mesa_uuid, None)

                is_presentando_banca = False
                chip_boxes = []
                is_presentando_cartas = False
                is_barajo_cartas = False
                ribbon_boxes = []

                # Evaluar estados operativos de mesa (Presentación de cartas boca arriba o Barajo boca abajo)
                is_presentando_cartas, is_barajo_cartas, ribbon_boxes = detectar_presentacion_o_barajo(frame, tipo_juego, raw_cards)

                if is_presentando_cartas:
                    estado_mesa = "PRESENTANDO_CARTAS"
                    punto_list = []
                    banca_list = []
                elif is_barajo_cartas or (count > 6 and tipo_juego == 'BACCARAT') or (count >= 8 and tipo_juego != 'POKER_CARIBENO'):
                    estado_mesa = "BARAJO_CARTAS"
                    punto_list = []
                    banca_list = []
                elif count == 0:
                    estado_mesa = "SIN JUGADA"
                    punto_list = []
                    banca_list = []
                else:
                    gaps = [raw_cards[i+1]['cx'] - raw_cards[i]['cx'] for i in range(count - 1)]
                    max_gap = max(gaps) if gaps else 0

                    has_back_detected = any('BACK' in str(c.get('val', '')).upper() for c in raw_cards)

                    if count > 1 and max_gap < 18:
                        estado_mesa = "RECOGIENDO"
                    elif has_back_detected and count >= 2 and tipo_juego == 'BACCARAT':
                        estado_mesa = "LIGANDO_CARTAS"
                    elif count < (5 if tipo_juego == 'POKER_CARIBENO' else 4):
                        estado_mesa = "REPARTIENDO"
                    else:
                        estado_mesa = "NORMAL"

                    if tipo_juego == 'BACCARAT':
                        banca_list, punto_list = partition_baccarat_hands(raw_cards, w_f)
                    else:
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
                elif tipo_juego == 'TEXAS_BONUS':
                    juego_label = "Texas Bonus"
                    resultado = motor_texas_bonus(raw_cards)
                    detalle_mano = resultado.get('jugada', '')
                    for c in raw_cards:
                        detections.append({**c, "zone": "dealer"})

                    live_results[mesa_uuid] = {
                        "mesa_uuid": mesa_uuid,
                        "mesa_nombre": cfg.get('nombre'),
                        "juego": juego_label,
                        "juego_tipo": "TEXAS_BONUS",
                        "estado_mesa": estado_mesa,
                        "resultado": resultado,
                        "dealer_cards": raw_cards,
                        "dealer_jugada": resultado.get('jugada'),
                        "califica": resultado.get('califica'),
                        "detalle": resultado.get('descripcion'),
                        "ganador": resultado.get('win', 'SIN JUGADA'),
                        "scoreP": 0,
                        "scoreB": 0,
                        "punto": [],
                        "banca": [],
                        "image_b64": "",
                        "timestamp": time.time(),
                        "hora": datetime.now().strftime("%H:%M:%S")
                    }
                elif tipo_juego == 'RULETA':
                    juego_label = "Ruleta Americana"
                    resultado = motor_ruleta()
                    live_results[mesa_uuid] = {
                        "mesa_uuid": mesa_uuid,
                        "mesa_nombre": cfg.get('nombre'),
                        "juego": juego_label,
                        "juego_tipo": "RULETA",
                        "estado_mesa": "ESPERA",
                        "resultado": resultado,
                        "dealer_cards": [],
                        "dealer_jugada": "Ruleta Americana (0, 00, 1-36)",
                        "califica": None,
                        "detalle": "Mesa de Ruleta Americana",
                        "ganador": "SIN JUGADA",
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
                        "jugador_cards": punto_list,
                        "dealer_cards": banca_list,
                        "detalle": detalle_mano,
                        "scoreP": resultado.get('scoreP', 0),
                        "scoreB": resultado.get('scoreB', 0),
                        "score_jugador": resultado.get('scoreP', 0),
                        "score_dealer": resultado.get('scoreB', 0),
                        "ganador": resultado.get('win', 'JUGANDO'),
                        "image_b64": "",
                        "timestamp": time.time(),
                        "hora": datetime.now().strftime("%H:%M:%S")
                    }
                else: # BACCARAT
                    juego_label = "Baccarat"
                    resultado = motor_baccarat(punto_list, banca_list)

                    # Estabilidad inteligente y auto-cierre garantizado de mano:
                    nP, nB = len(punto_list), len(banca_list)
                    has_back = any(parse_card_info(c.get('val', '')).get('is_back') for c in (punto_list + banca_list))

                    if has_back or estado_mesa == 'LIGANDO_CARTAS':
                        resultado['win'] = 'LIGANDO CARTAS'
                        resultado['listo'] = False
                    elif nP >= 2 and nB >= 2 and not has_back:
                        # 1. Si es Natural 8 o 9, o si el motor ya lo dio por terminado por reglas oficiales
                        if resultado.get('natural') or resultado.get('listo'):
                            resultado['listo'] = True
                        else:
                            # 2. Estabilidad por puntaje (Score Punto, Score Banca, nP, nB) durante 0.8s
                            score_sig = (resultado.get('scoreP', 0), resultado.get('scoreB', 0), nP, nB)
                            stab = mesa_hand_stability.get(mesa_uuid)
                            if stab and stab.get('sig') == score_sig:
                                if (now_ts - stab.get('since', now_ts) >= 0.8):
                                    resultado['listo'] = True
                            else:
                                mesa_hand_stability[mesa_uuid] = {'sig': score_sig, 'since': now_ts}

                    det_p_str = ', '.join([c['val'] for c in punto_list])
                    det_b_str = ', '.join([c['val'] for c in banca_list])
                    detalle_mano = f"B:[{det_b_str}] P:[{det_p_str}]"
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
                        color = (60, 60, 255) # Coral Red Banca
                    elif zone == "punto":
                        color = (255, 170, 0) # Cyan Punto
                    elif zone == "dealer":
                        color = (0, 215, 255) # Oro Casa / Dealer
                    elif zone == "jugador":
                        color = (0, 255, 120) # Verde Jugador BJ
                    else:
                        color = (0, 255, 120)

                    cv2.rectangle(img_plot, (x1, y1), (x2, y2), color, 3)
                    # Nombre limpio de la carta con badge pill de alta legibilidad
                    label = str(det['val']).strip()
                    font = cv2.FONT_HERSHEY_SIMPLEX
                    f_scale = 0.85
                    f_thick = 2
                    (w, h), _ = cv2.getTextSize(label, font, f_scale, f_thick)
                    top_y = max(h + 12, y1)
                    cv2.rectangle(img_plot, (x1, top_y - h - 10), (x1 + w + 10, top_y), color, -1)
                    cv2.putText(img_plot, label, (x1 + 5, top_y - 5), font, f_scale, (0, 0, 0), f_thick, cv2.LINE_AA)

                # Estados operativos de presentación de cartas, barajo y banca
                live_results[mesa_uuid]["is_presentando_cartas"] = is_presentando_cartas
                live_results[mesa_uuid]["is_barajo_cartas"] = (estado_mesa == "BARAJO_CARTAS")
                live_results[mesa_uuid]["is_presentando_banca"] = is_presentando_banca
                live_results[mesa_uuid]["banca_stacks"] = len(chip_boxes)

                if is_presentando_cartas:
                    live_results[mesa_uuid]["estado_mesa"] = "PRESENTANDO_CARTAS"
                    live_results[mesa_uuid]["ganador"] = "PRESENTANDO CARTAS"
                    live_results[mesa_uuid]["detalle"] = "Inicio de presentación de cartas (Verificación de mazo completo en paño)"

                    if ribbon_boxes:
                        for rb in ribbon_boxes:
                            rx1, ry1, rx2, ry2 = rb
                            cv2.rectangle(img_plot, (rx1, ry1), (rx2, ry2), (255, 200, 0), 2)
                        m_rx = min(b[0] for b in ribbon_boxes)
                        m_ry = min(b[1] for b in ribbon_boxes)
                        m_rx2 = max(b[2] for b in ribbon_boxes)
                        cv2.rectangle(img_plot, (m_rx - 4, max(0, m_ry - 28)), (m_rx2 + 4, max(0, m_ry - 2)), (255, 200, 0), -1)
                        cv2.putText(img_plot, "PRESENTANDO CARTAS (MAZO COMPLETO)", (m_rx + 4, max(18, m_ry - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2, cv2.LINE_AA)

                elif estado_mesa == "BARAJO_CARTAS":
                    live_results[mesa_uuid]["estado_mesa"] = "BARAJO_CARTAS"
                    live_results[mesa_uuid]["ganador"] = "BARAJO DE CARTAS"
                    live_results[mesa_uuid]["detalle"] = "Barajo de cartas (Mezcla y lavado de naipes boca abajo)"
                    cv2.putText(img_plot, "BARAJO DE CARTAS", (int(img_plot.shape[1] * 0.25), int(img_plot.shape[0] * 0.5)), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (255, 0, 255), 3, cv2.LINE_AA)

                elif is_presentando_banca:
                    live_results[mesa_uuid]["estado_mesa"] = "PRESENTANDO_BANCA"
                    live_results[mesa_uuid]["ganador"] = "PRESENTANDO BANCA"
                    live_results[mesa_uuid]["detalle"] = f"Inicio de presentación de banca ({len(chip_boxes)} pilas de fichas en paño)"

                    if chip_boxes:
                        for b in chip_boxes:
                            bx1, by1, bx2, by2 = b
                            cv2.rectangle(img_plot, (bx1, by1), (bx2, by2), (0, 215, 255), 2)
                        min_bx = min(b[0] for b in chip_boxes)
                        min_by = min(b[1] for b in chip_boxes)
                        max_bx = max(b[2] for b in chip_boxes)
                        cv2.rectangle(img_plot, (min_bx - 4, max(0, min_by - 28)), (max_bx + 4, max(0, min_by - 2)), (0, 215, 255), -1)
                        cv2.putText(img_plot, "PRESENTANDO BANCA", (min_bx + 4, max(18, min_by - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2, cv2.LINE_AA)

                # Generar vista previa optimizada para la interfaz y streaming MJPEG continuo
                hp, wp = img_plot.shape[:2]
                target_prev_w = 704 if wp > 704 else wp
                target_prev_h = max(10, int(hp * (target_prev_w / max(1, wp))))
                img_preview = cv2.resize(img_plot, (target_prev_w, target_prev_h), interpolation=cv2.INTER_CUBIC)

                _, buf = cv2.imencode('.jpg', img_preview, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
                jpeg_bytes = buf.tobytes()
                if mesa_uuid not in live_jpeg_buffers:
                    live_jpeg_buffers[mesa_uuid] = jpeg_bytes
                b64_img = base64.b64encode(jpeg_bytes).decode('utf-8')
                live_results[mesa_uuid]["image_b64"] = b64_img

                # Actualizar anotaciones vivas para el motor de streaming continuo a 25 FPS
                live_annotations[mesa_uuid] = {
                    "cards": detections if detections else raw_cards,
                    "ribbons": ribbon_boxes if is_presentando_cartas else [],
                    "chips": chip_boxes if is_presentando_banca else [],
                    "estado_mesa": estado_mesa,
                    "resultado": resultado
                }

                # Generar snapshot de auditoría con alta fidelidad para el archivo permanente de mesas_ia
                target_evid_w = min(1024, wp)
                target_evid_h = max(10, int(hp * (target_evid_w / max(1, wp))))
                img_evidence = cv2.resize(img_plot, (target_evid_w, target_evid_h), interpolation=cv2.INTER_AREA) if wp > 1024 else img_plot
                _, buf_evid = cv2.imencode('.jpg', img_evidence, [int(cv2.IMWRITE_JPEG_QUALITY), 78])
                b64_evidence = base64.b64encode(buf_evid).decode('utf-8')

                # Guardar frame para aprendizaje activo si hubo duda o baja confianza
                if guardar_por_duda and count > 0:
                    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                    duda_path = os.path.join(AUTO_TRAIN_DIR, f"duda_{ts}_{mesa_uuid[:6]}.jpg")
                    cv2.imwrite(duda_path, frame)

                # Auto-guardado garantizado en base de datos si la mano está lista y no se ha guardado
                if resultado.get('listo') and raw_cards and estado_mesa not in ['BARAJO_CARTAS', 'PRESENTANDO_CARTAS']:
                    ultimo = historial_guardado.get(mesa_uuid)
                    if detalle_mano != ultimo:
                        historial_guardado[mesa_uuid] = detalle_mano
                        enviar_evento_a_wisi(mesa_uuid, cfg, resultado, detalle_mano, b64_evidence, juego_label)

                # Control y registro automático de eventos de Presentación de Banca
                b_mem = banca_presentation_memory.get(mesa_uuid)
                if is_presentando_banca:
                    if not b_mem or not b_mem.get('active'):
                        banca_presentation_memory[mesa_uuid] = {
                            'active': True,
                            'start_time': now_ts,
                            'last_seen': now_ts
                        }
                        enviar_evento_a_wisi(mesa_uuid, cfg, {
                            'tipo_evento': 'PRESENTACION_BANCA',
                            'win': 'INICIO PRESENTACIÓN DE BANCA',
                            'es_novedad': False,
                            'nivel_alerta': 'INFO'
                        }, f"Inicio de presentación de banca ({len(chip_boxes)} columnas/pilas de fichas en paño)", b64_evidence, juego_label)
                    else:
                        b_mem['last_seen'] = now_ts
                else:
                    if b_mem and b_mem.get('active'):
                        if now_ts - b_mem.get('last_seen', 0) > 4.5:
                            b_mem['active'] = False
                            enviar_evento_a_wisi(mesa_uuid, cfg, {
                                'tipo_evento': 'PRESENTACION_BANCA',
                                'win': 'FINALIZACIÓN PRESENTACIÓN DE BANCA',
                                'es_novedad': False,
                                'nivel_alerta': 'INFO'
                            }, "Finalización de presentación de banca (Fichas resguardadas en chipletero)", b64_evidence, juego_label)

                # Control y registro automático de Presentación de Cartas
                c_mem = cartas_presentation_memory.get(mesa_uuid)
                if is_presentando_cartas:
                    if not c_mem or not c_mem.get('active'):
                        cartas_presentation_memory[mesa_uuid] = {
                            'active': True,
                            'start_time': now_ts,
                            'last_seen': now_ts
                        }
                        enviar_evento_a_wisi(mesa_uuid, cfg, {
                            'tipo_evento': 'PRESENTACION_CARTAS',
                            'win': 'INICIO PRESENTACIÓN DE CARTAS',
                            'es_novedad': False,
                            'nivel_alerta': 'INFO'
                        }, "Inicio de presentación de cartas (Verificación de naipes / mazo completo en paño)", b64_evidence, juego_label)
                    else:
                        c_mem['last_seen'] = now_ts
                else:
                    if c_mem and c_mem.get('active'):
                        if now_ts - c_mem.get('last_seen', 0) > 4.5:
                            c_mem['active'] = False
                            enviar_evento_a_wisi(mesa_uuid, cfg, {
                                'tipo_evento': 'PRESENTACION_CARTAS',
                                'win': 'FINALIZACIÓN PRESENTACIÓN DE CARTAS',
                                'es_novedad': False,
                                'nivel_alerta': 'INFO'
                            }, "Finalización de presentación de cartas (Naipes recogidos del paño)", b64_evidence, juego_label)

                # Control y registro automático de Barajo de Cartas
                bar_mem = barajo_memory.get(mesa_uuid)
                if estado_mesa == "BARAJO_CARTAS":
                    if not bar_mem or not bar_mem.get('active'):
                        barajo_memory[mesa_uuid] = {
                            'active': True,
                            'start_time': now_ts,
                            'last_seen': now_ts
                        }
                        enviar_evento_a_wisi(mesa_uuid, cfg, {
                            'tipo_evento': 'BARAJO_CARTAS',
                            'win': 'INICIO BARAJO DE CARTAS',
                            'es_novedad': False,
                            'nivel_alerta': 'INFO'
                        }, "Inicio de barajo de cartas (Mezcla y lavado de naipes boca abajo)", b64_evidence, juego_label)
                    else:
                        bar_mem['last_seen'] = now_ts
                else:
                    if bar_mem and bar_mem.get('active'):
                        if now_ts - bar_mem.get('last_seen', 0) > 4.5:
                            bar_mem['active'] = False
                            enviar_evento_a_wisi(mesa_uuid, cfg, {
                                'tipo_evento': 'BARAJO_CARTAS',
                                'win': 'FINALIZACIÓN BARAJO DE CARTAS',
                                'es_novedad': False,
                                'nivel_alerta': 'INFO'
                            }, "Finalización de barajo de cartas (Baraja cuadrada e ingresada al sabot)", b64_evidence, juego_label)

            except Exception as e:
                print(f"❌ Error en inferencia de mesa {mesa_uuid}: {e}")

        time.sleep(0.06)

def enviar_evento_a_wisi(mesa_uuid, cfg, resultado, detalle_mano, b64_img, juego_label='Baccarat'):
    """
    Envía la jugada analizada con Inteligencia Artificial a la base de datos de Wisi
    y archiva la captura de evidencia visual con sus recuadros en la carpeta mesas_ia.
    """
    try:
        if juego_label == "Poker Caribeño":
            desc = f"Poker Caribeño - {resultado.get('win')}: {detalle_mano}"
        elif juego_label == "Blackjack":
            desc = f"Blackjack - {resultado.get('win')} | {detalle_mano}"
        else:
            desc = f"{resultado.get('win')} ({resultado.get('scoreP')} a {resultado.get('scoreB')}) | {detalle_mano}"

        tipo_ev = resultado.get('tipo_evento', 'JUGADA')
        es_nov = resultado.get('es_novedad', False)
        nivel_al = resultado.get('nivel_alerta', 'INFO')

        # Intentar guardado directo a disco si la carpeta mesas_ia está accesible localmente
        local_filename = None
        candidate_mesas_dirs = [
            os.path.join(BASE_DIR, '..', 'backend-fastify', 'mesas_ia'),
            os.path.join(BASE_DIR, '..', 'mesas_ia'),
            '/var/www/wisi/backend-fastify/mesas_ia',
            '/var/www/wisi/mesas_ia'
        ]
        target_dir = None
        for d in candidate_mesas_dirs:
            if os.path.exists(d):
                target_dir = d
                break

        if not target_dir:
            parent_bf = os.path.join(BASE_DIR, '..', 'backend-fastify')
            if os.path.exists(parent_bf):
                target_dir = os.path.join(parent_bf, 'mesas_ia')
                os.makedirs(target_dir, exist_ok=True)

        if target_dir and b64_img:
            try:
                import re
                clean_m = re.sub(r'[^a-zA-Z0-9_-]', '', str(mesa_uuid or 'mesa'))[:8]
                ts_ms = int(time.time() * 1000)
                rand_s = hex(int(time.time() * 1000) % 100000)[2:]
                local_filename = f"evento_{clean_m}_{ts_ms}_{rand_s}.jpg"
                save_fpath = os.path.join(target_dir, local_filename)
                with open(save_fpath, 'wb') as f_out:
                    f_out.write(base64.b64decode(b64_img))
            except Exception as e_save:
                print(f"⚠️ Error guardando snapshot local en {target_dir}: {e_save}")
                local_filename = None

        payload = {
            "sala_uuid": cfg.get('sala_uuid'),
            "mesa_uuid": mesa_uuid,
            "mesa_nombre": cfg.get('nombre'),
            "juego_nombre": juego_label,
            "tipo_evento": tipo_ev,
            "descripcion": desc,
            "nivel_alerta": nivel_al,
            "es_novedad": es_nov,
            "foto": local_filename,
            "imagen_base64": b64_img,
            "detalles": {
                "score_punto": resultado.get('scoreP', 0),
                "score_banca": resultado.get('scoreB', 0),
                "ganador": resultado.get('win'),
                "califica": resultado.get('califica'),
                "dealer_jugada": resultado.get('jugada'),
                "detalle_cartas": detalle_mano,
                "natural": resultado.get('natural', False),
                "foto": local_filename
            }
        }
        for api_url in WISI_API_URLS:
            try:
                res = requests.post(f"{api_url}/ia-eventos", json=payload, timeout=5)
                if res.status_code in [200, 201]:
                    foto_log = f" [Foto: {local_filename}]" if local_filename else ""
                    print(f"✅ [IA Wisi] Evento ({tipo_ev}) registrado en {api_url} para mesa {cfg.get('nombre')}: {desc}{foto_log}")
                    break
                else:
                    print(f"⚠️ [IA Wisi {res.status_code}] Backend {api_url} rechazó evento de {cfg.get('nombre')}: {res.text}")
            except Exception as e_post:
                pass
    except Exception as err:
        print(f"⚠️ Error procesando evento Wisi: {err}")

@app.route('/mesas/<mesa_uuid>/configurar', methods=['POST'])
def configurar_juego_mesa(mesa_uuid):
    data = request.get_json(force=True, silent=True) or {}
    nuevo_juego = data.get('juego')
    if mesa_uuid in mesas_config and nuevo_juego:
        mesas_config[mesa_uuid]['juego'] = nuevo_juego
        print(f"🔄 [Wisi Config] Juego de mesa {mesas_config[mesa_uuid].get('nombre')} actualizado a: {nuevo_juego}")
        return jsonify({"success": True, "mesa_uuid": mesa_uuid, "juego": nuevo_juego})
    return jsonify({"success": False, "error": "Mesa no encontrada"}), 404

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
                        requests.post(ep, json=payload, timeout=1.5)
                    except Exception:
                        pass
        except Exception:
            pass
        time.sleep(0.35)

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
    Emite un flujo continuo MJPEG de alta velocidad con las cajas delimitadoras de YOLO y datos de la jugada
    """
    def generate():
        while True:
            buf = live_jpeg_buffers.get(mesa_uuid)
            if not buf:
                cfg = mesas_config.get(mesa_uuid, {})
                buf = make_placeholder_frame(cfg.get('nombre', 'Mesa'), "Conectando señal...")
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + buf + b'\r\n')
            time.sleep(0.04) # ~25 FPS streaming continuo fluido
    return Response(generate(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/snapshot/<mesa_uuid>')
def get_snapshot(mesa_uuid):
    """
    Retorna un fotograma JPEG único optimizado (ideal para carga ligera de la cuadrícula general sin agotar sockets)
    """
    buf = live_jpeg_buffers.get(mesa_uuid)
    if not buf:
        cfg = mesas_config.get(mesa_uuid, {})
        buf = make_placeholder_frame(cfg.get('nombre', 'Mesa'), "Conectando señal...")
    return Response(buf, mimetype='image/jpeg', headers={'Cache-Control': 'no-cache, no-store, must-revalidate'})

@app.route('/mesa/<mesa_uuid>/reconectar', methods=['POST'])
def reconectar_mesa_endpoint(mesa_uuid):
    """
    Fuerza la reconexión inmediata del canal RTSP/ISAPI para la mesa indicada
    """
    reconnect_requests.add(mesa_uuid)
    cfg = mesas_config.get(mesa_uuid, {})
    m_name = cfg.get('nombre', 'Mesa')
    live_jpeg_buffers[mesa_uuid] = make_placeholder_frame(m_name, "Reconectando cámara...")
    estado_stream[mesa_uuid] = 'reconectando'
    return jsonify({"success": True, "mesa_uuid": mesa_uuid, "mensaje": f"Reconexión solicitada para {m_name}"})

@app.route('/stream_raw/<mesa_uuid>')
def stream_raw_mjpeg(mesa_uuid):
    """
    Emite el flujo de video en vivo crudo directo de la cámara (sin anotaciones IA)
    """
    def generate():
        while True:
            raw = frames_actuales.get(mesa_uuid)
            if raw is not None and raw.size > 0:
                try:
                    h, w = raw.shape[:2]
                    scale = 800.0 / w if w > 800 else 1.0
                    frame_small = cv2.resize(raw, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_LINEAR) if scale < 1.0 else raw
                    _, encoded = cv2.imencode('.jpg', frame_small, [int(cv2.IMWRITE_JPEG_QUALITY), 65])
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + encoded.tobytes() + b'\r\n')
                except Exception:
                    pass
            time.sleep(0.04)
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

        # Inicializar fotograma de respaldo inmediato para evitar pantalla en negro o flujos vacíos
        if uuid not in live_jpeg_buffers:
            live_jpeg_buffers[uuid] = make_placeholder_frame(nombre, "Sincronizando canal de video...")

        # Iniciar thread RTSP si no existe (usando SUBSTREAM {canal}02 para visualización ultra-fluida sin lag)
        if uuid not in estado_stream:
            url_rtsp = f"rtsp://{usuario}:{clave}@{ip}:554/Streaming/Channels/{canal}02"
            estado_stream[uuid] = 'conectando'
            threading.Thread(target=stream_worker, args=(uuid, url_rtsp), daemon=True).start()

def sync_mesas_worker():
    while True:
        try:
            for api_url in WISI_API_URLS:
                try:
                    r = requests.get(f"{api_url}/mesas-con-camaras", timeout=8)
                    if r.status_code == 200:
                        data = r.json().get('data', [])
                        if data:
                            actualizar_mesas(data)
                            break
                except Exception:
                    pass
        except Exception:
            pass
        time.sleep(25)

def cargar_mesas_desde_fastify():
    for intento in range(3):
        for api_url in WISI_API_URLS:
            try:
                r = requests.get(f"{api_url}/mesas-con-camaras", timeout=8)
                if r.status_code == 200:
                    data = r.json().get('data', [])
                    if data:
                        print(f"📥 [Wisi Config] {len(data)} mesas con cámaras obtenidas de {api_url}")
                        actualizar_mesas(data)
                        return
            except Exception:
                pass
        time.sleep(1)
    print("⚠️ No se pudo sincronizar automáticamente con backend Wisi en ninguna URL")

if __name__ == '__main__':
    cargar_mesas_desde_fastify()
    threading.Thread(target=sync_mesas_worker, daemon=True).start()
    threading.Thread(target=ai_inference_loop, daemon=True).start()
    threading.Thread(target=sync_to_cloud_worker, daemon=True).start()
    app.run(host='0.0.0.0', port=5005, threaded=True)
