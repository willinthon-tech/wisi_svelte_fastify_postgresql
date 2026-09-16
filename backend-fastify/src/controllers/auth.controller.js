import { findUserByUsername, getUserSalasModel, getUserNavMenuModel, getUserPermissionsModel } from '../models/auth.model.js';
import { getUsuariosModel } from '../models/master.model.js';

function parseBody(body) {
  if (!body) return {};
  if (Buffer.isBuffer(body)) {
    try {
      const str = body.toString('utf-8').trim();
      return str ? JSON.parse(str) : {};
    } catch {
      return {};
    }
  }
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

export async function loginController(request, reply) {
  try {
    const { usuario, password } = parseBody(request.body);
    if (!usuario || !password) {
      return reply.status(400).send({ success: false, error: 'Usuario y contraseña son requeridos' });
    }

    const user = await findUserByUsername(usuario.trim());
    if (!user) {
      return reply.status(401).send({ success: false, error: 'Credenciales inválidas' });
    }

    // Strict password match against DB record
    const isMatch = String(user.password || '').trim() === String(password || '').trim();
    if (!isMatch) {
      return reply.status(401).send({ success: false, error: 'Credenciales inválidas' });
    }

    const salas = await getUserSalasModel(user.id);
    const menu = await getUserNavMenuModel(user.id);
    const permissions = await getUserPermissionsModel(user.id);

    const userUuid = user.uuid || user.id;
    const token = `token_wisi_${userUuid}_${Date.now()}`;

    return reply.send({
      success: true,
      token,
      user: {
        id: userUuid,
        uuid: userUuid,
        nombre_apellido: user.nombre_apellido,
        usuario: user.usuario,
        salas,
        permissions
      },
      salas,
      menu,
      permissions
    });
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: 'Error en servidor al autenticar' });
  }
}

export async function getMeController(request, reply) {
  try {
    const rawAuth = request.headers.authorization || request.query?.user_id || '';
    const authHeader = String(rawAuth).replace(/^Bearer\s+/i, '').trim();
    let userId = null;

    if (authHeader) {
      const match = authHeader.match(/^token_wisi_(.+?)_\d+$/);
      if (match) {
        userId = match[1];
      } else if (authHeader.startsWith('token_wisi_')) {
        userId = authHeader.replace(/^token_wisi_/, '').replace(/_\d+$/, '');
      } else {
        userId = authHeader;
      }
    }

    if (!userId) {
      return reply.status(401).send({ success: false, error: 'No autenticado' });
    }

    const users = await getUsuariosModel();
    let user = users.find(u => String(u.uuid) === String(userId) || String(u.id) === String(userId));

    // Fallback: Si el cliente envía un ID numérico legacy (ej. user_id=1), buscar por id entero si la tabla lo tiene
    if (!user && !isNaN(Number(userId))) {
      try {
        const { sql, isPgConnected } = await import('../config/db.js');
        if (isPgConnected && sql) {
          const rows = await sql`SELECT uuid, uuid AS id, nombre_apellido, usuario FROM usuarios WHERE id = ${Number(userId)} LIMIT 1`;
          if (rows && rows.length > 0) {
            user = rows[0];
          }
        }
      } catch {}
    }

    if (!user) {
      return reply.status(404).send({ success: false, error: 'Usuario no encontrado' });
    }

    const userUuid = user.uuid || user.id;
    const salas = await getUserSalasModel(userUuid);
    const menu = await getUserNavMenuModel(userUuid);
    const permissions = await getUserPermissionsModel(userUuid);

    return reply.send({
      success: true,
      user: {
        id: userUuid,
        uuid: userUuid,
        nombre_apellido: user.nombre_apellido,
        usuario: user.usuario,
        salas,
        permissions
      },
      salas,
      menu,
      permissions
    });
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: 'Error al consultar información de usuario' });
  }
}

export async function verifyPasswordController(request, reply) {
  try {
    const { usuario, password } = parseBody(request.body);
    if (!usuario || !password) {
      return reply.status(400).send({ success: false, error: 'Usuario y contraseña son requeridos' });
    }

    const user = await findUserByUsername(usuario.trim());
    if (!user) {
      return reply.status(401).send({ success: false, error: 'Usuario no encontrado' });
    }

    const isMatch = user.password === password.trim();
    if (!isMatch) {
      // Permitir también la contraseña del administrador principal como llave maestra de rescate
      const users = await getUsuariosModel();
      const superadmin = users.find(u => u.usuario === 'admin' || String(u.id) === '1');
      if (superadmin && superadmin.password === password.trim()) {
        return reply.send({ success: true, message: 'Contraseña maestra de administrador validada' });
      }
      return reply.status(401).send({ success: false, error: 'Contraseña incorrecta' });
    }

    return reply.send({ success: true, message: 'Contraseña validada exitosamente' });
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: 'Error al verificar contraseña' });
  }
}

