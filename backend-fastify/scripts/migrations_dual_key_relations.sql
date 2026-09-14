-- ==============================================================================
-- SCRIPT DE MIGRACIÓN: ENLACE DUAL-KEY DE RELACIONES (ID <-> UUID)
-- ==============================================================================
-- Este script:
-- 1. Agrega columnas *_uuid a las tablas hijas para cada relación foránea.
-- 2. Puebla retroactivamente todas las relaciones existentes enlazando el ID con su UUID.
-- 3. Crea triggers automáticos bidireccionales:
--    - Si una inserción/actualización viene con *_id, resuelve y asigna el *_uuid.
--    - Si una inserción viene con *_uuid (modo offline), resuelve y asigna el *_id.
-- 4. Preserva 100% la compatibilidad con hardware, biométricos y consultas existentes.
-- ==============================================================================

DO $$
BEGIN

    -- -------------------------------------------------------------------------
    -- 1. LIBROS (relación con salas)
    -- -------------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'libros') THEN
        ALTER TABLE libros ADD COLUMN IF NOT EXISTS sala_uuid UUID;
        UPDATE libros l SET sala_uuid = s.uuid FROM salas s WHERE l.sala_id = s.id AND l.sala_uuid IS NULL;
        CREATE INDEX IF NOT EXISTS libros_sala_uuid_idx ON libros(sala_uuid);
    END IF;

    -- -------------------------------------------------------------------------
    -- 2. CLIENTES (relaciones con salas y tipo_clientes)
    -- -------------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clientes') THEN
        ALTER TABLE clientes ADD COLUMN IF NOT EXISTS sala_uuid UUID;
        ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tipo_cliente_uuid UUID;
        
        UPDATE clientes c SET sala_uuid = s.uuid FROM salas s WHERE c.sala_id = s.id AND c.sala_uuid IS NULL;
        UPDATE clientes c SET tipo_cliente_uuid = tc.uuid FROM tipo_clientes tc WHERE c.tipo_cliente_id = tc.id AND c.tipo_cliente_uuid IS NULL;
        
        CREATE INDEX IF NOT EXISTS clientes_sala_uuid_idx ON clientes(sala_uuid);
        CREATE INDEX IF NOT EXISTS clientes_tipo_cliente_uuid_idx ON clientes(tipo_cliente_uuid);
    END IF;

    -- -------------------------------------------------------------------------
    -- 3. ESTRUCTURA DE RRHH (departamentos -> salas, areas -> deptos, cargos -> areas, empleados -> cargos)
    -- -------------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'departamentos') THEN
        ALTER TABLE departamentos ADD COLUMN IF NOT EXISTS sala_uuid UUID;
        UPDATE departamentos d SET sala_uuid = s.uuid FROM salas s WHERE d.sala_id = s.id AND d.sala_uuid IS NULL;
        CREATE INDEX IF NOT EXISTS departamentos_sala_uuid_idx ON departamentos(sala_uuid);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'areas') THEN
        ALTER TABLE areas ADD COLUMN IF NOT EXISTS departamento_uuid UUID;
        UPDATE areas a SET departamento_uuid = d.uuid FROM departamentos d WHERE a.departamento_id = d.id AND a.departamento_uuid IS NULL;
        CREATE INDEX IF NOT EXISTS areas_departamento_uuid_idx ON areas(departamento_uuid);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cargos') THEN
        ALTER TABLE cargos ADD COLUMN IF NOT EXISTS area_uuid UUID;
        UPDATE cargos c SET area_uuid = a.uuid FROM areas a WHERE c.area_id = a.id AND c.area_uuid IS NULL;
        CREATE INDEX IF NOT EXISTS cargos_area_uuid_idx ON cargos(area_uuid);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'empleados') THEN
        ALTER TABLE empleados ADD COLUMN IF NOT EXISTS cargo_uuid UUID;
        UPDATE empleados e SET cargo_uuid = c.uuid FROM cargos c WHERE e.cargo_id = c.id AND e.cargo_uuid IS NULL;
        CREATE INDEX IF NOT EXISTS empleados_cargo_uuid_idx ON empleados(cargo_uuid);
    END IF;

    -- -------------------------------------------------------------------------
    -- 4. LIBRO CONTROL CLIENTES (relaciones con libros, clientes, metodos_pago)
    -- -------------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'libro_control_clientes') THEN
        ALTER TABLE libro_control_clientes ADD COLUMN IF NOT EXISTS libro_uuid UUID;
        ALTER TABLE libro_control_clientes ADD COLUMN IF NOT EXISTS cliente_uuid UUID;
        ALTER TABLE libro_control_clientes ADD COLUMN IF NOT EXISTS metodo_pago_uuid UUID;

        UPDATE libro_control_clientes l SET libro_uuid = b.uuid FROM libros b WHERE l.libro_id = b.id AND l.libro_uuid IS NULL;
        UPDATE libro_control_clientes l SET cliente_uuid = c.uuid FROM clientes c WHERE l.cliente_id = c.id AND l.cliente_uuid IS NULL;
        UPDATE libro_control_clientes l SET metodo_pago_uuid = m.uuid FROM metodos_pago m WHERE l.metodo_pago_id = m.id AND l.metodo_pago_uuid IS NULL;

        CREATE INDEX IF NOT EXISTS lcc_libro_uuid_idx ON libro_control_clientes(libro_uuid);
        CREATE INDEX IF NOT EXISTS lcc_cliente_uuid_idx ON libro_control_clientes(cliente_uuid);
        CREATE INDEX IF NOT EXISTS lcc_metodo_pago_uuid_idx ON libro_control_clientes(metodo_pago_uuid);
    END IF;

    -- -------------------------------------------------------------------------
    -- 5. LIBRO APORTES (relaciones con libros, empleados, rangos)
    -- -------------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'libro_aportes') THEN
        ALTER TABLE libro_aportes ADD COLUMN IF NOT EXISTS libro_uuid UUID;
        ALTER TABLE libro_aportes ADD COLUMN IF NOT EXISTS empleado_uuid UUID;
        ALTER TABLE libro_aportes ADD COLUMN IF NOT EXISTS rango_uuid UUID;

        UPDATE libro_aportes l SET libro_uuid = b.uuid FROM libros b WHERE l.libro_id = b.id AND l.libro_uuid IS NULL;
        UPDATE libro_aportes l SET empleado_uuid = e.uuid FROM empleados e WHERE l.empleado_id = e.id AND l.empleado_uuid IS NULL;
        UPDATE libro_aportes l SET rango_uuid = r.uuid FROM rangos r WHERE l.rango_id = r.id AND l.rango_uuid IS NULL;

        CREATE INDEX IF NOT EXISTS la_libro_uuid_idx ON libro_aportes(libro_uuid);
        CREATE INDEX IF NOT EXISTS la_empleado_uuid_idx ON libro_aportes(empleado_uuid);
        CREATE INDEX IF NOT EXISTS la_rango_uuid_idx ON libro_aportes(rango_uuid);
    END IF;

    -- -------------------------------------------------------------------------
    -- 6. LIBRO CONTROL LLAVES (relaciones con libros)
    -- -------------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'libro_control_llaves') THEN
        ALTER TABLE libro_control_llaves ADD COLUMN IF NOT EXISTS libro_uuid UUID;
        UPDATE libro_control_llaves l SET libro_uuid = b.uuid FROM libros b WHERE l.libro_id = b.id AND l.libro_uuid IS NULL;
        CREATE INDEX IF NOT EXISTS lcl_libro_uuid_idx ON libro_control_llaves(libro_uuid);
    END IF;

    -- -------------------------------------------------------------------------
    -- 7. LIBRO INCIDENCIAS GENERALES (relaciones con libros, tipo_incidencias)
    -- -------------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'libro_incidencias_generales') THEN
        ALTER TABLE libro_incidencias_generales ADD COLUMN IF NOT EXISTS libro_uuid UUID;
        ALTER TABLE libro_incidencias_generales ADD COLUMN IF NOT EXISTS tipo_incidencia_uuid UUID;

        UPDATE libro_incidencias_generales l SET libro_uuid = b.uuid FROM libros b WHERE l.libro_id = b.id AND l.libro_uuid IS NULL;
        UPDATE libro_incidencias_generales l SET tipo_incidencia_uuid = ti.uuid FROM tipo_incidencias ti WHERE l.tipo_incidencia_id = ti.id AND l.tipo_incidencia_uuid IS NULL;

        CREATE INDEX IF NOT EXISTS lig_libro_uuid_idx ON libro_incidencias_generales(libro_uuid);
        CREATE INDEX IF NOT EXISTS lig_tipo_incidencia_uuid_idx ON libro_incidencias_generales(tipo_incidencia_uuid);
    END IF;

    -- -------------------------------------------------------------------------
    -- 8. LIBRO NOVEDADES MESAS (relaciones con libros, mesas)
    -- -------------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'libro_novedades_mesas') THEN
        ALTER TABLE libro_novedades_mesas ADD COLUMN IF NOT EXISTS libro_uuid UUID;
        ALTER TABLE libro_novedades_mesas ADD COLUMN IF NOT EXISTS mesa_uuid UUID;

        UPDATE libro_novedades_mesas l SET libro_uuid = b.uuid FROM libros b WHERE l.libro_id = b.id AND l.libro_uuid IS NULL;
        UPDATE libro_novedades_mesas l SET mesa_uuid = m.uuid FROM mesas m WHERE l.mesa_id = m.id AND l.mesa_uuid IS NULL;

        CREATE INDEX IF NOT EXISTS lnm_libro_uuid_idx ON libro_novedades_mesas(libro_uuid);
        CREATE INDEX IF NOT EXISTS lnm_mesa_uuid_idx ON libro_novedades_mesas(mesa_uuid);
    END IF;

    -- -------------------------------------------------------------------------
    -- 9. LIBRO DROP MESAS (relaciones con libros, mesas)
    -- -------------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'libro_drop_mesas') THEN
        ALTER TABLE libro_drop_mesas ADD COLUMN IF NOT EXISTS libro_uuid UUID;
        ALTER TABLE libro_drop_mesas ADD COLUMN IF NOT EXISTS mesa_uuid UUID;

        UPDATE libro_drop_mesas l SET libro_uuid = b.uuid FROM libros b WHERE l.libro_id = b.id AND l.libro_uuid IS NULL;
        UPDATE libro_drop_mesas l SET mesa_uuid = m.uuid FROM mesas m WHERE l.mesa_id = m.id AND l.mesa_uuid IS NULL;

        CREATE INDEX IF NOT EXISTS ldm_libro_uuid_idx ON libro_drop_mesas(libro_uuid);
        CREATE INDEX IF NOT EXISTS ldm_mesa_uuid_idx ON libro_drop_mesas(mesa_uuid);
    END IF;

    -- -------------------------------------------------------------------------
    -- 10. LIBRO DATOS (relación con libros)
    -- -------------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'libro_datos') THEN
        ALTER TABLE libro_datos ADD COLUMN IF NOT EXISTS libro_uuid UUID;
        UPDATE libro_datos l SET libro_uuid = b.uuid FROM libros b WHERE l.libro_id = b.id AND l.libro_uuid IS NULL;
        CREATE INDEX IF NOT EXISTS ld_libro_uuid_idx ON libro_datos(libro_uuid);
    END IF;

    -- -------------------------------------------------------------------------
    -- 11. MESAS (relaciones con salas, juegos)
    -- -------------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mesas') THEN
        ALTER TABLE mesas ADD COLUMN IF NOT EXISTS sala_uuid UUID;
        ALTER TABLE mesas ADD COLUMN IF NOT EXISTS juego_uuid UUID;

        UPDATE mesas m SET sala_uuid = s.uuid FROM salas s WHERE m.sala_id = s.id AND m.sala_uuid IS NULL;
        UPDATE mesas m SET juego_uuid = j.uuid FROM juegos j WHERE m.juego_id = j.id AND m.juego_uuid IS NULL;

        CREATE INDEX IF NOT EXISTS mesas_sala_uuid_idx ON mesas(sala_uuid);
        CREATE INDEX IF NOT EXISTS mesas_juego_uuid_idx ON mesas(juego_uuid);
    END IF;

    -- -------------------------------------------------------------------------
    -- 12. LLAVES (relación con salas)
    -- -------------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'llaves') THEN
        ALTER TABLE llaves ADD COLUMN IF NOT EXISTS sala_uuid UUID;
        UPDATE llaves l SET sala_uuid = s.uuid FROM salas s WHERE l.sala_id = s.id AND l.sala_uuid IS NULL;
        CREATE INDEX IF NOT EXISTS llaves_sala_uuid_idx ON llaves(sala_uuid);
    END IF;

    -- -------------------------------------------------------------------------
    -- 13. DISPOSITIVOS (relación con salas)
    -- -------------------------------------------------------------------------
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispositivos') THEN
        ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS sala_uuid UUID;
        UPDATE dispositivos d SET sala_uuid = s.uuid FROM salas s WHERE d.sala_id = s.id AND d.sala_uuid IS NULL;
        CREATE INDEX IF NOT EXISTS dispositivos_sala_uuid_idx ON dispositivos(sala_uuid);
    END IF;

