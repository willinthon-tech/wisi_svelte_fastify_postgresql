import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function runCreateErpTables() {
  const sql = postgres({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    database: process.env.PGDATABASE || 'wisi',
    username: process.env.PGUSER || 'root',
    password: process.env.PGPASSWORD || 'S0p0rt3R0y4l-2025'
  });

  try {
    const sqlFile = path.join(__dirname, 'create_erp_tables.sql');
    const sqlContent = fs.readFileSync(sqlFile, 'utf8');

    console.log('📦 Ejecutando migración DDL de tablas ERP (100% UUID)...');
    await sql.unsafe(sqlContent);
    console.log('✅ ¡Tablas creadas exitosamente en PostgreSQL!');

    // Verificar las tablas erp_* creadas
    const createdTables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name LIKE 'erp_%' 
      ORDER BY table_name
    `;
    console.log('\n📋 Tablas ERP activas en PostgreSQL:');
    for (const t of createdTables) {
      console.log(`  ✓ ${t.table_name}`);
    }

  } catch (err) {
    console.error('❌ Error creando tablas ERP:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runCreateErpTables();
