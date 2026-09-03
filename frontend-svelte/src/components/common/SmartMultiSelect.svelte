<script>
  import { createEventDispatcher, onMount } from 'svelte';

  export let label = 'Filtro';
  export let icon = '';
  export let options = []; // Array of { id / key, label / nombre, count }
  export let selectedValues = []; // Array of selected keys/ids
  export let placeholder = 'Buscar...';
  export let groupBy = null; // Optional field to group items by (e.g. 'sala_nombre')
  export let groupParentBy = null; // Optional grandparent field (e.g. 'sala_nombre')
  export let parentIcon = '📍';
  export let subGroupIcon = '🏢';

  const dispatch = createEventDispatcher();

  let isOpen = false;
  let search = '';
  let containerRef = null;

  function toggleOpen() {
    isOpen = !isOpen;
    if (isOpen) {
      search = '';
    }
  }

  function closeDropdown() {
    isOpen = false;
  }

  function handleDocumentClick(event) {
    if (containerRef && !containerRef.contains(event.target)) {
      closeDropdown();
    }
  }

  onMount(() => {
    document.addEventListener('click', handleDocumentClick);
    return () => {
      document.removeEventListener('click', handleDocumentClick);
    };
  });

  // Reactive Set for O(1) instant lookup and bulletproof Svelte reactivity
  $: selectedSet = new Set((selectedValues || []).map(v => String(v)));

  function getOptVal(opt) {
    if (!opt) return undefined;
    if (opt.key !== undefined) return opt.key;
    if (opt.id !== undefined) return opt.id;
    if (opt.value !== undefined) return opt.value;
    return undefined;
  }

  // Filter out options with count === 0 unless they are currently selected, and sort by count DESC
  $: visibleOptions = (options || [])
    .filter(opt => {
      const optVal = getOptVal(opt);
      const isSel = selectedSet.has(String(optVal));
      if (!isSel && opt.count !== undefined && Number(opt.count) <= 0) {
        return false;
      }
      return true;
    })
    .sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));

  $: filteredOptions = visibleOptions.filter(opt => {
    if (!search.trim()) return true;
    const term = search.toLowerCase().trim();
    const optLabel = String(opt.label || opt.nombre || opt.key || opt.id || '').toLowerCase();
    const groupVal = groupBy ? String(opt[groupBy] || '').toLowerCase() : '';
    const parentVal = groupParentBy ? String(opt[groupParentBy] || '').toLowerCase() : '';
    return optLabel.includes(term) || groupVal.includes(term) || parentVal.includes(term);
  });

  $: groupedResult = (function() {
    if (groupParentBy && groupBy) {
      // 2-Level Nested Grouping (Grandparent -> Parent -> Children)
      const parentMap = new Map();
      for (const opt of filteredOptions) {
        const pName = opt[groupParentBy] || 'Sin Sala Asignada';
        const gName = opt[groupBy] || 'Sin Categoría';
        if (!parentMap.has(pName)) {
          parentMap.set(pName, new Map());
        }
        const subMap = parentMap.get(pName);
        if (!subMap.has(gName)) {
          subMap.set(gName, []);
        }
        subMap.get(gName).push(opt);
      }

      const parentsArr = Array.from(parentMap.entries()).map(([parentName, subMap]) => {
        const subGroupsArr = Array.from(subMap.entries()).map(([subGroupName, items]) => {
          items.sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));
          const subTotal = items.reduce((acc, it) => acc + (Number(it.count) || 0), 0);
          return {
            subGroupName,
            items,
            subTotal,
            subCount: items.length
          };
        });

        subGroupsArr.sort((a, b) => {
          if (b.subCount !== a.subCount) return b.subCount - a.subCount;
          return b.subTotal - a.subTotal;
        });

        const totalParentItems = subGroupsArr.reduce((acc, sg) => acc + sg.subCount, 0);
        const totalParentRecords = subGroupsArr.reduce((acc, sg) => acc + sg.subTotal, 0);

        return {
          parentName,
          subGroups: subGroupsArr,
          totalParentItems,
          totalParentRecords
        };
      });

      parentsArr.sort((a, b) => {
        if (b.totalParentItems !== a.totalParentItems) return b.totalParentItems - a.totalParentItems;
        return b.totalParentRecords - a.totalParentRecords;
      });

      return { isNested: true, parents: parentsArr };
    }

    if (!groupBy) {
      return { isNested: false, groups: [{ groupName: null, items: filteredOptions }] };
    }

    const groupsMap = new Map();
    for (const opt of filteredOptions) {
      const gName = opt[groupBy] || 'Sin Sala Asignada';
      if (!groupsMap.has(gName)) {
        groupsMap.set(gName, []);
      }
      groupsMap.get(gName).push(opt);
    }

    const groupsArr = Array.from(groupsMap.entries()).map(([groupName, items]) => {
      // 1. Sub-ordenar dentro de cada sala por biométrico con más registros (count DESC)
      items.sort((a, b) => (Number(b.count) || 0) - (Number(a.count) || 0));
      const totalCount = items.reduce((acc, it) => acc + (Number(it.count) || 0), 0);
      return {
        groupName,
        items,
        totalCount,
        deviceCount: items.length
      };
    });

    // 2. Ordenar las salas: primero por la sala que tenga más dispositivos, luego por más registros totales
    groupsArr.sort((a, b) => {
      if (b.deviceCount !== a.deviceCount) {
        return b.deviceCount - a.deviceCount;
      }
      return b.totalCount - a.totalCount;
    });

    return { isNested: false, groups: groupsArr };
  })();

  function toggleOption(val) {
    const valStr = String(val);
    let updated;
    if (selectedSet.has(valStr)) {
      updated = (selectedValues || []).filter(s => String(s) !== valStr);
    } else {
      updated = [...(selectedValues || []), val];
    }
    selectedValues = updated;
    dispatch('change', updated);
  }

  function selectAll() {
    const all = filteredOptions.map(opt => getOptVal(opt));
    const set = new Set([...(selectedValues || []), ...all]);
    const updated = Array.from(set);
    selectedValues = updated;
    dispatch('change', updated);
  }

  function clearAll() {
    const activeCurrentKeys = new Set(filteredOptions.map(opt => String(getOptVal(opt))));
    const updated = (selectedValues || []).filter(s => !activeCurrentKeys.has(String(s)));
    selectedValues = updated;
    dispatch('change', updated);
  }

  $: totalSelectedCount = (selectedValues || []).length;
