import { initDb, sql } from '../src/config/db.js';

async function restore() {
  await initDb();
  const userId = 'f9217776-191b-41cb-b864-a23004cc3851';
  const perms = {
    "80e6720f-ee23-45e8-9274-db14fd26d64a":["ELIMINAR","EDITAR","AGREGAR","VER"],
    "0c3b005e-a6c8-4b76-8040-440a0b4904da":["VER","ELIMINAR","EDITAR","AGREGAR"],
    "e1999438-639b-48af-b32e-089350936697":["ELIMINAR","EDITAR","AGREGAR","VER"],
    "59364002-82f9-40ea-9793-f7a37f918416":["VER","ELIMINAR","EDITAR","AGREGAR"],
    "85084779-5192-4c55-b529-f2922d86da99":["ELIMINAR","EDITAR","AGREGAR","VER"],
    "3e321eb7-c884-44ef-8747-d48818cd03aa":["EDITAR","AGREGAR","VER","ELIMINAR"],
    "dc47c054-355e-43b2-bd85-61edcf45de37":["EDITAR","AGREGAR","VER","ELIMINAR"],
    "c945e754-80bc-4377-a624-239b4fb9e421":["ELIMINAR","EDITAR","AGREGAR","VER"],
    "57da1048-0646-4ba3-9fce-2dc86a2cb4df":["VER","ELIMINAR","EDITAR","AGREGAR"],
    "aa7ecd30-b9b2-46a2-9dcc-6775c70a6d1d":["ELIMINAR","EDITAR","AGREGAR","VER"],
    "31a8779f-b7cc-4bd8-8619-c408a9d7e4dd":["ELIMINAR","EDITAR","AGREGAR","VER"],
    "7d8cf5bd-09b0-4105-bced-dfe30b2522e8":["ELIMINAR","EDITAR","AGREGAR","VER"],
    "b6f76ffe-4fa4-4f0b-95a2-8464f39e4137":["ELIMINAR","EDITAR","AGREGAR","VER"],
    "6f818d4f-4c74-4feb-b8f7-dc0db07f0ca6":["ELIMINAR","EDITAR","AGREGAR","VER"],
    "7d037e02-a364-4fba-86e5-439d15a1bfee":["ELIMINAR","EDITAR","AGREGAR","VER"],
    "129e20cc-e12e-45c0-8409-a6a0ee047e0b":["VER","ELIMINAR","EDITAR","AGREGAR"],
    "142a44a0-7bae-45be-ac5d-92590c33660e":["ELIMINAR","EDITAR","AGREGAR","VER"],
    "66b14fc2-5dcb-492b-b679-acf28fbd4bb4":["EDITAR","AGREGAR","VER","ELIMINAR"],
    "435bd067-fe42-49b0-b525-210b7c19a1fc":["EDITAR","ELIMINAR","VER","AGREGAR"],
    "7b9ccfd3-bfe0-4e02-bd68-3221494f432d":["EDITAR","ELIMINAR","VER","AGREGAR"],
    "f6cc58ea-b74c-462a-8d36-4b08f46cd077":["VER","ELIMINAR","EDITAR","AGREGAR"],
    "4827f008-2c8b-44d9-be39-6ff3f4ee744e":["EDITAR","ELIMINAR","VER","AGREGAR"],
    "d2992a2a-642a-4b29-8547-772c8f1963a3":["EDITAR","ELIMINAR","VER","AGREGAR"],
    "d3dbf58d-cda0-4a44-9773-ab2af79c76c9":["VER","ELIMINAR","EDITAR","AGREGAR"],
    "ab5d4cd0-9d84-413c-8001-6570efe02bbe":["ELIMINAR","EDITAR","AGREGAR","VER"],
    "f214acec-737c-477c-8cfb-8c974e39ab4c":["ELIMINAR","EDITAR","AGREGAR","VER"],
    "d5d8ecee-2c48-42c0-abbe-fecd3e3d9387":["ELIMINAR","EDITAR","AGREGAR","VER"],
    "5982130f-8bcd-498a-8233-8f2dd4582b15":["EDITAR","AGREGAR","VER","ELIMINAR"],
    "73a401c8-07fc-4824-9ff2-1c57a8ad9552":["AGREGAR","VER","ELIMINAR","EDITAR"],
    "158a9bff-f23d-4f42-9196-c1661e516e32":["VER","ELIMINAR","EDITAR","AGREGAR"],
    "2ec54cc0-4a06-4885-a20f-3e5a5c7d4266":["ELIMINAR","EDITAR","AGREGAR","VER"],
    "11d13c1f-88bc-4245-bf7e-bd550c2d6424":["ELIMINAR","EDITAR","AGREGAR","VER"],
    "62eaa4df-8466-4ad9-876c-d34e9b9055d3":["ELIMINAR","EDITAR","AGREGAR","VER"],
    "b1605f01-5b1a-4f84-afdd-537caf2c7678":["VER","ELIMINAR","EDITAR","AGREGAR"],
    "6b601f8a-b30f-4523-92c2-6fea0d151387":["EDITAR","ELIMINAR","VER","AGREGAR"]
  };

  const permRows = await sql`SELECT uuid, UPPER(TRIM(nombre)) as nombre FROM permissions`;
  const permMap = {};
  for (const p of permRows) {
    permMap[p.nombre] = p.uuid;
  }
  permMap['BORRAR'] = permMap['ELIMINAR'];

  await sql`DELETE FROM user_module_permissions WHERE user_uuid = ${userId}::uuid`;
  for (const [modUuid, pList] of Object.entries(perms)) {
    for (const pName of pList) {
      const pUuid = permMap[pName];
      if (pUuid) {
        await sql`
          INSERT INTO user_module_permissions (user_uuid, module_uuid, permission_uuid)
          VALUES (${userId}::uuid, ${modUuid}::uuid, ${pUuid}::uuid)
          ON CONFLICT DO NOTHING
        `;
      }
    }
  }
  console.log('Restored willinthon permissions successfully!');
  process.exit(0);
}

restore().catch(console.error);
