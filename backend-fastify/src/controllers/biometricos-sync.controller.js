import { isPgConnected, sql, inMemoryData } from '../config/db.js';
import {
  getDeviceUsers,
  addUserToDevice,
  setupCardInDevice,
  uploadFaceToDevice,
  deleteUserFromDevice,
  generarCardNoDesdeCedula,
  getCedulaVariants
} from '../services/hikvision-isapi.service.js';

/**
 * Normaliza una cédula para comparaciones (elimina V, E, guiones y espacios)
 */
function normalizeCedula(str) {
  if (!str) return '';
  return String(str).trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function isUuid(val) {
  return typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim());
}

/**
 * GET /api/biometricos/auditar-sala/:salaId
 * Audita todos los dispositivos biométricos y paneles de una sala
 */
export async function auditarSalaBiometricos(request, reply) {
  try {
    const { salaId } = request.params;
    if (!salaId || !String(salaId).trim()) {
      return reply.status(400).send({ success: false, error: 'ID de sala inválido' });
    }
    const isSalaU = isUuid(salaId);

    if (!isPgConnected || !sql) {
      return reply.status(500).send({ success: false, error: 'Base de datos no disponible' });
    }

    // 1. Obtener datos de la sala
    const salaRows = await sql`SELECT uuid, uuid AS id, nombre FROM salas WHERE ${isSalaU ? sql`uuid = ${salaId}::uuid` : sql`uuid::text = ${salaId}`}`;
    if (salaRows.length === 0) {
      return reply.status(404).send({ success: false, error: 'Sala no encontrada' });
    }
    const sala = salaRows[0];

    // 2. Obtener dispositivos de la sala
    const dispositivos = await sql`
      SELECT uuid, uuid AS id, nombre, sala_uuid, ip_local, ip_remota, ip_panel, usuario, clave
      FROM dispositivos
      WHERE sala_uuid = ${sala.uuid}
      ORDER BY nombre ASC
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
        e.uuid, e.uuid AS id, e.nombre, e.cedula, e.foto, e.sexo, e.fecha_ingreso, e.activo,
        c.uuid AS cargo_id, c.nombre AS cargo_nombre,
        d.uuid AS departamento_id, d.nombre AS departamento_nombre,
        s.uuid AS sala_id, s.nombre AS sala_nombre
      FROM empleados e
      LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
      LEFT JOIN areas a ON c.area_uuid = a.uuid
      LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      WHERE e.activo = true AND d.sala_uuid = ${sala.uuid}
      ORDER BY e.nombre ASC
    `;

    // 4. Obtener todos los empleados del sistema (para identificar si un usuario del biométrico es inactivo/desincorporado)
    const allSystemEmployees = await sql`
      SELECT e.uuid, e.uuid AS id, e.nombre, e.cedula, e.activo, e.motivo_desincorporacion, s.nombre as sala_nombre
      FROM empleados e
      LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
      LEFT JOIN areas a ON c.area_uuid = a.uuid
      LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
    `;

    const systemEmpByVariant = new Map();
    const systemEmpByName = new Map();
    for (const emp of allSystemEmployees) {
      const variants = getCedulaVariants(emp.cedula);
      for (const v of variants) {
        if (!systemEmpByVariant.has(v)) {
          systemEmpByVariant.set(v, emp);
        }
      }
      if (emp.nombre) {
        systemEmpByName.set(emp.nombre.trim().toLowerCase(), emp);
      }
    }

    // 5. Obtener mapa de asignaciones en empleado_dispositivos
    const devUuids = dispositivos.map(d => d.uuid);
    const empDevRows = await sql`
      SELECT empleado_uuid, dispositivo_uuid
      FROM empleado_dispositivos
      WHERE dispositivo_uuid = ANY(${devUuids}::uuid[])
    `;
    const assignedEmpDevSet = new Set(empDevRows.map(r => `${r.empleado_uuid}_${r.dispositivo_uuid}`));

    // 6. Auditar cada dispositivo en paralelo
    const auditedDevices = await Promise.all(dispositivos.map(async (dev) => {
      const result = {
        uuid: dev.uuid,
        id: dev.uuid,
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

      // Mapear usuarios encontrados en el biométrico usando todas las variantes de cédula
      const bioUsersByVariant = new Map();
      const bioUsersByName = new Map();
      for (const u of bioUsers) {
        const variants = getCedulaVariants(u.employeeNo);
        for (const v of variants) {
          bioUsersByVariant.set(v, u);
        }
        if (u.name) {
          bioUsersByName.set(u.name.trim().toLowerCase(), u);
        }
      }

      // Mapear usuarios encontrados en el panel si existe
      const panelUsersByVariant = new Map();
      for (const u of panelUsers) {
        const variants = getCedulaVariants(u.employeeNo);
        for (const v of variants) {
          panelUsersByVariant.set(v, u);
        }
      }

      // Filtrar empleados asignados a este dispositivo
      const activeEmployeesForDev = activeEmployees.filter(emp => {
        const empKey = String(emp.uuid || emp.id);
        const devKey = String(dev.uuid || dev.id);
        return assignedEmpDevSet.has(`${empKey}_${devKey}`);
      });
      const targetEmployees = activeEmployeesForDev.length > 0 ? activeEmployeesForDev : activeEmployees;

      const matchedDeviceUsers = new Set();

      // Comparativa 1: Empleados del sistema vs Equipos físicos
      for (const emp of targetEmployees) {
        const variants = getCedulaVariants(emp.cedula);
        let bioUser = null;
        for (const v of variants) {
          if (bioUsersByVariant.has(v)) {
            bioUser = bioUsersByVariant.get(v);
            break;
          }
        }
        if (!bioUser && emp.nombre) {
          bioUser = bioUsersByName.get(emp.nombre.trim().toLowerCase()) || null;
        }

        let panelUser = null;
        for (const v of variants) {
          if (panelUsersByVariant.has(v)) {
            panelUser = panelUsersByVariant.get(v);
            break;
          }
        }

        if (bioUser) {
          matchedDeviceUsers.add(bioUser);
          if (panelUser) matchedDeviceUsers.add(panelUser);

          const nameInDev = String(bioUser.name || '').trim();
          const nameInSys = String(emp.nombre || '').trim();
          const nameDiffers = Boolean(nameInDev && nameInSys && nameInDev.toLowerCase() !== nameInSys.toLowerCase());
          const hasFaceOnDevice = (bioUser.numOfFace || 0) > 0;
          const hasCardOnDevice = (bioUser.numOfCard || 0) > 0;

          result.sincronizados.push({
            uuid: emp.uuid,
            id: emp.uuid,
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
            },
            enBiometrico: true,
            enPanel: !!panelUser,
            nameDiffers,
            hasFaceOnDevice,
            hasCardOnDevice
          });
        } else {
          result.faltan.push({
            uuid: emp.uuid,
            id: emp.uuid,
            nombre: emp.nombre,
            cedula: emp.cedula,
            foto: emp.foto,
            sexo: emp.sexo,
            cargo_nombre: emp.cargo_nombre || 'Sin cargo',
            departamento_nombre: emp.departamento_nombre || 'Sin depto',
            assignedInDb: assignedEmpDevSet.has(`${emp.uuid}_${dev.uuid}`),
            faltaEnBiometrico: true,
            faltaEnPanel: dev.ip_panel ? !panelUser : false
          });
        }
      }

      // Comparativa 2: Usuarios en el equipo que NO son empleados activos autorizados en esta sala
      for (const u of bioUsers) {
        if (!matchedDeviceUsers.has(u)) {
          const variants = getCedulaVariants(u.employeeNo);
          let sysEmp = null;
          for (const v of variants) {
            if (systemEmpByVariant.has(v)) {
              sysEmp = systemEmpByVariant.get(v);
              break;
            }
          }

          let nameMatch = null;
          if (!sysEmp && u.name) {
            nameMatch = systemEmpByName.get(u.name.trim().toLowerCase()) || null;
          }

          let statusDesc = 'No registrado en sistema';
          let employeeId = null;
          let employeeName = null;

          if (sysEmp) {
            employeeId = sysEmp.id;
            employeeName = sysEmp.nombre;
            if (!sysEmp.activo) {
              statusDesc = `Desincorporado: ${sysEmp.motivo_desincorporacion || 'Inactivo'} (${sysEmp.cedula})`;
            } else {
              statusDesc = `Activo en otra sala: ${sysEmp.sala_nombre || 'Otra sala'} (${sysEmp.cedula})`;
            }
          } else if (nameMatch) {
            employeeId = nameMatch.id;
            employeeName = nameMatch.nombre;
            statusDesc = `Coincide por nombre: ${nameMatch.nombre} (${nameMatch.cedula})`;
          }

          result.sobran.push({
            employeeNo: u.employeeNo,
            name: u.name || 'Sin nombre en equipo',
            numOfCard: u.numOfCard || 0,
            numOfFace: u.numOfFace || 0,
            systemStatus: statusDesc,
            systemEmployeeId: employeeId,
            systemEmployeeName: employeeName
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
    const dispositivoId = request.body.dispositivoUuid || request.body.dispositivo_uuid || request.body.dispositivoId;
    const empleado_ids = request.body.empleado_uuids || request.body.empleado_ids;
    const target = request.body.target || 'both';
    if (!dispositivoId) {
      return reply.status(400).send({ success: false, error: 'ID de dispositivo inválido' });
    }
    const isDevU = isUuid(dispositivoId);

    if (!empleado_ids || !Array.isArray(empleado_ids) || empleado_ids.length === 0) {
      return reply.status(400).send({ success: false, error: 'Debe especificar al menos un empleado' });
    }

    if (!isPgConnected || !sql) {
      return reply.status(500).send({ success: false, error: 'Base de datos no disponible' });
    }

    const [dev] = await sql`
      SELECT uuid, uuid AS id, nombre, sala_uuid, ip_remota, ip_panel, usuario, clave
      FROM dispositivos
      WHERE ${isDevU ? sql`uuid = ${dispositivoId}::uuid` : sql`uuid::text = ${dispositivoId}`}
      LIMIT 1
    `;

    if (!dev) {
      return reply.status(404).send({ success: false, error: 'Dispositivo no encontrado' });
    }

    const eUuids = empleado_ids.map(String).map(s => s.trim()).filter(Boolean);
    const validUuids = eUuids.filter(isUuid);
    const empleados = await sql`
      SELECT uuid, uuid AS id, nombre, cedula, sexo, foto, fecha_ingreso
      FROM empleados
      WHERE uuid::text = ANY(${eUuids}) ${validUuids.length > 0 ? sql`OR uuid = ANY(${validUuids}::uuid[])` : sql``}
    `;

    const results = [];
    const savedConfigRows = await sql`SELECT clave, valor FROM configuracion`;
    const configMap = {};
    for (const r of savedConfigRows) configMap[r.clave] = r.valor;
    const publicDomain = (configMap.isapi_ip_domain || process.env.APP_DOMAIN || process.env.SERVER_DOMAIN || req.headers?.host?.split(':')[0] || 'localhost').trim();

    for (const emp of empleados) {
      const empRes = {
        empleado_id: emp.uuid,
        empleado_uuid: emp.uuid,
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

            const panelId = generarCardNoDesdeCedula(emp.cedula) || emp.cedula.replace(/\D/g, '');
            if (panelId) {
              try {
                await setupCardInDevice(dev.ip_panel, dev.usuario || 'admin', dev.clave || '', panelId, panelId);
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
          SELECT uuid FROM empleado_dispositivos 
          WHERE empleado_uuid = ${emp.uuid}::uuid AND dispositivo_uuid = ${dev.uuid}::uuid 
          LIMIT 1
        `;
        if (existingRel.length === 0) {
          try {
            await sql`
              INSERT INTO empleado_dispositivos (uuid, empleado_uuid, dispositivo_uuid)
              VALUES (gen_random_uuid(), ${emp.uuid}::uuid, ${dev.uuid}::uuid)
              ON CONFLICT DO NOTHING
            `;
          } catch (insertErr) {
            if (insertErr.message && (insertErr.message.includes('column "id"') || insertErr.message.includes('empleado_dispositivos'))) {
              await sql.unsafe(`
                ALTER TABLE empleado_dispositivos ALTER COLUMN id DROP NOT NULL;
                ALTER TABLE empleado_dispositivos DROP COLUMN IF EXISTS id CASCADE;
              `).catch(() => {});
              await sql`
                INSERT INTO empleado_dispositivos (uuid, empleado_uuid, dispositivo_uuid)
                VALUES (gen_random_uuid(), ${emp.uuid}::uuid, ${dev.uuid}::uuid)
                ON CONFLICT DO NOTHING
              `;
            } else {
              throw insertErr;
            }
          }
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
 * POST /api/biometricos/actualizar-empleados
 * Actualiza nombre, foto y tarjeta de empleados sincronizados en el biométrico (y panel)
 */
export async function actualizarEmpleadosEnBiometrico(request, reply) {
  try {
    const dispositivoId = request.body.dispositivoUuid || request.body.dispositivo_uuid || request.body.dispositivoId;
    const empleado_ids = request.body.empleado_uuids || request.body.empleado_ids;
    const target = request.body.target || 'both';
    if (!dispositivoId) {
      return reply.status(400).send({ success: false, error: 'ID de dispositivo inválido' });
    }
    const isDevU = isUuid(dispositivoId);

    if (!empleado_ids || !Array.isArray(empleado_ids) || empleado_ids.length === 0) {
      return reply.status(400).send({ success: false, error: 'Debe especificar al menos un empleado' });
    }

    if (!isPgConnected || !sql) {
      return reply.status(500).send({ success: false, error: 'Base de datos no disponible' });
    }

    const [dev] = await sql`
      SELECT uuid, uuid AS id, nombre, sala_uuid, ip_remota, ip_panel, usuario, clave
      FROM dispositivos
      WHERE ${isDevU ? sql`uuid = ${dispositivoId}::uuid` : sql`uuid::text = ${dispositivoId}`}
      LIMIT 1
    `;

    if (!dev) {
      return reply.status(404).send({ success: false, error: 'Dispositivo no encontrado' });
    }

    const eUuids = empleado_ids.map(String).map(s => s.trim()).filter(Boolean);
    const validUuids = eUuids.filter(isUuid);
    const empleados = await sql`
      SELECT uuid, uuid AS id, nombre, cedula, sexo, foto, fecha_ingreso
      FROM empleados
      WHERE uuid::text = ANY(${eUuids}) ${validUuids.length > 0 ? sql`OR uuid = ANY(${validUuids}::uuid[])` : sql``}
    `;

    const savedConfigRows = await sql`SELECT clave, valor FROM configuracion`;
    const configMap = {};
    for (const r of savedConfigRows) configMap[r.clave] = r.valor;
    const publicDomain = (configMap.isapi_ip_domain || process.env.APP_DOMAIN || process.env.SERVER_DOMAIN || req.headers?.host?.split(':')[0] || 'localhost').trim();

    const results = [];

    for (const emp of empleados) {
      const empRes = {
        empleado_id: emp.uuid,
        empleado_uuid: emp.uuid,
        nombre: emp.nombre,
        cedula: emp.cedula,
        biometrico: { success: false, message: '' },
        panel: dev.ip_panel ? { success: false, message: '' } : null
      };

      // 1. Actualizar en Biométrico
      if (dev.ip_remota && (target === 'both' || target === 'bio')) {
        try {
          const userRes = await addUserToDevice(dev.ip_remota, dev.usuario || 'admin', dev.clave || '', emp, false);
          if (userRes.ok || userRes.status === 200) {
            empRes.biometrico.success = true;
            empRes.biometrico.message = 'Usuario actualizado exitosamente';

            // Actualizar Tarjeta
            const cardNo = generarCardNoDesdeCedula(emp.cedula);
            if (cardNo) {
              try {
                await setupCardInDevice(dev.ip_remota, dev.usuario || 'admin', dev.clave || '', emp.cedula, cardNo);
              } catch (cardErr) {}
            }

            // Actualizar Foto
            if (emp.foto) {
              const photoUrl = `http://${publicDomain}${emp.foto}`;
              try {
                await uploadFaceToDevice(dev.ip_remota, dev.usuario || 'admin', dev.clave || '', emp.cedula, emp.nombre, emp.sexo, photoUrl);
              } catch (faceErr) {}
            }
          } else {
            empRes.biometrico.message = `El biométrico respondió HTTP ${userRes.status}`;
          }
        } catch (bioErr) {
          empRes.biometrico.message = bioErr.message;
        }
      }

      // 2. Actualizar en Panel si aplica
      if (dev.ip_panel && dev.ip_panel.trim() && (target === 'both' || target === 'panel')) {
        try {
          const panelRes = await addUserToDevice(dev.ip_panel, dev.usuario || 'admin', dev.clave || '', emp, true);
          if (panelRes.ok || panelRes.status === 200) {
            empRes.panel.success = true;
            empRes.panel.message = 'Usuario actualizado en panel';

            const panelId = generarCardNoDesdeCedula(emp.cedula) || emp.cedula.replace(/\D/g, '');
            if (panelId) {
              try {
                await setupCardInDevice(dev.ip_panel, dev.usuario || 'admin', dev.clave || '', panelId, panelId);
              } catch (cardErr) {}
            }
          } else {
            empRes.panel.message = `El panel respondió HTTP ${panelRes.status}`;
          }
        } catch (panelErr) {
          empRes.panel.message = panelErr.message;
        }
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
    console.error('Error en actualizarEmpleadosEnBiometrico:', err);
    return reply.status(500).send({ success: false, error: err.message });
  }
}

/**
 * POST /api/biometricos/eliminar-usuarios
 * Elimina usuarios del biométrico (y panel) por su employeeNo
 */
export async function eliminarUsuariosDeBiometrico(request, reply) {
  try {
    const dispositivoId = request.body.dispositivoUuid || request.body.dispositivo_uuid || request.body.dispositivoId;
    const employee_nos = request.body.employee_nos;
    const target = request.body.target || 'both';
    if (!dispositivoId) {
      return reply.status(400).send({ success: false, error: 'ID de dispositivo inválido' });
    }
    const isDevU = isUuid(dispositivoId);

    if (!employee_nos || !Array.isArray(employee_nos) || employee_nos.length === 0) {
      return reply.status(400).send({ success: false, error: 'Debe especificar al menos un usuario' });
    }

    if (!isPgConnected || !sql) {
      return reply.status(500).send({ success: false, error: 'Base de datos no disponible' });
    }

    const [dev] = await sql`
      SELECT uuid, uuid AS id, nombre, sala_uuid, ip_remota, ip_panel, usuario, clave
      FROM dispositivos
      WHERE ${isDevU ? sql`uuid = ${dispositivoId}::uuid` : sql`uuid::text = ${dispositivoId}`}
      LIMIT 1
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

      // 3. Limpiar de empleado_dispositivos si coincide por cualquiera de sus variantes de cédula
      try {
        const variants = getCedulaVariants(cleanNo);
        for (const v of variants) {
          await sql`
            DELETE FROM empleado_dispositivos 
            WHERE dispositivo_uuid = ${dev.uuid}::uuid AND empleado_uuid IN (
              SELECT uuid FROM empleados WHERE REPLACE(UPPER(COALESCE(cedula, '')), '-', '') = ${v}
            )
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
