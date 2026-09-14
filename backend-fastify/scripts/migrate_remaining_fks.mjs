import { initDb, sql } from '../src/config/db.js';

async function migrate() {
  await initDb();
  console.log('--- Agregando columnas UUID restantes y triggers ---');

  // 1. libro_reporte
  await sql.unsafe(`
    ALTER TABLE libro_reporte ADD COLUMN IF NOT EXISTS libro_uuid UUID;
    UPDATE libro_reporte lr 
    SET libro_uuid = l.uuid 
    FROM libros l 
    WHERE lr.libro_id = l.id AND lr.libro_uuid IS NULL;
    CREATE INDEX IF NOT EXISTS lr_libro_uuid_idx ON libro_reporte(libro_uuid);

    CREATE OR REPLACE FUNCTION sync_dual_keys_lr() RETURNS trigger AS $$
    BEGIN
      IF NEW.libro_uuid IS NOT NULL AND NEW.libro_id IS NULL THEN
        SELECT id INTO NEW.libro_id FROM libros WHERE uuid = NEW.libro_uuid;
      ELSIF NEW.libro_id IS NOT NULL AND NEW.libro_uuid IS NULL THEN
        SELECT uuid INTO NEW.libro_uuid FROM libros WHERE id = NEW.libro_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_sync_dual_keys_lr ON libro_reporte;
    CREATE TRIGGER trg_sync_dual_keys_lr
    BEFORE INSERT OR UPDATE ON libro_reporte
    FOR EACH ROW EXECUTE FUNCTION sync_dual_keys_lr();
  `);
  console.log('libro_reporte UUID and trigger synced.');

  // 2. empleado_dispositivos
  await sql.unsafe(`
    ALTER TABLE empleado_dispositivos ADD COLUMN IF NOT EXISTS empleado_uuid UUID;
    ALTER TABLE empleado_dispositivos ADD COLUMN IF NOT EXISTS dispositivo_uuid UUID;

    UPDATE empleado_dispositivos ed
    SET empleado_uuid = e.uuid
    FROM empleados e
    WHERE ed.empleado_id = e.id AND ed.empleado_uuid IS NULL;

    UPDATE empleado_dispositivos ed
    SET dispositivo_uuid = d.uuid
    FROM dispositivos d
    WHERE ed.dispositivo_id = d.id AND ed.dispositivo_uuid IS NULL;

    CREATE INDEX IF NOT EXISTS ed_empleado_uuid_idx ON empleado_dispositivos(empleado_uuid);
    CREATE INDEX IF NOT EXISTS ed_dispositivo_uuid_idx ON empleado_dispositivos(dispositivo_uuid);

    CREATE OR REPLACE FUNCTION sync_dual_keys_ed() RETURNS trigger AS $$
    BEGIN
      IF NEW.empleado_uuid IS NOT NULL AND NEW.empleado_id IS NULL THEN
        SELECT id INTO NEW.empleado_id FROM empleados WHERE uuid = NEW.empleado_uuid;
      ELSIF NEW.empleado_id IS NOT NULL AND NEW.empleado_uuid IS NULL THEN
        SELECT uuid INTO NEW.empleado_uuid FROM empleados WHERE id = NEW.empleado_id;
      END IF;

      IF NEW.dispositivo_uuid IS NOT NULL AND NEW.dispositivo_id IS NULL THEN
        SELECT id INTO NEW.dispositivo_id FROM dispositivos WHERE uuid = NEW.dispositivo_uuid;
      ELSIF NEW.dispositivo_id IS NOT NULL AND NEW.dispositivo_uuid IS NULL THEN
        SELECT uuid INTO NEW.dispositivo_uuid FROM dispositivos WHERE id = NEW.dispositivo_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_sync_dual_keys_ed ON empleado_dispositivos;
    CREATE TRIGGER trg_sync_dual_keys_ed
    BEFORE INSERT OR UPDATE ON empleado_dispositivos
    FOR EACH ROW EXECUTE FUNCTION sync_dual_keys_ed();
  `);
  console.log('empleado_dispositivos UUID and trigger synced.');

  // 3. attlogs
  await sql.unsafe(`
    ALTER TABLE attlogs ADD COLUMN IF NOT EXISTS dispositivo_uuid UUID;

    UPDATE attlogs a
    SET dispositivo_uuid = d.uuid
    FROM dispositivos d
    WHERE a.dispositivo_id = d.id AND a.dispositivo_uuid IS NULL;

    CREATE INDEX IF NOT EXISTS attlogs_dispositivo_uuid_idx ON attlogs(dispositivo_uuid);

    CREATE OR REPLACE FUNCTION sync_dual_keys_attlogs() RETURNS trigger AS $$
    BEGIN
      IF NEW.dispositivo_uuid IS NOT NULL AND NEW.dispositivo_id IS NULL THEN
        SELECT id INTO NEW.dispositivo_id FROM dispositivos WHERE uuid = NEW.dispositivo_uuid;
      ELSIF NEW.dispositivo_id IS NOT NULL AND NEW.dispositivo_uuid IS NULL THEN
        SELECT uuid INTO NEW.dispositivo_uuid FROM dispositivos WHERE id = NEW.dispositivo_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_sync_dual_keys_attlogs ON attlogs;
    CREATE TRIGGER trg_sync_dual_keys_attlogs
    BEFORE INSERT OR UPDATE ON attlogs
    FOR EACH ROW EXECUTE FUNCTION sync_dual_keys_attlogs();
  `);
  console.log('attlogs UUID and trigger synced.');

  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
