import fs from 'fs';
import path from 'path';

const sqlPath = 'c:/new_wisi/data.sql';
const sqlContent = fs.readFileSync(sqlPath, 'utf8');

const salasDirBackend = 'c:/new_wisi/backend-fastify/salas';

if (!fs.existsSync(salasDirBackend)) fs.mkdirSync(salasDirBackend, { recursive: true });

const lines = sqlContent.split('\n');

for (const line of lines) {
  // Pattern: (id, 'nombre', ..., 'data:image/...;base64,...'
  const match = line.match(/\((\d+),\s*'([^']+)',\s*'[^']+',\s*'[^']+',\s*'(data:image\/[a-zA-Z]+;base64,[^']+)'/);
  if (match) {
    const id = match[1];
    const nombre = match[2];
    const dataUri = match[3];
    
    console.log(`Encontrado logo para Sala ID ${id} (${nombre}), longitud: ${dataUri.length}`);

    // Extraer base64 y tipo
    const commaIdx = dataUri.indexOf(',');
    const base64Data = dataUri.substring(commaIdx + 1);
    const buffer = Buffer.from(base64Data, 'base64');
    
    const backendFilePng = path.join(salasDirBackend, `${id}.png`);
    fs.writeFileSync(backendFilePng, buffer);

    console.log(`Guardado en backend: ${backendFilePng} (${buffer.length} bytes)`);
  }
}
