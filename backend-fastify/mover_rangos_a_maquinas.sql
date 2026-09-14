-- MIGRACIÓN: MOVER MÓDULO RANGOS A CONF.M: MAQUINAS
-- 1. Asegurar que la página id=3 tenga el nombre estándar CONF.M: MAQUINAS
UPDATE paginas 
SET nombre = 'CONF.M: MAQUINAS' 
WHERE id = 3 OR UPPER(nombre) = 'MAQUINAS';

-- 2. Mover el módulo Rangos a la página CONF.M: MAQUINAS (page_id = 3) con orden consecutivo al final
UPDATE modulos 
SET page_id = (
    SELECT id FROM paginas 
    WHERE id = 3 OR UPPER(nombre) LIKE '%CONF%MAQUINA%' OR UPPER(nombre) = 'MAQUINAS' 
    ORDER BY id ASC LIMIT 1
),
orden = (
    SELECT COALESCE(MAX(orden), 10) + 1 
    FROM modulos 
    WHERE page_id = (
        SELECT id FROM paginas 
        WHERE id = 3 OR UPPER(nombre) LIKE '%CONF%MAQUINA%' OR UPPER(nombre) = 'MAQUINAS' 
        ORDER BY id ASC LIMIT 1
    )
    AND id != 41
)
WHERE id = 41 OR ruta = '/configuracion/rangos' OR UPPER(nombre) = 'RANGOS';
