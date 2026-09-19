import { sql, initDb } from '../src/config/db.js';

async function main() {
  try {
    await initDb();

    // 1. Buscar la página destino 'CONF.M: RRHH'
    const targetPage = await sql`
      SELECT uuid, nombre 
      FROM paginas 
      WHERE nombre = 'CONF.M: RRHH'
      LIMIT 1;
    `;

    if (targetPage.length === 0) {
      console.error('No se encontró la página CONF.M: RRHH');
      return;
    }

    const rrhhPageUuid = targetPage[0].uuid;
    console.log(`Página encontrada: ${targetPage[0].nombre} (${rrhhPageUuid})`);

    // 2. Obtener el max orden actual en CONF.M: RRHH
    const maxOrder = await sql`
      SELECT COALESCE(MAX(orden), 0) as max_ord 
      FROM modulos 
      WHERE page_uuid = ${rrhhPageUuid}::uuid;
    `;
    const nextOrder = (maxOrder[0]?.max_ord || 0) + 1;

    // 3. Actualizar el módulo Rangos
    const updated = await sql`
      UPDATE modulos
      SET page_uuid = ${rrhhPageUuid}::uuid,
          orden = ${nextOrder},
          updated_at = NOW()
      WHERE nombre ILIKE 'rangos'
      RETURNING uuid, nombre, page_uuid, orden, updated_at;
    `;

    console.log('Módulo Rangos actualizado:', updated);

    // 4. Verificar todos los módulos de CONF.M: RRHH
    const rrhhModules = await sql`
      SELECT m.orden, m.nombre, m.ruta, m.uuid, m.page_uuid
      FROM modulos m
      WHERE m.page_uuid = ${rrhhPageUuid}::uuid
      ORDER BY m.orden ASC;
    `;
    console.log('Módulos en CONF.M: RRHH:', rrhhModules);

  } catch (err) {
    console.error('Error durante la migración:', err);
  } finally {
    if (sql) await sql.end();
  }
}

main();
