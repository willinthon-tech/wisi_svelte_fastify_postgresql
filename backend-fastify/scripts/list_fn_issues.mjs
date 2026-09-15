import fs from 'fs';

import path from 'path';

const jsonPath = path.resolve('backend-fastify/scripts/model_issues_by_fn.json');
const issues = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const fns = Object.entries(issues).map(([fn, data]) => ({
  fn,
  start: data.start,
  end: data.end,
  count: data.issues.length,
  issues: data.issues.map(i => i.line + ': ' + i.text.trim())
})).sort((a,b) => a.start - b.start);

console.log('Total functions:', fns.length);
const startIdx = parseInt(process.argv[2] || '0', 10);
const count = parseInt(process.argv[3] || '10', 10);

fns.slice(startIdx, startIdx + count).forEach(f => {
  console.log(`=== ${f.fn} (lines ${f.start}-${f.end}, ${f.count} issues) ===`);
  f.issues.forEach(i => console.log('  ' + i));
});
