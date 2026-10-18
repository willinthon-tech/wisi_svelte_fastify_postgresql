<script>
  import { onMount } from 'svelte';
  import { navigateToRoute } from '../controllers/router.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore, selectedSalaStore } from '../controllers/auth.store.js';
  import { 
    masterSalasStore, 
    userSalasStore as masterUserSalasStore, 
    currentRoutePermissionsStore, 
    getUserModuleActions 
  } from '../controllers/master.store.js';

  // State
  let searchQuery = '';
  let sortBy = 'id';
  let sortDir = 'asc';
  let currentPage = 1;
  let pageSize = 10;
  let selectedIds = new Set();

  // 1. Resolve Salas assigned to current user
  $: userSalasMap = $masterUserSalasStore || {};
  $: currentUserSalas = ($currentUserStore?.uuid || $currentUserStore?.id)
    ? (userSalasMap[$currentUserStore.uuid || $currentUserStore.id] || [])
    : [];

  $: rawAssignedSalas = (function () {
    const user = $currentUserStore;
    if (user && Array.isArray(user.salas) && user.salas.length > 0) {
      return user.salas;
    }
    if ($authUserSalasStore && Array.isArray($authUserSalasStore) && $authUserSalasStore.length > 0) {
      return $authUserSalasStore;
    }
    return [];
  })();

  $: assignedSalaIds = (currentUserSalas.length > 0
    ? currentUserSalas
    : rawAssignedSalas.map(s => typeof s === 'object' ? (s.uuid || s.id) : s)
  ).filter(Boolean).map(String);

  $: detailedSalas = (function () {
    const allSalas = $masterSalasStore || [];
    let list = [];
    if (assignedSalaIds.length === 0) {
      list = allSalas.length > 0 ? allSalas : (rawAssignedSalas.length > 0 ? rawAssignedSalas : [{ id: 1, nombre: 'Sala Principal', grupo_id: 1 }]);
    } else {
      list = assignedSalaIds.map((id) => {
        const found = allSalas.find((s) => String(s.uuid || s.id) === String(id));
        const fallback = rawAssignedSalas.find((s) => typeof s === 'object' && String(s.uuid || s.id) === String(id));
        return found || fallback || { id, uuid: id, nombre: `Sala #${String(id).slice(0, 8)}`, grupo_id: 1 };
      });
    }

    // Filtrar estrictamente solo salas tipo 1 (tipo SALA, no tipo GALPÓN)
    return list.filter((sala) => {
      // 1. Si tiene grupo_id: 1 = SALA, 2 = GALPÓN
      if (sala.grupo_id !== undefined && sala.grupo_id !== null) {
        if (Number(sala.grupo_id) === 2 || Number(sala.grupo_id) !== 1) return false;
      }
      // 2. Si tiene grupo_nombre
      if (sala.grupo_nombre) {
        const gn = String(sala.grupo_nombre).toLowerCase().trim();
        if (gn.includes('galpon') || gn.includes('galpón')) return false;
      }
      // 3. Si tiene tipo_id o tipo
      if (sala.tipo_id !== undefined && sala.tipo_id !== null) {
        if (Number(sala.tipo_id) === 2 || Number(sala.tipo_id) !== 1) return false;
      }
      if (sala.tipo !== undefined && sala.tipo !== null) {
        const t = String(sala.tipo).toLowerCase().trim();
        if (t === '2' || t.includes('galpon') || t.includes('galpón')) return false;
      }
      // 4. Validación por nombre de instalación (excluir Galpon / Galpón)
      const nom = String(sala.nombre || sala.name || '').toLowerCase().trim();
      if (nom.includes('galpon') || nom.includes('galpón')) {
        return false;
      }
      return true;
    });
  })();

  // 2. Generate a row per assigned sala with "Scoreboard Baccarat"
  $: tools = detailedSalas.map((sala, idx) => ({
    id: idx + 1,
    uuid: `tool-sb-${sala.uuid || sala.id || idx + 1}`,
    title: 'Scoreboard Baccarat',
    salaId: sala.uuid || sala.id,
    salaName: sala.nombre || sala.name || `Sala ${sala.id || idx + 1}`,
    category: 'Mesas en Vivo',
    salaObj: sala
  }));

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
      item.salaName.toLowerCase().includes(q)
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

  // Permisología para acciones: "VER" habilita "Observar", "EDITAR" habilita "Jugar"
  $: permissions = (function() {
    const routePerms = $currentRoutePermissionsStore || getUserModuleActions('herramientas') || getUserModuleActions('mod-otros-herramientas');
    if (routePerms) return routePerms;
    const user = $currentUserStore;
    const username = (user?.usuario || '').trim().toLowerCase();
    const isAdmin = username === 'admin' || username === 'willinthon' || user?.is_admin === true || user?.rol === 'admin';
    if (isAdmin) return { canView: true, canEdit: true };
    return { canView: false, canEdit: false };
  })();

  $: canView = Boolean(permissions?.canView);
  $: canEdit = Boolean(permissions?.canEdit);

  function openGame(sala, modo = 'jugar') {
    if (sala?.id || sala?.uuid) {
      selectedSalaStore.set(sala.uuid || sala.id);
    }
    const salaParam = sala?.uuid || sala?.id;
    const qs = modo === 'observar' ? '?modo=observar' : '';
    navigateToRoute(`herramientas/scoreboard-baccarat/${encodeURIComponent(salaParam)}${qs}`);
  }
