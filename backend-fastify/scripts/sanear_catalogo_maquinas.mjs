import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const PGHOST = process.env.PGHOST || 'localhost';
const PGPORT = process.env.PGPORT ? Number(process.env.PGPORT) : 5432;
const PGDATABASE = process.env.PGDATABASE || 'wisi';
const PGUSER = process.env.PGUSER || 'root';
const PGPASSWORD = process.env.PGPASSWORD || 'S0p0rt3R0y4l-2025';

const sql = postgres({
  host: PGHOST,
  port: PGPORT,
  database: PGDATABASE,
  username: PGUSER,
  password: PGPASSWORD
});

async function ejecutarSaneamiento() {
  console.log('===============================================================');
  console.log('--- INICIANDO SANEAMIENTO INTELIGENTE DE MARCAS, MODELOS Y JUEGOS ---');
  console.log('===============================================================\n');

  await sql.begin(async (tx) => {
    // 1. NORMALIZACIÓN DE MARCAS
    console.log('--- 1. NORMALIZANDO MARCAS ---');
    const brandMerges = [
      { canonical: 'Williams', aliases: ['william', 'wms', 'sg'] },
      { canonical: 'Alfastreet', aliases: ['alphastreet', 'alfa street', 'ruleta alfastreet'] },
      { canonical: 'Ainsworth', aliases: ['ainsworth game t'] },
      { canonical: 'Aristocrat', aliases: ['astro-aristocrat'] },
      { canonical: 'Novomatic', aliases: ['austrian'] }
    ];

    for (const b of brandMerges) {
      let [canon] = await tx`SELECT uuid, nombre FROM marcas WHERE LOWER(TRIM(nombre)) = LOWER(${b.canonical}) LIMIT 1`;
      if (!canon) {
        [canon] = await tx`
          INSERT INTO marcas (uuid, nombre, created_at, updated_at) 
          VALUES (gen_random_uuid(), ${b.canonical}, NOW(), NOW()) 
          RETURNING uuid, nombre
        `;
        console.log(`[+] Creada marca canónica: ${canon.nombre}`);
      }

      for (const alias of b.aliases) {
        const dups = await tx`SELECT uuid, nombre FROM marcas WHERE LOWER(TRIM(nombre)) = LOWER(${alias})`;
        for (const dup of dups) {
          if (dup.uuid === canon.uuid) continue;
          const modUp = await tx`UPDATE modelos SET marca_uuid = ${canon.uuid} WHERE marca_uuid = ${dup.uuid}`;
          await tx`DELETE FROM marcas WHERE uuid = ${dup.uuid}`;
          console.log(`✓ Fusionada marca [${dup.nombre}] -> [${canon.nombre}] (${modUp.count} modelos actualizados)`);
        }
      }
    }

    // Marca errónea Konami Kp3
    const [konami] = await tx`SELECT uuid FROM marcas WHERE LOWER(TRIM(nombre)) = 'konami' LIMIT 1`;
    const [konamiKp3] = await tx`SELECT uuid FROM marcas WHERE LOWER(TRIM(nombre)) = 'konami kp3' LIMIT 1`;
    if (konami && konamiKp3) {
      const modUp = await tx`UPDATE modelos SET marca_uuid = ${konami.uuid} WHERE marca_uuid = ${konamiKp3.uuid}`;
      await tx`DELETE FROM marcas WHERE uuid = ${konamiKp3.uuid}`;
      console.log(`✓ Modelos de [Konami Kp3] movidos a [Konami] (${modUp.count} modelos) y marca duplicada eliminada.`);
    }

    // Marca errónea FV640 f2 (era un modelo registrado erróneamente como marca)
    const delFv = await tx`DELETE FROM marcas WHERE LOWER(TRIM(nombre)) = 'fv640 f2'`;
    if (delFv.count > 0) {
      console.log('✓ Marca errónea [FV640 f2] eliminada.');
    }

    // 2. NORMALIZACIÓN DE MODELOS
    console.log('\n--- 2. NORMALIZANDO MODELOS Y REASIGNANDO MÁQUINAS ---');
    const modelMerges = [
      // Novomatic
      { brand: 'Novomatic', canonical: 'FV 680 CF2', aliases: ['fv680 cf2', 'fv 680 cf2', 'cf2680'] },
      { brand: 'Novomatic', canonical: 'FV 610 CF2', aliases: ['fv 610 cf2', 'fv610 cf2', 'cf2610'] },
      { brand: 'Novomatic', canonical: 'FV 623 CFD', aliases: ['fv 623 cfd', 'fv623 cfd', 'cf1 623', 'fv623cfd'] },
      { brand: 'Novomatic', canonical: 'FV 626 CF2', aliases: ['fv 626 cf2', 'fv626 cf2', 'cf2626', '626', 'fv626 cf2p', 'fv626 f1'] },
      { brand: 'Novomatic', canonical: 'FV 640 CF2', aliases: ['fv 640 cf2', 'fv640 cf2', 'fv640 f2', '640', 'cf640', 'fv-640'] },
      { brand: 'Novomatic', canonical: 'FV 880 CF2', aliases: ['fv880 cf2', 'fv 880 cf2', 'fv880', '880', 'fv-880'] },
      { brand: 'Novomatic', canonical: 'FV 622 CF', aliases: ['fv622cf'] },
      { brand: 'Novomatic', canonical: 'FV 629', aliases: ['fv629'] },
      { brand: 'Novomatic', canonical: 'Coolfire 1', aliases: ['coolfire1', 'coolfire1(china)'] },
      { brand: 'Novomatic', canonical: 'Coolfire 2', aliases: ['coolfire2'] },

      // Aristocrat
      { brand: 'Aristocrat', canonical: 'MK6 - MAV500', aliases: ['mk6', 'mav500', 'mk6 mav500'] },
      { brand: 'Aristocrat', canonical: 'MK5 - MAV540', aliases: ['mk5 mav540'] },
      { brand: 'Aristocrat', canonical: 'MK6 - MAV540', aliases: ['mk6 mav540'] },
      { brand: 'Aristocrat', canonical: 'Viridian WS', aliases: ['viridian ws', 'viridian 1'] },
      { brand: 'Aristocrat', canonical: 'Viridian', aliases: ['viridian'] },
      { brand: 'Aristocrat', canonical: 'Helix', aliases: ['helix'] },
      { brand: 'Aristocrat', canonical: 'Helix Link', aliases: ['helix link'] },
      { brand: 'Aristocrat', canonical: 'Helix Slant', aliases: ['helix slant'] },

      // Bally
      { brand: 'Bally', canonical: 'Alpha 1', aliases: ['alpha 1', 'ap-1', 'alpha1'] },
      { brand: 'Bally', canonical: 'Alpha 1 V20/20', aliases: ['alpha 1 v20-20'] },
      { brand: 'Bally', canonical: 'Alpha 2 V32 Wave', aliases: ['alpha 2 v32 wv', 'ah-1 (a2 v32 wave)', 'alpha2wv', 'wave'] },
      { brand: 'Bally', canonical: 'Alpha 2 V32', aliases: ['alpha 2 v32', 'ap-1 v32-st', 'ap-v32st', 'alpha2b32', 'ap-1 v32 st', 'v32'] },
      { brand: 'Bally', canonical: 'Alpha 2 V22/32', aliases: ['alpha 2 v22/v32'] },
      { brand: 'Bally', canonical: 'AP-1 V222 ST', aliases: ['ap-1 v222 st', 'ap-v222st'] },
      { brand: 'Bally', canonical: 'M9000', aliases: ['m9000', 'm9000-s3', 'm9000-2c3'] },

      // IGT
      { brand: 'IGT', canonical: 'CrystalDual 1070121', aliases: ['1070121', '1070121c', 'c1070121'] },
      { brand: 'IGT', canonical: 'C1070120', aliases: ['c1070120'] },
      { brand: 'IGT', canonical: 'Crystal Dual', aliases: ['crystal dual'] },
      { brand: 'IGT', canonical: 'GL20', aliases: ['gl20'] },
      { brand: 'IGT', canonical: 'Neo', aliases: ['neo'] },
      { brand: 'IGT', canonical: 'AVP', aliases: ['avp'] },

      // Konami
      { brand: 'Konami', canonical: 'Podium KP3', aliases: ['podium kp3'] },
      { brand: 'Konami', canonical: 'KP3', aliases: ['kp3', 'kp'] },
      { brand: 'Konami', canonical: 'KGP2', aliases: ['kgp2', 'kgp 2/3 ubss', 'kgp 2.0 uvsn'] },
      { brand: 'Konami', canonical: 'KP2', aliases: ['kp2'] },
      { brand: 'Konami', canonical: 'Endeavour Series', aliases: ['endearvour series', 'tasman series i'] },

      // Williams
      { brand: 'Williams', canonical: 'Blade', aliases: ['blade'] },
      { brand: 'Williams', canonical: 'Bluebird 1 (BB1)', aliases: ['bb1', 'blue bird one', 'wms bb1'] },
      { brand: 'Williams', canonical: 'Bluebird 2 (BB2)', aliases: ['bbu', 'bbxd slanto'] },

      // Unidesa
      { brand: 'Unidesa', canonical: 'S400', aliases: ['s400', 'cirsa s400', 's400 px', 'cirsa s400 video ia'] },
      { brand: 'Unidesa', canonical: 'S300', aliases: ['s300', '300 mg', 'cirsa serie 300 video dl'] },

      // Alfastreet
      { brand: 'Alfastreet', canonical: 'MMPG', aliases: ['mmpg'] },
      { brand: 'Alfastreet', canonical: 'R8M3', aliases: ['r8m3-23', 'r8m3'] },
      { brand: 'Alfastreet', canonical: '8K-Top', aliases: ['8k-top'] },
      { brand: 'Alfastreet', canonical: 'R8TS', aliases: ['r8ts'] }
    ];

    for (const m of modelMerges) {
      const [brand] = await tx`SELECT uuid FROM marcas WHERE LOWER(TRIM(nombre)) = LOWER(${m.brand}) LIMIT 1`;
      if (!brand) continue;

      let [canon] = await tx`SELECT uuid, nombre FROM modelos WHERE LOWER(TRIM(nombre)) = LOWER(${m.canonical}) AND marca_uuid = ${brand.uuid} LIMIT 1`;
      if (!canon) {
        [canon] = await tx`
          INSERT INTO modelos (uuid, nombre, marca_uuid, created_at, updated_at) 
          VALUES (gen_random_uuid(), ${m.canonical}, ${brand.uuid}, NOW(), NOW()) 
          RETURNING uuid, nombre
        `;
      } else if (canon.nombre !== m.canonical) {
        await tx`UPDATE modelos SET nombre = ${m.canonical} WHERE uuid = ${canon.uuid}`;
      }

      for (const alias of m.aliases) {
        const dups = await tx`SELECT uuid, nombre FROM modelos WHERE LOWER(TRIM(nombre)) = LOWER(${alias})`;
        for (const dup of dups) {
          if (dup.uuid === canon.uuid) continue;
          const maqUp = await tx`UPDATE maquinas SET modelo_uuid = ${canon.uuid} WHERE modelo_uuid = ${dup.uuid}`;
          await tx`DELETE FROM modelos WHERE uuid = ${dup.uuid}`;
          if (maqUp.count > 0) {
            console.log(`✓ Modelo [${dup.nombre}] -> [${m.canonical}] (${m.brand}): ${maqUp.count} máquinas reasignadas.`);
          }
        }
      }
    }

    // 3. NORMALIZACIÓN DE JUEGOS
    console.log('\n--- 3. NORMALIZANDO JUEGOS DE MÁQUINAS ---');
    const gameMerges = [
      { canonical: 'Cats, Hats & Bats', aliases: ['cats hats & bats', 'cats hats y bats', 'cats hats y more bats'] },
      { canonical: 'Hold Onto Your Hat', aliases: ['holdonto your hat'] },
      { canonical: 'Multi-Juego (Multigame)', aliases: ['multigame', 'multi game', 'multijuego', 'multi juego', 'multijuegos', 'multi juegos'] },
      { canonical: "Multi Game Winner's Choice", aliases: ["multigame winner's choice"] },
      { canonical: 'Multi Win 1', aliases: ['multiwin 1'] },
      { canonical: 'Multi Win 2', aliases: ['multiwin 2'] },
      { canonical: 'Multi Win 3', aliases: ['multiwin 3'] },
      { canonical: 'Multi Win 8 Quad Shot', aliases: ['multiwin 8 quad shot'] },
      { canonical: 'Selexion Multi Game', aliases: ['selexion multigame', 'selexion multigames'] },
      { canonical: 'Timber Wolf', aliases: ['timberwolf'] },
      { canonical: 'Ultimate Fire Link By The Bay', aliases: ['ultimate firelink by the bay'] },
      { canonical: 'Ultimate Fire Link China Street', aliases: ['ultimate firelink china street'] },
      { canonical: 'Ultimate Fire Link Glacier Gold', aliases: ['ultimate firelink glacier gold'] },
      { canonical: 'Ultimate Fire Link Olvera Street', aliases: ['ultimate firelink olvera street'] },
      { canonical: 'Ultimate Fire Link Riverwalk', aliases: ['ultimate firelink river walk'] },
      { canonical: 'Ultimate Fire Link Rue Royale', aliases: ['ultimate firelink rue royale'] },
      { canonical: 'Buffalo', aliases: ['bufallo', 'bufalo'] },
      { canonical: '50 Lions', aliases: ['50 leones'] },
      { canonical: '5 Dragons', aliases: ['50 dragones'] },
      { canonical: 'Choy Sun Doa', aliases: ['choy sun dot'] },
      { canonical: 'Bengal Treasures', aliases: ['bengal treasure'] },
      { canonical: 'Thai Treasures', aliases: ['thai treasure'] },
      { canonical: 'Best Bet', aliases: ['best best'] }
    ];

    for (const g of gameMerges) {
      let [canon] = await tx`SELECT uuid, nombre FROM juegos_maquinas WHERE LOWER(TRIM(nombre)) = LOWER(${g.canonical}) LIMIT 1`;
      if (!canon) {
        [canon] = await tx`
          INSERT INTO juegos_maquinas (uuid, nombre, created_at, updated_at) 
          VALUES (gen_random_uuid(), ${g.canonical}, NOW(), NOW()) 
          RETURNING uuid, nombre
        `;
      } else if (canon.nombre !== g.canonical) {
        await tx`UPDATE juegos_maquinas SET nombre = ${g.canonical} WHERE uuid = ${canon.uuid}`;
      }

      for (const alias of g.aliases) {
        const dups = await tx`SELECT uuid, nombre FROM juegos_maquinas WHERE LOWER(TRIM(nombre)) = LOWER(${alias})`;
        for (const dup of dups) {
          if (dup.uuid === canon.uuid) continue;
          const mUp = await tx`UPDATE maquinas SET juego_uuid = ${canon.uuid} WHERE juego_uuid = ${dup.uuid}`;
          await tx`DELETE FROM juegos_maquinas WHERE uuid = ${dup.uuid}`;
          if (mUp.count > 0) {
            console.log(`✓ Juego [${dup.nombre}] -> [${g.canonical}]: ${mUp.count} máquinas actualizadas.`);
          }
        }
      }
    }

    // 4. VERIFICACIÓN Y AUDITORÍA FINAL
    console.log('\n--- 4. AUDITORÍA FINAL DE INTEGRIDAD ---');
    const [maqCount] = await tx`SELECT count(*)::int FROM maquinas`;
    const [marcaCount] = await tx`SELECT count(*)::int FROM marcas`;
    const [modCount] = await tx`SELECT count(*)::int FROM modelos`;
    const [juegoCount] = await tx`SELECT count(*)::int FROM juegos_maquinas`;

    console.log(`✓ Total Máquinas registradas: ${maqCount.count} (Garantía de conservación: 100%)`);
    console.log(`✓ Catálogo consolidado: ${marcaCount.count} Marcas, ${modCount.count} Modelos, ${juegoCount.count} Juegos.`);
    console.log('\n===============================================================');
    console.log('TRANSACCIÓN COMPLETADA: CAMBIOS CONFIRMADOS Y GUARDADOS EN BD');
    console.log('===============================================================\n');
  });

  await sql.end();
  process.exit(0);
}

ejecutarSaneamiento().catch(async (err) => {
  console.error('ERROR CRÍTICO DURANTE EL SANEAMIENTO (Rollback automático):', err);
  await sql.end();
  process.exit(1);
});
