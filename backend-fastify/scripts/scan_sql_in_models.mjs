import fs from 'fs';
import path from 'path';

const files = [
  'c:/new_wisi/backend-fastify/src/models/auth.model.js',
  'c:/new_wisi/backend-fastify/src/models/health.model.js',
  'c:/new_wisi/backend-fastify/src/models/reports.model.js',
  'c:/new_wisi/backend-fastify/src/server.js'
];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  console.log(`=== ${path.basename(file)} ===`);
  lines.forEach((line, idx) => {
    if (/(\.id\b|['"`]id['"`]|\bid\b\s*=|WHERE\s+id\b|SELECT\s+[^;]*\bid\b|RETURNING\s+id)/i.test(line)) {
      if (!line.trim().startsWith('//')) {
        console.log(`  L${idx + 1}: ${line.trim().substring(0, 100)}`);
      }
    }
  });
}
