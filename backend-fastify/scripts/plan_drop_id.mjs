import postgres from 'postgres';
const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function planDrop() {
  const idCols = await sql`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'id'
    ORDER BY table_name;
  `;
  console.log(`Tablas con columna 'id': ${idCols.length}`);

  const fkCols = await sql`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name LIKE '%_id' AND column_name != 'id'
    ORDER BY table_name, column_name;
  `;
  console.log(`Columnas fk *_id a eliminar: ${fkCols.length}`);
  fkCols.forEach(c => console.log(`  ${c.table_name}.${c.column_name}`));

  await sql.end();
}

planDrop().catch(console.error);
