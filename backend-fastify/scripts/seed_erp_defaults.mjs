import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function seedErpDefaults() {
  const sql = postgres({
    host: process.env.PGHOST || 'localhost',
    port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
    database: process.env.PGDATABASE || 'wisi',
    username: process.env.PGUSER || 'root',
    password: process.env.PGPASSWORD || 'S0p0rt3R0y4l-2025'
  });

  try {
    console.log('🌱 Sembrando datos base predeterminados de Venezuela (Cuentas VEN-NIF y Conceptos LOTTT)...');

    // 1. Conceptos de Nómina predeterminados de Ley
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
    console.log('✓ Conceptos de nómina de ley registrados.');

    // 2. Plan de Cuentas VEN-NIF Estándar
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
    console.log('✓ Catálogo de cuentas VEN-NIF registrado.');

    // 3. Centros de Costos Iniciales
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
    console.log('✓ Centros de costos iniciales registrados.');

    console.log('🎉 ¡Siembra de datos base completada con éxito!');
  } catch (err) {
    console.error('❌ Error sembrando datos base:', err);
  } finally {
    await sql.end();
  }
}

seedErpDefaults();
