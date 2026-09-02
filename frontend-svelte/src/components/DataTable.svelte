<script>
  import { createEventDispatcher } from 'svelte';

  export let items = [];

  const dispatch = createEventDispatcher();

  let sortBy = 'id';
  let sortDir = 'desc';
  let currentPage = 1;
  let pageSize = 10;
  let selectedIds = new Set();
  let searchQuery = '';
  
  // Inline editing state per row
  let editingInlineId = null;
  let inlineDraft = {};

  function toggleSort(column) {
    if (sortBy === column) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortBy = column;
      sortDir = 'asc';
    }
  }

  $: filteredItems = items.filter(item => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      (item.title || '').toLowerCase().includes(q) ||
      (item.description || '').toLowerCase().includes(q) ||
      (item.category || '').toLowerCase().includes(q) ||
      (item.priority || '').toLowerCase().includes(q) ||
      (item.completed ? 'completado' : 'pendiente').includes(q)
    );
  });

  $: sortedItems = [...filteredItems].sort((a, b) => {
    let valA = a[sortBy];
    let valB = b[sortBy];
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  $: totalPages = pageSize >= 999999 ? 1 : (Math.ceil(sortedItems.length / pageSize) || 1);
  $: if (currentPage > totalPages) currentPage = totalPages;
  $: paginatedItems = pageSize >= 999999 ? sortedItems : sortedItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  $: startRecord = sortedItems.length === 0 ? 0 : (currentPage - 1) * (pageSize >= 999999 ? sortedItems.length : pageSize) + 1;
  $: endRecord = pageSize >= 999999 ? sortedItems.length : Math.min(currentPage * pageSize, sortedItems.length);
  $: allSelected = paginatedItems.length > 0 && paginatedItems.every(i => selectedIds.has(i.id));

  $: totalFilters = searchQuery.trim() ? 1 : 0;
  $: activeFilterName = searchQuery.trim() ? `"${searchQuery.trim()}"` : 'Ninguno';

  function toggleSelectAll() {
    if (allSelected) {
      paginatedItems.forEach(i => selectedIds.delete(i.id));
    } else {
      paginatedItems.forEach(i => selectedIds.add(i.id));
    }
    selectedIds = new Set(selectedIds);
  }

  function toggleSelectOne(id) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
    selectedIds = new Set(selectedIds);
  }

  function handleBatchComplete() {
    dispatch('batchToggle', Array.from(selectedIds));
    selectedIds = new Set();
  }

  function handleBatchDelete() {
    dispatch('delete', { id: Array.from(selectedIds)[0], title: `${selectedIds.size} elementos seleccionados` });
    selectedIds = new Set();
  }

  function startInlineEdit(item) {
    editingInlineId = item.id;
    inlineDraft = { ...item };
  }

  function cancelInlineEdit() {
    editingInlineId = null;
    inlineDraft = {};
  }

  function saveInlineEdit(id) {
    dispatch('saveInline', inlineDraft);
    editingInlineId = null;
    inlineDraft = {};
  }
</script>

<div class="table-container" style="background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); overflow: hidden;">
  
  <!-- Top Bar: Full width Search Input -->
  <div class="table-toolbar" style="padding: 10px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
    <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
      <div style="position: relative; display: flex; align-items: center; width: 100%;">
        <input 
          type="text" 
          bind:value={searchQuery}
          placeholder="Buscar registros..."
          style="width: 100%; padding: 8px 12px 8px 34px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; font-size: 13.5px; outline: none; transition: all 0.15s ease;"
        />
        <span style="position: absolute; left: 12px; font-size: 14px; color: #94a3b8; pointer-events: none;">🔍</span>
      </div>

      {#if selectedIds.size > 0}
        <div style="display: flex; align-items: center; gap: 6px; white-space: nowrap;">
          <span style="font-size: 12px; color: #2563eb; font-weight: 700; background: #eff6ff; padding: 4px 10px; border-radius: 6px;">
            {selectedIds.size} seleccionados
          </span>
          <button on:click={handleBatchComplete} class="btn-flow-sec" style="padding: 4px 10px; font-size: 12px;">✓ Completar</button>
          <button on:click={handleBatchDelete} class="btn-flow-sec" style="padding: 4px 10px; font-size: 12px; color: #ef4444; border-color: #fca5a5;">Eliminar</button>
        </div>
      {/if}
    </div>
  </div>

  <!-- Scrollable Wrapper for Table -->
  <div class="table-scroll-wrapper" style="overflow-x: auto;">
    <table class="data-table" style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
      <thead>
        <tr style="background: #ffffff; border-bottom: 1px solid #e2e8f0; color: #475569; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;">
          <th style="width: 40px; text-align: center; padding: 8px 14px;">
            <input 
              type="checkbox" 
              checked={allSelected} 
              on:change={toggleSelectAll} 
              style="cursor: pointer; width: 15px; height: 15px; accent-color: #2563eb;"
            />
          </th>
          <th on:click={() => toggleSort('id')} style="padding: 8px 14px; cursor: pointer; user-select: none;">
            ID {sortBy === 'id' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
          </th>
          <th on:click={() => toggleSort('title')} style="padding: 8px 14px; cursor: pointer; user-select: none;">
            Título {sortBy === 'title' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
          </th>
          <th on:click={() => toggleSort('description')} style="padding: 8px 14px; cursor: pointer; user-select: none;">
            Descripción {sortBy === 'description' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
          </th>
          <th on:click={() => toggleSort('category')} style="padding: 8px 14px; cursor: pointer; user-select: none;">
            Categoría {sortBy === 'category' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
          </th>
          <th on:click={() => toggleSort('priority')} style="padding: 8px 14px; cursor: pointer; user-select: none;">
            Prioridad {sortBy === 'priority' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
          </th>
          <th on:click={() => toggleSort('completed')} style="padding: 8px 14px; cursor: pointer; user-select: none;">
            Estado {sortBy === 'completed' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
          </th>
          <th style="padding: 8px 14px; text-align: right;">Acciones</th>
        </tr>
      </thead>

      <tbody>
        {#each paginatedItems as item (item.id)}
          {@const isEditingThisRow = editingInlineId === item.id}
          <tr style="border-bottom: 1px solid #f1f5f9; background: {selectedIds.has(item.id) ? '#eff6ff' : isEditingThisRow ? '#f0f9ff' : '#ffffff'}; transition: background 0.15s ease;">
            <td style="text-align: center; padding: 6px 14px;">
              <input 
                type="checkbox"
                checked={selectedIds.has(item.id)}
                on:change={() => toggleSelectOne(item.id)}
                style="cursor: pointer; width: 15px; height: 15px; accent-color: #2563eb;"
              />
            </td>

            <td style="padding: 6px 14px; font-family: monospace; color: #334155; font-weight: 400;">
              #{item.id}
            </td>

            <!-- Título -->
            <td style="padding: 6px 14px;">
              {#if isEditingThisRow}
                <input 
                  type="text" 
                  bind:value={inlineDraft.title} 
                  class="form-input" 
                  style="font-size: 13px; padding: 4px 8px; width: 100%; min-width: 160px;"
                  placeholder="Título"
                />
              {:else}
                <span style="color: #334155; font-weight: 400;">
                  {item.title}
                </span>
              {/if}
            </td>

            <!-- Descripción -->
            <td style="padding: 6px 14px;">
              {#if isEditingThisRow}
                <input 
                  type="text" 
                  bind:value={inlineDraft.description}
                  class="form-input" 
                  style="font-size: 13px; color: #334155; padding: 4px 8px; width: 100%; min-width: 220px;"
                  placeholder="Descripción"
                />
              {:else}
                <span style="color: #334155; font-size: 13px; font-weight: 400;">
                  {item.description || '—'}
                </span>
              {/if}
            </td>

            <!-- Categoría -->
            <td style="padding: 6px 14px; color: #334155; font-size: 13px; font-weight: 400;">
              {#if isEditingThisRow}
                <select 
                  bind:value={inlineDraft.category}
                  style="padding: 3px 6px; border-radius: 4px; border: 1px solid #cbd5e1; background: #ffffff; font-size: 13px; color: #334155; outline: none;">
                  <option value="General">General</option>
                  <option value="Frontend">Frontend</option>
                  <option value="Backend">Backend</option>
                  <option value="Database">Database</option>
                  <option value="DevOps">DevOps</option>
                </select>
              {:else}
                <span>{item.category || 'General'}</span>
              {/if}
            </td>

            <!-- Prioridad -->
            <td style="padding: 6px 14px; color: #334155; font-size: 13px; font-weight: 400;">
              {#if isEditingThisRow}
                <select 
                  bind:value={inlineDraft.priority}
                  style="padding: 3px 6px; border-radius: 4px; border: 1px solid #cbd5e1; background: #ffffff; font-size: 13px; color: #334155; outline: none;">
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              {:else}
                <span>{item.priority || 'Medium'}</span>
              {/if}
            </td>

            <!-- Estado -->
            <td style="padding: 6px 14px; color: #334155; font-size: 13px; font-weight: 400;">
              {#if isEditingThisRow}
                <select 
                  bind:value={inlineDraft.completed}
                  style="padding: 3px 6px; border-radius: 4px; border: 1px solid #cbd5e1; background: #ffffff; font-size: 13px; color: #334155; outline: none;">
                  <option value={false}>Pendiente</option>
                  <option value={true}>Completado</option>
                </select>
              {:else}
                <button 
                  on:click={() => dispatch('toggle', item.id)}
                  type="button"
                  style="background: none; border: none; padding: 0; margin: 0; color: #334155; font-size: 13px; font-weight: 400; cursor: pointer; text-decoration: none;">
                  {item.completed ? 'Completado' : 'Pendiente'}
                </button>
              {/if}
            </td>

            <!-- Acciones -->
            <td style="padding: 6px 14px; text-align: right; min-width: 130px;">
              <div style="display: flex; align-items: center; justify-content: flex-end; gap: 6px;">
                {#if isEditingThisRow}
                  <button 
                    on:click={() => saveInlineEdit(item.id)}
                    type="button"
                    class="btn-flow-sec" 
                    style="padding: 4px 7px; font-size: 12px; border-color: #a7f3d0;"
                    title="Guardar Cambios">
                    💾
                  </button>
                  <button 
                    on:click={cancelInlineEdit}
                    type="button"
                    class="btn-flow-sec" 
                    style="padding: 4px 7px; font-size: 12px;"
                    title="Cancelar">
                    ❌
                  </button>
                {:else}
                  <button 
                    on:click={() => startInlineEdit(item)}
                    type="button"
                    class="btn-flow-sec" 
                    style="padding: 4px 7px; font-size: 12px;"
                    title="Editar en Línea">
                    Editar
                  </button>
                  <button 
                    on:click={() => dispatch('edit', item)}
                    type="button"
                    class="btn-flow-sec" 
                    style="padding: 4px 7px; font-size: 12px; color: #6366f1;"
                    title="Editar en Modal">
                    📋
                  </button>
                  <button 
                    on:click={() => dispatch('delete', item)}
                    type="button"
                    class="btn-flow-sec" 
                    style="padding: 4px 7px; font-size: 12px; color: #ef4444; border-color: #fca5a5;"
                    title="Eliminar">
                    Eliminar
                  </button>
                {/if}
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- Bottom Footer with exact layout from user image -->
  <div class="table-toolbar" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; background: #f8fafc; border-top: 1px solid #e2e8f0; flex-wrap: wrap;">
    <!-- Left: Filters Info -->
    <div style="font-size: 13px; color: #475569; font-weight: 500;">
      Total: (<strong style="color: #0f172a; font-weight: 800;">{sortedItems.length}</strong>) &nbsp;|&nbsp; Filtros Totales: (<strong style="color: #0f172a; font-weight: 800;">{totalFilters}</strong>) &nbsp;Filtros: <span style="color: {totalFilters > 0 ? '#2563eb' : '#64748b'}; font-weight: 700;">{activeFilterName}</span>
    </div>

    <!-- Right Controls: [10 filas v] [1 - 10 de 1535] [< 1 / 154 >] -->
    <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
      <!-- Dropdown Filas -->
      <select 
        bind:value={pageSize}
        style="padding: 4px 8px; border-radius: 6px; border: 1px solid #cbd5e1; background: #ffffff; font-size: 13px; font-weight: 700; color: #0f172a; outline: none; cursor: pointer;">
        <option value={10}>10 filas</option>
        <option value={50}>50 filas</option>
        <option value={100}>100 filas</option>
        <option value={1000}>1000 filas</option>
      </select>

      <!-- Range indicator -->
      <span style="font-size: 13px; font-weight: 700; color: #0f172a;">
        {startRecord} - {endRecord} de {sortedItems.length}
      </span>

      <!-- Compact Pagination Group [< 1 / 154 >] -->
      <div style="display: flex; align-items: center; border: 1px solid #94a3b8; border-radius: 6px; overflow: hidden; background: #94a3b8;">
        <button 
          on:click={() => (currentPage = Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          type="button"
          style="padding: 3px 8px; border: none; background: {currentPage === 1 ? '#e2e8f0' : '#ffffff'}; color: #334155; font-size: 13px; font-weight: 800; cursor: {currentPage === 1 ? 'not-allowed' : 'pointer'};">
          &lt;
        </button>

        <span style="padding: 3px 10px; background: #94a3b8; color: #ffffff; font-size: 12px; font-weight: 800;">
          {currentPage} / {totalPages}
        </span>

        <button 
          on:click={() => (currentPage = Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          type="button"
          style="padding: 3px 8px; border: none; background: {currentPage === totalPages ? '#e2e8f0' : '#ffffff'}; color: #334155; font-size: 13px; font-weight: 800; cursor: {currentPage === totalPages ? 'not-allowed' : 'pointer'};">
          &gt;
        </button>
      </div>
    </div>
  </div>
</div>
