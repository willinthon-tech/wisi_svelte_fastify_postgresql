<script>
  import { createEventDispatcher } from 'svelte';
  import ModalTemplate from '../common/ModalTemplate.svelte';

  export let isOpen = false;
  export let editItem = null;

  const dispatch = createEventDispatcher();

  let title = '';
  let description = '';
  let category = 'General';
  let priority = 'Medium';
  let errorMsg = '';

  $: if (isOpen) {
    if (editItem) {
      title = editItem.title || '';
      description = editItem.description || '';
      category = editItem.category || 'General';
      priority = editItem.priority || 'Medium';
    } else {
      title = '';
      description = '';
      category = 'General';
      priority = 'Medium';
    }
    errorMsg = '';
  }

  function handleSubmit() {
    if (!title.trim()) {
      errorMsg = 'El título es obligatorio.';
      return;
    }
    dispatch('save', {
      id: editItem ? editItem.id : null,
      title: title.trim(),
      description: description.trim(),
      category,
      priority
    });
  }

  function closeModal() {
    dispatch('close');
  }
</script>

<ModalTemplate 
  {isOpen} 
  title={editItem ? '✏️ Editar Elemento' : '✨ Crear Nuevo Elemento'} 
  maxWidth="540px"
  on:close={closeModal}>
  
  {#if errorMsg}
    <div style="margin-bottom: 16px; padding: 10px 14px; border-radius: 6px; background: #fef2f2; border: 1px solid #fecaca; color: #dc2626; font-size: 12px; font-weight: 600;">
      ⚠️ {errorMsg}
    </div>
  {/if}

  <form id="item-form" on:submit|preventDefault={handleSubmit}>
    <div class="form-group">
      <label for="item-title" class="form-label">Título</label>
      <input 
        id="item-title"
        type="text"
        bind:value={title}
        placeholder="Ej. Configurar conexión con base de datos..."
        class="form-input"
        required
      />
    </div>

    <div class="form-group">
      <label for="item-desc" class="form-label">Descripción</label>
      <textarea 
        id="item-desc"
        bind:value={description}
        rows="3"
        placeholder="Detalles opcionales..."
        class="form-input"
      ></textarea>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;" class="form-group">
      <div>
        <label for="item-cat" class="form-label">Categoría</label>
        <select id="item-cat" bind:value={category} class="form-input">
          <option value="General">General</option>
          <option value="Frontend">Frontend</option>
          <option value="Backend">Backend</option>
          <option value="Database">Database</option>
          <option value="Design">Design</option>
        </select>
      </div>

      <div>
        <label for="item-priority" class="form-label">Prioridad</label>
        <select id="item-priority" bind:value={priority} class="form-input">
          <option value="Low">Baja</option>
          <option value="Medium">Media</option>
          <option value="High">Alta</option>
        </select>
      </div>
    </div>
  </form>

  <svelte:fragment slot="footer">
    <div style="display: flex; align-items: center; justify-content: flex-end; gap: 10px;">
      <button type="button" on:click={closeModal} class="btn-flow-sec">
        Cancelar
      </button>
      <button type="submit" form="item-form" class="btn-flow">
        {editItem ? 'Guardar Cambios' : 'Crear Elemento'}
      </button>
    </div>
  </svelte:fragment>
</ModalTemplate>
