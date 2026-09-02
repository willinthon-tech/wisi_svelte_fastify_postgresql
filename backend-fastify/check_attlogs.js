import postgres from 'postgres';

const sql = postgres({
  host: 'localhost',
  port: 5432,
  database: 'wisi',
  username: 'postgres',
  password: '12345678'
});

async function main() {
  console.log("=== ULTIMOS 10 MARCAJES EN ATTLOGS ===");
  const rows = await sql`
    SELECT id, employee_no, nombre, event_time, 
           to_char(event_time, 'YYYY-MM-DD HH24:MI:SS') AS raw_event_time_str,
           to_char(event_time AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD HH24:MI:SS') AS vet_event_time_str,
           to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS raw_created_str,
           to_char(created_at AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD HH24:MI:SS') AS vet_created_str
    FROM attlogs 
    ORDER BY event_time DESC, id DESC
    LIMIT 10
  `;
  console.log(JSON.stringify(rows, null, 2));
  await sql.end();
}

main().catch(err => console.error(err));
