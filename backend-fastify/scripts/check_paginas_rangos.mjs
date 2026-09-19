import { sql, initDb } from '../src/config/db.js';

async function run() {
  try {
    await initDb();
    const confModules = await sql`
      SELECT p.nombre as pagina, m.nombre as modulo, m.ruta, m.page_uuid, m.uuid 
      FROM modulos m 
      JOIN paginas p ON m.page_uuid = p.uuid 
      WHERE p.nombre ILIKE '%CONF%' 
      ORDER BY p.nombre, m.orden;
    `;
    console.log('--- CONF MODULES ---');
    console.log(JSON.stringify(confModules, null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    if (sql) await sql.end();
  }
}

run();
