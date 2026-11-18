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
  const notNullsEmp = await sql`
    SELECT column_name, is_nullable, column_default 
    FROM information_schema.columns 
    WHERE table_name = 'empleados' AND is_nullable = 'NO'
  `;
  console.log('empleados NOT NULL columns:', notNullsEmp);
  await sql.end();
}

run().catch(console.error);
