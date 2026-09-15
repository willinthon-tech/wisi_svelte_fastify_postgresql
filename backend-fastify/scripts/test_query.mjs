import postgres from 'postgres';

const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function main() {
  const r = await sql`SELECT uuid, nombre FROM permissions`;
  console.log('permissions:', r);
  await sql.end();
}

main().catch(console.error);
