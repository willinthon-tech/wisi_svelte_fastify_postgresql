-- =========================================================================
-- SCRIPT SQL: ELIMINAR CAMPO ID (INTEGER) DE LA TABLA MAQUINAS
-- Base de datos: PostgreSQL (wisi)
-- Motivo: Todo el sistema opera 100% sobre UUID como Primary Key
-- =========================================================================

-- 1. Si la clave primaria actual o alguna restricción apunta a 'id', la eliminamos:
ALTER TABLE maquinas DROP CONSTRAINT IF EXISTS maquinas_pkey CASCADE;

-- 2. Aseguramos que la Primary Key sea la columna 'uuid':
ALTER TABLE maquinas ADD CONSTRAINT maquinas_pkey PRIMARY KEY (uuid);

-- 3. Eliminamos definitivamente la columna obsoleta 'id':
ALTER TABLE maquinas DROP COLUMN IF EXISTS id CASCADE;

-- 4. Eliminamos la secuencia autoincremental si existía:
DROP SEQUENCE IF EXISTS maquinas_id_seq CASCADE;

-- 5. Consulta de verificación:
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'maquinas' 
ORDER BY ordinal_position;
