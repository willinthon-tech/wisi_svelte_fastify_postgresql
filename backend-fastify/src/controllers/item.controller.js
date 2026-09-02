import { 
  getItemsModel, 
  createItemModel, 
  updateItemModel, 
  toggleItemStatusModel, 
  deleteItemModel 
} from '../models/item.model.js';

export async function getItemsController(request, reply) {
  try {
    const { search, category, completed } = request.query;
    const items = await getItemsModel({ search, category, completed });
    return { success: true, count: items.length, data: items };
  } catch (err) {
    request.log.error(err);
    reply.status(500).send({ success: false, error: 'Error al consultar elementos' });
  }
}

export async function createItemController(request, reply) {
  try {
    const { title, description, category, priority } = request.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return reply.status(400).send({ success: false, error: 'El título es requerido' });
    }

    const newItem = await createItemModel({
      title: title.trim(),
      description: description ? description.trim() : '',
      category: category || 'General',
      priority: priority || 'Medium'
    });

    return reply.status(201).send({ success: true, data: newItem });
  } catch (err) {
    request.log.error(err);
    reply.status(500).send({ success: false, error: 'Error al crear elemento' });
  }
}

export async function updateItemController(request, reply) {
  try {
    const { id } = request.params;
    const { title, description, category, priority, completed } = request.body || {};

    const updated = await updateItemModel(id, { title, description, category, priority, completed });
    if (!updated) {
      return reply.status(404).send({ success: false, error: 'Elemento no encontrado' });
    }

    return { success: true, data: updated };
  } catch (err) {
    request.log.error(err);
    reply.status(500).send({ success: false, error: 'Error al actualizar elemento' });
  }
}

export async function toggleItemController(request, reply) {
  try {
    const { id } = request.params;
    const updated = await toggleItemStatusModel(id);
    if (!updated) {
      return reply.status(404).send({ success: false, error: 'Elemento no encontrado' });
    }

    return { success: true, data: updated };
  } catch (err) {
    request.log.error(err);
    reply.status(500).send({ success: false, error: 'Error al alternar estado del elemento' });
  }
}

export async function deleteItemController(request, reply) {
  try {
    const { id } = request.params;
    const deleted = await deleteItemModel(id);
    if (!deleted) {
      return reply.status(404).send({ success: false, error: 'Elemento no encontrado' });
    }

    return { success: true, message: 'Elemento eliminado correctamente' };
  } catch (err) {
    request.log.error(err);
    reply.status(500).send({ success: false, error: 'Error al eliminar elemento' });
  }
}
