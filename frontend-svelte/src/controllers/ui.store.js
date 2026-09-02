import { writable } from 'svelte/store';

export const activeTabStore = writable('dashboard');
export const isSidebarOpenStore = writable(true);

export const isModalOpenStore = writable(false);
export const editingItemStore = writable(null);

export const isDeleteModalOpenStore = writable(false);
export const itemToDeleteStore = writable(null);

export const toastMessageStore = writable('');
export const toastTypeStore = writable('info');
export const toastVisibleStore = writable(false);

let toastTimeout = null;

export function triggerToast(message, type = 'info') {
  toastMessageStore.set(message);
  toastTypeStore.set(type);
  toastVisibleStore.set(true);

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastVisibleStore.set(false);
  }, 3500);
}

export function openCreateModalUI() {
  editingItemStore.set(null);
  triggerGlobalCreateModal();
}

export function openEditModalUI(item) {
  editingItemStore.set(item);
  isModalOpenStore.set(true);
}

export function closeModalUI() {
  isModalOpenStore.set(false);
  editingItemStore.set(null);
}

export function openDeleteModalUI(item) {
  itemToDeleteStore.set(item);
  isDeleteModalOpenStore.set(true);
}

export function closeDeleteModalUI() {
  isDeleteModalOpenStore.set(false);
  itemToDeleteStore.set(null);
}

export const globalCreateModalTriggerStore = writable(0);
export function triggerGlobalCreateModal() { globalCreateModalTriggerStore.update(n => n + 1); }
