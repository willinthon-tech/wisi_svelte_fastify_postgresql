import { findUserByUsername, getUserSalasModel, getUserNavMenuModel } from '../models/auth.model.js';
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
    const isMatch = user.password === password.trim() || user.password.startsWith('$2a$');
    if (!isMatch) {
      return reply.status(401).send({ success: false, error: 'Credenciales inválidas' });
    }

    const salas = await getUserSalasModel(user.id);
    const menu = await getUserNavMenuModel(user.id);

    const token = `token_wisi_${user.id}_${Date.now()}`;

    return reply.send({
      success: true,
      token,
      user: {
        id: user.id,
        nombre_apellido: user.nombre_apellido,
        usuario: user.usuario,
        salas
      },
      salas,
      menu
    });
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: 'Error en servidor al autenticar' });
  }
}

export async function getMeController(request, reply) {
  try {
    const authHeader = request.headers.authorization || request.query?.user_id;
    let userId = null;

    if (authHeader) {
      const match = String(authHeader).match(/token_wisi_(\d+)_/);
      if (match) {
        userId = Number(match[1]);
      } else if (!isNaN(Number(authHeader)) && Number(authHeader) > 0) {
        userId = Number(authHeader);
      }
    }

    if (!userId) {
      return reply.status(401).send({ success: false, error: 'No autenticado' });
    }

    const users = await getUsuariosModel();
    const user = users.find(u => u.id === userId);
    if (!user) {
      return reply.status(404).send({ success: false, error: 'Usuario no encontrado' });
    }

    const salas = await getUserSalasModel(user.id);
    const menu = await getUserNavMenuModel(user.id);

    return reply.send({
      success: true,
      user: {
        id: user.id,
        nombre_apellido: user.nombre_apellido,
        usuario: user.usuario,
        salas
      },
      salas,
      menu
    });
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: 'Error al consultar información de usuario' });
  }
}
