-- =========================================================================
-- SCRIPT SQL: ELIMINAR COLUMNAS 'id' Y 'page_id' DE 'paginas' Y 'modulos'
-- Base de datos: PostgreSQL (wisi)
-- =========================================================================

DO $$
BEGIN
    RAISE NOTICE 'Iniciando purga definitiva de columnas id y page_id en paginas y modulos...';

    -- 1. Asegurar que uuid sea la PRIMARY KEY de paginas
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conrelid = 'paginas'::regclass AND contype = 'p'
    ) THEN
        ALTER TABLE paginas ADD PRIMARY KEY (uuid);
        RAISE NOTICE 'Primary key (uuid) agregada a paginas.';
    END IF;

    -- 2. Asegurar que uuid sea la PRIMARY KEY de modulos
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conrelid = 'modulos'::regclass AND contype = 'p'
    ) THEN
        ALTER TABLE modulos ADD PRIMARY KEY (uuid);
        RAISE NOTICE 'Primary key (uuid) agregada a modulos.';
    END IF;

    -- 3. Asegurar la foreign key modulos(page_uuid) -> paginas(uuid)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'fk_modulos_page_uuid'
    ) THEN
        ALTER TABLE modulos 
        ADD CONSTRAINT fk_modulos_page_uuid 
        FOREIGN KEY (page_uuid) REFERENCES paginas(uuid) ON DELETE CASCADE;
        RAISE NOTICE 'Foreign key fk_modulos_page_uuid configurada.';
    END IF;

    -- 4. Eliminar triggers duales o legados que intenten actualizar id o page_id
    DROP TRIGGER IF EXISTS trigger_sync_dual_modulos ON modulos CASCADE;
    DROP TRIGGER IF EXISTS trigger_sync_dual_paginas ON paginas CASCADE;

    -- 5. Eliminar la columna 'page_id' de modulos
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'modulos' AND column_name = 'page_id'
    ) THEN
        ALTER TABLE modulos DROP COLUMN page_id CASCADE;
        RAISE NOTICE 'Columna modulos.page_id ELIMINADA exitosamente.';
    ELSE
        RAISE NOTICE 'Columna modulos.page_id ya no existía.';
    END IF;

    -- 6. Eliminar la columna 'id' de modulos
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'modulos' AND column_name = 'id'
    ) THEN
        ALTER TABLE modulos DROP COLUMN id CASCADE;
        RAISE NOTICE 'Columna modulos.id ELIMINADA exitosamente.';
    ELSE
        RAISE NOTICE 'Columna modulos.id ya no existía.';
    END IF;

    -- 7. Eliminar la columna 'id' de paginas
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'paginas' AND column_name = 'id'
    ) THEN
        ALTER TABLE paginas DROP COLUMN id CASCADE;
        RAISE NOTICE 'Columna paginas.id ELIMINADA exitosamente.';
    ELSE
        RAISE NOTICE 'Columna paginas.id ya no existía.';
    END IF;

    RAISE NOTICE '¡Purga completada! Ahora paginas y modulos usan 100%% UUID de forma estricta.';
END $$;

-- Verificación de columnas resultantes:
SELECT 
    table_name, 
    column_name, 
    data_type, 
    is_nullable
FROM information_schema.columns
WHERE table_name IN ('paginas', 'modulos')
ORDER BY table_name, ordinal_position;
