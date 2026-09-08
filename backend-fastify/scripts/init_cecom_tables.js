import { initDb, sql, isPgConnected } from '../src/config/db.js';

async function run() {
  await initDb();
  if (!isPgConnected || !sql) {
    console.error('PostgreSQL not connected');
    process.exit(1);
  }

  console.log('Creating tables if they do not exist...');

  await sql`
    CREATE TABLE IF NOT EXISTS libros (
      id SERIAL PRIMARY KEY,
      descripcion VARCHAR(255) NOT NULL,
      sala_id INTEGER REFERENCES salas(id) ON DELETE RESTRICT,
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS libro_drop_mesas (
      id SERIAL PRIMARY KEY,
      libro_id INTEGER NOT NULL REFERENCES libros(id) ON DELETE CASCADE,
      mesa_id INTEGER NOT NULL REFERENCES mesas(id) ON DELETE RESTRICT,
      b100 INTEGER NOT NULL DEFAULT 0,
      b50 INTEGER NOT NULL DEFAULT 0,
      b20 INTEGER NOT NULL DEFAULT 0,
      b10 INTEGER NOT NULL DEFAULT 0,
      b5 INTEGER NOT NULL DEFAULT 0,
      b1 INTEGER NOT NULL DEFAULT 0,
      total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  console.log('Tables libros and libro_drop_mesas ready in PostgreSQL!');
  process.exit(0);
}

run().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
