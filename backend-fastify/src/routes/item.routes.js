import { 
  getItemsController, 
  createItemController, 
  updateItemController, 
  toggleItemController, 
  deleteItemController 
} from '../controllers/item.controller.js';

export default async function itemRoutes(fastify, options) {
  fastify.get('/items', getItemsController);
  fastify.post('/items', createItemController);
  fastify.put('/items/:id', updateItemController);
  fastify.patch('/items/:id/toggle', toggleItemController);
  fastify.delete('/items/:id', deleteItemController);
}