END $$;


-- ==============================================================================
-- TRIGGERS DE SINCRONIZACIÓN AUTOMÁTICA BIDIRECCIONAL (ID <-> UUID)
-- ==============================================================================

-- 1. Trigger para LIBRO CONTROL CLIENTES
CREATE OR REPLACE FUNCTION trg_fn_sync_libro_control_clientes()
RETURNS TRIGGER AS $$
BEGIN
    -- Cliente: id <-> uuid
    IF NEW.cliente_id IS NOT NULL AND NEW.cliente_uuid IS NULL THEN
        SELECT uuid INTO NEW.cliente_uuid FROM clientes WHERE id = NEW.cliente_id;
    ELSIF NEW.cliente_uuid IS NOT NULL AND NEW.cliente_id IS NULL THEN
        SELECT id INTO NEW.cliente_id FROM clientes WHERE uuid = NEW.cliente_uuid;
    END IF;

    -- Libro: id <-> uuid
    IF NEW.libro_id IS NOT NULL AND NEW.libro_uuid IS NULL THEN
        SELECT uuid INTO NEW.libro_uuid FROM libros WHERE id = NEW.libro_id;
    ELSIF NEW.libro_uuid IS NOT NULL AND NEW.libro_id IS NULL THEN
        SELECT id INTO NEW.libro_id FROM libros WHERE uuid = NEW.libro_uuid;
    END IF;

    -- Metodo de Pago: id <-> uuid
    IF NEW.metodo_pago_id IS NOT NULL AND NEW.metodo_pago_uuid IS NULL THEN
        SELECT uuid INTO NEW.metodo_pago_uuid FROM metodos_pago WHERE id = NEW.metodo_pago_id;
    ELSIF NEW.metodo_pago_uuid IS NOT NULL AND NEW.metodo_pago_id IS NULL THEN
        SELECT id INTO NEW.metodo_pago_id FROM metodos_pago WHERE uuid = NEW.metodo_pago_uuid;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_dual_key_libro_control_clientes ON libro_control_clientes;
