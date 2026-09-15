import postgres from 'postgres';
const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function checkAttlogConstraints() {
  const constraints = await sql`
    SELECT conname, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE conrelid = 'attlogs'::regclass;
  `;
  console.log('--- ATTLOGS CONSTRAINTS ---');
  constraints.forEach(c => console.log(`${c.conname}: ${c.def}`));
  await sql.end();
}
checkAttlogConstraints().catch(console.error);