</script>

<div class="smart-multiselect-container {isOpen ? 'is-open' : ''}" bind:this={containerRef}>
  <!-- Trigger Button -->
  <button
    type="button"
    class="smart-multiselect-trigger {totalSelectedCount > 0 ? 'active' : ''} {isOpen ? 'open' : ''}"
    on:click={toggleOpen}
    aria-haspopup="listbox"
    aria-expanded={isOpen}
    title="{label}: {totalSelectedCount} seleccionado(s)"
  >
    <div class="trigger-left">
      {#if icon}
        <span class="trigger-icon">{icon}</span>
      {/if}
      <span class="trigger-label">{label}</span>
    </div>

    <div class="trigger-right">
      {#if totalSelectedCount > 0}
        <span class="trigger-badge">{totalSelectedCount}</span>
      {/if}
      <span class="trigger-caret">▾</span>
    </div>
  </button>

  <!-- Dropdown Menu -->
  {#if isOpen}
    <div class="smart-multiselect-dropdown animate-scale-in">
      <!-- Header with Search & Quick Actions -->
      <div class="dropdown-header">
        {#if options.length > 5}
          <div class="search-input-box">
            <span class="search-icon">🔍</span>
            <input
              type="text"
              bind:value={search}
              placeholder={placeholder}
              class="dropdown-search-input"
            />
            {#if search}
              <button type="button" class="clear-search-btn" on:click={() => search = ''}>✕</button>
            {/if}
          </div>
        {/if}

        <div class="dropdown-actions">
          <button type="button" class="action-btn" on:click={selectAll}>
            Seleccionar todos
          </button>
          <span class="divider">|</span>
          <button type="button" class="action-btn text-danger" on:click={clearAll}>
            Limpiar
          </button>
        </div>
      </div>

      <!-- Option List with Optional Groups -->
      <div class="dropdown-options-list" role="listbox">
        {#if filteredOptions.length === 0}
          <div class="empty-message">
            No se encontraron opciones
          </div>
        {:else if groupedResult.isNested}
          {#each groupedResult.parents as parent}
            <div class="option-group-header parent-level">
              <span class="group-header-icon">{parentIcon}</span>
              <span class="group-header-title">{parent.parentName}</span>
              <span class="group-header-count">({parent.totalParentItems})</span>
            </div>
            {#each parent.subGroups as sub}
              <div class="option-subgroup-header">
                <span class="subgroup-header-icon">{subGroupIcon}</span>
                <span class="subgroup-header-title">{sub.subGroupName}</span>
                <span class="subgroup-header-count">({sub.items.length})</span>
              </div>
              {#each sub.items as opt}
                {@const optVal = getOptVal(opt)}
                {@const optLabel = opt.label || opt.nombre || optVal}
                {@const active = selectedSet.has(String(optVal))}
                
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div
                  class="option-item nested-item {active ? 'selected' : ''}"
                  on:click|stopPropagation={() => toggleOption(optVal)}
                  on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleOption(optVal); } }}
                  role="option"
                  aria-selected={active}
                  tabindex="0"
                >
                  <div class="custom-checkbox {active ? 'checked' : ''}">
                    {#if active}
                      <svg viewBox="0 0 20 20" fill="currentColor" class="check-svg">
                        <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                      </svg>
                    {/if}
                  </div>
                  <span class="option-label" title={optLabel}>
                    {optLabel}
                  </span>
                  {#if opt.count !== undefined}
                    <span class="option-count-badge">
                      {Number(opt.count).toLocaleString('es-VE')}
                    </span>
                  {/if}
                </div>
              {/each}
            {/each}
          {/each}
        {:else}
          {#each groupedResult.groups as group}
            {#if group.groupName}
              <div class="option-group-header">
                <span class="group-header-icon">{parentIcon}</span>
                <span class="group-header-title">{group.groupName}</span>
                <span class="group-header-count">({group.items.length})</span>
              </div>
            {/if}
            {#each group.items as opt}
              {@const optVal = getOptVal(opt)}
              {@const optLabel = opt.label || opt.nombre || optVal}
              {@const active = selectedSet.has(String(optVal))}
              
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div
                class="option-item {active ? 'selected' : ''}"
                on:click|stopPropagation={() => toggleOption(optVal)}
                on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleOption(optVal); } }}
                role="option"
                aria-selected={active}
                tabindex="0"
              >
                <div class="custom-checkbox {active ? 'checked' : ''}">
                  {#if active}
                    <svg viewBox="0 0 20 20" fill="currentColor" class="check-svg">
                      <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                    </svg>
                  {/if}
                </div>
                <span class="option-label" title={optLabel}>
                  {optLabel}
                </span>
                {#if opt.count !== undefined}
                  <span class="option-count-badge">
                    {Number(opt.count).toLocaleString('es-VE')}
                  </span>
                {/if}
              </div>
            {/each}
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .smart-multiselect-container {
    position: relative;
    display: block;
    width: 100%;
  }

  .smart-multiselect-container.is-open {
    z-index: 70;
  }

  .smart-multiselect-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    height: 35px;
    padding: 0 8px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    color: #334155;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    box-sizing: border-box;
  }

  .smart-multiselect-trigger:hover {
    border-color: #94a3b8;
    background: #f8fafc;
  }

  .smart-multiselect-trigger.active {
    background: #eff6ff;
    border-color: #3b82f6;
    color: #1d4ed8;
    box-shadow: 0 0 0 1px #3b82f6;
  }

  .smart-multiselect-trigger.open {
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
  }

  .trigger-left {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    flex: 1;
  }

  .trigger-icon {
    font-size: 13px;
    line-height: 1;
    flex-shrink: 0;
  }

  .trigger-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .trigger-right {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    margin-left: 2px;
  }

  .trigger-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    border-radius: 9px;
    background: #2563eb;
    color: #ffffff;
    font-size: 10px;
    font-weight: 800;
    line-height: 1;
  }

  .trigger-caret {
    font-size: 10.5px;
    color: #64748b;
  }

  .smart-multiselect-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    min-width: 250px;
    max-width: 340px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 12px;
    box-shadow: 0 15px 35px -5px rgba(15, 23, 42, 0.18), 0 4px 10px rgba(0, 0, 0, 0.05);
    z-index: 999;
    overflow: hidden;
  }

  .dropdown-header {
    padding: 10px 12px 8px;
    border-bottom: 1px solid #f1f5f9;
    background: #f8fafc;
  }

  .search-input-box {
    position: relative;
    display: flex;
    align-items: center;
    margin-bottom: 6px;
  }

  .search-icon {
    position: absolute;
    left: 9px;
    font-size: 12px;
    color: #94a3b8;
    pointer-events: none;
  }

  .dropdown-search-input {
    width: 100%;
    height: 32px;
    padding: 0 28px 0 28px;
    border: 1px solid #cbd5e1;
    border-radius: 7px;
    font-size: 12px;
    color: #0f172a;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .dropdown-search-input:focus {
    border-color: #2563eb;
  }

  .clear-search-btn {
    position: absolute;
    right: 8px;
    border: none;
    background: none;
    font-size: 11px;
    color: #94a3b8;
    cursor: pointer;
    padding: 2px;
  }

  .clear-search-btn:hover {
    color: #0f172a;
  }

  .dropdown-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    font-size: 11px;
    font-weight: 700;
  }

  .action-btn {
    border: none;
    background: none;
    padding: 2px 4px;
    color: #2563eb;
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.12s ease;
  }

  .action-btn:hover {
    background: #e2e8f0;
  }

  .action-btn.text-danger {
    color: #ef4444;
  }

  .action-btn.text-danger:hover {
    background: #fee2e2;
  }

  .divider {
    color: #cbd5e1;
  }

  .dropdown-options-list {
    max-height: 250px;
    overflow-y: auto;
    padding: 4px 0;
  }

  .option-group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px 5px 12px;
    background: #f1f5f9;
    border-top: 1px solid #e2e8f0;
    border-bottom: 1px solid #e2e8f0;
    font-size: 10.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #475569;
    position: sticky;
    top: -4px;
    z-index: 2;
  }

  .option-group-header.parent-level {
    background: #0f172a;
    color: #f8fafc;
    border-top: 1px solid #1e293b;
    border-bottom: 1px solid #1e293b;
    font-size: 11px;
    letter-spacing: 0.06em;
    top: -4px;
    z-index: 3;
  }

  .option-group-header.parent-level .group-header-count {
    color: #94a3b8;
  }

  .option-subgroup-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px 5px 18px;
    background: #f8fafc;
    border-bottom: 1px dashed #cbd5e1;
    font-size: 11px;
    font-weight: 700;
    color: #334155;
    position: sticky;
    top: 24px;
    z-index: 2;
  }

  .subgroup-header-icon {
    font-size: 11px;
    flex-shrink: 0;
  }

  .subgroup-header-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .subgroup-header-count {
    font-size: 10px;
    font-weight: 700;
    color: #64748b;
    flex-shrink: 0;
  }

  .group-header-icon {
    font-size: 11px;
    flex-shrink: 0;
  }

  .group-header-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .group-header-count {
    font-size: 10px;
    font-weight: 700;
    color: #64748b;
    flex-shrink: 0;
  }

  .option-item.nested-item {
    padding-left: 28px;
  }

  .option-item {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 12px;
    font-size: 12.5px;
    font-weight: 600;
    color: #334155;
    cursor: pointer;
    transition: background 0.1s ease;
  }

  .option-item:hover {
    background: #f1f5f9;
  }

  .option-item.selected {
    background: #f0fdf4;
    color: #166534;
  }

  .custom-checkbox {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1.5px solid #cbd5e1;
    background: #ffffff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .custom-checkbox.checked {
    background: #2563eb;
    border-color: #2563eb;
    color: #ffffff;
  }

  .check-svg {
    width: 12px;
    height: 12px;
  }

  .option-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .option-count-badge {
    font-size: 10.5px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 6px;
    background: #e2e8f0;
    color: #475569;
    flex-shrink: 0;
  }

  .option-item.selected .option-count-badge {
    background: #bbf7d0;
    color: #15803d;
  }

  .empty-message {
    padding: 16px;
    text-align: center;
    font-size: 12px;
    color: #94a3b8;
    font-style: italic;
  }

  .animate-scale-in {
    animation: scaleIn 0.15s ease-out;
  }

  @keyframes scaleIn {
    from {
      opacity: 0;
      transform: translateY(-4px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>
