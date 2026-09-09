import { sql, isPgConnected } from '../config/db.js';
import { getConfiguracionModel, getDbTimezone } from './master.model.js';

// Helper: Convert time string "HH:MM" or "HH:MM:SS" to total minutes
function toMinutes(timeStr) {
  if (!timeStr) return null;
  const parts = String(timeStr).split(':').map(Number);
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  return parts[0] * 60 + parts[1];
}

// Helper: Format minutes to "HH:MM"
function toHHMM(totalMinutes) {
  if (totalMinutes === null || totalMinutes === undefined || isNaN(totalMinutes) || totalMinutes < 0) return '00:00';
  const h = Math.floor(totalMinutes / 60);
  const m = Math.floor(totalMinutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Helper: Day of week spanish letter
function getDiaSemanaLetra(dateObj) {
  const letters = ['D', 'L', 'M', 'M', 'J', 'V', 'S']; // Sunday=0
  return letters[dateObj.getUTCDay()];
}

// Helper: Month spanish name
function getMesNombre(monthIndex) {
  const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return months[monthIndex];
}

// Helper: Parse raw event_time into local dateStr, timeStr, and minutes
function parseAttlogTime(rawTime) {
  if (!rawTime) return null;

  let y, m, d, h, min, s;

  if (rawTime instanceof Date) {
    if (isNaN(rawTime.getTime())) return null;
    y = rawTime.getFullYear();
    m = rawTime.getMonth() + 1;
    d = rawTime.getDate();
    h = rawTime.getHours();
    min = rawTime.getMinutes();
    s = rawTime.getSeconds();
  } else {
    const str = String(rawTime).trim().replace('T', ' ');
    const parts = str.split(' ');
    const datePart = parts[0];
    const timePart = parts.length > 1 ? parts[1].split('.')[0].split('+')[0].replace('Z', '') : '00:00:00';

    [y, m, d] = datePart.split('-').map(Number);
    [h, min, s] = timePart.split(':').map(Number);
  }

  if (isNaN(y) || isNaN(m) || isNaN(d) || isNaN(h) || isNaN(min)) return null;

  const dateStr = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const timeStr = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  const minsFromMidnight = h * 60 + min;

  return {
    dateStr,
    timeStr,
    hours: h,
    minutes: min,
    minsFromMidnight,
    timestamp: new Date(y, m - 1, d, h, min, s || 0).getTime()
  };
}

// Helper: Find best matching plantilla from a candidate list based on entry punch proximity
function findBestMatchingPlantilla(firstPunchMins, candidatesList, maxToleranceMins = 240) {
  if (firstPunchMins === null || !candidatesList || candidatesList.length === 0) return null;

  let bestPlantilla = null;
  let minDiff = maxToleranceMins;

  for (const p of candidatesList) {
    if (!p || !p.hora_entrada) continue;
    const pEntMins = toMinutes(p.hora_entrada);
    if (pEntMins === null) continue;

    let diff = Math.abs(firstPunchMins - pEntMins);
    // Support wrap-around for late night entries near midnight
    if (diff > 720) {
      diff = 1440 - diff;
    }

    if (diff < minDiff) {
      minDiff = diff;
      bestPlantilla = p;
    }
  }

  return bestPlantilla;
}

// Plantillas Base del Sistema (Constantes Compartidas)
export const BASE_PLANTILLA_LIBRE = {
  id: 'SYS-L',
  codigo: 'L',
  nombre: 'Libre',
  color: '#D9D9D9',
  tipo: 'plantilla'
};

export const BASE_PLANTILLA_UNICO = {
  id: 'SYS-U',
  codigo: 'U',
  nombre: 'Horario Único',
  color: '#86EFAC',
  tipo: 'horario'
};

/**
 * Motor central de acotejo inteligente de asistencia:
 * 1. "no puede existir una salida sin entrada".
 * 2. Si no hay entrada válida (checkIn/E): No puede existir salida.
 *    (Si tiene marcajes 'O' sin entrada, se marca ERROR con 0h trabajadas).
 * 3. Selección de Entrada:
 *    - Horario Único: primer entrada del día.
 *    - Horario Asignado: entrada más lógica cercana a las plantillas asignadas.
 * 4. Selección de Salida:
 *    - Horario Asignado: salida más lógica cercana a hora_salida asignada.
 *    - Horario Único: salida más lógica / más cercana >= 4h (en el día o día siguiente sin chocar con el día siguiente).
 *    - Si no hay salidas >= 4h pero hay salida: toma la salida disponible (marcará ERROR por < 4h).
 * 5. Clasificación:
 *    - Menos de 4 horas (< 240m): ERROR.
 *    - Antes de las 7:00 PM (19:00): DIURNO.
 *    - Mayor a 7:00 PM y <= 11:00 PM (23:00): MIXTO (D) HH:MM - (N) HH:MM.
 *    - Después de las 11:00 PM (> 23:00) o amanecida (cruce de día / <= 05:00 AM): NOCTURNO.
 */
export function pairDayAttendance({
  punchesToday = [],
  nextDayPunches = [],
  targetPlantillas = [],
  isExcepcion = false,
  excepObj = null,
  dateStr = '',
  todayStr = ''
}) {
  let entradaStr = null;
  let salidaStr = null;
  let trabajadosMins = 0;
  let marcajeStr = 'Sin Registros';
  let resultadoStr = '';
  let entBadge = null;
  let salBadge = null;
  let selectedEntry = null;
  let selectedExit = null;
  let matchedPlantilla = null;
  let isNoEntryWithOtherPunches = false;

  if (isExcepcion && excepObj) {
    const excepCode = String(excepObj.excepcion_codigo || excepObj.plantilla_codigo || excepObj.codigo || '').toUpperCase().trim();
    // REGLA: Sólo es trabajado si tiene MÍNIMO 2 caracteres y termina en 'T' (ej: LT, FERT, TT, DT).
    // Si el código es 'T' de 1 solo caracter, es una excepción normal y NO hace nada de trabajo.
    const isTrabajadoCode = Boolean(excepCode && excepCode.length >= 2 && excepCode.endsWith('T'));

    // Determinar descripción exacta y respetada de la excepción
    let desc = (excepObj.excepcion_nombre || excepObj.nombre || excepObj.descripcion || excepObj.plantilla_nombre || '').trim().toUpperCase();
    if (excepCode === 'LT') {
      desc = 'LIBRE TRABAJADO';
    } else if (excepCode === 'FERT') {
      desc = 'FERIADO TRABAJADO';
    } else if (excepCode === 'DT') {
      desc = 'DESCANSO TRABAJADO';
    } else if (excepCode === 'RT') {
      desc = 'REPOSO TRABAJADO';
    } else if (excepCode === 'VT') {
      desc = 'VACACIONES TRABAJADAS';
    } else if (excepCode === 'PT') {
      desc = 'PERMISO TRABAJADO';
    } else if (isTrabajadoCode && !desc.includes('TRABAJAD')) {
      desc = `${desc} TRABAJADO`.trim();
    } else if (!desc || desc === 'LIBRE') {
      if (excepCode === 'FER') desc = 'DÍA FERIADO';
      else if (excepCode === 'R') desc = 'REPOSO MÉDICO';
      else if (excepCode === 'V') desc = 'VACACIONES';
      else if (excepCode === 'P') desc = 'PERMISO';
      else if (excepCode === 'F') desc = 'FALTA';
      else desc = 'LIBRE';
    }

    if (!isTrabajadoCode) {
      // Excepción normal NO trabajada (ej. FER, R, V, P, F, L, o código T solitario):
      // "te dije que no aparecera nada alli si alguien marca al menos que alla una excepcion que finalice en T"
      // Se devuelven horas 0 y marcaje vacío para que jamás muestre horas o marcajes en la celda.
      return {
        entradaStr: null,
        salidaStr: null,
        trabajadosMins: 0,
        marcajeStr: '',
        resultadoStr: desc,
        entBadge: null,
        salBadge: null,
        selectedEntry: null,
        selectedExit: null,
        matchedPlantilla: BASE_PLANTILLA_LIBRE,
        isNoEntryWithOtherPunches: false
      };
    } else {
      // Excepción trabajada (código >= 2 caracteres y termina en 'T', ej: LT, FERT, TT):
      const availableToday = punchesToday.filter(p => !p.consumed);
      const checkinPunches = availableToday.filter(p => p.isCheckInFlag || p.type === 'E' || p.isCheckIn);
      if (checkinPunches.length === 0) {
        return {
          entradaStr: null,
          salidaStr: null,
          trabajadosMins: 0,
          marcajeStr: '',
          resultadoStr: desc,
          entBadge: null,
          salBadge: null,
          selectedEntry: null,
          selectedExit: null,
          matchedPlantilla: BASE_PLANTILLA_LIBRE,
          isNoEntryWithOtherPunches: false
        };
      }
      // Si tiene marcajes, continúa hacia abajo para emparejar entrada/salida y calcular desglose (D) y (N) tal como Horario Único (U)
    }
  }

  const availableToday = punchesToday.filter(p => !p.consumed);
  const checkinPunches = availableToday.filter(p => p.isCheckInFlag || p.type === 'E' || p.isCheckIn);
  const otherPunches = availableToday.filter(p => p.isOtherFlag || p.type === 'O' || p.isOther);

  // REGLA 1: No puede existir una salida sin entrada
  if (checkinPunches.length === 0) {
    // Caso 1A: No hay ni 'E' ni 'O' (día sin marcajes o solo 'S' de ayer) -> LIBRE en GRIS
    if (otherPunches.length === 0) {
      entradaStr = null;
      salidaStr = null;
      marcajeStr = 'Sin Registros';
      trabajadosMins = 0;
      if (isExcepcion && excepObj) {
        let desc = (excepObj.excepcion_nombre || excepObj.nombre || excepObj.descripcion || excepObj.plantilla_nombre || '').trim().toUpperCase();
        if (!desc || desc === 'LIBRE') {
          const c = String(excepObj.excepcion_codigo || excepObj.codigo || '').toUpperCase();
          if (c === 'FER' || c === 'FERT') desc = 'DÍA FERIADO';
          else if (c === 'R' || c === 'RT') desc = 'REPOSO MÉDICO';
          else if (c === 'V' || c === 'VT') desc = 'VACACIONES';
          else if (c === 'P' || c === 'PT') desc = 'PERMISO';
          else if (c === 'F' || c === 'FT') desc = 'FALTA';
          else desc = 'LIBRE';
        }
        resultadoStr = desc;
      } else {
        resultadoStr = 'LIBRE';
      }

      return {
        entradaStr,
        salidaStr,
        trabajadosMins,
        marcajeStr,
        resultadoStr,
        entBadge: null,
        salBadge: null,
        selectedEntry: null,
        selectedExit: null,
        matchedPlantilla: null, // Asignará L en gris (#D9D9D9)
        isNoEntryWithOtherPunches: false
      };
    }

    // Caso 1B: Hay registros 'O' pero NO hay 'E'.
    // "ese dia viene siendo un u en rojo si el empleado no tiene horario asignado porque sino seria el horario mas cercano en rojo"
    const firstOther = otherPunches[0];
    entradaStr = firstOther.timeStr || firstOther.time;
    salidaStr = null;
    marcajeStr = entradaStr;
    trabajadosMins = 0;
    resultadoStr = 'ERROR';
    isNoEntryWithOtherPunches = true;

    const activePlantillas = matchedPlantilla
      ? [matchedPlantilla]
      : (targetPlantillas && targetPlantillas.length > 0 ? targetPlantillas : []);

    if (activePlantillas.length === 0) {
      // Sin horario asignado -> Horario Único (U) en ROJO
      matchedPlantilla = {
        ...BASE_PLANTILLA_UNICO,
        color: '#dc2626'
      };
    } else {
      // Con horario asignado -> El horario más cercano en ROJO
      const punchMins = firstOther.minsFromMidnight ?? toMinutes(firstOther.timeStr || firstOther.time);
      let bestPlant = activePlantillas[0];
      let minDiff = Infinity;

      for (const plant of activePlantillas) {
        if (!plant.hora_entrada) continue;
        const pEnt = toMinutes(plant.hora_entrada);
        if (pEnt === null) continue;
        let diff = Math.abs(punchMins - pEnt);
        if (diff > 720) diff = 1440 - diff;
        if (diff < minDiff) {
          minDiff = diff;
          bestPlant = plant;
        }
      }

      matchedPlantilla = {
        ...bestPlant,
        color: '#dc2626'
      };
    }

    return {
      entradaStr,
      salidaStr,
      trabajadosMins,
      marcajeStr,
      resultadoStr,
      entBadge: null,
      salBadge: null,
      selectedEntry: null, // NO marcar ninguna 'O' como entrada
      selectedExit: null,  // NO marcar ninguna 'O' como salida
      matchedPlantilla,
      isNoEntryWithOtherPunches: true
    };
  }

  // REGLA 2: Selección de la Entrada (cuando sí hay 'E')
  const activePlantillas = matchedPlantilla
    ? [matchedPlantilla]
    : (targetPlantillas && targetPlantillas.length > 0 ? targetPlantillas : []);

  if (activePlantillas.length === 0) {
    // Horario Único: primer entrada del día
    selectedEntry = checkinPunches[0];
    if (!matchedPlantilla) {
      matchedPlantilla = BASE_PLANTILLA_UNICO;
    }
  } else {
    // Horario Asignado: entrada más lógica cercana a una de las plantillas asignadas
    let bestEntry = null;
    let minEntryDiff = Infinity;
    let bestPlant = matchedPlantilla;

    for (const cp of checkinPunches) {
      const punchMins = cp.minsFromMidnight ?? toMinutes(cp.timeStr || cp.time);
      for (const plant of activePlantillas) {
        if (!plant.hora_entrada) continue;
        const plantEntMins = toMinutes(plant.hora_entrada);
        if (plantEntMins === null) continue;
        let diff = Math.abs(punchMins - plantEntMins);
        if (diff > 720) diff = 1440 - diff;
        if (diff < minEntryDiff) {
          minEntryDiff = diff;
          bestEntry = cp;
          bestPlant = plant;
        }
      }
    }

    selectedEntry = bestEntry || checkinPunches[0];
    if (bestPlant) {
      matchedPlantilla = bestPlant;
    } else if (!matchedPlantilla) {
      matchedPlantilla = activePlantillas[0];
    }
  }

  selectedEntry.consumed = true;
  selectedEntry.isUsedEntry = true;
  entradaStr = selectedEntry.timeStr || selectedEntry.time;

  // REGLA 3: Selección de la Salida (únicamente marcajes tipo 'S')
  const sameDayCandidates = availableToday.filter(p => !p.consumed && (p.isCheckOutFlag || p.type === 'S' || p.isCheckOut) && p.timestamp > selectedEntry.timestamp);

  // Candidatos día siguiente que no choquen con el registro del día siguiente
  const nextDayFirstEntry = nextDayPunches.find(p => (p.isCheckInFlag || p.type === 'E' || p.isCheckIn) && !p.consumed);
  const nextDayS = nextDayPunches.filter(p => {
    if (p.consumed) return false;
    if (!p.isCheckOutFlag && p.type !== 'S' && !p.isCheckOut) return false;
    if (p.timestamp <= selectedEntry.timestamp) return false;
    if (nextDayFirstEntry && p.timestamp >= nextDayFirstEntry.timestamp) return false;
    const diffH = (p.timestamp - selectedEntry.timestamp) / (1000 * 3600);
    return diffH >= 0 && diffH <= 18;
  });
  const nextDayAll = nextDayPunches.filter(p => {
    if (p.consumed) return false;
    if (p.timestamp <= selectedEntry.timestamp) return false;
    if (nextDayFirstEntry && p.timestamp >= nextDayFirstEntry.timestamp) return false;
    const diffH = (p.timestamp - selectedEntry.timestamp) / (1000 * 3600);
    return diffH >= 0 && diffH <= 18;
  });
  const nextDayCandidates = nextDayS.length > 0 ? nextDayS : nextDayAll;

  const allExitCandidates = [...sameDayCandidates, ...nextDayCandidates];

  if (allExitCandidates.length > 0) {
    if (matchedPlantilla && matchedPlantilla.hora_salida && matchedPlantilla.codigo !== 'U') {
      // Horario Asignado: la salida más lógica dependiendo de su horario asignado
      const schedSalMins = toMinutes(matchedPlantilla.hora_salida);
      let bestExit = null;
      let minExitDiff = Infinity;

      for (const cand of allExitCandidates) {
        const candMins = cand.minsFromMidnight ?? toMinutes(cand.timeStr || cand.time);
        let diff = Math.abs(candMins - schedSalMins);
        if (diff > 720) diff = 1440 - diff;
        if (diff < minExitDiff) {
          minExitDiff = diff;
          bestExit = cand;
        }
      }

      selectedExit = bestExit || allExitCandidates[0];
    } else {
      // Horario Único: la más lógica >= 4 horas con respecto a la entrada
      const candidatesGte4h = allExitCandidates.filter(cand => {
        const diffMins = Math.floor((cand.timestamp - selectedEntry.timestamp) / 60000);
        return diffMins >= 240;
      });

      if (candidatesGte4h.length > 0) {
        const firstValid = candidatesGte4h[0];
        const cluster = candidatesGte4h.filter(c => Math.abs(c.timestamp - firstValid.timestamp) <= 15 * 60 * 1000);
        selectedExit = cluster[cluster.length - 1];
      } else {
        selectedExit = allExitCandidates[0];
      }
    }
  }

  if (selectedExit) {
    selectedExit.consumed = true;
    selectedExit.isUsedExit = true;
    if (selectedExit.dateStr && selectedEntry.dateStr && selectedExit.dateStr !== selectedEntry.dateStr) {
      selectedExit.isCrossDayExit = true;
    }
    salidaStr = selectedExit.timeStr || selectedExit.time;
    trabajadosMins = Math.floor((selectedExit.timestamp - selectedEntry.timestamp) / 60000);
    marcajeStr = `${entradaStr} - ${salidaStr}`;

    // Consumir todos los marcajes intermedios entre la entrada y la salida para no dejar marcajes huérfanos
    punchesToday.forEach(p => {
      if (p.timestamp >= selectedEntry.timestamp && p.timestamp <= selectedExit.timestamp) {
        p.consumed = true;
      }
    });
    nextDayPunches.forEach(p => {
      if (p.timestamp >= selectedEntry.timestamp && p.timestamp <= selectedExit.timestamp) {
        p.consumed = true;
      }
    });
  } else {
    salidaStr = null;
    marcajeStr = `${entradaStr}`;
  }

  // REGLA 4: Clasificación del Turno
  if (!salidaStr) {
    if (dateStr >= todayStr) {
      resultadoStr = 'EN ESPERA';
    } else {
      resultadoStr = 'ERROR';
    }
  } else {
    const HORA_7PM = 19 * 60;   // 19:00 (7:00 PM)
    const HORA_11PM = 23 * 60;  // 23:00 (11:00 PM)
    const HORA_5AM = 5 * 60;    // 05:00 AM

    const entMins = toMinutes(entradaStr);
    const salMins = toMinutes(salidaStr);
    const isCrossDay = selectedExit.isCrossDayExit || (selectedExit.dateStr && selectedEntry.dateStr && selectedExit.dateStr !== selectedEntry.dateStr);

    if (trabajadosMins < 240) {
      resultadoStr = 'ERROR';
    } else {
      const esNocturno = isCrossDay || salMins < entMins || salMins > HORA_11PM || salMins <= HORA_5AM;

      if (esNocturno) {
        resultadoStr = 'NOCTURNO';
      } else if (salMins <= HORA_7PM) {
        resultadoStr = 'DIURNO';
      } else if (salMins > HORA_7PM && salMins <= HORA_11PM) {
        const diurnasMins = Math.max(0, HORA_7PM - entMins);
        const nocturnasMins = Math.max(0, salMins - HORA_7PM);
        resultadoStr = `(D) ${toHHMM(diurnasMins)} - (N) ${toHHMM(nocturnasMins)}`;
      } else {
        resultadoStr = 'DIURNO';
      }
    }

    // Badges de puntualidad si la plantilla tiene hora programada
    if (matchedPlantilla && matchedPlantilla.hora_entrada) {
      const schedEntMins = toMinutes(matchedPlantilla.hora_entrada);
      if (schedEntMins !== null) {
        const diffEnt = entMins - schedEntMins;
        if (diffEnt > 0) {
          entBadge = { text: toHHMM(diffEnt), isAlert: true, color: '#dc2626', bg: '#fff1f2', border: '#fecdd3' };
        } else {
          entBadge = { text: toHHMM(Math.abs(diffEnt)), isAlert: false, color: '#166534', bg: '#f0fdf4', border: '#bbf7d0' };
        }
      }
    }

    if (matchedPlantilla && matchedPlantilla.hora_salida && salidaStr) {
      const schedSalMins = toMinutes(matchedPlantilla.hora_salida);
      if (schedSalMins !== null) {
        const diffSal = schedSalMins - salMins;
        if (diffSal > 0) {
          salBadge = { text: toHHMM(diffSal), isAlert: true, color: '#dc2626', bg: '#fff1f2', border: '#fecdd3' };
        } else {
          salBadge = { text: toHHMM(Math.abs(diffSal)), isAlert: false, color: '#166534', bg: '#f0fdf4', border: '#bbf7d0' };
        }
      }
    }
  }

  return {
    entradaStr,
    salidaStr,
    trabajadosMins,
    marcajeStr,
    resultadoStr,
    entBadge,
    salBadge,
    selectedEntry,
    selectedExit,
    matchedPlantilla,
    isNoEntryWithOtherPunches
  };
}

export async function getMarcajePersonalReportModel(params = {}) {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  let fechaDesdeStr = params.fecha_desde || todayStr;
  let fechaHastaStr = params.fecha_hasta || fechaDesdeStr;

  // Regla estricta: Máximo hasta el día en curso (hoy)
  if (fechaHastaStr > todayStr) {
    fechaHastaStr = todayStr;
  }
  if (fechaDesdeStr > todayStr) {
    fechaDesdeStr = todayStr;
  }

  const userSalaIds = params.user_sala_ids
    ? String(params.user_sala_ids).split(',').map(Number).filter(Boolean)
    : [];

  const salaIds = params.sala_ids
    ? String(params.sala_ids).split(',').map(Number).filter(Boolean)
    : (params.sala_id ? [Number(params.sala_id)].filter(Boolean) : []);

  let dispositivoIds = null;
  if (params.dispositivo_ids && String(params.dispositivo_ids).trim().length > 0) {
    const parsedDisp = String(params.dispositivo_ids).split(',').map(n => Number(n.trim())).filter(n => !isNaN(n));
    if (parsedDisp.length > 0) dispositivoIds = parsedDisp;
  }
  const departamentoIds = params.departamento_ids
    ? String(params.departamento_ids).split(',').map(Number).filter(Boolean)
    : (params.departamento_id ? [Number(params.departamento_id)].filter(Boolean) : []);
  const areaIds = params.area_ids
    ? String(params.area_ids).split(',').map(Number).filter(Boolean)
    : (params.area_id ? [Number(params.area_id)].filter(Boolean) : []);
  const cargoIds = params.cargo_ids
    ? String(params.cargo_ids).split(',').map(Number).filter(Boolean)
    : (params.cargo_id ? [Number(params.cargo_id)].filter(Boolean) : []);
  const sexoList = params.sexo
    ? String(params.sexo).split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    : [];
  const search = params.search ? String(params.search).trim().toLowerCase() : '';

  // 1. Build list of days in date range (strictly up to today)
  const startDate = new Date(`${fechaDesdeStr}T00:00:00Z`);
  const endDate = new Date(`${fechaHastaStr}T00:00:00Z`);

  const daysList = [];
  let curr = new Date(startDate);
  while (curr <= endDate) {
    daysList.push(new Date(curr));
    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  // Group months for header
  const monthsMap = new Map();
  daysList.forEach(d => {
    const key = `${getMesNombre(d.getUTCMonth())} ${d.getUTCFullYear()}`;
    monthsMap.set(key, (monthsMap.get(key) || 0) + 1);
  });
  const mesesAgrupados = Array.from(monthsMap.entries()).map(([nombre, colspan]) => ({ nombre, colspan }));

  const diasDelMes = daysList.map(d => ({
    fechaStr: d.toISOString().split('T')[0],
    num: d.getUTCDate(),
    diaSemana: getDiaSemanaLetra(d),
    rawDate: d
  }));

  if (!sql) {
    return { success: true, mesesAgrupados, diasDelMes, salas: [] };
  }

  // 2. Fetch active employees
  let empWhere = [sql`(e.activo IS TRUE OR e.activo IS NULL)`];
  if (userSalaIds && userSalaIds.length > 0) {
    empWhere.push(sql`d.sala_id = ANY(${userSalaIds})`);
  }
  if (salaIds && salaIds.length > 0) {
    empWhere.push(sql`d.sala_id = ANY(${salaIds})`);
  }
  if (departamentoIds && departamentoIds.length > 0) {
    empWhere.push(sql`d.id = ANY(${departamentoIds})`);
  }
  if (areaIds && areaIds.length > 0) {
    empWhere.push(sql`a.id = ANY(${areaIds})`);
  }
  if (cargoIds && cargoIds.length > 0) {
    empWhere.push(sql`c.id = ANY(${cargoIds})`);
  }
  if (sexoList && sexoList.length > 0) {
    empWhere.push(sql`UPPER(COALESCE(e.sexo, '')) = ANY(${sexoList})`);
  }
  if (search) {
    const pattern = `%${search}%`;
    empWhere.push(sql`(
      LOWER(COALESCE(e.nombre, '')) LIKE ${pattern} OR
      LOWER(COALESCE(e.cedula, '')) LIKE ${pattern} OR
      LOWER(COALESCE(c.nombre, '')) LIKE ${pattern} OR
      LOWER(COALESCE(d.nombre, '')) LIKE ${pattern} OR
      LOWER(COALESCE(s.nombre, '')) LIKE ${pattern}
    )`);
  }

  const whereClause = sql`WHERE ${empWhere.reduce((acc, cond) => sql`${acc} AND ${cond}`)}`;

  const employees = await sql`
    SELECT 
      e.id,
      e.nombre,
      e.cedula,
      e.foto,
      e.sexo,
      d.sala_id,
      s.nombre AS sala_nombre,
      d.id AS departamento_id,
      d.nombre AS departamento_nombre,
      c.id AS cargo_id,
      c.nombre AS cargo_nombre,
      a.id AS area_id,
      a.nombre AS area_nombre
    FROM empleados e
    LEFT JOIN cargos c ON e.cargo_id = c.id
    LEFT JOIN areas a ON c.area_id = a.id
    LEFT JOIN departamentos d ON a.departamento_id = d.id
    LEFT JOIN salas s ON d.sala_id = s.id
    ${whereClause}
    ORDER BY s.nombre ASC, d.nombre ASC, e.nombre ASC
  `;

  if (employees.length === 0) {
    return { success: true, mesesAgrupados, diasDelMes, salas: [] };
  }

  const empIds = employees.map(e => e.id);

  // 3. Fetch Direct Individual Employee Shift Assignments (empleados_horarios)
  const empDirectPlantillasMap = new Map();
  const directAssignments = await sql`
    SELECT eph.empleado_id, ph.id, ph.codigo, ph.nombre, ph.hora_entrada, ph.hora_salida, ph.color
    FROM empleados_horarios eph
    JOIN horarios ph ON eph.horario_id = ph.id
    WHERE eph.empleado_id = ANY(${empIds})
    ORDER BY ph.hora_entrada ASC, ph.codigo ASC
  `;
  directAssignments.forEach(da => {
    if (!empDirectPlantillasMap.has(da.empleado_id)) {
      empDirectPlantillasMap.set(da.empleado_id, []);
    }
    empDirectPlantillasMap.get(da.empleado_id).push(da);
  });

  // 4. Fetch Exceptions for date range (empleados_excepciones_horarios)
  const excepcionesMap = new Map();
  if (isPgConnected && sql) {
    try {
      const excepciones = await sql`
        SELECT eh.id, eh.empleado_id, TO_CHAR(eh.fecha, 'YYYY-MM-DD') AS fecha_str, eh.horario_id AS plantilla_horario_id, eh.horario_id, eh.excepcion_id, eh.es_libre, eh.observacion,
               ph.codigo AS plantilla_codigo, ph.nombre AS plantilla_nombre, ph.hora_entrada, ph.hora_salida, ph.color AS plantilla_color,
               exc.codigo AS excepcion_codigo, exc.descripcion AS excepcion_nombre, exc.color AS excepcion_color, exc.tipo AS excepcion_tipo
        FROM empleados_excepciones_horarios eh
        LEFT JOIN horarios ph ON eh.horario_id = ph.id
        LEFT JOIN excepciones exc ON eh.excepcion_id = exc.id
        WHERE eh.empleado_id = ANY(${empIds})
          AND eh.fecha >= ${fechaDesdeStr}::date
          AND eh.fecha <= ${fechaHastaStr}::date
      `;
      excepciones.forEach(ex => {
        const key = `${ex.empleado_id}_${ex.fecha_str}`;
        excepcionesMap.set(key, {
          ...ex,
          codigo: ex.excepcion_codigo || ex.plantilla_codigo || (ex.es_libre ? 'L' : 'EX'),
          nombre: ex.excepcion_nombre || ex.plantilla_nombre || (ex.es_libre ? 'Libre' : 'Excepción'),
          color: ex.excepcion_color || ex.plantilla_color || (ex.es_libre ? '#D9D9D9' : '#3B82F6')
        });
      });
    } catch (e) {
      console.warn('Warning fetching empleados_excepciones_horarios:', e.message);
    }
  }

  // 5. Fetch Attendance Logs for date range
  const config = await getConfiguracionModel();
  const tz = getDbTimezone(config);

  const extendedMinDate = new Date(`${fechaDesdeStr}T00:00:00Z`);
  extendedMinDate.setUTCDate(extendedMinDate.getUTCDate() - 2);
  const minDateStr = `${extendedMinDate.toISOString().split('T')[0]} 00:00:00`;

  const maxDateEnd = new Date(endDate);
  maxDateEnd.setUTCDate(maxDateEnd.getUTCDate() + 1);
  const maxDateStr = `${maxDateEnd.toISOString().split('T')[0]} 23:59:59`;

  // Match employee_no supporting all variations: cedula with 'V', without 'V', and employee id
  const allCedulasSet = new Set();
  const keyToEmpIdMap = new Map();

  employees.forEach(e => {
    if (e.id) {
      const idStr = String(e.id);
      allCedulasSet.add(idStr);
      keyToEmpIdMap.set(idStr, e.id);
    }
    const rawCed = String(e.cedula || '').trim();
    if (rawCed) {
      allCedulasSet.add(rawCed);
      keyToEmpIdMap.set(rawCed, e.id);

      const cleanCed = rawCed.replace(/^[VE]/i, '').trim();
      if (cleanCed) {
        allCedulasSet.add(cleanCed);
        allCedulasSet.add(`V${cleanCed}`);
        allCedulasSet.add(`v${cleanCed}`);
        allCedulasSet.add(`E${cleanCed}`);
        allCedulasSet.add(`e${cleanCed}`);
        keyToEmpIdMap.set(cleanCed, e.id);
        keyToEmpIdMap.set(`V${cleanCed}`.toUpperCase(), e.id);
        keyToEmpIdMap.set(`E${cleanCed}`.toUpperCase(), e.id);
      }
    }
  });

  const allCedulas = Array.from(allCedulasSet);

  let attlogWhere = [
    sql`employee_no = ANY(${allCedulas})`,
    sql`(event_time AT TIME ZONE ${tz}) >= ${minDateStr}::timestamp`,
    sql`(event_time AT TIME ZONE ${tz}) <= ${maxDateStr}::timestamp`
  ];

  if (dispositivoIds && dispositivoIds.length > 0) {
    attlogWhere.push(sql`dispositivo_id = ANY(${dispositivoIds})`);
  }

  const attWhereClause = sql`WHERE ${attlogWhere.reduce((acc, cond) => sql`${acc} AND ${cond}`)}`;

  const attlogs = await sql`
    SELECT id, dispositivo_id, employee_no, to_char(event_time AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS event_time, attendancestatus, currentverifymode
    FROM attlogs
    ${attWhereClause}
    ORDER BY event_time ASC
  `;

  // Map attlogs by employee ID and dateStr
  const logsByEmpAndDate = new Map();
  attlogs.forEach(log => {
    const rawEmpKey = String(log.employee_no || '').trim();
    const cleanKey = rawEmpKey.replace(/^[VE]/i, '').trim();
    const empId = keyToEmpIdMap.get(rawEmpKey) || keyToEmpIdMap.get(cleanKey) || keyToEmpIdMap.get(`V${cleanKey}`.toUpperCase()) || keyToEmpIdMap.get(`E${cleanKey}`.toUpperCase());
    if (!empId) return;

    const parsed = parseAttlogTime(log.event_time);
    if (!parsed) return;

    const rawStatus = String(log.attendancestatus || '').toLowerCase().trim();
    const isCheckInFlag = rawStatus.includes('checkin') || rawStatus.includes('entrada') || rawStatus === '0';
    const isCheckOutFlag = rawStatus.includes('checkout') || rawStatus.includes('salida') || rawStatus === '1';
    const isOtherFlag = !isCheckInFlag && !isCheckOutFlag;
    const type = isCheckInFlag ? 'E' : (isCheckOutFlag ? 'S' : 'O');

    const fullKey = `${empId}_${parsed.dateStr}`;
    if (!logsByEmpAndDate.has(fullKey)) {
      logsByEmpAndDate.set(fullKey, []);
    }
    logsByEmpAndDate.get(fullKey).push({
      ...parsed,
      id: log.id,
      isCheckInFlag,
      isCheckOutFlag,
      isOtherFlag,
      type,
      rawStatus: log.attendancestatus,
      consumed: false
    });
  });

  // 6. Multi-Pass Attendance Calculation Engine for Individual Employees
  const evaluateSingleEmployee = async (emp) => {
    // Get individual assigned shift plantillas for this employee
    const assignedPlantillas = empDirectPlantillasMap.get(emp.id) || [];
    const hasCustomHorario = assignedPlantillas.length > 0;

    // Build raw punches list per day for this employee using emp.id
    const empPunchesByDate = new Map();
    diasDelMes.forEach(diaObj => {
      const dateStr = diaObj.fechaStr;
      const punchesToday = Array.from(logsByEmpAndDate.get(`${emp.id}_${dateStr}`) || []);
      punchesToday.sort((a, b) => a.timestamp - b.timestamp);
      empPunchesByDate.set(dateStr, punchesToday);
    });

    // Evaluate each day in date range
    const diasResult = diasDelMes.map((diaObj, dayIdx) => {
      const dateStr = diaObj.fechaStr;
      const punchesToday = empPunchesByDate.get(dateStr) || [];

      const dCurr = new Date(`${dateStr}T00:00:00Z`);
      dCurr.setUTCDate(dCurr.getUTCDate() + 1);
      const nextDateStr = dCurr.toISOString().split('T')[0];
      const nextDayPunches = empPunchesByDate.get(nextDateStr) || [];

      // Check for Override for this employee and date
      const exKey = `${emp.id}_${dateStr}`;
      const excepObj = excepcionesMap.get(exKey);

      // DISTINCIÓN CLAVE: 
      // 1. Tabla 'horarios': horario_id asignado (con o sin 'T' en su código, es un HORARIO DE TRABAJO regular).
      // 2. Tabla 'excepciones': excepcion_id asignado (o día libre sin horario_id).
      const isHorarioOverride = Boolean(excepObj && excepObj.horario_id && !excepObj.excepcion_id);
      const isExcepcion = Boolean(excepObj && !isHorarioOverride);
      const excepcionId = isExcepcion && excepObj ? excepObj.id : null;

      let effectiveTargetPlantillas = assignedPlantillas;
      if (isHorarioOverride) {
        // Horario de trabajo asignado desde la tabla 'horarios' (ej: T, T1, M, AT, CT)
        effectiveTargetPlantillas = [{
          id: excepObj.horario_id,
          codigo: excepObj.plantilla_codigo || 'H',
          nombre: excepObj.plantilla_nombre || 'Horario',
          hora_entrada: excepObj.hora_entrada,
          hora_salida: excepObj.hora_salida,
          color: excepObj.plantilla_color || excepObj.color || '#86EFAC',
          tipo: 'horario'
        }];
      } else if (isExcepcion) {
        // Excepción de la tabla 'excepciones' (FER, R, V, P, F, L, FERT, LT, etc.)
        effectiveTargetPlantillas = [];
      } else {
        effectiveTargetPlantillas = assignedPlantillas;
      }

      const paired = pairDayAttendance({
        punchesToday,
        nextDayPunches,
        targetPlantillas: effectiveTargetPlantillas,
        isExcepcion,
        excepObj: isExcepcion ? excepObj : null,
        dateStr,
        todayStr
      });

      const entradaStr = paired.entradaStr;
      const salidaStr = paired.salidaStr;
      const marcajeStr = paired.marcajeStr;
      const trabajadosMins = paired.trabajadosMins;
      const resultadoStr = paired.resultadoStr;
      const matchedPlantilla = paired.matchedPlantilla;
      let entBadge = paired.entBadge;
      let salBadge = paired.salBadge;

      // Badges por defecto para días sin retraso o libres
      if (!entBadge) {
        entBadge = { text: '00:00', isAlert: false, color: '#94a3b8', bg: '#f8fafc', border: '#e2e8f0' };
      }
      if (!salBadge) {
        salBadge = { text: '00:00', isAlert: false, color: '#94a3b8', bg: '#f8fafc', border: '#e2e8f0' };
      }

      // Resolver código, color, nombre y tipo de plantilla para el badge
      let shiftId = null;
      let shiftCode = 'L';
      let shiftColor = '#D9D9D9';
      let shiftNombre = 'Libre';
      let shiftTipo = 'plantilla';

      if (isExcepcion && excepObj) {
        // Excepción de la tabla 'excepciones'
        const exCode = String(excepObj.excepcion_codigo || excepObj.codigo || '').toUpperCase().trim();
        const isTrabCode = Boolean(exCode && exCode.length >= 2 && exCode.endsWith('T'));
        let exDesc = (excepObj.excepcion_nombre || excepObj.nombre || excepObj.descripcion || '').trim();
        if (exCode === 'LT') {
          exDesc = 'Libre Trabajado';
        } else if (exCode === 'FERT') {
          exDesc = 'Feriado Trabajado';
        } else if (exCode === 'DT') {
          exDesc = 'Descanso Trabajado';
        } else if (exCode === 'RT') {
          exDesc = 'Reposo Trabajado';
        } else if (exCode === 'VT') {
          exDesc = 'Vacaciones Trabajadas';
        } else if (exCode === 'PT') {
          exDesc = 'Permiso Trabajado';
        } else if (isTrabCode && !exDesc.toLowerCase().includes('trabajad')) {
          exDesc = `${exDesc} Trabajado`.trim();
        } else if (!exDesc || exDesc.toUpperCase() === 'LIBRE') {
          if (exCode === 'FER') exDesc = 'Día Feriado';
          else if (exCode === 'R') exDesc = 'Reposo Médico';
          else if (exCode === 'V') exDesc = 'Vacaciones';
          else if (exCode === 'P') exDesc = 'Permiso';
          else if (exCode === 'F') exDesc = 'Falta';
          else exDesc = 'Día Libre';
        }

        shiftId = excepObj.excepcion_id || null;
        shiftCode = exCode || 'EX';
        shiftColor = excepObj.excepcion_color || (exCode === 'FER' || exCode === 'FERT' ? '#8B5CF6' : (exCode === 'R' ? '#EF4444' : (exCode === 'V' ? '#10B981' : (exCode === 'P' ? '#3B82F6' : '#7C3AED'))));
        shiftNombre = exDesc;
        shiftTipo = 'excepcion';
      } else if (isHorarioOverride) {
        // Horario asignado de la tabla 'horarios' (con o sin T, es un horario regular)
        shiftId = excepObj.horario_id;
        shiftCode = excepObj.plantilla_codigo || (matchedPlantilla ? matchedPlantilla.codigo : 'H');
        shiftColor = excepObj.plantilla_color || excepObj.color || (matchedPlantilla ? matchedPlantilla.color : '#86EFAC');
        shiftNombre = excepObj.plantilla_nombre || (matchedPlantilla ? matchedPlantilla.nombre : shiftCode);
        shiftTipo = 'horario';
      } else if (matchedPlantilla) {
        shiftId = (matchedPlantilla.id === 'SYS-U' || matchedPlantilla.id === 'SYS-L') ? null : matchedPlantilla.id;
        if (matchedPlantilla.id === 'SYS-U') {
          shiftCode = 'U';
          shiftColor = matchedPlantilla.color || '#3B82F6';
          shiftNombre = 'Horario Único';
        } else if (matchedPlantilla.id === 'SYS-L') {
          shiftCode = 'L';
          shiftColor = matchedPlantilla.color || '#D9D9D9';
          shiftNombre = 'Libre';
        } else {
          shiftCode = matchedPlantilla.codigo || (matchedPlantilla.nombre ? matchedPlantilla.nombre.trim().slice(0, 3).toUpperCase() : 'H');
          shiftColor = matchedPlantilla.color || '#86EFAC';
          shiftNombre = matchedPlantilla.nombre || shiftCode;
        }
        shiftTipo = 'horario';
      } else {
        shiftCode = 'L';
        shiftColor = '#D9D9D9';
        shiftNombre = 'Libre';
        shiftTipo = 'plantilla';
      }

      return {
        fechaStr: dateStr,
        isExcepcion,
        excepcionId,
        excepcion_tipo_id: isExcepcion && excepObj ? excepObj.excepcion_id : null,
        horario_id: excepObj ? (excepObj.horario_id || excepObj.plantilla_horario_id) : null,
        es_libre: isExcepcion && excepObj ? Boolean(excepObj.es_libre) : false,
        shift: {
          id: shiftId,
          codigo: shiftCode,
          nombre: shiftNombre,
          color: shiftColor,
          tipo: shiftTipo
        },
        marcajeStr,
        trabajadoStr: toHHMM(trabajadosMins),
        trabajadosMins,
        resultadoStr,
        entBadge,
        salBadge
      };
    });

    return {
      ...emp,
      horarios_asignados: assignedPlantillas,
      dias: diasResult
    };
  };

  // 7. High-speed Chunk Processing using Promise.all in batches of 25
  const chunkSize = 25;
  const employeesEvaluated = [];
  for (let i = 0; i < employees.length; i += chunkSize) {
    const chunk = employees.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(evaluateSingleEmployee));
    employeesEvaluated.push(...chunkResults);
  }

  // 8. Hierarchical Grouping by Sala -> Departamento
  const salasMap = new Map();

  for (const emp of employeesEvaluated) {
    const sId = emp.sala_id || 0;
    const sName = emp.sala_nombre || 'Sin Sala';
    const dId = emp.departamento_id || 0;
    const dName = emp.departamento_nombre || 'Sin Departamento';

    if (!salasMap.has(sId)) {
      salasMap.set(sId, { id: sId, nombre: sName, departamentosMap: new Map() });
    }
    const salaObj = salasMap.get(sId);

    if (!salaObj.departamentosMap.has(dId)) {
      salaObj.departamentosMap.set(dId, { id: dId, nombre: dName, empleados: [] });
    }
    salaObj.departamentosMap.get(dId).empleados.push(emp);
  }

  const salasFormatted = Array.from(salasMap.values()).map(sala => ({
    id: sala.id,
    nombre: sala.nombre,
    departamentos: Array.from(sala.departamentosMap.values())
  }));

  return {
    success: true,
    mesesAgrupados,
    diasDelMes,
    salas: salasFormatted,
    empleados: employeesEvaluated,
    totalEmpleados: employeesEvaluated.length
  };
}

// --- EXCEPCIONES ESPECIALES DE HORARIOS ---
export async function saveExcepcionHorarioModel(data) {
  if (!isPgConnected || !sql) return { success: false, error: 'Base de datos no conectada' };
  const empleado_id = Number(data.empleado_id);
  const fecha = String(data.fecha).trim();
  const horario_id = data.horario_id ? Number(data.horario_id) : (data.plantilla_horario_id ? Number(data.plantilla_horario_id) : null);
  const excepcion_id = data.excepcion_id ? Number(data.excepcion_id) : null;
  const observacion = data.observacion ? String(data.observacion).trim() : null;

  if (!empleado_id || !fecha) {
    return { success: false, error: 'empleado_id y fecha son requeridos' };
  }

  let es_libre = false;
  if (excepcion_id) {
    const [exc] = await sql`SELECT id, codigo, descripcion FROM excepciones WHERE id = ${excepcion_id}`;
    if (exc && (exc.codigo === 'L' || (exc.descripcion && exc.descripcion.toLowerCase().includes('libre')))) {
      es_libre = true;
    }
  } else if (horario_id) {
    const [p] = await sql`SELECT codigo, nombre, hora_entrada, hora_salida FROM horarios WHERE id = ${horario_id}`;
    if (p && (p.codigo === 'L' || (p.nombre && p.nombre.toUpperCase() === 'LIBRE'))) {
      es_libre = true;
    }
  } else {
    es_libre = true;
  }

  const [row] = await sql`
    INSERT INTO empleados_excepciones_horarios (empleado_id, fecha, horario_id, excepcion_id, es_libre, observacion, updated_at)
    VALUES (${empleado_id}, ${fecha}::date, ${horario_id}, ${excepcion_id}, ${es_libre}, ${observacion}, CURRENT_TIMESTAMP)
    ON CONFLICT (empleado_id, fecha) DO UPDATE
    SET horario_id = EXCLUDED.horario_id,
        excepcion_id = EXCLUDED.excepcion_id,
        es_libre = EXCLUDED.es_libre,
        observacion = EXCLUDED.observacion,
        updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `;

  return { success: true, data: row };
}

export async function saveExcepcionRangoHorarioModel(data) {
  if (!isPgConnected || !sql) return { success: false, error: 'Base de datos no conectada' };
  const empleado_id = Number(data.empleado_id);
  const fecha_desde = String(data.fecha_desde || '').trim();
  const fecha_hasta = String(data.fecha_hasta || '').trim();
  const horario_id = data.horario_id ? Number(data.horario_id) : (data.plantilla_horario_id ? Number(data.plantilla_horario_id) : null);
  const excepcion_id = data.excepcion_id ? Number(data.excepcion_id) : null;
  const observacion = data.observacion ? String(data.observacion).trim() : null;

  if (!empleado_id || !fecha_desde || !fecha_hasta) {
    return { success: false, error: 'empleado_id, fecha_desde y fecha_hasta son requeridos' };
  }

  if (fecha_desde > fecha_hasta) {
    return { success: false, error: 'La fecha de inicio no puede ser posterior a la fecha final' };
  }

  let es_libre = false;
  if (excepcion_id) {
    const [exc] = await sql`SELECT id, codigo, descripcion FROM excepciones WHERE id = ${excepcion_id}`;
    if (exc && (exc.codigo === 'L' || (exc.descripcion && exc.descripcion.toLowerCase().includes('libre')))) {
      es_libre = true;
    }
  } else if (horario_id) {
    const [p] = await sql`SELECT codigo, nombre, hora_entrada, hora_salida FROM horarios WHERE id = ${horario_id}`;
    if (p && (p.codigo === 'L' || (p.nombre && p.nombre.toUpperCase() === 'LIBRE'))) {
      es_libre = true;
    }
  } else {
    es_libre = true;
  }

  const rows = await sql`
    INSERT INTO empleados_excepciones_horarios (empleado_id, fecha, horario_id, excepcion_id, es_libre, observacion, updated_at)
    SELECT 
      ${empleado_id}, 
      d::date, 
      ${horario_id}, 
      ${excepcion_id},
      ${es_libre}, 
      ${observacion}, 
      CURRENT_TIMESTAMP
    FROM generate_series(${fecha_desde}::date, ${fecha_hasta}::date, '1 day'::interval) d
    ON CONFLICT (empleado_id, fecha) DO UPDATE
    SET horario_id = EXCLUDED.horario_id,
        excepcion_id = EXCLUDED.excepcion_id,
        es_libre = EXCLUDED.es_libre,
        observacion = EXCLUDED.observacion,
        updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `;

  return { success: true, count: rows.length, data: rows };
}

export async function deleteExcepcionHorarioModel(id) {
  if (!isPgConnected || !sql) return { success: false, error: 'Base de datos no conectada' };
  const eId = Number(id);
  if (!eId || isNaN(eId)) return { success: false, error: 'ID de excepción inválido' };

  await sql`DELETE FROM empleados_excepciones_horarios WHERE id = ${eId}`;
  return { success: true };
}

export async function getMarcajesRapidosModel({ empleado_id, fecha }) {
  if (!isPgConnected || !sql) return { success: false, error: 'Base de datos no conectada' };
  const empId = Number(empleado_id);
  const cleanDateStr = String(fecha || '').trim().split('T')[0].split(' ')[0];

  if (!empId || !cleanDateStr) {
    return { success: false, error: 'empleado_id y fecha son requeridos' };
  }

  const [emp] = await sql`
    SELECT id, cedula FROM empleados WHERE id = ${empId}
  `;
  if (!emp) return { success: false, error: 'Empleado no encontrado' };

  const rawCed = String(emp.cedula || '').trim();
  const cleanCed = rawCed.replace(/^[VE]/i, '').trim();
  const cedWithV = `V${cleanCed}`;
  const cedWithE = `E${cleanCed}`;
  const empIdStr = String(emp.id);

  const empKeys = [...new Set([
    empIdStr,
    rawCed,
    cleanCed,
    cedWithV,
    cedWithE,
    `v${cleanCed}`,
    `e${cleanCed}`
  ].filter(Boolean))];

  const parts = cleanDateStr.split('-').map(Number);
  if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) {
    return { success: false, error: 'Fecha inválida' };
  }

  const dCurr = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const dateStr = dCurr.toISOString().split('T')[0];

  const dPrev = new Date(dCurr);
  dPrev.setUTCDate(dPrev.getUTCDate() - 1);
  const prevDateStr = dPrev.toISOString().split('T')[0];

  const dNext = new Date(dCurr);
  dNext.setUTCDate(dNext.getUTCDate() + 1);
  const nextDateStr = dNext.toISOString().split('T')[0];

  const config = await getConfiguracionModel();
  const tz = getDbTimezone(config);

  const dPrevSafe = new Date(dPrev);
  dPrevSafe.setUTCDate(dPrevSafe.getUTCDate() - 1);
  const dNextSafe = new Date(dNext);
  dNextSafe.setUTCDate(dNextSafe.getUTCDate() + 1);

  const minDateStr = `${dPrevSafe.toISOString().split('T')[0]} 00:00:00`;
  const maxDateStr = `${dNextSafe.toISOString().split('T')[0]} 23:59:59`;

  const attlogs = await sql`
    SELECT id, employee_no, to_char(event_time AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS event_time, attendancestatus, currentverifymode
    FROM attlogs
    WHERE (
      employee_no = ANY(${empKeys})
      OR (LENGTH(${cleanCed}) > 0 AND REPLACE(REPLACE(REPLACE(UPPER(employee_no), 'V', ''), 'E', ''), '-', '') = ${cleanCed})
    )
      AND (event_time AT TIME ZONE ${tz}) >= ${minDateStr}::timestamp
      AND (event_time AT TIME ZONE ${tz}) <= ${maxDateStr}::timestamp
    ORDER BY event_time ASC
  `;

  // Parse all punches grouped by date
  const punchesByDate = new Map();
  [prevDateStr, dateStr, nextDateStr].forEach(fStr => {
    punchesByDate.set(fStr, []);
  });

  attlogs.forEach(log => {
    const parsed = parseAttlogTime(log.event_time);
    if (!parsed) return;
    if (!punchesByDate.has(parsed.dateStr)) return;

    const rawStatus = String(log.attendancestatus || '').toLowerCase().trim();
    const isCheckOut = rawStatus.includes('checkout') || rawStatus.includes('salida') || rawStatus === '1';
    const isCheckIn = rawStatus.includes('checkin') || rawStatus.includes('entrada') || rawStatus === '0';
    const isOther = !isCheckIn && !isCheckOut;
    const type = isCheckIn ? 'E' : (isCheckOut ? 'S' : 'O');
    const tipoTexto = isCheckIn ? 'Entrada' : (isCheckOut ? 'Salida' : 'Otros');

    punchesByDate.get(parsed.dateStr).push({
      id: log.id,
      time: parsed.timeStr,
      timestamp: parsed.timestamp,
      hours: parsed.hours,
      minutes: parsed.minutes,
      dateStr: parsed.dateStr,
      type,
      tipoTexto,
      rawStatus: log.attendancestatus,
      isCheckIn,
      isCheckOut,
      isOther,
      isUsedEntry: false,
      isUsedExit: false
    });
  });

  // Sort each date list chronologically
  [prevDateStr, dateStr, nextDateStr].forEach(fStr => {
    const list = punchesByDate.get(fStr) || [];
    list.sort((a, b) => a.timestamp - b.timestamp);
    punchesByDate.set(fStr, list);
  });

  // Obtener horarios directamente asignados al empleado y excepciones en el rango de 3 días
  const directAssignments = await sql`
    SELECT eph.empleado_id, ph.id, ph.codigo, ph.nombre, ph.hora_entrada, ph.hora_salida, ph.color
    FROM empleados_horarios eph
    JOIN horarios ph ON eph.horario_id = ph.id
    WHERE eph.empleado_id = ${empId}
    ORDER BY ph.hora_entrada ASC, ph.codigo ASC
  `;

  const excepciones = await sql`
    SELECT eh.id, eh.empleado_id, TO_CHAR(eh.fecha, 'YYYY-MM-DD') AS fecha_str, eh.horario_id AS plantilla_horario_id, eh.horario_id, eh.excepcion_id, eh.es_libre,
           ph.codigo AS plantilla_codigo, ph.nombre AS plantilla_nombre, ph.hora_entrada, ph.hora_salida, ph.color AS plantilla_color,
           exc.codigo AS excepcion_codigo, exc.descripcion AS excepcion_nombre, exc.color AS excepcion_color, exc.tipo AS excepcion_tipo
    FROM empleados_excepciones_horarios eh
    LEFT JOIN horarios ph ON eh.horario_id = ph.id
    LEFT JOIN excepciones exc ON eh.excepcion_id = exc.id
    WHERE eh.empleado_id = ${empId}
      AND eh.fecha = ANY(${[prevDateStr, dateStr, nextDateStr]}::date[])
  `;
  const exMap = new Map();
  excepciones.forEach(ex => {
    exMap.set(ex.fecha_str, {
      ...ex,
      codigo: ex.excepcion_codigo || ex.plantilla_codigo || (ex.es_libre ? 'L' : 'EX'),
      nombre: ex.excepcion_nombre || ex.plantilla_nombre || (ex.es_libre ? 'Libre' : 'Excepción'),
      color: ex.excepcion_color || ex.plantilla_color || (ex.es_libre ? '#D9D9D9' : '#3B82F6')
    });
  });

  // Determine which punches were actually taken as Entry and Exit for each day using the exact same central engine
  const evalDay = (dayStr, nextDayStr) => {
    const punchesToday = punchesByDate.get(dayStr) || [];
    const nextDayPunches = nextDayStr ? (punchesByDate.get(nextDayStr) || []) : [];
    const excepObj = exMap.get(dayStr);
    const isExcepcion = Boolean(excepObj);

    pairDayAttendance({
      punchesToday,
      nextDayPunches,
      targetPlantillas: directAssignments,
      isExcepcion,
      excepObj,
      dateStr: dayStr
    });
  };

  evalDay(prevDateStr, dateStr);
  evalDay(dateStr, nextDateStr);

  const getPunchesInfo = (fStr) => {
    const list = punchesByDate.get(fStr) || [];
    if (list.length === 0) return { punches: [], marcajesStr: 'Sin Registros' };

    const formattedList = list.map(p => ({
      id: p.id,
      time: p.time,
      timestamp: p.timestamp,
      type: p.type,
      tipoTexto: p.tipoTexto,
      rawStatus: p.rawStatus,
      isUsedEntry: Boolean(p.isUsedEntry),
      isUsedExit: Boolean(p.isUsedExit),
      isUsed: Boolean(p.isUsedEntry || p.isUsedExit)
    }));

    const marcajesStr = formattedList.map(p => `(${p.type}) ${p.time}`).join(', ');

    return {
      punches: formattedList,
      marcajesStr
    };
  };

  const prevInfo = getPunchesInfo(prevDateStr);
  const currInfo = getPunchesInfo(dateStr);
  const nextInfo = getPunchesInfo(nextDateStr);

  const marcajesContext = [
    { label: 'Día Anterior', fechaStr: prevDateStr, punches: prevInfo.punches, marcajesStr: prevInfo.marcajesStr },
    { label: 'Día Seleccionado', fechaStr: dateStr, punches: currInfo.punches, marcajesStr: currInfo.marcajesStr },
    { label: 'Día Siguiente', fechaStr: nextDateStr, punches: nextInfo.punches, marcajesStr: nextInfo.marcajesStr }
  ];

  return {
    success: true,
    marcajesContext,
    assignedPlantillas: directAssignments
  };
}

export async function updateAttlogStatusModel(id, status) {
  if (!sql) {
    return { success: false, error: 'Base de datos desconectada' };
  }
  let targetStatus = 'undefined';
  const clean = String(status || '').trim().toLowerCase();
  if (clean === 'checkin' || clean === 'e' || clean === '0' || clean === 'entrada') {
    targetStatus = 'checkIn';
  } else if (clean === 'checkout' || clean === 's' || clean === '1' || clean === 'salida') {
    targetStatus = 'checkOut';
  } else {
    targetStatus = 'undefined';
  }

  const result = await sql`
    UPDATE attlogs
    SET attendancestatus = ${targetStatus}
    WHERE id = ${id}
    RETURNING id, employee_no, to_char(event_time, 'YYYY-MM-DD HH24:MI:SS') AS event_time, attendancestatus
  `;

  if (!result || result.length === 0) {
    return { success: false, error: 'Marcaje no encontrado' };
  }

  return {
    success: true,
    data: result[0]
  };
}
