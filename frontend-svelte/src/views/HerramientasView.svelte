<script>
  import { onMount } from 'svelte';
  import ScoreboardBaccarat from '../components/ScoreboardBaccarat.svelte';

  // State
  let searchQuery = '';
  let sortBy = 'id';
  let sortDir = 'asc';
  let currentPage = 1;
  let pageSize = 10;
  let selectedIds = new Set();

  // Modal / Game View state
  let isGameOpen = false;
  let activeGameId = null;

  // Single record requested by user: "Scoreboard Baccarad"
  const tools = [
    {
      id: 1,
      uuid: 'tool-scoreboard-baccarat',
      title: 'Scoreboard Baccarad',
      description: 'Tablero digital y marcador en vivo para Baccarat / Punto y Banca (Bead Plate, Big Road y Estadísticas).',
      category: 'Mesas en Vivo',
      priority: 'Alta',
      completed: true,
      statusLabel: 'Activo'
    }
  ];

  function toggleSort(col) {
    if (sortBy === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortBy = col;
      sortDir = 'asc';
    }
  }

  $: filteredTools = tools.filter(item => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      item.priority.toLowerCase().includes(q)
    );
  });

  $: sortedTools = [...filteredTools].sort((a, b) => {
    let valA = a[sortBy];
    let valB = b[sortBy];
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  $: totalPages = Math.max(1, Math.ceil(sortedTools.length / pageSize));
  $: paginatedTools = sortedTools.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  $: startRecord = sortedTools.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  $: endRecord = Math.min(currentPage * pageSize, sortedTools.length);
  $: allSelected = paginatedTools.length > 0 && paginatedTools.every(i => selectedIds.has(i.uuid || i.id));

  $: totalFilters = searchQuery.trim() ? 1 : 0;
  $: activeFilterName = searchQuery.trim() ? `"${searchQuery.trim()}"` : 'Ninguno';

  function toggleSelectAll() {
    if (allSelected) {
      paginatedTools.forEach(i => selectedIds.delete(i.uuid || i.id));
    } else {
      paginatedTools.forEach(i => selectedIds.add(i.uuid || i.id));
    }
    selectedIds = new Set(selectedIds);
  }

  function toggleSelectOne(targetId) {
    if (selectedIds.has(targetId)) {
      selectedIds.delete(targetId);
    } else {
      selectedIds.add(targetId);
    }
    selectedIds = new Set(selectedIds);
  }

  function openGame(toolId) {
    activeGameId = toolId;
    isGameOpen = true;
  }

  function closeGame() {
    isGameOpen = false;
    activeGameId = null;
  }
</script>

<div class="herramientas-page-container">
  <!-- STANDARD FLOWDASH DATATABLE (REPLICATING SCREENSHOT LAYOUT) -->
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
          </div>
        {/if}
      </div>
    </div>

    <!-- Scrollable Table -->
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
              TÍTULO {sortBy === 'title' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th on:click={() => toggleSort('description')} style="padding: 8px 14px; cursor: pointer; user-select: none;">
              DESCRIPCIÓN {sortBy === 'description' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th on:click={() => toggleSort('category')} style="padding: 8px 14px; cursor: pointer; user-select: none;">
              CATEGORÍA {sortBy === 'category' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th on:click={() => toggleSort('priority')} style="padding: 8px 14px; cursor: pointer; user-select: none;">
              PRIORIDAD {sortBy === 'priority' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th on:click={() => toggleSort('completed')} style="padding: 8px 14px; cursor: pointer; user-select: none;">
              ESTADO {sortBy === 'completed' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th style="padding: 8px 14px; text-align: right;">ACCIONES</th>
          </tr>
        </thead>

        <tbody>
          {#if paginatedTools.length === 0}
            <tr>
              <td colspan="8" style="padding: 32px 14px; text-align: center; color: #64748b; font-size: 13.5px;">
                No se encontraron registros que coincidan con la búsqueda.
              </td>
            </tr>
          {:else}
            {#each paginatedTools as item (item.uuid || item.id)}
              {@const itemKey = item.uuid || item.id}
              <tr style="border-bottom: 1px solid #f1f5f9; background: {selectedIds.has(itemKey) ? '#eff6ff' : '#ffffff'}; transition: background 0.15s ease;">
                <td style="text-align: center; padding: 10px 14px;">
                  <input 
                    type="checkbox"
                    checked={selectedIds.has(itemKey)}
                    on:change={() => toggleSelectOne(itemKey)}
                    style="cursor: pointer; width: 15px; height: 15px; accent-color: #2563eb;"
                  />
                </td>

                <td style="padding: 10px 14px; font-family: monospace; color: #334155; font-weight: 500;">
                  #{item.id}
                </td>

                <!-- Título -->
                <td style="padding: 10px 14px;">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 16px;">🎴</span>
                    <span style="color: #0f172a; font-weight: 700; font-size: 13.5px;">
                      {item.title}
                    </span>
                  </div>
                </td>

                <!-- Descripción -->
                <td style="padding: 10px 14px;">
                  <span style="color: #475569; font-size: 13px;">
                    {item.description}
                  </span>
                </td>

                <!-- Categoría -->
                <td style="padding: 10px 14px;">
                  <span style="display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 6px; font-size: 11.5px; font-weight: 700; background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe;">
                    {item.category}
                  </span>
                </td>

                <!-- Prioridad -->
                <td style="padding: 10px 14px;">
                  <span style="display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 6px; font-size: 11.5px; font-weight: 700; background: #fef2f2; color: #dc2626; border: 1px solid #fecaca;">
                    {item.priority}
                  </span>
                </td>

                <!-- Estado -->
                <td style="padding: 10px 14px;">
                  <span style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 6px; font-size: 11.5px; font-weight: 700; background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0;">
                    <span style="width: 6px; height: 6px; border-radius: 50%; background: #10b981;"></span>
                    {item.statusLabel}
                  </span>
                </td>

                <!-- Acciones: Botón Jugar -->
                <td style="padding: 10px 14px; text-align: right; min-width: 110px;">
                  <button
                    type="button"
                    on:click={() => openGame(itemKey)}
                    class="btn-flow"
                    style="padding: 6px 16px; font-size: 12.5px; font-weight: 800; border-radius: 7px; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #ffffff; border: none; box-shadow: 0 2px 6px rgba(37, 99, 235, 0.35); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s ease;"
                    title="Jugar / Abrir Scoreboard Baccarad"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                    Jugar
                  </button>
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>

    <!-- Bottom Footer (Exact layout from user screenshot) -->
    <div class="table-toolbar" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; background: #f8fafc; border-top: 1px solid #e2e8f0; flex-wrap: wrap;">
      <!-- Left: Filters Info -->
      <div style="font-size: 13px; color: #475569; font-weight: 500;">
        Total: (<strong style="color: #0f172a; font-weight: 800;">{sortedTools.length}</strong>) &nbsp;|&nbsp; Filtros Totales: (<strong style="color: #0f172a; font-weight: 800;">{totalFilters}</strong>) &nbsp;Filtros: <span style="color: {totalFilters > 0 ? '#2563eb' : '#64748b'}; font-weight: 700;">{activeFilterName}</span>
      </div>

      <!-- Right Controls: [10 filas v] [1 - 1 de 1] [< 1 / 1 >] -->
      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
        <!-- Dropdown Filas -->
        <select 
          bind:value={pageSize}
          style="padding: 4px 8px; border-radius: 6px; border: 1px solid #cbd5e1; background: #ffffff; font-size: 13px; font-weight: 700; color: #0f172a; outline: none; cursor: pointer;">
          <option value={10}>10 filas</option>
          <option value={50}>50 filas</option>
          <option value={100}>100 filas</option>
        </select>

        <!-- Range indicator -->
        <span style="font-size: 13px; font-weight: 700; color: #0f172a;">
          {startRecord} - {endRecord} de {sortedTools.length}
        </span>

        <!-- Compact Pagination Group [< 1 / 1 >] -->
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

  <!-- MODAL / FULL INTERACTIVE SCOREBOARD BACCARAD -->
  {#if isGameOpen}
    <div
      class="sb-modal-backdrop"
      on:click|self={closeGame}
    >
      <div class="sb-modal-window">
        <ScoreboardBaccarat
          isModal={true}
          on:close={closeGame}
        />
      </div>
    </div>
  {/if}
</div>

<style>
  .herramientas-page-container {
    width: 100%;
    margin-bottom: 24px;
  }

  .sb-modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(15, 23, 42, 0.85);
    backdrop-filter: blur(8px);
    z-index: 1000000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    animation: sbFadeIn 0.2s ease-out;
  }

  .sb-modal-window {
    width: 100%;
    max-width: 1280px;
    max-height: 92vh;
    overflow-y: auto;
    border-radius: 16px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
    animation: sbScaleIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes sbFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes sbScaleIn {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>
