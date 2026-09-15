import postgres from 'postgres';
const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function checkAttlogs() {
  const [nullCount] = await sql`SELECT count(*) FROM attlogs WHERE dispositivo_uuid IS NULL`;
  console.log(`attlogs con dispositivo_uuid NULL: ${nullCount.count}`);
  const [totalCount] = await sql`SELECT count(*) FROM attlogs`;
  console.log(`attlogs total: ${totalCount.count}`);
  await sql.end();
}
checkAttlogs().catch(console.error);
