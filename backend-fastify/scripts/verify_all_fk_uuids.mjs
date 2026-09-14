import postgres from 'postgres';

const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function main() {
  console.log('--- VERIFICACION DE ORFANOS EN CLAVES FORANEAS UUID ---');

  const checks = [
    { table: 'areas', col: 'departamento_uuid', parentTable: 'departamentos', parentIdCol: 'departamento_id' },
    { table: 'cargos', col: 'area_uuid', parentTable: 'areas', parentIdCol: 'area_id' },
    { table: 'clientes', col: 'sala_uuid', parentTable: 'salas', parentIdCol: 'sala_id' },
    { table: 'clientes', col: 'tipo_cliente_uuid', parentTable: 'tipo_clientes', parentIdCol: 'tipo_cliente_id' },
    { table: 'departamentos', col: 'sala_uuid', parentTable: 'salas', parentIdCol: 'sala_id' },
    { table: 'dispositivos', col: 'sala_uuid', parentTable: 'salas', parentIdCol: 'sala_id' },
    { table: 'empleados', col: 'cargo_uuid', parentTable: 'cargos', parentIdCol: 'cargo_id' },
    { table: 'empleado_dispositivos', col: 'empleado_uuid', parentTable: 'empleados', parentIdCol: 'empleado_id' },
    { table: 'empleado_dispositivos', col: 'dispositivo_uuid', parentTable: 'dispositivos', parentIdCol: 'dispositivo_id' },
    { table: 'feriados', col: 'sala_uuid', parentTable: 'salas', parentIdCol: 'sala_id' },
    { table: 'libros', col: 'sala_uuid', parentTable: 'salas', parentIdCol: 'sala_id' },
    { table: 'modulos', col: 'page_uuid', parentTable: 'paginas', parentIdCol: 'page_id' },
    { table: 'modelos', col: 'marca_uuid', parentTable: 'marcas', parentIdCol: 'marca_id' },
    { table: 'user_salas', col: 'user_uuid', parentTable: 'usuarios', parentIdCol: 'user_id' },
    { table: 'user_salas', col: 'sala_uuid', parentTable: 'salas', parentIdCol: 'sala_id' },
    { table: 'user_module_permissions', col: 'user_uuid', parentTable: 'usuarios', parentIdCol: 'user_id' },
    { table: 'user_module_permissions', col: 'module_uuid', parentTable: 'modulos', parentIdCol: 'module_id' },
    { table: 'user_module_permissions', col: 'permission_uuid', parentTable: 'permissions', parentIdCol: 'permission_id' },
    { table: 'salas', col: 'grupo_uuid', parentTable: 'grupo_salas', parentIdCol: 'grupo_id' }
  ];

  for (const c of checks) {
    const q = await sql.unsafe(`
      SELECT count(*) FROM "${c.table}" 
      WHERE "${c.col}" IS NULL AND "${c.parentIdCol}" IS NOT NULL
    `);
    const count = parseInt(q[0].count);
    console.log(`  ${c.table}.${c.col} (de ${c.parentTable}): ${count === 0 ? 'CORRECTO (0 huérfanos)' : `ALERTA: ${count} huerfanos`}`);
  }

  await sql.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
