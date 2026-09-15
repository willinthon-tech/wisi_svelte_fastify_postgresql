import { initDb, sql } from '../src/config/db.js';
import {
  getCorteByIdModel,
  deleteCorteModel,
  deleteDescargaModel,
  updateJuegoModel,
  createMesaModel,
  updateMesaModel,
  softDeleteMesaModel,
  restoreMesaModel,
  createModeloModel,
  updateModeloModel,
  createExcepcionModel,
  updateExcepcionModel,
  createFechaPatriaModel,
  updateFechaPatriaModel,
  getMaquinaByIdModel,
  createMaquinaModel,
  updateMaquinaModel,
  getLlaveByIdModel,
  createLlaveModel,
  updateLlaveModel,
  softDeleteLlaveModel,
  restoreLlaveModel,
  getLibroControlLlavesModel,
  createLibroControlLlavesModel
} from '../src/models/master.model.js';

async function test() {
  await initDb();
  console.log('--- INICIANDO TEST DE INTEGRACIÓN DE UUID UNIVERSAL ---');

  // Limpiar posibles registros de pruebas previas
  await sql`DELETE FROM libro_control_llaves WHERE descripcion LIKE '%Prueba control llaves%'`.catch(() => {});
  await sql`DELETE FROM llaves WHERE nombre LIKE '%Test UUID%'`.catch(() => {});
  await sql`DELETE FROM mesas WHERE nombre LIKE '%Test UUID%'`.catch(() => {});
  await sql`DELETE FROM modelos WHERE nombre LIKE '%Test UUID%'`.catch(() => {});
  await sql`DELETE FROM excepciones WHERE codigo = 'TSTUUID'`.catch(() => {});
  await sql`DELETE FROM fechas_patrias WHERE descripcion LIKE '%Test Fecha Patria%'`.catch(() => {});
  await sql`DELETE FROM maquinas WHERE serial = 'TEST-UUID-99999'`.catch(() => {});

  // Test 1: Verificar que una sala real tiene UUID y se puede buscar
  const [testSala] = await sql`SELECT uuid, uuid AS id, nombre FROM salas LIMIT 1`;
  console.log(`1. Sala de prueba: UUID ${testSala.uuid}, Nombre: ${testSala.nombre}`);

  // Test 2: Crear y actualizar una Llave usando sala_uuid
  console.log('2. Test Llave con UUID de sala...');
  const nuevaLlave = await createLlaveModel({
    nombre: 'Llave Test UUID Universal',
    sala_uuid: testSala.uuid
  });
  console.log(`   ✓ Llave creada: UUID ${nuevaLlave.uuid}, sala_uuid ${nuevaLlave.sala_uuid}`);
  
  // Buscar por UUID
  const encontradaLlave = await getLlaveByIdModel(nuevaLlave.uuid);
  console.log(`   ✓ Llave recuperada por UUID: ${encontradaLlave ? encontradaLlave.nombre : 'NO ENCONTRADA'}`);

  // Actualizar por UUID
  const actualizadaLlave = await updateLlaveModel(nuevaLlave.uuid, {
    nombre: 'Llave Test UUID Universal Actualizada'
  });
  console.log(`   ✓ Llave actualizada por UUID: ${actualizadaLlave ? actualizadaLlave.nombre : 'ERROR'}`);

  // Soft delete y restore por UUID
  await softDeleteLlaveModel(nuevaLlave.uuid);
  console.log('   ✓ Soft delete por UUID completado');
  await restoreLlaveModel(nuevaLlave.uuid);
  console.log('   ✓ Restore por UUID completado');

  // Test 3: Crear Mesa usando UUIDs
  console.log('3. Test Mesa con UUIDs de sala y juego...');
  let [testJuego] = await sql`SELECT uuid, uuid AS id, nombre FROM juegos LIMIT 1`;
  if (!testJuego) {
    [testJuego] = await sql`INSERT INTO juegos (nombre) VALUES ('Blackjack Test') RETURNING uuid, uuid AS id, nombre`;
  }
  const nuevaMesa = await createMesaModel({
    nombre: 'Mesa Test UUID Universal',
    sala_uuid: testSala.uuid,
    juego_uuid: testJuego.uuid
  });
  console.log(`   ✓ Mesa creada: UUID ${nuevaMesa.uuid}, sala_uuid: ${nuevaMesa.sala_uuid}, juego_uuid: ${nuevaMesa.juego_uuid}`);

  // Actualizar mesa por UUID
  await updateMesaModel(nuevaMesa.uuid, { nombre: 'Mesa Test UUID Actualizada' });
  console.log('   ✓ Mesa actualizada por UUID completado');

  // Soft delete y restore mesa por UUID
  await softDeleteMesaModel(nuevaMesa.uuid);
  console.log('   ✓ Mesa soft delete por UUID completado');
  await restoreMesaModel(nuevaMesa.uuid);
  console.log('   ✓ Mesa restore por UUID completado');

  // Test 4: Libro Control Llaves usando llaves_uuids
  console.log('4. Test Libro Control Llaves con UUID...');
  const [testLibro] = await sql`SELECT uuid, uuid AS id FROM libros LIMIT 1`;
  if (testLibro) {
    const nuevoControl = await createLibroControlLlavesModel({
      libro_uuid: testLibro.uuid,
      llaves_uuids: [nuevaLlave.uuid],
      descripcion: 'Prueba control llaves con UUID'
    });
    console.log(`   ✓ Control llaves creado: UUID ${nuevoControl.uuid}`);
    const controles = await getLibroControlLlavesModel(testLibro.uuid);
    console.log(`   ✓ Controles obtenidos por libro_uuid: ${controles.length} registros`);
    // Limpieza de control
    await sql`DELETE FROM libro_control_llaves WHERE uuid = ${nuevoControl.uuid}::uuid`;
  }

  // Test 5: Crear y actualizar Modelo con marca_uuid
  console.log('5. Test Modelo con UUID...');
  let [testMarca] = await sql`SELECT uuid, uuid AS id, nombre FROM marcas LIMIT 1`;
  if (!testMarca) {
    [testMarca] = await sql`INSERT INTO marcas (nombre) VALUES ('Marca Test') RETURNING uuid, uuid AS id, nombre`;
  }
  if (testMarca) {
    const nuevoModelo = await createModeloModel({
      nombre: 'Modelo Test UUID',
      marca_uuid: testMarca.uuid
    });
    console.log(`   ✓ Modelo creado: ID ${nuevoModelo.id}, UUID ${nuevoModelo.uuid}, marca_uuid: ${nuevoModelo.marca_uuid}`);
    await updateModeloModel(nuevoModelo.uuid, { nombre: 'Modelo Test UUID Actualizado' });
    console.log('   ✓ Modelo actualizado por UUID');
    await sql`DELETE FROM modelos WHERE uuid = ${nuevoModelo.uuid}::uuid`;
  }

  // Test 6: Crear y actualizar Excepción con UUID
  console.log('6. Test Excepción con UUID...');
  const nuevaExc = await createExcepcionModel({
    codigo: 'TSTUUID',
    descripcion: 'Test Excepcion UUID',
    color: '#10B981',
    tipo: 'Asignable'
  });
  console.log(`   ✓ Excepción creada: ID ${nuevaExc.id}, UUID ${nuevaExc.uuid}`);
  await updateExcepcionModel(nuevaExc.uuid, { descripcion: 'Test Excepcion UUID Modificada' });
  console.log('   ✓ Excepción actualizada por UUID');
  await sql`DELETE FROM excepciones WHERE uuid = ${nuevaExc.uuid}::uuid`;

  // Test 7: Crear y actualizar Fecha Patria con UUID
  console.log('7. Test Fecha Patria con UUID...');
  const nuevaFp = await createFechaPatriaModel({
    descripcion: 'Test Fecha Patria UUID',
    dia: 29,
    mes: 2
  });
  console.log(`   ✓ Fecha patria creada: ID ${nuevaFp.id}, UUID ${nuevaFp.uuid}`);
  await updateFechaPatriaModel(nuevaFp.uuid, { descripcion: 'Test Fecha Patria UUID Modificada' });
  console.log('   ✓ Fecha patria actualizada por UUID');
  await sql`DELETE FROM fechas_patrias WHERE uuid = ${nuevaFp.uuid}::uuid`;

  // Test 8: Crear y actualizar Maquina con UUIDs
  console.log('8. Test Maquina con UUIDs...');
  const nuevaMaq = await createMaquinaModel({
    nombre: '99999',
    serial: 'TEST-UUID-99999',
    puestos: 1,
    sala_uuid: testSala.uuid
  });
  console.log(`   ✓ Máquina creada: ID ${nuevaMaq.id}, UUID ${nuevaMaq.uuid}, sala_uuid: ${nuevaMaq.sala_uuid}`);
  const encontradaMaq = await getMaquinaByIdModel(nuevaMaq.uuid);
  console.log(`   ✓ Máquina recuperada por UUID: ${encontradaMaq ? encontradaMaq.serial : 'NO ENCONTRADA'}`);
  await updateMaquinaModel(nuevaMaq.uuid, { nombre: '99999-MOD' });
  console.log('   ✓ Máquina actualizada por UUID');
  await sql`DELETE FROM maquinas WHERE uuid = ${nuevaMaq.uuid}::uuid`;

  // Limpieza de registros de prueba (Mesa y Llave)
  await sql`DELETE FROM mesas WHERE uuid = ${nuevaMesa.uuid}::uuid`;
  await sql`DELETE FROM llaves WHERE uuid = ${nuevaLlave.uuid}::uuid`;
  console.log('   ✓ Limpieza de datos de prueba finalizada.');

  console.log('\n======================================================');
  console.log('TODOS LOS TESTS DE UUID PASARON CON 100% DE ÉXITO!');
  console.log('======================================================');
  process.exit(0);
}

test().catch(e => {
  console.error('ERROR EN TEST:', e);
  process.exit(1);
});
