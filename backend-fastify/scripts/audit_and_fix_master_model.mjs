import fs from 'fs';

const droppedCols = [
  'id',
  'sala_id', 'cargo_id', 'area_id', 'departamento_id', 'juego_id', 'marca_id',
  'dispositivo_id', 'mesa_id', 'cliente_id', 'libro_id', 'metodo_pago_id',
  'rango_id', 'tipo_incidencia_id', 'tipo_cliente_id', 'grupo_id', 'page_id',
  'user_id', 'module_id', 'permission_id', 'estado_id', 'legal_id',
  'modelo_id', 'modo_id', 'sociedad_id', 'tipo_id', 'valor_id', 'horario_id',
  'excepcion_id', 'plantilla_horario_id', 'empleado_id'
];

function auditFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  console.log(`\n========================================`);
  console.log(`AUDITING: ${filePath} (${lines.length} lines)`);
  console.log(`========================================`);

  const issues = [];
  let inSql = false;

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (/sql`|sql\.unsafe\(/.test(line)) inSql = true;

    if (inSql) {
      for (const col of droppedCols) {
        // Match column name in SQL query
        const colRegex = new RegExp(`\\b(FROM|JOIN|INSERT\\s+INTO|UPDATE|SET|SELECT|WHERE|AND|OR|ON|GROUP\\s+BY|ORDER\\s+BY|RETURNING)\\b.*\\b${col}\\b`, 'i');
        const exactColInSql = new RegExp(`([\\s,.(]|^)${col}([\\s,.)=]|$)`);
        if (colRegex.test(trimmed) || exactColInSql.test(trimmed)) {
          // Ignorar comentarios
          if (!trimmed.startsWith('//') && !trimmed.startsWith('*')) {
            // Ignorar variables JS como const id = ... o if (!id)
            if (!/^(const|let|var|function|if|return|\}|\/\*)/.test(trimmed)) {
              issues.push({ lineNum: idx + 1, col, text: trimmed });
            }
          }
        }
      }
      if (line.includes('`') && !line.includes('sql`')) inSql = false;
    }
  });

  console.log(`Total issues found in SQL: ${issues.length}`);
  issues.forEach(iss => console.log(`  L${iss.lineNum} [${iss.col}]: ${iss.text.substring(0, 110)}`));
  return issues;
}

auditFile('c:/new_wisi/backend-fastify/src/models/master.model.js');
auditFile('c:/new_wisi/backend-fastify/src/models/reports.model.js');
