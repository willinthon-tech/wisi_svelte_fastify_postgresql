import fs from 'fs';

const content = fs.readFileSync('c:/new_wisi/backend-fastify/src/models/master.model.js', 'utf8');
const lines = content.split('\n');
console.log(`master.model.js total lines: ${lines.length}`);

let idMatches = 0;
let whereIdMatches = 0;
let selectIdMatches = 0;
let returningIdMatches = 0;

lines.forEach((line, idx) => {
  if (/WHERE\s+id\s*=/i.test(line)) {
    whereIdMatches++;
    if (whereIdMatches <= 15) console.log(`  [WHERE id =] L${idx + 1}: ${line.trim().substring(0, 100)}`);
  }
  if (/RETURNING\s+id\b/i.test(line)) {
    returningIdMatches++;
    if (returningIdMatches <= 15) console.log(`  [RETURNING id] L${idx + 1}: ${line.trim().substring(0, 100)}`);
  }
});

console.log(`\nSummary in master.model.js:`);
console.log(`WHERE id = matches: ${whereIdMatches}`);
console.log(`RETURNING id matches: ${returningIdMatches}`);
