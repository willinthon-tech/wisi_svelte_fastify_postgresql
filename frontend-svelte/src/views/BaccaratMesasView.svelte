<script>
  import { onMount } from 'svelte';
  import { selectedSalaStore, currentUserStore, userSalasStore as authUserSalasStore } from '../controllers/auth.store.js';
  import { 
    masterSalasStore, 
    masterMesasStore, 
    masterJuegosStore, 
    loadMasterStoresFromBackend 
  } from '../controllers/master.store.js';
  import { navigateToRoute } from '../controllers/router.store.js';

  export let salaId = null;

  // Resolve active salaId
  $: effectiveSalaId = salaId || (() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0];
      const parts = hash.split('/').filter(Boolean);
      if (parts[0] === 'herramientas' && parts[1] === 'scoreboard-baccarat' && parts[2]) {
        return parts[2];
      }
      const sp = new URLSearchParams(window.location.search || window.location.hash.split('?')[1] || '');
      const sParam = sp.get('sala');
      if (sParam) return sParam;
    }
    return $selectedSalaStore;
  })();

  // Resolve Sala Object
  $: currentSala = (() => {
    const sId = String(effectiveSalaId || '');
    const all = $masterSalasStore || [];
    const found = all.find(s => String(s.uuid || s.id) === sId);
    if (found) return found;

    const authSalas = $authUserSalasStore || [];
    const foundAuth = authSalas.find(s => typeof s === 'object' && String(s.uuid || s.id) === sId);
    if (foundAuth) return foundAuth;

    const user = $currentUserStore;
    if (user && Array.isArray(user.salas)) {
      const foundUser = user.salas.find(s => typeof s === 'object' && String(s.uuid || s.id) === sId);
      if (foundUser) return foundUser;
    }

    return { id: sId, uuid: sId, nombre: sId ? `Sala #${sId.slice(0, 8)}` : 'Sala Principal' };
  })();

  $: salaName = currentSala?.nombre || currentSala?.name || currentSala?.nombre_comercial || 'Sala Principal';

  // Filter Baccarat Mesas for this Sala
  $: baccaratMesas = (() => {
    const allMesas = ($masterMesasStore || []).filter(m => (m.active ?? 1) === 1);
    const sId = String(effectiveSalaId || '');

    // Mesas of this sala
    const forThisSala = allMesas.filter(m => {
      const mSala = String(m.sala_uuid || m.sala_id || '');
      return mSala === sId;
    });

    // Match Baccarat / Punto y Banca
    const bacc = forThisSala.filter(m => {
      const jName = String(m.juego_nombre || '').toLowerCase();
      const mName = String(m.nombre || '').toLowerCase();
      const jObj = ($masterJuegosStore || []).find(j => String(j.uuid || j.id) === String(m.juego_uuid || m.juego_id));
      const jFoundName = String(jObj?.nombre || '').toLowerCase();

      return jName.includes('baccarat') || jName.includes('punto') ||
             mName.includes('baccarat') || mName.includes('punto') ||
             jFoundName.includes('baccarat') || jFoundName.includes('punto');
    });

    if (bacc.length > 0) return bacc;

    // If sala has general mesas, list them
    if (forThisSala.length > 0) return forThisSala;

    // Fallback default mesas if none registered yet in DB
    return [
      { id: 1, uuid: 'mesa-01', nombre: 'Mesa 01 - Baccarat', sala_uuid: sId, juego_nombre: 'Baccarat' },
      { id: 2, uuid: 'mesa-02', nombre: 'Mesa 02 - Baccarat VIP', sala_uuid: sId, juego_nombre: 'Baccarat' }
    ];
  })();

  // Transform to table items
  $: tools = baccaratMesas.map((mesa, idx) => ({
    id: idx + 1,
    uuid: mesa.uuid || mesa.id || `mesa-${idx + 1}`,
    rawMesa: mesa,
    title: mesa.nombre || `Mesa ${idx + 1}`,
    salaName: salaName,
    category: mesa.juego_nombre || 'Baccarat',
    mesaId: mesa.uuid || mesa.id
  }));

  // Table State
  let searchQuery = '';
  let sortBy = 'id';
  let sortDir = 'asc';
  let pageSize = 10;
  let currentPage = 1;
  let selectedIds = new Set();

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
      item.salaName.toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
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

  function openMesaScoreboard(mesa) {
    const sId = effectiveSalaId || currentSala?.uuid || currentSala?.id;
    const mId = mesa.uuid || mesa.id;
    navigateToRoute(`herramientas/scoreboard-baccarat/${encodeURIComponent(sId)}/${encodeURIComponent(mId)}`);
  }

  function goBackToSalas() {
    navigateToRoute('herramientas');
  }

  onMount(async () => {
    await loadMasterStoresFromBackend().catch(() => {});
  });
