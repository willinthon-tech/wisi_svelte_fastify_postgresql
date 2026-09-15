import postgres from 'postgres';
import { getLibrosModel } from '../src/models/master.model.js';
import { initDb } from '../src/config/db.js';

async function main() {
  await initDb();
  console.log('Testing getLibrosModel with frontend parameters:');
  
  try {
    // 1. Frontend sends limit=all
    const r1 = await getLibrosModel({ limit: 'all' });
    console.log('✔ getLibrosModel({ limit: "all" }) passed. Total:', r1.total);
  } catch (e) {
    console.error('✖ Failed limit=all:', e);
  }

  try {
    // 2. Frontend sends user_sala_ids or user_sala_uuids
    const r2 = await getLibrosModel({ 
      page: '1', 
      limit: '10', 
      search: '', 
      sortBy: 'descripcion', 
      sortDir: 'desc',
      user_sala_ids: '9ebbd415-f72b-4e17-abcb-8519310ea1f2',
      sala_ids: '9ebbd415-f72b-4e17-abcb-8519310ea1f2'
    });
    console.log('✔ getLibrosModel with user_sala_ids passed. Total:', r2.total);
  } catch (e) {
    console.error('✖ Failed with user_sala_ids:', e);
  }

  try {
    // 3. Frontend sends numeric sala id (e.g. 1)
    const r3 = await getLibrosModel({ 
      page: '1', 
      limit: '10', 
      search: '', 
      sortBy: 'descripcion', 
      sortDir: 'desc',
      user_sala_ids: '1',
      sala_ids: '1'
    });
    console.log('✔ getLibrosModel with numeric id passed. Total:', r3.total);
  } catch (e) {
    console.error('✖ Failed with numeric sala id:', e);
  }

  process.exit(0);
}

main().catch(console.error);
