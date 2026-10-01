import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });
import postgres from 'postgres';

async function run() {
  const sql = postgres({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    database: process.env.PGDATABASE || 'wisi',
    username: process.env.PGUSER || 'root',
    password: process.env.PGPASSWORD || 'S0p0rt3R0y4l-2025'
  });

  try {
    const sqlPath = path.join(__dirname, 'create_cecom_video_tables.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');
    await sql.unsafe(sqlContent);
    console.log('✅ Migración ejecutada con éxito en PostgreSQL!');
    
    // Verificar tablas creadas
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name IN ('dispositivos_camaras', 'camaras', 'mesas_camaras', 'cecom_ia_eventos', 'cecom_ia_jugadas', 'cecom_ia_novedades')
    `;
    console.log('Tablas verificadas en base de datos:', tables.map(t => t.table_name));
  } catch (err) {
    console.error('❌ Error ejecutando migración:', err);
  } finally {
    await sql.end();
  }
}

run();
