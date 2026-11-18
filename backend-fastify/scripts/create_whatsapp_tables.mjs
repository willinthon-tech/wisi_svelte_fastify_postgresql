import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config({ path: 'backend-fastify/.env' });

const sql = postgres({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  database: process.env.PGDATABASE || 'wisi',
  username: process.env.PGUSER || 'root',
  password: process.env.PGPASSWORD || 'S0p0rt3R0y4l-2025'
});

async function run() {
  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_group_mappings (
      id SERIAL PRIMARY KEY,
      uuid UUID DEFAULT gen_random_uuid() UNIQUE,
      group_jid VARCHAR(100) NOT NULL UNIQUE,
      group_name VARCHAR(255),
      sala_uuid UUID,
      multisala_uuid UUID,
      modulo_destino VARCHAR(50) DEFAULT 'control_clientes',
      caja_default VARCHAR(50) DEFAULT 'Mesas',
      auto_reply BOOLEAN DEFAULT true,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS whatsapp_logs (
      id SERIAL PRIMARY KEY,
      uuid UUID DEFAULT gen_random_uuid() UNIQUE,
      group_jid VARCHAR(100),
      group_name VARCHAR(255),
      sender_jid VARCHAR(100),
      sender_name VARCHAR(255),
      raw_message TEXT,
      parsed_data JSONB,
      status VARCHAR(50),
      error_message TEXT,
      inserted_record_uuid UUID,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `;
  console.log('✅ Tablas whatsapp creadas con éxito');
  await sql.end();
}

run().catch(console.error);
