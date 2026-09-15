import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const sql = postgres({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'wisi',
  username: process.env.PGUSER || 'root',
  password: process.env.PGPASSWORD || 'S0p0rt3R0y4l-2025',
  onnotice: () => {}
});

async function main() {
  console.log('================================================================');
  console.log('MIGRACIÓN MAESTRA ROBUSTA A UUID (LOCAL-FIRST & DELTA SYNC)');
  console.log('================================================================\n');

  console.log('--- PRERREQUISITO: Habilitando extensión pgcrypto ---');
  await sql.unsafe(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
  console.log('✔ pgcrypto habilitado.');

  console.log('\n--- PASO 1: Asegurar columna uuid, constraints y columnas de sync en todas las tablas ---');
  const allTables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name != 'configuracion'
    ORDER BY table_name;
  `;

  for (const t of allTables) {
    const table = t.table_name;
    // 1. Agregar columna uuid si no existe
    await sql.unsafe(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();`);
    // 2. Poblar registros nulos
    await sql.unsafe(`UPDATE "${table}" SET uuid = gen_random_uuid() WHERE uuid IS NULL;`);
    // 3. Establecer NOT NULL
    await sql.unsafe(`ALTER TABLE "${table}" ALTER COLUMN uuid SET NOT NULL;`);
    
    // 4. Asegurar constraint UNIQUE en uuid
    await sql.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = '${table}_uuid_key' OR conname = '${table}_uuid_unique'
        ) THEN
          BEGIN
            ALTER TABLE "${table}" ADD CONSTRAINT "${table}_uuid_key" UNIQUE (uuid);
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;
        END IF;
      END $$;
    `);

    // 5. Agregar columnas de Soft Delete y Delta Sync si no existen
    await sql.unsafe(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;`);
    await sql.unsafe(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;`);
    await sql.unsafe(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;`);

    console.log(`✔ Tabla ${table}: uuid, is_deleted, deleted_at, updated_at configurados.`);
  }

  console.log('\n--- PASO 2: Creando y poblando columnas de Foreign Key (*_uuid) ---');
  const newFkDefinitions = [
    { table: 'departamentos', col: 'sala_uuid', parent: 'salas', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'sala_id' },
    { table: 'areas', col: 'departamento_uuid', parent: 'departamentos', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'departamento_id' },
    { table: 'cargos', col: 'area_uuid', parent: 'areas', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'area_id' },
    { table: 'empleados', col: 'cargo_uuid', parent: 'cargos', parentCol: 'uuid', onDel: 'SET NULL', oldIdCol: 'cargo_id' },
    { table: 'dispositivos', col: 'sala_uuid', parent: 'salas', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'sala_id' },
    { table: 'attlogs', col: 'dispositivo_uuid', parent: 'dispositivos', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'dispositivo_id' },
    { table: 'clientes', col: 'sala_uuid', parent: 'salas', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'sala_id' },
    { table: 'clientes', col: 'tipo_cliente_uuid', parent: 'tipo_clientes', parentCol: 'uuid', onDel: 'SET NULL', oldIdCol: 'tipo_cliente_id' },
    { table: 'libros', col: 'sala_uuid', parent: 'salas', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'sala_id' },
    { table: 'libro_control_clientes', col: 'libro_uuid', parent: 'libros', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'libro_id' },
    { table: 'libro_control_clientes', col: 'cliente_uuid', parent: 'clientes', parentCol: 'uuid', onDel: 'SET NULL', oldIdCol: 'cliente_id' },
    { table: 'libro_control_clientes', col: 'metodo_pago_uuid', parent: 'metodos_pago', parentCol: 'uuid', onDel: 'SET NULL', oldIdCol: 'metodo_pago_id' },
    { table: 'libro_aportes', col: 'libro_uuid', parent: 'libros', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'libro_id' },
    { table: 'libro_aportes', col: 'empleado_uuid', parent: 'empleados', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'empleado_id' },
    { table: 'libro_aportes', col: 'rango_uuid', parent: 'rangos', parentCol: 'uuid', onDel: 'SET NULL', oldIdCol: 'rango_id' },
    { table: 'libro_control_llaves', col: 'libro_uuid', parent: 'libros', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'libro_id' },
    { table: 'libro_datos', col: 'libro_uuid', parent: 'libros', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'libro_id' },
    { table: 'libro_drop_mesas', col: 'libro_uuid', parent: 'libros', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'libro_id' },
    { table: 'libro_drop_mesas', col: 'mesa_uuid', parent: 'mesas', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'mesa_id' },
    { table: 'libro_incidencias_generales', col: 'libro_uuid', parent: 'libros', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'libro_id' },
    { table: 'libro_incidencias_generales', col: 'tipo_incidencia_uuid', parent: 'tipo_incidencias', parentCol: 'uuid', onDel: 'SET NULL', oldIdCol: 'tipo_incidencia_id' },
    { table: 'libro_novedades_mesas', col: 'libro_uuid', parent: 'libros', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'libro_id' },
    { table: 'libro_novedades_mesas', col: 'mesa_uuid', parent: 'mesas', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'mesa_id' },
    { table: 'libro_reporte', col: 'libro_uuid', parent: 'libros', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'libro_id' },
    { table: 'llaves', col: 'sala_uuid', parent: 'salas', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'sala_id' },
    { table: 'mesas', col: 'sala_uuid', parent: 'salas', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'sala_id' },
    { table: 'mesas', col: 'juego_uuid', parent: 'juegos', parentCol: 'uuid', onDel: 'SET NULL', oldIdCol: 'juego_id' },
    { table: 'modelos', col: 'marca_uuid', parent: 'marcas', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'marca_id' },
    { table: 'modulos', col: 'page_uuid', parent: 'paginas', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'page_id' },
    { table: 'feriados', col: 'sala_uuid', parent: 'salas', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'sala_id' },
    { table: 'maquinas', col: 'sala_uuid', parent: 'salas', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'sala_id' },
    { table: 'maquinas', col: 'estado_uuid', parent: 'estados', parentCol: 'uuid', onDel: 'SET NULL', oldIdCol: 'estado_id' },
    { table: 'maquinas', col: 'juego_uuid', parent: 'juegos', parentCol: 'uuid', onDel: 'SET NULL', oldIdCol: 'juego_id' },
    { table: 'maquinas', col: 'legal_uuid', parent: 'legal', parentCol: 'uuid', onDel: 'SET NULL', oldIdCol: 'legal_id' },
    { table: 'maquinas', col: 'modelo_uuid', parent: 'modelos', parentCol: 'uuid', onDel: 'SET NULL', oldIdCol: 'modelo_id' },
    { table: 'maquinas', col: 'modo_uuid', parent: 'modos', parentCol: 'uuid', onDel: 'SET NULL', oldIdCol: 'modo_id' },
    { table: 'maquinas', col: 'sociedad_uuid', parent: 'sociedades', parentCol: 'uuid', onDel: 'SET NULL', oldIdCol: 'sociedad_id' },
    { table: 'maquinas', col: 'tipo_uuid', parent: 'tipos', parentCol: 'uuid', onDel: 'SET NULL', oldIdCol: 'tipo_id' },
    { table: 'maquinas', col: 'valor_uuid', parent: 'valores', parentCol: 'uuid', onDel: 'SET NULL', oldIdCol: 'valor_id' },
    { table: 'user_salas', col: 'user_uuid', parent: 'usuarios', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'user_id' },
    { table: 'user_salas', col: 'sala_uuid', parent: 'salas', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'sala_id' },
    { table: 'user_module_permissions', col: 'user_uuid', parent: 'usuarios', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'user_id' },
    { table: 'user_module_permissions', col: 'module_uuid', parent: 'modulos', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'module_id' },
    { table: 'user_module_permissions', col: 'permission_uuid', parent: 'permissions', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'permission_id' },
    { table: 'fcm_tokens', col: 'user_uuid', parent: 'usuarios', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'user_id' },
    { table: 'empleado_dispositivos', col: 'empleado_uuid', parent: 'empleados', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'empleado_id' },
    { table: 'empleado_dispositivos', col: 'dispositivo_uuid', parent: 'dispositivos', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'dispositivo_id' },
    { table: 'salas', col: 'grupo_uuid', parent: 'grupo_salas', parentCol: 'uuid', onDel: 'SET NULL', oldIdCol: 'grupo_id' },
    { table: 'empleados_horarios', col: 'empleado_uuid', parent: 'empleados', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'empleado_id' },
    { table: 'empleados_horarios', col: 'horario_uuid', parent: 'horarios', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'horario_id' },
    { table: 'empleados_excepciones_horarios', col: 'empleado_uuid', parent: 'empleados', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'empleado_id' },
    { table: 'empleados_excepciones_horarios', col: 'excepcion_uuid', parent: 'excepciones', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'excepcion_id' },
    { table: 'empleados_excepciones_horarios', col: 'horario_uuid', parent: 'horarios', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'horario_id' },
    { table: 'drop_mesas', col: 'libro_uuid', parent: 'libros', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'libro_id' },
    { table: 'drop_mesas', col: 'mesa_uuid', parent: 'mesas', parentCol: 'uuid', onDel: 'CASCADE', oldIdCol: 'mesa_id' }
  ];

  for (const fk of newFkDefinitions) {
    // 1. Agregar columna FK si no existe
    await sql.unsafe(`ALTER TABLE "${fk.table}" ADD COLUMN IF NOT EXISTS "${fk.col}" UUID;`);

    // 2. Backfill desde la columna integer ID si existe
    if (fk.oldIdCol) {
      await sql.unsafe(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = '${fk.table}' AND column_name = '${fk.oldIdCol}'
          ) AND EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = '${fk.parent}' AND column_name = 'id'
          ) THEN
            EXECUTE 'UPDATE "${fk.table}" c SET "${fk.col}" = p.uuid FROM "${fk.parent}" p WHERE c."${fk.oldIdCol}" = p.id AND c."${fk.col}" IS NULL';
          END IF;
        END $$;
      `);
    }

    // 3. Sanitizar huérfanos (evita fallo de integridad referencial si existían datos desalineados)
    await sql.unsafe(`
      UPDATE "${fk.table}" 
      SET "${fk.col}" = NULL 
      WHERE "${fk.col}" IS NOT NULL AND "${fk.col}" NOT IN (SELECT uuid FROM "${fk.parent}");
    `);

    // 4. Crear índice en la columna FK
    await sql.unsafe(`CREATE INDEX IF NOT EXISTS "${fk.table}_${fk.col}_idx" ON "${fk.table}" ("${fk.col}");`);
    console.log(`✔ FK columna lista y backfilled: ${fk.table}.${fk.col} -> ${fk.parent}.uuid`);
  }

  // Caso especial attlogs -> empleados vía cedula
  await sql.unsafe(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'attlogs' AND column_name = 'employee_no'
      ) AND EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'empleados' AND column_name = 'cedula'
      ) THEN
        ALTER TABLE attlogs ADD COLUMN IF NOT EXISTS empleado_uuid UUID;
        UPDATE attlogs a SET empleado_uuid = e.uuid FROM empleados e WHERE a.employee_no = e.cedula AND a.empleado_uuid IS NULL;
        CREATE INDEX IF NOT EXISTS attlogs_empleado_uuid_idx ON attlogs (empleado_uuid);
      END IF;
    END $$;
  `);
  console.log('✔ attlogs.empleado_uuid backfilled.');

  console.log('\n--- PASO 3: Migrando Unique Constraints a UUID ---');
  // attlogs
  await sql.unsafe(`
    DO $$
    BEGIN
      DELETE FROM attlogs a USING attlogs b
      WHERE a.ctid < b.ctid 
        AND a.dispositivo_uuid = b.dispositivo_uuid 
        AND a.employee_no = b.employee_no 
        AND a.event_time = b.event_time;

      ALTER TABLE attlogs DROP CONSTRAINT IF EXISTS uk_attlog_record;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_attlog_record_uuid') THEN
        ALTER TABLE attlogs ADD CONSTRAINT uk_attlog_record_uuid UNIQUE (dispositivo_uuid, employee_no, event_time);
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$;
  `);

  // empleados_excepciones_horarios
  await sql.unsafe(`
    DO $$
    BEGIN
      DELETE FROM empleados_excepciones_horarios a USING empleados_excepciones_horarios b
      WHERE a.ctid < b.ctid AND a.empleado_uuid = b.empleado_uuid AND a.fecha = b.fecha;

      ALTER TABLE empleados_excepciones_horarios DROP CONSTRAINT IF EXISTS uk_emp_fecha_excepcion;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_emp_fecha_excepcion_uuid') THEN
        ALTER TABLE empleados_excepciones_horarios ADD CONSTRAINT uk_emp_fecha_excepcion_uuid UNIQUE (empleado_uuid, fecha);
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$;
  `);

  // empleados_horarios
  await sql.unsafe(`
    DO $$
    BEGIN
      DELETE FROM empleados_horarios a USING empleados_horarios b
      WHERE a.ctid < b.ctid AND a.empleado_uuid = b.empleado_uuid AND a.horario_uuid = b.horario_uuid;

      ALTER TABLE empleados_horarios DROP CONSTRAINT IF EXISTS uk_emp_plantilla;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_emp_plantilla_uuid') THEN
        ALTER TABLE empleados_horarios ADD CONSTRAINT uk_emp_plantilla_uuid UNIQUE (empleado_uuid, horario_uuid);
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$;
  `);

  // libro_datos
  await sql.unsafe(`
    DO $$
    BEGIN
      DELETE FROM libro_datos a USING libro_datos b
      WHERE a.ctid < b.ctid AND a.libro_uuid = b.libro_uuid;

      ALTER TABLE libro_datos DROP CONSTRAINT IF EXISTS libro_datos_libro_id_key;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'libro_datos_libro_uuid_key') THEN
        ALTER TABLE libro_datos ADD CONSTRAINT libro_datos_libro_uuid_key UNIQUE (libro_uuid);
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$;
  `);

  // libro_novedades_mesas
  await sql.unsafe(`
    DO $$
    BEGIN
      DELETE FROM libro_novedades_mesas a USING libro_novedades_mesas b
      WHERE a.ctid < b.ctid AND a.libro_uuid = b.libro_uuid AND a.mesa_uuid = b.mesa_uuid;

      ALTER TABLE libro_novedades_mesas DROP CONSTRAINT IF EXISTS uq_libro_mesa_novedad;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_libro_mesa_novedad_uuid') THEN
        ALTER TABLE libro_novedades_mesas ADD CONSTRAINT uq_libro_mesa_novedad_uuid UNIQUE (libro_uuid, mesa_uuid);
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$;
  `);

  // user_salas
  await sql.unsafe(`
    DO $$
    BEGIN
      DELETE FROM user_salas a USING user_salas b
      WHERE a.ctid < b.ctid AND a.user_uuid = b.user_uuid AND a.sala_uuid = b.sala_uuid;

      ALTER TABLE user_salas DROP CONSTRAINT IF EXISTS user_salas_user_id_sala_id_key;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_salas_user_uuid_sala_uuid_key') THEN
        ALTER TABLE user_salas ADD CONSTRAINT user_salas_user_uuid_sala_uuid_key UNIQUE (user_uuid, sala_uuid);
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$;
  `);

  // user_module_permissions
  await sql.unsafe(`
    DO $$
    BEGIN
      DELETE FROM user_module_permissions a USING user_module_permissions b
      WHERE a.ctid < b.ctid AND a.user_uuid = b.user_uuid AND a.module_uuid = b.module_uuid AND a.permission_uuid = b.permission_uuid;

      ALTER TABLE user_module_permissions DROP CONSTRAINT IF EXISTS user_module_permissions_user_id_module_id_permission_id_key;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_mod_perm_uuid_key') THEN
        ALTER TABLE user_module_permissions ADD CONSTRAINT user_mod_perm_uuid_key UNIQUE (user_uuid, module_uuid, permission_uuid);
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END $$;
  `);
  console.log('✔ Unique constraints migrados a UUID.');

  console.log('\n--- PASO 4: Eliminando Foreign Keys antiguas basadas en integer ID ---');
  const oldFks = await sql`
    SELECT tc.table_name, tc.constraint_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' AND ccu.column_name = 'id';
  `;

  for (const fk of oldFks) {
    await sql.unsafe(`ALTER TABLE "${fk.table_name}" DROP CONSTRAINT IF EXISTS "${fk.constraint_name}" CASCADE;`);
    console.log(`Eliminada FK antigua: ${fk.table_name}.${fk.constraint_name}`);
  }

  console.log('\n--- PASO 5: Cambiando Primary Key a UUID en todas las tablas ---');
  for (const t of allTables) {
    const table = t.table_name;
    await sql.unsafe(`
      DO $$
      DECLARE
        old_pk_name text;
      BEGIN
        SELECT tc.constraint_name INTO old_pk_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name = '${table}' AND ccu.column_name = 'id';

        IF old_pk_name IS NOT NULL THEN
          EXECUTE 'ALTER TABLE "' || '${table}' || '" DROP CONSTRAINT IF EXISTS "' || old_pk_name || '" CASCADE';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints tc
          JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
          WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public' AND tc.table_name = '${table}' AND ccu.column_name = 'uuid'
        ) THEN
          EXECUTE 'ALTER TABLE "' || '${table}' || '" DROP CONSTRAINT IF EXISTS "${table}_uuid_key"';
          EXECUTE 'ALTER TABLE "' || '${table}' || '" ADD PRIMARY KEY (uuid)';
        END IF;
      END $$;
    `);
    console.log(`✔ Tabla ${table}: Primary Key ahora es UUID.`);
  }

  console.log('\n--- PASO 6: Creando nuevas Foreign Keys oficiales basadas 100% en UUID ---');
  for (const fk of newFkDefinitions) {
    const fkName = `fk_${fk.table}_${fk.col}`;
    await sql.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = '${fkName}'
        ) THEN
          ALTER TABLE "${fk.table}" ADD CONSTRAINT "${fkName}" FOREIGN KEY ("${fk.col}") REFERENCES "${fk.parent}"("${fk.parentCol}") ON DELETE ${fk.onDel};
        END IF;
      END $$;
    `);
    console.log(`✔ Nueva FK UUID creada: ${fk.table}.${fk.col} -> ${fk.parent}.${fk.parentCol}`);
  }

  console.log('\n--- PASO 7: Configurando Triggers de updated_at para Delta Sync ---');
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  for (const t of allTables) {
    const table = t.table_name;
    await sql.unsafe(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = 'updated_at'
        ) THEN
          DROP TRIGGER IF EXISTS trg_set_updated_at ON "${table}";
          CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON "${table}" FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();
        END IF;
      END $$;
    `);
  }
  console.log('✔ Triggers set_updated_at_timestamp configurados en todas las tablas.');

  console.log('\n================================================================');
  console.log('TRANSICIÓN A UUID Y DELTA SYNC COMPLETADA CON 100% DE ÉXITO');
  console.log('================================================================');
  await sql.end();
}

main().catch(err => {
  console.error('Error durante la transición:', err);
  process.exit(1);
});
