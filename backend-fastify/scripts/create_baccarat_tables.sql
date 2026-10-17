-- ==============================================================================
-- WISI CASINO PLATFORM - MIGRACIÓN SCOREBOARD BACCARAT (ESTRICTO UUID)
-- ==============================================================================
-- Este script elimina completamente la columna 'id' (SERIAL/INTEGER) y define
-- 'uuid' (UUID PRIMARY KEY DEFAULT gen_random_uuid()) como única clave primaria,
-- conforme a los estándares obligatorios de la arquitectura WISI.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Tabla de Sesiones de Baccarat
CREATE TABLE IF NOT EXISTS record_libro_score_baccarat (
  uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sala_id VARCHAR(100) NOT NULL,
  fecha VARCHAR(50) NOT NULL,
  estado VARCHAR(20) DEFAULT 'abierta',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabla de Datos de Mesas (Zapatos e Historial de Manos)
CREATE TABLE IF NOT EXISTS record_libro_score_baccarat_mesa (
  uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR(100) NOT NULL,
  session_uuid VARCHAR(100),
  mesa_id VARCHAR(100) NOT NULL,
  shoe_number INTEGER DEFAULT 1,
  tie_mode VARCHAR(20) DEFAULT 'slash',
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  shoes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_baccarat_mesa_session UNIQUE (session_id, mesa_id)
);

-- ==============================================================================
-- MIGRACIÓN RETROACTIVA PARA BASES DE DATOS EXISTENTES
-- ==============================================================================

-- Asegurar que la columna 'uuid' exista
ALTER TABLE record_libro_score_baccarat ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();

-- Poblar UUIDs faltantes en registros antiguos si los hubiera
UPDATE record_libro_score_baccarat SET uuid = gen_random_uuid() WHERE uuid IS NULL;
UPDATE record_libro_score_baccarat_mesa SET uuid = gen_random_uuid() WHERE uuid IS NULL;

-- Eliminar restricciones de Primary Key basadas en 'id'
ALTER TABLE record_libro_score_baccarat_mesa DROP CONSTRAINT IF EXISTS record_libro_score_baccarat_mesa_pkey CASCADE;
ALTER TABLE record_libro_score_baccarat DROP CONSTRAINT IF EXISTS record_libro_score_baccarat_pkey CASCADE;

-- ELIMINAR DEFINITIVAMENTE LA COLUMNA OBSOLETA 'id'
ALTER TABLE record_libro_score_baccarat DROP COLUMN IF EXISTS id CASCADE;
ALTER TABLE record_libro_score_baccarat_mesa DROP COLUMN IF EXISTS id CASCADE;

-- Establecer 'uuid' como la única PRIMARY KEY
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

-- Asegurar columnas 'session_uuid' y 'shoes' JSONB
ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS session_uuid VARCHAR(100);
ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS shoes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Asegurar restricción única por sesión y mesa
ALTER TABLE record_libro_score_baccarat_mesa DROP CONSTRAINT IF EXISTS uq_baccarat_mesa_session;
ALTER TABLE record_libro_score_baccarat_mesa ADD CONSTRAINT uq_baccarat_mesa_session UNIQUE (session_id, mesa_id);

-- Índices de alto rendimiento
CREATE INDEX IF NOT EXISTS idx_record_baccarat_sala ON record_libro_score_baccarat (sala_id);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_fecha ON record_libro_score_baccarat (fecha);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_uuid ON record_libro_score_baccarat (uuid);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_m_session ON record_libro_score_baccarat_mesa (session_id);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_m_uuid ON record_libro_score_baccarat_mesa (uuid);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_m_mesa ON record_libro_score_baccarat_mesa (mesa_id);
