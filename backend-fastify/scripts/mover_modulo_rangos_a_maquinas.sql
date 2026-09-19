-- ============================================================================
-- SCRIPT SQL: REASIGNACIÓN DEL MÓDULO RANGOS A "CONF.M: MAQUINAS"
-- ============================================================================

BEGIN;

UPDATE modulos 
SET page_uuid = (
    SELECT uuid 
    FROM paginas 
    WHERE UPPER(TRIM(nombre)) = 'CONF.M: MAQUINAS' 
    LIMIT 1
),
orden = 11,
updated_at = NOW()
WHERE LOWER(TRIM(nombre)) = 'rangos' OR ruta = '/configuracion/rangos';

-- Verificación:
SELECT m.uuid, m.nombre, m.ruta, m.orden, p.nombre AS pagina
FROM modulos m
JOIN paginas p ON m.page_uuid = p.uuid
WHERE UPPER(TRIM(p.nombre)) = 'CONF.M: MAQUINAS'
ORDER BY m.orden ASC, m.nombre ASC;

COMMIT;
