import fs from 'fs';

const masterPath = './backend-fastify/src/models/master.model.js';
const content = fs.readFileSync(masterPath, 'utf8');
const lines = content.split('\n');

const droppedColumns = [
  'sala_id', 'juego_id', 'marca_id', 'modelo_id', 'area_id', 'departamento_id', 
  'cargo_id', 'empleado_id', 'dispositivo_id', 'libro_id', 'mesa_id', 'cliente_id', 
  'tipo_cliente_id', 'tipo_incidencia_id', 'metodo_pago_id', 'rango_id',
  'sociedad_id', 'legal_id', 'valor_id', 'tipo_id', 'modo_id', 'estado_id',
  'user_id', 'rol_id', 'permiso_id', 'modulo_id', 'page_id', 'horario_id', 
  'excepcion_id', 'grupo_id', 'llaves_ids'
];

let currentFunc = 'GLOBAL';
const issuesByFunc = {};

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();
  
  const funcMatch = trimmed.match(/export\s+(?:async\s+)?function\s+([a-zA-Z0-9_]+)/) ||
                    trimmed.match(/(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\(/);
  if (funcMatch) {
    currentFunc = funcMatch[1];
  }

  if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

  for (const col of droppedColumns) {
    if (line.includes(col)) {
      if (
        line.includes('SELECT') || line.includes('INSERT INTO') || line.includes('UPDATE') ||
        line.includes('SET') || line.includes('WHERE') || line.includes('JOIN') ||
        line.includes('AND') || line.includes('OR') || line.includes('sql`') ||
        line.includes('VALUES') || line.includes('COALESCE')
      ) {
        if (!issuesByFunc[currentFunc]) issuesByFunc[currentFunc] = [];
        issuesByFunc[currentFunc].push({ line: i + 1, type: col, code: trimmed });
      }
    }
  }

  if (/\b(SELECT\s+id\b|SELECT\s+.*,\s*id\b|WHERE\s+id\s*=|WHERE\s+\w+\.id\s*=|\.id\s*=\s*\w+\.id)/i.test(line)) {
    if (line.includes('sql`') || line.includes('SELECT') || line.includes('WHERE') || line.includes('JOIN')) {
      if (!issuesByFunc[currentFunc]) issuesByFunc[currentFunc] = [];
      issuesByFunc[currentFunc].push({ line: i + 1, type: 'id (PK)', code: trimmed });
    }
  }
}

console.log('--- FUNCIONES CON REFERENCIAS OBSOLETAS ---');
const funcs = Object.keys(issuesByFunc);
console.log(`Total funciones afectadas: ${funcs.length}\n`);

for (const f of funcs) {
  console.log(`Function [${f}] (${issuesByFunc[f].length} incidencias):`);
  for (const item of issuesByFunc[f].slice(0, 5)) {
    console.log(`   L${item.line} [${item.type}]: ${item.code}`);
  }
  if (issuesByFunc[f].length > 5) {
    console.log(`   ... y ${issuesByFunc[f].length - 5} más`);
  }
  console.log('');
}
