import {
  getDispositivosCamarasModel,
  createDispositivoCamaraModel,
  updateDispositivoCamaraModel,
  deleteDispositivoCamaraModel,
  syncCanalesDispositivoModel,
  getCamarasModel,
  getMesasCamarasModel,
  getMesasConCamarasModel,
  setMesaCamarasModel,
  getCecomIaEventosModel,
  createCecomIaEventoModel,
  marcarEventoAtendidoModel,
  clearCecomIaEventosModel
} from '../models/cecom-video.model.js';

export async function getDispositivosCamaras(request, reply) {
  try {
    const result = await getDispositivosCamarasModel(request.query || {});
    return reply.send(result);
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function createDispositivoCamara(request, reply) {
  try {
    const data = request.body || {};
    const created = await createDispositivoCamaraModel(data);
    return reply.status(201).send({ success: true, data: created });
  } catch (err) {
    request.log.error(err);
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function updateDispositivoCamara(request, reply) {
  try {
    const { uuid } = request.params;
    const data = request.body || {};
    const updated = await updateDispositivoCamaraModel(uuid, data);
    if (!updated) {
      return reply.status(404).send({ success: false, error: 'Dispositivo no encontrado' });
    }
    return reply.send({ success: true, data: updated });
  } catch (err) {
    request.log.error(err);
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function deleteDispositivoCamara(request, reply) {
  try {
    const { uuid } = request.params;
    const result = await deleteDispositivoCamaraModel(uuid);
    return reply.send(result);
  } catch (err) {
    request.log.error(err);
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function syncCanalesDispositivo(request, reply) {
  try {
    const { uuid } = request.params;
    const { canales } = request.body || {};
    const result = await syncCanalesDispositivoModel(uuid, canales || []);
    return reply.send(result);
  } catch (err) {
    request.log.error(err);
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function getCamaras(request, reply) {
  try {
    const result = await getCamarasModel(request.query || {});
    return reply.send(result);
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function getMesasCamaras(request, reply) {
  try {
    const { mesaUuid } = request.params;
    const result = await getMesasCamarasModel(mesaUuid);
    return reply.send(result);
  } catch (err) {
    request.log.error(err);
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function setMesaCamaras(request, reply) {
  try {
    const { mesaUuid } = request.params;
    const { camaras } = request.body || {};
    const result = await setMesaCamarasModel(mesaUuid, camaras || []);
    return reply.send(result);
  } catch (err) {
    request.log.error(err);
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function getCecomIaEventos(request, reply) {
  try {
    const result = await getCecomIaEventosModel(request.query || {});
    return reply.send(result);
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function createCecomIaEvento(request, reply) {
  try {
    const data = request.body || {};
    const created = await createCecomIaEventoModel(data);
    return reply.status(201).send({ success: true, data: created });
  } catch (err) {
    request.log.error(err);
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function marcarEventoAtendido(request, reply) {
  try {
    const { uuid } = request.params;
    const { atendido_por } = request.body || {};
    const result = await marcarEventoAtendidoModel(uuid, atendido_por || '');
    return reply.send({ success: true, data: result });
  } catch (err) {
    request.log.error(err);
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function getMesasConCamaras(request, reply) {
  try {
    const result = await getMesasConCamarasModel(request.query || {});
    return reply.send(result);
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: err.message });
  }
}

export async function clearCecomIaEventos(request, reply) {
  try {
    const { sala_uuid } = request.query || {};
    const result = await clearCecomIaEventosModel(sala_uuid);
    return reply.send(result);
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: err.message });
  }
}

// ====================================================================
// ESTADO DE IA EN VIVO (CENTRALIZADO PARA TODAS LAS PCS Y DISPOSITIVOS)
// ====================================================================
const globalLiveIaMesas = {};

export async function syncIaLiveStatus(request, reply) {
  try {
    const { mesas } = request.body || {};
    if (mesas && typeof mesas === 'object') {
      for (const [mId, data] of Object.entries(mesas)) {
        globalLiveIaMesas[mId] = {
          ...globalLiveIaMesas[mId],
          ...data,
          last_update: Date.now()
        };
      }
    }
    return reply.send({ success: true, count: Object.keys(globalLiveIaMesas).length });
  } catch (err) {
    request.log.error(err);
    return reply.status(400).send({ success: false, error: err.message });
  }
}

export async function getIaLiveStatus(request, reply) {
  try {
    return reply.send({ success: true, data: globalLiveIaMesas, count: Object.keys(globalLiveIaMesas).length });
  } catch (err) {
    request.log.error(err);
    return reply.status(500).send({ success: false, error: err.message });
  }
}


