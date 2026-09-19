-- =========================================================================
-- SCRIPT SQL: ELIMINAR CONTADORES INICIALES DE LA TABLA MAQUINAS
-- Base de datos: PostgreSQL (wisi)
-- =========================================================================

ALTER TABLE maquinas DROP COLUMN IF EXISTS contador_entrada_inicial CASCADE;
ALTER TABLE maquinas DROP COLUMN IF EXISTS contador_salida_inicial CASCADE;
ALTER TABLE maquinas DROP COLUMN IF EXISTS contador_jackpot_inicial CASCADE;

-- Verificación de columnas restantes en maquinas:
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'maquinas' 
ORDER BY ordinal_position;
