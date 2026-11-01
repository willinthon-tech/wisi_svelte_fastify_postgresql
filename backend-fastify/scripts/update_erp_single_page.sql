-- ============================================================================
-- SCRIPT SQL: UNIFICAR SECCIÓN A UNA SOLA PÁGINA "ERP" CON 3 MÓDULOS
-- Administrativo, Contable, Nomina (100% UUID - Permisos para willinthon)
-- ============================================================================

DO $$
DECLARE
  v_page_uuid UUID;
  v_user_uuid UUID;
  v_mod_admin UUID := gen_random_uuid();
  v_mod_cont UUID := gen_random_uuid();
  v_mod_nom UUID := gen_random_uuid();
  r_perm RECORD;
BEGIN
  -- 1. Eliminar páginas anteriores separadas y sus permisos previos
  DELETE FROM user_module_permissions 
  WHERE module_uuid IN (
    SELECT m.uuid FROM modulos m 
    JOIN paginas p ON m.page_uuid = p.uuid 
    WHERE UPPER(TRIM(p.nombre)) IN ('ADMINISTRATIVO', 'CONTABILIDAD', 'NÓMINA')
  );

  DELETE FROM modulos 
  WHERE page_uuid IN (
    SELECT uuid FROM paginas 
    WHERE UPPER(TRIM(nombre)) IN ('ADMINISTRATIVO', 'CONTABILIDAD', 'NÓMINA')
  );

  DELETE FROM paginas 
  WHERE UPPER(TRIM(nombre)) IN ('ADMINISTRATIVO', 'CONTABILIDAD', 'NÓMINA');

  -- 2. Obtener o crear la única página "ERP"
  SELECT uuid INTO v_page_uuid FROM paginas WHERE UPPER(TRIM(nombre)) = 'ERP' LIMIT 1;
  IF v_page_uuid IS NULL THEN
    v_page_uuid := gen_random_uuid();
    INSERT INTO paginas (uuid, nombre, created_at, updated_at)
    VALUES (v_page_uuid, 'ERP', NOW(), NOW());
    RAISE NOTICE 'Página ERP creada con UUID: %', v_page_uuid;
  ELSE
    RAISE NOTICE 'Página ERP existente encontrada con UUID: %', v_page_uuid;
  END IF;

  -- 3. Limpiar módulos previos bajo ERP si ya existieran
  DELETE FROM user_module_permissions WHERE module_uuid IN (SELECT uuid FROM modulos WHERE page_uuid = v_page_uuid);
  DELETE FROM modulos WHERE page_uuid = v_page_uuid;

  -- 4. Insertar ÚNICAMENTE los 3 módulos solicitados con ruta erp/... (Sin iconos)
  INSERT INTO modulos (uuid, page_uuid, nombre, ruta, icono, orden, is_deleted, created_at, updated_at)
  VALUES 
    (v_mod_admin, v_page_uuid, 'Administrativo', '/erp/administrativo', NULL, 1, false, NOW(), NOW()),
    (v_mod_cont, v_page_uuid, 'Contable', '/erp/contable', NULL, 2, false, NOW(), NOW()),
    (v_mod_nom, v_page_uuid, 'Nomina', '/erp/nomina', NULL, 3, false, NOW(), NOW());

  RAISE NOTICE '3 Módulos creados: Administrativo, Contable, Nomina.';

  -- 5. Obtener UUID del usuario willinthon
  SELECT uuid INTO v_user_uuid FROM usuarios WHERE LOWER(TRIM(usuario)) = 'willinthon' AND is_deleted = false LIMIT 1;

  IF v_user_uuid IS NOT NULL THEN
    -- Asignar todos los permisos (VER, AGREGAR, EDITAR, ELIMINAR) EXCLUSIVAMENTE a willinthon
    FOR r_perm IN SELECT uuid FROM permissions WHERE is_deleted = false LOOP
      INSERT INTO user_module_permissions (user_uuid, module_uuid, permission_uuid, is_deleted, created_at, updated_at)
      VALUES 
        (v_user_uuid, v_mod_admin, r_perm.uuid, false, NOW(), NOW()),
        (v_user_uuid, v_mod_cont, r_perm.uuid, false, NOW(), NOW()),
        (v_user_uuid, v_mod_nom, r_perm.uuid, false, NOW(), NOW())
      ON CONFLICT DO NOTHING;
    END LOOP;
    RAISE NOTICE 'Permisos asignados única y exclusivamente a willinthon (UUID: %)', v_user_uuid;
  ELSE
    RAISE WARNING 'No se encontró el usuario willinthon para asignación de permisos.';
  END IF;

  RAISE NOTICE '¡Unificación de sección ERP completada con éxito!';
END $$;
