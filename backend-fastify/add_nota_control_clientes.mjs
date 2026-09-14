import postgres from 'postgres';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

const sql = postgres({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'wisi',
  username: process.env.PGUSER || 'root',
  password: process.env.PGPASSWORD || 'S0p0rt3R0y4l-2025',
  max: 1
});

async function run() {
  console.log('🚀 Aplicando migración para columna nota en libro_control_clientes...');
  const sqlContent = fs.readFileSync(path.resolve(__dirname, 'add_nota_control_clientes.sql'), 'utf8');
  await sql.unsafe(sqlContent);
  console.log('✅ SQL ejecutado exitosamente.');

  const cols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'libro_control_clientes'
    ORDER BY ordinal_position
  `;
  console.log('📋 Columnas actuales de libro_control_clientes:', cols.map(c => `${c.column_name} (${c.data_type})`));
  await sql.end();
}

run().catch(console.error);
