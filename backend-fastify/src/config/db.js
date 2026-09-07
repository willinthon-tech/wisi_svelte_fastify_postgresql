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
      connect_timeout: 5,
      max_lifetime: 60,
      idle_timeout: 10,
      max: 10,
      onnotice: () => { },
      parameters: {
        timezone: 'UTC'
      }
    });

    // Fijar zona horaria UTC
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
    `.catch(() => {});

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
    `.catch(() => {});

    // 4. Table user_salas
    await sql`
      CREATE TABLE IF NOT EXISTS user_salas (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        sala_id INTEGER REFERENCES salas(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `.catch(() => {});

    // 5. Table paginas
    await sql`
      CREATE TABLE IF NOT EXISTS paginas (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `.catch(() => {});

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
    `.catch(() => {});

    await sql`ALTER TABLE modulos ADD COLUMN IF NOT EXISTS orden INT DEFAULT 0;`.catch(() => {});

    // 7. Table permissions
    await sql`
      CREATE TABLE IF NOT EXISTS permissions (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `.catch(() => {});

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
    `.catch(() => {});

    // 9. Table dispositivos
    await sql`
      CREATE TABLE IF NOT EXISTS dispositivos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL,
        sala_id INTEGER REFERENCES salas(id) ON DELETE CASCADE,
        ip_local VARCHAR(50),
        ip_remota VARCHAR(50),
        ip_panel VARCHAR(50),
        usuario VARCHAR(50),
        clave VARCHAR(100),
        marcaje_inicio TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        marcaje_fin TIMESTAMP WITH TIME ZONE
      );
    `.catch(() => {});

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
    `.catch(() => {});

    // 11. Table configuracion
    await sql`
      CREATE TABLE IF NOT EXISTS configuracion (
        clave VARCHAR(100) PRIMARY KEY,
        valor TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `.catch(() => {});

    // 12. Table descargas
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
    `.catch(() => {});

    // 13. Table departamentos
    await sql`
      CREATE TABLE IF NOT EXISTS departamentos (
        id INT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        sala_id INT REFERENCES salas(id) ON DELETE SET NULL
      );
    `.catch(() => {});

    // 14. Table areas
    await sql`
      CREATE TABLE IF NOT EXISTS areas (
        id INT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        departamento_id INT REFERENCES departamentos(id) ON DELETE SET NULL
      );
    `.catch(() => {});

    // 15. Table cargos
    await sql`
      CREATE TABLE IF NOT EXISTS cargos (
        id INT PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        area_id INT REFERENCES areas(id) ON DELETE SET NULL
      );
    `.catch(() => {});

    // 16. Table empleados
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
        motivo_desincorporacion TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `.catch(() => {});

    await sql`ALTER TABLE empleados ADD COLUMN IF NOT EXISTS motivo_desincorporacion TEXT;`.catch(() => {});

    // 17. Table empleado_dispositivos
    await sql`
      CREATE TABLE IF NOT EXISTS empleado_dispositivos (
        id INT PRIMARY KEY,
        empleado_id INT NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
        dispositivo_id INT NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `.catch(() => {});

    // 18. Table horarios
    await sql`
      CREATE TABLE IF NOT EXISTS horarios (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        hora_entrada TIME,
        hora_salida TIME,
        color VARCHAR(30) DEFAULT '#3B82F6',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `.catch(() => {});

    // 19. Table empleados_horarios
    await sql`
      CREATE TABLE IF NOT EXISTS empleados_horarios (
        id SERIAL PRIMARY KEY,
        empleado_id INT NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
        horario_id INT NOT NULL REFERENCES horarios(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_emp_horario UNIQUE(empleado_id, horario_id)
      );
    `.catch(() => {});

    // 20. Table excepciones
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
    `.catch(() => {});

    // 21. Table fechas_patrias
    await sql`
      CREATE TABLE IF NOT EXISTS fechas_patrias (
        id SERIAL PRIMARY KEY,
        descripcion VARCHAR(255) NOT NULL,
        dia INT NOT NULL,
        mes INT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `.catch(() => {});

    // 22. Table empleados_excepciones_horarios
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
    `.catch(() => {});

    // 23. Table feriados
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
    `.catch(() => {});

    // 24. Table cortes
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
    `.catch(() => {});

    await sql`ALTER TABLE cortes ADD COLUMN IF NOT EXISTS visible BOOLEAN DEFAULT TRUE;`.catch(() => {});

    // 25. Table juegos (Mesas en vivo)
    await sql`
      CREATE TABLE IF NOT EXISTS juegos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        sala_id INT NOT NULL REFERENCES salas(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_juegos_nombre_sala UNIQUE (nombre, sala_id)
      );
    `.catch(() => {});
    await sql`CREATE INDEX IF NOT EXISTS idx_juegos_sala_id ON juegos(sala_id);`.catch(() => {});

    // 26. Table mesas (Mesas en vivo)
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
    `.catch(() => {});
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
    `.catch(() => {});

    await sql`
      CREATE TABLE IF NOT EXISTS sociedades (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `.catch(() => {});

    await sql`
      CREATE TABLE IF NOT EXISTS valores (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `.catch(() => {});

    await sql`
      CREATE TABLE IF NOT EXISTS juegos_maquinas (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `.catch(() => {});

    await sql`
      CREATE TABLE IF NOT EXISTS marcas (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `.catch(() => {});

    await sql`
      CREATE TABLE IF NOT EXISTS modelos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL,
        marca_id INT REFERENCES marcas(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_modelos_nombre_marca UNIQUE (nombre, marca_id)
      );
    `.catch(() => {});
    await sql`CREATE INDEX IF NOT EXISTS idx_modelos_marca_id ON modelos(marca_id);`.catch(() => {});

    await sql`
      CREATE TABLE IF NOT EXISTS tipos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `.catch(() => {});

    await sql`
      CREATE TABLE IF NOT EXISTS modos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `.catch(() => {});

    await sql`
      CREATE TABLE IF NOT EXISTS legal (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(150) NOT NULL UNIQUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `.catch(() => {});

    // Table wisi_items
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
    `.catch(() => {});

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
    `.catch(() => {});

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
