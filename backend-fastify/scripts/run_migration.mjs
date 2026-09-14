import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, sql } from '../src/config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  console.log('Iniciando migración Local-First en PostgreSQL...');
  await initDb();

  const sqlFilePath = path.join(__dirname, 'migrations_local_first_sync.sql');
  const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');

  try {
    await sql.unsafe(sqlContent);
    console.log('\x1b[32m✔ Migración Local-First ejecutada exitosamente en PostgreSQL.\x1b[0m');
  } catch (err) {
    console.error('\x1b[31m✖ Error ejecutando migración:\x1b[0m', err.message);
    process.exit(1);
  }

  process.exit(0);
}

run();
