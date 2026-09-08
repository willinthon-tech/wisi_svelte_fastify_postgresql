<script>
  import { onMount } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { 
    masterMesasStore, 
    masterSalasStore, 
    masterJuegosStore, 
    masterEmpleadosStore,
    userSalasStore as masterUserSalasStore,
    loadMasterStoresFromBackend 
  } from '../../controllers/master.store.js';

  export let libro = null;
  export let libroId = null;

  // Estado de carga y datos
  let isLoadingRecords = false;
  let isLoadingMesas = false;
  let novedadesRecords = [];
  let serverMesas = [];
  let searchQuery = '';

  // Diccionario reactivo de valores editados por mesa_id
  // { [mesaId]: { hora_apertura, hora_cierre, pitboss, croupier_apertura, croupier_cierre, observacion } }
  let rowsData = {};

  // Conjuntos reactivos para retroalimentación visual de guardado por fila
  let savingMesaIds = new Set();
  let savedSuccessMesaIds = new Set();
  let saveDebounceTimers = {};

  // Estado del dropdown de autocompletado en celda activa
  let activeSug = null; // { mesaId, field: 'pitboss'|'croupier_apertura'|'croupier_cierre' }
  let activeSugIndex = -1;

  // Usuario y salas asignadas
  $: userSalasMap = $masterUserSalasStore || {};
  $: currentUserSalas = $currentUserStore?.id ? (userSalasMap[$currentUserStore.id] || []) : [];
  $: assignedSalaIds = (currentUserSalas.length > 0)
    ? currentUserSalas
    : ($authUserSalasStore && $authUserSalasStore.length > 0 ? $authUserSalasStore.map(s => s.id) : []);

  // Lista de mesas activas para la sala del libro
  $: availableMesas = (() => {
    const list = (serverMesas && serverMesas.length > 0) ? serverMesas : ($masterMesasStore || []);
    return list.filter(m => {
      if ((m.active ?? 1) === 0) return false;
      if (libro?.sala_id && Number(m.sala_id) !== Number(libro.sala_id)) return false;
      if (assignedSalaIds && assignedSalaIds.length > 0) {
        const userSalaNums = assignedSalaIds.map(Number);
        if (!userSalaNums.includes(Number(m.sala_id))) return false;
      }
      return true;
    }).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', undefined, { numeric: true }));
  })();

  // Mesas filtradas por buscador de la tabla
  $: filteredMesas = (() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return availableMesas;
    return availableMesas.filter(m => {
      const nom = (m.nombre || '').toLowerCase();
      const juego = (m.juego_nombre || '').toLowerCase();
      const r = rowsData[m.id];
      const pit = (r?.pitboss || '').toLowerCase();
      const ca = (r?.croupier_apertura || '').toLowerCase();
      const cc = (r?.croupier_cierre || '').toLowerCase();
      const obs = (r?.observacion || '').toLowerCase();
      return nom.includes(q) || juego.includes(q) || pit.includes(q) || ca.includes(q) || cc.includes(q) || obs.includes(q);
    });
  })();

  // Lista de empleados disponibles para sugerencias de autocompletado
  $: listaEmpleados = ($masterEmpleadosStore || []).map(e => {
    const nom = [e.nombre, e.apellido].filter(Boolean).join(' ').trim();
    return nom || e.nombre || '';
  }).filter(Boolean);

  // Sugerencias filtradas reactivas según la celda enfocada
  $: currentQuery = (activeSug && rowsData[activeSug.mesaId]) 
    ? (rowsData[activeSug.mesaId][activeSug.field] || '').trim().toLowerCase() 
    : '';

  $: filteredSuggestions = (() => {
    if (!activeSug) return [];
    if (!currentQuery) return listaEmpleados.slice(0, 7);
    return listaEmpleados.filter(emp => emp.toLowerCase().includes(currentQuery)).slice(0, 7);
  })();

  // Encabezado superior: Nombre de Sala - Fecha
  $: tableHeaderTitle = (() => {
    const salaName = libro?.sala_nombre || 
      ($masterSalasStore || []).find(s => Number(s.id) === Number(libro?.sala_id))?.nombre ||
      libro?.sala_nombre_comercial ||
      ($masterSalasStore || []).find(s => Number(s.id) === Number(libro?.sala_id))?.nombre_comercial || 'Sala';
    const dateFormatted = formatDateDisplay(libro?.descripcion);
    return `${salaName} - ${dateFormatted}`;
  })();

  // Mapa de registros guardados en base de datos
  $: recordsMap = (() => {
    const map = new Map();
    for (const r of novedadesRecords) {
      map.set(Number(r.mesa_id), r);
    }
    return map;
  })();

  // Cantidad de mesas con novedades registradas
  $: mesasRegistradasCount = novedadesRecords.filter(r => 
    Boolean(r.hora_apertura || r.hora_cierre || r.pitboss || r.croupier_apertura || r.croupier_cierre || r.observacion)
  ).length;

  function formatDateDisplay(d) {
    if (!d) return '—';
    const str = String(d).trim();
    const match = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) {
      return `${match[3].padStart(2, '0')}/${match[2].padStart(2, '0')}/${match[1]}`;
    }
    const ddmmyyyy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (ddmmyyyy) {
      return `${ddmmyyyy[1].padStart(2, '0')}/${ddmmyyyy[2].padStart(2, '0')}/${ddmmyyyy[3]}`;
    }
    return str;
  }

  function getCurrentTimeString() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  onMount(async () => {
    await Promise.all([
      loadMasterStoresFromBackend(),
      fetchServerMesas(),
      loadRecords()
    ]);
  });

  $: if (libroId) {
    loadRecords();
  }

  async function fetchServerMesas() {
    isLoadingMesas = true;
    try {
      const q = new URLSearchParams({ limit: '0', active: '1' });
      if (assignedSalaIds.length > 0) {
        q.set('user_sala_ids', assignedSalaIds.join(','));
      }
      if (libro?.sala_id) {
        q.set('sala_ids', String(libro.sala_id));
      }
      const res = await fetch(`/api/master/mesas?${q.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && Array.isArray(json.data)) {
          serverMesas = json.data;
          syncRowsData(novedadesRecords);
        }
      }
    } catch (e) {
      console.warn('Error al cargar mesas del servidor:', e);
    } finally {
      isLoadingMesas = false;
    }
  }

  async function loadRecords() {
    const lId = libroId || libro?.id;
    if (!lId) return;

    isLoadingRecords = true;
    try {
      const res = await fetch(`/api/master/libros/${lId}/novedades-mesas`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success) {
          novedadesRecords = json.data || [];
          syncRowsData(novedadesRecords);
        }
      }
    } catch (err) {
      console.error('Error al cargar novedades de mesas:', err);
    } finally {
      isLoadingRecords = false;
    }
  }

  // Sincroniza rowsData manteniendo lo que el usuario esté escribiendo activamente
  function syncRowsData(records) {
    const map = new Map();
    for (const r of (records || [])) {
      map.set(Number(r.mesa_id), r);
    }

    const updated = { ...rowsData };
    for (const m of availableMesas) {
      const mid = Number(m.id);
      const rec = map.get(mid);
      
      // Si la fila no existe o no se está guardando activamente, actualizarla con los datos del server
      if (!updated[mid] || (!savingMesaIds.has(mid) && (!activeSug || activeSug.mesaId !== mid))) {
        updated[mid] = {
          hora_apertura: rec?.hora_apertura || '',
          hora_cierre: rec?.hora_cierre || '',
          pitboss: rec?.pitboss || '',
          croupier_apertura: rec?.croupier_apertura || '',
          croupier_cierre: rec?.croupier_cierre || '',
          observacion: rec?.observacion || ''
        };
      }
    }
    rowsData = updated;
  }

  // Asegura y obtiene los datos de una fila
  function getRow(mesaId) {
    if (!rowsData[mesaId]) {
      const existing = recordsMap.get(Number(mesaId));
      rowsData[mesaId] = {
        hora_apertura: existing?.hora_apertura || '',
        hora_cierre: existing?.hora_cierre || '',
        pitboss: existing?.pitboss || '',
        croupier_apertura: existing?.croupier_apertura || '',
        croupier_cierre: existing?.croupier_cierre || '',
        observacion: existing?.observacion || ''
      };
    }
    return rowsData[mesaId];
  }

  // Actualiza un campo individual
  function updateField(mesaId, field, val) {
    const row = getRow(mesaId);
    row[field] = val;
    rowsData[mesaId] = row;
    rowsData = { ...rowsData };
  }

  // Disparador de autoguardado con debounce
  function triggerAutoSave(mesaId, delay = 700) {
    if (saveDebounceTimers[mesaId]) {
      clearTimeout(saveDebounceTimers[mesaId]);
    }
    saveDebounceTimers[mesaId] = setTimeout(() => {
      saveRowToBackend(mesaId);
    }, delay);
  }

  // Persistir la fila en el backend (Upsert)
  async function saveRowToBackend(mesaId) {
    const lId = libroId || libro?.id;
    if (!lId || !mesaId) return;

    const row = rowsData[mesaId];
    if (!row) return;

    const existing = recordsMap.get(Number(mesaId));
    const hasAnyValue = Boolean(
      row.hora_apertura || row.hora_cierre || row.pitboss ||
      row.croupier_apertura || row.croupier_cierre || row.observacion
    );

    // Si no hay valores y no existía registro previo, no guardar
    if (!hasAnyValue && !existing) {
      return;
    }

    savingMesaIds.add(Number(mesaId));
    savingMesaIds = new Set(savingMesaIds);

    try {
      const payload = {
        mesa_id: Number(mesaId),
        hora_apertura: row.hora_apertura || '',
        hora_cierre: row.hora_cierre || '',
        pitboss: row.pitboss || '',
        croupier_apertura: row.croupier_apertura || '',
        croupier_cierre: row.croupier_cierre || '',
        observacion: row.observacion || ''
      };

      const res = await fetch(`/api/master/libros/${lId}/novedades-mesas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (res.ok && json && json.success) {
        const savedRecord = json.data;
        const idx = novedadesRecords.findIndex(r => Number(r.mesa_id) === Number(mesaId));
        if (idx >= 0) {
          novedadesRecords[idx] = savedRecord;
        } else {
          novedadesRecords = [...novedadesRecords, savedRecord];
        }

        savedSuccessMesaIds.add(Number(mesaId));
        savedSuccessMesaIds = new Set(savedSuccessMesaIds);
        setTimeout(() => {
          savedSuccessMesaIds.delete(Number(mesaId));
          savedSuccessMesaIds = new Set(savedSuccessMesaIds);
        }, 2200);
      } else {
        triggerToast(json?.error || 'Error al guardar cambios de mesa', 'error');
      }
    } catch (err) {
      console.error('Error al guardar fila de mesa:', err);
    } finally {
      savingMesaIds.delete(Number(mesaId));
      savingMesaIds = new Set(savingMesaIds);
    }
  }

  // Eliminar o limpiar el registro de una mesa
  async function handleEliminar(mesaId) {
    const lId = libroId || libro?.id;
    if (!lId || !mesaId) return;

    const existing = recordsMap.get(Number(mesaId));
    if (!existing) {
      // Limpiar campos locales si no estaba en la base de datos
      updateField(mesaId, 'hora_apertura', '');
      updateField(mesaId, 'hora_cierre', '');
      updateField(mesaId, 'pitboss', '');
      updateField(mesaId, 'croupier_apertura', '');
      updateField(mesaId, 'croupier_cierre', '');
      updateField(mesaId, 'observacion', '');
      return;
    }

    if (!confirm('¿Desea limpiar y eliminar el registro de esta mesa?')) {
      return;
    }

    try {
      const res = await fetch(`/api/master/libros/${lId}/novedades-mesas/${existing.id}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Registro de mesa eliminado', 'info');
        novedadesRecords = novedadesRecords.filter(r => Number(r.id) !== Number(existing.id));
        updateField(mesaId, 'hora_apertura', '');
        updateField(mesaId, 'hora_cierre', '');
        updateField(mesaId, 'pitboss', '');
        updateField(mesaId, 'croupier_apertura', '');
        updateField(mesaId, 'croupier_cierre', '');
        updateField(mesaId, 'observacion', '');
      } else {
        triggerToast(json?.error || 'Error al eliminar', 'error');
      }
    } catch (err) {
      console.error('Error al eliminar novedad:', err);
    }
  }

  // --- Handlers de Autocompletado en Celda ---
  function handleFocusAutocomplete(mesaId, field) {
    activeSug = { mesaId, field };
    activeSugIndex = -1;
  }

  function handleInputAutocomplete(mesaId, field, val) {
    updateField(mesaId, field, val);
    activeSug = { mesaId, field };
    activeSugIndex = -1;
    triggerAutoSave(mesaId, 900);
  }

  function handleKeyDownAutocomplete(e, mesaId, field) {
    if (!activeSug || activeSug.mesaId !== mesaId || activeSug.field !== field) return;

    if (e.key === 'ArrowDown') {
      if (filteredSuggestions.length > 0) {
        e.preventDefault();
        activeSugIndex = (activeSugIndex + 1) % filteredSuggestions.length;
      }
    } else if (e.key === 'ArrowUp') {
      if (filteredSuggestions.length > 0) {
        e.preventDefault();
        activeSugIndex = (activeSugIndex - 1 + filteredSuggestions.length) % filteredSuggestions.length;
      }
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (filteredSuggestions.length > 0) {
        e.preventDefault();
        const selected = activeSugIndex >= 0 ? filteredSuggestions[activeSugIndex] : filteredSuggestions[0];
        selectSuggestion(mesaId, field, selected);
      }
    } else if (e.key === 'Escape') {
      activeSug = null;
      activeSugIndex = -1;
    }
  }

  function selectSuggestion(mesaId, field, name) {
    updateField(mesaId, field, name);
    activeSug = null;
    activeSugIndex = -1;
    triggerAutoSave(mesaId, 0); // Guardar inmediatamente
  }

  function handleBlurAutocomplete(mesaId, field) {
    setTimeout(() => {
      if (activeSug && activeSug.mesaId === mesaId && activeSug.field === field) {
        activeSug = null;
        activeSugIndex = -1;
      }
    }, 200);
    triggerAutoSave(mesaId, 0);
  }
</script>

<div class="novedades-full-container">
  <div class="card-table-novedades full-width">
    <!-- Barra Superior Oscura: Sala - Fecha + Buscador + Contador -->
    <div class="table-top-bar">
      <div class="top-bar-left">
        <span class="top-bar-title">{tableHeaderTitle}</span>
        <span class="top-bar-subtitle">Edición en línea de novedades de mesas operativas</span>
      </div>

      <div class="top-bar-right">
        <!-- Buscador de mesa o empleado -->
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input 
            type="text" 
            class="search-input" 
            placeholder="Filtrar mesa, croupier o pitboss..." 
            bind:value={searchQuery}
          />
          {#if searchQuery}
            <button 
              type="button" 
              class="btn-clear-search" 
              on:click={() => { searchQuery = ''; }}
              title="Borrar búsqueda"
            >×</button>
          {/if}
        </div>

        {#if availableMesas.length > 0}
          <span class="badge-status {mesasRegistradasCount === availableMesas.length ? 'complete' : 'partial'}">
            {mesasRegistradasCount} de {availableMesas.length} mesas registradas
          </span>
        {/if}
      </div>
    </div>

    <!-- Tabla Completa con Edición en Línea -->
    <div class="table-wrapper">
      <table class="novedades-table">
        <thead>
          <tr>
            <th class="th-center th-col-hora">HORA APERTURA</th>
            <th class="th-left th-col-mesa">MESA</th>
            <th class="th-left th-col-pitboss">PITBOSS</th>
            <th class="th-left th-col-croupier">CROUPIER APERTURA</th>
            <th class="th-left th-col-croupier">CROUPIER CIERRE</th>
            <th class="th-center th-col-hora">HORA CIERRE</th>
            <th class="th-left th-col-obs">OBSERVACIÓN</th>
            <th class="th-center th-col-acciones">ESTADO / ACCIONES</th>
          </tr>
        </thead>
        <tbody>
          {#if isLoadingRecords || isLoadingMesas}
            <tr>
              <td colspan="8" class="empty-state-cell">
                <div class="loading-state-inline">
                  <div class="spinner-small"></div>
                  <span>Cargando mesas y novedades en línea...</span>
                </div>
              </td>
            </tr>
          {:else if availableMesas.length === 0}
            <tr>
              <td colspan="8" class="empty-state-cell">
                <div class="empty-msg-box">
                  <span class="empty-icon">🎲</span>
                  <p class="empty-text">No se encontraron mesas activas configuradas para esta sala.</p>
                </div>
              </td>
            </tr>
          {:else if filteredMesas.length === 0}
            <tr>
              <td colspan="8" class="empty-state-cell">
                <div class="empty-msg-box">
                  <span class="empty-icon">🔍</span>
                  <p class="empty-text">No hay mesas que coincidan con la búsqueda "{searchQuery}".</p>
                </div>
              </td>
            </tr>
          {:else}
            {#each filteredMesas as mesa (mesa.id)}
              {@const row = getRow(mesa.id)}
              {@const hasData = Boolean(row.hora_apertura || row.hora_cierre || row.pitboss || row.croupier_apertura || row.croupier_cierre || row.observacion)}
              {@const isSavingThis = savingMesaIds.has(Number(mesa.id))}
              {@const isSavedThis = savedSuccessMesaIds.has(Number(mesa.id))}
              <tr class="novedad-row {hasData ? 'row-has-data' : 'row-empty'}">
                
                <!-- 1. HORA APERTURA (Con botón rápido Ahora) -->
                <td class="td-center td-col-hora">
                  <div class="inline-time-box">
                    <input 
                      type="time" 
                      class="inline-time-input" 
                      value={row.hora_apertura} 
                      on:input={(e) => updateField(mesa.id, 'hora_apertura', e.target.value)}
                      on:change={() => triggerAutoSave(mesa.id, 0)}
                      on:blur={() => triggerAutoSave(mesa.id, 0)}
                      title="Hora de Apertura"
                    />
                    <button 
                      type="button" 
                      class="btn-inline-now" 
                      title="Establecer hora actual de apertura"
                      on:click={() => {
                        updateField(mesa.id, 'hora_apertura', getCurrentTimeString());
                        triggerAutoSave(mesa.id, 0);
                      }}
                    >⚡</button>
                  </div>
                </td>

                <!-- 2. MESA (Nombre y juego) -->
                <td class="td-left td-col-mesa">
                  <div class="mesa-badge-cell">
                    <span class="mesa-nombre">{mesa.nombre}</span>
                    {#if mesa.juego_nombre}
                      <span class="mesa-juego">{mesa.juego_nombre}</span>
                    {/if}
                  </div>
                </td>

                <!-- 3. PITBOSS (Con autocompletado en celda) -->
                <td class="td-left td-col-pitboss">
                  <div class="cell-autocomplete-container">
                    <input 
                      type="text" 
                      class="inline-text-input {activeSug?.mesaId === mesa.id && activeSug?.field === 'pitboss' ? 'input-active' : ''}" 
                      placeholder="Escriba Pitboss..." 
                      value={row.pitboss}
                      on:focus={() => handleFocusAutocomplete(mesa.id, 'pitboss')}
                      on:input={(e) => handleInputAutocomplete(mesa.id, 'pitboss', e.target.value)}
                      on:keydown={(e) => handleKeyDownAutocomplete(e, mesa.id, 'pitboss')}
                      on:blur={() => handleBlurAutocomplete(mesa.id, 'pitboss')}
                      autocomplete="off"
                    />

                    {#if activeSug && activeSug.mesaId === mesa.id && activeSug.field === 'pitboss' && filteredSuggestions.length > 0}
                      <div class="inline-dropdown">
                        <div class="inline-dropdown-header">
                          <span>Sugerencias (<b>Tab ⇥</b> o clic):</span>
                        </div>
                        <ul class="inline-dropdown-list">
                          {#each filteredSuggestions as sug, idx}
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <li 
                              class="inline-dropdown-item {idx === activeSugIndex ? 'selected' : ''}"
                              on:mousedown|preventDefault={() => selectSuggestion(mesa.id, 'pitboss', sug)}
                            >
                              <span class="sug-avatar">👤</span>
                              <span class="sug-name">{sug}</span>
                              <span class="sug-tab-badge">Tab ⇥</span>
                            </li>
                          {/each}
                        </ul>
                      </div>
                    {/if}
                  </div>
                </td>

                <!-- 4. CROUPIER APERTURA (Con autocompletado en celda) -->
                <td class="td-left td-col-croupier">
                  <div class="cell-autocomplete-container">
                    <input 
                      type="text" 
                      class="inline-text-input {activeSug?.mesaId === mesa.id && activeSug?.field === 'croupier_apertura' ? 'input-active' : ''}" 
                      placeholder="Escriba Croupier Apertura..." 
                      value={row.croupier_apertura}
                      on:focus={() => handleFocusAutocomplete(mesa.id, 'croupier_apertura')}
                      on:input={(e) => handleInputAutocomplete(mesa.id, 'croupier_apertura', e.target.value)}
                      on:keydown={(e) => handleKeyDownAutocomplete(e, mesa.id, 'croupier_apertura')}
                      on:blur={() => handleBlurAutocomplete(mesa.id, 'croupier_apertura')}
                      autocomplete="off"
                    />

                    {#if activeSug && activeSug.mesaId === mesa.id && activeSug.field === 'croupier_apertura' && filteredSuggestions.length > 0}
                      <div class="inline-dropdown">
                        <div class="inline-dropdown-header">
                          <span>Sugerencias (<b>Tab ⇥</b> o clic):</span>
                        </div>
                        <ul class="inline-dropdown-list">
                          {#each filteredSuggestions as sug, idx}
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <li 
                              class="inline-dropdown-item {idx === activeSugIndex ? 'selected' : ''}"
                              on:mousedown|preventDefault={() => selectSuggestion(mesa.id, 'croupier_apertura', sug)}
                            >
                              <span class="sug-avatar">👤</span>
                              <span class="sug-name">{sug}</span>
                              <span class="sug-tab-badge">Tab ⇥</span>
                            </li>
                          {/each}
                        </ul>
                      </div>
                    {/if}
                  </div>
                </td>

                <!-- 5. CROUPIER CIERRE (Con autocompletado en celda) -->
                <td class="td-left td-col-croupier">
                  <div class="cell-autocomplete-container">
                    <input 
                      type="text" 
                      class="inline-text-input {activeSug?.mesaId === mesa.id && activeSug?.field === 'croupier_cierre' ? 'input-active' : ''}" 
                      placeholder="Escriba Croupier Cierre..." 
                      value={row.croupier_cierre}
                      on:focus={() => handleFocusAutocomplete(mesa.id, 'croupier_cierre')}
                      on:input={(e) => handleInputAutocomplete(mesa.id, 'croupier_cierre', e.target.value)}
                      on:keydown={(e) => handleKeyDownAutocomplete(e, mesa.id, 'croupier_cierre')}
                      on:blur={() => handleBlurAutocomplete(mesa.id, 'croupier_cierre')}
                      autocomplete="off"
                    />

                    {#if activeSug && activeSug.mesaId === mesa.id && activeSug.field === 'croupier_cierre' && filteredSuggestions.length > 0}
                      <div class="inline-dropdown">
                        <div class="inline-dropdown-header">
                          <span>Sugerencias (<b>Tab ⇥</b> o clic):</span>
                        </div>
                        <ul class="inline-dropdown-list">
                          {#each filteredSuggestions as sug, idx}
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <li 
                              class="inline-dropdown-item {idx === activeSugIndex ? 'selected' : ''}"
                              on:mousedown|preventDefault={() => selectSuggestion(mesa.id, 'croupier_cierre', sug)}
                            >
                              <span class="sug-avatar">👤</span>
                              <span class="sug-name">{sug}</span>
                              <span class="sug-tab-badge">Tab ⇥</span>
                            </li>
                          {/each}
                        </ul>
                      </div>
                    {/if}
                  </div>
                </td>

                <!-- 6. HORA CIERRE (Con botón rápido Ahora) -->
                <td class="td-center td-col-hora">
                  <div class="inline-time-box">
                    <input 
                      type="time" 
                      class="inline-time-input" 
                      value={row.hora_cierre} 
                      on:input={(e) => updateField(mesa.id, 'hora_cierre', e.target.value)}
                      on:change={() => triggerAutoSave(mesa.id, 0)}
                      on:blur={() => triggerAutoSave(mesa.id, 0)}
                      title="Hora de Cierre"
                    />
                    <button 
                      type="button" 
                      class="btn-inline-now" 
                      title="Establecer hora actual de cierre"
                      on:click={() => {
                        updateField(mesa.id, 'hora_cierre', getCurrentTimeString());
                        triggerAutoSave(mesa.id, 0);
                      }}
                    >⚡</button>
                  </div>
                </td>

                <!-- 7. OBSERVACIÓN -->
                <td class="td-left td-col-obs">
                  <input 
                    type="text" 
                    class="inline-text-input obs-input" 
                    placeholder="VIP, cambio de paño, etc..." 
                    value={row.observacion}
                    on:input={(e) => updateField(mesa.id, 'observacion', e.target.value)}
                    on:change={() => triggerAutoSave(mesa.id, 0)}
                    on:blur={() => triggerAutoSave(mesa.id, 0)}
                  />
                </td>

                <!-- 8. ESTADO / ACCIONES -->
                <td class="td-center td-col-acciones">
                  <div class="row-status-actions">
                    {#if isSavingThis}
                      <span class="status-saving-inline" title="Guardando cambios...">
                        <span class="mini-spinner"></span>
                      </span>
                    {:else if isSavedThis}
                      <span class="status-saved-inline" title="Guardado correctamente">
                        ✓
                      </span>
                    {:else if hasData}
                      <span class="status-persisted-dot" title="Registro activo en el libro"></span>
                    {/if}

                    {#if hasData || recordsMap.has(Number(mesa.id))}
                      <button 
                        type="button" 
                        class="btn-inline-delete" 
                        on:click={() => handleEliminar(mesa.id)}
                        title="Limpiar y eliminar datos de esta mesa"
                      >
                        🗑️
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
  </div>
</div>

<style>
  .novedades-full-container {
    width: 100%;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
  }

  .card-table-novedades.full-width {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    width: 100%;
    overflow: visible;
  }

  /* Barra Superior Oscura */
  .table-top-bar {
    background: #54626f;
    color: #ffffff;
    padding: 12px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    border-top-left-radius: 7px;
    border-top-right-radius: 7px;
  }

  .top-bar-left {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .top-bar-title {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.3px;
  }

  .top-bar-subtitle {
    font-size: 12px;
    color: #cbd5e1;
  }

  .top-bar-right {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  /* Buscador de cabecera */
  .search-box {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 8px;
    font-size: 12px;
    opacity: 0.7;
    pointer-events: none;
  }

  .search-input {
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 20px;
    padding: 5px 28px 5px 26px;
    color: #ffffff;
    font-size: 12px;
    width: 230px;
    outline: none;
    transition: all 0.2s ease;
  }

  .search-input::placeholder {
    color: #cbd5e1;
    font-size: 11.5px;
  }

  .search-input:focus {
    background: rgba(255, 255, 255, 0.22);
    border-color: #ffffff;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.2);
  }

  .btn-clear-search {
    position: absolute;
    right: 8px;
    background: none;
    border: none;
    color: #ffffff;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    opacity: 0.7;
  }

  .btn-clear-search:hover {
    opacity: 1;
  }

  .badge-status {
    font-size: 11.5px;
    font-weight: 700;
    padding: 4px 11px;
    border-radius: 12px;
    letter-spacing: 0.2px;
    white-space: nowrap;
  }

  .badge-status.complete {
    background: #10b981;
    color: #ffffff;
  }

  .badge-status.partial {
    background: #f59e0b;
    color: #ffffff;
  }

  /* Tabla */
  .table-wrapper {
    overflow-x: auto;
    width: 100%;
    min-height: 480px;
    padding-bottom: 80px; /* Margen para que el dropdown de autocompletado inferior flote con soltura */
  }

  .novedades-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    text-align: left;
  }

  .novedades-table thead tr {
    background: #2b3544;
    color: #ffffff;
  }

  .novedades-table th {
    padding: 11px 12px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.4px;
    white-space: nowrap;
    border-bottom: 2px solid #1e293b;
  }

  .th-center { text-align: center; }
  .th-left { text-align: left; }

  /* Anchos de columnas */
  .th-col-hora { width: 125px; min-width: 125px; }
  .th-col-mesa { width: 130px; min-width: 120px; }
  .th-col-pitboss { width: 170px; min-width: 160px; }
  .th-col-croupier { width: 190px; min-width: 175px; }
  .th-col-obs { min-width: 180px; }
  .th-col-acciones { width: 110px; min-width: 100px; }

  .novedad-row {
    border-bottom: 1px solid #f1f5f9;
    transition: background 0.15s ease;
  }

  .novedad-row:hover {
    background: #f8fafc;
  }

  .novedad-row.row-has-data {
    background: #ffffff;
  }

  .novedades-table td {
    padding: 8px 10px;
    vertical-align: middle;
  }

  .td-center { text-align: center; }
  .td-left { text-align: left; }

  /* Input de Tiempo con botón Ahora */
  .inline-time-box {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 5px;
    padding: 2px 4px;
    transition: border-color 0.15s ease;
  }

  .inline-time-box:focus-within {
    border-color: #3b82f6;
    background: #ffffff;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
  }

  .inline-time-input {
    border: none;
    outline: none;
    background: transparent;
    font-size: 12.5px;
    font-weight: 700;
    color: #1e293b;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }

  .btn-inline-now {
    background: #eff6ff;
    color: #2563eb;
    border: 1px solid #bfdbfe;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 5px;
    cursor: pointer;
    line-height: 1;
    transition: all 0.15s ease;
  }

  .btn-inline-now:hover {
    background: #dbeafe;
    color: #1d4ed8;
  }

  /* Ficha de Mesa */
  .mesa-badge-cell {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .mesa-nombre {
    font-weight: 800;
    color: #0f172a;
    font-size: 13px;
  }

  .mesa-juego {
    font-size: 11px;
    color: #64748b;
    font-weight: 500;
  }

  /* Input de Texto en Celda */
  .inline-text-input {
    width: 100%;
    box-sizing: border-box;
    padding: 6px 9px;
    font-size: 12.5px;
    color: #1e293b;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 5px;
    outline: none;
    transition: all 0.15s ease;
  }

  .inline-text-input:focus,
  .inline-text-input.input-active {
    background: #ffffff;
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
  }

  .inline-text-input.obs-input {
    border-color: #e2e8f0;
    background: #fdfdfd;
  }

  .inline-text-input.obs-input:focus {
    border-color: #3b82f6;
    background: #ffffff;
  }

  /* Autocompletado flotante dentro de la celda */
  .cell-autocomplete-container {
    position: relative;
    width: 100%;
  }

  .inline-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    width: 100%;
    min-width: 200px;
    background: #ffffff;
    border: 1px solid #3b82f6;
    border-radius: 6px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
    z-index: 1000;
    overflow: hidden;
  }

  .inline-dropdown-header {
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    padding: 4px 8px;
    font-size: 10.5px;
    color: #64748b;
  }

  .inline-dropdown-header b {
    color: #2563eb;
  }

  .inline-dropdown-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 180px;
    overflow-y: auto;
  }

  .inline-dropdown-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 12px;
    color: #1e293b;
    border-bottom: 1px solid #f1f5f9;
    transition: background 0.15s ease;
  }

  .inline-dropdown-item:last-child {
    border-bottom: none;
  }

  .inline-dropdown-item:hover,
  .inline-dropdown-item.selected {
    background: #eff6ff;
    color: #1d4ed8;
  }

  .sug-avatar {
    font-size: 11px;
    opacity: 0.6;
  }

  .sug-name {
    flex: 1;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sug-tab-badge {
    font-size: 9.5px;
    background: #e2e8f0;
    color: #475569;
    padding: 1px 4px;
    border-radius: 3px;
    font-weight: 600;
  }

  .inline-dropdown-item.selected .sug-tab-badge {
    background: #bfdbfe;
    color: #1e40af;
  }

  /* Estado y Acciones de Fila */
  .row-status-actions {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .status-saving-inline {
    display: flex;
    align-items: center;
  }

  .mini-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid #cbd5e1;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  .status-saved-inline {
    font-size: 12px;
    font-weight: 800;
    color: #16a34a;
    background: #dcfce7;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .status-persisted-dot {
    width: 8px;
    height: 8px;
    background-color: #10b981;
    border-radius: 50%;
    display: inline-block;
  }

  .btn-inline-delete {
    background: none;
    border: 1px solid transparent;
    cursor: pointer;
    font-size: 13px;
    padding: 4px 6px;
    border-radius: 4px;
    opacity: 0.6;
    transition: all 0.15s ease;
  }

  .btn-inline-delete:hover {
    opacity: 1;
    background: #fef2f2;
    border-color: #fecaca;
  }

  /* Estados vacíos */
  .empty-state-cell {
    text-align: center;
    padding: 40px 20px;
    color: #64748b;
  }

  .loading-state-inline {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    font-size: 13.5px;
    color: #475569;
  }

  .spinner-small {
    width: 20px;
    height: 20px;
    border: 2px solid #e2e8f0;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .empty-msg-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }

  .empty-icon {
    font-size: 28px;
  }

  .empty-text {
    font-size: 13px;
    color: #64748b;
    margin: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 900px) {
    .table-top-bar {
      flex-direction: column;
      align-items: stretch;
    }
    .top-bar-right {
      justify-content: space-between;
    }
    .search-input {
      width: 100%;
    }
  }
</style>
