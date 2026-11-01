import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function setupErpSections() {
  const sql = postgres({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    database: process.env.PGDATABASE || 'wisi',
    username: process.env.PGUSER || 'root',
    password: process.env.PGPASSWORD || 'S0p0rt3R0y4l-2025'
  });

  try {
    console.log('🚀 Iniciando configuración de secciones ERP: Administrativo, Contabilidad y Nómina (100% UUID)...');

    // 1. Obtener el UUID del usuario willinthon
    const willinthonUsers = await sql`
      SELECT uuid, usuario 
      FROM usuarios 
      WHERE LOWER(TRIM(usuario)) = 'willinthon' AND is_deleted = false 
      LIMIT 1
    `;
    if (willinthonUsers.length === 0) {
      throw new Error("No se encontró el usuario 'willinthon' en la tabla usuarios.");
    }
    const willinthonUuid = willinthonUsers[0].uuid;
    console.log(`👤 Usuario willinthon encontrado con UUID: ${willinthonUuid}`);

    // 2. Obtener los permisos del sistema (VER, AGREGAR, EDITAR, ELIMINAR/BORRAR)
    const perms = await sql`SELECT uuid, UPPER(TRIM(nombre)) as nombre FROM permissions WHERE is_deleted = false`;
    console.log(`🔑 Permisos disponibles en el sistema: ${perms.map(p => p.nombre).join(', ')}`);

    // 3. Definición de las 3 Páginas y sus Módulos (V1)
    const pagesDef = [
      {
        nombre: 'ADMINISTRATIVO',
        modulos: [
          { nombre: 'Artículos e Inventario', ruta: '/administrativo/inventario', orden: 1 },
          { nombre: 'Ventas y Facturación', ruta: '/administrativo/ventas', orden: 2 },
          { nombre: 'Compras y Proveedores', ruta: '/administrativo/compras', orden: 3 },
          { nombre: 'Cuentas por Cobrar y Pagar', ruta: '/administrativo/cxc-cxp', orden: 4 },
          { nombre: 'Libros Fiscales SENIAT', ruta: '/administrativo/reportes-fiscales', orden: 5 }
        ]
      },
      {
        nombre: 'CONTABILIDAD',
        modulos: [
          { nombre: 'Plan de Cuentas', ruta: '/contabilidad/plan-cuentas', orden: 1 },
          { nombre: 'Centros de Costos', ruta: '/contabilidad/centros-costos', orden: 2 },
          { nombre: 'Comprobantes y Asientos', ruta: '/contabilidad/asientos', orden: 3 },
          { nombre: 'Libro Diario y Mayor', ruta: '/contabilidad/libros', orden: 4 },
          { nombre: 'Balance de Comprobación', ruta: '/contabilidad/reportes', orden: 5 }
        ]
      },
      {
        nombre: 'NÓMINA',
        modulos: [
          { nombre: 'Personal y Salarios', ruta: '/nomina/personal', orden: 1 },
          { nombre: 'Conceptos y Fórmulas', ruta: '/nomina/conceptos', orden: 2 },
          { nombre: 'Procesamiento de Nómina', ruta: '/nomina/procesamiento', orden: 3 },
          { nombre: 'Prestaciones Sociales (LOTTT)', ruta: '/nomina/prestaciones', orden: 4 },
          { nombre: 'Recibos y Reportes Legales', ruta: '/nomina/reportes', orden: 5 }
        ]
      }
    ];

    const allInsertedModuleUuids = [];

    for (const pageItem of pagesDef) {
      console.log(`\n📁 Procesando Página: ${pageItem.nombre}...`);
      
      // Buscar o crear la página usando UUID estricto
      let pageRows = await sql`
        SELECT uuid, nombre 
        FROM paginas 
        WHERE UPPER(TRIM(nombre)) = UPPER(TRIM(${pageItem.nombre}))
        LIMIT 1
      `;

      let pageUuid;
      if (pageRows.length === 0) {
        const newPage = await sql`
          INSERT INTO paginas (nombre, created_at, updated_at)
          VALUES (${pageItem.nombre}, NOW(), NOW())
          RETURNING uuid, nombre
        `;
        pageUuid = newPage[0].uuid;
        console.log(`  ✨ Página CREADA: ${pageItem.nombre} (UUID: ${pageUuid})`);
      } else {
        pageUuid = pageRows[0].uuid;
        console.log(`  ℹ️ Página YA EXISTE: ${pageItem.nombre} (UUID: ${pageUuid})`);
      }

      // Procesar módulos para esta página
      for (const mod of pageItem.modulos) {
        const existingMod = await sql`
          SELECT uuid, nombre, ruta 
          FROM modulos 
          WHERE page_uuid = ${pageUuid} AND (ruta = ${mod.ruta} OR UPPER(TRIM(nombre)) = UPPER(TRIM(${mod.nombre})))
          LIMIT 1
        `;

        let modUuid;
        if (existingMod.length === 0) {
          const newMod = await sql`
            INSERT INTO modulos (page_uuid, nombre, ruta, orden, is_deleted, created_at, updated_at)
            VALUES (${pageUuid}, ${mod.nombre}, ${mod.ruta}, ${mod.orden}, false, NOW(), NOW())
            RETURNING uuid, nombre, ruta, orden
          `;
          modUuid = newMod[0].uuid;
          console.log(`    ⭐ Módulo CREADO: ${newMod[0].nombre} [${newMod[0].ruta}] (UUID: ${modUuid})`);
        } else {
          modUuid = existingMod[0].uuid;
          // Actualizar ruta u orden si cambió
          await sql`
            UPDATE modulos 
            SET ruta = ${mod.ruta}, orden = ${mod.orden}, updated_at = NOW()
            WHERE uuid = ${modUuid}
          `;
          console.log(`    ℹ️ Módulo YA EXISTE: ${mod.nombre} [${mod.ruta}] (UUID: ${modUuid})`);
        }

        allInsertedModuleUuids.push({ modUuid, modNombre: mod.nombre, pageNombre: pageItem.nombre });
      }
    }

    // 4. Asignar permisología (VER, AGREGAR, EDITAR, ELIMINAR) EXCLUSIVAMENTE a willinthon
    console.log(`\n🔒 Asignando permisología EXCLUSIVA para el usuario 'willinthon' (${willinthonUuid})...`);

    // Asegurarnos de limpiar cualquier asignación previa errónea en otros usuarios para estos módulos
    const moduleUuidList = allInsertedModuleUuids.map(m => m.modUuid);
    await sql`
      DELETE FROM user_module_permissions 
      WHERE module_uuid IN ${sql(moduleUuidList)} AND user_uuid != ${willinthonUuid}
    `;

    let assignedCount = 0;
    for (const item of allInsertedModuleUuids) {
      for (const p of perms) {
        await sql`
          INSERT INTO user_module_permissions (user_uuid, module_uuid, permission_uuid, is_deleted, created_at, updated_at)
          VALUES (${willinthonUuid}, ${item.modUuid}, ${p.uuid}, false, NOW(), NOW())
          ON CONFLICT DO NOTHING
        `;
        assignedCount++;
      }
    }

    console.log(`✅ ¡ÉXITO! Se aseguraron ${allInsertedModuleUuids.length} módulos distribuidos en 3 páginas.`);
    console.log(`✅ Se registraron los permisos (VER, AGREGAR, EDITAR, ELIMINAR) ÚNICA Y EXCLUSIVAMENTE para willinthon.`);
    console.log(`✅ Ningún otro usuario tiene acceso ni visibilidad de estos módulos.`);

  } catch (err) {
    console.error('❌ Error configurando módulos ERP:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

setupErpSections();
