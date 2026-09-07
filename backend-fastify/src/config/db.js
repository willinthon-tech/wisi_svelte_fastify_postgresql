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
    await sql`SET TIME ZONE 'UTC';`;
    await sql`SELECT 1;`;

    // =========================================================================
    // MIGRACIONES AUTOMÁTICAS DE RENOMBRADO DE TABLAS EN POSTGRESQL
    // =========================================================================
    
    // 1. Renombrar plantillas_horarios -> horarios
    await sql`
      DO $$ 
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plantillas_horarios') 
           AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'horarios') THEN
          ALTER TABLE plantillas_horarios RENAME TO horarios;
        END IF;
      END $$;
    `.catch((e) => console.warn('Migración plantillas_horarios -> horarios:', e.message));

    // 2. Renombrar empleados_plantillas_horarios -> empleados_horarios
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
    `.catch((e) => console.warn('Migración empleados_plantillas_horarios -> empleados_horarios:', e.message));

    // 3. Renombrar excepciones_horarios -> empleados_excepciones_horarios
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
    `.catch((e) => console.warn('Migración excepciones_horarios -> empleados_excepciones_horarios:', e.message));

    // 4. Garantizar estructura y columnas de empleados_excepciones_horarios
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

    await sql`ALTER TABLE empleados_excepciones_horarios ADD COLUMN IF NOT EXISTS horario_id INT REFERENCES horarios(id) ON DELETE CASCADE;`.catch(() => {});
    await sql`ALTER TABLE empleados_excepciones_horarios ADD COLUMN IF NOT EXISTS excepcion_id INT REFERENCES excepciones(id) ON DELETE CASCADE;`.catch(() => {});
    await sql`ALTER TABLE empleados_excepciones_horarios ADD COLUMN IF NOT EXISTS es_libre BOOLEAN DEFAULT FALSE;`.catch(() => {});
    await sql`ALTER TABLE empleados_excepciones_horarios ADD COLUMN IF NOT EXISTS observacion TEXT;`.catch(() => {});

    // 5. Actualizar módulo 29 a "Horarios" en PostgreSQL
    await sql`
      UPDATE modulos 
      SET nombre = 'Horarios', ruta = '/rrhh/horarios', icono = 'schedule' 
      WHERE id = 29 OR LOWER(nombre) IN ('plantillas', 'plantillas horarios', 'plantilla horarios');
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
