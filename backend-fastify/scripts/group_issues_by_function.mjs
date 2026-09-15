import fs from 'fs';

const masterContent = fs.readFileSync('./backend-fastify/src/models/master.model.js', 'utf8');
const lines = masterContent.split('\n');

const droppedColumns = [
  'sala_id', 'juego_id', 'marca_id', 'modelo_id', 'area_id', 'departamento_id', 
  'cargo_id', 'empleado_id', 'dispositivo_id', 'libro_id', 'mesa_id', 'cliente_id', 
  'user_id', 'rol_id', 'permiso_id', 'modulo_id', 'page_id', 'horario_id', 
  'excepcion_id', 'grupo_id', 'tipo_incidencia_id', 'metodo_pago_id', 'tipo_cliente_id',
  'estado_id', 'sociedad_id', 'valor_id', 'tipo_id', 'modo_id', 'legal_id', 'llave_id'
];

let currentFn = 'TOP LEVEL';
const fnIssues = {};

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_]+)/);
  if (fnMatch) {
    currentFn = fnMatch[1];
  }

  if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

  let hasIssue = false;
  let reason = '';

  for (const col of droppedColumns) {
    if (line.includes(col)) {
      if (
        line.includes('SELECT') || line.includes('INSERT INTO') || line.includes('UPDATE') ||
        line.includes('SET') || line.includes('WHERE') || line.includes('JOIN') ||
        line.includes('AND') || line.includes('OR') || line.includes('sql`') ||
        line.includes('VALUES') || line.includes('COALESCE') || line.includes('RETURNING')
      ) {
        hasIssue = true;
        reason = col;
        break;
      }
    }
  }

  if (!hasIssue) {
    if (/\b(SELECT\s+id\b|SELECT\s+.*,\s*id\b|WHERE\s+id\s*=|WHERE\s+\w+\.id\s*=|\.id\s*=\s*\w+\.id)/i.test(line)) {
      if (line.includes('sql`') || line.includes('SELECT') || line.includes('WHERE') || line.includes('JOIN')) {
        hasIssue = true;
        reason = 'id (PK vieja)';
      }
    }
  }

  if (hasIssue) {
    if (!fnIssues[currentFn]) fnIssues[currentFn] = { count: 0, startLine: i + 1, endLine: i + 1, items: [] };
    fnIssues[currentFn].count++;
    fnIssues[currentFn].endLine = i + 1;
    fnIssues[currentFn].items.push({ line: i + 1, reason, snippet: line.trim() });
  }
}

fs.writeFileSync('./backend-fastify/scripts/model_issues_by_fn.json', JSON.stringify(fnIssues, null, 2));
console.log(`Guardado en model_issues_by_fn.json (${Object.keys(fnIssues).length} funciones)`);
