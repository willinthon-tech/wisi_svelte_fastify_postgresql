import { sql, isPgConnected } from '../config/db.js';

export async function findUserByUsername(usuario) {
  const cleanInput = (usuario || '').trim().toLowerCase();
  if (!cleanInput) return null;

  if (!isPgConnected || !sql) {
    throw new Error('Base de datos PostgreSQL no conectada');
  }

  const rows = await sql`
    SELECT id, nombre_apellido, usuario, password 
    FROM usuarios 
    WHERE LOWER(TRIM(usuario)) = ${cleanInput}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function getUserSalasModel(userId) {
  const uId = Number(userId);
  if (!isPgConnected || !sql) return [];

  return await sql`
    SELECT s.* FROM salas s
    INNER JOIN user_salas us ON s.id = us.sala_id
    WHERE us.user_id = ${uId}
    AND (s.grupo_id IS NULL OR s.grupo_id = 1)
    ORDER BY s.id ASC
  `;
}

export async function getUserNavMenuModel(userId) {
  const uId = Number(userId);
  if (!isPgConnected || !sql) return [];

  const pages = await sql`
    SELECT DISTINCT p.id, p.nombre
    FROM paginas p
    INNER JOIN modulos m ON p.id = m.page_id
    INNER JOIN user_module_permissions ump ON m.id = ump.module_id
    WHERE ump.user_id = ${uId}
    ORDER BY p.id ASC
  `;

  const modules = await sql`
    SELECT DISTINCT m.id, m.nombre, m.icono, m.ruta, m.page_id,
           STRING_AGG(DISTINCT perm.nombre, ',') as permisos
    FROM modulos m
    INNER JOIN user_module_permissions ump ON m.id = ump.module_id
    INNER JOIN permissions perm ON ump.permission_id = perm.id
    WHERE ump.user_id = ${uId}
    GROUP BY m.id, m.nombre, m.icono, m.ruta, m.page_id
    ORDER BY m.id ASC
  `;

  return pages.map(p => ({
    ...p,
    modulos: modules.filter(m => m.page_id === p.id).map(m => ({
      ...m,
      permisos: m.permisos ? m.permisos.split(',') : []
    }))
  }));
}
