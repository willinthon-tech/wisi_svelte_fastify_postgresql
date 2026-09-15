import postgres from 'postgres';
const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function checkAllUniqueConstraints() {
  const constraints = await sql`
    SELECT tc.table_name, tc.constraint_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_schema = 'public' 
      AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
      AND (kcu.column_name = 'id' OR kcu.column_name LIKE '%_id')
    ORDER BY tc.table_name, tc.constraint_name;
  `;
  console.log('--- CONSTRAINTS INVOLVING id OR *_id ---');
  constraints.forEach(c => console.log(`${c.table_name}.${c.constraint_name} (${c.column_name})`));
  await sql.end();
}
checkAllUniqueConstraints().catch(console.error);
