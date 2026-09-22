import { sql, initDb } from '../src/config/db.js';

async function run() {
  try {
    await initDb();
    const tablesWithId = await sql`
      SELECT 
        table_schema,
        table_name, 
        column_name, 
        data_type,
        is_nullable
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
        AND column_name = 'id'
      ORDER BY table_name;
    `;
    console.log('--- TABLAS CON CAMPO ID EN LOCAL ---');
    console.log(JSON.stringify(tablesWithId, null, 2));

    const allTables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;
    console.log('--- TOTAL TABLAS EN BASE DE DATOS: ' + allTables.length + ' ---');

    // Also check for any table that has foreign keys referencing table(id)
    const fksToId = await sql`
      SELECT
        tc.table_name, 
        kcu.column_name, 
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name 
      FROM 
        information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.column_name = 'id'
      ORDER BY foreign_table_name, tc.table_name;
    `;
    console.log('--- FKs QUE APUNTAN A CAMPO ID ---');
    console.log(JSON.stringify(fksToId, null, 2));

  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
}

run();
