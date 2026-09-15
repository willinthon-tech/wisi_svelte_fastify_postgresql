import postgres from 'postgres';
const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function checkHorarios() {
  const [ehNull] = await sql`SELECT count(*) FROM empleados_horarios WHERE empleado_uuid IS NULL OR horario_uuid IS NULL`;
  console.log(`empleados_horarios con UUIDs NULL: ${ehNull.count}`);
  const [ehTotal] = await sql`SELECT count(*) FROM empleados_horarios`;
  console.log(`empleados_horarios total: ${ehTotal.count}`);
  await sql.end();
}
checkHorarios().catch(console.error);
