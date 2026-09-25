#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, '..');
const projectRootDir = path.resolve(frontendDir, '..');
const outputDir = path.resolve(projectRootDir, 'app-versiones');

// Parsear argumentos de línea de comandos (ej: -v 8, -v=8, --windows, --android, --all)
const args = process.argv.slice(2);
let targetVersionNum = null;
let buildWindows = false;
let buildAndroid = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-v' || arg === '--version') {
    if (args[i + 1]) {
      const match = String(args[i + 1]).match(/(\d+)/);
      if (match) targetVersionNum = parseInt(match[1], 10);
      i++;
    }
  } else if (arg.startsWith('-v=') || arg.startsWith('--version=')) {
    const val = arg.split('=')[1];
    const match = String(val).match(/(\d+)/);
    if (match) targetVersionNum = parseInt(match[1], 10);
  } else if (/^v?(\d+)$/i.test(arg)) {
    const match = arg.match(/(\d+)/);
    if (match) targetVersionNum = parseInt(match[1], 10);
  } else if (arg === '--windows' || arg === '-w') {
    buildWindows = true;
  } else if (arg === '--android' || arg === '-a') {
    buildAndroid = true;
  } else if (arg === '--all') {
    buildWindows = true;
    buildAndroid = true;
  }
}

// Si no especificó plataforma, construir ambas por defecto
if (!buildWindows && !buildAndroid) {
  buildWindows = true;
  buildAndroid = true;
}

// Si no especificó versión, auto-incrementar leyendo package.json
const pkgPath = path.join(frontendDir, 'package.json');
let currentPkg = { version: '6.0.0' };
try {
  currentPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
} catch (_) {}

if (!targetVersionNum) {
  const curMatch = String(currentPkg.version || '').match(/(\d+)/);
  const curNum = curMatch ? parseInt(curMatch[1], 10) : 6;
  targetVersionNum = curNum + 1;
}

const semverStr = `${targetVersionNum}.0.0`;
const versionTag = `v${targetVersionNum}`;
const buildTimestamp = Date.now();

console.log('\n===============================================================');
console.log(`  🚀 INICIANDO GENERACIÓN DE INSTALADORES WISI SPACE (${versionTag})`);
console.log('===============================================================');
console.log(`  📌 Versión objetivo:      ${versionTag} (${semverStr})`);
console.log(`  🕒 Timestamp de build:    ${buildTimestamp}`);
console.log(`  📁 Carpeta de salida:     ${outputDir}`);
console.log(`  🎯 Plataformas a crear:   ${buildWindows ? '🪟 Windows (.EXE) ' : ''}${buildAndroid ? '🤖 Android (.APK)' : ''}`);
console.log('===============================================================\n');

// 1. Asegurar carpeta de salida app-versiones
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 2. Sincronizar frontend-svelte/package.json
try {
  currentPkg.version = semverStr;
  fs.writeFileSync(pkgPath, JSON.stringify(currentPkg, null, 2) + '\n');
  console.log(`✔ package.json actualizado -> version: "${semverStr}"`);
} catch (e) {
  console.warn('Advertencia al actualizar package.json:', e.message);
}

// 3. Sincronizar frontend-svelte/src-tauri/tauri.conf.json
const tauriConfPath = path.join(frontendDir, 'src-tauri', 'tauri.conf.json');
try {
  if (fs.existsSync(tauriConfPath)) {
    const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf-8'));
    tauriConf.version = semverStr;
    fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
    console.log(`✔ tauri.conf.json actualizado -> version: "${semverStr}"`);
  }
} catch (e) {
  console.warn('Advertencia al actualizar tauri.conf.json:', e.message);
}

// 4. Sincronizar frontend-svelte/src-tauri/Cargo.toml
const cargoTomlPath = path.join(frontendDir, 'src-tauri', 'Cargo.toml');
try {
  if (fs.existsSync(cargoTomlPath)) {
    let cargoContent = fs.readFileSync(cargoTomlPath, 'utf-8');
    cargoContent = cargoContent.replace(/version\s*=\s*"[^"]*"/, `version = "${semverStr}"`);
    fs.writeFileSync(cargoTomlPath, cargoContent);
    console.log(`✔ Cargo.toml actualizado -> version: "${semverStr}"`);
  }
} catch (e) {
  console.warn('Advertencia al actualizar Cargo.toml:', e.message);
}

