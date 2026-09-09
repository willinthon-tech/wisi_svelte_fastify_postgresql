import { isPgConnected, sql, inMemoryData } from '../config/db.js';
import {
  getDeviceUsers,
  addUserToDevice,
  setupCardInDevice,
  uploadFaceToDevice,
  deleteUserFromDevice,
  generarCardNoDesdeCedula
} from '../services/hikvision-isapi.service.js';

/**
 * Normaliza una cédula para comparaciones (elimina V, E, guiones y espacios)
 */
function normalizeCedula(str) {
  if (!str) return '';
  return String(str).trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/**
 * GET /api/biometricos/auditar-sala/:salaId
 * Audita todos los dispositivos biométricos y paneles de una sala
 */
export async function auditarSalaBiometricos(request, reply) {
  try {
    const { salaId } = request.params;
    const sId = Number(salaId);
    if (!sId || isNaN(sId)) {
      return reply.status(400).send({ success: false, error: 'ID de sala inválido' });
    }

    if (!isPgConnected || !sql) {
      return reply.status(500).send({ success: false, error: 'Base de datos no disponible' });
    }

    // 1. Obtener datos de la sala
    const salaRows = await sql`SELECT id, nombre, grupo_id FROM salas WHERE id = ${sId}`;
    if (salaRows.length === 0) {
      return reply.status(404).send({ success: false, error: 'Sala no encontrada' });
    }
    const sala = salaRows[0];

    // 2. Obtener dispositivos de la sala
    const dispositivos = await sql`
      SELECT id, nombre, sala_id, ip_local, ip_remota, ip_panel, usuario, clave
      FROM dispositivos
      WHERE sala_id = ${sId}
      ORDER BY id ASC
    `;

    if (dispositivos.length === 0) {
      return reply.send({
        success: true,
        sala,
        devices: [],
        message: 'No hay dispositivos registrados para esta sala'
      });
    }

    // 3. Obtener empleados activos de esta sala
    const activeEmployees = await sql`
      SELECT 
        e.id, e.nombre, e.cedula, e.foto, e.sexo, e.fecha_ingreso, e.activo,
        c.id AS cargo_id, c.nombre AS cargo_nombre,
        d.id AS departamento_id, d.nombre AS departamento_nombre,
        s.id AS sala_id, s.nombre AS sala_nombre
      FROM empleados e
      LEFT JOIN cargos c ON e.cargo_id = c.id
      LEFT JOIN areas a ON c.area_id = a.id
      LEFT JOIN departamentos d ON a.departamento_id = d.id
      LEFT JOIN salas s ON d.sala_id = s.id
      WHERE e.activo = true AND d.sala_id = ${sId}
      ORDER BY e.nombre ASC
    `;

    // 4. Obtener todos los empleados del sistema (para identificar si un usuario del biométrico es inactivo/desincorporado)
    const allSystemEmployees = await sql`
      SELECT id, nombre, cedula, activo, motivo_desincorporacion
      FROM empleados
    `;
    const systemEmpByCedula = new Map();
    for (const emp of allSystemEmployees) {
      const norm = normalizeCedula(emp.cedula);
      if (norm) {
        systemEmpByCedula.set(norm, emp);
      }
    }

    // 5. Obtener mapa de asignaciones en empleado_dispositivos
    const devIds = dispositivos.map(d => d.id);
    const empDevRows = await sql`
      SELECT empleado_id, dispositivo_id
      FROM empleado_dispositivos
      WHERE dispositivo_id = ANY(${devIds})
    `;
    // Set de claves `${empleado_id}_${dispositivo_id}`
    const assignedEmpDevSet = new Set(empDevRows.map(r => `${r.empleado_id}_${r.dispositivo_id}`));

    // 6. Auditar cada dispositivo en paralelo
    const auditedDevices = await Promise.all(dispositivos.map(async (dev) => {
      const result = {
        id: dev.id,
        nombre: dev.nombre,
        ip_remota: dev.ip_remota || '',
        ip_panel: dev.ip_panel || '',
        status: 'offline',
        panelStatus: dev.ip_panel ? 'offline' : null,
        error: null,
        panelError: null,
        totalEnDispositivo: 0,
        totalEnPanel: 0,
        sincronizados: [],
        faltan: [],
        sobran: []
      };

      if (!dev.ip_remota || dev.ip_remota === '—') {
        result.error = 'Sin IP remota configurada';
        return result;
      }

      // Consulta de usuarios en el biométrico físico
      let bioUsers = [];
      try {
        const bioRes = await getDeviceUsers(dev.ip_remota, dev.usuario || 'admin', dev.clave || '');
        bioUsers = bioRes.users || [];
        result.status = 'online';
        result.totalEnDispositivo = bioUsers.length;
      } catch (err) {
        result.status = 'error';
        result.error = err.message;
      }

      // Consulta de usuarios en el panel físico si tiene ip_panel
      let panelUsers = [];
      if (dev.ip_panel && dev.ip_panel.trim() && dev.ip_panel !== '—') {
        try {
          const panelRes = await getDeviceUsers(dev.ip_panel, dev.usuario || 'admin', dev.clave || '');
          panelUsers = panelRes.users || [];
          result.panelStatus = 'online';
          result.totalEnPanel = panelUsers.length;
        } catch (err) {
          result.panelStatus = 'error';
          result.panelError = err.message;
        }
      }

      // Mapear usuarios encontrados en el biométrico por cédula normalizada
      const bioUsersByCedula = new Map();
      for (const u of bioUsers) {
        const norm = normalizeCedula(u.employeeNo);
        if (norm) {
          bioUsersByCedula.set(norm, u);
        }
      }

      // Determinar qué empleados activos de la sala están asignados a este dispositivo
      // Si tienen registro en empleado_dispositivos o si aplican a este dispositivo
      const activeEmployeesForDev = activeEmployees.filter(emp => {
        return assignedEmpDevSet.has(`${emp.id}_${dev.id}`);
      });

      // Si ningún empleado tiene asignado este dispositivo específicamente, considerar a los empleados activos de la sala
      const targetEmployees = activeEmployeesForDev.length > 0 ? activeEmployeesForDev : activeEmployees;

      const matchedCedulas = new Set();

      // Comparativa 1: Empleados del sistema vs Biométrico
      for (const emp of targetEmployees) {
        const empNormCedula = normalizeCedula(emp.cedula);
        const bioUser = bioUsersByCedula.get(empNormCedula);

        if (bioUser) {
          matchedCedulas.add(empNormCedula);
          result.sincronizados.push({
            id: emp.id,
            nombre: emp.nombre,
            cedula: emp.cedula,
            foto: emp.foto,
            cargo_nombre: emp.cargo_nombre || 'Sin cargo',
            departamento_nombre: emp.departamento_nombre || 'Sin depto',
            deviceUser: {
              employeeNo: bioUser.employeeNo,
              name: bioUser.name,
              numOfCard: bioUser.numOfCard || 0,
              numOfFace: bioUser.numOfFace || 0
            }
          });
        } else {
          result.faltan.push({
            id: emp.id,
            nombre: emp.nombre,
            cedula: emp.cedula,
            foto: emp.foto,
            sexo: emp.sexo,
            cargo_nombre: emp.cargo_nombre || 'Sin cargo',
            departamento_nombre: emp.departamento_nombre || 'Sin depto',
            assignedInDb: assignedEmpDevSet.has(`${emp.id}_${dev.id}`)
          });
        }
      }

      // Comparativa 2: Usuarios en Biométrico que no corresponden a empleados activos asignados
      for (const u of bioUsers) {
        const uNorm = normalizeCedula(u.employeeNo);
        if (!matchedCedulas.has(uNorm)) {
          // Buscar si existe en la base de datos como inactivo o de otra sala
          const sysEmp = systemEmpByCedula.get(uNorm);
          result.sobran.push({
            employeeNo: u.employeeNo,
            name: u.name || 'Sin nombre en equipo',
            numOfCard: u.numOfCard || 0,
            numOfFace: u.numOfFace || 0,
            systemStatus: sysEmp 
              ? (sysEmp.activo ? 'Activo en otra sala' : `Desincorporado: ${sysEmp.motivo_desincorporacion || 'Inactivo'}`)
              : 'No registrado en sistema',
            systemEmployeeId: sysEmp ? sysEmp.id : null,
            systemEmployeeName: sysEmp ? sysEmp.nombre : null
          });
        }
      }

      return result;
    }));

    return reply.send({
      success: true,
      sala,
      devices: auditedDevices,
      totalActiveEmployees: activeEmployees.length
    });
  } catch (err) {
    console.error('Error en auditarSalaBiometricos:', err);
    return reply.status(500).send({ success: false, error: err.message });
  }
}

/**
 * POST /api/biometricos/agregar-empleados
 * Agrega empleados seleccionados a un biométrico (y su panel si corresponde)
 */
export async function agregarEmpleadosABiometrico(request, reply) {
  try {
    const { dispositivo_id, empleado_ids, target = 'both' } = request.body || {};
    const dId = Number(dispositivo_id);
    if (!dId || isNaN(dId)) {
      return reply.status(400).send({ success: false, error: 'Dispositivo inválido' });
    }

    if (!Array.isArray(empleado_ids) || empleado_ids.length === 0) {
      return reply.status(400).send({ success: false, error: 'Debe especificar al menos un empleado' });
    }

    if (!isPgConnected || !sql) {
      return reply.status(500).send({ success: false, error: 'Base de datos no disponible' });
    }

    const [dev] = await sql`
      SELECT id, nombre, sala_id, ip_remota, ip_panel, usuario, clave
      FROM dispositivos
      WHERE id = ${dId}
    `;

    if (!dev) {
      return reply.status(404).send({ success: false, error: 'Dispositivo no encontrado' });
    }

    const eIds = empleado_ids.map(Number).filter(Boolean);
    const empleados = await sql`
      SELECT id, nombre, cedula, sexo, foto, fecha_ingreso
      FROM empleados
      WHERE id = ANY(${eIds})
    `;

    const results = [];
    const savedConfigRows = await sql`SELECT clave, valor FROM configuracion`;
    const configMap = {};
    for (const r of savedConfigRows) configMap[r.clave] = r.valor;
    const publicDomain = configMap.isapi_ip_domain || 'willinthon.wisi.space';

    for (const emp of empleados) {
      const empRes = {
        empleado_id: emp.id,
        nombre: emp.nombre,
        cedula: emp.cedula,
        biometrico: { success: false, message: '' },
        panel: dev.ip_panel ? { success: false, message: '' } : null
      };

      // 1. Agregar a Biométrico
      if (dev.ip_remota && (target === 'both' || target === 'bio')) {
        try {
          const userRes = await addUserToDevice(dev.ip_remota, dev.usuario || 'admin', dev.clave || '', emp, false);
          if (userRes.ok || userRes.status === 200) {
            empRes.biometrico.success = true;
            empRes.biometrico.message = 'Usuario agregado exitosamente';

            // Tarjeta
            const cardNo = generarCardNoDesdeCedula(emp.cedula);
            if (cardNo) {
              try {
                await setupCardInDevice(dev.ip_remota, dev.usuario || 'admin', dev.clave || '', emp.cedula, cardNo);
              } catch (cardErr) {
                console.warn(`Aviso al registrar tarjeta ${cardNo}:`, cardErr.message);
              }
            }

            // Foto
            if (emp.foto) {
              const photoUrl = `http://${publicDomain}${emp.foto}`;
              try {
                await uploadFaceToDevice(dev.ip_remota, dev.usuario || 'admin', dev.clave || '', emp.cedula, emp.nombre, emp.sexo, photoUrl);
              } catch (faceErr) {
                console.warn(`Aviso al registrar foto:`, faceErr.message);
              }
            }
          } else {
            empRes.biometrico.message = `El biométrico respondió HTTP ${userRes.status}`;
          }
        } catch (bioErr) {
          empRes.biometrico.message = bioErr.message;
        }
      }

      // 2. Agregar a Panel si existe
      if (dev.ip_panel && dev.ip_panel.trim() && (target === 'both' || target === 'panel')) {
        try {
          const panelRes = await addUserToDevice(dev.ip_panel, dev.usuario || 'admin', dev.clave || '', emp, true);
          if (panelRes.ok || panelRes.status === 200) {
            empRes.panel.success = true;
            empRes.panel.message = 'Usuario agregado a panel';

            const cardNo = generarCardNoDesdeCedula(emp.cedula);
            if (cardNo) {
              try {
                await setupCardInDevice(dev.ip_panel, dev.usuario || 'admin', dev.clave || '', emp.cedula, cardNo);
              } catch (cardErr) {}
            }
          } else {
            empRes.panel.message = `El panel respondió HTTP ${panelRes.status}`;
          }
        } catch (panelErr) {
          empRes.panel.message = panelErr.message;
        }
      }

      // 3. Asegurar asignación en empleado_dispositivos
      try {
        const existingRel = await sql`
          SELECT id FROM empleado_dispositivos 
          WHERE empleado_id = ${emp.id} AND dispositivo_id = ${dId} 
          LIMIT 1
        `;
        if (existingRel.length === 0) {
          await sql`
            INSERT INTO empleado_dispositivos (id, empleado_id, dispositivo_id)
            VALUES (
              (SELECT COALESCE(MAX(id), 0) + 1 FROM empleado_dispositivos),
              ${emp.id},
              ${dId}
            )
          `;
        }
      } catch (dbErr) {
        console.error('Error insertando en empleado_dispositivos:', dbErr);
      }

      results.push(empRes);
    }

    const successCount = results.filter(r => r.biometrico.success || (r.panel && r.panel.success)).length;
    return reply.send({
      success: true,
      processed: results.length,
      successCount,
      results
    });
  } catch (err) {
    console.error('Error en agregarEmpleadosABiometrico:', err);
    return reply.status(500).send({ success: false, error: err.message });
  }
}

/**
 * POST /api/biometricos/eliminar-usuarios
 * Elimina usuarios de un biométrico (y su panel si corresponde)
 */
export async function eliminarUsuariosDeBiometrico(request, reply) {
  try {
    const { dispositivo_id, employee_nos, target = 'both' } = request.body || {};
    const dId = Number(dispositivo_id);
    if (!dId || isNaN(dId)) {
      return reply.status(400).send({ success: false, error: 'Dispositivo inválido' });
    }

    if (!Array.isArray(employee_nos) || employee_nos.length === 0) {
      return reply.status(400).send({ success: false, error: 'Debe especificar al menos un número de empleado / cédula' });
    }

    if (!isPgConnected || !sql) {
      return reply.status(500).send({ success: false, error: 'Base de datos no disponible' });
    }

    const [dev] = await sql`
      SELECT id, nombre, sala_id, ip_remota, ip_panel, usuario, clave
      FROM dispositivos
      WHERE id = ${dId}
    `;

    if (!dev) {
      return reply.status(404).send({ success: false, error: 'Dispositivo no encontrado' });
    }

    const results = [];
    for (const empNo of employee_nos) {
      const cleanNo = String(empNo).trim().toUpperCase();
      const itemRes = {
        employeeNo: cleanNo,
        biometrico: { success: false, message: '' },
        panel: dev.ip_panel ? { success: false, message: '' } : null
      };

      // 1. Eliminar de Biométrico
      if (dev.ip_remota && (target === 'both' || target === 'bio')) {
        try {
          const delRes = await deleteUserFromDevice(dev.ip_remota, dev.usuario || 'admin', dev.clave || '', cleanNo, false);
          if (delRes.ok || delRes.status === 200) {
            itemRes.biometrico.success = true;
            itemRes.biometrico.message = 'Usuario eliminado del biométrico';
          } else {
            itemRes.biometrico.message = `El biométrico respondió HTTP ${delRes.status}`;
          }
        } catch (bioErr) {
          itemRes.biometrico.message = bioErr.message;
        }
      }

      // 2. Eliminar de Panel
      if (dev.ip_panel && dev.ip_panel.trim() && (target === 'both' || target === 'panel')) {
        try {
          const panelDelRes = await deleteUserFromDevice(dev.ip_panel, dev.usuario || 'admin', dev.clave || '', cleanNo, true);
          if (panelDelRes.ok || panelDelRes.status === 200) {
            itemRes.panel.success = true;
            itemRes.panel.message = 'Usuario eliminado del panel';
          } else {
            itemRes.panel.message = `El panel respondió HTTP ${panelDelRes.status}`;
          }
        } catch (panelErr) {
          itemRes.panel.message = panelErr.message;
        }
      }

      // 3. Si existe empleado con esta cédula, remover la relación de empleado_dispositivos
      try {
        const empMatch = await sql`
          SELECT id FROM empleados 
          WHERE REPLACE(REPLACE(UPPER(COALESCE(cedula, '')), 'V', ''), '-', '') = ${cleanNo.replace(/V|-/g, '')}
          LIMIT 1
        `;
        if (empMatch.length > 0) {
          await sql`
            DELETE FROM empleado_dispositivos 
            WHERE empleado_id = ${empMatch[0].id} AND dispositivo_id = ${dId}
          `;
        }
      } catch (dbErr) {
        console.error('Error limpiando empleado_dispositivos:', dbErr);
      }

      results.push(itemRes);
    }

    const successCount = results.filter(r => r.biometrico.success || (r.panel && r.panel.success)).length;
    return reply.send({
      success: true,
      processed: results.length,
      successCount,
      results
    });
  } catch (err) {
    console.error('Error en eliminarUsuariosDeBiometrico:', err);
    return reply.status(500).send({ success: false, error: err.message });
  }
}
