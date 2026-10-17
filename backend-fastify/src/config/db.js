import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const PGHOST = process.env.PGHOST;
const PGPORT = process.env.PGPORT ? Number(process.env.PGPORT) : 5432;
const PGDATABASE = process.env.PGDATABASE;
const PGUSER = process.env.PGUSER;
const PGPASSWORD = process.env.PGPASSWORD;

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
    if (!PGHOST || !PGDATABASE || !PGUSER) {
      throw new Error('Variables de conexión a PostgreSQL (PGHOST, PGDATABASE, PGUSER) no están configuradas en .env');
    }

    sql = postgres({
      host: PGHOST,
      port: PGPORT,
      database: PGDATABASE,
      username: PGUSER,
      password: PGPASSWORD,
      connect_timeout: 15,
      max_lifetime: 600, // 10 minutos de vida útil máxima para reciclar conexiones
      idle_timeout: 10,  // Cierra conexiones inactivas suavemente
      max: Number(process.env.PGMAX_CONNECTIONS) || 25, // Soporta ráfagas concurrentes de clientes sin saturar PostgreSQL
      onnotice: () => { },
      parameters: {
        timezone: 'UTC'
      }
    });

    // Fijar zona horaria UTC y verificar conexión activa
    await sql`SET TIME ZONE 'UTC';`;
    await sql`SELECT 1;`;

    // Garantizar existencia de tabla de reportes compartibles de máquinas
    await sql`
      CREATE TABLE IF NOT EXISTS maquinas_reportes (
        uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subtipo VARCHAR(50) DEFAULT 'simple',
        filtros JSONB NOT NULL DEFAULT '{}'::jsonb,
        filtros_hash VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_maquinas_reportes_hash ON maquinas_reportes (filtros_hash);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_maquinas_reportes_uuid ON maquinas_reportes (uuid);`;

    // Garantizar tablas y columnas de auditoría CECOM IA
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS cecom_ia_eventos (
          uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          sala_uuid UUID NOT NULL,
          mesa_uuid UUID NOT NULL,
          camara_uuid UUID,
          juego_nombre VARCHAR(100),
          tipo_evento VARCHAR(50) NOT NULL,
          descripcion TEXT NOT NULL,
          foto TEXT DEFAULT NULL,
          metadata JSONB DEFAULT '{}',
          es_novedad BOOLEAN NOT NULL DEFAULT false,
          nivel_alerta VARCHAR(20) NOT NULL DEFAULT 'INFO',
          atendido BOOLEAN NOT NULL DEFAULT false,
          atendido_por VARCHAR(150),
          active INT NOT NULL DEFAULT 1,
          is_deleted BOOLEAN NOT NULL DEFAULT false,
          deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `;
      await sql`ALTER TABLE cecom_ia_eventos ADD COLUMN IF NOT EXISTS foto TEXT DEFAULT NULL;`;
      await sql`ALTER TABLE cecom_ia_eventos ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';`;
    } catch (eMig) {
      console.warn('Advertencia migrando cecom_ia_eventos:', eMig.message);
    }

    // Garantizar tablas para Sesiones y Mesas del Scoreboard de Baccarat (Estándar WISI: UUID PRIMARY KEY)
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS record_libro_score_baccarat (
          uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          sala_uuid VARCHAR(100) NOT NULL,
          fecha VARCHAR(50) NOT NULL,
          estado VARCHAR(20) DEFAULT 'abierta',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_record_baccarat_sala_uuid ON record_libro_score_baccarat (sala_uuid);`;
      await sql`CREATE INDEX IF NOT EXISTS idx_record_baccarat_fecha ON record_libro_score_baccarat (fecha);`;
      await sql`CREATE INDEX IF NOT EXISTS idx_record_baccarat_uuid ON record_libro_score_baccarat (uuid);`;

      await sql`
        CREATE TABLE IF NOT EXISTS record_libro_score_baccarat_mesa (
          uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          record_libro_score_baccarat_uuid UUID,
          mesa_uuid VARCHAR(100),
          shoe_number INTEGER DEFAULT 1,
          tie_mode VARCHAR(20) DEFAULT 'slash',
          history JSONB NOT NULL DEFAULT '[]'::jsonb,
          shoes JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `;

      // Migraciones seguras para migrar tablas previas hacia UUID PRIMARY KEY y estandarización a UUIDs
      try {
        await sql`ALTER TABLE record_libro_score_baccarat ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();`;
        await sql`ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();`;
        await sql`UPDATE record_libro_score_baccarat SET uuid = gen_random_uuid() WHERE uuid IS NULL;`;
        await sql`UPDATE record_libro_score_baccarat_mesa SET uuid = gen_random_uuid() WHERE uuid IS NULL;`;
        await sql`ALTER TABLE record_libro_score_baccarat_mesa DROP CONSTRAINT IF EXISTS record_libro_score_baccarat_mesa_pkey CASCADE;`;
        await sql`ALTER TABLE record_libro_score_baccarat DROP CONSTRAINT IF EXISTS record_libro_score_baccarat_pkey CASCADE;`;
        await sql`ALTER TABLE record_libro_score_baccarat DROP COLUMN IF EXISTS id CASCADE;`;
        await sql`ALTER TABLE record_libro_score_baccarat_mesa DROP COLUMN IF EXISTS id CASCADE;`;
        await sql`
          DO $$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'record_libro_score_baccarat_pkey') THEN
              ALTER TABLE record_libro_score_baccarat ADD PRIMARY KEY (uuid);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'record_libro_score_baccarat_mesa_pkey') THEN
              ALTER TABLE record_libro_score_baccarat_mesa ADD PRIMARY KEY (uuid);
            END IF;
          END $$;
        `;

        // Estandarizar sala_uuid y eliminar sala_id
        await sql`ALTER TABLE record_libro_score_baccarat ADD COLUMN IF NOT EXISTS sala_uuid VARCHAR(100);`;
        await sql`
          DO $$
          BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'record_libro_score_baccarat' AND column_name = 'sala_id') THEN
              UPDATE record_libro_score_baccarat SET sala_uuid = sala_id WHERE sala_uuid IS NULL;
              ALTER TABLE record_libro_score_baccarat DROP COLUMN IF EXISTS sala_id CASCADE;
            END IF;
          END $$;
        `;

        // Estandarizar record_libro_score_baccarat_uuid y mesa_uuid
        await sql`ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS record_libro_score_baccarat_uuid UUID;`;
        await sql`ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS mesa_uuid VARCHAR(100);`;
        await sql`ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS shoes JSONB NOT NULL DEFAULT '[]'::jsonb;`;
        await sql`ALTER TABLE record_libro_score_baccarat_mesa ADD COLUMN IF NOT EXISTS history JSONB NOT NULL DEFAULT '[]'::jsonb;`;

        await sql`
          DO $$
          BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'record_libro_score_baccarat_mesa' AND column_name = 'session_uuid') THEN
              UPDATE record_libro_score_baccarat_mesa
              SET record_libro_score_baccarat_uuid = session_uuid::uuid
              WHERE record_libro_score_baccarat_uuid IS NULL 
                AND session_uuid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'record_libro_score_baccarat_mesa' AND column_name = 'session_id') THEN
              UPDATE record_libro_score_baccarat_mesa
              SET record_libro_score_baccarat_uuid = session_id::uuid
              WHERE record_libro_score_baccarat_uuid IS NULL 
                AND session_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
            END IF;
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'record_libro_score_baccarat_mesa' AND column_name = 'mesa_id') THEN
              UPDATE record_libro_score_baccarat_mesa
              SET mesa_uuid = mesa_id
              WHERE mesa_uuid IS NULL;
            END IF;

            -- Eliminar columnas obsoletas
            ALTER TABLE record_libro_score_baccarat_mesa DROP COLUMN IF EXISTS session_id CASCADE;
            ALTER TABLE record_libro_score_baccarat_mesa DROP COLUMN IF EXISTS session_uuid CASCADE;
            ALTER TABLE record_libro_score_baccarat_mesa DROP COLUMN IF EXISTS mesa_id CASCADE;
          END $$;
        `;

        await sql`ALTER TABLE record_libro_score_baccarat_mesa DROP CONSTRAINT IF EXISTS uq_baccarat_mesa_session CASCADE;`;
        await sql`ALTER TABLE record_libro_score_baccarat_mesa DROP CONSTRAINT IF EXISTS uq_baccarat_mesa_uuid CASCADE;`;
        await sql`ALTER TABLE record_libro_score_baccarat_mesa ADD CONSTRAINT uq_baccarat_mesa_uuid UNIQUE (record_libro_score_baccarat_uuid, mesa_uuid);`;
      } catch (eAlt) {
        // Ignorar si ya fueron alteradas
      }
      await sql`CREATE INDEX IF NOT EXISTS idx_record_baccarat_m_sess_uuid ON record_libro_score_baccarat_mesa (record_libro_score_baccarat_uuid);`;
      await sql`CREATE INDEX IF NOT EXISTS idx_record_baccarat_m_mesa_uuid ON record_libro_score_baccarat_mesa (mesa_uuid);`;
      await sql`CREATE INDEX IF NOT EXISTS idx_record_baccarat_m_uuid ON record_libro_score_baccarat_mesa (uuid);`;
    } catch (eBacc) {
      console.warn('Advertencia migrando tablas baccarat:', eBacc.message);
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
