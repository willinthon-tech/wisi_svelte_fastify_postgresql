import postgres from 'postgres';
const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function checkFkCols() {
  const cols = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name LIKE '%_id'
    ORDER BY table_name, column_name;
  `;

  console.log(`Total columnas *_id encontradas: ${cols.length}`);
  for (const c of cols) {
    const uuidColName = c.column_name.replace(/_id$/, '_uuid');
    const [hasUuid] = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${c.table_name} AND column_name = ${uuidColName};
    `;
    if (!hasUuid) {
      console.log(`[FALTA UUID] ${c.table_name}.${c.column_name} NO tiene ${uuidColName}!`);
    } else {
      console.log(`[OK] ${c.table_name}.${c.column_name} tiene ${uuidColName}`);
    }
  }
  await sql.end();
}

checkFkCols().catch(console.error);
