-- Script para mover el módulo Rangos a CONF.M: RRHH en producción
DO $$
DECLARE
    v_page_uuid UUID;
    v_next_order INT;
BEGIN
    SELECT uuid INTO v_page_uuid FROM paginas WHERE nombre = 'CONF.M: RRHH' LIMIT 1;
    
    IF v_page_uuid IS NOT NULL THEN
        SELECT COALESCE(MAX(orden), 0) + 1 INTO v_next_order FROM modulos WHERE page_uuid = v_page_uuid;
        
        UPDATE modulos
        SET page_uuid = v_page_uuid,
            orden = v_next_order,
            updated_at = NOW()
        WHERE nombre ILIKE 'rangos';
        
        RAISE NOTICE 'Modulo Rangos asignado exitosamente a CONF.M: RRHH (page_uuid: %, orden: %)', v_page_uuid, v_next_order;
    ELSE
        RAISE EXCEPTION 'No se encontro la pagina CONF.M: RRHH';
    END IF;
END $$;
