import { sql, initDb } from './src/config/db.js';

async function main() {
  await initDb();

  console.log('--- Current permissions before migration ---');
  const beforePerms = await sql`SELECT * FROM permissions ORDER BY id`;
  console.log(beforePerms);

  // 1. Rename BORRAR to ELIMINAR
  await sql`UPDATE permissions SET nombre = 'ELIMINAR', updated_at = NOW() WHERE nombre = 'BORRAR' OR id = 4`;
  console.log('Updated BORRAR -> ELIMINAR');

  // 2. Remove REPORTE from user_module_permissions and permissions
  const deletedUmp = await sql`DELETE FROM user_module_permissions WHERE permission_id = 2 RETURNING id`;
  console.log(`Deleted ${deletedUmp.length} rows with REPORTE permission from user_module_permissions`);

  const deletedPerm = await sql`DELETE FROM permissions WHERE id = 2 OR nombre = 'REPORTE' RETURNING *`;
  console.log('Deleted REPORTE from permissions table:', deletedPerm);

  console.log('--- Current permissions after migration ---');
  const afterPerms = await sql`SELECT * FROM permissions ORDER BY id`;
  console.log(afterPerms);

  const distinctUmp = await sql`
    SELECT p.id, p.nombre, count(*) as count
    FROM user_module_permissions ump
    JOIN permissions p ON ump.permission_id = p.id
    GROUP BY p.id, p.nombre
    ORDER BY p.id
  `;
  console.log('User module permissions distribution:', distinctUmp);

  process.exit(0);
}

main().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