</script>

<div class="baccarat-mesas-view-container">
  <!-- Top Navigation Bar & Sala Breadcrumb -->
  <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; flex-wrap: wrap;">
    <div style="display: flex; align-items: center; gap: 10px;">
      <h2 style="margin: 0; font-size: 17px; font-weight: 800; color: #0f172a; letter-spacing: -0.3px;">
        {salaName}
      </h2>
      <span style="font-size: 11.5px; font-weight: 700; color: #2563eb; background: #eff6ff; border: 1px solid #bfdbfe; padding: 2px 8px; border-radius: 6px;">
        Mesas de Baccarat
      </span>
    </div>

    <div>
      <button
        type="button"
        on:click={goBackToSalas}
        class="btn-flow"
        style="padding: 7px 16px; font-size: 13px; font-weight: 700; border-radius: 8px; background: #ffffff; color: #334155; border: 1px solid #cbd5e1; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 1px 2px rgba(0,0,0,0.05); transition: all 0.15s ease;"
        title="Volver a la selección de salas en Herramientas"
      >
        Atrás
      </button>
    </div>
  </div>

  <!-- FLOWDASH TABLE CONTAINER -->
  <div class="table-container" style="background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); overflow: hidden;">
    
    <!-- Top Bar: Search Input -->
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
            <th on:click={() => toggleSort('salaName')} style="padding: 8px 14px; cursor: pointer; user-select: none;">
              SALA {sortBy === 'salaName' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th on:click={() => toggleSort('category')} style="padding: 8px 14px; cursor: pointer; user-select: none;">
              CATEGORÍA {sortBy === 'category' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th style="padding: 8px 14px; text-align: right;">ACCIONES</th>
          </tr>
        </thead>

        <tbody>
          {#if paginatedTools.length === 0}
            <tr>
              <td colspan="6" style="padding: 32px 14px; text-align: center; color: #64748b; font-size: 13.5px;">
                No se encontraron mesas de baccarat que coincidan con la búsqueda.
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

                <!-- Título: Nombre de la Mesa (sin icono) -->
                <td style="padding: 10px 14px;">
                  <span style="color: #0f172a; font-weight: 700; font-size: 13.5px;">
                    {item.title}
                  </span>
                </td>

                <!-- Sala (sin icono) -->
                <td style="padding: 10px 14px;">
                  <span style="color: #0f172a; font-weight: 700; font-size: 13px;">
                    {item.salaName}
                  </span>
                </td>

                <!-- Categoría / Juego -->
                <td style="padding: 10px 14px;">
                  <span style="display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 6px; font-size: 11.5px; font-weight: 700; background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe;">
                    {item.category}
                  </span>
                </td>

                <!-- Acciones: Botón Jugar -->
                <td style="padding: 10px 14px; text-align: right; min-width: 110px;">
                  <button
                    type="button"
                    on:click={() => openMesaScoreboard(item)}
                    class="btn-flow"
                    style="padding: 6px 16px; font-size: 12.5px; font-weight: 800; border-radius: 7px; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #ffffff; border: none; box-shadow: 0 2px 6px rgba(37, 99, 235, 0.35); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all 0.15s ease;"
                    title="Jugar / Abrir Scoreboard para {item.title}"
                  >
                    Jugar
                  </button>
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>

    <!-- Bottom Footer -->
    <div class="table-toolbar" style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; background: #f8fafc; border-top: 1px solid #e2e8f0; flex-wrap: wrap;">
      <!-- Left: Filters Info -->
      <div style="font-size: 13px; color: #475569; font-weight: 500;">
        Total: (<strong style="color: #0f172a; font-weight: 800;">{sortedTools.length}</strong>) &nbsp;|&nbsp; Filtros Totales: (<strong style="color: #0f172a; font-weight: 800;">{totalFilters}</strong>) &nbsp;Filtros: <span style="color: {totalFilters > 0 ? '#2563eb' : '#64748b'}; font-weight: 700;">{activeFilterName}</span>
      </div>

      <!-- Right Controls: [10 filas v] [1 - X de X] [< 1 / 1 >] -->
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
          <span style="padding: 3px 10px; background: #ffffff; color: #0f172a; font-size: 12.5px; font-weight: 700; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
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
</div>

<style>
  .baccarat-mesas-view-container {
    padding: 2px;
  }
  .btn-flow:hover {
    filter: brightness(1.08);
  }
  .data-table th:hover {
    color: #0f172a;
  }
</style>
