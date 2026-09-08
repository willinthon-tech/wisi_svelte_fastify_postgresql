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

  // Estado del formulario
  let selectedMesaId = '';
  let horaApertura = '';
  let horaCierre = '';
  let pitboss = '';
  let croupierApertura = '';
  let croupierCierre = '';
  let observacion = '';

  let isSaving = false;
  let isLoadingRecords = false;
  let isLoadingMesas = false;

  // Lista de novedades registradas para este libro
  let novedadesRecords = [];
  let serverMesas = [];

  // Estados de dropdowns interactivos de sugerencias
  let showSugPitboss = false;
  let selectedIndexPitboss = -1;

  let showSugCA = false;
  let selectedIndexCA = -1;

  let showSugCC = false;
  let selectedIndexCC = -1;

  // Usuario y salas asignadas
  $: userSalasMap = $masterUserSalasStore || {};
  $: currentUserSalas = $currentUserStore?.id ? (userSalasMap[$currentUserStore.id] || []) : [];
  $: assignedSalaIds = (currentUserSalas.length > 0)
    ? currentUserSalas
    : ($authUserSalasStore && $authUserSalasStore.length > 0 ? $authUserSalasStore.map(s => s.id) : []);

  // Lista de mesas de la sala del libro
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

  // Lista de empleados disponibles para sugerencias
  $: listaEmpleados = ($masterEmpleadosStore || []).map(e => {
    const nom = [e.nombre, e.apellido].filter(Boolean).join(' ').trim();
    return nom || e.nombre || '';
  }).filter(Boolean);

  // Sugerencias filtradas reactivas
  $: sugerenciasPitboss = (() => {
    const q = (pitboss || '').trim().toLowerCase();
    if (!q) return listaEmpleados.slice(0, 8);
    return listaEmpleados.filter(emp => emp.toLowerCase().includes(q)).slice(0, 8);
  })();

  $: sugerenciasCA = (() => {
    const q = (croupierApertura || '').trim().toLowerCase();
    if (!q) return listaEmpleados.slice(0, 8);
    return listaEmpleados.filter(emp => emp.toLowerCase().includes(q)).slice(0, 8);
  })();

  $: sugerenciasCC = (() => {
    const q = (croupierCierre || '').trim().toLowerCase();
    if (!q) return listaEmpleados.slice(0, 8);
    return listaEmpleados.filter(emp => emp.toLowerCase().includes(q)).slice(0, 8);
  })();

  // Encabezado oscuro de la tabla: Gan Casino PLC - 14/09/2026
  $: tableHeaderTitle = (() => {
    const salaName = libro?.sala_nombre || 
      ($masterSalasStore || []).find(s => Number(s.id) === Number(libro?.sala_id))?.nombre ||
      libro?.sala_nombre_comercial ||
      ($masterSalasStore || []).find(s => Number(s.id) === Number(libro?.sala_id))?.nombre_comercial || 'Sala';
    const dateFormatted = formatDateDisplay(libro?.descripcion);
    return `${salaName} - ${dateFormatted}`;
  })();

  // Mapa de registros por mesa_id para acceso ultra rápido
  $: recordsMap = (() => {
    const map = new Map();
    for (const r of novedadesRecords) {
      map.set(Number(r.mesa_id), r);
    }
    return map;
  })();

  // Cantidad de mesas con novedad registrada
  $: mesasRegistradasCount = novedadesRecords.length;

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

  function formatMesaOptionLabel(m) {
    const juegoName = m.juego_nombre || ($masterJuegosStore || []).find(j => Number(j.id) === Number(m.juego_id))?.nombre || '';
    if (juegoName) {
      return `${m.nombre} - ${juegoName}`;
    }
    return m.nombre || `Mesa #${m.id}`;
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
          if (selectedMesaId) {
            handleMesaChange();
          }
        }
      }
    } catch (err) {
      console.error('Error al cargar novedades de mesas:', err);
    } finally {
      isLoadingRecords = false;
    }
  }

  // Al cambiar la mesa seleccionada en el form, si ya tiene novedad, cargar sus datos
  function handleMesaChange() {
    if (!selectedMesaId) {
      limpiarCampos();
      return;
    }

    const existing = recordsMap.get(Number(selectedMesaId));
    if (existing) {
      horaApertura = existing.hora_apertura || '';
      horaCierre = existing.hora_cierre || '';
      pitboss = existing.pitboss || '';
      croupierApertura = existing.croupier_apertura || '';
      croupierCierre = existing.croupier_cierre || '';
      observacion = existing.observacion || '';
    } else {
      horaApertura = '';
      horaCierre = '';
      pitboss = '';
      croupierApertura = '';
      croupierCierre = '';
      observacion = '';
    }
  }

  function limpiarCampos() {
    selectedMesaId = '';
    horaApertura = '';
    horaCierre = '';
    pitboss = '';
    croupierApertura = '';
    croupierCierre = '';
    observacion = '';
  }

  function seleccionarMesaDesdeTabla(mesaId) {
    selectedMesaId = String(mesaId);
    handleMesaChange();
  }

  async function handleGuardar() {
    const lId = libroId || libro?.id;
    if (!lId) {
      triggerToast('No se encontró el ID del libro', 'error');
      return;
    }

    if (!selectedMesaId) {
      triggerToast('Seleccione una mesa para registrar la novedad', 'warning');
      return;
    }

    isSaving = true;
    try {
      const payload = {
        mesa_id: Number(selectedMesaId),
        hora_apertura: horaApertura,
        hora_cierre: horaCierre,
        pitboss: pitboss,
        croupier_apertura: croupierApertura,
        croupier_cierre: croupierCierre,
        observacion: observacion
      };

      const res = await fetch(`/api/master/libros/${lId}/novedades-mesas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Novedad de mesa guardada exitosamente', 'success');
        await loadRecords();
      } else {
        triggerToast(json?.error || 'Error al guardar la novedad de mesa', 'error');
      }
    } catch (err) {
      console.error('Error al guardar novedad de mesa:', err);
      triggerToast(`Error de conexión: ${err.message}`, 'error');
    } finally {
      isSaving = false;
    }
  }

  async function handleEliminar(recordId) {
    const lId = libroId || libro?.id;
    if (!lId || !recordId) return;

    if (!confirm('¿Está seguro de eliminar el registro de novedad para esta mesa?')) {
      return;
    }

    try {
      const res = await fetch(`/api/master/libros/${lId}/novedades-mesas/${recordId}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Registro eliminado correctamente', 'info');
        novedadesRecords = novedadesRecords.filter(r => Number(r.id) !== Number(recordId));
        if (selectedMesaId && !novedadesRecords.some(r => Number(r.mesa_id) === Number(selectedMesaId))) {
          limpiarCampos();
        }
      } else {
        triggerToast(json?.error || 'Error al eliminar el registro', 'error');
      }
    } catch (err) {
      console.error('Error al eliminar novedad de mesa:', err);
      triggerToast(`Error: ${err.message}`, 'error');
    }
  }

  // --- Handlers para Autocompletado: Pitboss ---
  function onInputPitboss() {
    showSugPitboss = true;
    selectedIndexPitboss = -1;
  }
  function onKeyDownPitboss(e) {
    if (e.key === 'ArrowDown') {
      if (!showSugPitboss) { showSugPitboss = true; selectedIndexPitboss = -1; }
      if (sugerenciasPitboss.length > 0) {
        e.preventDefault();
        selectedIndexPitboss = (selectedIndexPitboss + 1) % sugerenciasPitboss.length;
      }
    } else if (e.key === 'ArrowUp') {
      if (showSugPitboss && sugerenciasPitboss.length > 0) {
        e.preventDefault();
        selectedIndexPitboss = (selectedIndexPitboss - 1 + sugerenciasPitboss.length) % sugerenciasPitboss.length;
      }
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (showSugPitboss && sugerenciasPitboss.length > 0) {
        e.preventDefault();
        const match = selectedIndexPitboss >= 0 ? sugerenciasPitboss[selectedIndexPitboss] : sugerenciasPitboss[0];
        pitboss = match;
        showSugPitboss = false;
        selectedIndexPitboss = -1;
      }
    } else if (e.key === 'Escape') {
      showSugPitboss = false;
      selectedIndexPitboss = -1;
    }
  }
  function onBlurPitboss() {
    setTimeout(() => { showSugPitboss = false; selectedIndexPitboss = -1; }, 200);
  }

  // --- Handlers para Autocompletado: Croupier Apertura ---
  function onInputCA() {
    showSugCA = true;
    selectedIndexCA = -1;
  }
  function onKeyDownCA(e) {
    if (e.key === 'ArrowDown') {
      if (!showSugCA) { showSugCA = true; selectedIndexCA = -1; }
      if (sugerenciasCA.length > 0) {
        e.preventDefault();
        selectedIndexCA = (selectedIndexCA + 1) % sugerenciasCA.length;
      }
    } else if (e.key === 'ArrowUp') {
      if (showSugCA && sugerenciasCA.length > 0) {
        e.preventDefault();
        selectedIndexCA = (selectedIndexCA - 1 + sugerenciasCA.length) % sugerenciasCA.length;
      }
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (showSugCA && sugerenciasCA.length > 0) {
        e.preventDefault();
        const match = selectedIndexCA >= 0 ? sugerenciasCA[selectedIndexCA] : sugerenciasCA[0];
        croupierApertura = match;
        showSugCA = false;
        selectedIndexCA = -1;
      }
    } else if (e.key === 'Escape') {
      showSugCA = false;
      selectedIndexCA = -1;
    }
  }
  function onBlurCA() {
    setTimeout(() => { showSugCA = false; selectedIndexCA = -1; }, 200);
  }

  // --- Handlers para Autocompletado: Croupier Cierre ---
  function onInputCC() {
    showSugCC = true;
    selectedIndexCC = -1;
  }
  function onKeyDownCC(e) {
    if (e.key === 'ArrowDown') {
      if (!showSugCC) { showSugCC = true; selectedIndexCC = -1; }
      if (sugerenciasCC.length > 0) {
        e.preventDefault();
        selectedIndexCC = (selectedIndexCC + 1) % sugerenciasCC.length;
      }
    } else if (e.key === 'ArrowUp') {
      if (showSugCC && sugerenciasCC.length > 0) {
        e.preventDefault();
        selectedIndexCC = (selectedIndexCC - 1 + sugerenciasCC.length) % sugerenciasCC.length;
      }
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (showSugCC && sugerenciasCC.length > 0) {
        e.preventDefault();
        const match = selectedIndexCC >= 0 ? sugerenciasCC[selectedIndexCC] : sugerenciasCC[0];
        croupierCierre = match;
        showSugCC = false;
        selectedIndexCC = -1;
      }
    } else if (e.key === 'Escape') {
      showSugCC = false;
      selectedIndexCC = -1;
    }
  }
  function onBlurCC() {
    setTimeout(() => { showSugCC = false; selectedIndexCC = -1; }, 200);
  }
