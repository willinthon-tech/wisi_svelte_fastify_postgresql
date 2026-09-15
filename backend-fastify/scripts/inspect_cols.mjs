import postgres from 'postgres';

async function main() {
  const sql = postgres('postgresql://root:S0p0rt3R0y4l-2025@localhost:5432/wisi');
  const cons = await sql`
    SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE conrelid::regclass::text IN ('libro_reporte', 'libro_datos', 'libro_novedades_mesas')
  `;
  console.log(cons);
  await sql.end();
}

main().catch(console.error);
