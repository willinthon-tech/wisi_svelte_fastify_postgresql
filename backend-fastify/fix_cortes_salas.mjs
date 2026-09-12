import postgres from 'postgres';
import dotenv from 'dotenv';
import zlib from 'zlib';
dotenv.config();

const sql = postgres({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'wisi',
  username: process.env.PGUSER || 'root',
  password: process.env.PGPASSWORD || 'S0p0rt3R0y4l-2025',
  connect_timeout: 5
});

async function main() {
  try {
    const cortes = await sql`SELECT id, salas_ids, data FROM cortes`;
    console.log(`Analizando ${cortes.length} corte(s)...`);

    for (const c of cortes) {
      let d = c.data;
      if (typeof d === 'string') {
        if (d.startsWith('gzip:') || d.startsWith('H4sI')) {
          try {
            const cleanBase64 = d.replace(/^gzip:/, '');
            const buf = Buffer.from(cleanBase64, 'base64');
            d = JSON.parse(zlib.gunzipSync(buf).toString('utf-8'));
          } catch(e) {}
        } else {
          try {
            d = JSON.parse(d);
            if (typeof d === 'string') d = JSON.parse(d);
          } catch(e) {}
        }
      }

      const emps = d?.empleados || (d?.reportData && d?.reportData?.empleados) || [];
      if (Array.isArray(emps) && emps.length > 0) {
        const uniqueSalas = Array.from(new Set(emps.map(e => Number(e.sala_id)).filter(n => !isNaN(n) && n > 0)));
        if (uniqueSalas.length > 0) {
          console.log(`Corte #${c.id}: salas detectadas [${uniqueSalas.join(', ')}] (antes: [${(c.salas_ids || []).join(', ')}])`);
          await sql`UPDATE cortes SET salas_ids = ${uniqueSalas}::int[] WHERE id = ${c.id}`;
        }
      }
    }

    console.log('¡Actualización de cortes completada con éxito!');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await sql.end();
  }
}

main();
