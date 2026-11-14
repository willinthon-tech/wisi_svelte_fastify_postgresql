-- ========================================================
-- REPARACIÓN DEFINITIVA DE FOREIGN KEY fk_maquinas_juego_uuid
-- Asegura que la foreign key en maquinas apunte a juegos_maquinas(uuid)
-- y NUNCA a juegos(uuid) ni quede rota.
-- ========================================================

DO $$
DECLARE
  v_ref_table text;
BEGIN
  -- 1. Consultar a qué tabla apunta actualmente fk_maquinas_juego_uuid
  SELECT ccu.table_name INTO v_ref_table
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
  WHERE tc.constraint_name = 'fk_maquinas_juego_uuid' AND tc.table_name = 'maquinas'
  LIMIT 1;

  RAISE NOTICE 'Tabla actualmente referenciada por fk_maquinas_juego_uuid: %', COALESCE(v_ref_table, 'NINGUNA');

  -- 2. Eliminar la foreign key incorrecta o desalineada
  ALTER TABLE maquinas DROP CONSTRAINT IF EXISTS fk_maquinas_juego_uuid CASCADE;

  -- 3. Sanitizar huérfanos en maquinas (si hay juegos asignados que no están en juegos_maquinas)
  UPDATE maquinas 
  SET juego_uuid = NULL 
  WHERE juego_uuid IS NOT NULL 
    AND juego_uuid NOT IN (SELECT uuid FROM juegos_maquinas);

  -- 4. Recrear la foreign key apuntando a juegos_maquinas(uuid)
  ALTER TABLE maquinas ADD CONSTRAINT fk_maquinas_juego_uuid 
    FOREIGN KEY (juego_uuid) REFERENCES juegos_maquinas(uuid) ON DELETE SET NULL;

  RAISE NOTICE 'fk_maquinas_juego_uuid corregida exitosamente apuntando a juegos_maquinas(uuid).';
END $$;

