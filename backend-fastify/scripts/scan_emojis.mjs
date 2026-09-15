import fs from 'fs';
import path from 'path';

const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

function scanDir(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      scanDir(full);
    } else if (f.endsWith('.js') || f.endsWith('.mjs')) {
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split('\n');
      lines.forEach((l, idx) => {
        if (emojiRegex.test(l)) {
          console.log(`${full}:${idx + 1}: ${l.trim().slice(0, 120)}`);
        }
      });
    }
  }
}

scanDir('src');
