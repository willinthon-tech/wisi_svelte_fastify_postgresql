<script context="module">
  import { writable } from "svelte/store";

  // Persistent Filter State across view navigations
  export const persistentMaquinasFilters = writable({
    searchNombre: "",
    searchSerial: "",
    selectedSociedades: [],
    selectedLegales: [],
    selectedMarcas: [],
    selectedModelos: [],
    selectedJuegos: [],
    selectedGrupos: [],
    selectedSalas: [],
    selectedEstados: [],
    selectedValores: [],
    selectedTipos: [],
    selectedModos: [],
    selectedRangos: [],
    searchQuery: ""
  });
</script>

<script>
  import { onMount } from 'svelte';
  import PaginatedDataTable from '../../components/common/PaginatedDataTable.svelte';
  import SmartMultiSelect from '../../components/common/SmartMultiSelect.svelte';
  import { 
    masterSalasStore, 
    masterMaquinasStore, 
    masterRangosStore, 
    masterJuegosMaquinasStore,
    masterEstadosStore,
    masterSociedadesStore,
    masterValoresStore,
    masterModelosStore,
    masterTiposStore,
    masterModosStore,
    masterLegalStore,
    loadMasterStoresFromBackend 
  } from '../../controllers/master.store.js';
  import { userSalasStore as masterUserSalasStore } from '../../controllers/master.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { getLocalItems, upsertLocalItem, deleteLocalItem, queueOutboxAction, generateSafeUuid } from '../../services/localDb.service.js';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { navigateToRoute } from '../../controllers/router.store.js';

  $: userSalasMap = $masterUserSalasStore || {};
  $: currentUserSalas = ($currentUserStore?.uuid || $currentUserStore?.id) ? (userSalasMap[$currentUserStore.uuid || $currentUserStore.id] || []) : [];
  $: assignedSalaIds = ((currentUserSalas.length > 0)
    ? currentUserSalas
    : ($authUserSalasStore && $authUserSalasStore.length > 0 ? $authUserSalasStore.map(s => typeof s === 'object' ? (s.uuid || s.id) : s) : [])).map(String);

  // Initialize from persistent store
  let initial = {};
  const unsubInit = persistentMaquinasFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  // Smart Multiselect & Search Filters State
  let searchNombre = initial.searchNombre || "";
  let searchSerial = initial.searchSerial || "";
  let selectedSociedades = initial.selectedSociedades || [];
  let selectedLegales = initial.selectedLegales || [];
  let selectedMarcas = initial.selectedMarcas || [];
  let selectedModelos = initial.selectedModelos || [];
  let selectedJuegos = initial.selectedJuegos || [];
  let selectedGrupos = initial.selectedGrupos || [];
  let selectedSalas = initial.selectedSalas || [];
  let selectedEstados = initial.selectedEstados || [];
  let selectedValores = initial.selectedValores || [];
  let selectedTipos = initial.selectedTipos || [];
  let selectedModos = initial.selectedModos || [];
  let selectedRangos = initial.selectedRangos || [];
  let searchQuery = initial.searchQuery || "";

  // Debounce inputs for searchNombre and searchSerial
  let debounceTimer;
  function handleSearchInputChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      loadServerData({ page: 1 });
    }, 300);
  }

  // Sync back to persistent store whenever any filter parameter changes
  $: {
    persistentMaquinasFilters.set({
      searchNombre,
      searchSerial,
      selectedSociedades,
      selectedLegales,
      selectedMarcas,
      selectedModelos,
      selectedJuegos,
      selectedGrupos,
      selectedSalas,
      selectedEstados,
      selectedValores,
      selectedTipos,
      selectedModos,
      selectedRangos,
      searchQuery
    });
  }

  // Cascading Facet Options from Backend
  let filterOptions = {
    grupos: [],
    salas: [],
    marcas: [],
    juegos: [],
    estados: [],
    sociedades: [],
    valores: [],
    modelos: [],
    tipos: [],
    modos: [],
    legales: [],
    rangos: []
  };

  $: hasActiveFilters = Boolean(
    (searchNombre || "").trim() ||
    (searchSerial || "").trim() ||
    (searchQuery || "").trim() ||
    selectedSociedades.length > 0 ||
    selectedLegales.length > 0 ||
    selectedMarcas.length > 0 ||
    selectedModelos.length > 0 ||
    selectedJuegos.length > 0 ||
    selectedGrupos.length > 0 ||
    selectedSalas.length > 0 ||
    selectedEstados.length > 0 ||
    selectedValores.length > 0 ||
    selectedTipos.length > 0 ||
    selectedModos.length > 0 ||
    selectedRangos.length > 0
  );

  $: totalFilters = ((searchNombre || "").trim() ? 1 : 0) +
    ((searchSerial || "").trim() ? 1 : 0) +
    ((searchQuery || "").trim() ? 1 : 0) +
    selectedSociedades.length +
    selectedLegales.length +
    selectedMarcas.length +
    selectedModelos.length +
    selectedJuegos.length +
    selectedGrupos.length +
    selectedSalas.length +
    selectedEstados.length +
    selectedValores.length +
    selectedTipos.length +
    selectedModos.length +
    selectedRangos.length;

  let items = [];
  let totalCount = 0;
  let currentPage = 1;
  let pageSize = 10;
  let isLoading = true;

  let currentParams = {
    page: 1,
    limit: 10,
    search: '',
    sortBy: 'id',
    sortDir: 'desc'
  };

  onMount(async () => {
    isLoading = true;
    await Promise.all([
      loadMasterStoresFromBackend(),
      fetchFilterOptions(),
      loadServerData(currentParams)
    ]);
  });

  // Fetch filter options dynamically whenever active filters, search inputs or user assigned salas change
  let lastFilterKey = "";
  $: filterKey = `${(assignedSalaIds || []).join(",")}_${searchNombre.trim()}_${searchSerial.trim()}_${selectedSociedades.join(",")}_${selectedLegales.join(",")}_${selectedMarcas.join(",")}_${selectedModelos.join(",")}_${selectedJuegos.join(",")}_${selectedGrupos.join(",")}_${selectedSalas.join(",")}_${selectedEstados.join(",")}_${selectedValores.join(",")}_${selectedTipos.join(",")}_${selectedModos.join(",")}_${selectedRangos.join(",")}_${searchQuery.trim()}`;
  $: if (filterKey !== lastFilterKey) {
    lastFilterKey = filterKey;
    fetchFilterOptions();
  }

  async function fetchFilterOptions() {
    try {
      const q = new URLSearchParams();
      if (assignedSalaIds.length > 0) q.set("user_sala_ids", assignedSalaIds.join(","));
      if (selectedGrupos.length > 0) q.set("grupo_ids", selectedGrupos.join(","));
      if (selectedSalas.length > 0) q.set("sala_ids", selectedSalas.join(","));
      if (selectedMarcas.length > 0) q.set("marca_ids", selectedMarcas.join(","));
      if (selectedModelos.length > 0) q.set("modelo_ids", selectedModelos.join(","));
      if (selectedJuegos.length > 0) q.set("juego_ids", selectedJuegos.join(","));
      if (selectedEstados.length > 0) q.set("estado_ids", selectedEstados.join(","));
      if (selectedSociedades.length > 0) q.set("sociedad_ids", selectedSociedades.join(","));
      if (selectedValores.length > 0) q.set("valor_ids", selectedValores.join(","));
      if (selectedTipos.length > 0) q.set("tipo_ids", selectedTipos.join(","));
      if (selectedModos.length > 0) q.set("modo_ids", selectedModos.join(","));
      if (selectedLegales.length > 0) q.set("legal_ids", selectedLegales.join(","));
      if (selectedRangos.length > 0) q.set("rango_ids", selectedRangos.join(","));
      if (searchNombre.trim()) q.set("search_nombre", searchNombre.trim());
      if (searchSerial.trim()) q.set("search_serial", searchSerial.trim());
      if (searchQuery.trim()) q.set("search", searchQuery.trim());

      const res = await fetch(`/api/master/maquinas/filter-options?${q.toString()}`);
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
    currentParams = { ...currentParams, ...params };
    try {
      const q = new URLSearchParams({
        page: currentParams.page || 1,
        limit: currentParams.limit || 10,
        search: currentParams.search !== undefined ? currentParams.search : searchQuery,
        search_nombre: searchNombre.trim(),
        search_serial: searchSerial.trim(),
        sort_by: currentParams.sortBy || currentParams.sort_by || 'id',
        sort_order: currentParams.sortDir || currentParams.sort_order || 'desc'
      });
      if (assignedSalaIds && assignedSalaIds.length > 0) {
        q.set('user_sala_ids', assignedSalaIds.join(','));
      }
      if (selectedGrupos.length > 0) {
        q.set('grupo_ids', selectedGrupos.join(','));
      }
      if (selectedSalas.length > 0) {
        q.set('sala_ids', selectedSalas.join(','));
      }
      if (selectedMarcas.length > 0) {
        q.set('marca_ids', selectedMarcas.join(','));
      }
      if (selectedModelos.length > 0) {
        q.set('modelo_ids', selectedModelos.join(','));
      }
      if (selectedJuegos.length > 0) {
        q.set('juego_ids', selectedJuegos.join(','));
      }
      if (selectedEstados.length > 0) {
        q.set('estado_ids', selectedEstados.join(','));
      }
      if (selectedSociedades.length > 0) {
        q.set('sociedad_ids', selectedSociedades.join(','));
      }
      if (selectedValores.length > 0) {
        q.set('valor_ids', selectedValores.join(','));
      }
      if (selectedTipos.length > 0) {
        q.set('tipo_ids', selectedTipos.join(','));
      }
      if (selectedModos.length > 0) {
        q.set('modo_ids', selectedModos.join(','));
      }
      if (selectedLegales.length > 0) {
        q.set('legal_ids', selectedLegales.join(','));
      }
      if (selectedRangos.length > 0) {
        q.set('rango_ids', selectedRangos.join(','));
      }

      const res = await fetch(`/api/master/maquinas?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        items = json.data || [];
        totalCount = json.total || 0;
        currentPage = json.page || 1;
        pageSize = json.limit || 10;
      }
    } catch (err) {
      console.warn('Fallback local IndexedDB para máquinas:', err);
      const local = await getLocalItems('maquinas');
      const source = (Array.isArray(local) && local.length > 0) ? local : ($masterMaquinasStore || []);
      let filtered = source.filter(x => !x.is_deleted);

      // Aislamiento estricto de sala en fallback local
      if (assignedSalaIds && assignedSalaIds.length > 0) {
        filtered = filtered.filter(x => {
          const s = x.sala_uuid || x.sala_id;
          return s && assignedSalaIds.includes(String(s));
        });
      }
      if (selectedSalas.length > 0) {
        filtered = filtered.filter(x => {
          const s = x.sala_uuid || x.sala_id;
          return s && selectedSalas.includes(String(s));
        });
      }
      if (searchNombre.trim()) {
        filtered = filtered.filter(x => (x.nombre || '').toLowerCase().includes(searchNombre.trim().toLowerCase()));
      }
      if (searchSerial.trim()) {
        filtered = filtered.filter(x => (x.serial || '').toLowerCase().includes(searchSerial.trim().toLowerCase()));
      }
      if (searchQuery && searchQuery.trim()) {
        const qTerm = searchQuery.trim().toLowerCase();
        filtered = filtered.filter(x => 
          (x.nombre || '').toLowerCase().includes(qTerm) ||
          (x.serial || '').toLowerCase().includes(qTerm) ||
          (x.sala_nombre || '').toLowerCase().includes(qTerm)
        );
      }
      if (selectedMarcas.length > 0) {
        filtered = filtered.filter(x => selectedMarcas.includes(String(x.marca_uuid || x.marca_id)));
      }
      if (selectedModelos.length > 0) {
        filtered = filtered.filter(x => selectedModelos.includes(String(x.modelo_uuid || x.modelo_id)));
      }
      if (selectedJuegos.length > 0) {
        filtered = filtered.filter(x => selectedJuegos.includes(String(x.juego_uuid || x.juego_id)));
      }
      if (selectedEstados.length > 0) {
        filtered = filtered.filter(x => selectedEstados.includes(String(x.estado_uuid || x.estado_id)));
      }
      if (selectedSociedades.length > 0) {
        filtered = filtered.filter(x => selectedSociedades.includes(String(x.sociedad_uuid || x.sociedad_id)));
      }
      if (selectedValores.length > 0) {
        filtered = filtered.filter(x => selectedValores.includes(String(x.valor_uuid || x.valor_id)));
      }
      if (selectedTipos.length > 0) {
        filtered = filtered.filter(x => selectedTipos.includes(String(x.tipo_uuid || x.tipo_id)));
      }
      if (selectedModos.length > 0) {
        filtered = filtered.filter(x => selectedModos.includes(String(x.modo_uuid || x.modo_id)));
      }
      if (selectedLegales.length > 0) {
        filtered = filtered.filter(x => selectedLegales.includes(String(x.legal_uuid || x.legal_id)));
      }
      if (selectedRangos.length > 0) {
        filtered = filtered.filter(x => selectedRangos.includes(String(x.rango_uuid || x.rango_id)));
      }
      totalCount = filtered.length;
      const start = ((currentParams.page || 1) - 1) * (currentParams.limit || 10);
      items = filtered.slice(start, start + (currentParams.limit || 10));
    } finally {
      isLoading = false;
    }
  }

  function handleFilterChange() {
    loadServerData({ page: 1 });
  }

  function clearAllFilters() {
    searchNombre = "";
    searchSerial = "";
    searchQuery = "";
    selectedSociedades = [];
    selectedLegales = [];
    selectedMarcas = [];
    selectedModelos = [];
    selectedJuegos = [];
    selectedGrupos = [];
    selectedSalas = [];
    selectedEstados = [];
    selectedValores = [];
    selectedTipos = [];
    selectedModos = [];
    selectedRangos = [];
    loadServerData({ page: 1, search: "" });
  }

  $: filteredSalasStore = ($masterSalasStore || []).filter(s => {
    if (!assignedSalaIds || assignedSalaIds.length === 0) return true;
    return assignedSalaIds.includes(String(s.uuid || s.id));
  });

  $: userSalasForCreate = (filteredSalasStore || []).map(s => ({
    uuid: s.uuid,
    id: s.uuid || s.id,
    nombre: s.nombre,
    subgroup_label: (s.grupo_id === 2 ? 'GALPÓN' : 'SALA')
  }));

  $: modelosForCreate = (filterOptions.modelos && filterOptions.modelos.length > 0
    ? filterOptions.modelos
    : []
  ).map(m => ({
    uuid: m.uuid,
    id: m.uuid || m.id,
    nombre: m.nombre,
    subgroup_label: String(m.subgroup_label || m.marca_nombre || 'GENERAL').toUpperCase()
  }));

  $: defaultSalaId = (assignedSalaIds && assignedSalaIds.length > 0) ? assignedSalaIds[0] : (userSalasForCreate[0]?.uuid || userSalasForCreate[0]?.id || 1);

  $: rangosOptions = ($masterRangosStore && $masterRangosStore.length > 0
    ? $masterRangosStore
    : (filterOptions.rangos || [])
  ).map(r => ({
    uuid: r.uuid,
    id: r.uuid || r.id,
    nombre: r.nombre
  }));

  $: juegosOptions = ($masterJuegosMaquinasStore && $masterJuegosMaquinasStore.length > 0
    ? $masterJuegosMaquinasStore
    : (filterOptions.juegos || [])
  ).map(j => ({
    uuid: j.uuid,
    id: j.uuid || j.id,
    nombre: j.nombre
  }));

  $: estadosOptions = ($masterEstadosStore && $masterEstadosStore.length > 0
    ? $masterEstadosStore
    : (filterOptions.estados || [])
  ).map(e => ({
    uuid: e.uuid,
    id: e.uuid || e.id,
    nombre: e.nombre
  }));

  $: sociedadesOptions = ($masterSociedadesStore && $masterSociedadesStore.length > 0
    ? $masterSociedadesStore
    : (filterOptions.sociedades || [])
  ).map(s => ({
    uuid: s.uuid,
    id: s.uuid || s.id,
    nombre: s.nombre
  }));

  $: valoresOptions = ($masterValoresStore && $masterValoresStore.length > 0
    ? $masterValoresStore
    : (filterOptions.valores || [])
  ).map(v => ({
    uuid: v.uuid,
    id: v.uuid || v.id,
    nombre: v.nombre
  }));

  $: tiposOptions = ($masterTiposStore && $masterTiposStore.length > 0
    ? $masterTiposStore
    : (filterOptions.tipos || [])
  ).map(t => ({
    uuid: t.uuid,
    id: t.uuid || t.id,
    nombre: t.nombre
  }));

  $: modosOptions = ($masterModosStore && $masterModosStore.length > 0
    ? $masterModosStore
    : (filterOptions.modos || [])
  ).map(m => ({
    uuid: m.uuid,
    id: m.uuid || m.id,
    nombre: m.nombre
  }));

  $: legalesOptions = ($masterLegalStore && $masterLegalStore.length > 0
    ? $masterLegalStore
    : (filterOptions.legales || [])
  ).map(l => ({
    uuid: l.uuid,
    id: l.uuid || l.id,
    nombre: l.nombre
  }));

  $: juegosFilterOptions = (filterOptions.juegos && filterOptions.juegos.length > 0)
    ? filterOptions.juegos
    : juegosOptions;

  function hydrateItemNames(item) {
    if (!item) return item;
    const hydrated = { ...item };
    if (!hydrated.juego_nombre && (hydrated.juego_uuid || hydrated.juego_id)) {
      const jId = String(hydrated.juego_uuid || hydrated.juego_id);
      const match = ($masterJuegosMaquinasStore || []).find(j => String(j.uuid || j.id) === jId) ||
                    (filterOptions.juegos || []).find(j => String(j.uuid || j.id) === jId);
      if (match) hydrated.juego_nombre = match.nombre;
    }
    if (!hydrated.sala_nombre && (hydrated.sala_uuid || hydrated.sala_id)) {
      const sId = String(hydrated.sala_uuid || hydrated.sala_id);
      const match = ($masterSalasStore || []).find(s => String(s.uuid || s.id) === sId);
      if (match) hydrated.sala_nombre = match.nombre;
    }
    if (!hydrated.modelo_nombre && (hydrated.modelo_uuid || hydrated.modelo_id)) {
      const mId = String(hydrated.modelo_uuid || hydrated.modelo_id);
      const match = ($masterModelosStore || []).find(m => String(m.uuid || m.id) === mId);
      if (match) hydrated.modelo_nombre = match.nombre;
    }
    if (!hydrated.estado_nombre && (hydrated.estado_uuid || hydrated.estado_id)) {
      const eId = String(hydrated.estado_uuid || hydrated.estado_id);
      const match = ($masterEstadosStore || []).find(e => String(e.uuid || e.id) === eId);
      if (match) hydrated.estado_nombre = match.nombre;
    }
    if (!hydrated.sociedad_nombre && (hydrated.sociedad_uuid || hydrated.sociedad_id)) {
      const sId = String(hydrated.sociedad_uuid || hydrated.sociedad_id);
      const match = ($masterSociedadesStore || []).find(s => String(s.uuid || s.id) === sId);
      if (match) hydrated.sociedad_nombre = match.nombre;
    }
    if (!hydrated.valor_nombre && (hydrated.valor_uuid || hydrated.valor_id)) {
      const vId = String(hydrated.valor_uuid || hydrated.valor_id);
      const match = ($masterValoresStore || []).find(v => String(v.uuid || v.id) === vId);
      if (match) hydrated.valor_nombre = match.nombre;
    }
    if (!hydrated.tipo_nombre && (hydrated.tipo_uuid || hydrated.tipo_id)) {
      const tId = String(hydrated.tipo_uuid || hydrated.tipo_id);
      const match = ($masterTiposStore || []).find(t => String(t.uuid || t.id) === tId);
      if (match) hydrated.tipo_nombre = match.nombre;
    }
    if (!hydrated.modo_nombre && (hydrated.modo_uuid || hydrated.modo_id)) {
      const mId = String(hydrated.modo_uuid || hydrated.modo_id);
      const match = ($masterModosStore || []).find(m => String(m.uuid || m.id) === mId);
      if (match) hydrated.modo_nombre = match.nombre;
    }
    if (!hydrated.legal_nombre && (hydrated.legal_uuid || hydrated.legal_id)) {
      const lId = String(hydrated.legal_uuid || hydrated.legal_id);
      const match = ($masterLegalStore || []).find(l => String(l.uuid || l.id) === lId);
      if (match) hydrated.legal_nombre = match.nombre;
    }
    if (!hydrated.rango_nombre && (hydrated.rango_uuid || hydrated.rango_id)) {
      const rId = String(hydrated.rango_uuid || hydrated.rango_id);
      const match = ($masterRangosStore || []).find(r => String(r.uuid || r.id) === rId);
      if (match) hydrated.rango_nombre = match.nombre;
    }
    return hydrated;
  }

  $: displayItems = (items || []).map(hydrateItemNames);

  // Distribuciones reactivas para panel de badges (Data Filtrada) - Ordenadas de MAYOR a MENOR
  $: distribucionTipos = (filterOptions.tipos || [])
    .filter(t => Number(t.count) > 0)
    .sort((a, b) => Number(b.count) - Number(a.count));

  $: distribucionSociedades = (filterOptions.sociedades || [])
    .filter(s => Number(s.count) > 0)
    .sort((a, b) => Number(b.count) - Number(a.count));

  $: distribucionSalas = (filterOptions.salas || [])
    .filter(s => {
      const lbl = (s.subgroup_label || s.grupo_nombre || '').toLowerCase();
      const isGalpon = lbl.includes('galp') || s.grupo_id === 2 || s.grupo_uuid === '55d65e8b-09b2-4164-8491-efbdd50433b6';
      return !isGalpon && Number(s.count) > 0;
    })
    .sort((a, b) => Number(b.count) - Number(a.count));

  $: distribucionGalpones = (filterOptions.salas || [])
    .filter(s => {
      const lbl = (s.subgroup_label || s.grupo_nombre || '').toLowerCase();
      const isGalpon = lbl.includes('galp') || s.grupo_id === 2 || s.grupo_uuid === '55d65e8b-09b2-4164-8491-efbdd50433b6';
      return isGalpon && Number(s.count) > 0;
    })
    .sort((a, b) => Number(b.count) - Number(a.count));

  function toggleBadgeFilter(type, id) {
    if (!id) return;
    const strId = String(id);
    if (type === 'tipos') {
      if (selectedTipos.includes(strId)) {
        selectedTipos = selectedTipos.filter(x => String(x) !== strId);
      } else {
        selectedTipos = [...selectedTipos, strId];
      }
    } else if (type === 'sociedades') {
      if (selectedSociedades.includes(strId)) {
        selectedSociedades = selectedSociedades.filter(x => String(x) !== strId);
      } else {
        selectedSociedades = [...selectedSociedades, strId];
      }
    } else if (type === 'salas') {
      if (selectedSalas.includes(strId)) {
        selectedSalas = selectedSalas.filter(x => String(x) !== strId);
      } else {
        selectedSalas = [...selectedSalas, strId];
      }
    }
    handleFilterChange();
  }

  async function irAReporte(subtipo) {
    const filtros = {
      search_nombre: searchNombre.trim(),
      search_serial: searchSerial.trim(),
      search: searchQuery.trim(),
      user_sala_ids: assignedSalaIds,
      grupo_ids: selectedGrupos,
      sala_ids: selectedSalas,
      marca_ids: selectedMarcas,
      modelo_ids: selectedModelos,
      juego_ids: selectedJuegos,
      estado_ids: selectedEstados,
      sociedad_ids: selectedSociedades,
      valor_ids: selectedValores,
      tipo_ids: selectedTipos,
      modo_ids: selectedModos,
      legal_ids: selectedLegales,
      rango_ids: selectedRangos
    };

    try {
      const res = await fetch('/api/master/maquinas-reportes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtipo, filtros })
      });
      const json = await res.json();
      if (json && json.success && json.data && json.data.uuid) {
        navigateToRoute(`maquinas/maquinas/vista/${subtipo}?maquinas_reportes=${json.data.uuid}`);
        return;
      }
    } catch (e) {
      console.warn('Fallback a query string para reporte de máquinas:', e);
    }

    const q = new URLSearchParams();
    if (searchNombre.trim()) q.set("search_nombre", searchNombre.trim());
    if (searchSerial.trim()) q.set("search_serial", searchSerial.trim());
    if (searchQuery.trim()) q.set("search", searchQuery.trim());
    if (assignedSalaIds.length > 0) q.set("user_sala_ids", assignedSalaIds.join(","));
    if (selectedGrupos.length > 0) q.set("grupo_ids", selectedGrupos.join(","));
    if (selectedSalas.length > 0) q.set("sala_ids", selectedSalas.join(","));
    if (selectedMarcas.length > 0) q.set("marca_ids", selectedMarcas.join(","));
    if (selectedModelos.length > 0) q.set("modelo_ids", selectedModelos.join(","));
    if (selectedJuegos.length > 0) q.set("juego_ids", selectedJuegos.join(","));
    if (selectedEstados.length > 0) q.set("estado_ids", selectedEstados.join(","));
    if (selectedSociedades.length > 0) q.set("sociedad_ids", selectedSociedades.join(","));
    if (selectedValores.length > 0) q.set("valor_ids", selectedValores.join(","));
    if (selectedTipos.length > 0) q.set("tipo_ids", selectedTipos.join(","));
    if (selectedModos.length > 0) q.set("modo_ids", selectedModos.join(","));
    if (selectedLegales.length > 0) q.set("legal_ids", selectedLegales.join(","));
    if (selectedRangos.length > 0) q.set("rango_ids", selectedRangos.join(","));

    const queryStr = q.toString();
    const route = `maquinas/maquinas/vista/${subtipo}${queryStr ? '?' + queryStr : ''}`;
    navigateToRoute(route);
  }

  // Column definitions for PaginatedDataTable
  $: columns = [
    { key: 'uuid', label: 'ID', type: 'id', sortable: true, editable: false },
    { key: 'nombre', label: 'NOMBRE DE MÁQUINA', bold: true, sortable: true, editable: true },
    { key: 'serial', label: 'SERIAL', bold: true, sortable: true, editable: true },
    { key: 'puestos', label: 'PUESTOS', type: 'number', sortable: true, editable: true },
    { key: 'grupo_sala_nombre', label: 'GRUPO', sortable: true, editable: false },
    { key: 'sala_nombre', keyId: 'sala_uuid', label: 'SALA', sortable: true, editable: true, type: 'select', options: userSalasForCreate },
    { key: 'marca_nombre', label: 'MARCA', sortable: true, editable: false },
    { key: 'modelo_nombre', keyId: 'modelo_uuid', label: 'MODELO', sortable: true, editable: true, type: 'select', options: modelosForCreate },
    { key: 'juego_nombre', keyId: 'juego_uuid', label: 'JUEGO', sortable: true, editable: true, type: 'select', options: juegosOptions },
    { key: 'estado_nombre', keyId: 'estado_uuid', label: 'ESTADO', sortable: true, editable: true, type: 'select', options: estadosOptions },
    { key: 'sociedad_nombre', keyId: 'sociedad_uuid', label: 'SOCIEDAD', sortable: true, editable: true, type: 'select', options: sociedadesOptions },
    { key: 'valor_nombre', keyId: 'valor_uuid', label: 'VALOR', sortable: true, editable: true, type: 'select', options: valoresOptions },
    { key: 'tipo_nombre', keyId: 'tipo_uuid', label: 'TIPO', sortable: true, editable: true, type: 'select', options: tiposOptions },
    { key: 'modo_nombre', keyId: 'modo_uuid', label: 'MODO', sortable: true, editable: true, type: 'select', options: modosOptions },
    { key: 'legal_nombre', keyId: 'legal_uuid', label: 'LEGAL', sortable: true, editable: true, type: 'select', options: legalesOptions },
    { key: 'rango_nombre', keyId: 'rango_uuid', label: 'RANGO', sortable: true, editable: true, type: 'select', options: rangosOptions }
  ];

  // Create modal form fields: nombre and serial are at the BOTTOM in col-6 format
  $: createFields = [
    {
      type: 'row',
      fields: [
        { key: 'puestos', label: 'Puestos', type: 'number', placeholder: '1', defaultValue: 1, min: 1, required: true },
        { key: 'sala_uuid', label: 'Sala Asignada', type: 'select', options: userSalasForCreate, required: true, defaultValue: defaultSalaId }
      ]
    },
    {
      type: 'row',
      fields: [
        { key: 'juego_uuid', label: 'Juego', type: 'select', options: juegosOptions, required: false },
        { key: 'estado_uuid', label: 'Estado', type: 'select', options: estadosOptions, required: false }
      ]
    },
    {
      type: 'row',
      fields: [
        { key: 'sociedad_uuid', label: 'Sociedad', type: 'select', options: sociedadesOptions, required: false },
        { key: 'valor_uuid', label: 'Valor', type: 'select', options: valoresOptions, required: false }
      ]
    },
    {
      type: 'row',
      fields: [
        { key: 'modelo_uuid', label: 'Modelo', type: 'select', options: modelosForCreate, required: false },
        { key: 'tipo_uuid', label: 'Tipo', type: 'select', options: tiposOptions, required: false }
      ]
    },
    {
      type: 'row',
      fields: [
        { key: 'modo_uuid', label: 'Modo', type: 'select', options: modosOptions, required: false },
        { key: 'legal_uuid', label: 'Legal', type: 'select', options: legalesOptions, required: false }
      ]
    },
    {
      type: 'row',
      fields: [
        { key: 'rango_uuid', label: 'Rango', type: 'select', options: rangosOptions, required: false }
      ]
    },
    {
      type: 'row',
      fields: [
        { key: 'nombre', label: 'Nombre de Máquina', type: 'text', placeholder: 'Ej. MAQ-001 (o N/A)', required: false },
        { key: 'serial', label: 'Serial de Máquina', type: 'text', placeholder: 'Ej. SN-89234812 (o N/A)', required: false }
      ]
    }
  ];

  async function handleCreate(event) {
    let draft = { ...event.detail };
    if (!draft.uuid) {
      draft.uuid = generateSafeUuid();
    }
    const fkMap = ['sala', 'juego', 'estado', 'sociedad', 'valor', 'modelo', 'tipo', 'modo', 'legal', 'rango'];
    fkMap.forEach(f => {
      if (draft[`${f}_uuid`] && !draft[`${f}_id`]) draft[`${f}_id`] = draft[`${f}_uuid`];
    });

    if (draft.juego_uuid) {
      const matched = juegosOptions.find(j => String(j.uuid || j.id) === String(draft.juego_uuid));
      if (matched) draft.juego_nombre = matched.nombre;
    }
    if (draft.sala_uuid) {
      const matched = userSalasForCreate.find(s => String(s.uuid || s.id) === String(draft.sala_uuid));
      if (matched) draft.sala_nombre = matched.nombre;
    }
    if (draft.modelo_uuid) {
      const matched = modelosForCreate.find(m => String(m.uuid || m.id) === String(draft.modelo_uuid));
      if (matched) draft.modelo_nombre = matched.nombre;
    }
    if (draft.estado_uuid) {
      const matched = estadosOptions.find(e => String(e.uuid || e.id) === String(draft.estado_uuid));
      if (matched) draft.estado_nombre = matched.nombre;
    }
    if (draft.sociedad_uuid) {
      const matched = sociedadesOptions.find(s => String(s.uuid || s.id) === String(draft.sociedad_uuid));
      if (matched) draft.sociedad_nombre = matched.nombre;
    }
    if (draft.valor_uuid) {
      const matched = valoresOptions.find(v => String(v.uuid || v.id) === String(draft.valor_uuid));
      if (matched) draft.valor_nombre = matched.nombre;
    }
    if (draft.tipo_uuid) {
      const matched = tiposOptions.find(t => String(t.uuid || t.id) === String(draft.tipo_uuid));
      if (matched) draft.tipo_nombre = matched.nombre;
    }
    if (draft.modo_uuid) {
      const matched = modosOptions.find(m => String(m.uuid || m.id) === String(draft.modo_uuid));
      if (matched) draft.modo_nombre = matched.nombre;
    }
    if (draft.legal_uuid) {
      const matched = legalesOptions.find(l => String(l.uuid || l.id) === String(draft.legal_uuid));
      if (matched) draft.legal_nombre = matched.nombre;
    }
    if (draft.rango_uuid) {
      const matchedRango = rangosOptions.find(r => String(r.uuid || r.id) === String(draft.rango_uuid));
      if (matchedRango) {
        draft.rango_nombre = matchedRango.nombre;
      }
    }

    // 0ms instant local-first execution
    const newUuid = draft.uuid || generateSafeUuid();
    const localItem = { ...draft, uuid: newUuid, id: newUuid, created_at: new Date().toISOString() };

    // 1. Inmediatamente actualizar memoria reactiva (0ms)
    items = [localItem, ...items.filter(x => String(x.uuid || x.id) !== String(localItem.uuid))];
    totalCount++;
    triggerToast('Máquina registrada exitosamente', 'success');

    // 2. Persistencia local inmediata en IndexedDB (<5ms)
    upsertLocalItem('maquinas', localItem).catch(() => {});

    // 3. Sincronización en segundo plano sin bloquear la UI
    (async () => {
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        await queueOutboxAction({
          entity: 'maquinas',
          action: 'create',
          endpoint: '/api/master/maquinas',
          method: 'POST',
          payload: draft,
          uuid: newUuid
        });
        return;
      }

      try {
        const controller = new AbortController();
        const tId = setTimeout(() => controller.abort(), 12000);
        const res = await fetch('/api/master/maquinas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...draft, uuid: newUuid }),
          signal: controller.signal
        });
        clearTimeout(tId);
        const json = await res.json().catch(() => ({}));
        if (res.ok && json && json.success) {
          const created = json.data || localItem;
          await upsertLocalItem('maquinas', created);
          items = items.map(x => String(x.uuid || x.id) === String(newUuid) ? { ...x, ...created } : x);
        } else {
          throw new Error(json?.error || 'Error al guardar máquina en servidor');
        }
      } catch (err) {
        console.warn('[LocalDb] Encolando outbox para máquina:', err.message);
        await queueOutboxAction({
          entity: 'maquinas',
          action: 'create',
          endpoint: '/api/master/maquinas',
          method: 'POST',
          payload: draft,
          uuid: newUuid
        });
      }
    })();
  }

  async function handleSaveInline(event) {
    const { id, draft } = event.detail;
    const targetUuid = id;
    const payload = { ...draft };
    const fkMap = ['sala', 'juego', 'estado', 'sociedad', 'valor', 'modelo', 'tipo', 'modo', 'legal', 'rango'];
    fkMap.forEach(f => {
      if (payload[`${f}_uuid`] && !payload[`${f}_id`]) payload[`${f}_id`] = payload[`${f}_uuid`];
    });

    if (payload.juego_uuid !== undefined) {
      if (payload.juego_uuid) {
        const matched = juegosOptions.find(j => String(j.uuid || j.id) === String(payload.juego_uuid));
        payload.juego_nombre = matched ? matched.nombre : null;
      } else {
        payload.juego_nombre = null;
      }
    }
    if (payload.sala_uuid !== undefined) {
      if (payload.sala_uuid) {
        const matched = userSalasForCreate.find(s => String(s.uuid || s.id) === String(payload.sala_uuid));
        payload.sala_nombre = matched ? matched.nombre : null;
      } else {
        payload.sala_nombre = null;
      }
    }
    if (payload.modelo_uuid !== undefined) {
      if (payload.modelo_uuid) {
        const matched = modelosForCreate.find(m => String(m.uuid || m.id) === String(payload.modelo_uuid));
        payload.modelo_nombre = matched ? matched.nombre : null;
      } else {
        payload.modelo_nombre = null;
      }
    }
    if (payload.estado_uuid !== undefined) {
      if (payload.estado_uuid) {
        const matched = estadosOptions.find(e => String(e.uuid || e.id) === String(payload.estado_uuid));
        payload.estado_nombre = matched ? matched.nombre : null;
      } else {
        payload.estado_nombre = null;
      }
    }
    if (payload.sociedad_uuid !== undefined) {
      if (payload.sociedad_uuid) {
        const matched = sociedadesOptions.find(s => String(s.uuid || s.id) === String(payload.sociedad_uuid));
        payload.sociedad_nombre = matched ? matched.nombre : null;
      } else {
        payload.sociedad_nombre = null;
      }
    }
    if (payload.valor_uuid !== undefined) {
      if (payload.valor_uuid) {
        const matched = valoresOptions.find(v => String(v.uuid || v.id) === String(payload.valor_uuid));
        payload.valor_nombre = matched ? matched.nombre : null;
      } else {
        payload.valor_nombre = null;
      }
    }
    if (payload.tipo_uuid !== undefined) {
      if (payload.tipo_uuid) {
        const matched = tiposOptions.find(t => String(t.uuid || t.id) === String(payload.tipo_uuid));
        payload.tipo_nombre = matched ? matched.nombre : null;
      } else {
        payload.tipo_nombre = null;
      }
    }
    if (payload.modo_uuid !== undefined) {
      if (payload.modo_uuid) {
        const matched = modosOptions.find(m => String(m.uuid || m.id) === String(payload.modo_uuid));
        payload.modo_nombre = matched ? matched.nombre : null;
      } else {
        payload.modo_nombre = null;
      }
    }
    if (payload.legal_uuid !== undefined) {
      if (payload.legal_uuid) {
        const matched = legalesOptions.find(l => String(l.uuid || l.id) === String(payload.legal_uuid));
        payload.legal_nombre = matched ? matched.nombre : null;
      } else {
        payload.legal_nombre = null;
      }
    }
    if (payload.rango_uuid !== undefined) {
      if (payload.rango_uuid) {
        const matchedRango = rangosOptions.find(r => String(r.uuid || r.id) === String(payload.rango_uuid));
        payload.rango_nombre = matchedRango ? matchedRango.nombre : null;
      } else {
        payload.rango_nombre = null;
      }
    }

    const existing = items.find(x => String(x.uuid || x.id) === String(targetUuid)) || {};
    const updated = { ...existing, ...payload, uuid: targetUuid, id: targetUuid, updated_at: new Date().toISOString() };

    // 1. Inmediatamente actualizar memoria reactiva (0ms)
    items = items.map(x => (String(x.uuid || x.id) === String(targetUuid)) ? updated : x);
    triggerToast('Máquina actualizada exitosamente', 'success');

    // 2. Persistencia local inmediata en IndexedDB (<5ms)
    upsertLocalItem('maquinas', updated).catch(() => {});

    // 3. Sincronización en segundo plano
    (async () => {
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        await queueOutboxAction({
          entity: 'maquinas',
          action: 'update',
          endpoint: `/api/master/maquinas/${targetUuid}`,
          method: 'PUT',
          payload,
          targetId: targetUuid
        });
        return;
      }

      try {
        const controller = new AbortController();
        const tId = setTimeout(() => controller.abort(), 12000);
        const res = await fetch(`/api/master/maquinas/${targetUuid}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(tId);
        const json = await res.json().catch(() => ({}));
        if (res.ok && json && json.success) {
          const serverData = json.data || updated;
          await upsertLocalItem('maquinas', serverData);
          items = items.map(x => (String(x.uuid || x.id) === String(targetUuid)) ? { ...x, ...serverData } : x);
        } else {
          throw new Error(json?.error || 'Error al actualizar máquina en servidor');
        }
      } catch (err) {
        console.warn('[LocalDb] Encolando outbox para actualizar máquina:', err.message);
        await queueOutboxAction({
          entity: 'maquinas',
          action: 'update',
          endpoint: `/api/master/maquinas/${targetUuid}`,
          method: 'PUT',
          payload,
          targetId: targetUuid
        });
      }
    })();
  }

  async function handleDelete(event) {
    const { id, item, onResult } = event.detail;
    const targetUuid = item?.uuid || id || item?.id;
    const existing = items.find(x => String(x.uuid || x.id) === String(targetUuid));

    // 1. Inmediatamente actualizar memoria reactiva (0ms)
    items = items.filter(x => String(x.uuid || x.id) !== String(targetUuid));
    totalCount = Math.max(0, totalCount - 1);
    triggerToast('Máquina eliminada exitosamente', 'success');
    if (onResult) onResult({ success: true });

    // 2. Persistencia local inmediata en IndexedDB (<5ms)
    deleteLocalItem('maquinas', targetUuid).catch(() => {});

    // 3. Sincronización en segundo plano
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (isOffline) {
      await queueOutboxAction({
        entity: 'maquinas',
        action: 'delete',
        endpoint: `/api/master/maquinas/${targetUuid}`,
        method: 'DELETE',
        targetId: targetUuid
      });
      return;
    }

    try {
      const controller = new AbortController();
      const tId = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(`/api/master/maquinas/${targetUuid}`, {
        method: 'DELETE',
        signal: controller.signal
      });
      clearTimeout(tId);
      const json = await res.json().catch(() => ({}));
      if (json && json.blocked) {
        // Rollback local si hay registros vinculados
        if (existing) {
          items = [existing, ...items];
          totalCount++;
          upsertLocalItem('maquinas', existing).catch(() => {});
        }
        if (onResult) onResult(json);
      } else if (!res.ok || (json && json.success === false)) {
        throw new Error(json?.message || json?.error || 'Error del servidor');
      }
    } catch (err) {
      console.warn('[LocalDb] Error al eliminar máquina, encolando outbox:', err.message);
      await queueOutboxAction({
        entity: 'maquinas',
        action: 'delete',
        endpoint: `/api/master/maquinas/${targetUuid}`,
        method: 'DELETE',
        targetId: targetUuid
      });
    }
  }

  async function handleBatchDelete(event) {
    const { ids, onResult } = event.detail;
    const deleted = [];
    const blocked = [];
    const errors = [];

    for (const id of ids) {
      try {
        const res = await fetch(`/api/master/maquinas/${id}`, { method: 'DELETE' });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.success) {
          deleted.push({ id });
        } else if (json && json.blocked) {
          blocked.push({
            id,
            name: json.entityName || `ID: ${id}`,
            reason: json.message || 'Tiene registros dependientes vinculados',
            dependencies: json.dependencies || []
          });
        } else {
          errors.push({ id, reason: json.message || json.error || 'Error al eliminar registro' });
        }
      } catch (err) {
        errors.push({ id, reason: err.message });
      }
    }

    await loadServerData();

    if (onResult) {
      onResult({
        deleted,
        blocked,
        errors,
        total: ids.length,
        entityType: 'máquina'
      });
    }
  }
