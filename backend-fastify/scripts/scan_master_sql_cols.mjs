import fs from 'fs';

const content = fs.readFileSync('c:/new_wisi/backend-fastify/src/models/master.model.js', 'utf8');
const lines = content.split('\n');

const sqlRegex = /sql`|sql\.unsafe\(/;
let inSql = false;
let sqlLines = [];

lines.forEach((line, idx) => {
  if (sqlRegex.test(line)) inSql = true;
  if (inSql) {
    sqlLines.push({ line: idx + 1, text: line });
    if (line.includes('`') && !line.includes('sql`')) inSql = false;
  }
});

console.log(`Total lines inside SQL template tags: ${sqlLines.length}`);
const idColsFound = new Set();
sqlLines.forEach(l => {
  const matches = l.text.match(/\b([a-zA-Z0-9_]+_id|id)\b/g);
  if (matches) {
    matches.forEach(m => {
      // Excluir palabras clave o variables js
      if (!['validIds', 'salaIds', 'assignedIds'].includes(m)) {
        idColsFound.add(m);
      }
    });
  }
});

console.log('Columns matching id or *_id found in SQL in master.model.js:');
console.log(Array.from(idColsFound).sort());
