import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const PGHOST = process.env.PGHOST || 'localhost';
const PGPORT = process.env.PGPORT || 5432;
const PGDATABASE = process.env.PGDATABASE || 'wisi_db';
const PGUSER = process.env.PGUSER || 'postgres';
const PGPASSWORD = process.env.PGPASSWORD || 'postgres';

export let sql = null;
export let isPgConnected = false;

// Fallback in-memory storage Proxy para retrocompatibilidad con modelos existentes
export const inMemoryData = new Proxy({}, {
  get: (target, prop) => {
    if (!target[prop]) target[prop] = [];
    return target[prop];
  },
  set: (target, prop, value) => {
    target[prop] = value;
    return true;
  }
});

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

    // Fijar zona horaria UTC y verificar conexión activa
    await sql`SET TIME ZONE 'UTC';`;
    await sql`SELECT 1;`;

    // Ejecutar migraciones críticas de esquemas y tablas
    await ensureDatabaseSchema();

    isPgConnected = true;
    console.log(`\x1b[32m🟢 [CONECTADO]\x1b[0m Base de Datos: PostgreSQL | Host: ${PGHOST}:${PGPORT} | Base: ${PGDATABASE}`);
  } catch (err) {
    isPgConnected = false;
    console.error(`\x1b[31m🔴 [ERROR POSTGRESQL]\x1b[0m Falló la conexión a PostgreSQL (${PGHOST}:${PGPORT}/${PGDATABASE}):`, err.message);
  }
}

async function ensureDatabaseSchema() {
  if (!sql) return;
  try {
    // 1. Asegurar columna foto y descripcion en tabla clientes
    await sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS foto VARCHAR(255);`.catch(() => {});
    await sql`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS descripcion TEXT;`.catch(() => {});

    // 2. Tabla excepciones (Catálogo global)
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
    `.catch((e) => console.warn('[Migration] excepciones:', e.message));

    // Semillas base de excepciones
    await sql`
      INSERT INTO excepciones (codigo, descripcion, color, tipo) VALUES
      ('L', 'Día Libre', '#D9D9D9', 'Asignable'),
      ('P', 'Permiso Médico / Personal', '#3B82F6', 'Asignable'),
      ('R', 'Reposo Médico', '#EF4444', 'Asignable'),
      ('V', 'Vacaciones', '#10B981', 'Asignable'),
      ('F', 'Falta / Inasistencia', '#F59E0B', 'Asignable'),
      ('FER', 'Día Feriado', '#8B5CF6', 'Asignable')
      ON CONFLICT (codigo) DO UPDATE SET tipo = EXCLUDED.tipo;
    `.catch(() => {});

    // 3. Tabla fechas_patrias
    await sql`
      CREATE TABLE IF NOT EXISTS fechas_patrias (
        id SERIAL PRIMARY KEY,
        descripcion VARCHAR(255) NOT NULL,
        dia INT NOT NULL,
        mes INT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `.catch((e) => console.warn('[Migration] fechas_patrias:', e.message));

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
      ON CONFLICT DO NOTHING;
    `.catch(() => {});

    // 4. Migración plantillas_horarios -> horarios
    await sql`
      DO $$ 
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'plantillas_horarios') 
           AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'horarios') THEN
          ALTER TABLE plantillas_horarios RENAME TO horarios;
        ELSIF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'horarios') THEN
          CREATE TABLE horarios (
            id SERIAL PRIMARY KEY,
            nombre TEXT,
            sala_id INT,
            codigo TEXT,
            hora_entrada TIME WITHOUT TIME ZONE,
            hora_salida TIME WITHOUT TIME ZONE,
            hora_descanso_entrada TIME WITHOUT TIME ZONE,
            hora_descanso_salida TIME WITHOUT TIME ZONE,
            descanso_automatico TIME WITHOUT TIME ZONE,
            color TEXT,
            tipo TEXT,
            created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        END IF;
      END $$;
    `.catch((e) => console.warn('[Migration] plantillas_horarios -> horarios:', e.message));

    // 5. Migración empleados_plantillas_horarios -> empleados_horarios
    await sql`
      DO $$ 
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'empleados_plantillas_horarios') 
           AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'empleados_horarios') THEN
          ALTER TABLE empleados_plantillas_horarios RENAME TO empleados_horarios;
        ELSIF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'empleados_horarios') THEN
          CREATE TABLE empleados_horarios (
            id SERIAL PRIMARY KEY,
            empleado_id INT NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
            horario_id INT NOT NULL REFERENCES horarios(id) ON DELETE CASCADE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT uk_emp_horario UNIQUE(empleado_id, horario_id)
          );
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'empleados_horarios' AND column_name = 'plantilla_horario_id') THEN
          ALTER TABLE empleados_horarios RENAME COLUMN plantilla_horario_id TO horario_id;
        END IF;
      END $$;
    `.catch((e) => console.warn('[Migration] empleados_horarios:', e.message));

    // 6. Migración excepciones_horarios -> empleados_excepciones_horarios
    await sql`
      DO $$ 
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'excepciones_horarios') 
           AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'empleados_excepciones_horarios') THEN
          ALTER TABLE excepciones_horarios RENAME TO empleados_excepciones_horarios;
        ELSIF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'empleados_excepciones_horarios') THEN
          CREATE TABLE empleados_excepciones_horarios (
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
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'empleados_excepciones_horarios' AND column_name = 'plantilla_horario_id') THEN
          ALTER TABLE empleados_excepciones_horarios RENAME COLUMN plantilla_horario_id TO horario_id;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'empleados_excepciones_horarios' AND column_name = 'excepcion_id') THEN
          ALTER TABLE empleados_excepciones_horarios ADD COLUMN excepcion_id INT REFERENCES excepciones(id) ON DELETE CASCADE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'empleados_excepciones_horarios' AND column_name = 'es_libre') THEN
          ALTER TABLE empleados_excepciones_horarios ADD COLUMN es_libre BOOLEAN DEFAULT FALSE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'empleados_excepciones_horarios' AND column_name = 'observacion') THEN
          ALTER TABLE empleados_excepciones_horarios ADD COLUMN observacion TEXT;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uk_emp_fecha_excepcion') THEN
          ALTER TABLE empleados_excepciones_horarios ADD CONSTRAINT uk_emp_fecha_excepcion UNIQUE(empleado_id, fecha);
        END IF;
      END $$;
    `.catch((e) => console.warn('[Migration] empleados_excepciones_horarios:', e.message));

    // 7. Vistas de compatibilidad (retrocompatibilidad transparente)
    await sql`CREATE OR REPLACE VIEW plantillas_horarios AS SELECT * FROM horarios;`.catch(() => {});
    await sql`
      CREATE OR REPLACE VIEW empleados_plantillas_horarios AS 
      SELECT id, empleado_id, horario_id AS plantilla_horario_id, created_at, updated_at 
      FROM empleados_horarios;
    `.catch(() => {});
    await sql`
      CREATE OR REPLACE VIEW excepciones_horarios AS 
      SELECT id, empleado_id, fecha, horario_id AS plantilla_horario_id, excepcion_id, es_libre, observacion, created_at, updated_at 
      FROM empleados_excepciones_horarios;
    `.catch(() => {});
  } catch (err) {
    console.warn('[Migration] Error general en ensureDatabaseSchema:', err.message);
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
