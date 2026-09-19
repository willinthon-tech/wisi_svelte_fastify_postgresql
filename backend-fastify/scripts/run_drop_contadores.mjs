import { sql, initDb } from '../src/config/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  await initDb();
  const sqlFile = path.resolve(__dirname, 'eliminar_contadores_iniciales_maquinas.sql');
  const query = fs.readFileSync(sqlFile, 'utf8');
  await sql.unsafe(query);
  console.log('Columnas de contadores iniciales eliminadas de maquinas en PostgreSQL local!');
  const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'maquinas' ORDER BY ordinal_position;`;
  console.log('Columnas actuales en maquinas:', cols.map(c => c.column_name));
  await sql.end();
}

run().catch(console.error);
