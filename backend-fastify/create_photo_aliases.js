import { initDb, sql } from './src/config/db.js';
import fs from 'fs';
import path from 'path';

export async function createEmployeePhotoAliases() {
  console.log("=== CREANDO ALIASES/ENLACES DE FOTOS DE EMPLEADOS POR CÉDULA ===");
  const empleadosDir = path.join(process.cwd(), 'empleados');
  if (!fs.existsSync(empleadosDir)) {
    console.log("Directorio empleados no existe");
    return;
  }

  const employees = await sql`SELECT id, cedula, foto FROM empleados WHERE cedula IS NOT NULL`;
  let linked = 0;

  for (const emp of employees) {
    const idFile = path.join(empleadosDir, `${emp.id}.jpg`);
    if (!fs.existsSync(idFile)) continue;

    const cleanCed = String(emp.cedula).replace(/^#/, '').trim().toUpperCase();
    const noVCed = cleanCed.replace(/^V/, '');

    const candidates = [
      `${cleanCed}.jpg`,
      `${noVCed}.jpg`,
      `V${noVCed}.jpg`
    ];

    for (const cand of candidates) {
      const targetPath = path.join(empleadosDir, cand);
      if (!fs.existsSync(targetPath)) {
        try {
          // Copiar o crear enlace duro
          fs.copyFileSync(idFile, targetPath);
          linked++;
        } catch (e) {
          // Si falla, continuar
        }
      }
    }
  }

  console.log(`Creados ${linked} archivos/aliases por cédula en ${empleadosDir}`);
}

if (process.argv[1]?.endsWith('create_photo_aliases.js')) {
  initDb()
    .then(createEmployeePhotoAliases)
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
