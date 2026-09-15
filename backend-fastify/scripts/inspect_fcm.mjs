import postgres from 'postgres';

async function main() {
  const sql = postgres('postgresql://root:S0p0rt3R0y4l-2025@localhost:5432/wisi');
  const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'fcm_tokens' ORDER BY ordinal_position`;
  console.log('fcm_tokens cols:', cols.map(c => c.column_name + ' (' + c.data_type + ')').join(', '));
  await sql.end();
}

main().catch(console.error);
