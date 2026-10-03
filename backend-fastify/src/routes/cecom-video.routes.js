import {
  getDispositivosCamaras,
  createDispositivoCamara,
  updateDispositivoCamara,
  deleteDispositivoCamara,
  syncCanalesDispositivo,
  getCamaras,
  getMesasCamaras,
  getMesasConCamaras,
  setMesaCamaras,
  getCecomIaEventos,
  createCecomIaEvento,
  marcarEventoAtendido,
  clearCecomIaEventos,
  syncIaLiveStatus,
  getIaLiveStatus
} from '../controllers/cecom-video.controller.js';

export default async function cecomVideoRoutes(fastify, options) {
  // Dispositivos Cámaras (NVR, DVR, Cámaras IP)
  fastify.get('/api/cecom/dispositivos-camaras', getDispositivosCamaras);
  fastify.post('/api/cecom/dispositivos-camaras', createDispositivoCamara);
  fastify.put('/api/cecom/dispositivos-camaras/:uuid', updateDispositivoCamara);
  fastify.delete('/api/cecom/dispositivos-camaras/:uuid', deleteDispositivoCamara);
  fastify.post('/api/cecom/dispositivos-camaras/:uuid/sync-canales', syncCanalesDispositivo);

  // Listado de Cámaras (para Descargas y Filtros)
  fastify.get('/api/cecom/camaras', getCamaras);

  // Asociación Mesas <-> Cámaras (para IA de Mesas)
  fastify.get('/api/cecom/mesas-con-camaras', getMesasConCamaras);
  fastify.get('/api/cecom/mesas/:mesaUuid/camaras', getMesasCamaras);
  fastify.post('/api/cecom/mesas/:mesaUuid/camaras', setMesaCamaras);

  // Eventos de IA (Tiempo Real y Novedades)
  fastify.get('/api/cecom/ia-eventos', getCecomIaEventos);
  fastify.post('/api/cecom/ia-eventos', createCecomIaEvento);
  fastify.delete('/api/cecom/ia-eventos', clearCecomIaEventos);
  fastify.put('/api/cecom/ia-eventos/:uuid/atendido', marcarEventoAtendido);

  // Estado Centralizado de IA en Vivo (disponible para todas las PCs y clientes)
  fastify.post('/api/cecom/ia-live-sync', syncIaLiveStatus);
  fastify.get('/api/cecom/ia-live-status', getIaLiveStatus);

  // Verificación y migración bajo demanda de tablas y columnas CECOM IA
  fastify.all('/api/cecom/run-migration', async (request, reply) => {
    try {
      const { sql, isPgConnected } = await import('../config/db.js');
      if (!isPgConnected || !sql) {
        return reply.status(500).send({ success: false, error: 'Base de datos no conectada' });
      }
      await sql`
        CREATE TABLE IF NOT EXISTS cecom_ia_eventos (
          uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          sala_uuid UUID NOT NULL,
          mesa_uuid UUID NOT NULL,
          camara_uuid UUID,
          juego_nombre VARCHAR(100),
          tipo_evento VARCHAR(50) NOT NULL,
          descripcion TEXT NOT NULL,
          foto TEXT DEFAULT NULL,
          metadata JSONB DEFAULT '{}',
          es_novedad BOOLEAN NOT NULL DEFAULT false,
          nivel_alerta VARCHAR(20) NOT NULL DEFAULT 'INFO',
          atendido BOOLEAN NOT NULL DEFAULT false,
          atendido_por VARCHAR(150),
          active INT NOT NULL DEFAULT 1,
          is_deleted BOOLEAN NOT NULL DEFAULT false,
          deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `;
      await sql`ALTER TABLE cecom_ia_eventos ADD COLUMN IF NOT EXISTS foto TEXT DEFAULT NULL;`;
      await sql`ALTER TABLE cecom_ia_eventos ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';`;
      return reply.send({ success: true, message: 'Migración de tablas y columnas CECOM IA ejecutada con éxito' });
    } catch (err) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });
}

