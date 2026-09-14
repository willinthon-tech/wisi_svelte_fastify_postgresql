import { initDb, sql } from './src/config/db.js';

async function main() {
  await initDb();
  console.log('🚀 Iniciando migración: Mover Rangos a CONF.M: MAQUINAS...');

  // 1. Normalizar nombre de la página de máquinas
  await sql`
    UPDATE paginas 
    SET nombre = 'CONF.M: MAQUINAS' 
    WHERE id = 3 OR UPPER(nombre) = 'MAQUINAS'
  `;

  // 2. Obtener el page_id de CONF.M: MAQUINAS
  const pageRes = await sql`
    SELECT id, nombre FROM paginas 
    WHERE id = 3 OR UPPER(nombre) LIKE '%CONF%MAQUINA%' OR UPPER(nombre) = 'MAQUINAS'
    ORDER BY id ASC LIMIT 1
  `;
  const targetPageId = pageRes[0]?.id || 3;
  console.log(`📌 Página destino encontrada: ID ${targetPageId} (${pageRes[0]?.nombre})`);

  // 3. Obtener orden máximo actual de esa página
  const maxOrderRes = await sql`
    SELECT COALESCE(MAX(orden), 10) as max_order 
    FROM modulos 
    WHERE page_id = ${targetPageId} AND id != 41
  `;
  const nextOrder = Number(maxOrderRes[0]?.max_order || 10) + 1;

  // 4. Mover el módulo Rangos
  const updated = await sql`
    UPDATE modulos 
    SET page_id = ${targetPageId},
        orden = ${nextOrder}
    WHERE id = 41 OR ruta = '/configuracion/rangos' OR UPPER(nombre) = 'RANGOS'
    RETURNING id, nombre, ruta, page_id, orden
  `;
  console.log('✅ Módulo actualizado:', updated);

  // 5. Verificar resultado
  const modulosMaquinas = await sql`
    SELECT m.id, m.nombre, m.ruta, m.page_id, m.orden, p.nombre as pagina_nombre
    FROM modulos m
    INNER JOIN paginas p ON m.page_id = p.id
    WHERE m.page_id = ${targetPageId}
    ORDER BY m.orden ASC
  `;
  console.log(`\n📋 Módulos en ${pageRes[0]?.nombre}:`);
  console.table(modulosMaquinas);

  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
