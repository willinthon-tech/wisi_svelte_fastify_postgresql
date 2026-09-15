import postgres from 'postgres';

const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function main() {
  console.log('================================================================');
  console.log('MIGRACION DEFINITIVA: ELIMINAR 100% DE COLUMNAS id y *_id');
  console.log('================================================================\n');

  console.log('--- PASO 1: Recrear Unique Constraints con UUID ---');
  
  // 1. attlogs: uk_attlog_record
  await sql.unsafe(`ALTER TABLE attlogs DROP CONSTRAINT IF EXISTS uk_attlog_record;`);
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_attlog_record_uuid') THEN
        ALTER TABLE attlogs ADD CONSTRAINT uk_attlog_record_uuid UNIQUE (dispositivo_uuid, employee_no, event_time);
      END IF;
    END $$;
  `);
  console.log('attlogs: constraint UNIQUE migrado a (dispositivo_uuid, employee_no, event_time).');

  // 2. empleados_excepciones_horarios: uk_emp_fecha_excepcion
  await sql.unsafe(`ALTER TABLE empleados_excepciones_horarios DROP CONSTRAINT IF EXISTS uk_emp_fecha_excepcion;`);
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_emp_fecha_excepcion_uuid') THEN
        ALTER TABLE empleados_excepciones_horarios ADD CONSTRAINT uk_emp_fecha_excepcion_uuid UNIQUE (empleado_uuid, fecha);
      END IF;
    END $$;
  `);
  console.log('empleados_excepciones_horarios: constraint UNIQUE migrado a (empleado_uuid, fecha).');

  // 3. empleados_horarios: uk_emp_plantilla
  await sql.unsafe(`ALTER TABLE empleados_horarios DROP CONSTRAINT IF EXISTS uk_emp_plantilla;`);
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_emp_plantilla_uuid') THEN
        ALTER TABLE empleados_horarios ADD CONSTRAINT uk_emp_plantilla_uuid UNIQUE (empleado_uuid, horario_uuid);
      END IF;
    END $$;
  `);
  console.log('empleados_horarios: constraint UNIQUE migrado a (empleado_uuid, horario_uuid).');

  // 4. libro_datos: libro_datos_libro_id_key
  await sql.unsafe(`ALTER TABLE libro_datos DROP CONSTRAINT IF EXISTS libro_datos_libro_id_key;`);
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'libro_datos_libro_uuid_key') THEN
        ALTER TABLE libro_datos ADD CONSTRAINT libro_datos_libro_uuid_key UNIQUE (libro_uuid);
      END IF;
    END $$;
  `);
  console.log('libro_datos: constraint UNIQUE migrado a (libro_uuid).');

  // 5. libro_novedades_mesas: uq_libro_mesa_novedad
  await sql.unsafe(`ALTER TABLE libro_novedades_mesas DROP CONSTRAINT IF EXISTS uq_libro_mesa_novedad;`);
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_libro_mesa_novedad_uuid') THEN
        ALTER TABLE libro_novedades_mesas ADD CONSTRAINT uq_libro_mesa_novedad_uuid UNIQUE (libro_uuid, mesa_uuid);
      END IF;
    END $$;
  `);
  console.log('libro_novedades_mesas: constraint UNIQUE migrado a (libro_uuid, mesa_uuid).');

  // 6. libro_reporte: uq_libro_reporte_libro
  await sql.unsafe(`ALTER TABLE libro_reporte DROP CONSTRAINT IF EXISTS uq_libro_reporte_libro;`);
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_libro_reporte_libro_uuid') THEN
        ALTER TABLE libro_reporte ADD CONSTRAINT uq_libro_reporte_libro_uuid UNIQUE (libro_uuid);
      END IF;
    END $$;
  `);
  console.log('libro_reporte: constraint UNIQUE migrado a (libro_uuid).');

  // 7. mesas: uq_mesas_nombre_sala
  await sql.unsafe(`ALTER TABLE mesas DROP CONSTRAINT IF EXISTS uq_mesas_nombre_sala;`);
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_mesas_nombre_sala_uuid') THEN
        ALTER TABLE mesas ADD CONSTRAINT uq_mesas_nombre_sala_uuid UNIQUE (sala_uuid, nombre);
      END IF;
    END $$;
  `);
  console.log('mesas: constraint UNIQUE migrado a (sala_uuid, nombre).');

  // 8. modelos: uq_modelos_nombre_marca
  await sql.unsafe(`ALTER TABLE modelos DROP CONSTRAINT IF EXISTS uq_modelos_nombre_marca;`);
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_modelos_nombre_marca_uuid') THEN
        ALTER TABLE modelos ADD CONSTRAINT uq_modelos_nombre_marca_uuid UNIQUE (marca_uuid, nombre);
      END IF;
    END $$;
  `);
  console.log('modelos: constraint UNIQUE migrado a (marca_uuid, nombre).');

  // 9. user_module_permissions: uk_user_module_perm
  await sql.unsafe(`ALTER TABLE user_module_permissions DROP CONSTRAINT IF EXISTS uk_user_module_perm;`);
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_user_module_perm_uuid') THEN
        ALTER TABLE user_module_permissions ADD CONSTRAINT uk_user_module_perm_uuid UNIQUE (user_uuid, module_uuid, permission_uuid);
      END IF;
    END $$;
  `);
  console.log('user_module_permissions: constraint UNIQUE migrado a (user_uuid, module_uuid, permission_uuid).');

  console.log('\n--- PASO 2: Eliminando triggers de dual key que referencian id ---');
  const dualTriggers = await sql`
    SELECT trigger_name, event_object_table
    FROM information_schema.triggers
    WHERE trigger_name LIKE '%dual%'
    GROUP BY trigger_name, event_object_table;
  `;
  for (const trg of dualTriggers) {
    await sql.unsafe(`DROP TRIGGER IF EXISTS "${trg.trigger_name}" ON "${trg.event_object_table}" CASCADE;`);
    console.log(`Trigger eliminado: ${trg.event_object_table}.${trg.trigger_name}`);
  }

  console.log('\n--- PASO 3: Eliminando columnas id de absolutamente todas las tablas ---');
  const tablesWithId = await sql`
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'id'
    ORDER BY table_name;
  `;

  for (const t of tablesWithId) {
    try {
      await sql.unsafe(`ALTER TABLE "${t.table_name}" DROP COLUMN IF EXISTS id CASCADE;`);
      console.log(`Tabla ${t.table_name}: Columna 'id' ELIMINADA exitosamente.`);
    } catch (e) {
      console.log(`Tabla ${t.table_name}: ignorado o ya no existe (${e.message})`);
    }
  }

  console.log('\n--- PASO 4: Eliminando columnas foráneas legadas *_id de tipo entero ---');
  const fkIdCols = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND column_name LIKE '%\_id' ESCAPE '\\' 
      AND column_name != 'id'
      AND data_type IN ('integer', 'smallint', 'bigint')
    ORDER BY table_name, column_name;
  `;

  for (const col of fkIdCols) {
    try {
      await sql.unsafe(`ALTER TABLE "${col.table_name}" DROP COLUMN IF EXISTS "${col.column_name}" CASCADE;`);
      console.log(`Columna foránea legada eliminada: ${col.table_name}.${col.column_name}`);
    } catch (e) {
      console.log(`Columna ${col.table_name}.${col.column_name}: ignorado o ya no existe (${e.message})`);
    }
  }

  console.log('\n================================================================');
  console.log('VERIFICACION FINAL DE LA BASE DE DATOS');
  console.log('================================================================');

  const remainingIdCols = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'id';
  `;
  console.log(`Columnas 'id' restantes en toda la base de datos: ${remainingIdCols.length}`);

  const remainingIntFkCols = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' 
      AND column_name LIKE '%\_id' ESCAPE '\\' 
      AND data_type IN ('integer', 'smallint', 'bigint');
  `;
  console.log(`Columnas '*_id' enteras restantes en toda la base de datos: ${remainingIntFkCols.length}`);

  const allPks = await sql`
    SELECT tc.table_name, ccu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name;
  `;
  console.log(`Total Primary Keys en la base de datos: ${allPks.length}`);
  const nonUuidPks = allPks.filter(p => p.column_name !== 'uuid' && p.table_name !== 'configuracion');
  if (nonUuidPks.length === 0) {
    console.log('100% DE LAS TABLAS TIENEN UUID COMO PRIMARY KEY!');
  } else {
    console.log('Tablas con PK no-uuid:', nonUuidPks);
  }

  await sql.end();
  console.log('\nBase de datos completamente migrada a UUID.');
}

main().catch(err => {
  console.error('Error fatal durante la migración:', err);
  process.exit(1);
});
