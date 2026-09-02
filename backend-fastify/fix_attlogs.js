import postgres from 'postgres';

const sql = postgres({
  host: 'localhost',
  port: 5432,
  database: 'wisi',
  username: 'postgres',
  password: '12345678'
});

async function main() {
  console.log("=== CORRIGIENDO MARCAJES CON HORA INFLADA EN POSTGRESQL ===");
  const result = await sql`
    UPDATE attlogs 
    SET event_time = created_at 
    WHERE event_time > created_at + interval '2 hours'
  `;
  console.log("Registros corregidos:", result.count);

  console.log("=== NUEVOS ULTIMOS 10 MARCAJES EN ATTLOGS ===");
  const rows = await sql`
    SELECT id, employee_no, nombre, 
           to_char(event_time AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD HH24:MI:SS') AS vet_event_time_str,
           to_char(created_at AT TIME ZONE 'America/Caracas', 'YYYY-MM-DD HH24:MI:SS') AS vet_created_str
    FROM attlogs 
    ORDER BY event_time DESC, id DESC
    LIMIT 10
  `;
  console.log(JSON.stringify(rows, null, 2));
  await sql.end();
}

main().catch(err => console.error(err));
