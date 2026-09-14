import postgres from 'postgres';

const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function main() {
  console.log('--- PASO 1: Asegurar que uuid sea NOT NULL y UNIQUE en todas las tablas ---');

  const allTables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name != 'configuracion'
    ORDER BY table_name;
  `;

  for (const t of allTables) {
    const table = t.table_name;
    await sql.unsafe(`ALTER TABLE "${table}" ALTER COLUMN uuid SET NOT NULL;`);
    // Asegurar que exista un indice o constraint UNIQUE en uuid
    await sql.unsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = '${table}_uuid_key' OR conname = '${table}_uuid_unique'
        ) THEN
          BEGIN
            ALTER TABLE "${table}" ADD CONSTRAINT "${table}_uuid_key" UNIQUE (uuid);
          EXCEPTION WHEN duplicate_table OR duplicate_object THEN
            NULL;
          END;
        END IF;
      END $$;
    `);
    console.log(`Tabla ${table}: uuid es NOT NULL y UNIQUE.`);
  }

  console.log('\n--- PASO 2: Eliminando Foreign Keys antiguas basadas en integer ID ---');
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

  console.log('\n--- PASO 3: Cambiando Primary Key a UUID en todas las tablas ---');
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
    console.log(`Tabla ${table}: Primary Key ahora es UUID.`);
  }

  console.log('\n--- PASO 4: Creando nuevas Foreign Keys oficiales basadas 100% en UUID ---');

  const newFkDefinitions = [
    { table: 'departamentos', col: 'sala_uuid', parent: 'salas', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'areas', col: 'departamento_uuid', parent: 'departamentos', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'cargos', col: 'area_uuid', parent: 'areas', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'empleados', col: 'cargo_uuid', parent: 'cargos', parentCol: 'uuid', onDel: 'SET NULL' },
    { table: 'dispositivos', col: 'sala_uuid', parent: 'salas', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'attlogs', col: 'dispositivo_uuid', parent: 'dispositivos', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'clientes', col: 'sala_uuid', parent: 'salas', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'clientes', col: 'tipo_cliente_uuid', parent: 'tipo_clientes', parentCol: 'uuid', onDel: 'SET NULL' },
    { table: 'libros', col: 'sala_uuid', parent: 'salas', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'libro_control_clientes', col: 'libro_uuid', parent: 'libros', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'libro_control_clientes', col: 'cliente_uuid', parent: 'clientes', parentCol: 'uuid', onDel: 'SET NULL' },
    { table: 'libro_control_clientes', col: 'metodo_pago_uuid', parent: 'metodos_pago', parentCol: 'uuid', onDel: 'SET NULL' },
    { table: 'libro_aportes', col: 'libro_uuid', parent: 'libros', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'libro_aportes', col: 'empleado_uuid', parent: 'empleados', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'libro_aportes', col: 'rango_uuid', parent: 'rangos', parentCol: 'uuid', onDel: 'SET NULL' },
    { table: 'libro_control_llaves', col: 'libro_uuid', parent: 'libros', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'libro_datos', col: 'libro_uuid', parent: 'libros', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'libro_drop_mesas', col: 'libro_uuid', parent: 'libros', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'libro_drop_mesas', col: 'mesa_uuid', parent: 'mesas', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'libro_incidencias_generales', col: 'libro_uuid', parent: 'libros', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'libro_incidencias_generales', col: 'tipo_incidencia_uuid', parent: 'tipo_incidencias', parentCol: 'uuid', onDel: 'SET NULL' },
    { table: 'libro_novedades_mesas', col: 'libro_uuid', parent: 'libros', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'libro_novedades_mesas', col: 'mesa_uuid', parent: 'mesas', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'libro_reporte', col: 'libro_uuid', parent: 'libros', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'llaves', col: 'sala_uuid', parent: 'salas', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'mesas', col: 'sala_uuid', parent: 'salas', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'mesas', col: 'juego_uuid', parent: 'juegos', parentCol: 'uuid', onDel: 'SET NULL' },
    { table: 'modelos', col: 'marca_uuid', parent: 'marcas', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'modulos', col: 'page_uuid', parent: 'paginas', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'feriados', col: 'sala_uuid', parent: 'salas', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'maquinas', col: 'sala_uuid', parent: 'salas', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'user_salas', col: 'user_uuid', parent: 'usuarios', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'user_salas', col: 'sala_uuid', parent: 'salas', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'user_module_permissions', col: 'user_uuid', parent: 'usuarios', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'user_module_permissions', col: 'module_uuid', parent: 'modulos', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'user_module_permissions', col: 'permission_uuid', parent: 'permissions', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'fcm_tokens', col: 'user_uuid', parent: 'usuarios', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'empleado_dispositivos', col: 'empleado_uuid', parent: 'empleados', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'empleado_dispositivos', col: 'dispositivo_uuid', parent: 'dispositivos', parentCol: 'uuid', onDel: 'CASCADE' },
    { table: 'salas', col: 'grupo_uuid', parent: 'grupo_salas', parentCol: 'uuid', onDel: 'SET NULL' }
  ];

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
    console.log(`Nueva FK UUID creada: ${fk.table}.${fk.col} -> ${fk.parent}.${fk.parentCol}`);
  }

  console.log('\nTransición a Primary Keys y Foreign Keys 100% UUID completada con éxito.');
  await sql.end();
}

main().catch(err => {
  console.error('Error durante la transición:', err);
  process.exit(1);
});
