import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const PGHOST = process.env.PGHOST || 'localhost';
const PGPORT = process.env.PGPORT || 5432;
const PGDATABASE = process.env.PGDATABASE || 'wisi_db';
const PGUSER = process.env.PGUSER || 'postgres';
const PGPASSWORD = process.env.PGPASSWORD || 'postgres';

export let sql = null;
export let isPgConnected = false;

export async function initDb() {
  try {
    sql = postgres({
      host: PGHOST,
      port: Number(PGPORT),
      database: PGDATABASE,
      username: PGUSER,
      password: PGPASSWORD,
      connect_timeout: 3,
      max_lifetime: 60,
      idle_timeout: 10,
      max: 10,
      onnotice: () => { },
      parameters: {
        timezone: 'UTC'
      }
    });

    // Fijar zona horaria estricta en UTC (0)
    await sql`SET TIME ZONE 'UTC';`.catch(() => {});

    // 1. Table usuarios
    await sql`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre_apellido VARCHAR(255),
        usuario VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      INSERT INTO usuarios (id, nombre_apellido, usuario, password)
      VALUES (1, 'Willinthon Carriedo', 'willinthon', '12345678')
      ON CONFLICT (id) DO NOTHING;
    `.catch(() => {});

    // 2. Table grupo_salas
    await sql`
      CREATE TABLE IF NOT EXISTS grupo_salas (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL UNIQUE,
        descripcion TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 3. Table salas
    await sql`
      CREATE TABLE IF NOT EXISTS salas (
        id SERIAL PRIMARY KEY,
        grupo_id INTEGER REFERENCES grupo_salas(id) ON DELETE SET NULL,
        nombre VARCHAR(255) NOT NULL,
        nombre_comercial VARCHAR(255),
        rif VARCHAR(50),
        ubicacion TEXT,
        correo VARCHAR(100),
        telefono VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 4. Table user_salas
    await sql`
      CREATE TABLE IF NOT EXISTS user_salas (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        sala_id INTEGER REFERENCES salas(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 5. Table paginas
    await sql`
      CREATE TABLE IF NOT EXISTS paginas (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 6. Table modulos
    await sql`
      CREATE TABLE IF NOT EXISTS modulos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        icono VARCHAR(50) DEFAULT 'settings',
        ruta VARCHAR(255) NOT NULL,
        page_id INTEGER REFERENCES paginas(id) ON DELETE CASCADE,
        orden INT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      ALTER TABLE modulos ADD COLUMN IF NOT EXISTS orden INT DEFAULT 0;
    `;

    // 7. Table permissions
    await sql`
      CREATE TABLE IF NOT EXISTS permissions (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 8. Table user_module_permissions
    await sql`
      CREATE TABLE IF NOT EXISTS user_module_permissions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        module_id INTEGER REFERENCES modulos(id) ON DELETE CASCADE,
        permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_user_module_perm UNIQUE (user_id, module_id, permission_id)
      );
    `;

    // 10. Table attlogs
    await sql`
      CREATE TABLE IF NOT EXISTS attlogs (
        id SERIAL PRIMARY KEY,
        dispositivo_id INTEGER REFERENCES dispositivos(id) ON DELETE CASCADE,
        employee_no VARCHAR(100) NOT NULL,
        event_time TIMESTAMP WITH TIME ZONE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        nombre VARCHAR(255),
        attendancestatus VARCHAR(100),
        currentverifymode VARCHAR(100),
        has_photo BOOLEAN DEFAULT FALSE,
        CONSTRAINT uk_attlog_record UNIQUE (dispositivo_id, employee_no, event_time)
      );
    `;

    // 11. Table configuracion
    await sql`
      CREATE TABLE IF NOT EXISTS configuracion (
        clave VARCHAR(100) PRIMARY KEY,
        valor TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      INSERT INTO configuracion (clave, valor)
      VALUES 
        ('timezone', 'America/Caracas'),
        ('timezone_offset', '-4'),
        ('timezone_display', 'America/Caracas -4')
      ON CONFLICT (clave) DO NOTHING;
    `;

    // 11.1 Table descargas
    await sql`
      CREATE TABLE IF NOT EXISTS descargas (
        id SERIAL PRIMARY KEY,
        plataforma VARCHAR(50) NOT NULL,
        formato VARCHAR(20) NOT NULL,
        archivo VARCHAR(255) NOT NULL,
        peso VARCHAR(50) NOT NULL,
        peso_bytes BIGINT NOT NULL DEFAULT 0,
        version_num INTEGER NOT NULL DEFAULT 1,
        fecha TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    try {
      const existingDescargas = await sql`SELECT count(*)::int as count FROM descargas`;
      if (existingDescargas[0]?.count === 0) {
        await sql`
          INSERT INTO descargas (id, plataforma, formato, archivo, peso, peso_bytes, version_num, fecha)
          VALUES 
            (1, 'android', 'apk', 'app-wisi-android-v1-c1.apk', '6.5 MB', 6574550, 1, CURRENT_TIMESTAMP),
            (2, 'windows', 'exe', 'app-wisi-windows-v1-c2.exe', '2.3 MB', 2379534, 1, CURRENT_TIMESTAMP)
          ON CONFLICT (id) DO NOTHING;
        `;
        await sql`SELECT setval('descargas_id_seq', (SELECT COALESCE(MAX(id), 1) FROM descargas));`.catch(() => {});
      }
    } catch (e) {
      console.warn('Error checking or seeding descargas:', e);
    }

    // 12. Table departamentos
    await sql`
      CREATE TABLE IF NOT EXISTS departamentos (
        id INT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        sala_id INT REFERENCES salas(id) ON DELETE SET NULL
      );
    `;

    // 13. Table areas
    await sql`
      CREATE TABLE IF NOT EXISTS areas (
        id INT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        departamento_id INT REFERENCES departamentos(id) ON DELETE SET NULL
      );
    `;

    // 14. Table cargos
    await sql`
      CREATE TABLE IF NOT EXISTS cargos (
        id INT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        area_id INT REFERENCES areas(id) ON DELETE SET NULL
      );
    `;

    // 15. Table empleados
    await sql`
      CREATE TABLE IF NOT EXISTS empleados (
        id INT PRIMARY KEY,
        foto TEXT,
        nombre VARCHAR(255) NOT NULL,
        cedula VARCHAR(255) NOT NULL,
        fecha_ingreso DATE,
        fecha_nacimiento DATE,
        sexo VARCHAR(50),
        cargo_id INT REFERENCES cargos(id) ON DELETE SET NULL,
        activo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Auto-rename legacy column fecha_cumpleanos to fecha_nacimiento if present
    try {
      await sql.unsafe(`ALTER TABLE empleados RENAME COLUMN fecha_cumpleanos TO fecha_nacimiento;
    ALTER TABLE empleados ADD COLUMN IF NOT EXISTS motivo_desincorporacion TEXT;`);
    } catch (e) {
      // Column already renamed or table new, ignore
    }

    // 16. Table empleado_dispositivos (Relación Empleado <-> Dispositivos para Permisos de Marcaje)
    await sql`
      CREATE TABLE IF NOT EXISTS empleado_dispositivos (
        id INT PRIMARY KEY,
        empleado_id INT NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
        dispositivo_id INT NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 17. Table empleados_horarios (Direct assignment of shift horarios to employees)
    await sql`
      CREATE TABLE IF NOT EXISTS empleados_horarios (
        id SERIAL PRIMARY KEY,
        empleado_id INT NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
        horario_id INT NOT NULL REFERENCES horarios(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_emp_horario UNIQUE(empleado_id, horario_id)
      );
    `;

    // 18. Table empleados_excepciones_horarios (Shift exception overrides by employee and date)
    await sql`
      CREATE TABLE IF NOT EXISTS empleados_excepciones_horarios (
        id SERIAL PRIMARY KEY,
        empleado_id INT NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
        fecha DATE NOT NULL,
        horario_id INT REFERENCES horarios(id) ON DELETE CASCADE,
        excepcion_id INT REFERENCES excepciones(id) ON DELETE CASCADE,
        es_libre BOOLEAN DEFAULT FALSE,
        observacion TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_emp_fecha_excepcion UNIQUE(empleado_id, fecha)
      );
    `;
    await sql`ALTER TABLE empleados_excepciones_horarios ADD COLUMN IF NOT EXISTS excepcion_id INT REFERENCES excepciones(id) ON DELETE CASCADE;`.catch(() => {});
    await sql`ALTER TABLE empleados_excepciones_horarios ADD COLUMN IF NOT EXISTS horario_id INT REFERENCES horarios(id) ON DELETE CASCADE;`.catch(() => {});

    // 19. Table feriados (Fechas patrias y días feriados por sala y nacionales)
    await sql`
      CREATE TABLE IF NOT EXISTS feriados (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        sala_id INT REFERENCES salas(id) ON DELETE CASCADE,
        mes INT NOT NULL,
        dia INT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 20. Table cortes (Históricos de cortes de asistencia congelados con snapshot JSON completo)
    await sql`
      CREATE TABLE IF NOT EXISTS cortes (
        id SERIAL PRIMARY KEY,
        sala_id INT REFERENCES salas(id) ON DELETE SET NULL,
        sala_nombre VARCHAR(255),
        fecha_desde DATE NOT NULL,
        fecha_hasta DATE NOT NULL,
        total_empleados INT DEFAULT 0,
        data JSONB,
        visible BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      ALTER TABLE cortes ADD COLUMN IF NOT EXISTS visible BOOLEAN DEFAULT TRUE;
    `.catch(() => {});

    await sql`
      ALTER TABLE cortes DROP COLUMN IF EXISTS titulo;
    `.catch(() => {});


    // Registrar módulo 36 Cortes
    await sql`
      INSERT INTO modulos (id, nombre, icono, ruta, page_id, orden) VALUES
      (36, 'Cortes', 'receipt_long', '/rrhh/cortes', 2, 28)
      ON CONFLICT (id) DO UPDATE SET nombre = 'Cortes', ruta = '/rrhh/cortes';
    `.catch(() => {});

    // Limpiar posibles duplicados anteriores del módulo Cortes
    await sql`
      DELETE FROM modulos 
      WHERE (LOWER(nombre) = 'cortes' OR ruta = '/rrhh/cortes') AND id != 36;
    `.catch(() => {});

    // Asignar permisos completos de Cortes al usuario 1
    await sql`
      INSERT INTO user_module_permissions (user_id, module_id, permission_id) VALUES
      (1, 36, 1), (1, 36, 2), (1, 36, 3), (1, 36, 4), (1, 36, 5)
      ON CONFLICT (user_id, module_id, permission_id) DO NOTHING;
    `.catch(() => {});

    // Actualizar nombre y ruta de módulo 31 a Calendario
    await sql`
      UPDATE modulos 
      SET nombre = 'Calendario', ruta = '/rrhh/calendario' 
      WHERE id = 31 OR LOWER(nombre) = 'feriados';
    `.catch(() => {});

    // Sembrar fechas patrias iniciales si la tabla feriados está vacía
    const feriadosCountRes = await sql`SELECT count(*)::int as count FROM feriados`.catch(() => [{ count: 0 }]);
    if (feriadosCountRes[0]?.count === 0) {
      await sql`
        INSERT INTO feriados (id, nombre, sala_id, mes, dia) VALUES
        (22, 'Fundación de Porlamar', 4, 3, 26),
        (23, 'Día de la Independencia de Margarita.', 4, 5, 4),
        (24, 'Natalicio de Santiago Mariño', 4, 7, 25),
        (25, 'Batalla de Matasiete', 4, 7, 31),
        (26, 'Día de la Asunción de la Virgen, patrona de la Diócesis de Margarita', 4, 8, 15),
        (27, 'Día de la Virgen del Valle, Patrona del Oriente venezolano', 4, 9, 8),
        (30, 'Lunes de Carnaval', 6, 2, 16),
        (31, 'Martes de Carnaval', 6, 2, 17),
        (32, 'Jueves Santo', 6, 4, 2),
        (33, 'Viernes Santo', 6, 4, 3),
        (34, 'Viernes Santo', 6, 4, 3),
        (35, 'BATALLA DE SAN FELIX', 2, 4, 11),
        (36, 'LUNES DE CARNAVAL', 1, 2, 16),
        (37, 'MARTES DE CARNAVAL', 1, 2, 17),
        (38, 'JUVES SANTO', 1, 4, 2),
        (39, 'VIERNES SANTO', 1, 4, 3),
        (40, 'LUNES DE CARNAVAL', 2, 2, 16),
        (41, 'MARTES DE CARNAVAL', 2, 2, 17),
        (42, 'DIA DE JUBILO NACIONAL PROVICIONAL', 1, 3, 18),
        (43, 'Jueves santo', 2, 4, 2),
        (44, 'Viernes santo', 2, 4, 3),
        (45, 'DECRETO REGIONAL MARINOS DE ANZOATEGUI', 3, 6, 19)
        ON CONFLICT (id) DO NOTHING;
      `.catch((e) => console.warn('Error sembrando feriados iniciales:', e));
      await sql`SELECT setval('feriados_id_seq', (SELECT COALESCE(MAX(id), 1) FROM feriados));`.catch(() => {});
    }

    // 21. Table juegos (Juegos de Mesas en vivo)
    await sql`
      CREATE TABLE IF NOT EXISTS juegos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        sala_id INT NOT NULL REFERENCES salas(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_juegos_nombre_sala UNIQUE (nombre, sala_id)
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_juegos_sala_id ON juegos(sala_id);`.catch(() => {});

    // 22. Table mesas (Mesas en vivo)
    await sql`
      CREATE TABLE IF NOT EXISTS mesas (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        juego_id INT NOT NULL REFERENCES juegos(id) ON DELETE CASCADE,
        active SMALLINT DEFAULT 1,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_mesas_nombre_juego UNIQUE (nombre, juego_id)
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_mesas_juego_id ON mesas(juego_id);`.catch(() => {});
    await sql`CREATE INDEX IF NOT EXISTS idx_mesas_active ON mesas(active);`.catch(() => {});

    // Tablas de Configuración de Máquinas
    await sql`
      CREATE TABLE IF NOT EXISTS estados (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS sociedades (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS valores (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS juegos_maquinas (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS marcas (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS modelos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL,
        marca_id INT REFERENCES marcas(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_modelos_nombre_marca UNIQUE (nombre, marca_id)
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_modelos_marca_id ON modelos(marca_id);`.catch(() => {});

    await sql`
      CREATE TABLE IF NOT EXISTS tipos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS modos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS legal (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS excepciones (
        id SERIAL PRIMARY KEY,
        codigo VARCHAR(50) NOT NULL UNIQUE,
        descripcion VARCHAR(255) NOT NULL,
        color VARCHAR(30) DEFAULT '#3B82F6',
        tipo VARCHAR(50) NOT NULL DEFAULT 'Asignable',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS fechas_patrias (
        id SERIAL PRIMARY KEY,
        descripcion VARCHAR(255) NOT NULL,
        dia INT NOT NULL,
        mes INT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Existing wisi_items table
    await sql`
      CREATE TABLE IF NOT EXISTS wisi_items (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(50) DEFAULT 'General',
        priority VARCHAR(20) DEFAULT 'Medium',
        completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Seed page 10 and modules 37 & 38 if not present
    await sql`
      INSERT INTO paginas (id, nombre) VALUES
      (10, 'CONF.M: RRHH')
      ON CONFLICT DO NOTHING;
    `;
    await sql`
      INSERT INTO modulos (id, nombre, icono, ruta, page_id) VALUES
      (37, 'Excepciones', 'settings', '/configuracion/excepciones', 10),
      (38, 'Fechas Patrias', 'settings', '/configuracion/fechas-patrias', 10)
      ON CONFLICT DO NOTHING;
    `;
    await sql`
      INSERT INTO user_module_permissions (user_id, module_id, permission_id) VALUES
      (1, 37, 1), (1, 37, 2), (1, 37, 3), (1, 37, 4), (1, 37, 5),
      (1, 38, 1), (1, 38, 2), (1, 38, 3), (1, 38, 4), (1, 38, 5)
      ON CONFLICT DO NOTHING;
    `;

    // Rename Module 29 to Horarios and update route
    await sql`
      UPDATE modulos 
      SET nombre = 'Horarios', ruta = '/rrhh/horarios', icono = 'schedule' 
      WHERE id = 29;
    `.catch(() => {});

    // MIGRACIONES DE RENOMBRADO DE TABLAS
    // 1. plantillas_horarios -> horarios
    await sql`
      DO $$ 
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plantillas_horarios') 
           AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'horarios') THEN
          ALTER TABLE plantillas_horarios RENAME TO horarios;
        END IF;
      END $$;
    `.catch((e) => console.warn('Migration plantillas_horarios -> horarios:', e.message));

    // 2. empleados_plantillas_horarios -> empleados_horarios
    await sql`
      DO $$ 
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'empleados_plantillas_horarios') 
           AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'empleados_horarios') THEN
          ALTER TABLE empleados_plantillas_horarios RENAME TO empleados_horarios;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'empleados_horarios' AND column_name = 'plantilla_horario_id') THEN
          ALTER TABLE empleados_horarios RENAME COLUMN plantilla_horario_id TO horario_id;
        END IF;
      END $$;
    `.catch((e) => console.warn('Migration empleados_plantillas_horarios -> empleados_horarios:', e.message));

    // 3. excepciones_horarios -> empleados_excepciones_horarios
    await sql`
      DO $$ 
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'excepciones_horarios') 
           AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'empleados_excepciones_horarios') THEN
          ALTER TABLE excepciones_horarios RENAME TO empleados_excepciones_horarios;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'empleados_excepciones_horarios' AND column_name = 'plantilla_horario_id') THEN
          ALTER TABLE empleados_excepciones_horarios RENAME COLUMN plantilla_horario_id TO horario_id;
        END IF;
      END $$;
    `.catch((e) => console.warn('Migration excepciones_horarios -> empleados_excepciones_horarios:', e.message));

    // Clean up non-work-shift exception templates from horarios table
    await sql`
      DELETE FROM horarios 
      WHERE hora_entrada IS NULL 
         OR hora_salida IS NULL 
         OR codigo IN ('L', 'U') 
         OR LOWER(nombre) LIKE '%libre%'
         OR LOWER(COALESCE(tipo, '')) = 'plantilla';
    `.catch(() => {});
    await sql`
      DELETE FROM plantillas_horarios 
      WHERE hora_entrada IS NULL 
         OR hora_salida IS NULL 
         OR codigo IN ('L', 'U') 
         OR LOWER(nombre) LIKE '%libre%'
         OR LOWER(COALESCE(tipo, '')) = 'plantilla';
    `.catch(() => {});

    // 1. Deduplicate and enforce unique (dia, mes) on fechas_patrias
    await sql`
      DELETE FROM fechas_patrias a USING fechas_patrias b
      WHERE a.id > b.id AND a.dia = b.dia AND a.mes = b.mes;
    `.catch(() => {});
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_fechas_patrias_dia_mes ON fechas_patrias (dia, mes);
    `.catch(() => {});

    // 2. Deduplicate and enforce unique codigo on excepciones
    await sql`
      DELETE FROM excepciones a USING excepciones b
      WHERE a.id > b.id AND LOWER(TRIM(a.codigo)) = LOWER(TRIM(b.codigo));
    `.catch(() => {});
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_excepciones_codigo ON excepciones (LOWER(TRIM(codigo)));
    `.catch(() => {});

    // 3. Deduplicate and enforce unique (sala_id, dia, mes) on feriados / calendario
    await sql`
      DELETE FROM feriados a USING feriados b
      WHERE a.id > b.id AND a.sala_id = b.sala_id AND a.dia = b.dia AND a.mes = b.mes;
    `.catch(() => {});
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_feriados_sala_dia_mes ON feriados (sala_id, dia, mes);
    `.catch(() => {});

    // Seed default base excepciones and fechas_patrias into PostgreSQL
    await sql`
      INSERT INTO excepciones (codigo, descripcion, color, tipo) VALUES
      ('L', 'Día Libre', '#D9D9D9', 'Asignable'),
      ('P', 'Permiso Médico / Personal', '#3B82F6', 'Asignable'),
      ('R', 'Reposo Médico', '#EF4444', 'Asignable'),
      ('V', 'Vacaciones', '#10B981', 'Asignable'),
      ('F', 'Falta / Inasistencia', '#F59E0B', 'Asignable'),
      ('FER', 'Día Feriado', '#8B5CF6', 'Asignable'),
      ('U', 'Horario Único', '#86EFAC', 'No Asignable')
      ON CONFLICT (codigo) DO UPDATE SET
        tipo = EXCLUDED.tipo,
        descripcion = EXCLUDED.descripcion,
        color = EXCLUDED.color;
    `;

    await sql`
      INSERT INTO fechas_patrias (descripcion, dia, mes) VALUES
      ('Año Nuevo', 1, 1),
      ('Declaración de la Independencia', 19, 4),
      ('Día del Trabajador', 1, 5),
      ('Batalla de Carabobo', 24, 6),
      ('Día de la Independencia', 5, 7),
      ('Natalicio del Libertador Simón Bolívar', 24, 7),
      ('Día de la Resistencia Indígena', 12, 10),
      ('Víspera de Navidad', 24, 12),
      ('Navidad', 25, 12),
      ('Fin de Año', 31, 12)
      ON CONFLICT (dia, mes) DO UPDATE SET
        descripcion = EXCLUDED.descripcion;
    `;

    // Table fcm_tokens
    await sql`
      CREATE TABLE IF NOT EXISTS fcm_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        token TEXT UNIQUE NOT NULL,
        platform VARCHAR(50) DEFAULT 'android',
        activo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `.catch(e => console.warn('Aviso creando tabla fcm_tokens:', e.message));

    isPgConnected = true;
    console.log(`\x1b[32m🟢 [CONECTADO]\x1b[0m Base de Datos: PostgreSQL | Host: ${PGHOST}:${PGPORT} | Base: ${PGDATABASE}`);
  } catch (err) {
    isPgConnected = false;
    console.error(`\x1b[31m🔴 [ERROR POSTGRESQL]\x1b[0m Falló la conexión a PostgreSQL (${PGHOST}:${PGPORT}/${PGDATABASE}):`, err.message);
  }
}

export function getDbStatus() {
  return {
    connected: isPgConnected,
    mode: isPgConnected ? 'PostgreSQL' : 'Desconectado',
    host: `${PGHOST}:${PGPORT}`,
    database: PGDATABASE
  };
}
