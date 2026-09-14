import { initDb, sql } from '../src/config/db.js';

async function scan() {
  await initDb();

  try {
    // 1. Todas las tablas en public
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;

    console.log(`=== TOTAL DE TABLAS: ${tables.length} ===\n`);

    const schemaReport = [];

    for (const t of tables) {
      const tableName = t.table_name;

      // Conteo de registros
      let rowCount = 0;
      try {
        const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM ${sql(tableName)}`;
        rowCount = count;
      } catch (e) {
        rowCount = -1;
      }

      // Columnas
      const columns = await sql`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${tableName}
        ORDER BY ordinal_position;
      `;

      // Primary Key
      const pks = await sql`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = 'public' AND tc.table_name = ${tableName} AND tc.constraint_type = 'PRIMARY KEY';
      `;

      // Foreign keys salientes (hacia quién apunta esta tabla)
      const outgoingFks = await sql`
        SELECT
          kcu.column_name AS from_col,
          ccu.table_name AS to_table,
          ccu.column_name AS to_col
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = ${tableName};
      `;

      // Foreign keys entrantes (quién depende de esta tabla)
      const incomingFks = await sql`
        SELECT
          tc.table_name AS from_table,
          kcu.column_name AS from_col,
          ccu.column_name AS to_col
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND ccu.table_name = ${tableName};
      `;

      schemaReport.push({
        table: tableName,
        rowCount,
        primaryKey: pks.map(p => p.column_name).join(', ') || 'NINGUNA',
        columns: columns.map(c => `${c.column_name} (${c.data_type})`),
        hasUuid: columns.some(c => c.column_name === 'uuid'),
        outgoingFks: outgoingFks.map(f => `${f.from_col} -> ${f.to_table}.${f.to_col}`),
        incomingFks: incomingFks.map(f => `${f.from_table}.${f.from_col} -> ${f.to_col}`)
      });
    }

    const fs = await import('fs');
    fs.writeFileSync('../scratch_db_scan.json', JSON.stringify(schemaReport, null, 2), 'utf8');
    console.log(`\nEscaneo completado. Se guardaron ${schemaReport.length} tablas en scratch_db_scan.json.`);

  } catch (err) {
    console.error('Error durante el escaneo:', err);
  } finally {
    process.exit(0);
  }
}

scan();
