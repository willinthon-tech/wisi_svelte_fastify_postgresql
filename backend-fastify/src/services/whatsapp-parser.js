/**
 * Parser inteligente de mensajes de WhatsApp para el sistema WISI.
 * Soporta NLP tolerante a variaciones ortográficas, sinónimos, abreviaturas,
 * tildes/acentos, plurales/singulares, mayúsculas/minúsculas y ORDEN TOTALMENTE LIBRE.
 * 
 * Soporta números de miles con punto ("1.000" -> 1000, "1.500" -> 1500) y decimales con coma ("1.500,50" -> 1500.5).
 * Elimina limpiamente conectores y preposiciones ("en", "por", "con", etc.) antes de métodos y en los nombres.
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

/**
 * Parsea montos en formato habitual de WhatsApp en Venezuela/Latinoamérica:
 * - El punto (.) se usa habitualmente como separador de miles: "1.000", "1.500", "10.000".
 * - La coma (,) se usa como separador de decimales: "1.500,50", "500,50".
 */
export function parseWhatsAppAmount(rawStr) {
  if (!rawStr) return 0;
  let s = String(rawStr).trim();

  // Caso 1: Contiene tanto punto como coma (ej. "1.500,50" o "1,500.50")
  if (s.includes('.') && s.includes(',')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      // Formato latino: 1.500,50 -> eliminar puntos de miles y convertir coma a punto
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // Formato anglosajón: 1,500.50 -> eliminar comas de miles
      s = s.replace(/,/g, '');
    }
  } else if (s.includes('.')) {
    // Caso 2: Solo contiene puntos. En WhatsApp el punto es separador de miles (ej: "1.000", "1.500", "10.000")
    s = s.replace(/\./g, '');
  } else if (s.includes(',')) {
    // Caso 3: Solo contiene comas.
    // Si tiene coma seguida de exactamente 3 dígitos (ej: "1,000", "10,000"), es separador de miles
    if (/^\d{1,3},\d{3}$/.test(s)) {
      s = s.replace(',', '');
    } else {
      // Es separador de decimales (ej: "500,50")
      s = s.replace(',', '.');
    }
  }

  const val = parseFloat(s);
  return isNaN(val) ? 0 : val;
}

/**
 * Limpia y normaliza el nombre de la persona (cliente u operador):
 * - Elimina palabras residuales de cajas o métodos de pago
 * - Elimina conectores / preposiciones ("en", "por", "con", "a", "al", etc.) que no pertenecen al nombre
 * - Formatea en Title Case
 */
