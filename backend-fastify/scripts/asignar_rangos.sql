-- ====================================================================
-- ASIGNACIÓN DE RANGOS INICIALES A MÁQUINAS EN POSTGRESQL
-- Salas del grupo "SALA" -> Rango "General"
-- Salas del grupo "GALPÓN" -> Rango "Sin Rango"
-- ====================================================================

-- 1. Actualizar máquinas de SALA al rango 'General'
UPDATE maquinas m
SET rango_uuid = r.uuid,
    updated_at = NOW()
FROM salas s
JOIN grupo_salas gs ON s.grupo_uuid = gs.uuid
CROSS JOIN (
    SELECT uuid FROM rangos WHERE LOWER(TRIM(nombre)) = 'general' LIMIT 1
) r
WHERE m.sala_uuid = s.uuid
  AND UPPER(TRIM(gs.nombre)) = 'SALA';

-- 2. Actualizar máquinas de GALPÓN al rango 'Sin Rango'
UPDATE maquinas m
SET rango_uuid = r.uuid,
    updated_at = NOW()
FROM salas s
JOIN grupo_salas gs ON s.grupo_uuid = gs.uuid
CROSS JOIN (
    SELECT uuid FROM rangos WHERE LOWER(TRIM(nombre)) = 'sin rango' LIMIT 1
) r
WHERE m.sala_uuid = s.uuid
  AND (
    UPPER(TRIM(gs.nombre)) IN ('GALPÓN', 'GALPON')
    OR UPPER(TRIM(gs.nombre)) LIKE 'GALP%'
  );

-- 3. Consulta de Verificación: Total de máquinas por rango asignado
SELECT 
    COALESCE(r.nombre, 'Sin Asignar (NULL)') AS rango, 
    COUNT(m.uuid) AS total_maquinas
FROM maquinas m
LEFT JOIN rangos r ON m.rango_uuid = r.uuid
GROUP BY r.nombre
ORDER BY total_maquinas DESC;
