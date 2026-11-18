/**
 * Parser inteligente de mensajes de WhatsApp para el sistema WISI.
 * Soporta NLP tolerante a variaciones ortográficas, sinónimos, abreviaturas,
 * tildes/acentos, plurales/singulares, mayúsculas/minúsculas y ORDEN TOTALMENTE LIBRE.
 * 
 * Ejemplos soportados sin importar el orden:
 *  - "500 pago varchar mesa cash"
 *  - "rango 5 veronica 100 devolucion"
 *  - "compra 100 zinli juan"
 *  - "Compra 200$ USDT Máquinas WILLINTHONTEST"
 *  - "aporte 300 manuel rango 1"
 *  - "100 a carlos r2"
 *  - "500 c pedro usdt"
 */

/**
 * Normalizador de texto: sin tildes, minúsculas, espacios colapsados.
 */
export function normalizeText(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Diccionario de Rangos de Máquinas
const RANGO_RULES = [
  { rango: 'Rango 1', regex: /\b(r(?:ango|g)?\s*[-_]?\s*1)\b/i },
  { rango: 'Rango 2', regex: /\b(r(?:ango|g)?\s*[-_]?\s*2)\b/i },
  { rango: 'Rango 3', regex: /\b(r(?:ango|g)?\s*[-_]?\s*3)\b/i },
  { rango: 'Rango 4', regex: /\b(r(?:ango|g)?\s*[-_]?\s*4)\b/i },
  { rango: 'Rango 5', regex: /\b(r(?:ango|g)?\s*[-_]?\s*5)\b/i },
  { rango: 'Rango Fumadores', regex: /\b(r(?:ango)?\s*fumadores?|fumadores?|fuma)\b/i },
  { rango: 'Ruleta Electrónica', regex: /\b(ruleta(?:\s+electr[oó]nica)?|ruleta\s*elec)\b/i },
  { rango: 'Sin Rango', regex: /\b(sin\s*rango|sinrango|sr)\b/i }
];

// Diccionario de Tipos de Operación (palabras completas)
const TIPO_FULL_RULES = [
  { tipo: 'Compra', regex: /\b(compras?|compr|comp)\b/i },
  { tipo: 'Pago', regex: /\b(pagos?|pag)\b/i },
  { tipo: 'Aporte', regex: /\b(aportes?|aprt|apo)\b/i },
  { tipo: 'Devolución', regex: /\b(devoluci[oó]n|devoluciones|devolucio|devo|dev)\b/i }
];

// Abreviaturas de una sola letra para Tipos (prioridad secundaria)
const TIPO_SINGLE_RULES = [
  { tipo: 'Compra', regex: /\b(c)\b/i },
  { tipo: 'Pago', regex: /\b(p)\b/i },
  { tipo: 'Aporte', regex: /\b(a)\b/i },
  { tipo: 'Devolución', regex: /\b(d)\b/i }
];

// Diccionario de Cajas
const CAJA_RULES = [
  { caja: 'Máquinas', regex: /\b(m[aá]quinas?|m[aá]quina|maq|maqs|slots?)\b/i },
  { caja: 'Mesas', regex: /\b(mesas?|mesa|tables?|vivo|live)\b/i }
];

// Diccionario de Métodos de Pago
const METODO_RULES = [
  { metodo: 'USDT', regex: /\b(usdt|binance|crypto|cripto|tether|trc20|usdc)\b/i },
  { metodo: 'Zelle', regex: /\b(zelle|zele)\b/i },
  { metodo: 'Pago Móvil', regex: /\b(pago\s*m[oó]b?il|pagom[oó]b?il|pm)\b/i },
  { metodo: 'PDV', regex: /\b(pdv|pos|punto(?:\s+de\s+venta|\s+venta)?|punto|d[eé]bito|tarjeta)\b/i },
  { metodo: 'Transferencia', regex: /\b(transferencias?|transf|banco|transfer|bfa|banesco|mercantil|provincial|venezuela)\b/i },
  { metodo: 'Cash', regex: /\b(cash|d[oó]lares?|dolar|efectivo|usd|divisas?|billetes?)\b/i },
  { metodo: 'Zinli', regex: /\b(zinli)\b/i },
  { metodo: 'Wally', regex: /\b(wally|wallytech)\b/i },
  { metodo: 'Paypal', regex: /\b(paypal)\b/i },
  { metodo: 'Bolívares', regex: /\b(bol[ií]vares?|bs|ves)\b/i },
  { metodo: 'Euros', regex: /\b(euros?|eur)\b/i },
  { metodo: 'General', regex: /\b(general|otros?)\b/i }
];

export function parseWhatsAppMessage(text, defaultOptions = {}) {
  if (!text || typeof text !== 'string') return null;

  // Limpiar caracteres de formato al inicio (emojis, markdown, asteriscos, viñetas)
  let clean = text
    .replace(/^[\s*#~_>🟢💵✅🪙👍🚀💎💰🎰🎲\-]+/, '')
    .trim();

  if (clean.length < 2) return null;

  // 1. Extraer Nota (si existe "nota: ...", "ref: ...", "obs: ...")
  let nota = '';
  let textWithoutNota = clean;
  const notaMatch = clean.match(/(?:nota|obs|observacion|observación|ref|referencia):\s*(.*)$/i);
  if (notaMatch) {
    nota = notaMatch[1].trim();
    textWithoutNota = clean.slice(0, clean.indexOf(notaMatch[0])).trim();
  }

  // 2. Extraer Rango PRIMERO para proteger su número (ej. "rango 5" no debe extraer 5 como monto)
  let rango = null;
  let rangoExplicit = false;
  let rangoMatchedText = null;

  for (const rule of RANGO_RULES) {
    const m = textWithoutNota.match(rule.regex);
    if (m) {
      rango = rule.rango;
      rangoExplicit = true;
      rangoMatchedText = m[0];
      break;
    }
  }

  if (!rango) {
    const genericRangoMatch = textWithoutNota.match(/\b(rango\s+[a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]+)\b/i);
    if (genericRangoMatch) {
      rango = genericRangoMatch[1].trim()
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
      rangoExplicit = true;
      rangoMatchedText = genericRangoMatch[0];
    }
  }

  // 3. Detectar Tipo (Order-Agnostic: busca en cualquier posición del mensaje)
  let tipo = null;
  let tipoMatchedText = null;

  // Palabras completas primero
  for (const rule of TIPO_FULL_RULES) {
    const m = textWithoutNota.match(rule.regex);
    if (m) {
      tipo = rule.tipo;
      tipoMatchedText = m[0];
      break;
    }
  }

  // Si no se encontró palabra completa, buscar token abreviado de una sola letra
  if (!tipo) {
    for (const rule of TIPO_SINGLE_RULES) {
      const m = textWithoutNota.match(rule.regex);
      if (m) {
        tipo = rule.tipo;
        tipoMatchedText = m[0];
        break;
      }
    }
  }

  if (!tipo) return null; // No es un mensaje de transacción de WISI

  const isAporteDev = (tipo === 'Aporte' || tipo === 'Devolución');

  // 4. Extraer Monto numérico
  // Enmascaramos el texto del RANGO y horas (ej. 12:30 o 04:16) para que sus números no se tomen como monto
  let textForMonto = textWithoutNota;
  if (rangoMatchedText) {
    textForMonto = textForMonto.replace(rangoMatchedText, ' ');
  }
  textForMonto = textForMonto.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ');

  let monto = 0;
  let montoRaw = '';

  // Prioridad 1: Número con indicador monetario explícito ($1000, 1000$, 1000d, 1000usd, 1000bs, 1000 ref, etc.)
  const explicitMontoMatch = textForMonto.match(/(?:[\$€£]|bs\.?|ref\.?)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:[\$€£]|usd|usdt|bs\.?|ref|dlls?|d[oó]lares?|divisas?|d\b)/i);
  if (explicitMontoMatch) {
    montoRaw = explicitMontoMatch[0];
    let numStr = explicitMontoMatch[1] || explicitMontoMatch[2];
    if (numStr) {
      if (numStr.includes('.') && numStr.includes(',')) {
        if (numStr.lastIndexOf(',') > numStr.lastIndexOf('.')) {
          numStr = numStr.replace(/\./g, '').replace(',', '.');
        } else {
          numStr = numStr.replace(/,/g, '');
        }
      } else if (numStr.includes(',')) {
        numStr = numStr.replace(',', '.');
      }
      monto = parseFloat(numStr);
    }
  }

  // Prioridad 2: Cualquier número en el texto (incluso con letras o sufijos adjuntos)
  if (!monto || isNaN(monto) || monto <= 0) {
    const anyNumberMatch = textForMonto.match(/(?<![a-zA-Z])(\d+(?:[.,]\d+)?)(?:[a-zA-Z\$]+)?/);
    if (anyNumberMatch) {
      montoRaw = anyNumberMatch[0];
      let numStr = anyNumberMatch[1];
      if (numStr.includes('.') && numStr.includes(',')) {
        if (numStr.lastIndexOf(',') > numStr.lastIndexOf('.')) {
          numStr = numStr.replace(/\./g, '').replace(',', '.');
        } else {
          numStr = numStr.replace(/,/g, '');
        }
      } else if (numStr.includes(',')) {
        numStr = numStr.replace(',', '.');
      }
      monto = parseFloat(numStr);
    }
  }

  if (!monto || isNaN(monto) || monto <= 0) {
    return null; // Si no hay monto válido, se ignora
  }

  // 5. Detectar Caja
  let caja = isAporteDev ? 'Máquinas' : (defaultOptions.caja_default || 'Mesas');
  let cajaExplicit = false;
  let cajaMatchedText = null;

  for (const rule of CAJA_RULES) {
    const m = textWithoutNota.match(rule.regex);
    if (m) {
      caja = rule.caja;
      cajaExplicit = true;
      cajaMatchedText = m[0];
      break;
    }
  }

  // 6. Detectar Método de Pago (SOLO para Control de Clientes; en Aportes/Devoluciones NO aplica)
  let metodo = isAporteDev ? null : (defaultOptions.metodo_default || 'General');
  let metodoExplicit = false;
  let metodoMatchedText = null;

  if (!isAporteDev) {
    for (const rule of METODO_RULES) {
      const m = textWithoutNota.match(rule.regex);
      if (m) {
        metodo = rule.metodo;
        metodoExplicit = true;
        metodoMatchedText = m[0];
        break;
      }
    }
  }

  // 7. Extraer Cliente (para Control de Clientes) u Operador (para Aportes/Devoluciones)
  let remaining = textWithoutNota;

  if (notaMatch) remaining = remaining.replace(notaMatch[0], ' ');
  if (rangoMatchedText) remaining = remaining.replace(rangoMatchedText, ' ');
  if (tipoMatchedText) remaining = remaining.replace(new RegExp(`\\b${tipoMatchedText}\\b`, 'i'), ' ');
  if (montoRaw) remaining = remaining.replace(montoRaw, ' ');
  if (cajaMatchedText) remaining = remaining.replace(new RegExp(`\\b${cajaMatchedText}\\b`, 'i'), ' ');
  if (metodoMatchedText) remaining = remaining.replace(new RegExp(`\\b${metodoMatchedText}\\b`, 'i'), ' ');

  // En Aportes y Devoluciones, remover cualquier palabra de método de pago si el usuario la escribió (ej. "cash")
  if (isAporteDev) {
    remaining = remaining.replace(/\b(usdt|binance|cash|d[oó]lares?|dolar|efectivo|usd|zelle|zinli|pdv|pm|pago\s*m[oó]vil|bs|ves|euros?)\b/gi, ' ');
  }

  // Limpiar caracteres especiales residuales
  remaining = remaining
    .replace(/[$,:.\-_*#~|/\\()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let parsedName = remaining
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  const operador = isAporteDev ? (parsedName || 'General') : null;
  const cliente = isAporteDev ? 'General' : (parsedName || 'General');

  const modulo = isAporteDev 
    ? 'aportes_maquinas' 
    : (defaultOptions.modulo_destino || 'control_clientes');

  const clienteExplicit = !isAporteDev && Boolean(parsedName && parsedName.toLowerCase() !== 'general');
  const operadorExplicit = isAporteDev && Boolean(parsedName && parsedName.toLowerCase() !== 'general');

  return {
    success: true,
    tipo,
    monto,
    metodo,
    caja,
    cliente,
    operador,
    rango,
    nota,
    modulo,
    explicit: {
      metodo: metodoExplicit,
      caja: cajaExplicit,
      rango: rangoExplicit,
      cliente: clienteExplicit,
      operador: operadorExplicit
    }
  };
}
