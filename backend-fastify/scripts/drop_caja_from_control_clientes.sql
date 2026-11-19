-- =========================================================================
-- SCRIPT PARA ELIMINAR LA COLUMNA 'caja' DE LA TABLA libro_control_clientes
-- =========================================================================

-- 1. Eliminar la columna 'caja' si existe en la tabla libro_control_clientes
ALTER TABLE public.libro_control_clientes DROP COLUMN IF EXISTS caja;

-- 2. Notificación en pgAdmin / PostgreSQL
DO $$
BEGIN
    RAISE NOTICE 'Columna "caja" eliminada exitosamente de public.libro_control_clientes.';
END $$;
