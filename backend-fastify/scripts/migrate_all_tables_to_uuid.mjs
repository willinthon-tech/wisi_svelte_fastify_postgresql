import postgres from 'postgres';

const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function main() {
  console.log('--- PASO 1: Asegurando UUIDs en todas las tablas restantes ---');

  const tablesToAddUuid = [
    'attlogs',
    'empleado_dispositivos',
    'grupo_salas',
    'permissions',
    'user_module_permissions',
    'user_salas',
    'fcm_tokens',
    'empleados_horarios',
    'empleados_excepciones_horarios',
    'drop_mesas',
    'wisi_items'
  ];

  for (const table of tablesToAddUuid) {
    await sql.unsafe(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS uuid UUID DEFAULT gen_random_uuid();`);
    await sql.unsafe(`UPDATE "${table}" SET uuid = gen_random_uuid() WHERE uuid IS NULL;`);
    console.log(`Tabla ${table}: uuid agregado y asegurado.`);
  }

  console.log('\n--- PASO 2: Backfill de FKs UUID en tablas restantes ---');

  // grupo_salas -> salas
  await sql`ALTER TABLE salas ADD COLUMN IF NOT EXISTS grupo_uuid UUID;`;
  await sql`UPDATE salas s SET grupo_uuid = g.uuid FROM grupo_salas g WHERE s.grupo_id = g.id AND s.grupo_uuid IS NULL;`;
  console.log('salas.grupo_uuid backfilled.');

  // attlogs -> empleados
  await sql`ALTER TABLE attlogs ADD COLUMN IF NOT EXISTS empleado_uuid UUID;`;
  await sql`UPDATE attlogs a SET empleado_uuid = e.uuid FROM empleados e WHERE a.employee_no = e.cedula AND a.empleado_uuid IS NULL;`;
  console.log('attlogs.empleado_uuid backfilled.');

  // user_module_permissions
  await sql`ALTER TABLE user_module_permissions ADD COLUMN IF NOT EXISTS user_uuid UUID;`;
  await sql`ALTER TABLE user_module_permissions ADD COLUMN IF NOT EXISTS module_uuid UUID;`;
  await sql`ALTER TABLE user_module_permissions ADD COLUMN IF NOT EXISTS permission_uuid UUID;`;
  await sql`UPDATE user_module_permissions ump SET user_uuid = u.uuid FROM usuarios u WHERE ump.user_id = u.id AND ump.user_uuid IS NULL;`;
  await sql`UPDATE user_module_permissions ump SET module_uuid = m.uuid FROM modulos m WHERE ump.module_id = m.id AND ump.module_uuid IS NULL;`;
  await sql`UPDATE user_module_permissions ump SET permission_uuid = p.uuid FROM permissions p WHERE ump.permission_id = p.id AND ump.permission_uuid IS NULL;`;
  console.log('user_module_permissions UUIDs backfilled.');

  // user_salas
  await sql`ALTER TABLE user_salas ADD COLUMN IF NOT EXISTS user_uuid UUID;`;
  await sql`ALTER TABLE user_salas ADD COLUMN IF NOT EXISTS sala_uuid UUID;`;
  await sql`UPDATE user_salas us SET user_uuid = u.uuid FROM usuarios u WHERE us.user_id = u.id AND us.user_uuid IS NULL;`;
  await sql`UPDATE user_salas us SET sala_uuid = s.uuid FROM salas s WHERE us.sala_id = s.id AND us.sala_uuid IS NULL;`;
  console.log('user_salas UUIDs backfilled.');

  // fcm_tokens
  await sql`ALTER TABLE fcm_tokens ADD COLUMN IF NOT EXISTS user_uuid UUID;`;
  await sql`UPDATE fcm_tokens ft SET user_uuid = u.uuid FROM usuarios u WHERE ft.user_id = u.id AND ft.user_uuid IS NULL;`;
  console.log('fcm_tokens UUIDs backfilled.');

  // empleados_horarios
  await sql`ALTER TABLE empleados_horarios ADD COLUMN IF NOT EXISTS empleado_uuid UUID;`;
  await sql`ALTER TABLE empleados_horarios ADD COLUMN IF NOT EXISTS horario_uuid UUID;`;
  await sql`UPDATE empleados_horarios eh SET empleado_uuid = e.uuid FROM empleados e WHERE eh.empleado_id = e.id AND eh.empleado_uuid IS NULL;`;
  await sql`UPDATE empleados_horarios eh SET horario_uuid = h.uuid FROM horarios h WHERE eh.horario_id = h.id AND eh.horario_uuid IS NULL;`;
  console.log('empleados_horarios UUIDs backfilled.');

  // empleados_excepciones_horarios
  await sql`ALTER TABLE empleados_excepciones_horarios ADD COLUMN IF NOT EXISTS empleado_uuid UUID;`;
  await sql`ALTER TABLE empleados_excepciones_horarios ADD COLUMN IF NOT EXISTS excepcion_uuid UUID;`;
  await sql`ALTER TABLE empleados_excepciones_horarios ADD COLUMN IF NOT EXISTS horario_uuid UUID;`;
  await sql`UPDATE empleados_excepciones_horarios eeh SET empleado_uuid = e.uuid FROM empleados e WHERE eeh.empleado_id = e.id AND eeh.empleado_uuid IS NULL;`;
  await sql`UPDATE empleados_excepciones_horarios eeh SET excepcion_uuid = ex.uuid FROM excepciones ex WHERE eeh.excepcion_id = ex.id AND eeh.excepcion_uuid IS NULL;`;
  await sql`UPDATE empleados_excepciones_horarios eeh SET horario_uuid = h.uuid FROM horarios h WHERE eeh.horario_id = h.id AND eeh.horario_uuid IS NULL;`;
  console.log('empleados_excepciones_horarios UUIDs backfilled.');

  // drop_mesas
  await sql`ALTER TABLE drop_mesas ADD COLUMN IF NOT EXISTS libro_uuid UUID;`;
  await sql`ALTER TABLE drop_mesas ADD COLUMN IF NOT EXISTS mesa_uuid UUID;`;
  await sql`UPDATE drop_mesas dm SET libro_uuid = l.uuid FROM libros l WHERE dm.libro_id = l.id AND dm.libro_uuid IS NULL;`;
  await sql`UPDATE drop_mesas dm SET mesa_uuid = m.uuid FROM mesas m WHERE dm.mesa_id = m.id AND dm.mesa_uuid IS NULL;`;
  console.log('drop_mesas UUIDs backfilled.');

  console.log('\n--- VERIFICANDO QUE EL 100% DE TABLAS TENGAN UUID ---');
  const allTables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `;
  for (const t of allTables) {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = ${t.table_name} AND column_name = 'uuid';
    `;
    if (cols.length === 0 && t.table_name !== 'configuracion') {
      console.warn(`ALERTA: Tabla ${t.table_name} no tiene uuid.`);
    }
  }

  console.log('\nProceso de poblado universal de UUID completado con exito.');
  await sql.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
