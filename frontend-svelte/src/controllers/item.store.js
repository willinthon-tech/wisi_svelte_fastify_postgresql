import { writable } from 'svelte/store';

export const itemsStore = writable([]);
export const loadingStore = writable(false);
export const searchQueryStore = writable('');
export const selectedCategoryStore = writable('All');
export const selectedStatusStore = writable('All');

export async function loadItemsData(search = '', category = 'All', status = 'All') {
  itemsStore.set([]);
  return [];
}

export async function addNewItem(itemData) {
  return itemData;
}

export async function updateExistingItem(id, itemData) {
  return itemData;
}

export async function toggleItemCompleted(id) {
  return null;
}

export async function removeSingleItem(id) {
}

