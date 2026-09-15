import postgres from 'postgres';
const sql = postgres({ host: 'localhost', port: 5432, database: 'wisi', username: 'root', password: 'S0p0rt3R0y4l-2025' });

async function checkAttlogDups() {
  const dups = await sql`
    SELECT count(*) FROM (
      SELECT dispositivo_uuid, employee_no, event_time, count(*)
      FROM attlogs
      GROUP BY dispositivo_uuid, employee_no, event_time
      HAVING count(*) > 1
    ) t;
  `;
  console.log(`Duplicados en (dispositivo_uuid, employee_no, event_time): ${dups[0].count}`);
  await sql.end();
}
checkAttlogDups().catch(console.error);
