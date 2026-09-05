import { sql, isPgConnected, inMemoryData } from '../config/db.js';

export async function findUserByUsername(usuario) {
  const cleanInput = (usuario || '').trim().toLowerCase();
  if (isPgConnected && sql) {
    const rows = await sql`
      SELECT id, nombre_apellido, usuario, password 
      FROM usuarios 
      WHERE LOWER(usuario) = ${cleanInput}
      LIMIT 1
    `;
    return rows[0] || null;
  } else {
    return inMemoryData.usuarios.find(u => (u.usuario || '').trim().toLowerCase() === cleanInput) || null;
  }
}

export async function getUserSalasModel(userId) {
  const uId = Number(userId);
  if (isPgConnected && sql) {
    return await sql`
      SELECT s.* FROM salas s
      INNER JOIN user_salas us ON s.id = us.sala_id
      WHERE us.user_id = ${uId}
      ORDER BY s.id ASC
    `;
  } else {
    const userSalaIds = inMemoryData.user_salas.filter(us => us.user_id === uId).map(us => us.sala_id);
    return inMemoryData.salas.filter(s => userSalaIds.includes(s.id));
  }
}

export async function getUserNavMenuModel(userId) {
  const uId = Number(userId);
  if (isPgConnected && sql) {
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
  } else {
    const userPerms = inMemoryData.user_module_permissions.filter(ump => ump.user_id === uId);
    const userModuleIds = [...new Set(userPerms.map(ump => ump.module_id))];
    const userModules = inMemoryData.modulos.filter(m => userModuleIds.includes(m.id));
    const userPageIds = [...new Set(userModules.map(m => m.page_id))];
    const userPages = inMemoryData.paginas.filter(p => userPageIds.includes(p.id)).sort((a, b) => a.orden - b.orden);

    return userPages.map(p => {
      const pageMods = userModules.filter(m => m.page_id === p.id);
      return {
        ...p,
        modulos: pageMods.map(m => {
          const modPermIds = userPerms.filter(ump => ump.module_id === m.id).map(ump => ump.permission_id);
          const modPermNames = inMemoryData.permissions.filter(perm => modPermIds.includes(perm.id)).map(perm => perm.nombre);
          return {
            ...m,
            permisos: modPermNames
          };
        })
      };
    });
  }
}
