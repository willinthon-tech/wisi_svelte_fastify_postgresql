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
  console.log('--- Iniciando migración de tabla maquinas (rango_uuid y contadores iniciales) ---');

  await sql`
    ALTER TABLE maquinas 
    ADD COLUMN IF NOT EXISTS rango_uuid UUID REFERENCES rangos(uuid) ON DELETE SET NULL;
  `;
  console.log('✓ Columna rango_uuid agregada o ya existente.');

  await sql`
    ALTER TABLE maquinas 
    ADD COLUMN IF NOT EXISTS contador_entrada_inicial NUMERIC(18, 2) DEFAULT 0;
  `;
  console.log('✓ Columna contador_entrada_inicial agregada o ya existente.');

  await sql`
    ALTER TABLE maquinas 
    ADD COLUMN IF NOT EXISTS contador_salida_inicial NUMERIC(18, 2) DEFAULT 0;
  `;
  console.log('✓ Columna contador_salida_inicial agregada o ya existente.');

  await sql`
    ALTER TABLE maquinas 
    ADD COLUMN IF NOT EXISTS contador_jackpot_inicial NUMERIC(18, 2) DEFAULT 0;
  `;
  console.log('✓ Columna contador_jackpot_inicial agregada o ya existente.');

  await sql`
    CREATE INDEX IF NOT EXISTS maquinas_rango_uuid_idx ON maquinas(rango_uuid);
  `;
  console.log('✓ Índice maquinas_rango_uuid_idx verificado.');

  const cols = await sql`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'maquinas'
    ORDER BY ordinal_position;
  `;
  console.log('--- Columnas actuales de maquinas: ---');
  cols.forEach(c => console.log(`  - ${c.column_name} (${c.data_type}) [default: ${c.column_default}]`));

  await sql.end();
  console.log('--- Migración completada exitosamente ---');
}

run().catch(err => {
  console.error('Error durante la migración:', err);
  process.exit(1);
});