// 5. Sincronizar frontend-svelte/index.html
const indexHtmlPath = path.join(frontendDir, 'index.html');
try {
  if (fs.existsSync(indexHtmlPath)) {
    let htmlContent = fs.readFileSync(indexHtmlPath, 'utf-8');
    if (htmlContent.includes('name="app-version"')) {
      htmlContent = htmlContent.replace(/<meta\s+name=["']app-version["']\s+content=["'][^"']*["']\s*\/?>/i, `<meta name="app-version" content="${versionTag}" />`);
    } else {
      htmlContent = htmlContent.replace('</head>', `    <meta name="app-version" content="${versionTag}" />\n  </head>`);
    }

    if (htmlContent.includes('name="app-version-num"')) {
      htmlContent = htmlContent.replace(/<meta\s+name=["']app-version-num["']\s+content=["'][^"']*["']\s*\/?>/i, `<meta name="app-version-num" content="${targetVersionNum}" />`);
    } else {
      htmlContent = htmlContent.replace('</head>', `    <meta name="app-version-num" content="${targetVersionNum}" />\n  </head>`);
    }

    if (htmlContent.includes('name="build-time"')) {
      htmlContent = htmlContent.replace(/<meta\s+name=["']build-time["']\s+content=["'][^"']*["']\s*\/?>/i, `<meta name="build-time" content="${buildTimestamp}" />`);
    } else {
      htmlContent = htmlContent.replace('</head>', `    <meta name="build-time" content="${buildTimestamp}" />\n  </head>`);
    }
    fs.writeFileSync(indexHtmlPath, htmlContent);
    console.log(`✔ index.html actualizado -> meta: ${versionTag} (num: ${targetVersionNum})`);
  }
} catch (e) {
  console.warn('Advertencia al actualizar index.html:', e.message);
}

// 6. Sincronizar frontend-svelte/android/app/build.gradle
const buildGradlePath = path.join(frontendDir, 'android', 'app', 'build.gradle');
try {
  if (fs.existsSync(buildGradlePath)) {
    let gradleContent = fs.readFileSync(buildGradlePath, 'utf-8');
    gradleContent = gradleContent
      .replace(/versionCode\s+\d+/, `versionCode ${targetVersionNum}`)
      .replace(/versionName\s+"[^"]*"/, `versionName "${targetVersionNum}.0"`);
    fs.writeFileSync(buildGradlePath, gradleContent);
    console.log(`✔ android/app/build.gradle actualizado -> versionCode ${targetVersionNum}, versionName "${targetVersionNum}.0"`);
  }
} catch (e) {
  console.warn('Advertencia al actualizar build.gradle:', e.message);
}

// 7. Compilar bundle web (Vite)
console.log('\n⚙️ [1/3] Compilando aplicación web con Vite...');
try {
  execSync('npm run build', { cwd: frontendDir, stdio: 'inherit' });
  console.log('✔ Compilación Vite completada.');
} catch (e) {
  console.error('❌ Error en compilación de Vite.');
  process.exit(1);
}

// 8. Compilar instalador de Windows (.EXE) con Tauri
if (buildWindows) {
  console.log('\n⚙️ [2/3] Compilando instalador de Windows con Tauri...');
  try {
    execSync('npm run build:windows', { cwd: frontendDir, stdio: 'inherit' });

    // Buscar el instalador NSIS generado
    const nsisDir = path.join(frontendDir, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
    let generatedExe = null;
    if (fs.existsSync(nsisDir)) {
      const files = fs.readdirSync(nsisDir).filter(f => f.toLowerCase().endsWith('.exe'));
      if (files.length > 0) {
        // Ordenar por fecha más reciente
        files.sort((a, b) => fs.statSync(path.join(nsisDir, b)).mtimeMs - fs.statSync(path.join(nsisDir, a)).mtimeMs);
        generatedExe = path.join(nsisDir, files[0]);
      }
    }

    if (generatedExe && fs.existsSync(generatedExe)) {
      const destExeName = `app-wisi-windows-v${targetVersionNum}.exe`;
      const destExePath = path.join(outputDir, destExeName);
      fs.copyFileSync(generatedExe, destExePath);
      const sizeMb = (fs.statSync(destExePath).size / (1024 * 1024)).toFixed(2);
      console.log(`\n🎉 ✔ INSTALADOR WINDOWS COPIADO:`);
      console.log(`   -> ${destExePath} (${sizeMb} MB)`);
    } else {
      console.warn('⚠️ No se encontró el archivo .exe en src-tauri/target/release/bundle/nsis/');
    }
  } catch (e) {
    console.error('❌ Error compilando Windows con Tauri:', e.message);
  }
}

// 9. Sincronizar y compilar APK de Android (.APK) con Gradle
if (buildAndroid) {
  console.log('\n⚙️ [3/3] Sincronizando y compilando APK de Android...');
  try {
    execSync('npx cap sync android', { cwd: frontendDir, stdio: 'inherit' });

    const androidDir = path.join(frontendDir, 'android');
    const gradlewCmd = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';
    
    console.log('   Compilando con Gradle (assembleDebug)...');
    execSync(`${gradlewCmd} assembleDebug`, { cwd: androidDir, stdio: 'inherit' });

    const candidateApkPaths = [
      path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
      path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk'),
      path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
    ];

    let foundApk = null;
    for (const p of candidateApkPaths) {
      if (fs.existsSync(p)) {
        foundApk = p;
        break;
      }
    }

    if (foundApk) {
      const destApkName = `app-wisi-android-v${targetVersionNum}.apk`;
      const destApkPath = path.join(outputDir, destApkName);
      fs.copyFileSync(foundApk, destApkPath);
      const sizeMb = (fs.statSync(destApkPath).size / (1024 * 1024)).toFixed(2);
      console.log(`\n🎉 ✔ INSTALADOR ANDROID COPIADO:`);
      console.log(`   -> ${destApkPath} (${sizeMb} MB)`);
    } else {
      console.warn('⚠️ No se encontró el archivo .apk generado en android/app/build/outputs/apk/');
    }
  } catch (e) {
    console.error('❌ Error compilando APK de Android:', e.message);
  }
}

console.log('\n===============================================================');
console.log(`  🎉 ¡PROCESO DE GENERACIÓN FINALIZADO PARA LA VERSIÓN ${versionTag}!`);
console.log('===============================================================');
console.log(`  📁 Carpeta local: ${outputDir}`);
if (buildWindows) console.log(`     🪟 Windows: app-wisi-windows-v${targetVersionNum}.exe`);
if (buildAndroid) console.log(`     🤖 Android: app-wisi-android-v${targetVersionNum}.apk`);
console.log('===============================================================\n');
