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

async function run() {
  console.log('--- Iniciando asignación de rangos a máquinas ---');

  // 1. Obtener o crear rango 'General'
  let [rangoGeneral] = await sql`
    SELECT uuid, nombre 
    FROM rangos 
    WHERE LOWER(TRIM(nombre)) = 'general'
    LIMIT 1
  `;
  if (!rangoGeneral) {
    console.log('Rango "General" no encontrado, creándolo...');
    [rangoGeneral] = await sql`
      INSERT INTO rangos (uuid, nombre, created_at, updated_at)
      VALUES (gen_random_uuid(), 'General', NOW(), NOW())
      RETURNING uuid, nombre
    `;
  }
  console.log(`✓ Rango General detectado: [${rangoGeneral.uuid}] (${rangoGeneral.nombre})`);

  // 2. Obtener o crear rango 'Sin Rango'
  let [rangoSinRango] = await sql`
    SELECT uuid, nombre 
    FROM rangos 
    WHERE LOWER(TRIM(nombre)) = 'sin rango'
    LIMIT 1
  `;
  if (!rangoSinRango) {
    console.log('Rango "Sin Rango" no encontrado, creándolo...');
    [rangoSinRango] = await sql`
      INSERT INTO rangos (uuid, nombre, created_at, updated_at)
      VALUES (gen_random_uuid(), 'Sin Rango', NOW(), NOW())
      RETURNING uuid, nombre
    `;
  }
  console.log(`✓ Rango Sin Rango detectado: [${rangoSinRango.uuid}] (${rangoSinRango.nombre})`);

  // 3. Actualizar máquinas pertenecientes a salas del grupo 'SALA' -> General
  const resSala = await sql`
    UPDATE maquinas m
    SET rango_uuid = ${rangoGeneral.uuid},
        updated_at = NOW()
    FROM salas s
    LEFT JOIN grupo_salas gs ON s.grupo_uuid = gs.uuid
    WHERE m.sala_uuid = s.uuid
      AND (
        UPPER(TRIM(COALESCE(gs.nombre, ''))) = 'SALA'
        OR s.grupo_uuid = 'a30f4e82-1928-4186-b769-c8655b27d1b4'
      )
  `;
  console.log(`✓ Máquinas de SALA asignadas a "General": ${resSala.count} actualizadas.`);

  // 4. Actualizar máquinas pertenecientes a salas del grupo 'GALPÓN' / 'GALPON' -> Sin Rango
  const resGalpon = await sql`
    UPDATE maquinas m
    SET rango_uuid = ${rangoSinRango.uuid},
        updated_at = NOW()
    FROM salas s
    LEFT JOIN grupo_salas gs ON s.grupo_uuid = gs.uuid
    WHERE m.sala_uuid = s.uuid
      AND (
        UPPER(TRIM(COALESCE(gs.nombre, ''))) IN ('GALPÓN', 'GALPON')
        OR UPPER(TRIM(COALESCE(gs.nombre, ''))) LIKE 'GALP%'
        OR s.grupo_uuid = '55d65e8b-09b2-4164-8491-efbdd50433b6'
      )
  `;
  console.log(`✓ Máquinas de GALPÓN asignadas a "Sin Rango": ${resGalpon.count} actualizadas.`);

  // 5. Resumen general de máquinas por rango
  const resumen = await sql`
    SELECT COALESCE(r.nombre, 'Sin Asignar (NULL)') as rango, COUNT(m.uuid)::int as total
    FROM maquinas m
    LEFT JOIN rangos r ON m.rango_uuid = r.uuid
    GROUP BY r.nombre
    ORDER BY total DESC
  `;
  console.log('\n=== RESUMEN DE MÁQUINAS POR RANGO ===');
  console.table(resumen);

  await sql.end();
  console.log('\n--- Proceso completado exitosamente ---');
  process.exit(0);
}

run().catch(async (err) => {
  console.error('Error al asignar rangos:', err);
  await sql.end();
  process.exit(1);
});
