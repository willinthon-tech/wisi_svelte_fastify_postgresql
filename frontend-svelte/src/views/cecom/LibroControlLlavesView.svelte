<script>
  import { onMount } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { 
    masterLlavesStore, 
    masterSalasStore, 
    userSalasStore as masterUserSalasStore,
    loadMasterStoresFromBackend,
    currentRoutePermissionsStore
  } from '../../controllers/master.store.js';
  import {
    getLocalItems,
    saveLocalItems,
    upsertLocalItem,
    deleteLocalItem,
    queueOutboxAction,
    generateSafeUuid
  } from '../../services/localDb.service.js';

  export let libro = null;
  export let libroId = null;

  $: canEdit = $currentRoutePermissionsStore ? Boolean($currentRoutePermissionsStore.canEdit) : true;
  $: canDelete = $currentRoutePermissionsStore ? Boolean($currentRoutePermissionsStore.canDelete) : true;
  $: canAdd = $currentRoutePermissionsStore ? Boolean($currentRoutePermissionsStore.canAdd) : true;

  // Estado del formulario
  let selectedLlavesUuids = []; // Array de UUIDs seleccionados
  let descripcion = '';
  let isSaving = false;
  let isMultiselectOpen = false;
  let llaveSearchQuery = '';

  // Lista de registros de control de llaves
  let records = [];
  let isLoadingRecords = true;

  // Ordenados de manera segura por timestamp o identificador descendente
  $: sortedRecords = [...records].sort((a, b) => 
    (new Date(b.created_at || 0) - new Date(a.created_at || 0)) ||
    (String(b.uuid || b.id || '').localeCompare(String(a.uuid || a.id || '')))
  );

  // Llaves cargadas del servidor o store
  let serverLlaves = [];
  let isLoadingLlaves = false;

  // Modales
  let showModalLlaves = false;
  let modalLlavesList = [];
  let modalDescripcion = '';

  let showModalHoras = false;
  let editingRecord = null;
  let modalHoraSalida = '';
  let modalHoraRecepcion = '';
  let isSavingHoras = false;

  // Usuario y salas asignadas
  $: userSalasMap = $masterUserSalasStore || {};
  $: currentUserSalas = $currentUserStore?.uuid || $currentUserStore?.id ? (userSalasMap[$currentUserStore.uuid || $currentUserStore.id] || []) : [];
  $: assignedSalaUuids = (currentUserSalas.length > 0)
    ? currentUserSalas.map(s => typeof s === 'object' ? (s.uuid || s.id) : s)
    : ($authUserSalasStore && $authUserSalasStore.length > 0 ? $authUserSalasStore.map(s => s.uuid || s.id) : []);
  $: assignedSalaIds = assignedSalaUuids;

  // Filtrado de llaves activas asociadas a la sala del libro
  $: availableLlaves = (() => {
    const list = (serverLlaves && serverLlaves.length > 0) ? serverLlaves : ($masterLlavesStore || []);
    const targetSalaUuid = libro?.sala_uuid || libro?.sala_id;
    return list.filter(k => {
      if ((k.active ?? 1) === 0) return false;

      // Si el libro tiene sala_uuid, debe coincidir con la sala del libro
      const kSalaUuid = k.sala_uuid || k.sala_id;
      if (targetSalaUuid && String(kSalaUuid) !== String(targetSalaUuid)) {
        return false;
      }

      // Si el usuario logueado tiene salas asignadas, la llave debe pertenecer a esas salas
      if (assignedSalaUuids && assignedSalaUuids.length > 0) {
        const userSalaSet = new Set(assignedSalaUuids.map(String));
        if (!userSalaSet.has(String(kSalaUuid))) {
          return false;
        }
      }

      return true;
    });
  })();

  // Llaves filtradas por el buscador del multiselect
  $: filteredAvailableLlaves = availableLlaves.filter(k => {
    if (!llaveSearchQuery) return true;
    return (k.nombre || '').toLowerCase().includes(llaveSearchQuery.toLowerCase());
  });

  // Encabezado oscuro de la tabla: Gan Casino PLC - 14/09/2026
  $: tableHeaderTitle = (() => {
    const salaName = libro?.sala_nombre || 
      ($masterSalasStore || []).find(s => String(s.id) === String(libro?.sala_id))?.nombre ||
      libro?.sala_nombre_comercial ||
      ($masterSalasStore || []).find(s => String(s.id) === String(libro?.sala_id))?.nombre_comercial || 'Sala';
    const dateFormatted = formatDateDisplay(libro?.descripcion);
    return `${salaName} - ${dateFormatted}`;
  })();

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
      fetchServerLlaves(),
      loadRecords()
    ]);
  });

  $: if (libroId || libro?.id || libro?.uuid) {
    loadRecords();
  }

  async function fetchServerLlaves() {
    isLoadingLlaves = true;
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const localLlaves = await getLocalItems('llaves');
        if (Array.isArray(localLlaves) && localLlaves.length > 0) {
          serverLlaves = localLlaves;
        }
        return;
      }
      const q = new URLSearchParams({ limit: '0', active: '1' });
      if (assignedSalaIds && assignedSalaIds.length > 0) {
        q.set('user_sala_ids', assignedSalaIds.join(','));
      }
      if (libro?.sala_uuid) {
        q.set('sala_uuids', String(libro.sala_uuid));
      } else if (libro?.sala_id) {
        q.set('sala_ids', String(libro.sala_id));
      }
      const res = await fetch(`/api/master/llaves?${q.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && Array.isArray(json.data)) {
          serverLlaves = json.data;
          saveLocalItems('llaves', json.data).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('Error al cargar llaves del servidor (usando local):', e);
      try {
        const localLlaves = await getLocalItems('llaves');
        if (Array.isArray(localLlaves) && localLlaves.length > 0) {
          serverLlaves = localLlaves;
        }
      } catch (err) {}
    } finally {
      isLoadingLlaves = false;
    }
  }

  async function loadRecords() {
    const lId = libro?.uuid || libroId || libro?.id;
    if (!lId) return;
    isLoadingRecords = true;

    // 1. Carga inmediata desde base de datos local IndexedDB (0ms)
    try {
      const local = await getLocalItems('libro_control_llaves', r => 
        (r.libro_uuid && (String(r.libro_uuid) === String(lId) || String(r.libro_uuid) === String(libro?.uuid))) ||
        (r.libro_id && (String(r.libro_id) === String(lId) || String(r.libro_id) === String(libro?.id)))
      );
      if (Array.isArray(local)) {
        records = local;
      }
    } catch (e) {}

    // Si no hay conexión o estamos offline, finalizar carga local sin esperar timeout de red
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      isLoadingRecords = false;
      return;
    }

    // 2. Consulta al backend en segundo plano para refrescar
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`/api/master/libros/${lId}/control-llaves`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success) {
          records = json.data || [];
          saveLocalItems('libro_control_llaves', json.data).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('[LocalDb] Sin conexión al backend para control-llaves (usando datos locales):', err);
    } finally {
      isLoadingRecords = false;
    }
  }

  function toggleLlaveSelection(llaveUuid) {
    const val = String(llaveUuid);
    if (selectedLlavesUuids.some(i => String(i) === val)) {
      selectedLlavesUuids = selectedLlavesUuids.filter(i => String(i) !== val);
    } else {
      selectedLlavesUuids = [...selectedLlavesUuids, val];
    }
  }

  function toggleSelectAllLlaves() {
    if (selectedLlavesUuids.length === availableLlaves.length) {
      selectedLlavesUuids = [];
    } else {
      selectedLlavesUuids = availableLlaves.map(k => k.uuid || k.id);
    }
  }

  function removeLlaveTag(llaveUuid) {
    selectedLlavesUuids = selectedLlavesUuids.filter(i => String(i) !== String(llaveUuid));
  }

  function getLlaveName(uuidOrId) {
    const k = availableLlaves.find(item => String(item.uuid || item.id) === String(uuidOrId));
    return k?.nombre || (uuidOrId && String(uuidOrId).length > 20 ? `Llave #${String(uuidOrId).slice(0, 8)}` : `Llave #${uuidOrId}`);
  }

  async function handleGuardar() {
    if (!canAdd) {
      triggerToast('No tienes permiso para agregar registros en este módulo', 'warning');
      return;
    }
    const lId = libro?.uuid || libroId || libro?.id;
    if (!lId) {
      triggerToast('No se encontró el ID del libro', 'error');
      return;
    }

    if (selectedLlavesUuids.length === 0) {
      triggerToast('Seleccione al menos una llave para registrar el movimiento', 'warning');
      return;
    }

    const itemUuid = generateSafeUuid();
    const horaSalida = getCurrentTimeString();
    const newRecord = {
      uuid: itemUuid,
      libro_uuid: lId,
      llaves_uuids: [...selectedLlavesUuids],
      llaves_ids: [...selectedLlavesUuids],
      llaves_detalle: selectedLlavesUuids.map(u => ({ uuid: u, id: u, nombre: getLlaveName(u) })),
      descripcion: (descripcion || '').trim() || 'General',
      hora_salida: horaSalida,
      hora_recepcion: null,
      created_at: new Date().toISOString()
    };

    // 1. ACTUALIZACIÓN INSTANTÁNEA EN MEMORIA (0ms) -> UI reactiva inmediata
    records = [newRecord, ...records];

    // 2. Limpieza inmediata del formulario para continuar operando sin esperas
    selectedLlavesUuids = [];
    descripcion = '';
    isMultiselectOpen = false;
    isSaving = false;

    // 3. Guardado inmediato en base de datos local IndexedDB (<5ms)
    await upsertLocalItem('libro_control_llaves', newRecord);

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

    if (isOffline) {
      // 4A. Modo Offline: Encolar de inmediato en Outbox sin tocar la red
      await queueOutboxAction({
        entity: 'libro_control_llaves',
        action: 'create',
        endpoint: `/api/master/libros/${lId}/control-llaves`,
        method: 'POST',
        payload: newRecord,
        uuid: itemUuid
      });
      triggerToast('Modo Offline: Movimiento de llaves guardado localmente.', 'info');
      return;
    }

    // 4B. Modo Online: Notificación de éxito y sincronización en segundo plano con timeout
    triggerToast('Movimiento de llaves registrado exitosamente', 'success');

    (async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(`/api/master/libros/${lId}/control-llaves`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newRecord),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const json = await res.json();
          if (json?.data) {
            await upsertLocalItem('libro_control_llaves', json.data);
          }
        } else {
          throw new Error(`Server status ${res.status}`);
        }
      } catch (syncErr) {
        console.warn('[LocalDb] No se sincronizó en vivo, asegurando en Outbox:', syncErr);
        await queueOutboxAction({
          entity: 'libro_control_llaves',
          action: 'create',
          endpoint: `/api/master/libros/${lId}/control-llaves`,
          method: 'POST',
          payload: newRecord,
          uuid: itemUuid
        });
      }
    })();
  }

  async function handleEliminar(recordOrId) {
    if (!canDelete) {
      triggerToast('No tienes permiso para eliminar registros en este módulo', 'warning');
      return;
    }
    const recordUuid = typeof recordOrId === 'object' ? (recordOrId.uuid || recordOrId.id) : recordOrId;
    const lId = libro?.uuid || libroId || libro?.id;
    if (!lId || !recordUuid) return;

    // 1. Eliminación instantánea en memoria (0ms)
    records = records.filter(r => String(r.uuid || r.id) !== String(recordUuid));
    triggerToast('Registro eliminado correctamente', 'info');

    // 2. Eliminación en base de datos local IndexedDB (<5ms)
    await deleteLocalItem('libro_control_llaves', recordUuid);

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (isOffline) {
      await queueOutboxAction({
        entity: 'libro_control_llaves',
        action: 'delete',
        endpoint: `/api/master/libros/${lId}/control-llaves/${recordUuid}`,
        method: 'DELETE',
        targetId: recordUuid
      });
      return;
    }

    // Segundo plano para backend
    (async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(`/api/master/libros/${lId}/control-llaves/${recordUuid}`, {
          method: 'DELETE',
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
      } catch (delErr) {
        console.warn('[LocalDb] Falló eliminación en vivo, encolando en Outbox:', delErr);
        await queueOutboxAction({
          entity: 'libro_control_llaves',
          action: 'delete',
          endpoint: `/api/master/libros/${lId}/control-llaves/${recordUuid}`,
          method: 'DELETE',
          targetId: recordUuid
        });
      }
    })();
  }

  // Modal Ver Llaves
  function abrirModalLlaves(record) {
    modalDescripcion = record.descripcion || 'General';
    modalLlavesList = Array.isArray(record.llaves_detalle) && record.llaves_detalle.length > 0
      ? record.llaves_detalle
      : (record.llaves_ids || []).map(id => ({ id, nombre: getLlaveName(id) }));
    showModalLlaves = true;
  }

  function cerrarModalLlaves() {
    showModalLlaves = false;
    modalLlavesList = [];
  }

  // Modal Horas
  function abrirModalHoras(record) {
    if (!canEdit) {
      triggerToast('No tienes permiso para editar registros en este módulo', 'warning');
      return;
    }
    editingRecord = record;
    modalHoraSalida = record.hora_salida || getCurrentTimeString();
    modalHoraRecepcion = record.hora_recepcion || getCurrentTimeString();
    showModalHoras = true;
  }

  function cerrarModalHoras() {
    showModalHoras = false;
    editingRecord = null;
  }

  function ponerHoraActualRecepcion() {
    modalHoraRecepcion = getCurrentTimeString();
  }

  async function handleGuardarHoras() {
    if (!canEdit) {
      triggerToast('No tienes permiso para editar registros en este módulo', 'warning');
      return;
    }
    if (!editingRecord) return;
    const lId = libro?.uuid || libroId || libro?.id;
    if (!lId) return;

    const targetUuid = editingRecord.uuid || editingRecord.id;
    const payload = {
      hora_salida: modalHoraSalida || getCurrentTimeString(),
      hora_recepcion: modalHoraRecepcion || null
    };

    const updatedRecord = {
      ...editingRecord,
      ...payload,
      updated_at: new Date().toISOString()
    };

    // 1. Actualización instantánea en memoria (0ms)
    records = records.map(r => String(r.uuid || r.id) === String(targetUuid) ? updatedRecord : r);
    cerrarModalHoras();
    triggerToast('Horas actualizadas correctamente', 'success');

    // 2. Guardado en base de datos local IndexedDB (<5ms)
    await upsertLocalItem('libro_control_llaves', updatedRecord);

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (isOffline) {
      await queueOutboxAction({
        entity: 'libro_control_llaves',
        action: 'update',
        endpoint: `/api/master/libros/${lId}/control-llaves/${targetUuid}/horas`,
        method: 'PUT',
        payload: updatedRecord,
        targetId: targetUuid
      });
      return;
    }

    // Segundo plano para backend
    (async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(`/api/master/libros/${lId}/control-llaves/${targetUuid}/horas`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          const json = await res.json();
          if (json?.data) {
            await upsertLocalItem('libro_control_llaves', json.data);
          }
        } else {
          throw new Error(`Server returned ${res.status}`);
        }
      } catch (editErr) {
        console.warn('[LocalDb] Falló actualización de horas en vivo, encolando en Outbox:', editErr);
        await queueOutboxAction({
          entity: 'libro_control_llaves',
          action: 'update',
          endpoint: `/api/master/libros/${lId}/control-llaves/${targetUuid}/horas`,
          method: 'PUT',
          payload: updatedRecord,
          targetId: targetUuid
        });
      }
    })();
  }
