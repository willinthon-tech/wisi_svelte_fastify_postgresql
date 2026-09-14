import { initDb, sql } from '../src/config/db.js';

async function main() {
  await initDb();
  console.log('--- Iniciando migración universal de UUIDs y Dual-Keys ---');

  // 1. Tablas base que requieren columna uuid propia
  const tablesWithUuid = [
    'cortes',
    'descargas',
    'excepciones',
    'fechas_patrias',
    'feriados',
    'libro_reporte',
    'paginas',
    'modulos'
  ];

  for (const t of tablesWithUuid) {
    await sql.unsafe(`
      ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();
      UPDATE "${t}" SET uuid = gen_random_uuid() WHERE uuid IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS "${t}_uuid_idx" ON "${t}" (uuid);
    `);
    console.log(`✓ Tabla ${t}: columna uuid agregada y asegurada.`);
  }

  // 2. Modulos -> Paginas (page_uuid)
  await sql.unsafe(`
    ALTER TABLE modulos ADD COLUMN IF NOT EXISTS page_uuid UUID;
    UPDATE modulos m
    SET page_uuid = p.uuid
    FROM paginas p
    WHERE m.page_id = p.id AND m.page_uuid IS NULL;
    CREATE INDEX IF NOT EXISTS modulos_page_uuid_idx ON modulos(page_uuid);

    CREATE OR REPLACE FUNCTION sync_dual_keys_modulos() RETURNS trigger AS $$
    BEGIN
      IF NEW.page_uuid IS NOT NULL AND NEW.page_id IS NULL THEN
        SELECT id INTO NEW.page_id FROM paginas WHERE uuid = NEW.page_uuid;
      ELSIF NEW.page_id IS NOT NULL AND NEW.page_uuid IS NULL THEN
        SELECT uuid INTO NEW.page_uuid FROM paginas WHERE id = NEW.page_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_sync_dual_keys_modulos ON modulos;
    CREATE TRIGGER trg_sync_dual_keys_modulos
    BEFORE INSERT OR UPDATE ON modulos
    FOR EACH ROW EXECUTE FUNCTION sync_dual_keys_modulos();
  `);
  console.log('✓ Modulos: page_uuid y trigger de sincronización activos.');

  // 3. Modelos -> Marcas (marca_uuid)
  await sql.unsafe(`
    ALTER TABLE modelos ADD COLUMN IF NOT EXISTS marca_uuid UUID;
    UPDATE modelos m
    SET marca_uuid = mar.uuid
    FROM marcas mar
    WHERE m.marca_id = mar.id AND m.marca_uuid IS NULL;
    CREATE INDEX IF NOT EXISTS modelos_marca_uuid_idx ON modelos(marca_uuid);

    CREATE OR REPLACE FUNCTION sync_dual_keys_modelos() RETURNS trigger AS $$
    BEGIN
      IF NEW.marca_uuid IS NOT NULL AND NEW.marca_id IS NULL THEN
        SELECT id INTO NEW.marca_id FROM marcas WHERE uuid = NEW.marca_uuid;
      ELSIF NEW.marca_id IS NOT NULL AND NEW.marca_uuid IS NULL THEN
        SELECT uuid INTO NEW.marca_uuid FROM marcas WHERE id = NEW.marca_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_sync_dual_keys_modelos ON modelos;
    CREATE TRIGGER trg_sync_dual_keys_modelos
    BEFORE INSERT OR UPDATE ON modelos
    FOR EACH ROW EXECUTE FUNCTION sync_dual_keys_modelos();
  `);
  console.log('✓ Modelos: marca_uuid y trigger de sincronización activos.');

  // 4. Feriados -> Salas (sala_uuid)
  await sql.unsafe(`
    ALTER TABLE feriados ADD COLUMN IF NOT EXISTS sala_uuid UUID;
    UPDATE feriados f
    SET sala_uuid = s.uuid
    FROM salas s
    WHERE f.sala_id = s.id AND f.sala_uuid IS NULL;
    CREATE INDEX IF NOT EXISTS feriados_sala_uuid_idx ON feriados(sala_uuid);

    CREATE OR REPLACE FUNCTION sync_dual_keys_feriados() RETURNS trigger AS $$
    BEGIN
      IF NEW.sala_uuid IS NOT NULL AND NEW.sala_id IS NULL THEN
        SELECT id INTO NEW.sala_id FROM salas WHERE uuid = NEW.sala_uuid;
      ELSIF NEW.sala_id IS NOT NULL AND NEW.sala_uuid IS NULL THEN
        SELECT uuid INTO NEW.sala_uuid FROM salas WHERE id = NEW.sala_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_sync_dual_keys_feriados ON feriados;
    CREATE TRIGGER trg_sync_dual_keys_feriados
    BEFORE INSERT OR UPDATE ON feriados
    FOR EACH ROW EXECUTE FUNCTION sync_dual_keys_feriados();
  `);
  console.log('✓ Feriados: sala_uuid y trigger de sincronización activos.');

  // 5. Mesas -> Salas (sala_uuid) y Juegos (juego_uuid)
  await sql.unsafe(`
    ALTER TABLE mesas ADD COLUMN IF NOT EXISTS sala_uuid UUID;
    ALTER TABLE mesas ADD COLUMN IF NOT EXISTS juego_uuid UUID;

    UPDATE mesas m SET sala_uuid = s.uuid FROM salas s WHERE m.sala_id = s.id AND m.sala_uuid IS NULL;
    UPDATE mesas m SET juego_uuid = j.uuid FROM juegos j WHERE m.juego_id = j.id AND m.juego_uuid IS NULL;

    CREATE INDEX IF NOT EXISTS mesas_sala_uuid_idx ON mesas(sala_uuid);
    CREATE INDEX IF NOT EXISTS mesas_juego_uuid_idx ON mesas(juego_uuid);

    CREATE OR REPLACE FUNCTION sync_dual_keys_mesas() RETURNS trigger AS $$
    BEGIN
      -- Sincronizar sala
      IF NEW.sala_uuid IS NOT NULL AND NEW.sala_id IS NULL THEN
        SELECT id INTO NEW.sala_id FROM salas WHERE uuid = NEW.sala_uuid;
      ELSIF NEW.sala_id IS NOT NULL AND NEW.sala_uuid IS NULL THEN
        SELECT uuid INTO NEW.sala_uuid FROM salas WHERE id = NEW.sala_id;
      END IF;

      -- Sincronizar juego
      IF NEW.juego_uuid IS NOT NULL AND NEW.juego_id IS NULL THEN
        SELECT id INTO NEW.juego_id FROM juegos WHERE uuid = NEW.juego_uuid;
      ELSIF NEW.juego_id IS NOT NULL AND NEW.juego_uuid IS NULL THEN
        SELECT uuid INTO NEW.juego_uuid FROM juegos WHERE id = NEW.juego_id;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_sync_dual_keys_mesas ON mesas;
    CREATE TRIGGER trg_sync_dual_keys_mesas
    BEFORE INSERT OR UPDATE ON mesas
    FOR EACH ROW EXECUTE FUNCTION sync_dual_keys_mesas();
  `);
  console.log('✓ Mesas: dual-keys y trigger activos.');

  // 6. Llaves -> Salas (sala_uuid)
  await sql.unsafe(`
    ALTER TABLE llaves ADD COLUMN IF NOT EXISTS sala_uuid UUID;
    UPDATE llaves l SET sala_uuid = s.uuid FROM salas s WHERE l.sala_id = s.id AND l.sala_uuid IS NULL;
    CREATE INDEX IF NOT EXISTS llaves_sala_uuid_idx ON llaves(sala_uuid);

    CREATE OR REPLACE FUNCTION sync_dual_keys_llaves() RETURNS trigger AS $$
    BEGIN
      IF NEW.sala_uuid IS NOT NULL AND NEW.sala_id IS NULL THEN
        SELECT id INTO NEW.sala_id FROM salas WHERE uuid = NEW.sala_uuid;
      ELSIF NEW.sala_id IS NOT NULL AND NEW.sala_uuid IS NULL THEN
        SELECT uuid INTO NEW.sala_uuid FROM salas WHERE id = NEW.sala_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_sync_dual_keys_llaves ON llaves;
    CREATE TRIGGER trg_sync_dual_keys_llaves
    BEFORE INSERT OR UPDATE ON llaves
    FOR EACH ROW EXECUTE FUNCTION sync_dual_keys_llaves();
  `);
  console.log('✓ Llaves: dual-keys y trigger activos.');

  // 7. Libro Control Llaves -> llaves_uuids ARRAY
  await sql.unsafe(`
    ALTER TABLE libro_control_llaves ADD COLUMN IF NOT EXISTS llaves_uuids UUID[];

    -- Retro-poblar llaves_uuids desde llaves_ids existentes
    UPDATE libro_control_llaves cl
    SET llaves_uuids = (
      SELECT ARRAY_AGG(l.uuid) 
      FROM llaves l 
      WHERE l.id = ANY(cl.llaves_ids)
    )
    WHERE cl.llaves_ids IS NOT NULL AND cl.llaves_uuids IS NULL;
  `);
  console.log('✓ Libro Control Llaves: llaves_uuids y backfill completo.');

  // 8. Cortes -> salas_uuids ARRAY
  await sql.unsafe(`
    ALTER TABLE cortes ADD COLUMN IF NOT EXISTS salas_uuids UUID[];
    UPDATE cortes c
    SET salas_uuids = (
      SELECT ARRAY_AGG(s.uuid)
      FROM salas s
      WHERE s.id = ANY(c.salas_ids)
    )
    WHERE c.salas_ids IS NOT NULL AND c.salas_uuids IS NULL;
  `);
  console.log('✓ Cortes: salas_uuids y backfill completo.');

  // 9. Crear tabla maquinas con soporte dual-key completo
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS maquinas (
      id SERIAL PRIMARY KEY,
      uuid UUID DEFAULT gen_random_uuid() UNIQUE,
      nombre VARCHAR(100),
      serial VARCHAR(100),
      puestos INT NOT NULL DEFAULT 1,
      sala_id INT REFERENCES salas(id) ON DELETE SET NULL,
      sala_uuid UUID,
      juego_id INT,
      juego_uuid UUID,
      estado_id INT,
      estado_uuid UUID,
      sociedad_id INT,
      sociedad_uuid UUID,
      valor_id INT,
      valor_uuid UUID,
      modelo_id INT,
      modelo_uuid UUID,
      tipo_id INT,
      tipo_uuid UUID,
      modo_id INT,
      modo_uuid UUID,
      legal_id INT,
      legal_uuid UUID,
      is_deleted BOOLEAN DEFAULT FALSE,
      deleted_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS maquinas_uuid_idx ON maquinas(uuid);
    CREATE INDEX IF NOT EXISTS maquinas_sala_uuid_idx ON maquinas(sala_uuid);
    CREATE INDEX IF NOT EXISTS maquinas_juego_uuid_idx ON maquinas(juego_uuid);
    CREATE INDEX IF NOT EXISTS maquinas_modelo_uuid_idx ON maquinas(modelo_uuid);

    CREATE OR REPLACE FUNCTION sync_dual_keys_maquinas() RETURNS trigger AS $$
    BEGIN
      -- Sala
      IF NEW.sala_uuid IS NOT NULL AND NEW.sala_id IS NULL THEN
        SELECT id INTO NEW.sala_id FROM salas WHERE uuid = NEW.sala_uuid;
      ELSIF NEW.sala_id IS NOT NULL AND NEW.sala_uuid IS NULL THEN
        SELECT uuid INTO NEW.sala_uuid FROM salas WHERE id = NEW.sala_id;
      END IF;

      -- Juego
      IF NEW.juego_uuid IS NOT NULL AND NEW.juego_id IS NULL THEN
        SELECT id INTO NEW.juego_id FROM juegos_maquinas WHERE uuid = NEW.juego_uuid;
      ELSIF NEW.juego_id IS NOT NULL AND NEW.juego_uuid IS NULL THEN
        SELECT uuid INTO NEW.juego_uuid FROM juegos_maquinas WHERE id = NEW.juego_id;
      END IF;

      -- Modelo
      IF NEW.modelo_uuid IS NOT NULL AND NEW.modelo_id IS NULL THEN
        SELECT id INTO NEW.modelo_id FROM modelos WHERE uuid = NEW.modelo_uuid;
      ELSIF NEW.modelo_id IS NOT NULL AND NEW.modelo_uuid IS NULL THEN
        SELECT uuid INTO NEW.modelo_uuid FROM modelos WHERE id = NEW.modelo_id;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_sync_dual_keys_maquinas ON maquinas;
    CREATE TRIGGER trg_sync_dual_keys_maquinas
    BEFORE INSERT OR UPDATE ON maquinas
    FOR EACH ROW EXECUTE FUNCTION sync_dual_keys_maquinas();
  `);
  console.log('✓ Tabla maquinas creada y sincronizada con dual-keys.');

  console.log('--- Migración completada exitosamente ---');
  process.exit(0);
}

main().catch(err => {
  console.error('Error en migración:', err);
  process.exit(1);
});
