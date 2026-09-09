import { initDb, sql } from './src/config/db.js';

async function main() {
  await initDb();

  console.log('--- Iniciando migración de Rangos y Aportes de Libro ---');

  // 1. Crear tabla rangos
  await sql`
    CREATE TABLE IF NOT EXISTS rangos (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(150) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `;
  console.log('✅ Tabla "rangos" verificada/creada.');

  // 2. Sembrar rangos por defecto si está vacía
  const existingRangos = await sql`SELECT COUNT(*)::int as count FROM rangos`;
  if (existingRangos[0].count === 0) {
    await sql`
      INSERT INTO rangos (nombre)
      VALUES 
        ('Rango 1'),
        ('Rango 2'),
        ('Rango 3'),
        ('Rango 4'),
        ('Rango 5')
      ON CONFLICT (nombre) DO NOTHING
    `;
    console.log('✅ Rangos iniciales sembrados (Rango 1 al 5).');
  }

  // 3. Crear tabla libro_aportes
  await sql`
    CREATE TABLE IF NOT EXISTS libro_aportes (
      id SERIAL PRIMARY KEY,
      libro_id INT NOT NULL REFERENCES libros(id) ON DELETE CASCADE,
      empleado_id INT NOT NULL REFERENCES empleados(id) ON DELETE RESTRICT,
      rango_id INT NOT NULL REFERENCES rangos(id) ON DELETE RESTRICT,
      monto NUMERIC(14, 2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `;
  console.log('✅ Tabla "libro_aportes" verificada/creada.');

  // 4. Índices para libro_aportes
  await sql`CREATE INDEX IF NOT EXISTS idx_libro_aportes_libro_id ON libro_aportes(libro_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_libro_aportes_empleado_id ON libro_aportes(empleado_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_libro_aportes_rango_id ON libro_aportes(rango_id)`;
  console.log('✅ Índices de "libro_aportes" creados.');

  // 5. Registrar módulo en "modulos" para CONF.M: CECOM
  const pageRes = await sql`
    SELECT id FROM paginas 
    WHERE id = 8 OR UPPER(nombre) LIKE '%CONF%CECOM%'
    ORDER BY id DESC LIMIT 1
  `;
  const pageId = pageRes.length > 0 ? pageRes[0].id : 8;

  const existingMod = await sql`SELECT id FROM modulos WHERE ruta = '/configuracion/rangos'`;
  let modId;
  if (existingMod.length > 0) {
    modId = existingMod[0].id;
    console.log(`ℹ️ Módulo Rangos ya existe con id ${modId}`);
  } else {
    const maxOrderRes = await sql`SELECT COALESCE(MAX(orden), 0) + 1 as next_order FROM modulos WHERE page_id = ${pageId}`;
    const nextOrder = maxOrderRes[0]?.next_order || 4;

    const newMod = await sql`
      INSERT INTO modulos (nombre, ruta, icono, page_id, orden)
      VALUES ('Rangos', '/configuracion/rangos', 'military_tech', ${pageId}, ${nextOrder})
      RETURNING id
    `;
    modId = newMod[0].id;
    console.log(`✅ Módulo Rangos registrado con id ${modId} (orden: ${nextOrder})`);
  }

  // 6. Asignar permisos del módulo a los usuarios
  await sql`
    INSERT INTO user_module_permissions (user_id, module_id, permission_id)
    SELECT DISTINCT u.user_id, ${modId}::int, p.id
    FROM user_module_permissions u
    CROSS JOIN permissions p
    ON CONFLICT DO NOTHING
  `;
  console.log('✅ Permisos asignados a los usuarios para el módulo Rangos.');

  console.log('🎉 Migración completada exitosamente.');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error en migración:', err);
  process.exit(1);
});