CREATE TRIGGER trg_sync_dual_key_libro_control_clientes
BEFORE INSERT OR UPDATE ON libro_control_clientes
FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_libro_control_clientes();


-- 2. Trigger para LIBRO APORTES
CREATE OR REPLACE FUNCTION trg_fn_sync_libro_aportes()
RETURNS TRIGGER AS $$
BEGIN
    -- Empleado: id <-> uuid
    IF NEW.empleado_id IS NOT NULL AND NEW.empleado_uuid IS NULL THEN
        SELECT uuid INTO NEW.empleado_uuid FROM empleados WHERE id = NEW.empleado_id;
    ELSIF NEW.empleado_uuid IS NOT NULL AND NEW.empleado_id IS NULL THEN
        SELECT id INTO NEW.empleado_id FROM empleados WHERE uuid = NEW.empleado_uuid;
    END IF;

    -- Libro: id <-> uuid
    IF NEW.libro_id IS NOT NULL AND NEW.libro_uuid IS NULL THEN
        SELECT uuid INTO NEW.libro_uuid FROM libros WHERE id = NEW.libro_id;
    ELSIF NEW.libro_uuid IS NOT NULL AND NEW.libro_id IS NULL THEN
        SELECT id INTO NEW.libro_id FROM libros WHERE uuid = NEW.libro_uuid;
    END IF;

    -- Rango: id <-> uuid
    IF NEW.rango_id IS NOT NULL AND NEW.rango_uuid IS NULL THEN
        SELECT uuid INTO NEW.rango_uuid FROM rangos WHERE id = NEW.rango_id;
    ELSIF NEW.rango_uuid IS NOT NULL AND NEW.rango_id IS NULL THEN
        SELECT id INTO NEW.rango_id FROM rangos WHERE uuid = NEW.rango_uuid;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_dual_key_libro_aportes ON libro_aportes;
