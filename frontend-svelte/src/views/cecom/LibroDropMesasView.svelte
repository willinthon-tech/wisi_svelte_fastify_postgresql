<script>
  import { onMount } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { 
    masterMesasStore, 
    masterSalasStore, 
    masterJuegosStore, 
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
  $: assignedSalaIds = ($authUserSalasStore && $authUserSalasStore.length > 0) 
    ? $authUserSalasStore.map(s => String(typeof s === 'object' ? (s.uuid || s.id) : s)) 
    : [];

  // Estado del formulario
  let selectedMesaId = '';
  let b100 = '';
  let b50 = '';
  let b20 = '';
  let b10 = '';
  let b5 = '';
  let b1 = '';
  let isSaving = false;

  // Lista de registros de drop
  let dropRecords = [];
  let isLoadingRecords = true;

  // Mesas cargadas del servidor o store
  let serverMesas = [];
  let isLoadingMesas = true;

  // Usuario y salas asignadas
  $: userSalasMap = $masterUserSalasStore || {};
  $: currentUserSalas = $currentUserStore?.uuid || $currentUserStore?.id ? (userSalasMap[$currentUserStore.uuid || $currentUserStore.id] || []) : [];
  $: assignedSalaUuids = (currentUserSalas.length > 0)
    ? currentUserSalas.map(s => typeof s === 'object' ? (s.uuid || s.id) : s)
    : ($authUserSalasStore && $authUserSalasStore.length > 0 ? $authUserSalasStore.map(s => s.uuid || s.id) : []);

  // Filtrado de mesas asociadas a la sala del usuario logueado y a la sala del libro
  $: availableMesas = (() => {
    const list = (serverMesas && serverMesas.length > 0) ? serverMesas : ($masterMesasStore || []);
    const targetSala = libro?.sala_uuid || libro?.sala_id;
    return list.filter(m => {
      if ((m.active ?? 1) === 0) return false;

      const mSala = m.sala_uuid || m.sala_id;
      if (targetSala && String(mSala) !== String(targetSala)) {
        return false;
      }

      if (assignedSalaUuids && assignedSalaUuids.length > 0) {
        const userSalaSet = new Set(assignedSalaUuids.map(String));
        if (!userSalaSet.has(String(mSala))) {
          return false;
        }
      }

      return true;
    });
  })();

  // Formato de opción de mesa: BJ 1 - Blackjacks
  function formatMesaOptionLabel(m) {
    const juegoName = m.juego_nombre || ($masterJuegosStore || []).find(j => String(j.uuid || j.id) === String(m.juego_uuid || m.juego_id))?.nombre || '';
    if (juegoName) {
      return `${m.nombre} - ${juegoName}`;
    }
    return m.nombre || (m.uuid ? `Mesa #${m.uuid.slice(0, 8)}` : `Mesa #${m.id}`);
  }

  // Encabezado oscuro de la tabla: Gan Casino PLC - 14/09/2026
  $: tableHeaderTitle = (() => {
    const matchedSala = ($masterSalasStore || []).find(s => 
      (libro?.sala_uuid && (s.uuid === libro.sala_uuid || s.id === libro.sala_uuid)) || 
      (libro?.sala_id && String(s.uuid || s.id) === String(libro.sala_id))
    );
    const salaName = libro?.sala_nombre || matchedSala?.nombre || libro?.sala_nombre_comercial || matchedSala?.nombre_comercial || 'Sala';
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

  // Función para obtener el total de una fila de forma robusta
  function calcRecordTotal(r) {
    if (!r) return 0;
    const t = Number(r.total);
    if (!isNaN(t) && t > 0) return t;
    const v100 = Number(r.denominacion_100 ?? r.b100 ?? 0) || 0;
    const v50 = Number(r.denominacion_50 ?? r.b50 ?? 0) || 0;
    const v20 = Number(r.denominacion_20 ?? r.b20 ?? 0) || 0;
    const v10 = Number(r.denominacion_10 ?? r.b10 ?? 0) || 0;
    const v5 = Number(r.denominacion_5 ?? r.b5 ?? 0) || 0;
    const v1 = Number(r.denominacion_1 ?? r.b1 ?? 0) || 0;
    return (v100 * 100) + (v50 * 50) + (v20 * 20) + (v10 * 10) + (v5 * 5) + (v1 * 1);
  }

  // Totales calculados en vivo para la tabla y footer
  $: sum100 = dropRecords.reduce((acc, r) => acc + (Number(r.denominacion_100 ?? r.b100 ?? 0) || 0), 0);
  $: sum50 = dropRecords.reduce((acc, r) => acc + (Number(r.denominacion_50 ?? r.b50 ?? 0) || 0), 0);
  $: sum20 = dropRecords.reduce((acc, r) => acc + (Number(r.denominacion_20 ?? r.b20 ?? 0) || 0), 0);
  $: sum10 = dropRecords.reduce((acc, r) => acc + (Number(r.denominacion_10 ?? r.b10 ?? 0) || 0), 0);
  $: sum5 = dropRecords.reduce((acc, r) => acc + (Number(r.denominacion_5 ?? r.b5 ?? 0) || 0), 0);
  $: sum1 = dropRecords.reduce((acc, r) => acc + (Number(r.denominacion_1 ?? r.b1 ?? 0) || 0), 0);

  $: totalMoney100 = sum100 * 100;
  $: totalMoney50 = sum50 * 50;
  $: totalMoney20 = sum20 * 20;
  $: totalMoney10 = sum10 * 10;
  $: totalMoney5 = sum5 * 5;
  $: totalMoney1 = sum1 * 1;

  $: grandTotal = totalMoney100 + totalMoney50 + totalMoney20 + totalMoney10 + totalMoney5 + totalMoney1;
  $: totalPiezasDrop = sum100 + sum50 + sum20 + sum10 + sum5 + sum1;

  // Totales en vivo para el formulario de la mesa actual
  $: currentMesaBilletes100 = Number(b100) || 0;
  $: currentMesaBilletes50 = Number(b50) || 0;
  $: currentMesaBilletes20 = Number(b20) || 0;
  $: currentMesaBilletes10 = Number(b10) || 0;
  $: currentMesaBilletes5 = Number(b5) || 0;
  $: currentMesaBilletes1 = Number(b1) || 0;

  $: currentMesaTotalPiezas = currentMesaBilletes100 + currentMesaBilletes50 + currentMesaBilletes20 + currentMesaBilletes10 + currentMesaBilletes5 + currentMesaBilletes1;

  $: currentMesaTotalMoney = (currentMesaBilletes100 * 100) + 
                            (currentMesaBilletes50 * 50) + 
                            (currentMesaBilletes20 * 20) + 
                            (currentMesaBilletes10 * 10) + 
                            (currentMesaBilletes5 * 5) + 
                            (currentMesaBilletes1 * 1);

  onMount(async () => {
    await Promise.all([
      loadMasterStoresFromBackend(),
      fetchServerMesas(),
      loadDropRecords()
    ]);
  });

  // Reaccionar a cambios en libroId
  $: if (libroId || libro?.id || libro?.uuid) {
    loadDropRecords();
  }

  async function fetchServerMesas() {
    isLoadingMesas = true;
    try {
      const q = new URLSearchParams({ limit: '0', active: '1' });
      if (assignedSalaIds.length > 0) {
        q.set('user_sala_ids', assignedSalaIds.join(','));
      }
      if (libro?.sala_uuid) {
        q.set('sala_uuids', String(libro.sala_uuid));
      } else if (libro?.sala_id) {
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

  async function loadDropRecords() {
    const lId = libro?.uuid || libroId || libro?.id;
    if (!lId) return;
    isLoadingRecords = true;

    // 1. Carga inmediata desde base de datos local IndexedDB (0ms)
    try {
      const local = await getLocalItems('libro_drop_mesas', r => 
        (r.libro_uuid && (String(r.libro_uuid) === String(lId) || String(r.libro_uuid) === String(libro?.uuid))) ||
        (r.libro_id && (String(r.libro_id) === String(lId) || String(r.libro_id) === String(libro?.id)))
      );
      if (Array.isArray(local) && local.length > 0) {
        dropRecords = local;
        if (selectedMesaId) {
          handleMesaChange();
        }
        isLoadingRecords = false;
      }
    } catch (e) {}

    // Si no hay conexión o estamos offline, finalizar carga local sin esperar timeout de red
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      isLoadingRecords = false;
      return;
    }

    // 2. Consulta al backend en segundo plano si hay conexión para refrescar
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`/api/master/libros/${lId}/drop-mesas`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success) {
          dropRecords = json.data || [];
          if (selectedMesaId) {
            handleMesaChange();
          }
          saveLocalItems('libro_drop_mesas', json.data).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('[LocalDb] Sin conexión al backend para drop-mesas (usando datos locales):', err);
    } finally {
      isLoadingRecords = false;
    }
  }

  // Al cambiar la mesa seleccionada, si ya tiene registro guardado, cargar sus valores
  function handleMesaChange() {
    if (!selectedMesaId) {
      limpiarCampos();
      return;
    }

    const existing = dropRecords.find(r => String(r.mesa_uuid || r.mesa_id) === String(selectedMesaId) || String(r.mesa_id) === String(selectedMesaId));
    if (existing) {
      const v100 = Number(existing.denominacion_100 ?? existing.b100 ?? 0);
      const v50 = Number(existing.denominacion_50 ?? existing.b50 ?? 0);
      const v20 = Number(existing.denominacion_20 ?? existing.b20 ?? 0);
      const v10 = Number(existing.denominacion_10 ?? existing.b10 ?? 0);
      const v5 = Number(existing.denominacion_5 ?? existing.b5 ?? 0);
      const v1 = Number(existing.denominacion_1 ?? existing.b1 ?? 0);

      // Si es 0, dejar vacío para no mostrar ceros molestos
      b100 = v100 > 0 ? v100 : '';
      b50 = v50 > 0 ? v50 : '';
      b20 = v20 > 0 ? v20 : '';
      b10 = v10 > 0 ? v10 : '';
      b5 = v5 > 0 ? v5 : '';
      b1 = v1 > 0 ? v1 : '';
    } else {
      limpiarCampos();
    }
  }

  function limpiarCampos() {
    b100 = '';
    b50 = '';
    b20 = '';
    b10 = '';
    b5 = '';
    b1 = '';
  }

  function seleccionarMesaDesdeTabla(mesaId) {
    selectedMesaId = String(mesaId);
    handleMesaChange();
  }

  let autoSaveTimeout = null;
  let isSavingAuto = false;

  // Sincronización en tiempo real conforme el usuario teclea números en el formulario
  function handleInputLive() {
    if (!selectedMesaId) return;
    syncCurrentFormToRecords(true);
  }

  function syncCurrentFormToRecords(scheduleAutoSave = true) {
    if (!selectedMesaId) return;
    const midStr = String(selectedMesaId);
    const mesaObj = availableMesas.find(m => String(m.uuid || m.id) === midStr || String(m.id) === midStr);
    const mesaUuid = mesaObj?.uuid || (midStr.length > 20 ? midStr : null);

    const existingIdx = dropRecords.findIndex(r => String(r.mesa_uuid || r.mesa_id) === midStr || String(r.mesa_id) === midStr);

    const updatedRow = {
      uuid: existingIdx >= 0 ? (dropRecords[existingIdx].uuid || generateSafeUuid()) : generateSafeUuid(),
      libro_uuid: libro?.uuid || libroId || libro?.id,
      mesa_uuid: mesaUuid,
      mesa_id: mesaUuid || midStr,
      mesa_nombre: mesaObj?.nombre || `Mesa #${midStr}`,
      denominacion_100: currentMesaBilletes100,
      denominacion_50: currentMesaBilletes50,
      denominacion_20: currentMesaBilletes20,
      denominacion_10: currentMesaBilletes10,
      denominacion_5: currentMesaBilletes5,
      denominacion_1: currentMesaBilletes1,
      b100: currentMesaBilletes100,
      b50: currentMesaBilletes50,
      b20: currentMesaBilletes20,
      b10: currentMesaBilletes10,
      b5: currentMesaBilletes5,
      b1: currentMesaBilletes1,
      total: currentMesaTotalMoney,
      updated_at: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      dropRecords[existingIdx] = updatedRow;
      dropRecords = [...dropRecords];
    } else if (currentMesaTotalPiezas > 0) {
      dropRecords = [updatedRow, ...dropRecords];
    }

    if (scheduleAutoSave && (canAdd || canEdit) && currentMesaTotalPiezas > 0) {
      if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
      autoSaveTimeout = setTimeout(() => {
        saveRecordSilently(updatedRow);
      }, 850);
    }
  }

  async function saveRecordSilently(record) {
    const lId = libro?.uuid || libroId || libro?.id;
    if (!lId || !record) return;
    try {
      isSavingAuto = true;
      await upsertLocalItem('libro_drop_mesas', record);

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(`/api/master/libros/${lId}/drop-mesas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(record),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          const json = await res.json();
          if (json?.data) {
            await upsertLocalItem('libro_drop_mesas', json.data);
          }
        }
      }
    } catch (e) {
      console.warn('[LocalDb] Error en auto-guardado silencioso de drop:', e);
    } finally {
      isSavingAuto = false;
    }
  }

  async function handleGuardar() {
    const lId = libro?.uuid || libroId || libro?.id;
    if (!lId) {
      triggerToast('No se encontró el ID del libro', 'error');
      return;
    }

    if (!selectedMesaId) {
      triggerToast('Seleccione una mesa para registrar el drop', 'warning');
      return;
    }

    if (autoSaveTimeout) clearTimeout(autoSaveTimeout);

    const midStr = String(selectedMesaId);
    const mesaObj = availableMesas.find(m => String(m.uuid || m.id) === midStr || String(m.id) === midStr);
    const mesaUuid = mesaObj?.uuid || (midStr.length > 20 ? midStr : null);
    
    const existing = dropRecords.find(r => String(r.mesa_uuid || r.mesa_id) === midStr || String(r.mesa_id) === midStr);
    const itemUuid = existing?.uuid || generateSafeUuid();

    const newRecord = {
      uuid: itemUuid,
      libro_uuid: lId,
      mesa_uuid: mesaUuid,
      mesa_id: mesaUuid || selectedMesaId,
      mesa_nombre: mesaObj?.nombre || `Mesa #${selectedMesaId}`,
      denominacion_100: currentMesaBilletes100,
      denominacion_50: currentMesaBilletes50,
      denominacion_20: currentMesaBilletes20,
      denominacion_10: currentMesaBilletes10,
      denominacion_5: currentMesaBilletes5,
      denominacion_1: currentMesaBilletes1,
      b100: currentMesaBilletes100,
      b50: currentMesaBilletes50,
      b20: currentMesaBilletes20,
      b10: currentMesaBilletes10,
      b5: currentMesaBilletes5,
      b1: currentMesaBilletes1,
      total: currentMesaTotalMoney,
      created_at: new Date().toISOString()
    };

    // 1. ACTUALIZACIÓN INSTANTÁNEA EN MEMORIA (0ms) -> UI reactiva inmediata
    dropRecords = [newRecord, ...dropRecords.filter(r => String(r.mesa_uuid || r.mesa_id) !== midStr && String(r.mesa_id) !== midStr)];

    triggerToast(`Drop de ${newRecord.mesa_nombre} guardado ($${currentMesaTotalMoney.toLocaleString()})`, 'success');

    selectedMesaId = '';
    limpiarCampos();
    isSaving = false;

    // 2. Guardado en base de datos local IndexedDB (<5ms)
    await upsertLocalItem('libro_drop_mesas', newRecord);

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

    if (isOffline) {
      // 3A. Modo Offline: Encolar de inmediato en Outbox sin tocar la red
      await queueOutboxAction({
        entity: 'libro_drop_mesas',
        action: 'create',
        endpoint: `/api/master/libros/${lId}/drop-mesas`,
        method: 'POST',
        payload: newRecord,
        uuid: itemUuid
      });
      return;
    }

    // 3B. Modo Online: Sincronización en segundo plano con timeout
    (async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(`/api/master/libros/${lId}/drop-mesas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newRecord),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const json = await res.json();
          if (json?.data) {
            await upsertLocalItem('libro_drop_mesas', json.data);
          }
        } else {
          throw new Error(`Server status ${res.status}`);
        }
      } catch (syncErr) {
        console.warn('[LocalDb] Falló sync con backend en vivo, asegurando en Outbox:', syncErr);
        await queueOutboxAction({
          entity: 'libro_drop_mesas',
          action: 'create',
          endpoint: `/api/master/libros/${lId}/drop-mesas`,
          method: 'POST',
          payload: newRecord,
          uuid: itemUuid
        });
      }
    })();
  }

  async function handleEliminar(recordOrId) {
    const recordUuid = typeof recordOrId === 'object' ? (recordOrId.uuid || recordOrId.id) : recordOrId;
    const lId = libro?.uuid || libroId || libro?.id;
    if (!lId || !recordUuid) return;

    // 1. Eliminación instantánea en memoria (0ms)
    dropRecords = dropRecords.filter(r => String(r.uuid || r.id) !== String(recordUuid));
    if (selectedMesaId && !dropRecords.some(r => String(r.mesa_uuid || r.mesa_id) === String(selectedMesaId))) {
      limpiarCampos();
    }
    triggerToast('Registro eliminado correctamente', 'info');

    // 2. Eliminación en base de datos local IndexedDB (<5ms)
    await deleteLocalItem('libro_drop_mesas', recordUuid);

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (isOffline) {
      await queueOutboxAction({
        entity: 'libro_drop_mesas',
        action: 'delete',
        endpoint: `/api/master/libros/${lId}/drop-mesas/${recordUuid}`,
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
        const res = await fetch(`/api/master/libros/${lId}/drop-mesas/${recordUuid}`, {
          method: 'DELETE',
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
      } catch (delErr) {
        console.warn('[LocalDb] Falló eliminación en vivo, encolando en Outbox:', delErr);
        await queueOutboxAction({
          entity: 'libro_drop_mesas',
          action: 'delete',
          endpoint: `/api/master/libros/${lId}/drop-mesas/${recordUuid}`,
          method: 'DELETE',
          targetId: recordUuid
        });
      }
    })();
  }
</script>

<div class="drop-layout-grid">
  <!-- Tarjeta Izquierda: Formulario "Drop de Mesas" -->
  <div class="card-form-drop">
    <div class="card-title-box">
      <h3 class="card-title">Drop de Mesas</h3>
      <div class="title-underline"></div>
    </div>

    <form on:submit|preventDefault={handleGuardar} class="drop-form">
      <!-- Selector de Mesas -->
      <div class="form-group">
        <label for="select-mesa" class="form-label">Mesas:</label>
        <select 
          id="select-mesa" 
          class="form-select" 
          bind:value={selectedMesaId}
          on:change={handleMesaChange}
          required
        >
          <option value="">Seleccione una opción</option>
          {#each availableMesas as m}
            <option value={m.uuid || m.id}>
              {formatMesaOptionLabel(m)}
            </option>
          {/each}
        </select>
      </div>

      <!-- Denominaciones de Billetes en 2 Columnas -->
      <div class="denominaciones-grid">
        <!-- Fila 1: $100 y $50 -->
        <div class="denom-field">
          <label for="denom-100" class="denom-label">$ 100:</label>
          <input 
            id="denom-100" 
            type="number" 
            min="0" 
            step="1"
            placeholder=""
            class="denom-input" 
            bind:value={b100} 
            on:input={handleInputLive}
          />
        </div>
        <div class="denom-field">
          <label for="denom-50" class="denom-label">$ 50:</label>
          <input 
            id="denom-50" 
            type="number" 
            min="0" 
            step="1"
            placeholder=""
            class="denom-input" 
            bind:value={b50} 
            on:input={handleInputLive}
          />
        </div>

        <!-- Fila 2: $20 y $10 -->
        <div class="denom-field">
          <label for="denom-20" class="denom-label">$ 20:</label>
          <input 
            id="denom-20" 
            type="number" 
            min="0" 
            step="1"
            placeholder=""
            class="denom-input" 
            bind:value={b20} 
            on:input={handleInputLive}
          />
        </div>
        <div class="denom-field">
          <label for="denom-10" class="denom-label">$ 10:</label>
          <input 
            id="denom-10" 
            type="number" 
            min="0" 
            step="1"
            placeholder=""
            class="denom-input" 
            bind:value={b10} 
            on:input={handleInputLive}
          />
        </div>

        <!-- Fila 3: $5 y $1 -->
        <div class="denom-field">
          <label for="denom-5" class="denom-label">$ 5:</label>
          <input 
            id="denom-5" 
            type="number" 
            min="0" 
            step="1"
            placeholder=""
            class="denom-input" 
            bind:value={b5} 
            on:input={handleInputLive}
          />
        </div>
        <div class="denom-field">
          <label for="denom-1" class="denom-label">$ 1:</label>
          <input 
            id="denom-1" 
            type="number" 
            min="0" 
            step="1"
            placeholder=""
            class="denom-input" 
            bind:value={b1} 
            on:input={handleInputLive}
          />
        </div>
      </div>

      <!-- Resumen en Tiempo Real de la Mesa Actual -->
      <div class="live-preview-box">
        <div class="live-preview-header">
          <div class="live-badge-group">
            <span class="live-badge">
              <span class="pulse-dot"></span> EN TIEMPO REAL
            </span>
            {#if isSavingAuto}
              <span class="saving-badge">⚡ Guardando...</span>
            {:else if selectedMesaId && currentMesaTotalMoney > 0}
              <span class="synced-badge">✓ Sincronizado</span>
            {/if}
          </div>
        </div>

        <div class="live-preview-amount">
          <span class="live-currency">$</span>
          <span class="live-number">{currentMesaTotalMoney.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>

        <div class="live-preview-stats">
          <span class="stat-pill"><b>{currentMesaTotalPiezas}</b> billetes</span>
          {#if selectedMesaId}
            {@const selMesaObj = availableMesas.find(m => String(m.uuid || m.id) === String(selectedMesaId) || String(m.id) === String(selectedMesaId))}
            <span class="mesa-pill">{selMesaObj?.nombre || 'Mesa Seleccionada'}</span>
          {:else}
            <span class="hint-pill">Seleccione mesa arriba</span>
          {/if}
        </div>
      </div>

      <!-- Botón Guardar -->
      {#if canAdd || canEdit}
        <button 
          type="submit" 
          class="btn-guardar"
          disabled={isSaving}
        >
          {#if isSaving}
            <span>Guardando...</span>
          {:else}
            <span>Guardar</span>
          {/if}
        </button>
      {/if}
    </form>
  </div>

  <!-- Tarjeta Derecha: Tabla de Drop de Mesas -->
  <div class="card-table-drop">
    <!-- Barra Superior Oscura con Sala, Fecha y Estadísticas en Vivo -->
    <div class="table-top-bar">
      <div class="top-bar-left">
        <span class="top-bar-title">{tableHeaderTitle}</span>
        <span class="top-bar-sub">Control de Drop en Vivo</span>
      </div>
      <div class="top-bar-right-stats">
        <div class="top-stat-pill">
          <span class="stat-pill-label">Mesas Drop:</span>
          <span class="stat-pill-val">{dropRecords.length} / {availableMesas.length}</span>
        </div>
        <div class="top-stat-pill">
          <span class="stat-pill-label">Total Billetes:</span>
          <span class="stat-pill-val">{totalPiezasDrop} pzs</span>
        </div>
        <div class="top-stat-pill highlight">
          <span class="stat-pill-label">Total Acumulado:</span>
          <span class="stat-pill-val">$ {grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
      </div>
    </div>

    <!-- Tabla de Contenido -->
    <div class="table-wrapper">
      <table class="drop-table">
        <thead>
          <tr>
            <th class="th-center th-num">N°</th>
            <th class="th-mesa">Mesa</th>
            <th class="th-center">$ 100</th>
            <th class="th-center">$ 50</th>
            <th class="th-center">$ 20</th>
            <th class="th-center">$ 10</th>
            <th class="th-center">$ 5</th>
            <th class="th-center">$ 1</th>
            <th class="th-center th-total">Total</th>
            {#if canEdit || canDelete}
              <th class="th-center th-acciones">Acciones</th>
            {/if}
          </tr>
        </thead>
        <tbody>
          {#if isLoadingRecords}
            <tr>
              <td colspan={canEdit || canDelete ? 10 : 9} class="empty-state-cell">
                <div class="loading-state-inline">
                  <div class="spinner-small"></div>
                  <span>Cargando registros de drop...</span>
                </div>
              </td>
            </tr>
          {:else if dropRecords.length === 0}
            <tr>
              <td colspan={canEdit || canDelete ? 10 : 9} class="empty-state-cell">
                <div class="empty-msg-box">
                  <p class="empty-text">
                    La tabla de drop está vacía para esta fecha. Seleccione una mesa en el formulario de la izquierda e ingrese los billetes para agregar registros.
                  </p>
                </div>
              </td>
            </tr>
          {:else}
            {#each dropRecords as record, idx (record.uuid || record.id || idx)}
              {@const rec100 = Number(record.denominacion_100 ?? record.b100 ?? 0) || 0}
              {@const rec50 = Number(record.denominacion_50 ?? record.b50 ?? 0) || 0}
              {@const rec20 = Number(record.denominacion_20 ?? record.b20 ?? 0) || 0}
              {@const rec10 = Number(record.denominacion_10 ?? record.b10 ?? 0) || 0}
              {@const rec5 = Number(record.denominacion_5 ?? record.b5 ?? 0) || 0}
              {@const rec1 = Number(record.denominacion_1 ?? record.b1 ?? 0) || 0}
              {@const recTotal = calcRecordTotal(record)}
              {@const mesaKey = record.mesa_uuid || record.mesa_id}
              <tr 
                class="drop-row {String(selectedMesaId) === String(mesaKey) ? 'row-selected' : ''}"
                on:click={() => seleccionarMesaDesdeTabla(mesaKey)}
                title="Haga clic para cargar y editar esta mesa"
                style="cursor: pointer;"
              >
                <td class="td-center td-num">{idx + 1}</td>
                <td class="td-mesa">{record.mesa_nombre || (record.mesa_uuid ? `Mesa #${record.mesa_uuid.slice(0, 8)}` : `Mesa #${record.mesa_id}`)}</td>
                <td class="td-center">{rec100}</td>
                <td class="td-center">{rec50}</td>
                <td class="td-center">{rec20}</td>
                <td class="td-center">{rec10}</td>
                <td class="td-center">{rec5}</td>
                <td class="td-center">{rec1}</td>
                <td class="td-center td-total-val">${recTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                {#if canEdit || canDelete}
                  <td class="td-center td-acciones">
                    <div class="acciones-btns-row">
                      {#if canEdit}
                        <button 
                          type="button" 
                          class="btn-editar-accion"
                          on:click|stopPropagation={() => seleccionarMesaDesdeTabla(mesaKey)}
                          title="Cargar y editar esta mesa"
                        >
                          Editar
                        </button>
                      {/if}
                      {#if canDelete}
                        <button 
                          type="button" 
                          class="btn-eliminar"
                          on:click|stopPropagation={() => handleEliminar(record.uuid || record.id)}
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

        <!-- Fila de Totales con línea separadora azul -->
        <tfoot>
          <tr class="divider-row">
            <td colspan={canEdit || canDelete ? 10 : 9} class="divider-cell"></td>
          </tr>
          <tr class="total-row">
            <td colspan="2" class="total-label-cell">TOTAL</td>
            <td class="td-center total-val-cell">$ {totalMoney100.toLocaleString()}</td>
            <td class="td-center total-val-cell">$ {totalMoney50.toLocaleString()}</td>
            <td class="td-center total-val-cell">$ {totalMoney20.toLocaleString()}</td>
            <td class="td-center total-val-cell">$ {totalMoney10.toLocaleString()}</td>
            <td class="td-center total-val-cell">$ {totalMoney5.toLocaleString()}</td>
            <td class="td-center total-val-cell">$ {totalMoney1.toLocaleString()}</td>
            <td class="td-center grand-total-cell">$ {grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            {#if canEdit || canDelete}
              <td class="td-center"></td>
            {/if}
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</div>

<style>
  .drop-layout-grid {
    display: grid;
    grid-template-columns: 310px 1fr;
    gap: 24px;
    align-items: flex-start;
    width: 100%;
    box-sizing: border-box;
  }

  @media (max-width: 1024px) {
    .drop-layout-grid {
      grid-template-columns: 1fr;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     Tarjeta Izquierda: Formulario
  ───────────────────────────────────────────────────────────── */
  .card-form-drop {
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

  .drop-form {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-label {
    font-size: 13.5px;
    font-weight: 700;
    color: #1e293b;
  }

  .form-select {
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
  }

  .form-select:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  /* Grilla de Denominaciones */
  .denominaciones-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px 16px;
  }

  .denom-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .denom-label {
    font-size: 13px;
    font-weight: 700;
    color: #1e293b;
  }

  .denom-input {
    width: 100%;
    padding: 7px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13.5px;
    color: #0f172a;
    background-color: #ffffff;
    outline: none;
    transition: all 0.2s ease;
    box-sizing: border-box;
  }

  .denom-input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  /* Botón Guardar Verde */
  .btn-guardar {
    width: 100%;
    margin-top: 4px;
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
     Widget en Tiempo Real de la Mesa
  ───────────────────────────────────────────────────────────── */
  .live-preview-box {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    border-radius: 8px;
    padding: 14px 16px;
    color: #ffffff;
    box-shadow: 0 4px 10px rgba(15, 23, 42, 0.15);
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .live-preview-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .live-badge-group {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    justify-content: space-between;
  }

  .live-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.5px;
    color: #38bdf8;
    text-transform: uppercase;
  }

  .pulse-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background-color: #38bdf8;
    box-shadow: 0 0 8px #38bdf8;
    animation: pulseGlow 1.5s infinite ease-in-out;
  }

  @keyframes pulseGlow {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.85); }
  }

  .saving-badge {
    font-size: 11px;
    font-weight: 600;
    color: #facc15;
    background: rgba(250, 204, 21, 0.15);
    padding: 2px 7px;
    border-radius: 10px;
  }

  .synced-badge {
    font-size: 11px;
    font-weight: 600;
    color: #4ade80;
    background: rgba(74, 222, 128, 0.15);
    padding: 2px 7px;
    border-radius: 10px;
  }

  .live-preview-amount {
    display: flex;
    align-items: baseline;
    gap: 4px;
    margin: 2px 0;
  }

  .live-currency {
    font-size: 18px;
    font-weight: 700;
    color: #94a3b8;
  }

  .live-number {
    font-size: 26px;
    font-weight: 800;
    color: #38bdf8;
    letter-spacing: -0.5px;
    line-height: 1.1;
  }

  .live-preview-stats {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: #cbd5e1;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    padding-top: 8px;
  }

  .stat-pill {
    color: #e2e8f0;
  }

  .mesa-pill {
    font-weight: 700;
    color: #67e8f9;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hint-pill {
    font-size: 11px;
    color: #94a3b8;
    font-style: italic;
  }

  /* ─────────────────────────────────────────────────────────────
     Tarjeta Derecha: Tabla
  ───────────────────────────────────────────────────────────── */
  .card-table-drop {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  }

  /* Barra Superior Oscura */
  .table-top-bar {
    background: #1e293b;
    color: #ffffff;
    padding: 12px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }

  .top-bar-left {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .top-bar-title {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.2px;
    color: #ffffff;
  }

  .top-bar-sub {
    font-size: 11px;
    color: #94a3b8;
    font-weight: 500;
  }

  .top-bar-right-stats {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .top-stat-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    padding: 5px 10px;
    font-size: 12px;
  }

  .top-stat-pill.highlight {
    background: rgba(34, 197, 94, 0.15);
    border-color: rgba(34, 197, 94, 0.35);
  }

  .stat-pill-label {
    color: #94a3b8;
    font-weight: 500;
  }

  .top-stat-pill.highlight .stat-pill-label {
    color: #86efac;
  }

  .stat-pill-val {
    color: #f8fafc;
    font-weight: 700;
  }

  .top-stat-pill.highlight .stat-pill-val {
    color: #4ade80;
    font-weight: 800;
  }

  .table-wrapper {
    overflow-x: auto;
    width: 100%;
  }

  .drop-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    text-align: left;
  }

  /* Cabeceras Oscuras */
  .drop-table thead tr {
    background: #2b3544;
    color: #ffffff;
  }

  .drop-table th {
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

  .th-mesa {
    min-width: 100px;
  }

  .th-total {
    min-width: 90px;
  }

  .th-acciones {
    width: 95px;
  }

  /* Filas de la Tabla */
  .drop-row {
    border-bottom: 1px solid #f1f5f9;
    transition: background 0.15s ease;
  }

  .drop-row:hover {
    background: #f8fafc;
  }

  .drop-row.row-selected {
    background: #e0f2fe !important;
  }

  .drop-table td {
    padding: 11px 14px;
    color: #1e293b;
    font-size: 13px;
    white-space: nowrap;
  }

  .td-center {
    text-align: center;
  }

  .td-mesa {
    font-weight: 600;
    color: #0f172a;
  }

  .td-total-val {
    font-weight: 600;
    color: #0f172a;
  }

  /* Botón Eliminar Rojo */
  .btn-eliminar {
    background: #dc2626;
    color: #ffffff;
    border: none;
    border-radius: 4px;
    padding: 5px 12px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
    box-shadow: 0 1px 2px rgba(220, 38, 38, 0.25);
  }

  .btn-eliminar:hover {
    background: #b91c1c;
  }

  /* Fila divisoria azul */
  .divider-row {
    height: 3px;
  }

  .divider-cell {
    padding: 0 !important;
    background: #3b82f6 !important;
    height: 3px;
  }

  /* Fila de Totales */
  .total-row {
    background: #f8fafc;
    font-weight: 700;
  }

  .total-row td {
    padding: 12px 14px;
    font-size: 13.5px;
    color: #0f172a;
  }

  .total-label-cell {
    font-weight: 800;
    letter-spacing: 0.5px;
    color: #0f172a;
    padding-left: 18px !important;
  }

  .total-val-cell {
    font-weight: 700;
    color: #0f172a;
  }

  .grand-total-cell {
    font-weight: 800;
    color: #16a34a !important;
    font-size: 14.5px;
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
    gap: 12px;
    max-width: 420px;
    margin: 0 auto;
  }

  .empty-icon {
    font-size: 32px;
  }

  .empty-text {
    margin: 0;
    color: #64748b;
    font-size: 13.5px;
    line-height: 1.5;
  }

  .loading-state-inline {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: #64748b;
    font-size: 13px;
  }

  .spinner-small {
    width: 18px;
    height: 18px;
    border: 2.5px solid #e2e8f0;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  /* Acciones */
  .acciones-btns-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .btn-editar-accion {
    background: #3b82f6;
    color: #ffffff;
    border: none;
    border-radius: 4px;
    padding: 5px 10px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .btn-editar-accion:hover {
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
    white-space: nowrap;
  }

  .btn-eliminar:hover {
    background: #b91c1c;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
