import { sql, isPgConnected } from '../config/db.js';

export async function findUserByUsername(usuario) {
  const cleanInput = (usuario || '').trim().toLowerCase();
  if (!cleanInput) return null;

  if (!isPgConnected || !sql) {
    throw new Error('Base de datos PostgreSQL no conectada');
  }

  const rows = await sql`
    SELECT uuid, uuid AS id, nombre_apellido, usuario, password 
    FROM usuarios 
    WHERE LOWER(TRIM(usuario)) = ${cleanInput}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function getUserSalasModel(userId) {
  if (!isPgConnected || !sql) return [];
  const uIdStr = String(userId).trim();

  return await sql`
    SELECT s.*, s.uuid AS id, s.uuid AS sala_uuid, s.uuid AS sala_id, gs.nombre AS grupo_nombre FROM salas s
    INNER JOIN user_salas us ON s.uuid = us.sala_uuid
    LEFT JOIN grupo_salas gs ON s.grupo_uuid = gs.uuid
    WHERE us.user_uuid::text = ${uIdStr}
    AND (gs.nombre IS NULL OR UPPER(gs.nombre) != 'GALPÓN')
    ORDER BY s.nombre ASC
  `;
}

export async function getUserNavMenuModel(userId) {
  if (!isPgConnected || !sql) return [];
  const uIdStr = String(userId).trim();

  const pages = await sql`
    SELECT DISTINCT p.uuid, p.nombre
    FROM paginas p
    INNER JOIN modulos m ON p.uuid = m.page_uuid
    INNER JOIN user_module_permissions ump ON m.uuid = ump.module_uuid
    WHERE ump.user_uuid::text = ${uIdStr}
    ORDER BY p.nombre ASC
  `;

  const modules = await sql`
    SELECT m.uuid, m.nombre, m.icono, m.ruta, m.page_uuid, m.orden,
           COALESCE(m.orden, 0) as sort_orden,
           STRING_AGG(DISTINCT perm.nombre, ',') as permisos
    FROM modulos m
    INNER JOIN user_module_permissions ump ON m.uuid = ump.module_uuid
    INNER JOIN permissions perm ON ump.permission_uuid = perm.uuid
    WHERE ump.user_uuid::text = ${uIdStr}
    GROUP BY m.uuid, m.nombre, m.icono, m.ruta, m.page_uuid, m.orden
    ORDER BY sort_orden ASC, m.nombre ASC
  `;

  return pages.map(p => ({
    ...p,
    modulos: modules.filter(m => m.page_uuid === p.uuid).map(m => ({
      ...m,
      permisos: m.permisos ? m.permisos.split(',') : []
    }))
  }));
}

export async function getUserPermissionsModel(userId) {
  if (!isPgConnected || !sql) return {};
  const uIdStr = String(userId).trim();

  const rows = await sql`
    SELECT ump.module_uuid, p.nombre as perm_name
    FROM user_module_permissions ump
    INNER JOIN permissions p ON ump.permission_uuid = p.uuid
    WHERE ump.user_uuid::text = ${uIdStr}
  `;

  const map = {};
  for (const r of rows) {
    if (!map[r.module_uuid]) map[r.module_uuid] = [];
    if (!map[r.module_uuid].includes(r.perm_name)) {
      map[r.module_uuid].push(r.perm_name);
    }
  }
  return map;
}

