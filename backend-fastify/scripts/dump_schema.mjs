import postgres from 'postgres';
import fs from 'fs';

const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function main() {
  const cols = await sql`
    SELECT table_name, column_name, data_type, is_nullable
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    ORDER BY table_name, ordinal_position;
  `;
  const schema = {};
  for (const c of cols) {
    if (!schema[c.table_name]) schema[c.table_name] = [];
    schema[c.table_name].push({ col: c.column_name, type: c.data_type, null: c.is_nullable });
  }
  fs.writeFileSync('./backend-fastify/scripts/full_db_schema.json', JSON.stringify(schema, null, 2));
  console.log('Schema written to ./backend-fastify/scripts/full_db_schema.json');
  await sql.end();
}

main().catch(console.error);
