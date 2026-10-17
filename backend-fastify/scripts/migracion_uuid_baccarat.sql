-- ==============================================================================
-- SCRIPT DE MIGRACIÓN PARA EJECUTAR EN POSTGRESQL (DBeaver / pgAdmin / psql)
-- ==============================================================================
-- Estandarización a UUIDs estricto según la arquitectura WISI:
-- 1) record_libro_score_baccarat:
--      PK: uuid
--      sala_uuid (VARCHAR 100) -> Se elimina sala_id obsoleto
--      fecha, estado, created_at, updated_at
-- 2) record_libro_score_baccarat_mesa:
--      PK: uuid
--      record_libro_score_baccarat_uuid (UUID FK) -> Se eliminan session_id y session_uuid obsoletos
--      mesa_uuid (VARCHAR 100) -> Se elimina mesa_id obsoleto
--      UNIQUE (record_libro_score_baccarat_uuid, mesa_uuid)
--      shoe_number, tie_mode, history, shoes, created_at, updated_at
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Asegurar que las columnas 'uuid' existan
ALTER TABLE record_libro_score_baccarat ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();

-- 2. Poblar UUIDs faltantes en registros existentes si los hubiera
UPDATE record_libro_score_baccarat SET uuid = gen_random_uuid() WHERE uuid IS NULL;
UPDATE record_libro_score_baccarat_mesa SET uuid = gen_random_uuid() WHERE uuid IS NULL;

-- 3. Eliminar restricciones de Primary Key obsoletas
ALTER TABLE record_libro_score_baccarat_mesa DROP CONSTRAINT IF EXISTS record_libro_score_baccarat_mesa_pkey CASCADE;
ALTER TABLE record_libro_score_baccarat DROP CONSTRAINT IF EXISTS record_libro_score_baccarat_pkey CASCADE;

-- 4. Eliminar completamente la columna obsoleta 'id' si todavía existiera
ALTER TABLE record_libro_score_baccarat DROP COLUMN IF EXISTS id CASCADE;
ALTER TABLE record_libro_score_baccarat_mesa DROP COLUMN IF EXISTS id CASCADE;

-- 5. Establecer 'uuid' como la única PRIMARY KEY
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'record_libro_score_baccarat_pkey'
  ) THEN
    ALTER TABLE record_libro_score_baccarat ADD PRIMARY KEY (uuid);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'record_libro_score_baccarat_mesa_pkey'
  ) THEN
    ALTER TABLE record_libro_score_baccarat_mesa ADD PRIMARY KEY (uuid);
  END IF;
END $$;

-- 6. En record_libro_score_baccarat: asegurar columna sala_uuid y migrar datos desde sala_id
ALTER TABLE record_libro_score_baccarat ADD COLUMN IF NOT EXISTS sala_uuid VARCHAR(100);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'record_libro_score_baccarat' AND column_name = 'sala_id') THEN
    UPDATE record_libro_score_baccarat SET sala_uuid = sala_id WHERE sala_uuid IS NULL;
    -- Eliminar la columna obsoleta sala_id
    ALTER TABLE record_libro_score_baccarat DROP COLUMN IF EXISTS sala_id CASCADE;
  END IF;
END $$;

-- 7. En record_libro_score_baccarat_mesa: estandarizar a record_libro_score_baccarat_uuid y mesa_uuid
ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS record_libro_score_baccarat_uuid UUID;
ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS mesa_uuid VARCHAR(100);
ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS shoes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Migrar datos de columnas legacy hacia record_libro_score_baccarat_uuid y mesa_uuid
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'record_libro_score_baccarat_mesa' AND column_name = 'session_uuid') THEN
    UPDATE record_libro_score_baccarat_mesa
    SET record_libro_score_baccarat_uuid = session_uuid::uuid
    WHERE record_libro_score_baccarat_uuid IS NULL 
      AND session_uuid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'record_libro_score_baccarat_mesa' AND column_name = 'session_id') THEN
    UPDATE record_libro_score_baccarat_mesa
    SET record_libro_score_baccarat_uuid = session_id::uuid
    WHERE record_libro_score_baccarat_uuid IS NULL 
      AND session_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'record_libro_score_baccarat_mesa' AND column_name = 'mesa_id') THEN
    UPDATE record_libro_score_baccarat_mesa
    SET mesa_uuid = mesa_id
    WHERE mesa_uuid IS NULL;
  END IF;

  -- Eliminar las columnas obsoletas session_id, session_uuid y mesa_id
  ALTER TABLE record_libro_score_baccarat_mesa DROP COLUMN IF EXISTS session_id CASCADE;
  ALTER TABLE record_libro_score_baccarat_mesa DROP COLUMN IF EXISTS session_uuid CASCADE;
  ALTER TABLE record_libro_score_baccarat_mesa DROP COLUMN IF EXISTS mesa_id CASCADE;
END $$;

-- 8. Actualizar restricciones UNIQUE
ALTER TABLE record_libro_score_baccarat_mesa DROP CONSTRAINT IF EXISTS uq_baccarat_mesa_session CASCADE;
ALTER TABLE record_libro_score_baccarat_mesa DROP CONSTRAINT IF EXISTS uq_baccarat_mesa_uuid CASCADE;
ALTER TABLE record_libro_score_baccarat_mesa ADD CONSTRAINT uq_baccarat_mesa_uuid UNIQUE (record_libro_score_baccarat_uuid, mesa_uuid);

-- 9. Índices
CREATE INDEX IF NOT EXISTS idx_record_baccarat_sala_uuid ON record_libro_score_baccarat (sala_uuid);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_fecha ON record_libro_score_baccarat (fecha);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_uuid ON record_libro_score_baccarat (uuid);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_m_sess_uuid ON record_libro_score_baccarat_mesa (record_libro_score_baccarat_uuid);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_m_mesa_uuid ON record_libro_score_baccarat_mesa (mesa_uuid);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_m_uuid ON record_libro_score_baccarat_mesa (uuid);

-- 10. LIMPIEZA DE SESIONES CON FECHAS FUTURAS INVENTADAS (por ejemplo 2026-10-23 o pruebas pasadas)
DELETE FROM record_libro_score_baccarat_mesa
WHERE record_libro_score_baccarat_uuid IN (
  SELECT uuid FROM record_libro_score_baccarat WHERE fecha > CURRENT_DATE::text
);
DELETE FROM record_libro_score_baccarat WHERE fecha > CURRENT_DATE::text;
