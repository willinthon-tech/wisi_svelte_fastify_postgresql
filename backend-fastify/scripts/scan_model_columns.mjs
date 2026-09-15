import postgres from 'postgres';
import fs from 'fs';

const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function main() {
  // 1. Obtener el mapa de tablas y sus columnas reales actuales
  const cols = await sql`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public';
  `;
  const tableColumns = {};
  for (const c of cols) {
    if (!tableColumns[c.table_name]) tableColumns[c.table_name] = new Set();
    tableColumns[c.table_name].add(c.column_name);
  }

  // 2. Buscar patrones peligrosos comunes en master.model.js
  const masterPath = './backend-fastify/src/models/master.model.js';
  const masterContent = fs.readFileSync(masterPath, 'utf8');
  const lines = masterContent.split('\n');

  console.log(`Total líneas en master.model.js: ${lines.length}`);
  
  // Buscar queries SQL que seleccionen, inserten o comparen columnas viejas
  // Ejemplos comunes de columnas viejas eliminadas:
  const droppedColumns = [
    'sala_id', 'juego_id', 'marca_id', 'modelo_id', 'area_id', 'departamento_id', 
    'cargo_id', 'empleado_id', 'dispositivo_id', 'libro_id', 'mesa_id', 'cliente_id', 
    'user_id', 'rol_id', 'permiso_id', 'modulo_id', 'page_id', 'horario_id', 
    'excepcion_id', 'grupo_id'
  ];

  const issues = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Ignorar comentarios
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

    // Verificar si hay referencias a `id` o `*_id` en contextos SQL
    // e.g. "SELECT id FROM", "WHERE id =", "WHERE l.id =", "INSERT INTO ... (..., sala_id, ...)", ".id = s.id"
    for (const col of droppedColumns) {
      if (line.includes(col)) {
        // Excluir parámetros como data.sala_id o req.query.sala_id si se mapean a sala_uuid
        // Pero si aparece dentro de un template literal sql`...` o en lista de columnas de INSERT/UPDATE
        if (
          line.includes('SELECT') || line.includes('INSERT INTO') || line.includes('UPDATE') ||
          line.includes('SET') || line.includes('WHERE') || line.includes('JOIN') ||
          line.includes('AND') || line.includes('OR') || line.includes('sql`') ||
          line.includes('VALUES') || line.includes('COALESCE')
        ) {
          issues.push({ lineNum: i + 1, col, snippet: line.trim() });
        }
      }
    }

    // Buscar "SELECT id " o "SELECT id," o "id = $" o ".id = "
    if (/\b(SELECT\s+id\b|SELECT\s+.*,\s*id\b|WHERE\s+id\s*=|WHERE\s+\w+\.id\s*=|\.id\s*=\s*\w+\.id)/i.test(line)) {
      if (line.includes('sql`') || line.includes('SELECT') || line.includes('WHERE') || line.includes('JOIN')) {
        issues.push({ lineNum: i + 1, col: 'id (PK vieja)', snippet: line.trim() });
      }
    }
  }

  console.log(`\nSe encontraron ${issues.length} posibles referencias a columnas obsoletas en master.model.js:`);
  // Mostrar los primeros 30
  for (const issue of issues.slice(0, 35)) {
    console.log(`Línea ${issue.lineNum} [${issue.col}]: ${issue.snippet}`);
  }

  await sql.end();
}

main().catch(console.error);
