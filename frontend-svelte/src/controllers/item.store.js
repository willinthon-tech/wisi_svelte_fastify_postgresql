import { writable } from 'svelte/store';
import { 
  fetchItemsModel, 
  createItemModel, 
  updateItemModel, 
  toggleItemModel, 
  deleteItemModel 
} from '../models/item.model.js';

export const itemsStore = writable([]);
export const loadingStore = writable(false);
export const searchQueryStore = writable('');
export const selectedCategoryStore = writable('All');
export const selectedStatusStore = writable('All');

export async function loadItemsData(search = '', category = 'All', status = 'All') {
  loadingStore.set(true);
  try {
    const data = await fetchItemsModel({
      search,
      category,
      completed: status === 'All' ? undefined : status
    });
    itemsStore.set(data);
    return data;
  } catch (err) {
    console.error('Error loading items store:', err);
    throw err;
  } finally {
    loadingStore.set(false);
  }
}

export async function addNewItem(itemData) {
  const newItem = await createItemModel(itemData);
  itemsStore.update(list => [newItem, ...list]);
  return newItem;
}

export async function updateExistingItem(id, itemData) {
  const updated = await updateItemModel(id, itemData);
  itemsStore.update(list => list.map(item => item.id === id ? { ...item, ...updated } : item));
  return updated;
}

export async function toggleItemCompleted(id) {
  itemsStore.update(list => list.map(item => item.id === id ? { ...item, completed: !item.completed } : item));
  const updated = await toggleItemModel(id);
  return updated;
}

export async function removeSingleItem(id) {
  itemsStore.update(list => list.filter(item => item.id !== id));
  await deleteItemModel(id);
}
