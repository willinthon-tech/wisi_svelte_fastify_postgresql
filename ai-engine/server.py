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

    # Natural 8 o 9 (Se termina de inmediato, ninguna mano pide 3ra carta)
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

    pideP = False
    pideB = False

    # Regla de Punto: Pide con 0-5, Planta con 6-7
    if sP <= 5:
        pideP = True

    # Regla de Banca
    if not pideP:
        if sB <= 5:
            pideB = True
    elif nP >= 3:
        p3 = parse_card_info(punto_cards[2].get('val', ''))
        v3P = p3.get('baccarat_val', 0)
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

mesa_round_memory = {}

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

                # Filtrar cajas duplicadas que correspondan a la misma carta física
                filtered_cards = []
                for c in sorted(raw_cards, key=lambda x: x['conf'], reverse=True):
                    overlap = False
                    for fc in filtered_cards:
                        dist = ((c['cx'] - fc['cx'])**2 + (c['cy'] - fc['cy'])**2)**0.5
                        if dist < 32:
                            overlap = True
                            break
                    if not overlap:
                        filtered_cards.append(c)

                filtered_cards.sort(key=lambda c: c['cx'])
                raw_cards = filtered_cards
                count = len(raw_cards)
                detections = []
                estado_mesa = "NORMAL"

                now_ts = time.time()
                mem = mesa_round_memory.get(mesa_uuid)

                if count > 0:
                    if not mem or (now_ts - mem.get('last_seen', 0) > 4.5):
                        mesa_round_memory[mesa_uuid] = {
                            'cards': raw_cards,
                            'last_seen': now_ts,
                            'count': count
                        }
                    else:
                        # Si antes teníamos más cartas y de repente disminuyó (ej: brazo del dealer tapando),
                        # retenemos las cartas anteriores durante hasta 3.5 segundos
                        if count < mem.get('count', 0) and (now_ts - mem.get('last_seen', 0) < 3.5):
                            raw_cards = mem['cards']
                            count = len(raw_cards)
                        else:
                            mem['cards'] = raw_cards
                            mem['count'] = count
                            mem['last_seen'] = now_ts
                else:
                    # count == 0
                    if mem and (now_ts - mem.get('last_seen', 0) < 3.5):
                        raw_cards = mem['cards']
                        count = len(raw_cards)
                    else:
                        mesa_round_memory.pop(mesa_uuid, None)

                if count == 0:
                    estado_mesa = "SIN JUGADA"
                    punto_list = []
                    banca_list = []
                elif count > 6 and tipo_juego == 'BACCARAT':
                    # En Baccarat NUNCA puede haber más de 6 cartas en total (3 Punto + 3 Banca)
                    estado_mesa = "BARAJO"
                    punto_list = []
                    banca_list = []
                elif count >= 8 and tipo_juego != 'POKER_CARIBENO':
                    estado_mesa = "BARAJO"
                    punto_list = []
                    banca_list = []
                else:
                    gaps = [raw_cards[i+1]['cx'] - raw_cards[i]['cx'] for i in range(count - 1)]
                    max_gap = max(gaps) if gaps else 0

                    if count > 1 and max_gap < 18:
                        estado_mesa = "RECOGIENDO"
                    elif count < (5 if tipo_juego == 'POKER_CARIBENO' else 4):
                        estado_mesa = "REPARTIENDO"
                    else:
                        estado_mesa = "NORMAL"

                    if tipo_juego == 'BACCARAT':
                        # REGLA OFICIAL DE BACCARAT:
                        # En la cámara, las cartas de BANCA se sitúan a la izquierda (menor cx) y PUNTO a la derecha (mayor cx).
                        # NUNCA JAMÁS Banca o Punto pueden tener 4 cartas. Máximo 3 cartas por bando.
                        if count == 1:
                            banca_list = raw_cards
                            punto_list = []
                        elif count == 2:
                            banca_list = [raw_cards[0]]
                            punto_list = [raw_cards[1]]
                        elif count == 3:
                            if len(gaps) >= 2 and gaps[0] > gaps[1]:
                                banca_list = [raw_cards[0]]
                                punto_list = raw_cards[1:3]
                            else:
                                banca_list = raw_cards[0:2]
                                punto_list = [raw_cards[2]]
                        elif count == 4:
                            banca_list = raw_cards[:2]
                            punto_list = raw_cards[2:4]
                        elif count == 5:
                            # 2 Banca / 3 Punto, o 3 Banca / 2 Punto. NUNCA 4!
                            g2 = gaps[1] if len(gaps) > 1 else 0
                            g3 = gaps[2] if len(gaps) > 2 else 0
                            if g3 > g2:
                                banca_list = raw_cards[:3]
                                punto_list = raw_cards[3:5]
                            else:
                                banca_list = raw_cards[:2]
                                punto_list = raw_cards[2:5]
                        elif count == 6:
                            banca_list = raw_cards[:3]
                            punto_list = raw_cards[3:6]
                        else:
                            banca_list = raw_cards[:3]
                            punto_list = raw_cards[3:6]

                        banca_list = banca_list[:3]
                        punto_list = punto_list[:3]
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
                        color = (0, 0, 255) # Rojo Banca
                    elif zone == "punto":
                        color = (255, 120, 0) # Azul Punto
                    elif zone == "dealer":
                        color = (0, 215, 255) # Oro Casa / Dealer
                    else:
                        color = (0, 255, 0)

                    cv2.rectangle(img_plot, (x1, y1), (x2, y2), color, 3)
                    # Quitar porcentaje como solicitó el usuario: solo nombre limpio de la carta (sin porcentajes)
                    label = str(det['val']).strip()
                    (w, h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.85, 2)
                    top_y = max(h + 12, y1)
                    cv2.rectangle(img_plot, (x1, top_y - h - 10), (x1 + w + 8, top_y), color, -1)
                    cv2.putText(img_plot, label, (x1 + 4, top_y - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.85, (0, 0, 0), 2)

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

        time.sleep(0.06)

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

        tipo_ev = resultado.get('tipo_evento', 'JUGADA')
        es_nov = resultado.get('es_novedad', False)
        nivel_al = resultado.get('nivel_alerta', 'INFO')

        payload = {
            "sala_uuid": cfg.get('sala_uuid'),
            "mesa_uuid": mesa_uuid,
            "mesa_nombre": cfg.get('nombre'),
            "juego_nombre": juego_label,
            "tipo_evento": tipo_ev,
            "descripcion": desc,
            "nivel_alerta": nivel_al,
            "es_novedad": es_nov,
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
                    print(f"✅ [IA Wisi] Evento ({tipo_ev}) registrado en {api_url} para mesa {cfg.get('nombre')}: {desc}")
                    break
            except Exception:
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