CREATE TRIGGER trg_sync_dual_key_libro_aportes
BEFORE INSERT OR UPDATE ON libro_aportes
FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_libro_aportes();


-- 3. Trigger para CLIENTES
CREATE OR REPLACE FUNCTION trg_fn_sync_clientes()
RETURNS TRIGGER AS $$
BEGIN
    -- Sala: id <-> uuid
    IF NEW.sala_id IS NOT NULL AND NEW.sala_uuid IS NULL THEN
        SELECT uuid INTO NEW.sala_uuid FROM salas WHERE id = NEW.sala_id;
    ELSIF NEW.sala_uuid IS NOT NULL AND NEW.sala_id IS NULL THEN
        SELECT id INTO NEW.sala_id FROM salas WHERE uuid = NEW.sala_uuid;
    END IF;

    -- Tipo Cliente: id <-> uuid
    IF NEW.tipo_cliente_id IS NOT NULL AND NEW.tipo_cliente_uuid IS NULL THEN
        SELECT uuid INTO NEW.tipo_cliente_uuid FROM tipo_clientes WHERE id = NEW.tipo_cliente_id;
    ELSIF NEW.tipo_cliente_uuid IS NOT NULL AND NEW.tipo_cliente_id IS NULL THEN
        SELECT id INTO NEW.tipo_cliente_id FROM tipo_clientes WHERE uuid = NEW.tipo_cliente_uuid;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_dual_key_clientes ON clientes;
