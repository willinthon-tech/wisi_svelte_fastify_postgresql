import { initDb, sql } from '../src/config/db.js';

async function main() {
  await initDb();
  console.log('Running migration: drop ip_remota from dispositivos...');
  
  // Verify columns before
  const beforeCols = await sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'dispositivos' 
    ORDER BY ordinal_position;
  `;
  console.log('Columns before:', beforeCols.map(c => c.column_name));

  // Drop ip_remota column
  await sql`ALTER TABLE dispositivos DROP COLUMN IF EXISTS ip_remota;`;
  console.log('Column ip_remota dropped successfully.');

  // Verify columns after
  const afterCols = await sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'dispositivos' 
    ORDER BY ordinal_position;
  `;
  console.log('Columns after:', afterCols.map(c => c.column_name));

  await sql.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
