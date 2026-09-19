-- =========================================================================
-- SCRIPT SQL: MOVER MÓDULO RANGOS A CONF.M: MAQUINAS
-- Base de datos: PostgreSQL (wisi)
-- =========================================================================

DO $$
DECLARE
    v_target_page_uuid UUID;
    v_next_order INT;
    v_modulo_uuid UUID;
BEGIN
    -- 1. Buscar el UUID de la página destino 'CONF.M: MAQUINAS'
    SELECT uuid INTO v_target_page_uuid 
    FROM paginas 
    WHERE UPPER(TRIM(nombre)) = 'CONF.M: MAQUINAS' 
    LIMIT 1;

    IF v_target_page_uuid IS NULL THEN
        RAISE EXCEPTION 'No se encontró la página "CONF.M: MAQUINAS" en la tabla paginas';
    END IF;

    -- 2. Calcular el siguiente orden disponible
    SELECT COALESCE(MAX(orden), 0) + 1 INTO v_next_order 
    FROM modulos 
    WHERE page_uuid = v_target_page_uuid;

    -- 3. Actualizar el módulo Rangos
    UPDATE modulos
    SET page_uuid = v_target_page_uuid,
        orden = v_next_order,
        updated_at = NOW()
    WHERE LOWER(TRIM(nombre)) = 'rangos' OR ruta = '/configuracion/rangos'
    RETURNING uuid INTO v_modulo_uuid;

    IF v_modulo_uuid IS NOT NULL THEN
        RAISE NOTICE 'ÉXITO: Módulo Rangos (%) asignado a CONF.M: MAQUINAS (%) con orden %', 
                     v_modulo_uuid, v_target_page_uuid, v_next_order;
    ELSE
        RAISE WARNING 'No se encontró ningún módulo con nombre "Rangos" o ruta "/configuracion/rangos"';
    END IF;
END $$;

-- Verificación final
SELECT 
    m.orden,
    m.nombre AS modulo,
    m.ruta,
    p.nombre AS pagina,
    m.uuid AS modulo_uuid,
    m.page_uuid
FROM modulos m
JOIN paginas p ON m.page_uuid = p.uuid
WHERE p.nombre = 'CONF.M: MAQUINAS'
ORDER BY m.orden ASC;
