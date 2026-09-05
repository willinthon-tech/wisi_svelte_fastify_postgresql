-- ==============================================================================
-- SCRIPT DE UNIFICACIÓN Y ELIMINACIÓN DE DUPLICADOS EN WISI
-- 1. Unifica y elimina empleados duplicados por cédula (manteniendo el activo y migrando relaciones).
-- 2. Elimina marcajes (attlogs) duplicados por empleado y fecha/hora exacta.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- PASO 1: UNIFICAR Y ELIMINAR EMPLEADOS DUPLICADOS
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    rec RECORD;
    v_master_id INT;
    v_dup_id INT;
    i INT;
    v_total_empleados_eliminados INT := 0;
BEGIN
    RAISE NOTICE '--- Iniciando deduplicación de empleados ---';

    FOR rec IN
        SELECT 
            REPLACE(REPLACE(UPPER(COALESCE(cedula, '')), 'V', ''), '-', '') AS norm_cedula,
            ARRAY_AGG(id ORDER BY activo DESC, (foto IS NOT NULL AND foto <> '') DESC, id DESC) AS id_list
        FROM empleados
        WHERE NULLIF(TRIM(cedula), '') IS NOT NULL
        GROUP BY REPLACE(REPLACE(UPPER(COALESCE(cedula, '')), 'V', ''), '-', '')
        HAVING COUNT(*) > 1
    LOOP
        -- El primer elemento es el registro principal (activo, con foto, id más reciente)
        v_master_id := rec.id_list[1];

        RAISE NOTICE 'Cédula %: Maestro ID = %', rec.norm_cedula, v_master_id;

        FOR i IN 2..ARRAY_LENGTH(rec.id_list, 1) LOOP
            v_dup_id := rec.id_list[i];

            -- 1. Rescatar foto si el maestro no tiene foto y el duplicado sí
            UPDATE empleados e_master
            SET foto = e_dup.foto
            FROM empleados e_dup
            WHERE e_master.id = v_master_id 
              AND e_dup.id = v_dup_id
              AND (e_master.foto IS NULL OR e_master.foto = '')
              AND (e_dup.foto IS NOT NULL AND e_dup.foto <> '');

            -- 2. Migrar dispositivos asociados al maestro (evitando duplicar pares empleado-dispositivo)
            UPDATE empleado_dispositivos
            SET empleado_id = v_master_id
            WHERE empleado_id = v_dup_id
              AND dispositivo_id NOT IN (
                  SELECT dispositivo_id FROM empleado_dispositivos WHERE empleado_id = v_master_id
              );
            DELETE FROM empleado_dispositivos WHERE empleado_id = v_dup_id;

            -- 3. Migrar plantillas horarias asociadas
            UPDATE empleados_plantillas_horarios
            SET empleado_id = v_master_id
            WHERE empleado_id = v_dup_id
              AND plantilla_horario_id NOT IN (
                  SELECT plantilla_horario_id FROM empleados_plantillas_horarios WHERE empleado_id = v_master_id
              );
            DELETE FROM empleados_plantillas_horarios WHERE empleado_id = v_dup_id;

            -- 4. Migrar excepciones de horarios
            UPDATE excepciones_horarios
            SET empleado_id = v_master_id
            WHERE empleado_id = v_dup_id;

            -- 5. Eliminar el registro duplicado de empleados
            DELETE FROM empleados WHERE id = v_dup_id;
            v_total_empleados_eliminados := v_total_empleados_eliminados + 1;
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Total de registros duplicados de empleados eliminados: %', v_total_empleados_eliminados;
END $$;

-- ------------------------------------------------------------------------------
-- PASO 2: ELIMINAR MARCAJES (ATTLOGS) DUPLICADOS
-- Mantiene el registro con foto (has_photo=TRUE), con estatus (checkin/checkout),
-- y el ID más reciente, eliminando los redundantes.
-- ------------------------------------------------------------------------------
WITH duplicates_to_delete AS (
    SELECT id
    FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY 
                       REPLACE(REPLACE(UPPER(COALESCE(employee_no, '')), 'V', ''), '-', ''), 
                       event_time 
                   ORDER BY 
                       has_photo DESC, 
                       (attendancestatus IS NOT NULL AND attendancestatus <> '') DESC, 
                       id DESC
               ) AS rn
        FROM attlogs
        WHERE NULLIF(TRIM(employee_no), '') IS NOT NULL
    ) t
    WHERE t.rn > 1
)
DELETE FROM attlogs
WHERE id IN (SELECT id FROM duplicates_to_delete);

-- Confirmar transacción
COMMIT;
