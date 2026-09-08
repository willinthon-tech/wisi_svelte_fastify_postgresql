import { initDb, sql } from '../src/config/db.js';

async function check() {
  await initDb();
  const tables = await sql`
    SELECT table_name 
    FROM information_schema.columns 
    WHERE column_name = 'denominacion_100'
  `;
  console.log('Tables with denominacion_100:', tables);

  const allTables = await sql`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
  `;
  console.log('All public tables:', allTables.map(t => t.table_name));
  process.exit(0);
}

check().catch(console.error);
