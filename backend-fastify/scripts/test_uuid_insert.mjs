import { initDb, sql } from '../src/config/db.js';

async function test() {
  await initDb();
  try {
    const [{ uuid: lUuid }] = await sql`SELECT uuid FROM libros LIMIT 1`;
    const [{ uuid: cUuid }] = await sql`SELECT uuid FROM clientes LIMIT 1`;
    const [{ uuid: mUuid }] = await sql`SELECT uuid FROM metodos_pago LIMIT 1`;

    console.log('Inserting with ONLY UUIDs:');
    console.log('  libro_uuid:', lUuid);
    console.log('  cliente_uuid:', cUuid);
    console.log('  metodo_pago_uuid:', mUuid);

    const [inserted] = await sql`
      INSERT INTO libro_control_clientes (
        libro_uuid, cliente_uuid, metodo_pago_uuid, tipo, monto, hora, nota
      ) VALUES (
        ${lUuid}, ${cUuid}, ${mUuid}, 'Compra', 100.00, '12:00', 'Test UUID insert'
      ) RETURNING *;
    `;

    console.log('\n--- INSERT RESULT ---');
    console.log('  id (auto-generated):', inserted.id);
    console.log('  uuid (auto-generated):', inserted.uuid);
    console.log('  libro_id (resolved by trigger):', inserted.libro_id);
    console.log('  cliente_id (resolved by trigger):', inserted.cliente_id);
    console.log('  metodo_pago_id (resolved by trigger):', inserted.metodo_pago_id);

    // Clean up
    await sql`DELETE FROM libro_control_clientes WHERE id = ${inserted.id}`;
    console.log('Cleaned up test record successfully.');
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    process.exit(0);
  }
}

test();
