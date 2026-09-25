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