</script>

<!-- Close multiselect if clicked outside -->
<svelte:window on:click={() => { if (isMultiselectOpen) isMultiselectOpen = false; }} />

<div class="control-llaves-grid">
  <!-- Tarjeta Izquierda: Formulario "Control de Llaves" -->
  <div class="card-form-llaves">
    <div class="card-title-box">
      <h3 class="card-title">Control de Llaves</h3>
      <div class="title-underline"></div>
    </div>

    <form on:submit|preventDefault={handleGuardar} class="llaves-form">
      <!-- Multiselect de Llaves -->
      <div class="form-group" on:click|stopPropagation>
        <label class="form-label" for="llaves-multiselect-trigger">
          Llaves ({selectedLlavesUuids.length} seleccionadas):
        </label>
        
        <div class="multiselect-container">
          <div 
            id="llaves-multiselect-trigger"
            class="multiselect-display" 
            class:open={isMultiselectOpen}
            on:click={() => isMultiselectOpen = !isMultiselectOpen}
            role="button"
            tabindex="0"
          >
            {#if selectedLlavesUuids.length === 0}
              <span class="placeholder-text">Seleccione una o varias llaves...</span>
            {:else}
              <span class="selected-count-badge">
                {selectedLlavesUuids.length} {selectedLlavesUuids.length === 1 ? 'llave seleccionada' : 'llaves seleccionadas'}
              </span>
            {/if}
            <span class="chevron-arrow">{isMultiselectOpen ? '▲' : '▼'}</span>
          </div>

          <!-- Selected Tags Preview -->
          {#if selectedLlavesUuids.length > 0}
            <div class="selected-tags-box">
              {#each selectedLlavesUuids as sUuid (sUuid)}
                <span class="llave-chip">
                  <span>{getLlaveName(sUuid)}</span>
                  <button 
                    type="button" 
                    class="chip-remove-btn" 
                    on:click|stopPropagation={() => removeLlaveTag(sUuid)}
                    title="Quitar llave"
                  >×</button>
                </span>
              {/each}
            </div>
          {/if}

          <!-- Dropdown List with Search -->
          {#if isMultiselectOpen}
            <div class="multiselect-dropdown">
              <div class="dropdown-header">
                <input 
                  type="text" 
                  class="dropdown-search-input" 
                  placeholder="Buscar llave..." 
                  bind:value={llaveSearchQuery}
                  on:click|stopPropagation
                />
                <button 
                  type="button" 
                  class="btn-toggle-all"
                  on:click|stopPropagation={toggleSelectAllLlaves}
                >
                  {selectedLlavesUuids.length === availableLlaves.length ? 'Deseleccionar todas' : 'Seleccionar todas'}
                </button>
              </div>

              <div class="dropdown-items-list">
                {#if filteredAvailableLlaves.length === 0}
                  <div class="dropdown-empty">No se encontraron llaves activas</div>
                {:else}
                  {#each filteredAvailableLlaves as k (k.uuid || k.id)}
                    {@const isChecked = selectedLlavesUuids.some(i => String(i) === String(k.uuid || k.id))}
                    <label class="dropdown-item-label" class:item-checked={isChecked}>
                      <input 
                        type="checkbox" 
                        checked={isChecked} 
                        on:change={() => toggleLlaveSelection(k.uuid || k.id)}
                        class="dropdown-checkbox"
                      />
                      <span class="item-name">{k.nombre}</span>
                    </label>
                  {/each}
                {/if}
              </div>
            </div>
          {/if}
        </div>
      </div>

      <!-- Campo Descripción (Textarea) -->
      <div class="form-group">
        <label for="input-descripcion" class="form-label">Descripción / Observación:</label>
        <textarea 
          id="input-descripcion" 
          class="form-textarea" 
          rows="3"
          placeholder="Escriba el motivo o destino (opcional, por defecto 'General')..."
          bind:value={descripcion}
        ></textarea>
      </div>

      <!-- Botón Guardar Verde -->
      {#if canAdd}
        <button 
          type="submit" 
          class="btn-guardar"
          disabled={isSaving}
        >
          {#if isSaving}
            <span>Guardando...</span>
          {:else}
            <span>Guardar Registro</span>
          {/if}
        </button>
      {/if}
    </form>
  </div>

  <!-- Tarjeta Derecha: Tabla de Control de Llaves -->
  <div class="card-table-llaves">
    <!-- Barra Superior Oscura con Sala y Fecha -->
    <div class="table-top-bar">
      <span>{tableHeaderTitle}</span>
    </div>

    <!-- Tabla de Contenido -->
    <div class="table-wrapper">
      <table class="llaves-table">
        <thead>
          <tr>
            <th class="th-center th-num">N°</th>
            <th class="th-desc">Descripción</th>
            <th class="th-center th-llaves">Llaves</th>
            <th class="th-center th-hora">Hora Salida</th>
            <th class="th-center th-hora">Hora Entrega</th>
            {#if canEdit || canDelete}
              <th class="th-center th-acciones">Acciones</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#if isLoadingRecords}
            <tr>
              <td colspan={canEdit || canDelete ? 6 : 5} class="empty-state-cell">
                <div class="loading-state-inline">
                  <div class="spinner-small"></div>
                  <span>Cargando movimientos de llaves...</span>
                </div>
              </td>
            </tr>
          {:else if records.length === 0}
            <tr>
              <td colspan={canEdit || canDelete ? 6 : 5} class="empty-state-cell">
                <div class="empty-msg-box">
                  <p class="empty-text">
                    No hay registros de control de llaves para esta fecha. Seleccione una o varias llaves en el formulario de la izquierda para registrar la entrega.
                  </p>
                </div>
              </td>
            </tr>
          {:else}
            {#each sortedRecords as record, idx}
              {@const numLlaves = record.llaves_ids ? record.llaves_ids.length : (record.llaves_detalle ? record.llaves_detalle.length : 0)}
              {@const singleLlaveName = numLlaves === 1 ? (record.llaves_detalle?.[0]?.nombre || getLlaveName(record.llaves_ids?.[0])) : ''}
              <tr class="llaves-row">
                <td class="td-center td-num">{idx + 1}</td>
                <td class="td-desc">
                  <span class="desc-text">{record.descripcion || 'General'}</span>
                </td>
                <td class="td-center">
                  {#if numLlaves === 1}
                    <button 
                      type="button" 
                      class="btn-badge-llaves btn-badge-single"
                      on:click={() => abrirModalLlaves(record)}
                      title="Ver detalle de la llave"
                    >
                      {singleLlaveName}
                    </button>
                  {:else}
                    <button 
                      type="button" 
                      class="btn-badge-llaves"
                      on:click={() => abrirModalLlaves(record)}
                      title="Ver listado de llaves asociadas"
                    >
                      {numLlaves} Llaves
                    </button>
                  {/if}
                </td>
                <td class="td-center td-hora-val">
                  <span class="time-badge time-salida">{record.hora_salida || '—'}</span>
                </td>
                <td class="td-center td-hora-val">
                  {#if record.hora_recepcion}
                    <span class="time-badge time-entregada">{record.hora_recepcion}</span>
                  {:else}
                    <span class="time-badge time-pendiente">Pendiente</span>
                  {/if}
                </td>
                {#if canEdit || canDelete}
                  <td class="td-center td-acciones">
                    <div class="acciones-btns-row">
                      {#if canEdit}
                        <button 
                          type="button" 
                          class="btn-hora-accion"
                          on:click={() => abrirModalHoras(record)}
                          title="Editar este registro"
                        >
                          Editar
                        </button>
                      {/if}
                      {#if canDelete}
                        <button 
                          type="button" 
                          class="btn-eliminar"
                          on:click={() => handleEliminar(record.uuid)}
                          title="Eliminar este registro"
                        >
                          Eliminar
                        </button>
                      {/if}
                    </div>
                  </td>
                {/if}
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- ========================================================
     MODAL 1: VER LLAVES ASOCIADAS
======================================================== -->
{#if showModalLlaves}
  <div class="modal-overlay">
    <div class="modal-box">
      <div class="modal-header">
        <div class="modal-title-left">
          <div>
            <h4 class="modal-heading">Llaves del Registro</h4>
            <span class="modal-subheading">{modalDescripcion}</span>
          </div>
        </div>
        <button type="button" class="btn-modal-close" on:click={cerrarModalLlaves}>×</button>
      </div>

      <div class="modal-body">
        {#if modalLlavesList.length === 0}
          <p class="empty-keys-txt">No se encontraron llaves detalladas.</p>
        {:else}
          <div class="modal-keys-grid">
            {#each modalLlavesList as llave, i (llave.uuid || llave.id || i)}
              <div class="modal-key-item">
                <span class="key-item-number">{i + 1}</span>
                <span class="key-item-name">{llave.nombre || (typeof llave === 'object' && llave.uuid ? `Llave #${llave.uuid.slice(0, 8)}` : `Llave #${llave}`)}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="modal-footer">
        <button type="button" class="btn-modal-primary" on:click={cerrarModalLlaves}>
          Cerrar
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ========================================================
     MODAL 2: DEFINIR O EDITAR HORAS
======================================================== -->
{#if showModalHoras && canEdit}
  <div class="modal-overlay">
    <div class="modal-box modal-box-horas">
      <div class="modal-header">
        <div class="modal-title-left">
          <div>
            <h4 class="modal-heading">Registrar Horas de Llaves</h4>
            <span class="modal-subheading">{editingRecord?.descripcion || 'General'}</span>
          </div>
        </div>
        <button type="button" class="btn-modal-close" on:click={cerrarModalHoras}>×</button>
      </div>

      <form on:submit|preventDefault={handleGuardarHoras} class="modal-form">
        <div class="modal-body">
          <div class="form-group-modal">
            <label for="m-salida" class="form-label-modal">Hora de Salida / Entrega:</label>
            <input 
              id="m-salida" 
              type="time" 
              class="form-time-input-modal" 
              bind:value={modalHoraSalida} 
              required
            />
          </div>

          <div class="form-group-modal">
            <div class="label-with-action">
              <label for="m-recepcion" class="form-label-modal">Hora de Recepción / Devolución:</label>
              <button 
                type="button" 
                class="btn-inline-now" 
                on:click={ponerHoraActualRecepcion}
                title="Establecer hora actual ahora"
              >
                ⚡ Usar hora actual
              </button>
            </div>
            <input 
              id="m-recepcion" 
              type="time" 
              class="form-time-input-modal" 
              bind:value={modalHoraRecepcion} 
            />
            <span class="field-hint">Si las llaves aún están en uso, deje este campo vacío.</span>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn-modal-cancel" on:click={cerrarModalHoras}>
            Cancelar
          </button>
          <button type="submit" class="btn-modal-save" disabled={isSavingHoras}>
            {#if isSavingHoras}
              Guardando...
            {:else}
              Guardar Horas
            {/if}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .control-llaves-grid {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 24px;
    align-items: flex-start;
    width: 100%;
    box-sizing: border-box;
  }

  @media (max-width: 1024px) {
    .control-llaves-grid {
      grid-template-columns: 1fr;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     Tarjeta Izquierda: Formulario
  ───────────────────────────────────────────────────────────── */
  .card-form-llaves {
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

  .card-title {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    color: #1e293b;
    letter-spacing: -0.2px;
  }

  .title-underline {
    margin-top: 8px;
    height: 2px;
    background: #3b82f6;
    width: 100%;
    border-radius: 2px;
  }

  .llaves-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    position: relative;
  }

  .form-label {
    font-size: 13.5px;
    font-weight: 700;
    color: #1e293b;
  }

  .field-hint {
    font-size: 11.5px;
    color: #64748b;
    margin-top: 2px;
  }

  /* Multiselect Styling */
  .multiselect-container {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .multiselect-display {
    width: 100%;
    min-height: 38px;
    padding: 8px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13px;
    background: #ffffff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: all 0.2s ease;
    box-sizing: border-box;
    user-select: none;
  }

  .multiselect-display:hover {
    border-color: #94a3b8;
  }

  .multiselect-display.open {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .placeholder-text {
    color: #94a3b8;
    font-size: 13px;
  }

  .selected-count-badge {
    font-weight: 600;
    color: #1e40af;
    font-size: 12.5px;
  }

  .chevron-arrow {
    font-size: 10px;
    color: #64748b;
    margin-left: 8px;
  }

  .selected-tags-box {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    max-height: 110px;
    overflow-y: auto;
    padding: 4px 0;
  }

  .llave-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 12px;
    font-weight: 600;
  }

  .chip-remove-btn {
    background: none;
    border: none;
    color: #ef4444;
    font-weight: 700;
    font-size: 14px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .chip-remove-btn:hover {
    color: #b91c1c;
  }

  /* Multiselect Dropdown Panel */
  .multiselect-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
    z-index: 50;
    max-height: 260px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .dropdown-header {
    padding: 8px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .dropdown-search-input {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    font-size: 12.5px;
    box-sizing: border-box;
    outline: none;
  }

  .dropdown-search-input:focus {
    border-color: #3b82f6;
  }

  .btn-toggle-all {
    background: none;
    border: none;
    color: #2563eb;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    text-align: left;
    padding: 2px 4px;
  }

  .btn-toggle-all:hover {
    text-decoration: underline;
  }

  .dropdown-items-list {
    overflow-y: auto;
    max-height: 180px;
    padding: 4px 0;
  }

  .dropdown-empty {
    padding: 16px;
    text-align: center;
    color: #64748b;
    font-size: 12.5px;
  }

  .dropdown-item-label {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 12px;
    cursor: pointer;
    font-size: 13px;
    color: #1e293b;
    transition: background 0.1s ease;
  }

  .dropdown-item-label:hover {
    background: #f1f5f9;
  }

  .dropdown-item-label.item-checked {
    background: #f0fdf4;
    color: #166534;
    font-weight: 600;
  }

  .dropdown-checkbox {
    cursor: pointer;
    width: 15px;
    height: 15px;
  }

  /* Form Elements */
  .form-textarea {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13px;
    color: #0f172a;
    background-color: #ffffff;
    outline: none;
    transition: all 0.2s ease;
    box-sizing: border-box;
    resize: vertical;
  }

  .form-textarea:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .form-time-input {
    width: 100%;
    padding: 7px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13.5px;
    color: #0f172a;
    background-color: #ffffff;
    outline: none;
    box-sizing: border-box;
    transition: all 0.2s ease;
  }

  .form-time-input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  /* Botón Guardar Verde */
  .btn-guardar {
    width: 100%;
    margin-top: 6px;
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

  /* ─────────────────────────────────────────────────────────────
     Tarjeta Derecha: Tabla
  ───────────────────────────────────────────────────────────── */
  .card-table-llaves {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  }

  /* Barra Superior Oscura */
  .table-top-bar {
    background: #54626f;
    color: #ffffff;
    font-size: 14px;
    font-weight: 700;
    text-align: center;
    padding: 12px 16px;
    letter-spacing: 0.3px;
  }

  .table-wrapper {
    overflow-x: auto;
    width: 100%;
  }

  .llaves-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    text-align: left;
  }

  /* Cabeceras Oscuras */
  .llaves-table thead tr {
    background: #2b3544;
    color: #ffffff;
  }

  .llaves-table th {
    padding: 12px 14px;
    font-size: 12.5px;
    font-weight: 700;
    letter-spacing: 0.2px;
    white-space: nowrap;
  }

  .th-center {
    text-align: center;
  }

  .th-num {
    width: 50px;
  }

  .th-desc {
    min-width: 180px;
  }

  .th-llaves {
    min-width: 120px;
  }

  .th-hora {
    min-width: 110px;
  }

  .th-acciones {
    width: 160px;
  }

  /* Filas de la Tabla */
  .llaves-row {
    border-bottom: 1px solid #f1f5f9;
    transition: background 0.15s ease;
  }

  .llaves-row:hover {
    background: #f8fafc;
  }

  .llaves-table td {
    padding: 11px 14px;
    color: #1e293b;
    font-size: 13px;
    white-space: nowrap;
  }

  .td-center {
    text-align: center;
  }

  .desc-text {
    font-weight: 600;
    color: #0f172a;
    white-space: normal;
    word-break: break-word;
    display: inline-block;
    max-width: 260px;
  }

  /* Botón Badge de Llaves */
  .btn-badge-llaves {
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
    border-radius: 20px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .btn-badge-llaves:hover {
    background: #dbeafe;
    border-color: #93c5fd;
    transform: translateY(-1px);
  }

  .btn-badge-single {
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Badges de Horas */
  .time-badge {
    display: inline-block;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12.5px;
    font-weight: 700;
  }

  .time-salida {
    background: #f1f5f9;
    color: #334155;
    border: 1px solid #cbd5e1;
  }

  .time-entregada {
    background: #f0fdf4;
    color: #166534;
    border: 1px solid #bbf7d0;
  }

  .time-pendiente {
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #fde68a;
  }

  /* Acciones */
  .acciones-btns-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .btn-hora-accion {
    background: #3b82f6;
    color: #ffffff;
    border: none;
    border-radius: 4px;
    padding: 5px 10px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-hora-accion:hover {
    background: #2563eb;
  }

  .btn-eliminar {
    background: #dc2626;
    color: #ffffff;
    border: none;
    border-radius: 4px;
    padding: 5px 10px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-eliminar:hover {
    background: #b91c1c;
  }

  /* Estados vacíos */
  .empty-state-cell {
    padding: 48px 24px !important;
    text-align: center;
    background: #fafafa;
  }

  .empty-msg-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .empty-icon {
    font-size: 32px;
  }

  .empty-text {
    font-size: 13px;
    color: #64748b;
    max-width: 480px;
    line-height: 1.5;
    margin: 0;
  }

  .loading-state-inline {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: #64748b;
    font-size: 13.5px;
  }

  .spinner-small {
    width: 18px;
    height: 18px;
    border: 2.5px solid #cbd5e1;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ─────────────────────────────────────────────────────────────
     MODALES
  ───────────────────────────────────────────────────────────── */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(15, 23, 42, 0.6);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 16px;
  }

  .modal-box {
    background: #ffffff;
    border-radius: 12px;
    width: 100%;
    max-width: 460px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: modalPop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .modal-box-horas {
    max-width: 420px;
  }

  @keyframes modalPop {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .modal-header {
    padding: 16px 20px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-title-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .modal-header-icon {
    font-size: 24px;
  }

  .modal-heading {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: #0f172a;
  }

  .modal-subheading {
    font-size: 12.5px;
    color: #64748b;
  }

  .btn-modal-close {
    background: none;
    border: none;
    font-size: 22px;
    color: #64748b;
    cursor: pointer;
    line-height: 1;
    padding: 0;
  }

  .btn-modal-close:hover {
    color: #0f172a;
  }

  .modal-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-height: 60vh;
    overflow-y: auto;
  }

  .modal-footer {
    padding: 14px 20px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
  }

  /* Modal Keys Items */
  .modal-keys-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .modal-key-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
  }

  .key-item-number {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: #3b82f6;
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    border-radius: 50%;
  }

  .key-item-name {
    font-size: 13.5px;
    font-weight: 600;
    color: #1e293b;
  }

  .empty-keys-txt {
    color: #64748b;
    font-size: 13px;
    text-align: center;
    margin: 10px 0;
  }

  /* Form Modal Horas */
  .modal-form {
    display: flex;
    flex-direction: column;
  }

  .form-group-modal {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .label-with-action {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .form-label-modal {
    font-size: 13px;
    font-weight: 700;
    color: #1e293b;
  }

  .btn-inline-now {
    background: none;
    border: none;
    color: #2563eb;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
  }

  .btn-inline-now:hover {
    text-decoration: underline;
  }

  .form-time-input-modal {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 14px;
    color: #0f172a;
    background: #ffffff;
    outline: none;
    box-sizing: border-box;
  }

  .form-time-input-modal:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .btn-modal-primary {
    padding: 8px 18px;
    background: #0f172a;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .btn-modal-primary:hover {
    background: #1e293b;
  }

  .btn-modal-cancel {
    padding: 8px 16px;
    background: #f1f5f9;
    color: #475569;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-modal-cancel:hover {
    background: #e2e8f0;
  }

  .btn-modal-save {
    padding: 8px 18px;
    background: #5bb87e;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .btn-modal-save:hover:not(:disabled) {
    background: #4ca66e;
  }

  .btn-modal-save:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }
</style>
