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

  // 3. Fetch Direct Individual Employee Shift Assignments (empleados_plantillas_horarios)
  const empDirectPlantillasMap = new Map();
  const directAssignments = await sql`
    SELECT eph.empleado_id, ph.id, ph.codigo, ph.nombre, ph.hora_entrada, ph.hora_salida, ph.color, ph.tipo
    FROM empleados_plantillas_horarios eph
    JOIN plantillas_horarios ph ON eph.plantilla_horario_id = ph.id
    WHERE eph.empleado_id = ANY(${empIds})
    ORDER BY ph.hora_entrada ASC, ph.codigo ASC
  `;
  directAssignments.forEach(da => {
    if (!empDirectPlantillasMap.has(da.empleado_id)) {
      empDirectPlantillasMap.set(da.empleado_id, []);
    }
    empDirectPlantillasMap.get(da.empleado_id).push(da);
  });

  // 4. Fetch Exceptions for date range (excepciones_horarios)
  const excepcionesMap = new Map();
  if (isPgConnected && sql) {
    try {
      const excepciones = await sql`
        SELECT eh.id, eh.empleado_id, TO_CHAR(eh.fecha, 'YYYY-MM-DD') AS fecha_str, eh.plantilla_horario_id, eh.es_libre, eh.observacion,
               ph.codigo AS plantilla_codigo, ph.nombre AS plantilla_nombre, ph.hora_entrada, ph.hora_salida, ph.color, ph.tipo
        FROM excepciones_horarios eh
        LEFT JOIN plantillas_horarios ph ON eh.plantilla_horario_id = ph.id
        WHERE eh.empleado_id = ANY(${empIds})
          AND eh.fecha >= ${fechaDesdeStr}::date
          AND eh.fecha <= ${fechaHastaStr}::date
      `;
      excepciones.forEach(ex => {
        const key = `${ex.empleado_id}_${ex.fecha_str}`;
        excepcionesMap.set(key, ex);
      });
    } catch (e) {
      console.warn('Warning fetching excepciones_horarios:', e.message);
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

  // Match employee_no strictly with e.cedula as stored in PostgreSQL
  const allCedulas = [...new Set(employees.map(e => String(e.cedula || '').trim()).filter(Boolean))];

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

  // Map attlogs by exact emp.cedula key and dateStr
  const logsByEmpAndDate = new Map();
  attlogs.forEach(log => {
    const rawEmpKey = String(log.employee_no || '').trim();
    const parsed = parseAttlogTime(log.event_time);
    if (!parsed) return;

    const rawStatus = String(log.attendancestatus || '').toLowerCase().trim();
    const isCheckInFlag = rawStatus.includes('checkin') || rawStatus.includes('entrada') || rawStatus === '0';
    const isCheckOutFlag = rawStatus.includes('checkout') || rawStatus.includes('salida') || rawStatus === '1';
    const isOtherFlag = !isCheckInFlag && !isCheckOutFlag;
    const type = isCheckInFlag ? 'E' : (isCheckOutFlag ? 'S' : 'O');

    const fullKey = `${rawEmpKey}_${parsed.dateStr}`;
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

  // Base System Templates (Hardcoded defaults)
  const BASE_PLANTILLA_LIBRE = {
    id: 'SYS-L',
    codigo: 'L',
    nombre: 'Libre',
    color: '#D9D9D9',
    tipo: 'plantilla'
  };

  const BASE_PLANTILLA_UNICO = {
    id: 'SYS-U',
    codigo: 'U',
    nombre: 'Horario Único',
    color: '#86EFAC',
    tipo: 'horario'
  };

  // 6. Multi-Pass Attendance Calculation Engine for Individual Employees
  const evaluateSingleEmployee = async (emp) => {
    const empCedulaKey = String(emp.cedula || '').trim();

    // Get individual assigned shift plantillas for this employee
    const assignedPlantillas = empDirectPlantillasMap.get(emp.id) || [];
    const hasCustomHorario = assignedPlantillas.length > 0;

    // Build raw punches list per day for this employee using exact e.cedula
    const empPunchesByDate = new Map();
    diasDelMes.forEach(diaObj => {
      const dateStr = diaObj.fechaStr;
      const punchesToday = Array.from(logsByEmpAndDate.get(`${empCedulaKey}_${dateStr}`) || []);
      punchesToday.sort((a, b) => a.timestamp - b.timestamp);
      empPunchesByDate.set(dateStr, punchesToday);
    });

    // Evaluate each day in date range
    const diasResult = diasDelMes.map((diaObj, dayIdx) => {
      const dateStr = diaObj.fechaStr;
      const punchesToday = (empPunchesByDate.get(dateStr) || []).filter(p => !p.consumed);

      let entradaStr = null;
      let salidaStr = null;
      let trabajadosMins = 0;
      let marcajeStr = 'Sin Registros';
      let resultadoStr = '';
      let entBadge = null;
      let salBadge = null;

      // Check for Excepcion Especial Override for this employee and date
      const exKey = `${emp.id}_${dateStr}`;
      const excepObj = excepcionesMap.get(exKey);

      let isExcepcion = false;
      let excepcionId = null;
      let matchedPlantilla = null;

      if (excepObj) {
        isExcepcion = true;
        excepcionId = excepObj.id;
        if (excepObj.es_libre || !excepObj.plantilla_horario_id) {
          matchedPlantilla = null;
        } else {
          matchedPlantilla = {
            id: excepObj.plantilla_horario_id,
            codigo: excepObj.plantilla_codigo,
            nombre: excepObj.plantilla_nombre,
            hora_entrada: excepObj.hora_entrada,
            hora_salida: excepObj.hora_salida,
            color: excepObj.color,
            tipo: excepObj.tipo
          };
        }
      }

      // --- LOGICA DE ENTRADA Y SALIDA ---
      // Regla estricta: Solo tomar en cuenta para Entrada los marcajes con checkIn
      // y para Salida los marcajes con checkOut posteriores a la Entrada.
      if (punchesToday.length > 0) {
        const checkinPunches = punchesToday.filter(p => p.isCheckInFlag);
        const firstEntryPunch = checkinPunches.length > 0 ? checkinPunches[0] : null;

        if (firstEntryPunch) {
          entradaStr = firstEntryPunch.timeStr;
          firstEntryPunch.consumed = true;

          // Buscar la salida correspondiente posterior a la entrada con checkOut
          const remainingPunches = punchesToday.filter(p => p !== firstEntryPunch && p.timestamp > firstEntryPunch.timestamp);

          if (remainingPunches.length > 0) {
            const checkoutPunches = remainingPunches.filter(p => p.isCheckOutFlag);
            const finalExitPunch = checkoutPunches.length > 0 
              ? checkoutPunches[checkoutPunches.length - 1] 
              : null;

            if (finalExitPunch) {
              const diffMins = Math.floor((finalExitPunch.timestamp - firstEntryPunch.timestamp) / (1000 * 60));
              if (diffMins >= 5) {
                salidaStr = finalExitPunch.timeStr;
                trabajadosMins = diffMins;
                finalExitPunch.consumed = true;
                marcajeStr = `${entradaStr} - ${salidaStr}`;
              } else {
                marcajeStr = `${entradaStr}`;
              }
            } else {
              marcajeStr = `${entradaStr}`;
            }
          } else if (firstEntryPunch.hours >= 15 && dayIdx + 1 < diasDelMes.length) {
            // Posible turno nocturno que sale en la madrugada del día siguiente con checkOut
            const nextDateStr = diasDelMes[dayIdx + 1].fechaStr;
            const nextDayPunches = (empPunchesByDate.get(nextDateStr) || []).filter(p => !p.consumed);

            if (nextDayPunches.length > 0) {
              const morningExits = nextDayPunches.filter(p => p.hours <= 12 && p.isCheckOutFlag);
              if (morningExits.length > 0) {
                const nightExitPunch = morningExits[0];
                const diffHours = (nightExitPunch.timestamp - firstEntryPunch.timestamp) / (1000 * 3600);
                if (diffHours >= 4 && diffHours <= 16) {
                  salidaStr = nightExitPunch.timeStr;
                  trabajadosMins = Math.floor((nightExitPunch.timestamp - firstEntryPunch.timestamp) / (1000 * 60));
                  nightExitPunch.consumed = true;
                  nightExitPunch.isCrossDayExit = true;
                  marcajeStr = `${entradaStr} - ${salidaStr}`;
                }
              }
            }
          }

          if (!salidaStr) {
            marcajeStr = `${entradaStr}`;
          }
        } else {
          entradaStr = null;
          salidaStr = null;
          marcajeStr = 'Sin Registros';
        }
      }

      // --- ASIGNACIÓN DE PLANTILLAS Y HORARIOS ---
      if (!isExcepcion) {
        if (hasCustomHorario) {
          // El empleado TIENE horarios asignados: buscar el que mejor encaje con su entrada
          if (entradaStr) {
            const firstPunchMins = toMinutes(entradaStr);
            matchedPlantilla = findBestMatchingPlantilla(firstPunchMins, assignedPlantillas, 240) || assignedPlantillas[0];
          } else {
            matchedPlantilla = null; // Día libre / sin marcaje
          }
        } else {
          // El empleado NO tiene horarios definidos:
          // Si tiene marcajes válidos -> Se asigna automáticamente Horario ÚNICO ('U')
          // Si NO tiene marcajes -> Se asigna automáticamente LIBRE ('L')
          if (entradaStr) {
            matchedPlantilla = BASE_PLANTILLA_UNICO;
          } else {
            matchedPlantilla = null; // Se traduce a BASE_PLANTILLA_LIBRE
          }
        }
      }

      const isLibre = !matchedPlantilla;

      // --- CALCULO DE RESULTADO Y BADGES ---
      if (!matchedPlantilla) {
        if (excepObj && excepObj.plantilla_codigo && excepObj.plantilla_codigo !== 'L') {
          resultadoStr = excepObj.plantilla_nombre || excepObj.plantilla_codigo;
        } else {
          resultadoStr = 'LIBRE';
        }
        if (!entradaStr) {
          marcajeStr = 'Sin Registros';
        }
      } else if (entradaStr && !salidaStr) {
        // Marcó entrada pero no marcó salida:
        // Si el día es HOY o futuro (dateStr >= todayStr) -> EN ESPERA (jornada laboral activa)
        // Si el día es PASADO (dateStr < todayStr) -> ERROR (falta marcaje salida)
        if (dateStr >= todayStr) {
          resultadoStr = 'EN ESPERA';
        } else {
          resultadoStr = 'ERROR';
        }
      } else if (entradaStr && salidaStr) {
        const entMins = toMinutes(entradaStr);
        const salMins = toMinutes(salidaStr);

        const HORA_7PM = 19 * 60;  // 19:00 (7:00 PM)
        const HORA_11PM = 23 * 60; // 23:00 (11:00 PM)
        const HORA_5AM = 5 * 60;   // 05:00 AM

        if (trabajadosMins < 240) {
          resultadoStr = 'ERROR';
        } else {
          const esNocturno = salMins < entMins || salMins > HORA_11PM || salMins <= HORA_5AM;

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

      // Badges por defecto para días sin retraso o libres
      if (!entBadge) {
        entBadge = { text: '00:00', isAlert: false, color: '#94a3b8', bg: '#f8fafc', border: '#e2e8f0' };
      }
      if (!salBadge) {
        salBadge = { text: '00:00', isAlert: false, color: '#94a3b8', bg: '#f8fafc', border: '#e2e8f0' };
      }

      // Resolver código, color y tipo de plantilla para el badge
      let shiftCode = 'L';
      let shiftColor = '#D9D9D9';
      let shiftTipo = 'plantilla';

      if (matchedPlantilla) {
        shiftCode = matchedPlantilla.codigo || 'U';
        shiftColor = matchedPlantilla.color || '#86EFAC';
        shiftTipo = matchedPlantilla.tipo || 'horario';
      } else if (excepObj && excepObj.plantilla_codigo) {
        shiftCode = excepObj.plantilla_codigo;
        shiftColor = excepObj.color || '#D9D9D9';
        shiftTipo = excepObj.tipo || 'plantilla';
      } else {
        shiftCode = 'L';
        shiftColor = '#D9D9D9';
        shiftTipo = 'plantilla';
      }

      return {
        fechaStr: dateStr,
        isExcepcion,
        excepcionId,
        shift: {
          codigo: shiftCode,
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
  const plantilla_horario_id = data.plantilla_horario_id ? Number(data.plantilla_horario_id) : null;
  const observacion = data.observacion ? String(data.observacion).trim() : null;

  if (!empleado_id || !fecha) {
    return { success: false, error: 'empleado_id y fecha son requeridos' };
  }

  let es_libre = false;
  if (plantilla_horario_id) {
    const [p] = await sql`SELECT codigo, tipo, hora_entrada, hora_salida FROM plantillas_horarios WHERE id = ${plantilla_horario_id}`;
    if (p && (p.codigo === 'L' || p.tipo === 'plantilla' || (!p.hora_entrada && !p.hora_salida))) {
      es_libre = true;
    }
  } else {
    es_libre = true;
  }

  const [row] = await sql`
    INSERT INTO excepciones_horarios (empleado_id, fecha, plantilla_horario_id, es_libre, observacion, updated_at)
    VALUES (${empleado_id}, ${fecha}::date, ${plantilla_horario_id}, ${es_libre}, ${observacion}, CURRENT_TIMESTAMP)
    ON CONFLICT (empleado_id, fecha) DO UPDATE
    SET plantilla_horario_id = EXCLUDED.plantilla_horario_id,
        es_libre = EXCLUDED.es_libre,
        observacion = EXCLUDED.observacion,
        updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `;

  return { success: true, data: row };
}

export async function deleteExcepcionHorarioModel(id) {
  if (!isPgConnected || !sql) return { success: false, error: 'Base de datos no conectada' };
  const eId = Number(id);
  if (!eId || isNaN(eId)) return { success: false, error: 'ID de excepción inválido' };

  await sql`DELETE FROM excepciones_horarios WHERE id = ${eId}`;
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

  const empKey1 = String(emp.id);
  const empKey2 = String(emp.cedula || '');

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

  const minDateStr = `${prevDateStr} 00:00:00`;
  const maxDateStr = `${nextDateStr} 23:59:59`;

  const attlogs = await sql`
    SELECT id, employee_no, to_char(event_time AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS event_time, attendancestatus, currentverifymode
    FROM attlogs
    WHERE (employee_no = ${empKey1} OR employee_no = ${empKey2})
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

  // Determine which punches were actually taken as Entry and Exit for the SELECTED DAY ONLY (dateStr)
  // Regla estricta: Solo tomar en cuenta para acotejar los que tengan checkIn como Entrada y checkOut como Salida
  const currList = punchesByDate.get(dateStr) || [];
  if (currList.length > 0) {
    const checkinPunches = currList.filter(p => p.isCheckIn);
    const firstEntryPunch = checkinPunches.length > 0 ? checkinPunches[0] : null;

    if (firstEntryPunch) {
      firstEntryPunch.isUsedEntry = true;

      // Remaining candidates on same day with checkOut
      const remaining = currList.filter(p => p !== firstEntryPunch && p.timestamp > firstEntryPunch.timestamp && p.isCheckOut);
      if (remaining.length > 0) {
        const finalExitPunch = remaining[remaining.length - 1];
        const diffMins = Math.floor((finalExitPunch.timestamp - firstEntryPunch.timestamp) / (1000 * 60));
        if (diffMins >= 5) {
          finalExitPunch.isUsedExit = true;
        }
      } else if (firstEntryPunch.hours >= 15) {
        // Cross-day night shift exit on morning of next day with checkOut
        const nextList = punchesByDate.get(nextDateStr) || [];
        const morningPunches = nextList.filter(p => p.hours <= 12 && p.isCheckOut);
        if (morningPunches.length > 0) {
          const nightExitPunch = morningPunches[0];
          const diffHours = (nightExitPunch.timestamp - firstEntryPunch.timestamp) / (1000 * 3600);
          if (diffHours >= 4 && diffHours <= 16) {
            nightExitPunch.isUsedExit = true;
          }
        }
      }
    }
  }

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
    marcajesContext
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
