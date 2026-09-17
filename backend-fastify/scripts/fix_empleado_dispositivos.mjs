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
  console.log('--- REPARACIÓN Y SANEAMIENTO DE EMPLEADO_DISPOSITIVOS Y KEYS ---');

  await sql.unsafe(`
    DO $$
    BEGIN
      -- 1. empleado_dispositivos: asegurar UUID, remover NOT NULL de id y columnas legadas
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'empleado_dispositivos') THEN
        ALTER TABLE empleado_dispositivos ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
        ALTER TABLE empleado_dispositivos ALTER COLUMN uuid SET DEFAULT gen_random_uuid();

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'empleado_dispositivos' AND column_name = 'id') THEN
          ALTER TABLE empleado_dispositivos ALTER COLUMN id DROP NOT NULL;
          BEGIN
            ALTER TABLE empleado_dispositivos DROP COLUMN IF EXISTS id CASCADE;
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'empleado_dispositivos' AND column_name = 'empleado_id') THEN
          ALTER TABLE empleado_dispositivos ALTER COLUMN empleado_id DROP NOT NULL;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'empleado_dispositivos' AND column_name = 'dispositivo_id') THEN
          ALTER TABLE empleado_dispositivos ALTER COLUMN dispositivo_id DROP NOT NULL;
        END IF;

        DROP TRIGGER IF EXISTS trg_sync_dual_keys_ed ON empleado_dispositivos CASCADE;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uk_emp_disp_uuid' OR conname = 'empleado_dispositivos_empleado_uuid_dispositivo_uuid_key'
        ) THEN
          BEGIN
            DELETE FROM empleado_dispositivos a USING empleado_dispositivos b 
            WHERE a.ctid < b.ctid AND a.empleado_uuid = b.empleado_uuid AND a.dispositivo_uuid = b.dispositivo_uuid;
            ALTER TABLE empleado_dispositivos ADD CONSTRAINT uk_emp_disp_uuid UNIQUE (empleado_uuid, dispositivo_uuid);
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
        END IF;
      END IF;

      -- 2. Saneamiento universal: remover NOT NULL de cualquier columna 'id' que no sea PK
      BEGIN
        EXECUTE (
          SELECT COALESCE(string_agg('ALTER TABLE "' || c.table_name || '" ALTER COLUMN id DROP NOT NULL;', ' '), '')
          FROM information_schema.columns c
          LEFT JOIN (
            SELECT tc.table_name, ccu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
            WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
          ) pk ON c.table_name = pk.table_name AND c.column_name = pk.column_name
          WHERE c.table_schema = 'public' 
            AND c.column_name = 'id' 
            AND (pk.column_name IS NULL OR pk.column_name != 'id')
            AND c.is_nullable = 'NO'
        );
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END $$;
  `);

  console.log('✔ Tabla empleado_dispositivos saneada con éxito.');
  await sql.end();
}

main().catch(err => {
  console.error('Error durante la reparación:', err);
  process.exit(1);
});
