import postgres from 'postgres';
const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function checkTriggers() {
  const triggers = await sql`
    SELECT event_object_table, trigger_name
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
    ORDER BY event_object_table, trigger_name;
  `;
  console.log('--- TRIGGERS EN PUBLIC ---');
  triggers.forEach(t => console.log(`${t.event_object_table}: ${t.trigger_name}`));
  await sql.end();
}

checkTriggers().catch(console.error);
