import { initDb, sql } from '../src/config/db.js';
import { getPaginasModel, getModulosModel } from '../src/models/master.model.js';
import { getUserNavMenuModel } from '../src/models/auth.model.js';

async function verify() {
  try {
    await initDb();
    
    console.log('--- 1. Testing getPaginasModel ---');
    const paginas = await getPaginasModel();
    let hasPaginaId = false;
    for (const p of paginas) {
      if ('id' in p) {
        console.error('FAIL: pagina contains id:', p);
        hasPaginaId = true;
      }
    }
    if (!hasPaginaId) {
      console.log(`SUCCESS: All ${paginas.length} paginas have ONLY uuid, no "id"!`);
      console.log('Sample pagina:', paginas[0]);
    }

    console.log('\n--- 2. Testing getModulosModel ---');
    const modulos = await getModulosModel();
    let hasModuloId = false;
    for (const m of modulos) {
      if ('id' in m) {
        console.error('FAIL: modulo contains id:', m);
        hasModuloId = true;
      }
      if ('page_id' in m) {
        console.error('FAIL: modulo contains page_id:', m);
        hasModuloId = true;
      }
    }
    if (!hasModuloId) {
      console.log(`SUCCESS: All ${modulos.length} modulos have ONLY uuid and page_uuid, no "id" or "page_id"!`);
      console.log('Sample modulo:', modulos[0]);
    }

    console.log('\n--- 3. Testing Rangos modulo ---');
    const rangos = modulos.find(m => m.nombre.toLowerCase().includes('rango'));
    console.log('Rangos modulo:', rangos);

    console.log('\n--- 4. Testing getUserNavMenuModel ---');
    // Get any user uuid
    const users = await sql`SELECT uuid FROM usuarios LIMIT 1`;
    if (users.length > 0) {
      const menu = await getUserNavMenuModel(users[0].uuid);
      let menuHasId = false;
      for (const p of menu) {
        if ('id' in p) {
          console.error('FAIL: nav menu page has id:', p);
          menuHasId = true;
        }
        for (const m of (p.modulos || [])) {
          if ('id' in m || 'page_id' in m) {
            console.error('FAIL: nav menu modulo has id or page_id:', m);
            menuHasId = true;
          }
        }
      }
      if (!menuHasId) {
        console.log(`SUCCESS: Nav menu pages and modules have ZERO "id" or "page_id" properties!`);
      }
    }

  } catch (err) {
    console.error('Error during verification:', err);
  } finally {
    if (sql) await sql.end();
  }
}

verify();