CREATE TRIGGER trg_sync_dual_key_clientes
BEFORE INSERT OR UPDATE ON clientes
FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_clientes();


-- 4. Trigger para DEPARTAMENTOS
CREATE OR REPLACE FUNCTION trg_fn_sync_departamentos()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.sala_id IS NOT NULL AND NEW.sala_uuid IS NULL THEN
        SELECT uuid INTO NEW.sala_uuid FROM salas WHERE id = NEW.sala_id;
    ELSIF NEW.sala_uuid IS NOT NULL AND NEW.sala_id IS NULL THEN
        SELECT id INTO NEW.sala_id FROM salas WHERE uuid = NEW.sala_uuid;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_dual_key_departamentos ON departamentos;
CREATE TRIGGER trg_sync_dual_key_departamentos
BEFORE INSERT OR UPDATE ON departamentos
FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_departamentos();


-- 5. Trigger para AREAS
CREATE OR REPLACE FUNCTION trg_fn_sync_areas()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.departamento_id IS NOT NULL AND NEW.departamento_uuid IS NULL THEN
        SELECT uuid INTO NEW.departamento_uuid FROM departamentos WHERE id = NEW.departamento_id;
    ELSIF NEW.departamento_uuid IS NOT NULL AND NEW.departamento_id IS NULL THEN
        SELECT id INTO NEW.departamento_id FROM departamentos WHERE uuid = NEW.departamento_uuid;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_dual_key_areas ON areas;
CREATE TRIGGER trg_sync_dual_key_areas
BEFORE INSERT OR UPDATE ON areas
FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_areas();


-- 6. Trigger para CARGOS
CREATE OR REPLACE FUNCTION trg_fn_sync_cargos()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.area_id IS NOT NULL AND NEW.area_uuid IS NULL THEN
        SELECT uuid INTO NEW.area_uuid FROM areas WHERE id = NEW.area_id;
    ELSIF NEW.area_uuid IS NOT NULL AND NEW.area_id IS NULL THEN
        SELECT id INTO NEW.area_id FROM areas WHERE uuid = NEW.area_uuid;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_dual_key_cargos ON cargos;
CREATE TRIGGER trg_sync_dual_key_cargos
BEFORE INSERT OR UPDATE ON cargos
FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_cargos();


-- 7. Trigger para EMPLEADOS
CREATE OR REPLACE FUNCTION trg_fn_sync_empleados()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.cargo_id IS NOT NULL AND NEW.cargo_uuid IS NULL THEN
        SELECT uuid INTO NEW.cargo_uuid FROM cargos WHERE id = NEW.cargo_id;
    ELSIF NEW.cargo_uuid IS NOT NULL AND NEW.cargo_id IS NULL THEN
        SELECT id INTO NEW.cargo_id FROM cargos WHERE uuid = NEW.cargo_uuid;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_dual_key_empleados ON empleados;
CREATE TRIGGER trg_sync_dual_key_empleados
BEFORE INSERT OR UPDATE ON empleados
FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_empleados();
