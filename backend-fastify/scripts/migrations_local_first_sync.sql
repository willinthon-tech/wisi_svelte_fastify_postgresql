-- ==============================================================================
-- SCRIPT DE MIGRACIÓN: PREPARACIÓN PARA ARQUITECTURA LOCAL-FIRST Y DELTA SYNC
-- ==============================================================================
-- Este script es 100% SEGURO Y NO DESTRUCTIVO:
-- 1. NO borra ni altera los 'id' enteros existentes (preserva compatibilidad total
--    con dispositivos biométricos, hardware y llaves foráneas).
-- 2. Agrega la columna 'uuid' con generación automática para sincronización offline.
-- 3. Agrega 'is_deleted' y 'deleted_at' para soporte de eliminación lógica (Soft Delete).
-- 4. Crea un trigger automático para que 'updated_at' se actualice solo al hacer UPDATE.
-- ==============================================================================

-- 1. Habilitar extensión para UUIDs si no está habilitada
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Función genérica para actualizar 'updated_at' automáticamente
CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Función auxiliar para aplicar columnas y trigger a una tabla sin duplicar errores
DO $$
DECLARE
    t text;
    target_tables text[] := ARRAY[
        'clientes',
        'empleados',
        'salas',
        'departamentos',
        'areas',
        'cargos',
        'horarios',
        'maquinas',
        'mesas',
        'llaves',
        'estados',
        'sociedades',
        'valores',
        'juegos',
        'juegos_maquinas',
        'marcas',
        'modelos',
        'tipos',
        'modos',
        'legal',
        'rangos',
        'metodos_pago',
        'tipo_clientes',
        'tipo_incidencias',
        'dispositivos',
        'usuarios',
        'libros',
        'libro_control_clientes',
        'libro_aportes',
        'libro_control_llaves',
        'libro_incidencias_generales',
        'libro_novedades_mesas',
        'libro_datos',
        'libro_drop_mesas'
    ];
BEGIN
    FOREACH t IN ARRAY target_tables
    LOOP
        -- Verificar si la tabla existe en public
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            
            -- A. Agregar columna uuid
            EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid()', t);
            
            -- B. Agregar índice único en uuid si no existe
            IF NOT EXISTS (
                SELECT 1 FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relname = t || '_uuid_idx' AND n.nspname = 'public'
            ) THEN
                EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (uuid)', t || '_uuid_idx', t);
            END IF;

            -- C. Agregar columnas de Soft Delete
            EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE', t);
            EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL', t);

            -- D. Asegurar que updated_at exista
            EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP', t);

            -- E. Agregar Trigger de actualización automática de updated_at
            EXECUTE format('DROP TRIGGER IF EXISTS trg_set_updated_at ON %I', t);
            EXECUTE format('CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp()', t);

            -- F. Crear índice en updated_at para consultas delta ultra-rápidas
            IF NOT EXISTS (
                SELECT 1 FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relname = t || '_updated_at_idx' AND n.nspname = 'public'
            ) THEN
                EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (updated_at)', t || '_updated_at_idx', t);
            END IF;

            RAISE NOTICE 'Tabla % preparada para Local-First y Delta Sync exitosamente.', t;
        END IF;
    END LOOP;
END $$;
