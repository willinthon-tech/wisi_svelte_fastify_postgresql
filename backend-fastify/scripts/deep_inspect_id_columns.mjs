import postgres from 'postgres';
const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function inspect() {
  console.log('--- 1. COLUMNAS id y *_id ---');
  const cols = await sql`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND (column_name = 'id' OR column_name LIKE '%_id')
    ORDER BY table_name, column_name;
  `;
  cols.forEach(c => console.log(`${c.table_name}.${c.column_name} (${c.data_type})`));

  console.log('\n--- 2. TRIGGERS Y FUNCIONES ---');
  const triggers = await sql`
    SELECT event_object_table, trigger_name, action_statement
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
    ORDER BY event_object_table, trigger_name;
  `;
  triggers.forEach(t => console.log(`${t.event_object_table}: ${t.trigger_name}`));

  await sql.end();
}

inspect().catch(console.error);
