import dotenv from 'dotenv';
dotenv.config();
import postgres from 'postgres';

const sql = postgres({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'wisi',
  username: process.env.PGUSER || 'root',
  password: process.env.PGPASSWORD || 'S0p0rt3R0y4l-2025'
});

async function main() {
  console.log('🚀 Iniciando proceso de deduplicación en la base de datos...');

  try {
    await sql.begin(async (trx) => {
      // 1. Estadísticas previas de empleados
      const [empBefore] = await trx`
        WITH dups AS (
          SELECT REPLACE(REPLACE(UPPER(COALESCE(cedula, '')), 'V', ''), '-', '') as norm_cedula
          FROM empleados
          WHERE NULLIF(TRIM(cedula), '') IS NOT NULL
          GROUP BY norm_cedula
          HAVING count(*) > 1
        )
        SELECT count(*)::int as c FROM dups;
      `;
      console.log(`📊 Grupos de empleados con cédulas duplicadas: ${empBefore.c}`);

      // 2. Unificar y eliminar empleados duplicados
      console.log('⏳ Unificando y deduplicando empleados...');
      await trx`
        DO $$
        DECLARE
            rec RECORD;
            v_master_id INT;
            v_dup_id INT;
            i INT;
        BEGIN
            FOR rec IN
                SELECT 
                    REPLACE(REPLACE(UPPER(COALESCE(cedula, '')), 'V', ''), '-', '') AS norm_cedula,
                    ARRAY_AGG(id ORDER BY activo DESC, (foto IS NOT NULL AND foto <> '') DESC, id DESC) AS id_list
                FROM empleados
                WHERE NULLIF(TRIM(cedula), '') IS NOT NULL
                GROUP BY REPLACE(REPLACE(UPPER(COALESCE(cedula, '')), 'V', ''), '-', '')
                HAVING COUNT(*) > 1
            LOOP
                v_master_id := rec.id_list[1];

                FOR i IN 2..ARRAY_LENGTH(rec.id_list, 1) LOOP
                    v_dup_id := rec.id_list[i];

                    -- Rescatar foto
                    UPDATE empleados e_master
                    SET foto = e_dup.foto
                    FROM empleados e_dup
                    WHERE e_master.id = v_master_id 
                      AND e_dup.id = v_dup_id
                      AND (e_master.foto IS NULL OR e_master.foto = '')
                      AND (e_dup.foto IS NOT NULL AND e_dup.foto <> '');

                    -- Migrar empleado_dispositivos
                    UPDATE empleado_dispositivos
                    SET empleado_id = v_master_id
                    WHERE empleado_id = v_dup_id
                      AND dispositivo_id NOT IN (
                          SELECT dispositivo_id FROM empleado_dispositivos WHERE empleado_id = v_master_id
                      );
                    DELETE FROM empleado_dispositivos WHERE empleado_id = v_dup_id;

                    -- Migrar empleados_plantillas_horarios
                    UPDATE empleados_plantillas_horarios
                    SET empleado_id = v_master_id
                    WHERE empleado_id = v_dup_id
                      AND plantilla_horario_id NOT IN (
                          SELECT plantilla_horario_id FROM empleados_plantillas_horarios WHERE empleado_id = v_master_id
                      );
                    DELETE FROM empleados_plantillas_horarios WHERE empleado_id = v_dup_id;

                    -- Migrar excepciones_horarios
                    UPDATE excepciones_horarios
                    SET empleado_id = v_master_id
                    WHERE empleado_id = v_dup_id;

                    -- Eliminar registro duplicado
                    DELETE FROM empleados WHERE id = v_dup_id;
                END LOOP;
            END LOOP;
        END $$;
      `;

      // 3. Estadísticas previas de attlogs
      const [attBefore] = await trx`
        SELECT COUNT(*)::int AS count
        FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY 
                     REPLACE(REPLACE(UPPER(COALESCE(employee_no, '')), 'V', ''), '-', ''), 
                     event_time 
                   ORDER BY 
                     has_photo DESC, 
                     (attendancestatus IS NOT NULL AND attendancestatus <> '') DESC, 
                     id DESC
                 ) AS rn
          FROM attlogs
          WHERE NULLIF(TRIM(employee_no), '') IS NOT NULL
        ) t
        WHERE t.rn > 1;
      `;
      console.log(`📊 Marcajes duplicados (mismo empleado y fecha/hora exacta) a eliminar: ${attBefore.count}`);

      // 4. Eliminar attlogs duplicados
      if (attBefore.count > 0) {
        console.log('⏳ Eliminando marcajes duplicados...');
        await trx`
          WITH duplicates_to_delete AS (
              SELECT id
              FROM (
                  SELECT id,
                         ROW_NUMBER() OVER (
                             PARTITION BY 
                                 REPLACE(REPLACE(UPPER(COALESCE(employee_no, '')), 'V', ''), '-', ''), 
                                 event_time 
                             ORDER BY 
                                 has_photo DESC, 
                                 (attendancestatus IS NOT NULL AND attendancestatus <> '') DESC, 
                                 id DESC
                         ) AS rn
                  FROM attlogs
                  WHERE NULLIF(TRIM(employee_no), '') IS NOT NULL
              ) t
              WHERE t.rn > 1
          )
          DELETE FROM attlogs
          WHERE id IN (SELECT id FROM duplicates_to_delete);
        `;
      }

      console.log('✅ Deduplicación completada con éxito.');
    });
  } catch (err) {
    console.error('❌ Error ejecutando la deduplicación (se realizó ROLLBACK automático):', err);
  } finally {
    await sql.end();
  }
}

main();
