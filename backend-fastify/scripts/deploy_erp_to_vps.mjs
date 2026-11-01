import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function deployErpToVps() {
  const VPS_HOST = '66.97.43.124';
  const VPS_PORT = 5432;
  const VPS_DB = 'wisi';
  const VPS_USER = 'root';
  const VPS_PASS = 'S0p0rt3R0y4l-2025';

  console.log(`🚀 Conectando a la VPS (${VPS_HOST}:${VPS_PORT} / DB: ${VPS_DB})...`);

  const sql = postgres({
    host: VPS_HOST,
    port: VPS_PORT,
    database: VPS_DB,
    username: VPS_USER,
    password: VPS_PASS,
    connect_timeout: 10
  });

  try {
    // 1. Obtener el UUID del usuario willinthon en la VPS
    const willinthonUsers = await sql`
      SELECT uuid, usuario 
      FROM usuarios 
      WHERE LOWER(TRIM(usuario)) = 'willinthon' AND is_deleted = false 
      LIMIT 1
    `;
    if (willinthonUsers.length === 0) {
      throw new Error("No se encontró el usuario 'willinthon' en la VPS.");
    }
    const willinthonUuid = willinthonUsers[0].uuid;
    console.log(`👤 Usuario willinthon en la VPS: ${willinthonUuid}`);

    // 2. Ejecutar DDL para crear todas las tablas erp_* en la VPS
    console.log('\n📦 1. Creando tablas erp_* en la VPS (100% UUID)...');
    const sqlFile = path.join(__dirname, 'create_erp_tables.sql');
    const sqlContent = fs.readFileSync(sqlFile, 'utf8');
    await sql.unsafe(sqlContent);
    console.log('✅ Tablas erp_* creadas en la VPS.');

    // 3. Crear las 3 Páginas y 15 Módulos en la VPS
    console.log('\n📁 2. Creando Páginas y Módulos del Menú en la VPS...');
    const pagesDef = [
      {
        nombre: 'ADMINISTRATIVO',
        modulos: [
          { nombre: 'Artículos e Inventario', ruta: '/administrativo/inventario', icono: 'inventory_2', orden: 1 },
          { nombre: 'Ventas y Facturación', ruta: '/administrativo/ventas', icono: 'point_of_sale', orden: 2 },
          { nombre: 'Compras y Proveedores', ruta: '/administrativo/compras', icono: 'shopping_cart', orden: 3 },
          { nombre: 'Cuentas por Cobrar y Pagar', ruta: '/administrativo/cxc-cxp', icono: 'account_balance_wallet', orden: 4 },
          { nombre: 'Libros Fiscales SENIAT', ruta: '/administrativo/reportes-fiscales', icono: 'receipt_long', orden: 5 }
        ]
      },
      {
        nombre: 'CONTABILIDAD',
        modulos: [
          { nombre: 'Plan de Cuentas', ruta: '/contabilidad/plan-cuentas', icono: 'account_tree', orden: 1 },
          { nombre: 'Centros de Costos', ruta: '/contabilidad/centros-costos', icono: 'domain', orden: 2 },
          { nombre: 'Comprobantes y Asientos', ruta: '/contabilidad/asientos', icono: 'menu_book', orden: 3 },
          { nombre: 'Libro Diario y Mayor', ruta: '/contabilidad/libros', icono: 'auto_stories', orden: 4 },
          { nombre: 'Balance de Comprobación', ruta: '/contabilidad/reportes', icono: 'analytics', orden: 5 }
        ]
      },
      {
        nombre: 'NÓMINA',
        modulos: [
          { nombre: 'Personal y Salarios', ruta: '/nomina/personal', icono: 'badge', orden: 1 },
          { nombre: 'Conceptos y Fórmulas', ruta: '/nomina/conceptos', icono: 'functions', orden: 2 },
          { nombre: 'Procesamiento de Nómina', ruta: '/nomina/procesamiento', icono: 'payments', orden: 3 },
          { nombre: 'Prestaciones Sociales (LOTTT)', ruta: '/nomina/prestaciones', icono: 'savings', orden: 4 },
          { nombre: 'Recibos y Reportes Legales', ruta: '/nomina/reportes', icono: 'description', orden: 5 }
        ]
      }
    ];

    const perms = await sql`SELECT uuid, UPPER(TRIM(nombre)) as nombre FROM permissions WHERE is_deleted = false`;
    const allInsertedModuleUuids = [];

    for (const pageItem of pagesDef) {
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
        console.log(`  ✨ VPS: Página CREADA: ${pageItem.nombre} (${pageUuid})`);
      } else {
        pageUuid = pageRows[0].uuid;
        console.log(`  ℹ️ VPS: Página YA EXISTE: ${pageItem.nombre} (${pageUuid})`);
      }

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
            INSERT INTO modulos (page_uuid, nombre, ruta, icono, orden, is_deleted, created_at, updated_at)
            VALUES (${pageUuid}, ${mod.nombre}, ${mod.ruta}, ${mod.icono}, ${mod.orden}, false, NOW(), NOW())
            RETURNING uuid, nombre, ruta, orden
          `;
          modUuid = newMod[0].uuid;
          console.log(`    ⭐ VPS: Módulo CREADO: ${newMod[0].nombre} [${newMod[0].ruta}] (${modUuid})`);
        } else {
          modUuid = existingMod[0].uuid;
          await sql`
            UPDATE modulos 
            SET ruta = ${mod.ruta}, icono = ${mod.icono}, orden = ${mod.orden}, updated_at = NOW()
            WHERE uuid = ${modUuid}
          `;
          console.log(`    ℹ️ VPS: Módulo ACTUALIZADO: ${mod.nombre} [${mod.ruta}] (${modUuid})`);
        }

        allInsertedModuleUuids.push(modUuid);
      }
    }

    // 4. Asignar permisología en la VPS EXCLUSIVAMENTE a willinthon
    console.log(`\n🔒 3. Asignando permisología EXCLUSIVA para willinthon (${willinthonUuid}) en la VPS...`);
    await sql`
      DELETE FROM user_module_permissions 
      WHERE module_uuid IN ${sql(allInsertedModuleUuids)} AND user_uuid != ${willinthonUuid}
    `;

    for (const mUuid of allInsertedModuleUuids) {
      for (const p of perms) {
        await sql`
          INSERT INTO user_module_permissions (user_uuid, module_uuid, permission_uuid, is_deleted, created_at, updated_at)
          VALUES (${willinthonUuid}, ${mUuid}, ${p.uuid}, false, NOW(), NOW())
          ON CONFLICT DO NOTHING
        `;
      }
    }
    console.log(`✅ Permisos (VER, AGREGAR, EDITAR, ELIMINAR) asignados en la VPS.`);

    // 5. Sembrar datos iniciales (Conceptos LOTTT, Cuentas VEN-NIF y Centros de Costos) en la VPS
    console.log('\n🌱 4. Sembrando datos base en la VPS...');
    const conceptos = [
      { codigo: 'ASIG-001', nombre: 'Sueldo Básico Quincenal', tipo: 'ASIGNACION', formula: 'Sueldo Base Mensual / 2', gravable_ivss: true, gravable_faov: true },
      { codigo: 'ASIG-002', nombre: 'Bono de Alimentación (Cestaticket)', tipo: 'ASIGNACION', formula: '40 USD Oficial BCV / 2', gravable_ivss: false, gravable_faov: false },
      { codigo: 'ASIG-003', nombre: 'Horas Extras Diurnas (50% Recargo)', tipo: 'ASIGNACION', formula: '(Sueldo Diario / 8) * 1.5 * Horas', gravable_ivss: true, gravable_faov: true },
      { codigo: 'ASIG-004', nombre: 'Bono de Asistencia y Productividad', tipo: 'ASIGNACION', formula: 'Monto Fijo Pactado', gravable_ivss: false, gravable_faov: false },
      { codigo: 'DED-001', nombre: 'Seguro Social Obligatorio (IVSS 4%)', tipo: 'DEDUCCION', formula: '(Sueldo Básico * 12 / 52) * 4% * Lunes del Mes', gravable_ivss: false, gravable_faov: false },
      { codigo: 'DED-002', nombre: 'Fondo de Ahorro Habitacional (FAOV 1%)', tipo: 'DEDUCCION', formula: 'Sueldo Integral * 1%', gravable_ivss: false, gravable_faov: false },
      { codigo: 'DED-003', nombre: 'Anticipos de Sueldo / Préstamos', tipo: 'DEDUCCION', formula: 'Cuota Pactada Empleado', gravable_ivss: false, gravable_faov: false }
    ];

    for (const c of conceptos) {
      await sql`
        INSERT INTO erp_nomina_conceptos (codigo, nombre, tipo, formula, gravable_ivss, gravable_faov, is_deleted, created_at, updated_at)
        VALUES (${c.codigo}, ${c.nombre}, ${c.tipo}, ${c.formula}, ${c.gravable_ivss}, ${c.gravable_faov}, false, NOW(), NOW())
        ON CONFLICT (codigo) DO UPDATE
        SET nombre = EXCLUDED.nombre, formula = EXCLUDED.formula, updated_at = NOW()
      `;
    }

    const cuentas = [
      { codigo: '1', nombre: 'ACTIVO', nivel: 1, tipo: 'GRUPO', naturaleza: 'DEUDORA' },
      { codigo: '1.1', nombre: 'ACTIVO CORRIENTE', nivel: 2, tipo: 'GRUPO', naturaleza: 'DEUDORA' },
      { codigo: '1.1.1', nombre: 'EFECTIVO Y EQUIVALENTES DE EFECTIVO', nivel: 3, tipo: 'GRUPO', naturaleza: 'DEUDORA' },
      { codigo: '1.1.1.01', nombre: 'Caja Principal (Moneda Nacional Bs)', nivel: 4, tipo: 'DETALLE', naturaleza: 'DEUDORA' },
      { codigo: '1.1.1.02', nombre: 'Caja Bóveda Divisas (USD)', nivel: 4, tipo: 'DETALLE', naturaleza: 'DEUDORA' },
      { codigo: '1.1.1.03', nombre: 'Banco Cuenta Corriente', nivel: 4, tipo: 'DETALLE', naturaleza: 'DEUDORA' },
      { codigo: '1.1.2', nombre: 'CUENTAS POR COBRAR COMERCIALES', nivel: 3, tipo: 'GRUPO', naturaleza: 'DEUDORA' },
      { codigo: '1.1.2.01', nombre: 'Clientes Nacionales', nivel: 4, tipo: 'DETALLE', naturaleza: 'DEUDORA' },
      { codigo: '2', nombre: 'PASIVO', nivel: 1, tipo: 'GRUPO', naturaleza: 'ACREEDORA' },
      { codigo: '2.1', nombre: 'PASIVO CORRIENTE', nivel: 2, tipo: 'GRUPO', naturaleza: 'ACREEDORA' },
      { codigo: '2.1.1.01', nombre: 'Cuentas por Pagar Proveedores', nivel: 4, tipo: 'DETALLE', naturaleza: 'ACREEDORA' },
      { codigo: '2.1.2.01', nombre: 'Retenciones de IVA por Enterar (SENIAT)', nivel: 4, tipo: 'DETALLE', naturaleza: 'ACREEDORA' },
      { codigo: '2.1.2.02', nombre: 'Retenciones ISLR por Enterar', nivel: 4, tipo: 'DETALLE', naturaleza: 'ACREEDORA' },
      { codigo: '2.1.3.01', nombre: 'Sueldos y Salarios por Pagar', nivel: 4, tipo: 'DETALLE', naturaleza: 'ACREEDORA' },
      { codigo: '3', nombre: 'PATRIMONIO NETO', nivel: 1, tipo: 'GRUPO', naturaleza: 'ACREEDORA' },
      { codigo: '3.1.1.01', nombre: 'Capital Social Suscrito y Pagado', nivel: 4, tipo: 'DETALLE', naturaleza: 'ACREEDORA' },
      { codigo: '3.2.1.01', nombre: 'Resultados Acumulados de Ejercicios Anteriores', nivel: 4, tipo: 'DETALLE', naturaleza: 'ACREEDORA' },
      { codigo: '4', nombre: 'INGRESOS', nivel: 1, tipo: 'GRUPO', naturaleza: 'ACREEDORA' },
      { codigo: '4.1.1.01', nombre: 'Ingresos por Operaciones Comerciales y de Sala', nivel: 4, tipo: 'DETALLE', naturaleza: 'ACREEDORA' },
      { codigo: '5', nombre: 'COSTOS Y GASTOS OPERATIVOS', nivel: 1, tipo: 'GRUPO', naturaleza: 'DEUDORA' },
      { codigo: '5.1.1.01', nombre: 'Gasto de Sueldos y Salarios Personal', nivel: 4, tipo: 'DETALLE', naturaleza: 'DEUDORA' },
      { codigo: '5.1.1.02', nombre: 'Aportes Patronales (IVSS, FAOV, INCES)', nivel: 4, tipo: 'DETALLE', naturaleza: 'DEUDORA' },
      { codigo: '5.1.2.01', nombre: 'Gastos de Mantenimiento y Servicios', nivel: 4, tipo: 'DETALLE', naturaleza: 'DEUDORA' }
    ];

    for (const cta of cuentas) {
      await sql`
        INSERT INTO erp_plan_cuentas (codigo, nombre, nivel, tipo, naturaleza, saldo, is_deleted, created_at, updated_at)
        VALUES (${cta.codigo}, ${cta.nombre}, ${cta.nivel}, ${cta.tipo}, ${cta.naturaleza}, 0.0000, false, NOW(), NOW())
        ON CONFLICT (codigo) DO UPDATE
        SET nombre = EXCLUDED.nombre, updated_at = NOW()
      `;
    }

    const centros = [
      { codigo: 'CC-01', nombre: 'Operaciones de Sala y Mesas', responsable: 'Jefe de Operaciones', presupuesto_usd: 25000.00 },
      { codigo: 'CC-02', nombre: 'Recursos Humanos y Nómina', responsable: 'Gerente de RRHH', presupuesto_usd: 35000.00 },
      { codigo: 'CC-03', nombre: 'Seguridad Integral y CECOM', responsable: 'Auditor de Seguridad', presupuesto_usd: 12000.00 },
      { codigo: 'CC-04', nombre: 'Administración y Finanzas', responsable: 'Contador General', presupuesto_usd: 15000.00 }
    ];

    for (const cc of centros) {
      await sql`
        INSERT INTO erp_centros_costos (codigo, nombre, responsable, presupuesto_usd, ejecutado_usd, is_deleted, created_at, updated_at)
        VALUES (${cc.codigo}, ${cc.nombre}, ${cc.responsable}, ${cc.presupuesto_usd}, 0.0000, false, NOW(), NOW())
        ON CONFLICT (codigo) DO UPDATE
        SET nombre = EXCLUDED.nombre, presupuesto_usd = EXCLUDED.presupuesto_usd, updated_at = NOW()
      `;
    }

    console.log('\n🎉 ¡DESPLIEGUE A LA VPS COMPLETADO CON ÉXITO AL 100%!');

    // Resumen final de verificación en la VPS
    const erpCount = await sql`SELECT count(*) as count FROM information_schema.tables WHERE table_name LIKE 'erp_%'`;
    const modCount = await sql`
      SELECT count(*) as count 
      FROM modulos m 
      JOIN paginas p ON m.page_uuid = p.uuid 
      WHERE p.nombre IN ('ADMINISTRATIVO', 'CONTABILIDAD', 'NÓMINA')
    `;
    const userPermCount = await sql`
      SELECT count(*) as count 
      FROM user_module_permissions 
      WHERE user_uuid = ${willinthonUuid}
    `;

    console.log(`\n📊 Estado en la VPS (wisi.space):`);
    console.log(`  ✓ Tablas erp_*: ${erpCount[0].count}`);
    console.log(`  ✓ Módulos ERP registrados: ${modCount[0].count}`);
    console.log(`  ✓ Permisos activos para willinthon: ${userPermCount[0].count}`);

  } catch (err) {
    console.error('❌ Error desplegando a la VPS:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

deployErpToVps();
