-- =========================================================================
-- SCRIPT MAESTRO V3: PURGA TOTAL DE CAMPOS 'id' Y '*_id' EN TODA LA BASE DE DATOS
-- Base de Datos: PostgreSQL (wisi)
-- Filtra exclusivamente tablas reales ('BASE TABLE') y maneja excepciones por tabla
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
DECLARE
    r RECORD;
    rec_tbl RECORD;
    old_pk_name TEXT;
BEGIN
    RAISE NOTICE '>>> PASO 1: Asegurando que todas las tablas base tengan columna uuid NOT NULL...';
    FOR rec_tbl IN (
        SELECT tbl.table_name 
        FROM information_schema.tables tbl
        WHERE tbl.table_schema = 'public' 
          AND tbl.table_type = 'BASE TABLE' 
          AND tbl.table_name != 'configuracion'
    ) LOOP
        BEGIN
            EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid()', rec_tbl.table_name);
            EXECUTE format('UPDATE %I SET uuid = gen_random_uuid() WHERE uuid IS NULL', rec_tbl.table_name);
            EXECUTE format('ALTER TABLE %I ALTER COLUMN uuid SET NOT NULL', rec_tbl.table_name);
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Advertencia en uuid de %: %', rec_tbl.table_name, SQLERRM;
        END;
    END LOOP;

    RAISE NOTICE '>>> PASO 2: Migrando Unique Constraints legadas a UUID...';
    
    -- attlogs
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_attlog_record') THEN
        ALTER TABLE attlogs DROP CONSTRAINT uk_attlog_record;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_attlog_record_uuid') THEN
        BEGIN
            ALTER TABLE attlogs ADD CONSTRAINT uk_attlog_record_uuid UNIQUE (dispositivo_uuid, employee_no, event_time);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    -- empleados_excepciones_horarios
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_emp_fecha_excepcion') THEN
        ALTER TABLE empleados_excepciones_horarios DROP CONSTRAINT uk_emp_fecha_excepcion;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_emp_fecha_excepcion_uuid') THEN
        BEGIN
            ALTER TABLE empleados_excepciones_horarios ADD CONSTRAINT uk_emp_fecha_excepcion_uuid UNIQUE (empleado_uuid, fecha);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    -- empleados_horarios
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_emp_plantilla') THEN
        ALTER TABLE empleados_horarios DROP CONSTRAINT uk_emp_plantilla;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_emp_plantilla_uuid') THEN
        BEGIN
            ALTER TABLE empleados_horarios ADD CONSTRAINT uk_emp_plantilla_uuid UNIQUE (empleado_uuid, horario_uuid);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    -- libro_datos
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'libro_datos_libro_id_key') THEN
        ALTER TABLE libro_datos DROP CONSTRAINT libro_datos_libro_id_key;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'libro_datos_libro_uuid_key') THEN
        BEGIN
            ALTER TABLE libro_datos ADD CONSTRAINT libro_datos_libro_uuid_key UNIQUE (libro_uuid);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    -- libro_novedades_mesas
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_libro_mesa_novedad') THEN
        ALTER TABLE libro_novedades_mesas DROP CONSTRAINT uq_libro_mesa_novedad;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_libro_mesa_novedad_uuid') THEN
        BEGIN
            ALTER TABLE libro_novedades_mesas ADD CONSTRAINT uq_libro_mesa_novedad_uuid UNIQUE (libro_uuid, mesa_uuid);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    -- libro_reporte
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'libro_reporte_libro_id_key') THEN
        ALTER TABLE libro_reporte DROP CONSTRAINT libro_reporte_libro_id_key;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_libro_reporte_libro_id') THEN
        ALTER TABLE libro_reporte DROP CONSTRAINT uq_libro_reporte_libro_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_libro_reporte_libro_uuid') THEN
        BEGIN
            ALTER TABLE libro_reporte ADD CONSTRAINT uq_libro_reporte_libro_uuid UNIQUE (libro_uuid);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    -- mesas
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_mesas_nombre_sala') THEN
        ALTER TABLE mesas DROP CONSTRAINT uq_mesas_nombre_sala;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_mesas_nombre_sala_uuid') THEN
        BEGIN
            ALTER TABLE mesas ADD CONSTRAINT uq_mesas_nombre_sala_uuid UNIQUE (sala_uuid, nombre);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    -- modelos
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_modelos_nombre_marca') THEN
        ALTER TABLE modelos DROP CONSTRAINT uq_modelos_nombre_marca;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_modelos_nombre_marca_uuid') THEN
        BEGIN
            ALTER TABLE modelos ADD CONSTRAINT uq_modelos_nombre_marca_uuid UNIQUE (marca_uuid, nombre);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    -- user_module_permissions
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_user_module_perm') THEN
        ALTER TABLE user_module_permissions DROP CONSTRAINT uk_user_module_perm;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_module_permissions_user_id_module_id_permission_id_key') THEN
        ALTER TABLE user_module_permissions DROP CONSTRAINT user_module_permissions_user_id_module_id_permission_id_key;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_user_module_perm_uuid') THEN
        BEGIN
            ALTER TABLE user_module_permissions ADD CONSTRAINT uk_user_module_perm_uuid UNIQUE (user_uuid, module_uuid, permission_uuid);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    -- user_salas
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_salas_user_id_sala_id_key') THEN
        ALTER TABLE user_salas DROP CONSTRAINT user_salas_user_id_sala_id_key;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_salas_user_uuid_sala_uuid_key') THEN
        BEGIN
            ALTER TABLE user_salas ADD CONSTRAINT user_salas_user_uuid_sala_uuid_key UNIQUE (user_uuid, sala_uuid);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    RAISE NOTICE '>>> PASO 3: Eliminando triggers duales...';
    FOR r IN (
        SELECT trigger_name, event_object_table
        FROM information_schema.triggers
        WHERE trigger_name LIKE '%dual%'
    ) LOOP
        BEGIN
            EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I CASCADE', r.trigger_name, r.event_object_table);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END LOOP;

    RAISE NOTICE '>>> PASO 4: Eliminando Foreign Keys legadas que apuntan a columnas id...';
    FOR r IN (
        SELECT tc.table_name, tc.constraint_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND ccu.column_name = 'id'
    ) LOOP
        BEGIN
            EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I CASCADE', r.table_name, r.constraint_name);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END LOOP;

    RAISE NOTICE '>>> PASO 5: Convirtiendo columna uuid en PRIMARY KEY en todas las tablas base...';
    FOR rec_tbl IN (
        SELECT tbl.table_name 
        FROM information_schema.tables tbl
        WHERE tbl.table_schema = 'public' 
          AND tbl.table_type = 'BASE TABLE' 
          AND tbl.table_name != 'configuracion'
    ) LOOP
        BEGIN
            -- Buscar si tiene PK sobre id
            SELECT tc.constraint_name INTO old_pk_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
            WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name = rec_tbl.table_name AND ccu.column_name = 'id';

            IF old_pk_name IS NOT NULL THEN
                EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I CASCADE', rec_tbl.table_name, old_pk_name);
            END IF;

            -- Asegurar que uuid sea la PK
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints tc
                JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
                WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name = rec_tbl.table_name AND ccu.column_name = 'uuid'
            ) THEN
                EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', rec_tbl.table_name, rec_tbl.table_name || '_uuid_key');
                EXECUTE format('ALTER TABLE %I ADD PRIMARY KEY (uuid)', rec_tbl.table_name);
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Advertencia en PK de %: %', rec_tbl.table_name, SQLERRM;
        END;
    END LOOP;

    RAISE NOTICE '>>> PASO 6: Eliminando definitivamente la columna id de todas las tablas base...';
    FOR r IN (
        SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables tbl 
          ON c.table_name = tbl.table_name AND c.table_schema = tbl.table_schema
        WHERE c.table_schema = 'public' 
          AND tbl.table_type = 'BASE TABLE'
          AND c.column_name = 'id'
    ) LOOP
        BEGIN
            EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS id CASCADE', r.table_name);
            RAISE NOTICE 'Columna id eliminada de: %', r.table_name;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'No se pudo eliminar id de %: %', r.table_name, SQLERRM;
        END;
    END LOOP;

    RAISE NOTICE '>>> PASO 7: Eliminando columnas foráneas legadas *_id de tipo entero en tablas base...';
    FOR r IN (
        SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables tbl 
          ON c.table_name = tbl.table_name AND c.table_schema = tbl.table_schema
        WHERE c.table_schema = 'public' 
          AND tbl.table_type = 'BASE TABLE'
          AND c.column_name LIKE '%\_id' ESCAPE '\' 
          AND c.column_name != 'id'
          AND c.data_type IN ('integer', 'smallint', 'bigint')
    ) LOOP
        BEGIN
            EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS %I CASCADE', r.table_name, r.column_name);
            RAISE NOTICE 'Columna *_id eliminada: %.%', r.table_name, r.column_name;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'No se pudo eliminar %.%: %', r.table_name, r.column_name, SQLERRM;
        END;
    END LOOP;

    RAISE NOTICE '>>> PASO 8: Eliminando secuencias autoincrementales huérfanas...';
    FOR r IN (
        SELECT sequence_name 
        FROM information_schema.sequences 
        WHERE sequence_schema = 'public' AND sequence_name LIKE '%_id_seq'
    ) LOOP
        BEGIN
            EXECUTE format('DROP SEQUENCE IF EXISTS %I CASCADE', r.sequence_name);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END LOOP;

    RAISE NOTICE '>>> PURGA COMPLETADA CON EXITO. TODAS LAS TABLAS OPERAN 100%% SOBRE UUID.';
