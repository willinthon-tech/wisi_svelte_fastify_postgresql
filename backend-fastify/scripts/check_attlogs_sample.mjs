import postgres from 'postgres';

const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function main() {
  const sampleAttlogs = await sql`SELECT * FROM attlogs ORDER BY id DESC LIMIT 5`;
  console.log('Sample attlogs:');
  console.log(sampleAttlogs);

  const sampleEmp = await sql`SELECT id, uuid, nombre, cedula FROM empleados LIMIT 3`;
  console.log('Sample empleados:');
  console.log(sampleEmp);

  await sql.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
