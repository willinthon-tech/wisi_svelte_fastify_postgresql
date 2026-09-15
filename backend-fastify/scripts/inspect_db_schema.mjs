import postgres from 'postgres';

const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function main() {
  const cols = await sql`
    SELECT table_name, column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND (column_name = 'id' OR (column_name LIKE '%_id' AND column_name NOT LIKE '%uuid%'))
    ORDER BY table_name, column_name;
  `;
  console.log('Columns ending with _id or named id (should be empty):', cols.length);
  for (const c of cols) {
    console.log(`- ${c.table_name}.${c.column_name} (${c.data_type})`);
  }

  const pks = await sql`
    SELECT
      tc.table_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name;
  `;
  console.log('\nTotal Primary Keys:', pks.length);
  const nonUuidPks = pks.filter(p => p.column_name !== 'uuid');
  console.log('Non-uuid Primary Keys:', nonUuidPks);

  await sql.end();
}

main().catch(console.error);
