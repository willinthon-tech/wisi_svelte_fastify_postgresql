import postgres from 'postgres';

const sql = postgres('postgres://root:S0p0rt3R0y4l-2025@localhost:5432/wisi');

async function main() {
  const tables = ['libro_datos', 'libro_novedades_mesas', 'libro_reporte'];
  for (const t of tables) {
    const res = await sql`
      SELECT conname, contype, pg_get_constraintdef(oid) as def
      FROM pg_constraint 
      WHERE conrelid = ${t}::regclass
    `;
    console.log(`\n=== Constraints for ${t} ===`);
    console.log(res);

    const idxs = await sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = ${t}
    `;
    console.log(`=== Indexes for ${t} ===`);
    console.log(idxs);
  }
  await sql.end();
}

main().catch(console.error);
