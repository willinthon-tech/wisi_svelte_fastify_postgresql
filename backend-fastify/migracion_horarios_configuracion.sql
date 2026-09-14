-- ==============================================================================
-- MIGRACIÓN DE HORARIOS: MUDANZA A CONFIGURACIÓN Y ELIMINACIÓN DE SALA_ID
-- ==============================================================================
-- 1. Elimina registros residuales de excepciones legacy en tabla horarios.
-- 2. Consolida códigos duplicados reasignando relaciones existentes.
-- 3. Elimina la columna sala_id de horarios y limpia vistas obsoletas.
-- 4. Crea índice UNIQUE para el código de horarios.
-- 5. Mueve el módulo Horarios a la sección de Configuración (CONF.M: RRHH).
-- ==============================================================================

-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PASO 1: DEPURAR REGISTROS LEGACY SIN HORAS (EXCEPCIONES ANTIGUAS)
-- ------------------------------------------------------------------------------
-- Aquellos registros que no tienen hora_entrada ni hora_salida y corresponden
-- a excepciones ya existentes en la tabla "excepciones"
DO $$
DECLARE
    v_deleted_count INT := 0;
BEGIN
    -- Reasignar en empleados_horarios o empleados_excepciones_horarios si apuntaban a ellos
    DELETE FROM empleados_horarios 
    WHERE horario_id IN (
        SELECT id FROM horarios 
        WHERE hora_entrada IS NULL AND hora_salida IS NULL
    );

    DELETE FROM empleados_excepciones_horarios 
    WHERE horario_id IN (
        SELECT id FROM horarios 
        WHERE hora_entrada IS NULL AND hora_salida IS NULL
    );

    DELETE FROM horarios 
    WHERE hora_entrada IS NULL AND hora_salida IS NULL;

    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    RAISE NOTICE 'Registros legacy sin horas eliminados de horarios: %', v_deleted_count;
END $$;

-- ------------------------------------------------------------------------------
-- PASO 2: CONSOLIDAR CÓDIGOS DUPLICADOS EN HORARIOS
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    rec RECORD;
    v_master_id INT;
    v_dup_id INT;
    i INT;
    v_total_dups INT := 0;
BEGIN
    FOR rec IN
        SELECT 
            UPPER(TRIM(codigo)) AS norm_codigo,
            ARRAY_AGG(id ORDER BY (hora_entrada IS NOT NULL AND hora_salida IS NOT NULL) DESC, id ASC) AS id_list
        FROM horarios
        WHERE NULLIF(TRIM(codigo), '') IS NOT NULL
        GROUP BY UPPER(TRIM(codigo))
        HAVING COUNT(*) > 1
    LOOP
        v_master_id := rec.id_list[1];

        FOR i IN 2..ARRAY_LENGTH(rec.id_list, 1) LOOP
            v_dup_id := rec.id_list[i];

            -- Reasignar empleados_horarios al maestro
            UPDATE empleados_horarios
            SET horario_id = v_master_id
            WHERE horario_id = v_dup_id;

            -- Reasignar empleados_excepciones_horarios al maestro
            UPDATE empleados_excepciones_horarios
            SET horario_id = v_master_id
            WHERE horario_id = v_dup_id;

            -- Eliminar duplicado de horarios
            DELETE FROM horarios WHERE id = v_dup_id;
            v_total_dups := v_total_dups + 1;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Total de horarios duplicados consolidados: %', v_total_dups;
END $$;

-- ------------------------------------------------------------------------------
-- PASO 3: ELIMINAR LA COLUMNA SALA_ID Y LIMPIAR VISTAS OBSOLETAS
-- ------------------------------------------------------------------------------
-- 3.1. Eliminar vistas obsoletas si existen
DROP VIEW IF EXISTS plantillas_horarios CASCADE;
DROP VIEW IF EXISTS empleados_plantillas_horarios CASCADE;

-- 3.2. Eliminar columna sala_id de la tabla horarios
ALTER TABLE horarios DROP COLUMN IF EXISTS sala_id CASCADE;

