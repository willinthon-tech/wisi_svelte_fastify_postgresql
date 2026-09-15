import postgres from 'postgres';
const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function checkDualTriggers() {
  const trgs = await sql`
    SELECT trigger_name, event_object_table
    FROM information_schema.triggers
    WHERE trigger_name LIKE '%dual%' OR trigger_name LIKE '%sync%'
    ORDER BY event_object_table;
  `;
  console.log('--- TRIGGERS DUAL KEY A ELIMINAR ---');
  trgs.forEach(t => console.log(`${t.event_object_table}: ${t.trigger_name}`));
  await sql.end();
}

checkDualTriggers().catch(console.error);
