import { initDb, sql } from '../src/config/db.js';

async function run() {
  await initDb();
  try {
    const fks = await sql`
      SELECT
        tc.table_name AS child_table,
        kcu.column_name AS child_column,
        ccu.table_name AS parent_table,
        ccu.column_name AS parent_column
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
      ORDER BY tc.table_name, kcu.column_name;
    `;
    console.log(`Total Foreign Keys found in PostgreSQL: ${fks.length}`);
    for (const fk of fks) {
      console.log(`  ${fk.child_table}.${fk.child_column} -> ${fk.parent_table}.${fk.parent_column}`);
    }

    console.log('\n--- VERIFICACIÓN DE TABLAS Y REGISTROS ---');
    const tables = ['clientes', 'empleados', 'salas', 'libro_control_clientes', 'libros', 'attlogs'];
    for (const t of tables) {
      try {
        const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM ${sql(t)}`;
        const [{ has_uuid }] = await sql`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = ${t} AND column_name = 'uuid'
          ) AS has_uuid
        `;
        console.log(`  ${t}: ${count} filas | columna uuid presente: ${has_uuid}`);
      } catch (e) {
        console.log(`  ${t}: error -> ${e.message}`);
      }
    }
    const samples = await sql`
      SELECT e.id, e.nombre, e.uuid, e.cargo_id, e.cargo_uuid, c.nombre as cargo_nombre 
      FROM empleados e 
      LEFT JOIN cargos c ON e.cargo_id = c.id 
      LIMIT 3
    `;
    console.log('\n--- VERIFICACIÓN DE ENLACES UUID (0 HUÉRFANOS) ---');
    const checks = [
      { table: 'empleados', col: 'cargo_uuid', idCol: 'cargo_id' },
      { table: 'cargos', col: 'area_uuid', idCol: 'area_id' },
      { table: 'areas', col: 'departamento_uuid', idCol: 'departamento_id' },
      { table: 'departamentos', col: 'sala_uuid', idCol: 'sala_id' },
      { table: 'clientes', col: 'sala_uuid', idCol: 'sala_id' },
      { table: 'libros', col: 'sala_uuid', idCol: 'sala_id' },
      { table: 'dispositivos', col: 'sala_uuid', idCol: 'sala_id' }
    ];
    for (const c of checks) {
      try {
        const [{ nulls }] = await sql`
          SELECT COUNT(*)::int AS nulls 
          FROM ${sql(c.table)} 
          WHERE ${sql(c.col)} IS NULL AND ${sql(c.idCol)} IS NOT NULL
        `;
        const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM ${sql(c.table)}`;
        console.log(`  ${c.table}.${c.col}: ${total} filas en total | 0 huérfanos sin UUID: ${nulls === 0}`);
      } catch (e) {
        console.log(`  ${c.table}.${c.col}: error -> ${e.message}`);
      }
    }
  } catch (err) {
    console.error('Error querying foreign keys:', err.message);
  } finally {
    process.exit(0);
  }
}

run();
