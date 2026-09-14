import postgres from 'postgres';
const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function check() {
  const pks = await sql`
    SELECT tc.table_name, ccu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name;
  `;
  console.log('--- TABLAS Y SU PRIMARY KEY ---');
  let idPkCount = 0;
  let uuidPkCount = 0;
  let otherPkCount = 0;
  for (const r of pks) {
    console.log(`${r.table_name}: PK = ${r.column_name}`);
    if (r.column_name === 'id') idPkCount++;
    else if (r.column_name === 'uuid') uuidPkCount++;
    else otherPkCount++;
  }
  console.log(`\nTotal PKs: ${pks.length} (UUID: ${uuidPkCount}, ID: ${idPkCount}, Otros: ${otherPkCount})`);

  const fks = await sql`
    SELECT tc.table_name, kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ORDER BY tc.table_name;
  `;
  console.log('\n--- FOREIGN KEYS ---');
  let idFkCount = 0;
  let uuidFkCount = 0;
  for (const f of fks) {
    if (f.ref_col === 'id') {
      console.log(`[ALERTA ID FK] ${f.table_name}.${f.column_name} -> ${f.ref_table}.${f.ref_col}`);
      idFkCount++;
    } else {
      console.log(`[UUID FK] ${f.table_name}.${f.column_name} -> ${f.ref_table}.${f.ref_col}`);
      uuidFkCount++;
    }
  }
  console.log(`\nTotal FKs: ${fks.length} (UUID: ${uuidFkCount}, ID: ${idFkCount})`);

  // Verificar si existen tablas sin primary key
  const tablesWithoutPk = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND table_name NOT IN (
        SELECT tc.table_name
        FROM information_schema.table_constraints tc
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
      );
  `;
  console.log('\n--- TABLAS SIN PRIMARY KEY ---');
  if (tablesWithoutPk.length === 0) {
    console.log('Ninguna. Todas las tablas tienen PRIMARY KEY.');
  } else {
    tablesWithoutPk.forEach(t => console.log(`Tabla sin PK: ${t.table_name}`));
  }

  // Verificar columnas id que aún existan
  const idCols = await sql`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'id'
    ORDER BY table_name;
  `;
  console.log(`\n--- TABLAS CON COLUMNA 'id' (${idCols.length} tablas) ---`);
  idCols.forEach(c => console.log(`  ${c.table_name}.id (${c.data_type})`));

  await sql.end();
}

check().catch(err => {
  console.error(err);
  process.exit(1);
});
