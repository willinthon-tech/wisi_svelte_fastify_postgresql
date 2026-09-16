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
      connect_timeout: 15,
      max_lifetime: 1800, // 30 minutos de vida útil para evitar reconexiones continuas
      idle_timeout: 10,   // Cierra conexiones inactivas después de 10 segundos
      max: 50,            // Soporta hasta 50 conexiones concurrentes
      onnotice: () => { },
      parameters: {
        timezone: 'UTC'
      }
    });

    // Fijar zona horaria UTC y verificar conexión activa
    await sql`SET TIME ZONE 'UTC';`;
    await sql`SELECT 1;`;

    // Auto-curación de columnas y constraints críticas para evitar caídas en caliente
    try {
      await sql.unsafe(`
        DO $$
        BEGIN
          -- libro_control_llaves: llaves_uuids
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'libro_control_llaves') THEN
            ALTER TABLE libro_control_llaves ADD COLUMN IF NOT EXISTS llaves_uuids UUID[];
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'libro_control_llaves' AND column_name = 'llaves_ids') THEN
              ALTER TABLE libro_control_llaves ALTER COLUMN llaves_ids DROP NOT NULL;
              UPDATE libro_control_llaves cl
              SET llaves_uuids = (
                SELECT ARRAY_AGG(l.uuid) 
                FROM llaves l 
                WHERE l.id = ANY(cl.llaves_ids)
              )
              WHERE cl.llaves_ids IS NOT NULL AND cl.llaves_uuids IS NULL;
            END IF;
          END IF;

          -- cortes: salas_uuids
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'cortes') THEN
            ALTER TABLE cortes ADD COLUMN IF NOT EXISTS salas_uuids UUID[];
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cortes' AND column_name = 'salas_ids') THEN
              UPDATE cortes c
              SET salas_uuids = (
                SELECT ARRAY_AGG(s.uuid) 
                FROM salas s 
                WHERE s.id = ANY(c.salas_ids)
              )
              WHERE c.salas_ids IS NOT NULL AND c.salas_uuids IS NULL;
            END IF;
          END IF;

          -- libros: active
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'libros') THEN
            ALTER TABLE libros ADD COLUMN IF NOT EXISTS active INT DEFAULT 1;
          END IF;

          -- libro_datos: constraint UNIQUE en libro_uuid
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'libro_datos') THEN
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'libro_datos' AND column_name = 'libro_id') THEN
              ALTER TABLE libro_datos ALTER COLUMN libro_id DROP NOT NULL;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'libro_datos_libro_uuid_key') THEN
              BEGIN
                DELETE FROM libro_datos a USING libro_datos b WHERE a.ctid < b.ctid AND a.libro_uuid = b.libro_uuid;
                ALTER TABLE libro_datos ADD CONSTRAINT libro_datos_libro_uuid_key UNIQUE (libro_uuid);
              EXCEPTION WHEN OTHERS THEN NULL;
              END;
            END IF;
          END IF;

          -- libro_novedades_mesas: constraint UNIQUE en (libro_uuid, mesa_uuid)
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'libro_novedades_mesas') THEN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_libro_mesa_novedad_uuid') THEN
              BEGIN
                DELETE FROM libro_novedades_mesas a USING libro_novedades_mesas b WHERE a.ctid < b.ctid AND a.libro_uuid = b.libro_uuid AND a.mesa_uuid = b.mesa_uuid;
                ALTER TABLE libro_novedades_mesas ADD CONSTRAINT uq_libro_mesa_novedad_uuid UNIQUE (libro_uuid, mesa_uuid);
              EXCEPTION WHEN OTHERS THEN NULL;
              END;
            END IF;
          END IF;

          -- libro_reporte: constraint UNIQUE en libro_uuid
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'libro_reporte') THEN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_libro_reporte_libro_uuid') THEN
              BEGIN
                DELETE FROM libro_reporte a USING libro_reporte b WHERE a.ctid < b.ctid AND a.libro_uuid = b.libro_uuid;
                ALTER TABLE libro_reporte ADD CONSTRAINT uq_libro_reporte_libro_uuid UNIQUE (libro_uuid);
              EXCEPTION WHEN OTHERS THEN NULL;
              END;
            END IF;
          END IF;
        END $$;
      `);
    } catch (healErr) {
      console.warn('[DB AUTO-HEAL] Advertencia al verificar esquema:', healErr.message);
    }

    isPgConnected = true;
    console.log(`\x1b[32m[CONECTADO]\x1b[0m Base de Datos: PostgreSQL | Host: ${PGHOST}:${PGPORT} | Base: ${PGDATABASE}`);
  } catch (err) {
    isPgConnected = false;
    console.error(`\x1b[31m[ERROR POSTGRESQL]\x1b[0m Falló la conexión a PostgreSQL (${PGHOST}:${PGPORT}/${PGDATABASE}):`, err.message);
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
