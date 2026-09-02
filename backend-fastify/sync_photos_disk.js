import { initDb, sql } from './src/config/db.js';
import fs from 'fs';
import path from 'path';

export async function syncDiskPhotosWithDb() {
  console.log("=== INICIANDO SINCRONIZACIÓN DE FOTOS DE MARCAJES CON EL DISCO ===");
  const attlogsDir = path.join(process.cwd(), 'attlogs');
  if (!fs.existsSync(attlogsDir)) {
    console.log("Carpeta attlogs no existe, marcando todas como has_photo = FALSE");
    await sql`UPDATE attlogs SET has_photo = FALSE WHERE has_photo = TRUE`;
    return { syncedCount: 0 };
  }

  const startTime = Date.now();
  console.log("Leyendo archivos en carpeta attlogs...");
  const files = fs.readdirSync(attlogsDir);
  const photoIds = [];
  for (const f of files) {
    if (f.endsWith('.jpg') || f.endsWith('.jpeg') || f.endsWith('.png')) {
      const id = parseInt(f.replace(/\.[^/.]+$/, ''), 10);
      if (!isNaN(id) && id > 0) {
        photoIds.push(id);
      }
    }
  }

  console.log(`Encontradas ${photoIds.length} fotos reales en el disco.`);

  let setFalseCount = 0;
  let setTrueCount = 0;

  await sql.begin(async (tx) => {
    console.log("Creando tabla temporal para conciliación masiva...");
    await tx`CREATE TEMP TABLE temp_disk_photos (id INT PRIMARY KEY) ON COMMIT DROP`;
    
    // Insert in chunks of 10,000
    const chunkSize = 10000;
    for (let i = 0; i < photoIds.length; i += chunkSize) {
      const chunk = photoIds.slice(i, i + chunkSize);
      await tx`INSERT INTO temp_disk_photos (id) SELECT * FROM UNNEST(${chunk}::int[]) ON CONFLICT DO NOTHING`;
    }

    console.log("Conciliando columna has_photo en attlogs...");
    const resSetFalse = await tx`
      UPDATE attlogs 
      SET has_photo = FALSE 
      WHERE has_photo = TRUE 
        AND id NOT IN (SELECT id FROM temp_disk_photos)
    `;
    setFalseCount = resSetFalse.count;
    console.log(`Marcados ${setFalseCount} registros como has_photo = FALSE (sin archivo en disco).`);

    const resSetTrue = await tx`
      UPDATE attlogs 
      SET has_photo = TRUE 
      WHERE (has_photo = FALSE OR has_photo IS NULL) 
        AND id IN (SELECT id FROM temp_disk_photos)
    `;
    setTrueCount = resSetTrue.count;
    console.log(`Marcados ${setTrueCount} registros como has_photo = TRUE (con archivo en disco).`);
  });

  console.log(`Sincronización completada en ${(Date.now() - startTime) / 1000}s.`);
  return {
    totalDisk: photoIds.length,
    setFalse: setFalseCount,
    setTrue: setTrueCount
  };
}

// Si se ejecuta directamente
if (process.argv[1]?.endsWith('sync_photos_disk.js')) {
  initDb()
    .then(syncDiskPhotosWithDb)
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