</script>

<PaginatedDataTable 
  items={displayItems}
  existingItems={displayItems}
  {totalCount}
  {currentPage}
  {pageSize}
  isServerSide={true}
  {isLoading}
  {columns}
  {createFields}
  entityType="máquina"
  createModalTitle="Agregar Máquina"
  on:fetchServerData={(e) => loadServerData(e.detail)}
  on:create={handleCreate}
  on:saveInline={handleSaveInline}
  on:delete={handleDelete}
  on:batchDelete={handleBatchDelete}
>
  <div slot="filters" class="maquinas-filters-container">
    <!-- FILA 1: SOCIEDAD, LEGAL, RANGO -->
    <div class="filters-row-3">
      <div class="filter-select-col">
        <SmartMultiSelect
          id="filter-maquinas-sociedades"
          label="SOCIEDAD"
          options={filterOptions.sociedades}
          bind:selectedValues={selectedSociedades}
          on:change={handleFilterChange}
        />
      </div>

      <div class="filter-select-col">
        <SmartMultiSelect
          id="filter-maquinas-legales"
          label="LEGAL"
          options={filterOptions.legales}
          bind:selectedValues={selectedLegales}
          on:change={handleFilterChange}
        />
      </div>

      <div class="filter-select-col">
        <SmartMultiSelect
          id="filter-maquinas-rangos"
          label="RANGO"
          options={filterOptions.rangos && filterOptions.rangos.length > 0 ? filterOptions.rangos : rangosOptions}
          bind:selectedValues={selectedRangos}
          on:change={handleFilterChange}
        />
      </div>
    </div>

    <!-- FILA 2: MARCA, MODELO, JUEGO -->
    <div class="filters-row-3">
      <div class="filter-select-col">
        <SmartMultiSelect
          id="filter-maquinas-marcas"
          label="MARCA"
          options={filterOptions.marcas}
          bind:selectedValues={selectedMarcas}
          on:change={handleFilterChange}
        />
      </div>

      <div class="filter-select-col">
        <SmartMultiSelect
          id="filter-maquinas-modelos"
          label="MODELO"
          options={filterOptions.modelos}
          bind:selectedValues={selectedModelos}
          groupBy="subgroup_label"
          parentIcon="🏷️"
          on:change={handleFilterChange}
        />
      </div>

      <div class="filter-select-col">
        <SmartMultiSelect
          id="filter-maquinas-juegos"
          label="JUEGO"
          options={juegosFilterOptions}
          bind:selectedValues={selectedJuegos}
          on:change={handleFilterChange}
        />
      </div>
    </div>

    <!-- FILA 3: GRUPO, SALA, ESTADO, VALOR, TIPO, MODO -->
    <div class="filters-row-6">
      <div class="filter-select-col">
        <SmartMultiSelect
          id="filter-maquinas-grupos"
          label="GRUPO"
          options={filterOptions.grupos}
          bind:selectedValues={selectedGrupos}
          on:change={handleFilterChange}
        />
      </div>

      <div class="filter-select-col">
        <SmartMultiSelect
          id="filter-maquinas-salas"
          label="SALA"
          options={filterOptions.salas}
          bind:selectedValues={selectedSalas}
          groupBy="subgroup_label"
          parentIcon="📍"
          on:change={handleFilterChange}
        />
      </div>

      <div class="filter-select-col">
        <SmartMultiSelect
          id="filter-maquinas-estados"
          label="ESTADO"
          options={filterOptions.estados}
          bind:selectedValues={selectedEstados}
          on:change={handleFilterChange}
        />
      </div>

      <div class="filter-select-col">
        <SmartMultiSelect
          id="filter-maquinas-valores"
          label="VALOR"
          options={filterOptions.valores}
          bind:selectedValues={selectedValores}
          on:change={handleFilterChange}
        />
      </div>

      <div class="filter-select-col">
        <SmartMultiSelect
          id="filter-maquinas-tipos"
          label="TIPO"
          options={filterOptions.tipos}
          bind:selectedValues={selectedTipos}
          on:change={handleFilterChange}
        />
      </div>

      <div class="filter-select-col">
        <SmartMultiSelect
          id="filter-maquinas-modos"
          label="MODO"
          options={filterOptions.modos}
          bind:selectedValues={selectedModos}
          on:change={handleFilterChange}
        />
      </div>
    </div>
  </div>

  <!-- Barra inferior de búsqueda dual: NOMBRE (col-6) y SERIAL (col-6) -->
  <div slot="search-bar" class="maquinas-dual-search-bar">
    <div class="search-box dual-search-box">
      <input 
        type="text" 
        bind:value={searchNombre}
        on:input={handleSearchInputChange}
        placeholder="Buscar por nombre de máquina..."
      />
      <span class="search-icon">🔍</span>
    </div>

    <div class="search-box dual-search-box">
      <input 
        type="text" 
        bind:value={searchSerial}
        on:input={handleSearchInputChange}
        placeholder="Buscar por serial de máquina..."
      />
      <span class="search-icon">🔍</span>
    </div>
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

  <!-- Panel de Distribución por Badges (Data Filtrada) -->
  <div slot="info-banner" class="maquinas-distribucion-wrapper">
    {#if distribucionTipos.length > 0 || distribucionSociedades.length > 0 || distribucionSalas.length > 0 || distribucionGalpones.length > 0}
      <div class="maquinas-distribucion-panel">
        <!-- 1. Distribución por Tipo -->
        {#if distribucionTipos.length > 0}
          <div class="distrib-group">
            <div class="distrib-group-header">
              <div class="distrib-header-title-box">
                <span class="distrib-tag tag-tipo">TIPO</span>
                <span class="distrib-title">Distribución:</span>
              </div>
              <div class="distrib-header-line"></div>
              <span class="distrib-counter-badge">
                {distribucionTipos.reduce((acc, t) => acc + Number(t.count || 0), 0)} máquinas
              </span>
            </div>
            <div class="distrib-badges">
              {#each distribucionTipos as t}
                {@const isSelected = selectedTipos.some(v => String(v) === String(t.uuid || t.id))}
                <button
                  type="button"
                  class="distrib-badge badge-tipo"
                  class:is-active={isSelected}
                  on:click={() => toggleBadgeFilter('tipos', t.uuid || t.id)}
                  title="Filtrar por tipo {t.nombre}"
                >
                  <span class="badge-title">{t.nombre.toUpperCase()}:</span>
                  <span class="badge-count">{t.count}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- 2. Distribución por Sociedades -->
        {#if distribucionSociedades.length > 0}
          <div class="distrib-group">
            <div class="distrib-group-header">
              <div class="distrib-header-title-box">
                <span class="distrib-tag tag-sociedad">SOCIEDADES</span>
                <span class="distrib-title">Distribución:</span>
              </div>
              <div class="distrib-header-line"></div>
              <span class="distrib-counter-badge">
                {distribucionSociedades.reduce((acc, s) => acc + Number(s.count || 0), 0)} máquinas ({distribucionSociedades.length} sociedades)
              </span>
            </div>
            <div class="distrib-badges">
              {#each distribucionSociedades as s}
                {@const isSelected = selectedSociedades.some(v => String(v) === String(s.uuid || s.id))}
                <button
                  type="button"
                  class="distrib-badge badge-sociedad"
                  class:is-active={isSelected}
                  on:click={() => toggleBadgeFilter('sociedades', s.uuid || s.id)}
                  title="Filtrar por sociedad {s.nombre}"
                >
                  <span class="badge-title">{s.nombre.toUpperCase()}:</span>
                  <span class="badge-count">{s.count}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- 3. Distribución por Salas -->
        {#if distribucionSalas.length > 0}
          <div class="distrib-group">
            <div class="distrib-group-header">
              <div class="distrib-header-title-box">
                <span class="distrib-tag tag-sala">SALAS</span>
                <span class="distrib-title">Distribución:</span>
              </div>
              <div class="distrib-header-line"></div>
              <span class="distrib-counter-badge">
                {distribucionSalas.reduce((acc, s) => acc + Number(s.count || 0), 0)} máquinas ({distribucionSalas.length} salas)
              </span>
            </div>
            <div class="distrib-badges">
              {#each distribucionSalas as s}
                {@const isSelected = selectedSalas.some(v => String(v) === String(s.uuid || s.id))}
                <button
                  type="button"
                  class="distrib-badge badge-sala"
                  class:is-active={isSelected}
                  on:click={() => toggleBadgeFilter('salas', s.uuid || s.id)}
                  title="Filtrar por sala {s.nombre}"
                >
                  <span class="badge-title">{s.nombre.toUpperCase()}:</span>
                  <span class="badge-count">{s.count}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <!-- 4. Distribución por Galpones -->
        {#if distribucionGalpones.length > 0}
          <div class="distrib-group">
            <div class="distrib-group-header">
              <div class="distrib-header-title-box">
                <span class="distrib-tag tag-galpon">GALPONES</span>
                <span class="distrib-title">Distribución:</span>
              </div>
              <div class="distrib-header-line"></div>
              <span class="distrib-counter-badge">
                {distribucionGalpones.reduce((acc, g) => acc + Number(g.count || 0), 0)} máquinas ({distribucionGalpones.length} galpones)
              </span>
            </div>
            <div class="distrib-badges">
              {#each distribucionGalpones as g}
                {@const isSelected = selectedSalas.some(v => String(v) === String(g.uuid || g.id))}
                <button
                  type="button"
                  class="distrib-badge badge-galpon"
                  class:is-active={isSelected}
                  on:click={() => toggleBadgeFilter('salas', g.uuid || g.id)}
                  title="Filtrar por galpón {g.nombre}"
                >
                  <span class="badge-title">{g.nombre.toUpperCase()}:</span>
                  <span class="badge-count">{g.count}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Botón a Subvista de Reportes -->
    <div class="maquinas-reportes-toolbar">
      <button 
        type="button" 
        class="btn-reportes-main"
        on:click={() => irAReporte('simple')}
        title="Ver reportes y vistas de máquinas con los filtros actuales"
      >
        <span>REPORTES Y VISTAS</span>
      </button>
    </div>
  </div>
</PaginatedDataTable>

<style>
  .maquinas-filters-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
  }

  .filters-row-2 {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    width: 100%;
    align-items: flex-end;
  }

  .filters-row-3 {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    width: 100%;
    align-items: flex-end;
  }

  .filters-row-6 {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 12px;
    width: 100%;
    align-items: flex-end;
  }

  @media (max-width: 1200px) {
    .filters-row-6 {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 900px) {
    .filters-row-2,
    .filters-row-3,
    .filters-row-6 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 600px) {
    .filters-row-2,
    .filters-row-3,
    .filters-row-6 {
      grid-template-columns: 1fr;
    }
  }

  .filter-select-col {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  .maquinas-dual-search-bar {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    width: 100%;
    flex: 1;
  }

  @media (max-width: 768px) {
    .maquinas-dual-search-bar {
      grid-template-columns: 1fr;
    }
  }

  .dual-search-box {
    position: relative;
    width: 100%;
  }

  .dual-search-box input {
    width: 100%;
    height: 40px;
    padding: 0 14px 0 38px;
    font-size: 13.5px;
    color: #1e293b;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    box-sizing: border-box;
    transition: all 0.15s ease;
    outline: none;
  }

  .dual-search-box input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .dual-search-box .search-icon {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 14px;
    opacity: 0.6;
    pointer-events: none;
  }

  /* Panel de Distribución por Badges */
  .maquinas-distribucion-wrapper {
    width: 100%;
  }

  .maquinas-distribucion-panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    margin-top: 2px;
    margin-bottom: 4px;
    box-sizing: border-box;
  }

  .distrib-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
    padding: 6px 10px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
    box-sizing: border-box;
    transition: all 0.15s ease;
  }

  .distrib-group:hover {
    border-color: #cbd5e1;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);
  }

  .distrib-group-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
  }

  .distrib-header-title-box {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .distrib-tag {
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.4px;
    padding: 1.5px 6px;
    border-radius: 4px;
    line-height: 1.2;
    text-transform: uppercase;
  }

  .distrib-tag.tag-tipo {
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
  }

  .distrib-tag.tag-sociedad {
    background: #f0f9ff;
    color: #0369a1;
    border: 1px solid #bae6fd;
  }

  .distrib-tag.tag-sala {
    background: #ecfdf5;
    color: #047857;
    border: 1px solid #a7f3d0;
  }

  .distrib-tag.tag-galpon {
    background: #fffbeb;
    color: #b45309;
    border: 1px solid #fde68a;
  }

  .distrib-title {
    font-size: 11px;
    font-weight: 700;
    color: #475569;
    letter-spacing: 0.2px;
    white-space: nowrap;
  }

  .distrib-header-line {
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, #e2e8f0 0%, #f1f5f9 100%);
  }

  .distrib-counter-badge {
    font-size: 10px;
    font-weight: 700;
    color: #64748b;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    padding: 1px 7px;
    border-radius: 10px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .distrib-badges {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
    width: 100%;
  }

  .distrib-badge {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 7px;
    border-radius: 6px;
    border: 1px solid #e2e8f0;
    background: #f8fafc;
    font-size: 10.5px;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
    user-select: none;
    line-height: 1.25;
    outline: none;
  }

  .distrib-badge:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.06);
    border-color: #94a3b8;
    background: #ffffff;
  }

  .distrib-badge .badge-title {
    font-weight: 800;
    color: #2563eb;
    letter-spacing: 0.2px;
  }

  .distrib-badge.badge-sociedad .badge-title {
    color: #0284c7;
  }

  .distrib-badge.badge-sala .badge-title {
    color: #059669;
  }

  .distrib-badge.badge-galpon .badge-title {
    color: #d97706;
  }

  .distrib-badge .badge-count {
    font-family: inherit;
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    font-weight: 900;
    color: #0f172a;
  }

  .distrib-badge.is-active {
    background: #eff6ff;
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
  }

  .distrib-badge.badge-sociedad.is-active {
    background: #f0f9ff;
    border-color: #0284c7;
    box-shadow: 0 0 0 2px rgba(2, 132, 199, 0.25);
  }

  .distrib-badge.badge-sala.is-active {
    background: #ecfdf5;
    border-color: #059669;
    box-shadow: 0 0 0 2px rgba(5, 150, 105, 0.25);
  }

  .distrib-badge.badge-galpon.is-active {
    background: #fffbeb;
    border-color: #d97706;
    box-shadow: 0 0 0 2px rgba(217, 119, 6, 0.25);
  }

  @media (max-width: 768px) {
    .distrib-group-header {
      flex-wrap: wrap;
    }
    .distrib-header-line {
      display: none;
    }
  }

  /* Botón de Reportes y Vistas */
  .maquinas-reportes-toolbar {
    display: flex;
    align-items: center;
    width: 100%;
    margin-top: 14px;
    margin-bottom: 10px;
    box-sizing: border-box;
  }

  .btn-reportes-main {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 800;
    cursor: pointer;
    border: 1px solid #1e3a5f;
    background: #1e3a5f;
    color: #ffffff;
    letter-spacing: 0.4px;
    box-shadow: 0 1px 3px rgba(30, 58, 95, 0.2);
    transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
    outline: none;
  }

  .btn-reportes-main:hover {
    background: #2b4c7e;
    border-color: #2b4c7e;
    transform: translateY(-1px);
    box-shadow: 0 3px 6px rgba(30, 58, 95, 0.3);
  }

  .btn-reportes-main:active {
    transform: translateY(0);
  }
</style>
