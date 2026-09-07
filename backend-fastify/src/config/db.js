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

    // Probar conexión y fijar zona horaria
    await sql`SET TIME ZONE 'UTC';`;
    await sql`SELECT 1;`;

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
