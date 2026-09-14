import postgres from 'postgres';

const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function main() {
  const orphans = await sql`SELECT * FROM empleado_dispositivos WHERE empleado_uuid IS NULL AND empleado_id IS NOT NULL`;
  console.log('Orphan rows in empleado_dispositivos:');
  console.log(orphans);

  if (orphans.length > 0) {
    const ids = orphans.map(o => o.empleado_id);
    const emps = await sql`SELECT id, uuid, nombre FROM empleados WHERE id = ANY(${ids})`;
    console.log('Matching empleados in DB:');
    console.log(emps);
    if (emps.length === 0) {
      console.log('The empleados with these IDs do not exist in empleados table (historical deleted records).');
      // Cleaning up phantom references
      await sql`DELETE FROM empleado_dispositivos WHERE empleado_uuid IS NULL AND empleado_id IS NOT NULL`;
      console.log('Cleaned up phantom deleted references in empleado_dispositivos.');
    }
  }

  await sql.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
