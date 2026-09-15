import fs from 'fs';

const content = fs.readFileSync('c:/new_wisi/backend-fastify/src/models/master.model.js', 'utf8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
  if (/WHERE\s+id\s*=|RETURNING\s+[^;]*\bid\b|SELECT\s+[^;]*\bid\b/i.test(line)) {
    if (!line.trim().startsWith('//')) {
      console.log(`L${idx + 1}: ${line.trim()}`);
    }
  }
});
