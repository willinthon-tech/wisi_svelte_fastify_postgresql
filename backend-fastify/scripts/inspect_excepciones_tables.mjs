import postgres from 'postgres';
const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function run() {
  const count1 = await sql`SELECT count(*) FROM excepciones_horarios`;
  const count2 = await sql`SELECT count(*) FROM empleados_excepciones_horarios`;
  console.log('excepciones_horarios count:', count1[0].count);
  console.log('empleados_excepciones_horarios count:', count2[0].count);
  await sql.end();
}
run().catch(console.error);
