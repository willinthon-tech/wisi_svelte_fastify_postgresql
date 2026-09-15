import fs from 'fs';

const schema = JSON.parse(fs.readFileSync('./backend-fastify/scripts/full_db_schema.json', 'utf8'));
const tables = process.argv.slice(2);

for (const t of tables) {
  if (schema[t]) {
    console.log(`\n=== TABLE: ${t} ===`);
    console.log(schema[t].map(c => `${c.col} (${c.type})`).join(', '));
  } else {
    console.log(`\n=== TABLE NOT FOUND: ${t} ===`);
  }
}