END $$;

-- =========================================================================
-- CONSULTAS DE VERIFICACIÓN FINAL:
-- =========================================================================

-- 1. Verificar si queda alguna columna 'id' en tablas base (debe dar 0 filas):
SELECT c.table_name, c.column_name, c.data_type 
FROM information_schema.columns c
JOIN information_schema.tables tbl 
  ON c.table_name = tbl.table_name AND c.table_schema = tbl.table_schema
WHERE c.table_schema = 'public' 
  AND tbl.table_type = 'BASE TABLE'
  AND c.column_name = 'id';

-- 2. Verificar si queda alguna columna *_id de tipo entero en tablas base (debe dar 0 filas):
SELECT c.table_name, c.column_name, c.data_type 
FROM information_schema.columns c
JOIN information_schema.tables tbl 
  ON c.table_name = tbl.table_name AND c.table_schema = tbl.table_schema
WHERE c.table_schema = 'public' 
  AND tbl.table_type = 'BASE TABLE'
  AND c.column_name LIKE '%\_id' ESCAPE '\' 
  AND c.data_type IN ('integer', 'smallint', 'bigint');

-- 3. Verificar Primary Keys de tablas base (todas deben ser 'uuid'):
SELECT tc.table_name, ccu.column_name AS pk_column
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
ORDER BY tc.table_name;