</script>

<div class="herramientas-page-container">
  <!-- STANDARD FLOWDASH DATATABLE (ADAPTED WITHOUT PRIORIDAD AND ESTADO, REPLACING DESCRIPCION WITH SALA) -->
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
            <th on:click={() => toggleSort('salaName')} style="padding: 8px 14px; cursor: pointer; user-select: none;">
              SALA {sortBy === 'salaName' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
            </th>
            <th style="padding: 8px 14px; text-align: right;">ACCIONES</th>
          </tr>
        </thead>

        <tbody>
          {#if paginatedTools.length === 0}
            <tr>
              <td colspan="5" style="padding: 32px 14px; text-align: center; color: #64748b; font-size: 13.5px;">
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

                <!-- Título: Scoreboard Baccarat (sin icono) -->
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

                <!-- Acciones: Botones Observar y Jugar -->
                <td style="padding: 10px 14px; text-align: right; white-space: nowrap;">
                  <div style="display: inline-flex; align-items: center; justify-content: flex-end; gap: 8px;">
                    {#if canView}
                      <button
                        type="button"
                        on:click={() => openGame(item.salaObj, 'observar')}
                        class="btn-flow btn-action-observar"
                        title="Observar mesas de Baccarat para {item.salaName} (Solo Lectura)"
                      >
                        Observar
                      </button>
                    {/if}

                    {#if canEdit}
                      <button
                        type="button"
                        on:click={() => openGame(item.salaObj, 'jugar')}
                        class="btn-flow btn-action-jugar"
                        title="Jugar y registrar jugadas de Baccarat para {item.salaName}"
                      >
                        Jugar
                      </button>
                    {/if}
                  </div>
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
</div>

<style>
  .herramientas-page-container {
    width: 100%;
    margin-bottom: 24px;
  }

  .btn-action-observar {
    padding: 6px 14px;
    font-size: 12.5px;
    font-weight: 800;
    border-radius: 7px;
    background: #ffffff;
    color: #0284c7;
    border: 1.5px solid #0284c7;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    box-shadow: 0 1px 3px rgba(2, 132, 199, 0.12);
  }
  .btn-action-observar:hover {
    background: #f0f9ff;
    border-color: #0369a1;
    color: #0369a1;
    transform: translateY(-1px);
    box-shadow: 0 3px 8px rgba(2, 132, 199, 0.22);
  }

  .btn-action-jugar {
    padding: 6px 18px;
    font-size: 12.5px;
    font-weight: 800;
    border-radius: 7px;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: #ffffff;
    border: none;
    box-shadow: 0 2px 6px rgba(37, 99, 235, 0.35);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }
  .btn-action-jugar:hover {
    background: linear-gradient(135deg, #1d4ed8, #1e40af);
    transform: translateY(-1px);
    box-shadow: 0 4px 10px rgba(37, 99, 235, 0.45);
  }
</style>
