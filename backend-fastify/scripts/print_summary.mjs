import fs from 'fs';

const data = JSON.parse(fs.readFileSync('./backend-fastify/scripts/model_issues_by_fn.json', 'utf8'));
for (const [fn, info] of Object.entries(data)) {
  console.log(`${fn.padEnd(38)} lines ${String(info.startLine).padStart(5)}-${String(info.endLine).padEnd(5)} (${info.count} issues)`);
}