export function cleanPersonName(rawName) {
  if (!rawName) return '';
  let name = String(rawName).trim();

  // 1. Eliminar palabras residuales de cajas o métodos que hayan quedado en el texto
  name = name.replace(/\b(mesas?|m[aá]quinas?|slots?|tables?|vivo|live)\b/gi, ' ');
  name = name.replace(/\b(usdt|binance|cash|d[oó]lares?|dolar|efectivo|usd|zelle|zinli|pdv|pm|pago\s*m[oó]vil|bs|ves|euros?)\b/gi, ' ');

  // 2. Limpiar caracteres especiales
  name = name.replace(/[$,:.\-_*#~|/\\()]/g, ' ').replace(/\s+/g, ' ').trim();

  // 3. Bucle para remover conectores y preposiciones sobrantes al inicio y final
  let changed = true;
  while (changed) {
    changed = false;
    // Conectores que NUNCA inician un nombre en este contexto: en, por, con, para, via, vía, al, a, del
    const newStart = name.replace(/^(?:en|por|con|para|via|vía|al|a|del)\s+/i, '');
    if (newStart !== name) {
      name = newStart.trim();
      changed = true;
    }
    // Conectores/artículos que NUNCA terminan un nombre: en, por, con, de, del, al, a, para, via, vía, el, la, los, las, y, e, o, u
    const newEnd = name.replace(/\s+(?:en|por|con|de|del|al|a|para|via|vía|el|la|los|las|y|e|o|u)$/i, '');
    if (newEnd !== name) {
      name = newEnd.trim();
      changed = true;
    }
  }

  // 4. Formatear cada palabra en Title Case
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
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
// Nota: La letra 'a' es preposición común en español. Para evitar falsos positivos ("pago a Juan", "dia 20"),
// solo se reconoce si va seguida de un monto, dos puntos o al inicio de la línea.
const TIPO_SINGLE_RULES = [
  { tipo: 'Compra', regex: /(?:^|\s)(c)(?:\s+\$?[\d]|\s*[:=]|\s*$)/i },
  { tipo: 'Pago', regex: /(?:^|\s)(p)(?:\s+\$?[\d]|\s*[:=]|\s*$)/i },
  { tipo: 'Aporte', regex: /(?:^|\s)(a)(?:\s+\$?[\d]|\s*[:=])/i },
  { tipo: 'Devolución', regex: /(?:^|\s)(d)(?:\s+\$?[\d]|\s*[:=]|\s*$)/i }
];

/**
 * Detecta mensajes informativos de apertura, cierre, inicio de turno/día/caja o avisos operativos.
 * Estos mensajes se envían para avisar a los integrantes del grupo (ej: "Inicio Día 20-11-2026", "CIERRE DEL DIA 19/11")
 * pero NO representan transacciones contables y DEBEN ser ignorados por completo, sin colocar reacciones ni registrar nada.
 */
export function isSystemStatusOrInformationalMessage(text) {
  if (!text || typeof text !== 'string') return false;
  const norm = normalizeText(text);
  if (!norm || norm.length < 2) return false;

  // 1. Mensajes que comienzan con indicadores de inicio/cierre/apertura/saludo
  if (/^(?:inicio|iniciamos|iniciando|iniciar|cierre|cerrando|cerrado|cerrar|apertura|abriendo|abierta|abierto|abrir|fin\s+de\s+(?:turno|dia|jornada)|saludos?|aviso|comunicado)\b/i.test(norm)) {
    return true;
  }

  // 2. Patrones que combinen inicio/cierre/apertura con conceptos de tiempo o caja
  // ej: "cierre del dia 19/11", "inicio dia 20-11-2026", "apertura de caja", "cierre de turno"
  if (/\b(?:inicio|iniciamos|iniciando|cierre|cerrando|cerrado|apertura|abriendo)\b.*?\b(?:dia|dias|fecha|turno|turnos|caja|cajas|jornada|labores|operacion|operaciones)\b/i.test(norm)) {
    return true;
  }

  // 3. Frases de apertura o cierre comunes
  if (/\b(?:cierre|inicio|apertura)\s+del?\s+(?:dia|turno|caja|jornada)\b/i.test(norm)) {
    return true;
  }

  // 4. Mensajes exactos o muy cortos
  if (/^(?:cierre|inicio|apertura|abierto|cerrado)$/i.test(norm)) {
    return true;
  }

  return false;
}

// Diccionario de Cajas (conservado para limpiar el texto y no contaminar nombres)
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

  // FILTRO GLOBAL: Si es un mensaje informativo de inicio, cierre, apertura de turno/día/caja, ignorar inmediatamente
  if (isSystemStatusOrInformationalMessage(clean)) {
    return null;
  }

  // 1. Extraer Nota (si existe "nota: ...", "ref: ...", "obs: ...")
  let nota = '';
  let textWithoutNota = clean;
  const notaMatch = clean.match(/(?:nota|obs|observacion|observación|ref|referencia):\s*(.*)$/i);
  if (notaMatch) {
    nota = notaMatch[1].trim();
    textWithoutNota = clean.slice(0, clean.indexOf(notaMatch[0])).trim();
  }

  // 2. Extraer Rango PRIMERO para proteger su número (ej. "rango 5" no debe extraer 5 como monto)
  // Soporta conectores antes del rango ("por rango 3", "en rango 1")
  let rango = null;
  let rangoExplicit = false;
  let rangoMatchedText = null;

  for (const rule of RANGO_RULES) {
    const connectorRegex = new RegExp(`(?:\\b(?:en|por|de|del|al|a|para)\\s+)?${rule.regex.source}`, 'i');
    const m = textWithoutNota.match(connectorRegex);
    if (m) {
      rango = rule.rango;
      rangoExplicit = true;
      rangoMatchedText = m[0];
      break;
    }
  }

  if (!rango) {
    const genericRangoMatch = textWithoutNota.match(/(?:\b(?:en|por|de|del|al|a|para)\s+)?\b(rango\s+[a-zA-Z0-9áéíóúÁÉÍÓÚñÑ]+)\b/i);
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
  // IMPORTANTE: Normalizar texto sin tildes para evitar que palabras como "Día" 
  // hagan match erróneo con "a" por fronteras \b sobre caracteres acentuados.
  if (!tipo) {
    const textNormForSingle = normalizeText(textWithoutNota);
    for (const rule of TIPO_SINGLE_RULES) {
      const m = textNormForSingle.match(rule.regex);
      if (m) {
        tipo = rule.tipo;
        tipoMatchedText = m[1] || m[0];
        break;
      }
    }
  }

  if (!tipo) return null; // No es un mensaje de transacción de WISI

  const isAporteDev = (tipo === 'Aporte' || tipo === 'Devolución');

  // 4. Extraer Hora explícita si el mensaje la contiene (ej: "12:30", "00:45", "24:15")
  let hora = null;
  let horaMatchedText = null;
  const horaMatch = textWithoutNota.match(/\b([01]?\d|2[0-4]):([0-5]\d)(?::([0-5]\d))?\b/);
  if (horaMatch) {
    let h = horaMatch[1].padStart(2, '0');
    if (h === '24') h = '00';
    hora = `${h}:${horaMatch[2]}`;
    horaMatchedText = horaMatch[0];
  }

  // 5. Extraer Monto numérico
  // Enmascaramos el texto del RANGO, HORAS y FECHAS (ej. 20-11-2026, 19/11) para que sus números no se tomen como monto
  let textForMonto = textWithoutNota;

  // Enmascarar fechas (ej: 20-11-2026, 20/11/2026, 20-11, 20/11, 19/11, 2026-11-20)
  textForMonto = textForMonto.replace(/\b\d{1,4}[-/]\d{1,2}(?:[-/]\d{2,4})?\b/g, ' ');

  if (rangoMatchedText) {
    textForMonto = textForMonto.replace(rangoMatchedText, ' ');
  }
  if (horaMatchedText) {
    textForMonto = textForMonto.replace(horaMatchedText, ' ');
  } else {
    textForMonto = textForMonto.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ');
  }

  let monto = 0;
  let montoRaw = '';

  // Patrón numérico completo que soporta separadores de miles y decimales
  const NUM_PATTERN = '(?:\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?)';

  // Prioridad 1: Número con indicador monetario explícito ($1000, 1000$, 1000d, 1000usd, 1000bs, 1000 ref, etc.)
  const explicitMontoRegex = new RegExp(
    `(?:[\\$€£]|bs\\.?|ref\\.?)\\s*(${NUM_PATTERN})|(${NUM_PATTERN})\\s*(?:[\\$€£]|usd|usdt|bs\\.?|ref|dlls?|d[oó]lares?|divisas?|d\\b)`,
    'i'
  );
  const explicitMontoMatch = textForMonto.match(explicitMontoRegex);
  if (explicitMontoMatch) {
    montoRaw = explicitMontoMatch[0];
    const numStr = explicitMontoMatch[1] || explicitMontoMatch[2];
    monto = parseWhatsAppAmount(numStr);
  }

  // Prioridad 2: Cualquier número en el texto
  if (!monto || isNaN(monto) || monto <= 0) {
    const anyNumberRegex = new RegExp(`(?<![a-zA-Z0-9])(${NUM_PATTERN})(?:[a-zA-Z\\$]+)?`, 'i');
    const anyNumberMatch = textForMonto.match(anyNumberRegex);
    if (anyNumberMatch) {
      montoRaw = anyNumberMatch[0];
      const numStr = anyNumberMatch[1];
      monto = parseWhatsAppAmount(numStr);
    }
  }

  if (!monto || isNaN(monto) || monto <= 0) {
    return null; // Si no hay monto válido, se ignora
  }

  // 5. Detectar Caja (para limpiar el texto y no contaminar nombres)
  let caja = isAporteDev ? 'Máquinas' : (defaultOptions.caja_default || 'Mesas');
  let cajaExplicit = false;
  let cajaMatchedText = null;

  for (const rule of CAJA_RULES) {
    const connectorRegex = new RegExp(`(?:\\b(?:en|de|del|para)\\s+)?${rule.regex.source}`, 'i');
    const m = textWithoutNota.match(connectorRegex);
    if (m) {
      caja = rule.caja;
      cajaExplicit = true;
      cajaMatchedText = m[0];
      break;
    }
  }

  // 6. Detectar Método de Pago (SOLO para Control de Clientes; en Aportes/Devoluciones NO aplica)
  // Soporta conectores previos: "en efectivo", "por pdv", "con zelle", etc.
  let metodo = isAporteDev ? null : (defaultOptions.metodo_default || 'General');
  let metodoExplicit = false;
  let metodoMatchedText = null;

  if (!isAporteDev) {
    for (const rule of METODO_RULES) {
      const connectorRegex = new RegExp(`(?:\\b(?:en|por|con|de|del|al|a|para|via|vía)\\s+)?${rule.regex.source}`, 'i');
      const m = textWithoutNota.match(connectorRegex);
      if (m) {
        metodo = rule.metodo;
        metodoExplicit = true;
        metodoMatchedText = m[0];
        break;
      }
    }
  }

  // 8. Extraer Cliente (para Control de Clientes) u Operador (para Aportes/Devoluciones)
  let remaining = textWithoutNota;

  if (notaMatch) remaining = remaining.replace(notaMatch[0], ' ');
  if (rangoMatchedText) remaining = remaining.replace(rangoMatchedText, ' ');
  if (horaMatchedText) remaining = remaining.replace(horaMatchedText, ' ');
  if (tipoMatchedText) remaining = remaining.replace(new RegExp(`\\b${tipoMatchedText}\\b`, 'i'), ' ');
  if (montoRaw) remaining = remaining.replace(montoRaw, ' ');
  if (cajaMatchedText) remaining = remaining.replace(new RegExp(`\\b${cajaMatchedText}\\b`, 'i'), ' ');
  if (metodoMatchedText) remaining = remaining.replace(new RegExp(`\\b${metodoMatchedText}\\b`, 'i'), ' ');

  // Limpiar conectores, stopwords y palabras residuales para dejar solo el nombre contiguo
  const parsedName = cleanPersonName(remaining);

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
    hora,
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