-- 3.3. Garantizar restricción UNIQUE en código de horarios
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'horarios_codigo_key' AND conrelid = 'horarios'::regclass
    ) THEN
        ALTER TABLE horarios ADD CONSTRAINT horarios_codigo_key UNIQUE (codigo);
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- PASO 4: ACTUALIZAR NAVEGACIÓN (PÁGINAS Y MÓDULOS)
-- ------------------------------------------------------------------------------
-- 4.1. Asegurar página CONF.M: RRHH (page_id = 10)
INSERT INTO paginas (id, nombre)
VALUES (10, 'CONF.M: RRHH')
ON CONFLICT (id) DO UPDATE SET nombre = 'CONF.M: RRHH';

-- 4.2. Actualizar módulo Horarios (id 29 o por ruta)
DO $$
DECLARE
    v_mod_id INT;
BEGIN
    SELECT id INTO v_mod_id FROM modulos WHERE id = 29 OR ruta IN ('/rrhh/horarios', '/rrhh/plantillas') LIMIT 1;
    
    IF v_mod_id IS NOT NULL THEN
        UPDATE modulos 
        SET nombre = 'Horarios',
            ruta = '/configuracion/horarios',
            icono = 'schedule',
            page_id = 10,
            orden = 1
        WHERE id = v_mod_id;
        RAISE NOTICE 'Módulo Horarios actualizado a /configuracion/horarios (ID: %)', v_mod_id;
    ELSE
        INSERT INTO modulos (nombre, ruta, icono, page_id, orden)
        VALUES ('Horarios', '/configuracion/horarios', 'schedule', 10, 1)
        RETURNING id INTO v_mod_id;
        RAISE NOTICE 'Módulo Horarios creado con ID %', v_mod_id;
    END IF;

    -- Asignar permisos al módulo para usuarios existentes
    INSERT INTO user_module_permissions (user_id, module_id, permission_id)
    SELECT DISTINCT u.user_id, v_mod_id, p.id
    FROM user_module_permissions u
    CROSS JOIN permissions p
    ON CONFLICT DO NOTHING;
END $$;

-- 4.3. Asegurar también Excepciones y Fechas Patrias en la misma sección CONF.M: RRHH
DO $$
DECLARE
    v_exc_id INT;
    v_fp_id INT;
BEGIN
    -- Módulo Excepciones
    SELECT id INTO v_exc_id FROM modulos WHERE ruta = '/configuracion/excepciones' LIMIT 1;
    IF v_exc_id IS NULL THEN
        INSERT INTO modulos (nombre, ruta, icono, page_id, orden)
        VALUES ('Excepciones', '/configuracion/excepciones', 'event_busy', 10, 2)
        RETURNING id INTO v_exc_id;
    ELSE
        UPDATE modulos SET page_id = 10, orden = 2 WHERE id = v_exc_id;
    END IF;

    INSERT INTO user_module_permissions (user_id, module_id, permission_id)
    SELECT DISTINCT u.user_id, v_exc_id, p.id
    FROM user_module_permissions u
    CROSS JOIN permissions p
    ON CONFLICT DO NOTHING;

    -- Módulo Fechas Patrias
    SELECT id INTO v_fp_id FROM modulos WHERE ruta = '/configuracion/fechas-patrias' LIMIT 1;
    IF v_fp_id IS NULL THEN
        INSERT INTO modulos (nombre, ruta, icono, page_id, orden)
        VALUES ('Fechas Patrias', '/configuracion/fechas-patrias', 'flag', 10, 3)
        RETURNING id INTO v_fp_id;
    ELSE
        UPDATE modulos SET page_id = 10, orden = 3 WHERE id = v_fp_id;
    END IF;

    INSERT INTO user_module_permissions (user_id, module_id, permission_id)
    SELECT DISTINCT u.user_id, v_fp_id, p.id
    FROM user_module_permissions u
    CROSS JOIN permissions p
    ON CONFLICT DO NOTHING;
END $$;

