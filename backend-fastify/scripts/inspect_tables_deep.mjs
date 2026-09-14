import postgres from 'postgres';

const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function main() {
  const fks = await sql`
    SELECT
      tc.table_name AS from_table,
      kcu.column_name AS from_column,
      ccu.table_name AS to_table,
      ccu.column_name AS to_column
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name;
  `;

  console.log('--- ALL FOREIGN KEYS & TARGETS ---');
  for (const f of fks) {
    console.log(`${f.from_table}.${f.from_column} -> ${f.to_table}.${f.to_column}`);
  }

  const attlogsCols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'attlogs' ORDER BY ordinal_position`;
  console.log('\n--- ATTLOGS COLUMNS ---');
  attlogsCols.forEach(c => console.log(`  ${c.column_name}: ${c.data_type}`));

  const empDispCols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'empleado_dispositivos' ORDER BY ordinal_position`;
  console.log('\n--- EMPLEADO_DISPOSITIVOS COLUMNS ---');
  empDispCols.forEach(c => console.log(`  ${c.column_name}: ${c.data_type}`));

  await sql.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
