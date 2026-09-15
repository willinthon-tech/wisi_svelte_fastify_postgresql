import postgres from 'postgres';

const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function main() {
  const tables = ['permissions', 'ciclos', 'ciclo_turnos', 'ciclo_empleados', 'horarios', 'config_marcas', 'config_modelos', 'config_juegos', 'maquinas', 'llaves', 'mesas', 'libros'];
  for (const t of tables) {
    const cols = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = ${t}
      ORDER BY ordinal_position;
    `;
    console.log(`=== ${t} ===`);
    console.log(cols.map(c => `${c.column_name} (${c.data_type})`).join(', '));
  }
  await sql.end();
}

main().catch(console.error);
