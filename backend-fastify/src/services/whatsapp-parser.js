/**
 * Parser inteligente de mensajes de WhatsApp para el sistema WISI.
 * Extrae: tipo, monto, método de pago, caja (Mesas/Máquinas), cliente/jugador y notas.
 */

export function parseWhatsAppMessage(text, defaultOptions = {}) {
  if (!text || typeof text !== 'string') return null;
  const clean = text.trim();
  if (clean.length < 3) return null;

  // 1. Detectar Tipo (primera palabra o token principal)
  let tipo = null;
  if (/^\b(compra|compras|c)\b/i.test(clean)) {
    tipo = 'Compra';
  } else if (/^\b(pago|pagos|p)\b/i.test(clean)) {
    tipo = 'Pago';
  } else if (/^\b(aporte|aportes|a)\b/i.test(clean)) {
    tipo = 'Aporte';
  } else if (/^\b(devolucion|devoluciones|devolución|dev|d)\b/i.test(clean)) {
    tipo = 'Devolución';
  }

  // Si no empieza con uno de estos comandos, se ignora
  if (!tipo) return null;

  // 2. Extraer Monto numérico
  const montoMatch = clean.match(/(?:\$|\b)\s*(\d+(?:[.,]\d{1,2})?)\s*(?:\$|\b)/);
  let monto = 0;
  if (montoMatch) {
    monto = parseFloat(montoMatch[1].replace(',', '.'));
  }
  if (!monto || isNaN(monto) || monto <= 0) {
    return null; // Si no hay monto válido, no es una transacción válida
  }

  // 3. Detectar Caja (Mesas o Máquinas)
  let caja = defaultOptions.caja_default || 'Mesas';
  if (/\b(maquinas|máquinas|maquina|máquina|maq|slots)\b/i.test(clean)) {
    caja = 'Máquinas';
  } else if (/\b(mesas|mesa|tables)\b/i.test(clean)) {
    caja = 'Mesas';
  }

  // 4. Detectar Método de Pago
  let metodo = defaultOptions.metodo_default || 'Cash';
  if (/\b(usdt|crypto|tether|binance)\b/i.test(clean)) {
    metodo = 'USDT';
  } else if (/\b(zelle)\b/i.test(clean)) {
    metodo = 'Zelle';
  } else if (/\b(pago\s*movil|pagomovil|pm)\b/i.test(clean)) {
    metodo = 'Pago Móvil';
  } else if (/\b(cash|dolares|dólares|efectivo|usd)\b/i.test(clean)) {
    metodo = 'Cash';
  } else if (/\b(punto|pos|debito|débito|tarjeta)\b/i.test(clean)) {
    metodo = 'Punto';
  } else if (/\b(transferencia|transf|banco)\b/i.test(clean)) {
    metodo = 'Transferencia';
  }

  // 5. Detectar Rango (si es Aporte/Devolución de máquinas)
  let rango = null;
  const rangoMatch = clean.match(/\b(rango\s*[0-9]+|ruleta\s*electronica|sin\s*rango)\b/i);
  if (rangoMatch) {
    rango = rangoMatch[1].trim();
  }

  // 6. Extraer Nota (si existe "nota: ...", "ref: ...", "obs: ...")
  let nota = '';
  let textWithoutNota = clean;
  const notaMatch = clean.match(/(?:nota|obs|observacion|observación|ref|referencia):\s*(.*)$/i);
  if (notaMatch) {
    nota = notaMatch[1].trim();
    textWithoutNota = clean.slice(0, clean.indexOf(notaMatch[0])).trim();
  }

  // 7. Extraer Cliente / Jugador o Empleado
  // Limpiamos los tokens ya detectados para que el remanente sea el nombre
  let remaining = textWithoutNota
    .replace(/^\b(compra|compras|pago|pagos|aporte|aportes|devolucion|devoluciones|devolución|dev)\b/i, '')
    .replace(/(?:\$|\b)\s*(\d+(?:[.,]\d{1,2})?)\s*(?:\$|\b)/, '')
    .replace(/\b(maquinas|máquinas|maquina|máquina|maq|slots|mesas|mesa|tables)\b/gi, '')
    .replace(/\b(usdt|crypto|tether|binance|zelle|pago\s*movil|pagomovil|cash|dolares|dólares|efectivo|usd|punto|pos|debito|débito|tarjeta|transferencia|transf|banco)\b/gi, '')
    .replace(/\b(rango\s*[0-9]+|ruleta\s*electronica|sin\s*rango)\b/gi, '')
    .replace(/[$:,.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let cliente = (tipo === 'Aporte' || tipo === 'Devolución') ? 'General' : (remaining || 'General');

  // Capitalizar nombre de cliente
  cliente = cliente
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  const modulo = (tipo === 'Aporte' || tipo === 'Devolución') 
    ? 'aportes_maquinas' 
    : (defaultOptions.modulo_destino || 'control_clientes');

  return {
    success: true,
    tipo,
    monto,
    metodo,
    caja,
    cliente,
    rango,
    nota,
    modulo
  };
}
