import fs from 'fs';

const content = fs.readFileSync('C:\\Users\\antho\\.gemini\\antigravity-ide\\brain\\2ac684bf-21ba-4978-8de6-c579633a1a33\\.system_generated\\logs\\transcript_full.jsonl', 'utf8');
const lines = content.split('\n');

for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i].includes('test-user-info') && lines[i].includes('userMap')) {
    if (lines[i].includes('replace_file_content') || lines[i].includes('write_to_file')) continue;
    const idx = lines[i].indexOf('test-user-info');
    console.log('FOUND DOM:', lines[i].slice(idx, idx + 1000));
    break;
  }
}