</script>

<div class="novedades-layout-grid">
  <!-- Tarjeta Izquierda: Formulario "Novedades de Mesas" -->
  <div class="card-form-novedades">
    <div class="card-title-box">
      <div class="title-row">
        <h3 class="card-title">Novedades de Mesas</h3>
        {#if selectedMesaId && recordsMap.has(Number(selectedMesaId))}
          <span class="badge-edit">Editando Mesa</span>
        {/if}
      </div>
      <div class="title-underline"></div>
    </div>

    <form on:submit|preventDefault={handleGuardar} class="novedades-form">
      <!-- 1. Selector de Mesa -->
      <div class="form-group">
        <label for="select-mesa" class="form-label">Mesa: *</label>
        <select 
          id="select-mesa" 
          class="form-select" 
          bind:value={selectedMesaId}
          on:change={handleMesaChange}
          required
        >
          <option value="">Seleccione una mesa...</option>
          {#each availableMesas as m}
            <option value={m.id}>
              {formatMesaOptionLabel(m)} {recordsMap.has(Number(m.id)) ? '✓' : ''}
            </option>
          {/each}
        </select>
      </div>

      <!-- 2. Horarios (Hora Apertura y Hora Cierre) -->
      <div class="time-dual-row">
        <div class="time-col">
          <div class="col-header-mini">
            <label for="hora-apertura" class="mini-label">Hora Apertura:</label>
            <button 
              type="button" 
              class="btn-mini-now" 
              on:click={() => { horaApertura = getCurrentTimeString(); }}
              title="Colocar hora actual"
            >⚡ Ahora</button>
          </div>
          <input 
            id="hora-apertura" 
            type="time" 
            class="form-time-input" 
            bind:value={horaApertura} 
          />
        </div>

        <div class="time-col">
          <div class="col-header-mini">
            <label for="hora-cierre" class="mini-label">Hora Cierre:</label>
            <button 
              type="button" 
              class="btn-mini-now" 
              on:click={() => { horaCierre = getCurrentTimeString(); }}
              title="Colocar hora actual"
            >⚡ Ahora</button>
          </div>
          <input 
            id="hora-cierre" 
            type="time" 
            class="form-time-input" 
            bind:value={horaCierre} 
          />
        </div>
      </div>

      <!-- 3. Pitboss (Autocompletado de empleados) -->
      <div class="form-group autocomplete-group">
        <label for="input-pitboss" class="form-label">Pitboss:</label>
        <div class="input-container">
          <input 
            id="input-pitboss" 
            type="text" 
            class="form-text-input" 
            placeholder="Escriba o elija Pitboss..." 
            bind:value={pitboss}
            on:input={onInputPitboss}
            on:keydown={onKeyDownPitboss}
            on:blur={onBlurPitboss}
            on:focus={onInputPitboss}
            autocomplete="off"
          />

          {#if showSugPitboss && sugerenciasPitboss.length > 0}
            <div class="sugerencias-dropdown">
              <div class="sugerencias-header">
                <span>Sugerencias (Pulsa <b>Tab</b> o clic):</span>
              </div>
              <ul class="sugerencias-list">
                {#each sugerenciasPitboss as sug, idx}
                  <!-- svelte-ignore a11y-click-events-have-key-events -->
                  <li 
                    class="sugerencia-item {idx === selectedIndexPitboss ? 'active' : ''}"
                    on:mousedown|preventDefault={() => { pitboss = sug; showSugPitboss = false; }}
                  >
                    <span class="sug-icon">👤</span>
                    <span class="sug-text">{sug}</span>
                    <span class="sug-tab-badge">Tab ⇥</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      </div>

      <!-- 4. Croupier Apertura (Autocompletado de empleados) -->
      <div class="form-group autocomplete-group">
        <label for="input-croupier-a" class="form-label">Croupier Apertura:</label>
        <div class="input-container">
          <input 
            id="input-croupier-a" 
            type="text" 
            class="form-text-input" 
            placeholder="Escriba o elija Croupier Apertura..." 
            bind:value={croupierApertura}
            on:input={onInputCA}
            on:keydown={onKeyDownCA}
            on:blur={onBlurCA}
            on:focus={onInputCA}
            autocomplete="off"
          />

          {#if showSugCA && sugerenciasCA.length > 0}
            <div class="sugerencias-dropdown">
              <div class="sugerencias-header">
                <span>Sugerencias (Pulsa <b>Tab</b> o clic):</span>
              </div>
              <ul class="sugerencias-list">
                {#each sugerenciasCA as sug, idx}
                  <!-- svelte-ignore a11y-click-events-have-key-events -->
                  <li 
                    class="sugerencia-item {idx === selectedIndexCA ? 'active' : ''}"
                    on:mousedown|preventDefault={() => { croupierApertura = sug; showSugCA = false; }}
                  >
                    <span class="sug-icon">👤</span>
                    <span class="sug-text">{sug}</span>
                    <span class="sug-tab-badge">Tab ⇥</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      </div>

      <!-- 5. Croupier Cierre (Autocompletado de empleados) -->
      <div class="form-group autocomplete-group">
        <label for="input-croupier-c" class="form-label">Croupier Cierre:</label>
        <div class="input-container">
          <input 
            id="input-croupier-c" 
            type="text" 
            class="form-text-input" 
            placeholder="Escriba o elija Croupier Cierre..." 
            bind:value={croupierCierre}
            on:input={onInputCC}
            on:keydown={onKeyDownCC}
            on:blur={onBlurCC}
            on:focus={onInputCC}
            autocomplete="off"
          />

          {#if showSugCC && sugerenciasCC.length > 0}
            <div class="sugerencias-dropdown">
              <div class="sugerencias-header">
                <span>Sugerencias (Pulsa <b>Tab</b> o clic):</span>
              </div>
              <ul class="sugerencias-list">
                {#each sugerenciasCC as sug, idx}
                  <!-- svelte-ignore a11y-click-events-have-key-events -->
                  <li 
                    class="sugerencia-item {idx === selectedIndexCC ? 'active' : ''}"
                    on:mousedown|preventDefault={() => { croupierCierre = sug; showSugCC = false; }}
                  >
                    <span class="sug-icon">👤</span>
                    <span class="sug-text">{sug}</span>
                    <span class="sug-tab-badge">Tab ⇥</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      </div>

      <!-- 6. Observación (Textarea) -->
      <div class="form-group">
        <label for="input-obs" class="form-label">Observación:</label>
        <textarea 
          id="input-obs" 
          class="form-textarea" 
          rows="3" 
          placeholder="Observaciones de la mesa (ej. VIP, etc.)..."
          bind:value={observacion}
        ></textarea>
      </div>

      <!-- Botones de Acción -->
      <div class="form-btns-row">
        <button 
          type="submit" 
          class="btn-guardar"
          disabled={isSaving}
        >
          {#if isSaving}
            <span>Guardando...</span>
          {:else if selectedMesaId && recordsMap.has(Number(selectedMesaId))}
            <span>✓ Actualizar Mesa</span>
          {:else}
            <span>Guardar Novedad</span>
          {/if}
        </button>

        {#if selectedMesaId}
          <button 
            type="button" 
            class="btn-limpiar"
            on:click={limpiarCampos}
            title="Limpiar campos y deseleccionar mesa"
          >
            Limpiar
          </button>
        {/if}
      </div>
    </form>
  </div>

  <!-- Tarjeta Derecha: Tabla de Novedades de Mesas -->
  <div class="card-table-novedades">
    <!-- Barra Superior Oscura con Sala y Fecha -->
    <div class="table-top-bar">
      <span class="top-bar-title">{tableHeaderTitle}</span>
      <div class="top-bar-badge">
        {#if availableMesas.length > 0}
          <span class="badge-status {mesasRegistradasCount === availableMesas.length ? 'complete' : 'partial'}">
            {mesasRegistradasCount} de {availableMesas.length} mesas registradas
          </span>
        {/if}
      </div>
    </div>

    <!-- Tabla de Contenido -->
    <div class="table-wrapper">
      <table class="novedades-table">
        <thead>
          <tr>
            <th class="th-center th-col-dual-hora">
              <div class="header-dual-stacked">
                <span class="hdr-line">HORA APERTURA</span>
                <span class="hdr-divider"></span>
                <span class="hdr-line">HORA CIERRE</span>
              </div>
            </th>
            <th class="th-mesa">MESA</th>
            <th class="th-left th-person">PITBOSS</th>
            <th class="th-left th-col-dual-croupier">
              <div class="header-dual-stacked text-left">
                <span class="hdr-line">CROUPIER APERTURA</span>
                <span class="hdr-divider"></span>
                <span class="hdr-line">CROUPIER CIERRE</span>
              </div>
            </th>
            <th class="th-left th-obs">OBSERVACIÓN</th>
            <th class="th-center th-acciones">ACCIONES</th>
          </tr>
        </thead>
        <tbody>
          {#if isLoadingRecords || isLoadingMesas}
            <tr>
              <td colspan="6" class="empty-state-cell">
                <div class="loading-state-inline">
                  <div class="spinner-small"></div>
                  <span>Cargando novedades y mesas de la sala...</span>
                </div>
              </td>
            </tr>
          {:else if availableMesas.length === 0}
            <tr>
              <td colspan="6" class="empty-state-cell">
                <div class="empty-msg-box">
                  <span class="empty-icon">🎲</span>
                  <p class="empty-text">No se encontraron mesas activas configuradas para esta sala.</p>
                </div>
              </td>
            </tr>
          {:else}
            {#each availableMesas as mesa}
              {@const rec = recordsMap.get(Number(mesa.id))}
              {@const isSelected = Number(selectedMesaId) === Number(mesa.id)}
              <tr 
                class="novedad-row {isSelected ? 'row-selected' : ''} {rec ? 'row-completed' : 'row-pending'}"
                on:click={() => seleccionarMesaDesdeTabla(mesa.id)}
                title="Haga clic para cargar y editar esta mesa"
              >
                <!-- 1. HORA (Apertura arriba / Cierre abajo) -->
                <td class="td-center td-dual-hora">
                  <div class="cell-dual-stacked">
                    <div class="dual-row">
                      {#if rec?.hora_apertura}
                        <span class="badge-hora badge-apertura">{rec.hora_apertura}</span>
                      {:else}
                        <span class="badge-vacio">—</span>
                      {/if}
                    </div>
                    <div class="dual-row">
                      {#if rec?.hora_cierre}
                        <span class="badge-hora badge-cierre">{rec.hora_cierre}</span>
                      {:else}
                        <span class="badge-vacio">—</span>
                      {/if}
                    </div>
                  </div>
                </td>

                <!-- 2. MESA -->
                <td class="td-mesa">
                  <span class="mesa-badge-tag">{mesa.nombre}</span>
                  {#if mesa.juego_nombre}
                    <span class="mesa-sub-juego">{mesa.juego_nombre}</span>
                  {/if}
                </td>

                <!-- 3. PITBOSS -->
                <td class="td-left td-person">
                  {#if rec?.pitboss}
                    <span class="person-name">👤 {rec.pitboss}</span>
                  {:else}
                    <span class="empty-dash">—</span>
                  {/if}
                </td>

                <!-- 4. CROUPIERES (Apertura arriba / Cierre abajo) -->
                <td class="td-left td-dual-croupier">
                  <div class="cell-dual-stacked-left">
                    <div class="dual-row-person">
                      {#if rec?.croupier_apertura}
                        <span class="person-name">👤 {rec.croupier_apertura}</span>
                      {:else}
                        <span class="empty-dash">—</span>
                      {/if}
                    </div>
                    <div class="dual-row-person">
                      {#if rec?.croupier_cierre}
                        <span class="person-name">👤 {rec.croupier_cierre}</span>
                      {:else}
                        <span class="empty-dash">—</span>
                      {/if}
                    </div>
                  </div>
                </td>

                <!-- 5. OBSERVACIÓN -->
                <td class="td-left td-obs">
                  {#if rec?.observacion}
                    <span class="obs-tag">{rec.observacion}</span>
                  {:else}
                    <span class="empty-dash">—</span>
                  {/if}
                </td>

                <!-- ACCIONES -->
                <td class="td-center td-acciones">
                  <div class="row-actions-group" on:click|stopPropagation>
                    {#if rec}
                      <button 
                        type="button" 
                        class="btn-action-icon edit"
                        on:click={() => seleccionarMesaDesdeTabla(mesa.id)}
                        title="Editar novedad de esta mesa"
                      >
                        ✏️
                      </button>
                      <button 
                        type="button" 
                        class="btn-action-icon delete"
                        on:click={() => handleEliminar(rec.id)}
                        title="Eliminar novedad registrada"
                      >
                        🗑️
                      </button>
                    {:else}
                      <button 
                        type="button" 
                        class="btn-action-add"
                        on:click={() => seleccionarMesaDesdeTabla(mesa.id)}
                        title="Registrar novedad para esta mesa"
                      >
                        + Registrar
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
  .novedades-layout-grid {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 24px;
    align-items: flex-start;
    width: 100%;
    box-sizing: border-box;
  }

  @media (max-width: 1080px) {
    .novedades-layout-grid {
      grid-template-columns: 1fr;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     Tarjeta Izquierda: Formulario
  ───────────────────────────────────────────────────────────── */
  .card-form-novedades {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 20px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .card-title-box {
    margin-bottom: 2px;
  }

  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .card-title {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    color: #1e293b;
    letter-spacing: -0.2px;
  }

  .badge-edit {
    font-size: 11px;
    font-weight: 700;
    background: #eff6ff;
    color: #2563eb;
    border: 1px solid #bfdbfe;
    padding: 2px 8px;
    border-radius: 10px;
  }

  .title-underline {
    margin-top: 8px;
    height: 2px;
    background: #3b82f6;
    width: 100%;
    border-radius: 2px;
  }

  .novedades-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .autocomplete-group {
    position: relative;
  }

  .input-container {
    position: relative;
    width: 100%;
  }

  .form-label {
    font-size: 12.5px;
    font-weight: 700;
    color: #334155;
  }

  .form-select {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13.5px;
    color: #0f172a;
    background-color: #ffffff;
    outline: none;
    transition: all 0.2s ease;
    box-sizing: border-box;
    font-weight: 600;
  }

  .form-select:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .time-dual-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .time-col {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .col-header-mini {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .mini-label {
    font-size: 11.5px;
    font-weight: 600;
    color: #475569;
  }

  .btn-mini-now {
    background: none;
    border: none;
    color: #2563eb;
    font-size: 10.5px;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
    transition: color 0.15s ease;
  }

  .btn-mini-now:hover {
    color: #1d4ed8;
    text-decoration: underline;
  }

  .form-time-input {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid #cbd5e1;
    border-radius: 5px;
    font-size: 13px;
    color: #0f172a;
    background-color: #ffffff;
    outline: none;
    box-sizing: border-box;
    transition: all 0.2s ease;
    font-family: inherit;
  }

  .form-time-input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .form-text-input {
    width: 100%;
    padding: 7px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 5px;
    font-size: 13px;
    color: #0f172a;
    background-color: #ffffff;
    outline: none;
    box-sizing: border-box;
    transition: all 0.2s ease;
    font-family: inherit;
  }

  .form-text-input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .form-textarea {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 5px;
    font-size: 13px;
    color: #0f172a;
    background-color: #ffffff;
    outline: none;
    box-sizing: border-box;
    transition: all 0.2s ease;
    font-family: inherit;
    resize: vertical;
  }

  .form-textarea:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  /* Desplegable de Sugerencias */
  .sugerencias-dropdown {
    position: absolute;
    top: calc(100% + 3px);
    left: 0;
    right: 0;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    z-index: 100;
    overflow: hidden;
  }

  .sugerencias-header {
    background: #f8fafc;
    padding: 5px 10px;
    font-size: 11px;
    color: #64748b;
    border-bottom: 1px solid #e2e8f0;
  }

  .sugerencias-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 180px;
    overflow-y: auto;
  }

  .sugerencia-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    cursor: pointer;
    font-size: 12.5px;
    color: #1e293b;
    border-bottom: 1px solid #f1f5f9;
    transition: background 0.15s ease;
  }

  .sugerencia-item:last-child {
    border-bottom: none;
  }

  .sugerencia-item:hover,
  .sugerencia-item.active {
    background: #eff6ff;
    color: #1d4ed8;
  }

  .sug-icon {
    font-size: 12px;
    opacity: 0.6;
  }

  .sug-text {
    flex: 1;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sug-tab-badge {
    font-size: 10px;
    background: #e2e8f0;
    color: #475569;
    padding: 2px 5px;
    border-radius: 3px;
    font-weight: 600;
  }

  .sugerencia-item.active .sug-tab-badge {
    background: #bfdbfe;
    color: #1e40af;
  }

  /* Botones del Form */
  .form-btns-row {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }

  .btn-guardar {
    flex: 1;
    padding: 10px 16px;
    background-color: #5bb87e;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    box-shadow: 0 2px 4px rgba(91, 184, 126, 0.25);
  }

  .btn-guardar:hover:not(:disabled) {
    background-color: #4ca66e;
    box-shadow: 0 4px 8px rgba(91, 184, 126, 0.35);
  }

  .btn-guardar:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .btn-limpiar {
    padding: 10px 14px;
    background-color: #f1f5f9;
    color: #475569;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-limpiar:hover {
    background-color: #e2e8f0;
    color: #0f172a;
  }

  /* ─────────────────────────────────────────────────────────────
     Tarjeta Derecha: Tabla de Novedades de Mesas
  ───────────────────────────────────────────────────────────── */
  .card-table-novedades {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
  }

  .table-top-bar {
    background: #54626f;
    color: #ffffff;
    padding: 12px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }

  .top-bar-title {
    font-size: 14.5px;
    font-weight: 700;
    letter-spacing: 0.3px;
  }

  .badge-status {
    font-size: 11.5px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 12px;
    letter-spacing: 0.2px;
  }

  .badge-status.complete {
    background: #10b981;
    color: #ffffff;
  }

  .badge-status.partial {
    background: #f59e0b;
    color: #ffffff;
  }

  .table-wrapper {
    overflow-x: auto;
    width: 100%;
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
    padding: 12px 14px;
    font-size: 11.5px;
    font-weight: 800;
    letter-spacing: 0.3px;
    white-space: nowrap;
  }

  .th-center { text-align: center; }
  .th-left { text-align: left; }
  .th-col-dual-hora { min-width: 125px; }
  .th-mesa { min-width: 105px; }
  .th-person { min-width: 135px; }
  .th-col-dual-croupier { min-width: 175px; }
  .th-obs { min-width: 120px; }
  .th-acciones { width: 95px; }

  .header-dual-stacked {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
  }

  .header-dual-stacked.text-left {
    align-items: flex-start;
  }

  .hdr-line {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.3px;
    white-space: nowrap;
  }

  .hdr-divider {
    width: 100%;
    height: 1px;
    background: rgba(255, 255, 255, 0.2);
  }

  .cell-dual-stacked {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 2px 0;
  }

  .cell-dual-stacked-left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 2px 0;
  }

  .dual-row {
    min-height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dual-row-person {
    min-height: 22px;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .novedad-row {
    border-bottom: 1px solid #f1f5f9;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .novedad-row:hover {
    background: #f8fafc;
  }

  .novedad-row.row-selected {
    background: #eff6ff !important;
  }

  .novedades-table td {
    padding: 10px 14px;
    vertical-align: middle;
  }

  .td-center { text-align: center; }
  .td-left { text-align: left; }

  .td-mesa {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mesa-badge-tag {
    font-weight: 800;
    color: #0f172a;
    font-size: 13px;
  }

  .mesa-sub-juego {
    font-size: 11px;
    color: #64748b;
  }

  .badge-hora {
    display: inline-block;
    padding: 3px 8px;
    font-weight: 800;
    font-size: 12px;
    border-radius: 4px;
    font-variant-numeric: tabular-nums;
  }

  .badge-apertura {
    background: #eff6ff;
    color: #1e40af;
    border: 1px solid #bfdbfe;
  }

  .badge-cierre {
    background: #fef2f2;
    color: #991b1b;
    border: 1px solid #fecaca;
  }

  .badge-vacio, .empty-dash {
    color: #94a3b8;
    font-weight: 600;
  }

  .person-name {
    font-weight: 600;
    color: #1e293b;
    font-size: 12.5px;
  }

  .obs-tag {
    display: inline-block;
    background: #f1f5f9;
    color: #334155;
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 11.5px;
    font-weight: 700;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 1px solid #e2e8f0;
  }

  .row-actions-group {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .btn-action-icon {
    background: none;
    border: 1px solid transparent;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    font-size: 13px;
    transition: all 0.15s ease;
  }

  .btn-action-icon.edit:hover {
    background: #eff6ff;
    border-color: #bfdbfe;
  }

  .btn-action-icon.delete:hover {
    background: #fef2f2;
    border-color: #fecaca;
  }

  .btn-action-add {
    background: #f1f5f9;
    color: #2563eb;
    border: 1px solid #cbd5e1;
    font-size: 11px;
    font-weight: 700;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .btn-action-add:hover {
    background: #eff6ff;
    border-color: #3b82f6;
    color: #1d4ed8;
  }

  .empty-state-cell {
    padding: 40px 20px;
    text-align: center;
  }

  .loading-state-inline {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: #64748b;
    font-size: 13px;
  }

  .spinner-small {
    width: 16px;
    height: 16px;
    border: 2px solid #cbd5e1;
    border-top-color: #2563eb;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  .empty-msg-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .empty-icon {
    font-size: 28px;
  }

  .empty-text {
    margin: 0;
    color: #64748b;
    font-size: 13px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
