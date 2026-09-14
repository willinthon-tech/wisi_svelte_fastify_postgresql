-- ==============================================================================
-- AGREGAR CAMPO NOTA A LA TABLA LIBRO_CONTROL_CLIENTES
-- ==============================================================================
ALTER TABLE libro_control_clientes ADD COLUMN IF NOT EXISTS nota TEXT DEFAULT '';
