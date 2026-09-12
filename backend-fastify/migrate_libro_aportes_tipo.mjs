import { initDb, sql } from './src/config/db.js';

async function main() {
  await initDb();
  console.log('--- Agregando columna tipo a libro_aportes ---');
  await sql`
    ALTER TABLE libro_aportes 
    ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) DEFAULT 'Aporte';
  `;
  await sql`
    UPDATE libro_aportes 
    SET tipo = 'Aporte' 
    WHERE tipo IS NULL OR TRIM(tipo) = '';
  `;
  console.log('✅ Columna tipo agregada exitosamente a libro_aportes.');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error en migración:', err);
  process.exit(1);
});
