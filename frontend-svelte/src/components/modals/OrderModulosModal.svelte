<script>
  import { createEventDispatcher } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { masterModulosActions } from '../../controllers/master.store.js';

  export let show = false;
  export let pagina = null;
  export let modulos = [];

  const dispatch = createEventDispatcher();

  let items = [];
  let draggedIndex = null;
  let dragOverIndex = null;
  let isSaving = false;

  // Sincronizar lista local cuando se abre el modal o cambian los modulos/página
  $: if (show && pagina && modulos) {
    const pageId = Number(pagina.id);
    const filtered = modulos
      .filter(m => Number(m.page_id) === pageId)
      .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0) || a.id - b.id);
    
    // Clonar para manipulación local
    items = filtered.map((m, idx) => ({ ...m, local_order: idx + 1 }));
  }

  function handleDragStart(e, index) {
    draggedIndex = index;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  }

  function handleDragOver(e, index) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    dragOverIndex = index;
  }

  function handleDragLeave(index) {
    if (dragOverIndex === index) {
      dragOverIndex = null;
    }
  }

  function handleDrop(e, targetIndex) {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) {
      draggedIndex = null;
      dragOverIndex = null;
      return;
    }

    const updated = [...items];
    const [movedItem] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, movedItem);

    // Recalcular orden correlativo local
    items = updated.map((m, idx) => ({ ...m, local_order: idx + 1 }));
    draggedIndex = null;
    dragOverIndex = null;
  }

  function handleDragEnd() {
    draggedIndex = null;
    dragOverIndex = null;
  }

  function moveUp(index) {
    if (index <= 0) return;
    const updated = [...items];
    const temp = updated[index];
    updated[index] = updated[index - 1];
    updated[index - 1] = temp;
    items = updated.map((m, idx) => ({ ...m, local_order: idx + 1 }));
  }

  function moveDown(index) {
    if (index >= items.length - 1) return;
    const updated = [...items];
    const temp = updated[index];
    updated[index] = updated[index + 1];
    updated[index + 1] = temp;
    items = updated.map((m, idx) => ({ ...m, local_order: idx + 1 }));
  }

  async function saveOrder() {
    if (isSaving || items.length === 0) return;
    isSaving = true;

    try {
      const payload = items.map((m, idx) => ({
        id: m.id,
        orden: idx + 1
      }));

      await masterModulosActions.reorder(payload);
      triggerToast(`Orden de módulos para "${pagina.nombre}" actualizado con éxito`, 'success');
      dispatch('saved');
      close();
    } catch (err) {
      console.error(err);
      triggerToast(`Error al guardar el orden: ${err.message}`, 'error');
    } finally {
      isSaving = false;
    }
  }

  function close() {
    show = false;
    draggedIndex = null;
    dragOverIndex = null;
    dispatch('close');
  }
</script>

