import { sql, initDb } from '../src/config/db.js';
import fs from 'fs';
import path from 'path';

async function run() {
  try {
    await initDb();
    console.log('Aplicando script para eliminar id de maquinas...');
    await sql.unsafe(`
      ALTER TABLE maquinas DROP CONSTRAINT IF EXISTS maquinas_pkey CASCADE;
      ALTER TABLE maquinas ADD CONSTRAINT maquinas_pkey PRIMARY KEY (uuid);
      ALTER TABLE maquinas DROP COLUMN IF EXISTS id CASCADE;
      DROP SEQUENCE IF EXISTS maquinas_id_seq CASCADE;
    `);
    const cols = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'maquinas' 
      ORDER BY ordinal_position;
    `;
    console.log('Columnas actuales en maquinas:', cols.map(c => `${c.column_name} (${c.data_type})`));
  } catch (err) {
    console.error('Error al aplicar script:', err);
  } finally {
    process.exit(0);
  }
}

run();
