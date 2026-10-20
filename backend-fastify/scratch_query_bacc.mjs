import postgres from 'postgres';
const sql = postgres({
  host: 'localhost',
  port: 5432,
  database: 'wisi',
  username: 'root',
  password: 'S0p0rt3R0y4l-2025'
});
async function run() {
  const rows = await sql`SELECT mesa_uuid, shoe_number, history FROM record_libro_score_baccarat_mesa ORDER BY updated_at DESC LIMIT 1`;
  console.log('Shoe number:', rows[0]?.shoe_number);
  const hist = rows[0]?.history;
  const parsed = typeof hist === 'string' ? JSON.parse(hist) : hist;
  console.log('History length:', parsed?.length);
  console.log('History winners:', JSON.stringify(parsed?.map(h => h.winner)));
  await sql.end();
}
run().catch(console.error);
