import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../backend-fastify/.env') });

import { initDb, sql, isPgConnected } from '../backend-fastify/src/config/db.js';
import {
  getRangosModel,
  createRangoModel,
  updateRangoModel,
  deleteRangoModel,
  getLibroAportesModel,
  createLibroAporteModel,
  updateLibroAporteModel,
  deleteLibroAporteModel,
  getLibroReporteModel
} from '../backend-fastify/src/models/master.model.js';

async function runTests() {
  console.log('--- INITIALIZING DB ---');
  await initDb();
  console.log('Connected to PG:', isPgConnected);

  // 1. Test Rangos CRUD
  console.log('1. Testing getRangosModel...');
  const rangosResult = await getRangosModel({ page: 1, limit: 10 });
  console.log('Rangos count in DB:', rangosResult.total, 'Items:', rangosResult.data.map(r => r.nombre));

  console.log('2. Creating test rango...');
  const newRango = await createRangoModel({ nombre: 'Rango Especial Test' });
  console.log('Created rango:', newRango);

  console.log('3. Updating test rango...');
  const updatedRango = await updateRangoModel(newRango.id, { nombre: 'Rango Especial Test Actualizado' });
  console.log('Updated rango:', updatedRango);

  // 2. Find a test libro and an empleado
  const libros = await sql`SELECT id FROM libros ORDER BY id DESC LIMIT 1`;
  const empleados = await sql`SELECT id, nombre FROM empleados ORDER BY id ASC LIMIT 1`;

  if (libros.length === 0 || empleados.length === 0) {
    console.log('No libros or empleados found to test aportes');
    await deleteRangoModel(newRango.id);
    process.exit(0);
  }

  const testLibroId = libros[0].id;
  const testEmpleadoId = empleados[0].id;
  console.log(`Using libro_id=${testLibroId}, empleado_id=${testEmpleadoId}`);

  // 3. Test Libro Aportes CRUD
  console.log('4. Creating test libro aporte...');
  const aporte = await createLibroAporteModel({
    libro_id: testLibroId,
    empleado_id: testEmpleadoId,
    rango_id: newRango.id,
    monto: 150.50
  });
  console.log('Created aporte:', aporte.id, 'Empleado:', aporte.empleado_nombre, 'Rango:', aporte.rango_nombre, 'Monto:', aporte.monto);

  console.log('5. Getting aportes for libro...');
  const listAportes = await getLibroAportesModel(testLibroId);
  console.log(`Found ${listAportes.length} aportes for libro ${testLibroId}. Most recent first ID:`, listAportes[0].id);

  console.log('6. Updating test aporte...');
  const updatedAporte = await updateLibroAporteModel(aporte.id, testLibroId, { monto: 200.00 });
  console.log('Updated aporte monto:', updatedAporte.monto);

  console.log('7. Verifying libro reporte integration...');
  const reporte = await getLibroReporteModel(testLibroId, false);
  console.log('Reporte liveCounts.aportes:', reporte.liveCounts?.aportes);
  console.log('Reporte previewData aportes count:', reporte.data?.data?.aportes?.length);

  console.log('8. Cleaning up test aporte and test rango...');
  await deleteLibroAporteModel(aporte.id, testLibroId);
  await deleteRangoModel(newRango.id);

  console.log('--- ALL TESTS PASSED SUCCESSFULLY! ---');
  process.exit(0);
}

runTests().catch(err => {
  console.error('TEST ERROR:', err);
  process.exit(1);
});
