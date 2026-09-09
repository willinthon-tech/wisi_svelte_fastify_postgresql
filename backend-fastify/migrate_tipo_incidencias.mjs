import { initDb, sql } from './src/config/db.js';

async function main() {
  await initDb();

  console.log('Iniciando migración para tipo_incidencias...');

  // 1. Crear tabla tipo_incidencias
  await sql`
    CREATE TABLE IF NOT EXISTS tipo_incidencias (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL UNIQUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `;
  console.log('Tabla tipo_incidencias verificada/creada.');

  // 2. Sembrar tipos por defecto
  await sql`
    INSERT INTO tipo_incidencias (id, nombre)
    OVERRIDING SYSTEM VALUE
    VALUES 
      (1, 'General'),
      (2, 'Empleado'),
      (3, 'Mercancía')
    ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre
  `;
  await sql`
    SELECT setval('tipo_incidencias_id_seq', (SELECT GREATEST(MAX(id), 3) FROM tipo_incidencias))
  `;
  console.log('Tipos de incidencia iniciales insertados/asegurados.');

  // 3. Agregar columna tipo_incidencia_id a libro_incidencias_generales
  await sql`
    ALTER TABLE libro_incidencias_generales 
    ADD COLUMN IF NOT EXISTS tipo_incidencia_id INT REFERENCES tipo_incidencias(id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_libro_incidencias_generales_tipo_id 
    ON libro_incidencias_generales(tipo_incidencia_id)
  `;
  console.log('Columna tipo_incidencia_id indexada en libro_incidencias_generales.');

  // 4. Migrar datos existentes en base al texto en "tipo"
  await sql`
    UPDATE libro_incidencias_generales
    SET tipo_incidencia_id = CASE
      WHEN LOWER(TRIM(tipo)) LIKE '%mercanc%' THEN 3
      WHEN LOWER(TRIM(tipo)) LIKE '%emplead%' THEN 2
      ELSE 1
    END
    WHERE tipo_incidencia_id IS NULL
  `;
  console.log('Registros existentes vinculados a tipo_incidencias.');

  // 5. Renombrar página 8 a "CONF.M: CECOM"
  await sql`
    UPDATE paginas 
    SET nombre = 'CONF.M: CECOM' 
    WHERE id = 8 OR UPPER(nombre) = 'CONFIGURACION'
  `;
  console.log('Página de configuración renombrada a CONF.M: CECOM.');

  // 6. Registrar módulo 40: Tipo Incidencias
  const pageRes = await sql`
    SELECT id FROM paginas 
    WHERE id = 8 OR UPPER(nombre) LIKE '%CONF%CECOM%'
    ORDER BY id DESC LIMIT 1
  `;
  const pageId = pageRes.length > 0 ? pageRes[0].id : 8;

  const existingMod = await sql`SELECT id FROM modulos WHERE ruta = '/configuracion/tipo-incidencias'`;
  let modId;
  if (existingMod.length > 0) {
    modId = existingMod[0].id;
    console.log(`Módulo Tipo Incidencias ya existe con id ${modId}`);
  } else {
    const newMod = await sql`
      INSERT INTO modulos (id, nombre, ruta, icono, page_id, orden)
      OVERRIDING SYSTEM VALUE
      VALUES (40, 'Tipo Incidencias', '/configuracion/tipo-incidencias', 'report_problem', ${pageId}, 3)
      ON CONFLICT (id) DO UPDATE SET 
        nombre = EXCLUDED.nombre,
        ruta = EXCLUDED.ruta,
        page_id = EXCLUDED.page_id,
        orden = EXCLUDED.orden
      RETURNING id
    `;
    modId = newMod[0].id;
    await sql`SELECT setval('modulos_id_seq', (SELECT GREATEST(MAX(id), 40) FROM modulos))`;
    console.log(`Módulo creado con id ${modId}`);
  }

  // 7. Asignar permisos a todos los usuarios para el nuevo módulo
  await sql`
    INSERT INTO user_module_permissions (user_id, module_id, permission_id)
    SELECT DISTINCT u.user_id, ${modId}::int, p.id
    FROM user_module_permissions u
    CROSS JOIN permissions p
    ON CONFLICT DO NOTHING
  `;
  console.log('Permisos asignados a los usuarios.');

  const tipList = await sql`SELECT * FROM tipo_incidencias ORDER BY id`;
  console.log('TIPOS DE INCIDENCIA EN BD:', tipList);

  process.exit(0);
}

main().catch(err => {
  console.error('Error en migración:', err);
  process.exit(1);
});
