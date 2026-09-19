import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const PGHOST = process.env.PGHOST || 'localhost';
const PGPORT = process.env.PGPORT ? Number(process.env.PGPORT) : 5432;
const PGDATABASE = process.env.PGDATABASE || 'wisi';
const PGUSER = process.env.PGUSER || 'root';
const PGPASSWORD = process.env.PGPASSWORD || 'S0p0rt3R0y4l-2025';

const sql = postgres({
  host: PGHOST,
  port: PGPORT,
  database: PGDATABASE,
  username: PGUSER,
  password: PGPASSWORD
});

async function main() {
  console.log('--- MOVER MÓDULO RANGOS A CONF.M: MAQUINAS ---');

  // 1. Obtener la página CONF.M: MAQUINAS
  const [paginaMaquinas] = await sql`
    SELECT uuid, nombre 
    FROM paginas 
    WHERE UPPER(TRIM(nombre)) = 'CONF.M: MAQUINAS' 
    LIMIT 1
  `;

  if (!paginaMaquinas) {
    console.error('❌ Error: No se encontró la página "CONF.M: MAQUINAS" en la tabla paginas.');
    process.exit(1);
  }

  console.log(`✓ Página destino encontrada: [${paginaMaquinas.uuid}] ${paginaMaquinas.nombre}`);

  // 2. Actualizar el módulo Rangos
  const updated = await sql`
    UPDATE modulos
    SET page_uuid = ${paginaMaquinas.uuid},
        orden = 11,
        updated_at = NOW()
    WHERE LOWER(TRIM(nombre)) = 'rangos' OR ruta = '/configuracion/rangos'
    RETURNING uuid, nombre, ruta, page_uuid, orden;
  `;

  if (updated.length === 0) {
    console.log('⚠️ No se encontró ningún módulo con nombre "Rangos" o ruta "/configuracion/rangos".');
  } else {
    for (const m of updated) {
      console.log(`✅ Módulo [${m.uuid}] "${m.nombre}" asignado exitosamente a "${paginaMaquinas.nombre}" (Orden: ${m.orden})`);
    }
  }

  // 3. Mostrar el estado final de CONF.M: MAQUINAS
  const modulosFinales = await sql`
    SELECT m.uuid, m.nombre, m.ruta, m.orden, p.nombre as pagina
    FROM modulos m
    JOIN paginas p ON m.page_uuid = p.uuid
    WHERE p.uuid = ${paginaMaquinas.uuid}
    ORDER BY m.orden ASC, m.nombre ASC;
  `;

  console.log('\n--- LISTADO ACTUALIZADO DE CONF.M: MAQUINAS ---');
  console.table(modulosFinales);

  await sql.end();
  console.log('Proceso completado.');
}

main().catch(async (err) => {
  console.error('Error durante la ejecución:', err);
  await sql.end();
  process.exit(1);
});
