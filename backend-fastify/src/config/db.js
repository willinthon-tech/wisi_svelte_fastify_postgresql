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
    // MIGRACIONES DE RENOMBRADO DEFINITIVO EN POSTGRESQL
    // =========================================================================
    
    // 1. Unificar y renombrar plantillas_horarios -> horarios
    await sql`
      DO $$ 
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plantillas_horarios') 
           AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'horarios') THEN
           
          INSERT INTO horarios (id, nombre, hora_entrada, hora_salida, color, created_at, updated_at)
          SELECT id, nombre, hora_entrada::time, hora_salida::time, color, created_at, updated_at 
          FROM plantillas_horarios 
          ON CONFLICT (id) DO NOTHING;

          PERFORM setval(pg_get_serial_sequence('horarios', 'id'), COALESCE(MAX(id), 1)) FROM horarios;
          DROP TABLE plantillas_horarios CASCADE;
        ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'plantillas_horarios') THEN
          ALTER TABLE plantillas_horarios RENAME TO horarios;
        END IF;
      END $$;
    `.catch((e) => console.warn('Migración plantillas_horarios -> horarios:', e.message));

    // 2. Unificar y renombrar empleados_plantillas_horarios -> empleados_horarios
    await sql`
      DO $$ 
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'empleados_plantillas_horarios') 
           AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'empleados_horarios') THEN
           
          INSERT INTO empleados_horarios (empleado_id, horario_id, created_at, updated_at)
          SELECT empleado_id, plantilla_horario_id, created_at, updated_at 
          FROM empleados_plantillas_horarios 
          ON CONFLICT DO NOTHING;

          DROP TABLE empleados_plantillas_horarios CASCADE;
        ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'empleados_plantillas_horarios') THEN
          ALTER TABLE empleados_plantillas_horarios RENAME TO empleados_horarios;
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'empleados_horarios' AND column_name = 'plantilla_horario_id') THEN
            ALTER TABLE empleados_horarios RENAME COLUMN plantilla_horario_id TO horario_id;
          END IF;
        END IF;
      END $$;
    `.catch((e) => console.warn('Migración empleados_plantillas_horarios -> empleados_horarios:', e.message));

    // 3. Unificar y renombrar excepciones_horarios -> empleados_excepciones_horarios
    await sql`
      DO $$ 
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'excepciones_horarios') 
           AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'empleados_excepciones_horarios') THEN
           
          INSERT INTO empleados_excepciones_horarios (empleado_id, fecha, horario_id, excepcion_id, es_libre, observacion, created_at, updated_at)
          SELECT empleado_id, fecha, plantilla_horario_id, NULL, COALESCE(es_libre, false), observacion, created_at, updated_at 
          FROM excepciones_horarios 
          ON CONFLICT (empleado_id, fecha) DO NOTHING;

          DROP TABLE excepciones_horarios CASCADE;
        ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'excepciones_horarios') THEN
          ALTER TABLE excepciones_horarios RENAME TO empleados_excepciones_horarios;
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'empleados_excepciones_horarios' AND column_name = 'plantilla_horario_id') THEN
            ALTER TABLE empleados_excepciones_horarios RENAME COLUMN plantilla_horario_id TO horario_id;
          END IF;
        END IF;
      END $$;
    `.catch((e) => console.warn('Migración excepciones_horarios -> empleados_excepciones_horarios:', e.message));

    // 4. Asegurar columnas en empleados_excepciones_horarios
    await sql`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'empleados_excepciones_horarios') THEN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'empleados_excepciones_horarios' AND column_name = 'horario_id') THEN
            ALTER TABLE empleados_excepciones_horarios ADD COLUMN horario_id INT REFERENCES horarios(id) ON DELETE CASCADE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'empleados_excepciones_horarios' AND column_name = 'excepcion_id') THEN
            ALTER TABLE empleados_excepciones_horarios ADD COLUMN excepcion_id INT REFERENCES excepciones(id) ON DELETE CASCADE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'empleados_excepciones_horarios' AND column_name = 'es_libre') THEN
            ALTER TABLE empleados_excepciones_horarios ADD COLUMN es_libre BOOLEAN DEFAULT FALSE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'empleados_excepciones_horarios' AND column_name = 'observacion') THEN
            ALTER TABLE empleados_excepciones_horarios ADD COLUMN observacion TEXT;
          END IF;
        END IF;
      END $$;
    `.catch(() => {});

    // 5. Actualizar módulo en la tabla modulos
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
