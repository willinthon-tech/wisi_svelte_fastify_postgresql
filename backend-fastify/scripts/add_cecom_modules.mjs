import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });
import postgres from 'postgres';

async function addModules() {
  const sql = postgres({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    database: process.env.PGDATABASE || 'wisi',
    username: process.env.PGUSER || 'root',
    password: process.env.PGPASSWORD || 'S0p0rt3R0y4l-2025'
  });

  try {
    const pageRows = await sql`SELECT uuid FROM paginas WHERE UPPER(TRIM(nombre)) = 'CECOM' LIMIT 1`;
    if (pageRows.length === 0) {
      console.log('No se encontró la página CECOM');
      return;
    }
    const pageUuid = pageRows[0].uuid;

    const newModules = [
      { nombre: 'Descarga de video', ruta: '/cecom/descargas-video', orden: 5 },
      { nombre: 'IA Tiempo Real', ruta: '/cecom/ia-tiempo-real', orden: 6 },
      { nombre: 'IA Novedades', ruta: '/cecom/ia-novedades', orden: 7 }
    ];

    const insertedModuleUuids = [];

    for (const mod of newModules) {
      const existing = await sql`
        SELECT uuid FROM modulos 
        WHERE page_uuid = ${pageUuid} AND (ruta = ${mod.ruta} OR nombre = ${mod.nombre})
      `;

      if (existing.length === 0) {
        const ins = await sql`
          INSERT INTO modulos (page_uuid, nombre, ruta, orden, is_deleted, created_at, updated_at)
          VALUES (${pageUuid}, ${mod.nombre}, ${mod.ruta}, ${mod.orden}, false, NOW(), NOW())
          RETURNING uuid, nombre, ruta, orden
        `;
        console.log(`✅ Módulo creado: ${ins[0].nombre} (${ins[0].ruta})`);
        insertedModuleUuids.push(ins[0].uuid);
      } else {
        console.log(`ℹ️ Módulo ya existe: ${mod.nombre} (${existing[0].uuid})`);
        insertedModuleUuids.push(existing[0].uuid);
      }
    }

    // Permisos existentes (VER, AGREGAR, EDITAR, ELIMINAR)
    const perms = await sql`SELECT uuid, nombre FROM permissions WHERE is_deleted = false`;
    const verPerm = perms.find(p => p.nombre === 'VER');

    // Usuarios con acceso a CECOM
    const usersWithCecom = await sql`
      SELECT DISTINCT user_uuid 
      FROM user_module_permissions ump
      JOIN modulos m ON ump.module_uuid = m.uuid
      WHERE m.page_uuid = ${pageUuid} AND ump.is_deleted = false
    `;

    for (const u of usersWithCecom) {
      for (const mUuid of insertedModuleUuids) {
        for (const p of perms) {
          await sql`
            INSERT INTO user_module_permissions (user_uuid, module_uuid, permission_uuid, is_deleted, created_at, updated_at)
            VALUES (${u.user_uuid}, ${mUuid}, ${p.uuid}, false, NOW(), NOW())
            ON CONFLICT DO NOTHING
          `;
        }
      }
    }

    console.log(`✅ Permisos asignados para ${usersWithCecom.length} usuarios de CECOM.`);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await sql.end();
  }
}

addModules();
