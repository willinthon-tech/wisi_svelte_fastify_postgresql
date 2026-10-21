import postgres from 'postgres';
const sql = postgres({
  host: 'localhost',
  port: 5432,
  database: 'wisi',
  username: 'root',
  password: 'S0p0rt3R0y4l-2025'
});
async function run() {
  const rows = await sql`SELECT uuid, fecha, created_at, sala_uuid FROM record_libro_score_baccarat ORDER BY fecha ASC, created_at ASC`;
  console.log('TOTAL SESSIONS IN PG:', rows.length);
  console.log(JSON.stringify(rows, null, 2));
  await sql.end();
}
run().catch(console.error);
