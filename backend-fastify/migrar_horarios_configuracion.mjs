import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sql = postgres({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'wisi',
  username: process.env.PGUSER || 'root',
  password: process.env.PGPASSWORD || 'S0p0rt3R0y4l-2025',
  max: 1
});

async function runMigration() {
  console.log('🚀 Iniciando migración de Horarios a Configuración...');
  try {
    const sqlPath = path.join(__dirname, 'migracion_horarios_configuracion.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    await sql.file(sqlPath);
    console.log('✅ Archivo SQL ejecutado exitosamente.');

    // Validar estado de la tabla horarios
    const columns = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'horarios'
    `;
    console.log('📋 Columnas actuales de "horarios":', columns.map(c => c.column_name));

    const hasSalaId = columns.some(c => c.column_name === 'sala_id');
    if (hasSalaId) {
      console.error('❌ ADVERTENCIA: sala_id sigue existiendo en horarios.');
    } else {
      console.log('🎉 "sala_id" eliminada correctamente de "horarios".');
    }

    const countRes = await sql`SELECT count(*)::int as count FROM horarios`;
    console.log(`📊 Total de horarios registrados ahora: ${countRes[0].count}`);

    const modulos = await sql`
      SELECT m.id, m.nombre, m.ruta, m.page_id, p.nombre as pagina_nombre
      FROM modulos m
      LEFT JOIN paginas p ON m.page_id = p.id
      WHERE m.ruta LIKE '%horario%' OR m.nombre ILIKE '%horario%'
    `;
    console.log('📌 Módulos de horarios configurados:', modulos);

  } catch (err) {
    console.error('❌ Error ejecutando migración:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runMigration();
