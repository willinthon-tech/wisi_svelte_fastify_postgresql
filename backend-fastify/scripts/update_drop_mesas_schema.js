import { initDb, sql } from '../src/config/db.js';

async function updateSchema() {
  await initDb();

  // Drop previous if empty, create matching exact column names
  await sql`DROP TABLE IF EXISTS libro_drop_mesas CASCADE;`;
  await sql`DROP TABLE IF EXISTS drop_mesas CASCADE;`;

  await sql`
    CREATE TABLE IF NOT EXISTS libro_drop_mesas (
      id SERIAL PRIMARY KEY,
      mesa_id INTEGER NOT NULL REFERENCES mesas(id) ON DELETE RESTRICT,
      denominacion_100 INTEGER NOT NULL DEFAULT 0,
      denominacion_50 INTEGER NOT NULL DEFAULT 0,
      denominacion_20 INTEGER NOT NULL DEFAULT 0,
      denominacion_10 INTEGER NOT NULL DEFAULT 0,
      denominacion_5 INTEGER NOT NULL DEFAULT 0,
      denominacion_1 INTEGER NOT NULL DEFAULT 0,
      total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      libro_id INTEGER NOT NULL REFERENCES libros(id) ON DELETE CASCADE
    );
  `;

  // Create drop_mesas as view or table pointing to same
  await sql`
    CREATE TABLE IF NOT EXISTS drop_mesas (
      id SERIAL PRIMARY KEY,
      mesa_id INTEGER NOT NULL REFERENCES mesas(id) ON DELETE RESTRICT,
      denominacion_100 INTEGER NOT NULL DEFAULT 0,
      denominacion_50 INTEGER NOT NULL DEFAULT 0,
      denominacion_20 INTEGER NOT NULL DEFAULT 0,
      denominacion_10 INTEGER NOT NULL DEFAULT 0,
      denominacion_5 INTEGER NOT NULL DEFAULT 0,
      denominacion_1 INTEGER NOT NULL DEFAULT 0,
      total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      libro_id INTEGER NOT NULL REFERENCES libros(id) ON DELETE CASCADE
    );
  `;

  console.log('Tables libro_drop_mesas and drop_mesas created with exact schema!');
  process.exit(0);
}

updateSchema().catch(console.error);