{#if show && pagina}
  <div 
    class="modal-backdrop"
    on:click|self={close}
    role="presentation"
  >
    <div class="modal-card">
      <!-- Modal Header -->
      <div class="modal-header">
        <div class="header-titles">
          <div class="header-badge">
            <span class="badge-icon">↕️</span>
            <span>ORGANIZACIÓN DE MÓDULOS</span>
          </div>
          <h3 class="header-main-title">
            Ordenar Módulos de <span class="page-highlight">"{pagina.nombre}"</span>
          </h3>
          <p class="header-sub">
            Arrastra y suelta las filas o usa los botones para establecer la secuencia en el menú lateral.
          </p>
        </div>
        <button 
          type="button" 
          class="btn-close" 
          on:click={close}
          title="Cerrar ventana"
        >
          ✕
        </button>
      </div>

      <!-- Modal Body (Drag & Drop list) -->
      <div class="modal-body">
        {#if items.length === 0}
          <div class="empty-state">
            <span>ℹ️</span>
            <p>Esta página no tiene módulos asignados actualmente.</p>
          </div>
        {:else}
          <div class="dnd-list">
            {#each items as item, index (item.id)}
              <div
                class="dnd-item {draggedIndex === index ? 'is-dragging' : ''} {dragOverIndex === index ? 'is-drag-over' : ''}"
                draggable="true"
                on:dragstart={(e) => handleDragStart(e, index)}
                on:dragover={(e) => handleDragOver(e, index)}
                on:dragleave={() => handleDragLeave(index)}
                on:drop={(e) => handleDrop(e, index)}
                on:dragend={handleDragEnd}
              >
                <!-- Drag Handle -->
                <div class="drag-handle" title="Arrastra para ordenar">
                  <span>⠿</span>
                </div>

                <!-- Position Badge -->
                <div class="position-badge">
                  #{index + 1}
                </div>

                <!-- Module Info -->
                <div class="item-info">
                  <div class="item-name">
                    {item.nombre}
                  </div>
                  <div class="item-route">
                    {item.ruta}
                  </div>
                </div>

                <!-- Quick Arrow Buttons -->
                <div class="arrow-buttons">
                  <button
                    type="button"
                    class="btn-arrow"
                    disabled={index === 0}
                    on:click={() => moveUp(index)}
                    title="Subir una posición"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    class="btn-arrow"
                    disabled={index === items.length - 1}
                    on:click={() => moveDown(index)}
                    title="Bajar una posición"
                  >
                    ▼
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Modal Footer -->
      <div class="modal-footer">
        <div class="footer-left">
          <span class="total-modules-count">
            Total módulos: <strong>{items.length}</strong>
          </span>
        </div>
        <div class="footer-actions">
          <button 
            type="button" 
            class="btn-cancel" 
            on:click={close}
            disabled={isSaving}
          >
            Cancelar
          </button>
          <button 
            type="button" 
            class="btn-save" 
            on:click={saveOrder}
            disabled={isSaving || items.length === 0}
          >
            {#if isSaving}
              <span>Guardando...</span>
            {:else}
              <span>💾 Guardar Orden</span>
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    animation: fadeIn 0.15s ease-out;
  }

  .modal-card {
    background: #ffffff;
    border-radius: 16px;
    max-width: 580px;
    width: 100%;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
    border: 1px solid #e2e8f0;
    overflow: hidden;
    animation: slideUp 0.18s ease-out;
  }

  .modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 18px 22px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }

  .header-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    color: #1d4ed8;
    font-size: 11px;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 20px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }

  .header-main-title {
    margin: 0;
    font-size: 17px;
    font-weight: 800;
    color: #0f172a;
  }

  .page-highlight {
    color: #2563eb;
  }

  .header-sub {
    margin: 4px 0 0 0;
    font-size: 12.5px;
    color: #64748b;
    line-height: 1.4;
  }

  .btn-close {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #64748b;
    font-size: 15px;
    font-weight: 800;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .btn-close:hover {
    background: #fee2e2;
    color: #ef4444;
    border-color: #fca5a5;
  }

  .modal-body {
    padding: 18px 22px;
    overflow-y: auto;
    flex: 1 1 auto;
    min-height: 200px;
    max-height: calc(85vh - 160px);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
    color: #64748b;
    font-size: 14px;
    gap: 8px;
  }

  .empty-state span {
    font-size: 32px;
  }

  .dnd-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .dnd-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: #ffffff;
    border: 1.5px solid #e2e8f0;
    border-radius: 10px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
    cursor: grab;
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
    user-select: none;
  }

  .dnd-item:active {
    cursor: grabbing;
  }

  .dnd-item:hover {
    border-color: #93c5fd;
    background: #f8fafc;
    box-shadow: 0 3px 8px rgba(37, 99, 235, 0.08);
  }

  .dnd-item.is-dragging {
    opacity: 0.45;
    background: #eff6ff;
    border: 1.5px dashed #3b82f6;
  }

  .dnd-item.is-drag-over {
    border-color: #2563eb;
    background: #f0fdf4;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.15);
  }

  .drag-handle {
    color: #94a3b8;
    font-size: 18px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px 4px;
    transition: color 0.15s ease;
  }

  .dnd-item:hover .drag-handle {
    color: #2563eb;
  }

  .position-badge {
    background: #0f172a;
    color: #ffffff;
    font-size: 11.5px;
    font-weight: 800;
    font-family: monospace;
    padding: 3px 8px;
    border-radius: 6px;
    min-width: 30px;
    text-align: center;
  }

  .item-info {
    flex: 1 1 auto;
    min-width: 0;
  }

  .item-name {
    font-size: 14px;
    font-weight: 800;
    color: #0f172a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-route {
    font-size: 11.5px;
    color: #64748b;
    font-family: monospace;
  }

  .arrow-buttons {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .btn-arrow {
    width: 24px;
    height: 18px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #475569;
    border-radius: 4px;
    font-size: 9px;
    font-weight: bold;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.12s ease;
  }

  .btn-arrow:hover:not(:disabled) {
    background: #2563eb;
    color: #ffffff;
    border-color: #2563eb;
  }

  .btn-arrow:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 22px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
  }

  .total-modules-count {
    font-size: 12.5px;
    color: #64748b;
  }

  .footer-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .btn-cancel {
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #475569;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-cancel:hover:not(:disabled) {
    background: #f1f5f9;
    color: #0f172a;
  }

  .btn-save {
    padding: 8px 18px;
    border-radius: 8px;
    border: none;
    background: #2563eb;
    color: #ffffff;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(37, 99, 235, 0.25);
    transition: all 0.15s ease;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .btn-save:hover:not(:disabled) {
    background: #1d4ed8;
    box-shadow: 0 4px 8px rgba(37, 99, 235, 0.35);
  }

  .btn-save:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideUp {
    from { transform: translateY(12px) scale(0.98); opacity: 0; }
    to { transform: translateY(0) scale(1); opacity: 1; }
  }
</style>
