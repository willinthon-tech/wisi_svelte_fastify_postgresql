import dotenv from 'dotenv';
dotenv.config();
import postgres from 'postgres';
import fs from 'fs';
import path from 'path';

async function run() {
  const sql = postgres({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT || 5432,
    database: process.env.PGDATABASE || 'wisi',
    username: process.env.PGUSER || 'root',
    password: process.env.PGPASSWORD || 'S0p0rt3R0y4l-2025'
  });

  try {
    const sqlContent = fs.readFileSync(path.join(process.cwd(), 'scripts', 'create_cecom_video_tables.sql'), 'utf8');
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
