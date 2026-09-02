import fs from 'fs';
import readline from 'readline';
import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const sql = postgres({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'wisi',
  username: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  max: 10
});

async function runImport() {
  console.log('Running second pass import with ON CONFLICT DO NOTHING...');
  
  const fileStream = fs.createReadStream('../data.sql');
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let inAttlogsInsert = false;
  let buffer = [];
  let totalInserted = 0;
  const BATCH_SIZE = 1000;

  async function flushBatch() {
    if (buffer.length === 0) return;

    try {
      const rows = buffer;
      buffer = [];

      const valueStrings = rows.map(r => {
        const id = r.id;
        const dispId = r.dispositivo_id;
        const empNo = `'${String(r.employee_no).replace(/'/g, "''")}'`;
        const evTime = `'${String(r.event_time).replace(/'/g, "''")}'`;
        const crAt = `'${String(r.created_at).replace(/'/g, "''")}'`;
        const upAt = `'${String(r.updated_at).replace(/'/g, "''")}'`;
        const nom = r.nombre ? `'${String(r.nombre).replace(/'/g, "''")}'` : 'NULL';

        return `(${id}, ${dispId}, ${empNo}, ${evTime}, ${crAt}, ${upAt}, ${nom})`;
      });

      const query = `
        INSERT INTO attlogs (id, dispositivo_id, employee_no, event_time, created_at, updated_at, nombre)
        VALUES ${valueStrings.join(',\n')}
        ON CONFLICT DO NOTHING;
      `;

      await sql.unsafe(query);

      totalInserted += rows.length;
      if (totalInserted % 25000 === 0) {
        console.log(`Processed ${totalInserted} attlog records...`);
      }
    } catch (err) {
      // If batch fails due to internal duplicate inside the same batch, insert rows 1 by 1
      for (const r of buffer) {
        try {
          const id = r.id;
          const dispId = r.dispositivo_id;
          const empNo = String(r.employee_no).replace(/'/g, "''");
          const evTime = String(r.event_time).replace(/'/g, "''");
          const crAt = String(r.created_at).replace(/'/g, "''");
          const upAt = String(r.updated_at).replace(/'/g, "''");
          const nom = r.nombre ? String(r.nombre).replace(/'/g, "''") : null;

          await sql.unsafe(`
            INSERT INTO attlogs (id, dispositivo_id, employee_no, event_time, created_at, updated_at, nombre)
            VALUES (${id}, ${dispId}, '${empNo}', '${evTime}', '${crAt}', '${upAt}', ${nom ? `'${nom}'` : 'NULL'})
            ON CONFLICT DO NOTHING;
          `);
          totalInserted++;
        } catch (e) {
          // ignore single duplicates
        }
      }
      buffer = [];
    }
  }

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.startsWith('INSERT INTO `attlogs`')) {
      inAttlogsInsert = true;
    }

    if (inAttlogsInsert) {
      const tupleMatch = trimmed.match(/^\((\d+),\s*(\d+),\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',\s*(NULL|'[^']*')\)[,;]$/);
      if (tupleMatch) {
        const id = Number(tupleMatch[1]);
        const dispositivo_id = Number(tupleMatch[2]);
        const employee_no = tupleMatch[3];
        const event_time = tupleMatch[4];
        const created_at = tupleMatch[5];
        const updated_at = tupleMatch[6];
        const nombre = tupleMatch[7] === 'NULL' ? null : tupleMatch[7].replace(/^'|'$/g, '');

        buffer.push({
          id,
          dispositivo_id,
          employee_no,
          event_time,
          created_at,
          updated_at,
          nombre
        });

        if (buffer.length >= BATCH_SIZE) {
          await flushBatch();
        }
      }
    }

    if (trimmed.endsWith(';') && inAttlogsInsert && !trimmed.startsWith('INSERT INTO `attlogs`')) {
      inAttlogsInsert = false;
    }
  }

  if (buffer.length > 0) {
    await flushBatch();
  }

  console.log(`Second pass completed! Total attlogs processed: ${totalInserted}`);

  // Sync sequence to max ID
  await sql`
    SELECT setval('attlogs_id_seq', (SELECT COALESCE(MAX(id), 1) FROM attlogs));
  `;
  console.log('Attlogs ID sequence synchronized!');

  const countRes = await sql`SELECT COUNT(*) FROM attlogs;`;
  console.log(`Total attlogs in database table: ${countRes[0].count}`);

  await sql.end();
}

runImport().catch(e => {
  console.error('Import Error:', e);
  process.exit(1);
});
