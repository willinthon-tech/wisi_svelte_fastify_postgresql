-- ==============================================================================
-- SCRIPT DE MIGRACIÓN PARA EJECUTAR EN POSTGRESQL (DBeaver / pgAdmin / psql)
-- ==============================================================================
-- Elimina 'id' y establece 'uuid' como PRIMARY KEY en:
-- 1) record_libro_score_baccarat
-- 2) record_libro_score_baccarat_mesa
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Asegurar que las columnas 'uuid' existan
ALTER TABLE record_libro_score_baccarat ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();

-- 2. Poblar UUIDs faltantes en registros existentes si los hubiera
UPDATE record_libro_score_baccarat SET uuid = gen_random_uuid() WHERE uuid IS NULL;
UPDATE record_libro_score_baccarat_mesa SET uuid = gen_random_uuid() WHERE uuid IS NULL;

-- 3. Eliminar restricciones de Primary Key basadas en 'id'
ALTER TABLE record_libro_score_baccarat_mesa DROP CONSTRAINT IF EXISTS record_libro_score_baccarat_mesa_pkey CASCADE;
ALTER TABLE record_libro_score_baccarat DROP CONSTRAINT IF EXISTS record_libro_score_baccarat_pkey CASCADE;

-- 4. Eliminar completamente la columna obsoleta 'id'
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

-- 6. Asegurar columnas de zapatos (shoes) y sesión
ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS session_uuid VARCHAR(100);
ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS shoes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 7. Asegurar restricción única por sesión y mesa
ALTER TABLE record_libro_score_baccarat_mesa DROP CONSTRAINT IF EXISTS uq_baccarat_mesa_session;
ALTER TABLE record_libro_score_baccarat_mesa ADD CONSTRAINT uq_baccarat_mesa_session UNIQUE (session_id, mesa_id);

-- 8. Índices
CREATE INDEX IF NOT EXISTS idx_record_baccarat_sala ON record_libro_score_baccarat (sala_id);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_fecha ON record_libro_score_baccarat (fecha);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_uuid ON record_libro_score_baccarat (uuid);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_m_session ON record_libro_score_baccarat_mesa (session_id);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_m_uuid ON record_libro_score_baccarat_mesa (uuid);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_m_mesa ON record_libro_score_baccarat_mesa (mesa_id);
