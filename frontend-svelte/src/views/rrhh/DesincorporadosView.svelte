<script context="module">
  import { writable } from "svelte/store";

  // Persistent Filter State across view navigations
  export const persistentDesincorporadosFilters = writable({
    selectedSalas: [],
    selectedDepartamentos: [],
    selectedAreas: [],
    selectedCargos: [],
    selectedSexo: [],
    searchQuery: ""
  });
</script>

<script>
  import { onMount } from 'svelte';
  import PaginatedDataTable from '../../components/common/PaginatedDataTable.svelte';
  import SmartMultiSelect from '../../components/common/SmartMultiSelect.svelte';
  import { masterCargosStore, masterEmpleadosActions, loadMasterStoresFromBackend } from '../../controllers/master.store.js';
  import { userSalasStore as masterUserSalasStore } from '../../controllers/master.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';

  // Computed assigned sala IDs for the active user
  $: assignedSalaIds = (() => {
    const user = $currentUserStore;
    const userId = user?.id;
    if (!userId) return [];

    const masterMap = $masterUserSalasStore;
    if (
      masterMap &&
      typeof masterMap === "object" &&
      !Array.isArray(masterMap)
    ) {
      const userList = masterMap[userId] || masterMap[String(userId)];
      if (Array.isArray(userList)) {
        return userList
          .map((s) => (typeof s === "object" ? s.id : Number(s)))
          .filter(Boolean);
      }
    }

    const authSalas = $authUserSalasStore;
    if (Array.isArray(authSalas) && authSalas.length > 0) {
      return authSalas
        .map((s) => (typeof s === "object" ? s.id : Number(s)))
        .filter(Boolean);
    }

    return [];
  })();

  // Initialize from persistent store so filters survive page and route transitions
  let initial = {};
  const unsubInit = persistentDesincorporadosFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  // Smart Multiselect Filters State
  let selectedSalas = initial.selectedSalas || [];
  let selectedDepartamentos = initial.selectedDepartamentos || [];
  let selectedAreas = initial.selectedAreas || [];
  let selectedCargos = initial.selectedCargos || [];
  let selectedSexo = initial.selectedSexo || [];
  let searchQuery = initial.searchQuery || "";

  // Sync back to persistent store whenever any filter parameter changes
  $: {
    persistentDesincorporadosFilters.set({
      selectedSalas,
      selectedDepartamentos,
      selectedAreas,
      selectedCargos,
      selectedSexo,
      searchQuery
    });
  }

  // Cascading Facet Options from Backend
  let filterOptions = {
    salas: [],
    departamentos: [],
    areas: [],
    cargos: [],
    sexo: []
  };

  $: preparedCargos = (filterOptions.cargos || []).map(c => ({
    ...c,
    subgroup_label: c.departamento_nombre && c.area_nombre
      ? `${c.departamento_nombre} › ${c.area_nombre}`
      : (c.area_nombre || c.departamento_nombre || 'Sin Área')
  }));

  $: hasActiveFilters = Boolean(
    (searchQuery || "").trim() ||
    selectedSalas.length > 0 ||
    selectedDepartamentos.length > 0 ||
    selectedAreas.length > 0 ||
    selectedCargos.length > 0 ||
    selectedSexo.length > 0
  );

  $: totalFilters = ((searchQuery || "").trim() ? 1 : 0) +
    selectedSalas.length +
    selectedDepartamentos.length +
    selectedAreas.length +
    selectedCargos.length +
    selectedSexo.length;

  let items = [];
  let totalCount = 0;
  let currentPage = 1;
  let pageSize = 10;
  let loading = false;

  let currentParams = {
    page: 1,
    limit: 10,
    search: '',
    sortBy: 'id',
    sortDir: 'desc'
  };

  onMount(async () => {
    await Promise.all([
      loadMasterStoresFromBackend(),
      loadServerData(currentParams)
    ]);
  });

  // Fetch filter options ONLY when active filters, user assigned salas or search change
  let lastFilterKey = "";
  $: filterKey = `${(assignedSalaIds || []).join(",")}_${selectedSalas.join(",")}_${selectedDepartamentos.join(",")}_${selectedAreas.join(",")}_${selectedCargos.join(",")}_${selectedSexo.join(",")}_${(searchQuery || "").trim()}`;
  $: if (filterKey !== lastFilterKey) {
    lastFilterKey = filterKey;
    fetchFilterOptions();
  }

  async function fetchFilterOptions() {
    try {
      const q = new URLSearchParams();
      q.set("activo", "false");
      if (assignedSalaIds.length > 0) q.set("user_sala_ids", assignedSalaIds.join(","));
      if (selectedSalas.length > 0) q.set("sala_ids", selectedSalas.join(","));
      if (selectedDepartamentos.length > 0) q.set("departamento_ids", selectedDepartamentos.join(","));
      if (selectedAreas.length > 0) q.set("area_ids", selectedAreas.join(","));
      if (selectedCargos.length > 0) q.set("cargo_ids", selectedCargos.join(","));
      if (selectedSexo.length > 0) q.set("sexo", selectedSexo.join(","));
      if ((searchQuery || "").trim()) q.set("search", searchQuery.trim());

      const res = await fetch(`/api/master/empleados/filter-options?${q.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && json.data) {
          filterOptions = json.data;
        }
      }
    } catch (e) {
      console.warn("Error fetching filter options from backend:", e);
    }
  }

  async function loadServerData(params = {}) {
    loading = true;
    currentParams = { ...currentParams, ...params };
    try {
      const q = new URLSearchParams({
        page: currentParams.page,
        limit: currentParams.limit,
        search: currentParams.search || '',
        sortBy: currentParams.sortBy || 'id',
        sortDir: currentParams.sortDir || 'desc',
        activo: 'false'
      });
      if (assignedSalaIds && assignedSalaIds.length > 0) {
        q.set('user_sala_ids', assignedSalaIds.join(','));
      }
      if (selectedSalas.length > 0) {
        q.set('sala_ids', selectedSalas.join(','));
      }
      if (selectedDepartamentos.length > 0) {
        q.set('departamento_ids', selectedDepartamentos.join(','));
      }
      if (selectedAreas.length > 0) {
        q.set('area_ids', selectedAreas.join(','));
      }
      if (selectedCargos.length > 0) {
        q.set('cargo_ids', selectedCargos.join(','));
      }
      if (selectedSexo.length > 0) {
        q.set('sexo', selectedSexo.join(','));
      }

      const res = await fetch(`/api/master/empleados?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        items = json.data || [];
        totalCount = json.total || 0;
        currentPage = json.page || 1;
        pageSize = json.limit || 10;
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error al cargar desincorporados del servidor', 'error');
    } finally {
      loading = false;
    }
  }

  function clearAllFilters() {
    searchQuery = "";
    selectedSalas = [];
    selectedDepartamentos = [];
    selectedAreas = [];
    selectedCargos = [];
    selectedSexo = [];
    loadServerData({ page: 1, search: "" });
  }

  $: filteredCargosStore = ($masterCargosStore || []).filter(c => {
    if (!assignedSalaIds || assignedSalaIds.length === 0) return true;
    return !c.sala_id || assignedSalaIds.map(Number).includes(Number(c.sala_id));
  });

  $: columns = [
    { key: 'foto', label: 'Foto', type: 'photo', sortable: false, editable: false },
    { key: 'id', label: 'ID', type: 'id', sortable: true, editable: false },
    { key: 'nombre', label: 'Empleado', bold: true, sortable: true, editable: true },
    { key: 'cedula', label: 'Cédula', sortable: true, editable: true },
    { key: 'fecha_nacimiento', label: 'Fecha de Nacimiento', type: 'fecha_nacimiento', sortable: true, editable: true },
    { key: 'fecha_ingreso', label: 'Fecha de Ingreso', type: 'fecha_ingreso', sortable: true, editable: true },
    { key: 'cargo_nombre', keyId: 'cargo_id', label: 'Cargo', sortable: true, editable: true, options: filteredCargosStore },
    { key: 'sala_nombre', label: 'Sala', sortable: true, editable: false }
  ];

  async function handleSaveInline(event) {
    const { id, draft } = event.detail;
    try {
      await masterEmpleadosActions.update(id, draft);
      triggerToast('Empleado actualizado exitosamente', 'success');
      await loadServerData();
    } catch (err) {
      triggerToast(`Error al actualizar empleado: ${err.message}`, 'error');
    }
  }

  async function handleReincorporate(event) {
    const detail = event.detail || {};
    const item = detail.item || (detail.id ? detail : {});
    const targetId = detail.id || item.id;
    const empName = item.nombre || 'seleccionado';

    try {
      await masterEmpleadosActions.update(targetId, {
        cargo_id: detail.cargo_id ? Number(detail.cargo_id) : undefined,
        fecha_ingreso: detail.fecha_ingreso || undefined,
        activo: true,
        motivo_desincorporacion: null
      });
      triggerToast(`Empleado "${empName}" reincorporado exitosamente`, 'success');
      await loadServerData();
    } catch (err) {
      triggerToast(`Error al reincorporar empleado: ${err.message}`, 'error');
    }
  }

  async function handleBatchReincorporate(event) {
    const ids = event.detail;
    let count = 0;
    for (const id of ids) {
      try {
        await masterEmpleadosActions.update(id, { activo: true });
        count++;
      } catch (e) {
        console.error(e);
      }
    }
    triggerToast(`${count} empleados reincorporados masivamente`, 'success');
    await loadServerData();
  }
</script>

<PaginatedDataTable 
  {items}
  {totalCount}
  {currentPage}
  {pageSize}
  isServerSide={true}
  {columns}
  bind:searchQuery
  searchPlaceholder="Buscar desincorporados por nombre, cédula, cargo, sala o ID..."
  entityType="desincorporado"
  actions={{ edit: false, delete: false, reincorporate: true }}
  on:fetchServerData={(e) => loadServerData(e.detail)}
  on:saveInline={handleSaveInline}
  on:reincorporate={handleReincorporate}
  on:batchReincorporate={handleBatchReincorporate}
>
  <div slot="filters" class="smart-filters-grid">
    <SmartMultiSelect
      id="filter-desincorporados-salas"
      label="Salas"
      options={filterOptions.salas}
      bind:selectedValues={selectedSalas}
      on:change={(e) => {
        selectedSalas = e.detail;
        loadServerData({ page: 1 });
      }}
    />

    <SmartMultiSelect
      id="filter-desincorporados-departamentos"
      label="Departamento"
      options={filterOptions.departamentos}
      groupBy="sala_nombre"
      bind:selectedValues={selectedDepartamentos}
      on:change={(e) => {
        selectedDepartamentos = e.detail;
        loadServerData({ page: 1 });
      }}
    />

    <SmartMultiSelect
      id="filter-desincorporados-areas"
      label="Área"
      options={filterOptions.areas}
      groupParentBy="sala_nombre"
      groupBy="departamento_nombre"
      bind:selectedValues={selectedAreas}
      on:change={(e) => {
        selectedAreas = e.detail;
        loadServerData({ page: 1 });
      }}
    />

    <SmartMultiSelect
      id="filter-desincorporados-cargos"
      label="Cargo"
      options={preparedCargos}
      groupParentBy="sala_nombre"
      groupBy="subgroup_label"
      bind:selectedValues={selectedCargos}
      on:change={(e) => {
        selectedCargos = e.detail;
        loadServerData({ page: 1 });
      }}
    />

    <SmartMultiSelect
      id="filter-desincorporados-sexo"
      label="Sexo"
      options={filterOptions.sexo}
      bind:selectedValues={selectedSexo}
      on:change={(e) => {
        selectedSexo = e.detail;
        loadServerData({ page: 1 });
      }}
    />
  </div>

  <div slot="search-actions">
    {#if hasActiveFilters}
      <button
        type="button"
        on:click={clearAllFilters}
        style="padding: 7px 14px; font-size: 12px; font-weight: 700; color: #ef4444; border: 1px solid #fca5a5; border-radius: 8px; background: #fef2f2; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.04); white-space: nowrap;"
        title="Restablecer búsqueda y todos los filtros"
      >
        <span>✕</span> Limpiar Filtros ({totalFilters})
      </button>
    {/if}
  </div>
</PaginatedDataTable>

<style>
  .smart-filters-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
    width: 100%;
    align-items: center;
  }

  @media (max-width: 1280px) {
    .smart-filters-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 768px) {
    .smart-filters-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 480px) {
    .smart-filters-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
