import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const HOSTS_TO_TRY = [
  process.env.PGHOST,
  '66.97.43.124',
  'localhost'
].filter(Boolean);

async function run() {
  const sqlFile = path.join(__dirname, 'create_baccarat_tables.sql');
  const ddl = fs.readFileSync(sqlFile, 'utf8');

  let connected = false;
  let activeSql = null;
  let activeHost = null;

  for (const host of [...new Set(HOSTS_TO_TRY)]) {
    try {
      console.log(`Intentando conectar a PostgreSQL en ${host}...`);
      const testSql = postgres({
        host,
        port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
        database: process.env.PGDATABASE || 'wisi',
        username: process.env.PGUSER || 'root',
        password: process.env.PGPASSWORD || 'S0p0rt3R0y4l-2025',
        connect_timeout: 4
      });
      await testSql`SELECT 1;`;
      console.log(`✅ Conexión exitosa a PostgreSQL en ${host}`);
      activeSql = testSql;
      activeHost = host;
      connected = true;
      break;
    } catch (err) {
      console.warn(`❌ No se pudo conectar a ${host}:`, err.message);
    }
  }

  if (!connected || !activeSql) {
    console.error('No se pudo conectar a ninguna instancia de PostgreSQL.');
    process.exit(1);
  }

  try {
    console.log(`Ejecutando DDL de tablas Baccarat en ${activeHost}...`);
    await activeSql.unsafe(ddl);
    console.log('✅ Migración ejecutada exitosamente.');

    // Verificar las tablas creadas
    const tables = await activeSql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('record_libro_score_baccarat', 'record_libro_score_baccarat_mesa')
      ORDER BY table_name;
    `;
    console.log('\n--- Tablas confirmadas en PostgreSQL: ---');
    console.table(tables);

    for (const t of tables) {
      const cols = await activeSql`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns 
        WHERE table_name = ${t.table_name}
        ORDER BY ordinal_position;
      `;
      console.log(`\nColumnas de ${t.table_name}:`);
      console.table(cols);
    }
  } catch (err) {
    console.error('Error ejecutando migración:', err);
  } finally {
    await activeSql.end();
  }
}

run();
