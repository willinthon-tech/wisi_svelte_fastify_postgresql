import fs from 'fs';

const droppedCols = [
  'id',
  'sala_id', 'cargo_id', 'area_id', 'departamento_id', 'juego_id', 'marca_id',
  'dispositivo_id', 'mesa_id', 'cliente_id', 'libro_id', 'metodo_pago_id',
  'rango_id', 'tipo_incidencia_id', 'tipo_cliente_id', 'grupo_id', 'page_id',
  'user_id', 'module_id', 'permission_id', 'estado_id', 'legal_id',
  'modelo_id', 'modo_id', 'sociedad_id', 'tipo_id', 'valor_id'
];

const content = fs.readFileSync('c:/new_wisi/backend-fastify/src/models/master.model.js', 'utf8');
const lines = content.split('\n');

let currentFn = 'TOP';
const fnIssues = new Map();

lines.forEach((line, idx) => {
  const fnMatch = line.match(/export\s+async\s+function\s+([a-zA-Z0-9_]+)/);
  if (fnMatch) currentFn = fnMatch[1];

  if (/sql`|sql\.unsafe\(/.test(line)) {
    droppedCols.forEach(col => {
      // Look for table.col or col = or col, or col) in SQL
      const regex = new RegExp(`(\\b[a-z_]+\\.|\\bWHERE\\s+|\\bAND\\s+|\\bOR\\s+|\\bSET\\s+|\\bSELECT\\s+|,\\s*|\\()${col}\\b(\\s*[,=)]|\\s+AS|\\s+FROM|\\s+LIMIT|$)`, 'i');
      if (regex.test(line) && !line.trim().startsWith('//')) {
        // Exclude alias `uuid AS id` or `*_uuid AS *_id`
        if (!line.includes(`AS ${col}`) && !line.includes(`AS id`)) {
          if (!fnIssues.has(currentFn)) fnIssues.set(currentFn, []);
          fnIssues.get(currentFn).push({ line: idx + 1, col, text: line.trim() });
        }
      }
    });
  }
});

console.log(`Functions with SQL referencing dropped columns: ${fnIssues.size}`);
for (const [fn, issues] of fnIssues.entries()) {
  console.log(`\nFunction: ${fn} (${issues.length} issues)`);
  issues.slice(0, 3).forEach(iss => console.log(`  L${iss.line} [${iss.col}]: ${iss.text}`));
}
