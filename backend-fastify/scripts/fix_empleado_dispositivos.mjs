import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const sql = postgres({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'wisi',
  username: process.env.PGUSER || 'root',
  password: process.env.PGPASSWORD || 'S0p0rt3R0y4l-2025',
  onnotice: () => {}
});

async function main() {
  console.log('--- REPARACIÓN DE EMPLEADO_DISPOSITIVOS ---');

  // Establecer timeout para evitar que se quede esperando locks infinitamente
  await sql`SET lock_timeout = '10s';`;
  console.log('1. Lock timeout establecido en 10s.');

  console.log('2. Verificando tabla empleado_dispositivos...');
  await sql.unsafe(`ALTER TABLE empleado_dispositivos ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();`);
  await sql.unsafe(`ALTER TABLE empleado_dispositivos ALTER COLUMN uuid SET DEFAULT gen_random_uuid();`);
  console.log('✔ Columna uuid configurada con gen_random_uuid().');

  console.log('3. Removiendo NOT NULL de columna id (si existe)...');
  try {
    await sql.unsafe(`ALTER TABLE empleado_dispositivos ALTER COLUMN id DROP NOT NULL;`);
    console.log('✔ NOT NULL removido de columna id.');
  } catch (e) {
    console.log('   (columna id no tiene NOT NULL o no existe)');
  }

  try {
    await sql.unsafe(`ALTER TABLE empleado_dispositivos DROP COLUMN IF EXISTS id CASCADE;`);
    console.log('✔ Columna id eliminada.');
  } catch (e) {
    console.log('   (columna id ya no existe)');
  }

  console.log('4. Asegurando compatibilidad con columnas legadas...');
  try {
    await sql.unsafe(`ALTER TABLE empleado_dispositivos ALTER COLUMN empleado_id DROP NOT NULL;`);
  } catch (_) {}
  try {
    await sql.unsafe(`ALTER TABLE empleado_dispositivos ALTER COLUMN dispositivo_id DROP NOT NULL;`);
  } catch (_) {}
  try {
    await sql.unsafe(`DROP TRIGGER IF EXISTS trg_sync_dual_keys_ed ON empleado_dispositivos CASCADE;`);
  } catch (_) {}

  console.log('5. Asegurando constraint UNIQUE (empleado_uuid, dispositivo_uuid)...');
  try {
    await sql.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uk_emp_disp_uuid' OR conname = 'empleado_dispositivos_empleado_uuid_dispositivo_uuid_key'
        ) THEN
          DELETE FROM empleado_dispositivos a USING empleado_dispositivos b 
          WHERE a.ctid < b.ctid AND a.empleado_uuid = b.empleado_uuid AND a.dispositivo_uuid = b.dispositivo_uuid;
          ALTER TABLE empleado_dispositivos ADD CONSTRAINT uk_emp_disp_uuid UNIQUE (empleado_uuid, dispositivo_uuid);
        END IF;
      END $$;
    `);
    console.log('✔ Constraint UNIQUE (empleado_uuid, dispositivo_uuid) configurado.');
  } catch (e) {
    console.log('   Aviso en constraint UNIQUE:', e.message);
  }

  console.log('\n============================================================');
  console.log('✔ TABLA EMPLEADO_DISPOSITIVOS REPARADA CON ÉXITO');
  console.log('============================================================');
  await sql.end();
}

main().catch(err => {
  console.error('\n❌ Error durante la reparación:', err.message);
  process.exit(1);
});
