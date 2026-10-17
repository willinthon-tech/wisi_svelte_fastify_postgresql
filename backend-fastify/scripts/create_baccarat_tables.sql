-- ========================================================
-- Tablas para Scoreboard de Baccarat
-- ========================================================

CREATE TABLE IF NOT EXISTS record_libro_score_baccarat (
  id SERIAL PRIMARY KEY,
  uuid UUID DEFAULT gen_random_uuid() UNIQUE,
  sala_id VARCHAR(100) NOT NULL,
  fecha VARCHAR(50) NOT NULL,
  estado VARCHAR(20) DEFAULT 'abierta',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_record_baccarat_sala ON record_libro_score_baccarat (sala_id);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_fecha ON record_libro_score_baccarat (fecha);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_uuid ON record_libro_score_baccarat (uuid);

CREATE TABLE IF NOT EXISTS record_libro_score_baccarat_mesa (
  id SERIAL PRIMARY KEY,
  uuid UUID DEFAULT gen_random_uuid() UNIQUE,
  session_id VARCHAR(100) NOT NULL,
  session_uuid VARCHAR(100),
  mesa_id VARCHAR(100) NOT NULL,
  shoe_number INTEGER DEFAULT 1,
  tie_mode VARCHAR(20) DEFAULT 'slash',
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_baccarat_mesa_session UNIQUE (session_id, mesa_id)
);

-- Migraciones seguras para retrocompatibilidad
ALTER TABLE record_libro_score_baccarat ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS session_uuid VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_record_baccarat_m_session ON record_libro_score_baccarat_mesa (session_id);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_m_uuid ON record_libro_score_baccarat_mesa (uuid);
CREATE INDEX IF NOT EXISTS idx_record_baccarat_m_mesa ON record_libro_score_baccarat_mesa (mesa_id);
