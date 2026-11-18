/**
 * Parser inteligente de mensajes de WhatsApp para el sistema WISI.
 * Soporta NLP tolerante a variaciones ortográficas, sinónimos, abreviaturas,
 * tildes/acentos, plurales/singulares y mayúsculas/minúsculas.
 * 
 * Extrae: tipo, monto, método de pago, caja (Mesas/Máquinas), cliente (jugador),
 * operador (empleado), rango y notas.
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

// Diccionario de Tipos de Operación
const TIPO_RULES = [
  { tipo: 'Compra', regex: /\b(compras?|compr|comp|c)\b/i },
  { tipo: 'Pago', regex: /\b(pagos?|pag|p)\b/i },
  { tipo: 'Aporte', regex: /\b(aportes?|aprt|apo|a)\b/i },
  { tipo: 'Devolución', regex: /\b(devoluci[oó]n|devoluciones|devolucio|devo|dev|d)\b/i }
];

// Diccionario de Cajas
const CAJA_RULES = [
  { caja: 'Máquinas', regex: /\b(m[aá]quinas?|maq|maqs|slots?)\b/i },
  { caja: 'Mesas', regex: /\b(mesas?|tables?|vivo|live)\b/i }
];

// Diccionario de Métodos de Pago
const METODO_RULES = [
  { metodo: 'USDT', regex: /\b(usdt|binance|crypto|cripto|tether|trc20|usdc)\b/i },
  { metodo: 'Zelle', regex: /\b(zelle|zele)\b/i },
  { metodo: 'Pago Móvil', regex: /\b(pago\s*m[oó]b?il|pagom[oó]b?il|pm)\b/i },
  { metodo: 'PDV', regex: /\b(pdv|pos|punto(?:\s+de\s+venta|\s+venta)?|d[eé]bito|tarjeta)\b/i },
  { metodo: 'Transferencia', regex: /\b(transferencias?|transf|banco|transfer|bfa|banesco|mercantil|provincial)\b/i },
  { metodo: 'Cash', regex: /\b(cash|d[oó]lares?|efectivo|usd|divisas?|billetes?)\b/i }
];

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

export function parseWhatsAppMessage(text, defaultOptions = {}) {
  if (!text || typeof text !== 'string') return null;

  // Limpiar caracteres de formato al inicio (emojis, markdown, asteriscos, guiones)
  let clean = text
    .replace(/^[\s*#~_>🟢💵✅🪙👍🚀💎💰🎰🎲\-]+/, '')
    .trim();

  if (clean.length < 3) return null;

  // 1. Extraer Nota (si existe "nota: ...", "ref: ...", "obs: ...")
  let nota = '';
  let textWithoutNota = clean;
  const notaMatch = clean.match(/(?:nota|obs|observacion|observación|ref|referencia):\s*(.*)$/i);
  if (notaMatch) {
    nota = notaMatch[1].trim();
    textWithoutNota = clean.slice(0, clean.indexOf(notaMatch[0])).trim();
  }

  // 2. Extraer Monto numérico
  // Soporta $200, 200$, 200, 200.50, 200,50, 1,500, 1.500
  let monto = 0;
  let montoRaw = '';
  const montoMatch = textWithoutNota.match(/(?:\$|\b)\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:\$|\b)/);
  if (montoMatch) {
    montoRaw = montoMatch[0];
    let numStr = montoMatch[1];
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

  if (!monto || isNaN(monto) || monto <= 0) {
    return null; // Si no hay monto válido, no es una transacción válida
  }

  // 3. Detectar Tipo (primera palabra/token o comando en el texto)
  let tipo = null;
  const firstTokenMatch = textWithoutNota.match(/^\b([a-zA-ZáéíóúÁÉÍÓÚñÑ]+)\b/i);
  if (firstTokenMatch) {
    const firstWord = firstTokenMatch[1];
    for (const rule of TIPO_RULES) {
      if (rule.regex.test(firstWord)) {
        tipo = rule.tipo;
        break;
      }
    }
  }

  // Si no coincidió al inicio, buscar comandos completos en cualquier parte del texto
  if (!tipo) {
    const fullWordRules = [
      { tipo: 'Compra', regex: /\b(compras?|compr)\b/i },
      { tipo: 'Pago', regex: /\b(pagos?|pag)\b/i },
      { tipo: 'Aporte', regex: /\b(aportes?|aprt|apo)\b/i },
      { tipo: 'Devolución', regex: /\b(devoluci[oó]n|devoluciones|devolucio|devo|dev)\b/i }
    ];
    for (const rule of fullWordRules) {
      if (rule.regex.test(textWithoutNota)) {
        tipo = rule.tipo;
        break;
      }
    }
  }

  // Si no empieza ni contiene uno de estos comandos válidos, se ignora
  if (!tipo) return null;

  const isAporteDev = (tipo === 'Aporte' || tipo === 'Devolución');

  // 4. Detectar Caja (Mesas o Máquinas)
  let caja = isAporteDev ? 'Máquinas' : (defaultOptions.caja_default || 'Mesas');
  let cajaExplicit = false;
  for (const rule of CAJA_RULES) {
    if (rule.regex.test(textWithoutNota)) {
      caja = rule.caja;
      cajaExplicit = true;
      break;
    }
  }

  // 5. Detectar Método de Pago
  let metodo = defaultOptions.metodo_default || 'Cash';
  let metodoExplicit = false;
  for (const rule of METODO_RULES) {
    if (rule.regex.test(textWithoutNota)) {
      metodo = rule.metodo;
      metodoExplicit = true;
      break;
    }
  }

  // 6. Detectar Rango (para Aportes/Devoluciones)
  let rango = null;
  let rangoExplicit = false;
  for (const rule of RANGO_RULES) {
    if (rule.regex.test(textWithoutNota)) {
      rango = rule.rango;
      rangoExplicit = true;
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
    }
  }

  // 7. Extraer Cliente (para Control de Clientes) u Operador (para Aportes/Devoluciones)
  let remaining = textWithoutNota;

  // Remover nota si existía (reemplazando por espacio para no juntar palabras)
  if (notaMatch) {
    remaining = remaining.replace(notaMatch[0], ' ');
  }

  // Remover monto (reemplazando por espacio)
  if (montoRaw) {
    remaining = remaining.replace(montoRaw, ' ');
  }

  // Remover tokens y sinónimos de Tipo
  remaining = remaining.replace(/\b(compras?|compr|comp|c|pagos?|pag|p|aportes?|aprt|apo|a|devoluci[oó]n|devoluciones|devolucio|devo|dev|d)\b/gi, ' ');

  // Remover tokens y sinónimos de Rango
  remaining = remaining
    .replace(/\b(r(?:ango|g)?\s*[-_]?\s*[0-9]+)\b/gi, ' ')
    .replace(/\b(r(?:ango)?\s*fumadores?|fumadores?|fuma)\b/gi, ' ')
    .replace(/\b(ruleta(?:\s+electr[oó]nica)?|ruleta\s*elec)\b/gi, ' ')
    .replace(/\b(sin\s*rango|sinrango|sr)\b/gi, ' ')
    .replace(/\b(rango\s+[a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]+)\b/gi, ' ');

  // Remover tokens y sinónimos de Cajas
  remaining = remaining.replace(/\b(m[aá]quinas?|maq|maqs|slots?|mesas?|tables?|vivo|live)\b/gi, ' ');

  // Remover tokens y sinónimos de Métodos de Pago
  remaining = remaining
    .replace(/\b(pago\s*m[oó]b?il|pagom[oó]b?il|m[oó]b?il|pm)\b/gi, ' ')
    .replace(/\b(usdt|binance|crypto|cripto|tether|trc20|usdc)\b/gi, ' ')
    .replace(/\b(zelle|zele)\b/gi, ' ')
    .replace(/\b(pdv|pos|punto(?:\s+de\s+venta|\s+venta)?|punto|d[eé]bito|tarjeta)\b/gi, ' ')
    .replace(/\b(transferencias?|transf|banco|transfer)\b/gi, ' ')
    .replace(/\b(cash|d[oó]lares?|efectivo|usd|divisas?|billetes?)\b/gi, ' ');

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
