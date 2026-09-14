import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, sql } from '../src/config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log('Iniciando migración Local-First en PostgreSQL...');
  await initDb();

  const sqlFiles = [
    'migrations_local_first_sync.sql',
    'migrations_dual_key_relations.sql'
  ];

  for (const file of sqlFiles) {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    try {
      console.log(`Ejecutando script: ${file}...`);
      await sql.unsafe(content);
      console.log(`\x1b[32m✔ Script ${file} ejecutado con éxito.\x1b[0m`);
    } catch (err) {
      console.error(`\x1b[31m✖ Error ejecutando ${file}:\x1b[0m`, err.message);
      process.exit(1);
    }
  }

  console.log('\x1b[32m✔ Todas las migraciones Local-First y Dual-Key ejecutadas exitosamente en PostgreSQL.\x1b[0m');
  process.exit(0);
}

run();
