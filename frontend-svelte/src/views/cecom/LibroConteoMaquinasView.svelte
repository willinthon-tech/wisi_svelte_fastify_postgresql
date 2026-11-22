<script>
  import { onMount, onDestroy } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { subscribeToLibroUpdates } from '../../controllers/websocket.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { 
    masterMaquinasStore, 
    masterSalasStore, 
    masterRangosStore, 
    masterModosStore,
    masterLibrosStore,
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
  import { toBackendUrl } from '../../config/api.config.js';

  export let libro = null;
  export let libroId = null;
  export let multisalaUuid = null;

  let prevMultisala = undefined;
  let prevLibroKey = null;

  $: currentLibroKey = String(libro?.uuid || libroId || libro?.id || '');

  $: if (multisalaUuid !== prevMultisala) {
    prevMultisala = multisalaUuid;
    selectedMaquinaId = '';
    records = [];
    limpiarCampos();
    loadRecords();
  }

  $: if (currentLibroKey && currentLibroKey !== prevLibroKey) {
    prevLibroKey = currentLibroKey;
    loadRecords();
  }

  $: canEdit = $currentRoutePermissionsStore ? Boolean($currentRoutePermissionsStore.canEdit) : true;
  $: canDelete = $currentRoutePermissionsStore ? Boolean($currentRoutePermissionsStore.canDelete) : true;
  $: canAdd = $currentRoutePermissionsStore ? Boolean($currentRoutePermissionsStore.canAdd) : true;

  // Estado del formulario de conteo
  let selectedMaquinaId = '';
  let b100 = '';
  let b50 = '';
  let b20 = '';
  let b10 = '';
  let b5 = '';
  let b1 = '';
  let isSaving = false;

  // Filtro de rangos existentes en las máquinas de la sala
  let selectedRangoFilter = 'ALL';

  // Pestaña activa en la tarjeta derecha: 'detallado' | 'rangos'
  let activeTab = 'detallado';

  // Registros de conteo
  let records = [];
  let isLoadingRecords = true;

  // Modal de Edición
  let showModalEditar = false;
  let editingRecord = null;
  let modalB100 = '';
  let modalB50 = '';
  let modalB20 = '';
  let modalB10 = '';
  let modalB5 = '';
  let modalB1 = '';
  let isSavingModal = false;

  // Copias locales desde IndexedDB para disponibilidad instantánea en refresco/offline
  let localMaquinas = [];
  let localModos = [];
  let localRangos = [];
  let localLibro = null;
  let isLoadingMaquinas = true;
  let lastFetchedSala = null;

  // Cargar respaldo desde IndexedDB de inmediato
  async function loadLocalMasterData() {
    isLoadingMaquinas = true;
    try {
      const [mLocal, moLocal, rLocal] = await Promise.all([
        getLocalItems('maquinas'),
        getLocalItems('modos'),
        getLocalItems('rangos')
      ]);

      if (Array.isArray(mLocal) && mLocal.length > 0) {
        localMaquinas = mLocal;
        if ((!$masterMaquinasStore || $masterMaquinasStore.length === 0) && masterMaquinasStore?.set) {
          masterMaquinasStore.set(mLocal);
        }
      }
      if (Array.isArray(moLocal) && moLocal.length > 0) {
        localModos = moLocal;
        if ((!$masterModosStore || $masterModosStore.length === 0) && masterModosStore?.set) {
          masterModosStore.set(moLocal);
        }
      }
      if (Array.isArray(rLocal) && rLocal.length > 0) {
        localRangos = rLocal;
        if ((!$masterRangosStore || $masterRangosStore.length === 0) && masterRangosStore?.set) {
          masterRangosStore.set(rLocal);
        }
      }
    } catch (e) {
      console.warn('Error al cargar datos locales en LibroConteoMaquinas:', e);
    } finally {
      isLoadingMaquinas = false;
    }

    fetchServerMaquinas();
  }

  async function fetchServerMaquinas() {
    try {
      const currentTargetSala = targetSala;
      const qMaq = new URLSearchParams({ limit: '0', active: '1' });
      if (currentTargetSala) {
        qMaq.set('sala_ids', String(currentTargetSala));
      }

      const [resMaq, resModos, resRangos] = await Promise.all([
        fetch(toBackendUrl(`/api/master/maquinas?${qMaq.toString()}`)).catch(() => null),
        fetch(toBackendUrl(`/api/master/modos?limit=all`)).catch(() => null),
        fetch(toBackendUrl(`/api/master/rangos?limit=all`)).catch(() => null)
      ]);

      if (resMaq && resMaq.ok) {
        const json = await resMaq.json();
        if (json?.data && Array.isArray(json.data) && json.data.length > 0) {
          localMaquinas = json.data;
          if (masterMaquinasStore?.set) masterMaquinasStore.set(json.data);
        }
      }
      if (resModos && resModos.ok) {
        const json = await resModos.json();
        if (json?.data && Array.isArray(json.data) && json.data.length > 0) {
          localModos = json.data;
          if (masterModosStore?.set) masterModosStore.set(json.data);
        }
      }
      if (resRangos && resRangos.ok) {
        const json = await resRangos.json();
        if (json?.data && Array.isArray(json.data) && json.data.length > 0) {
          localRangos = json.data;
          if (masterRangosStore?.set) masterRangosStore.set(json.data);
        }
      }
    } catch (e) {
      console.warn('Error fetching server master data:', e);
    }
  }

  // Si libro aún no ha sido inyectado por el padre, recuperarlo de IndexedDB
  $: if (!libro && libroId && !localLibro) {
    getLocalItems('libros', l => String(l.uuid || l.id) === String(libroId))
      .then(res => {
        if (res && res.length > 0) localLibro = res[0];
      })
      .catch(() => {});
  }

  $: resolvedLibro = libro || localLibro || ($masterLibrosStore || []).find(l => 
    String(l.uuid || l.id) === String(libroId)
  ) || null;

  $: targetSala = resolvedLibro?.sala_uuid || resolvedLibro?.sala_id || null;

  $: if (targetSala && String(targetSala) !== String(lastFetchedSala)) {
    lastFetchedSala = targetSala;
    fetchServerMaquinas();
  }

  // Usuario y salas asignadas
  $: userSalasMap = $masterUserSalasStore || {};
  $: currentUserSalas = $currentUserStore?.uuid || $currentUserStore?.id ? (userSalasMap[$currentUserStore.uuid || $currentUserStore.id] || []) : [];
  $: assignedSalaUuids = (currentUserSalas.length > 0)
    ? currentUserSalas.map(s => typeof s === 'object' ? (s.uuid || s.id) : s)
    : ($authUserSalasStore && $authUserSalasStore.length > 0 ? $authUserSalasStore.map(s => s.uuid || s.id) : []);

  $: allMaquinasList = (localMaquinas && localMaquinas.length > 0)
    ? localMaquinas
    : ($masterMaquinasStore || []);

  $: allModosList = (localModos && localModos.length > 0)
    ? localModos
    : ($masterModosStore || []);

  $: allRangosList = (localRangos && localRangos.length > 0)
    ? localRangos
    : ($masterRangosStore || []);

  // Máquinas asociadas a la sala del libro
  $: availableMaquinas = (() => {
    const list = allMaquinasList || [];
    if (!targetSala && list.length === 0) return [];

    return list.filter(m => {
      if ((m.is_deleted || m.active === 0) && m.active !== undefined) return false;

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
    }).map(m => {
      const matchedRango = allRangosList.find(r => 
        String(r.uuid || r.id) === String(m.rango_uuid || m.rango_id)
      );
      const matchedModo = allModosList.find(mo => 
        String(mo.uuid || mo.id) === String(m.modo_uuid || m.modo_id)
      );
      return {
        ...m,
        modo_nombre: m.modo_nombre || matchedModo?.nombre || '',
        rango_nombre: m.rango_nombre || matchedRango?.nombre || 'Sin Rango'
      };
    }).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', undefined, { numeric: true }));
  })();

  // Rangos únicos presentes en las máquinas de esta sala (evita filtrar data vacía)
  $: rangosExistentes = (() => {
    const map = new Map();
    for (const m of availableMaquinas) {
      const r = m.rango_nombre || 'Sin Rango';
      map.set(r, (map.get(r) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([nombre, count]) => ({ nombre, count }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  })();

  // Máquinas filtradas según el rango seleccionado
  $: filteredAvailableMaquinas = (() => {
    if (!selectedRangoFilter || selectedRangoFilter === 'ALL') {
      return availableMaquinas;
    }
    return availableMaquinas.filter(m => (m.rango_nombre || 'Sin Rango') === selectedRangoFilter);
  })();

  // Mapa de conteos realizados en este libro/multisala (maquina_uuid -> record)
  $: conteosMap = (() => {
    const map = new Map();
    for (const r of records) {
      const mId = String(r.maquina_uuid || r.maquina_id || '');
      if (mId) map.set(mId, r);
    }
    return map;
  })();

  // Máquina actualmente seleccionada en el formulario
  $: selectedMaquinaObj = availableMaquinas.find(m => String(m.uuid || m.id) === String(selectedMaquinaId)) || null;

  // Cálculo en vivo del Total del formulario
  $: formTotal = (() => {
    const n100 = Math.max(0, parseInt(b100, 10) || 0);
    const n50 = Math.max(0, parseInt(b50, 10) || 0);
    const n20 = Math.max(0, parseInt(b20, 10) || 0);
    const n10 = Math.max(0, parseInt(b10, 10) || 0);
    const n5 = Math.max(0, parseInt(b5, 10) || 0);
    const n1 = Math.max(0, parseInt(b1, 10) || 0);
    return (n100 * 100) + (n50 * 50) + (n20 * 20) + (n10 * 10) + (n5 * 5) + (n1 * 1);
  })();

  // Cálculo en vivo del Total de la modal de edición
  $: modalTotal = (() => {
    const n100 = Math.max(0, parseInt(modalB100, 10) || 0);
    const n50 = Math.max(0, parseInt(modalB50, 10) || 0);
    const n20 = Math.max(0, parseInt(modalB20, 10) || 0);
    const n10 = Math.max(0, parseInt(modalB10, 10) || 0);
    const n5 = Math.max(0, parseInt(modalB5, 10) || 0);
    const n1 = Math.max(0, parseInt(modalB1, 10) || 0);
    return (n100 * 100) + (n50 * 50) + (n20 * 20) + (n10 * 10) + (n5 * 5) + (n1 * 1);
  })();

  // Totales generales detallado
  $: totalsDetallado = (() => {
    let t100 = 0, t50 = 0, t20 = 0, t10 = 0, t5 = 0, t1 = 0, grandTotal = 0;
    for (const r of records) {
      t100 += Number(r.denominacion_100 ?? r.b100 ?? 0) || 0;
      t50 += Number(r.denominacion_50 ?? r.b50 ?? 0) || 0;
      t20 += Number(r.denominacion_20 ?? r.b20 ?? 0) || 0;
      t10 += Number(r.denominacion_10 ?? r.b10 ?? 0) || 0;
      t5 += Number(r.denominacion_5 ?? r.b5 ?? 0) || 0;
      t1 += Number(r.denominacion_1 ?? r.b1 ?? 0) || 0;
      grandTotal += Number(r.total || 0);
    }
    return { t100, t50, t20, t10, t5, t1, grandTotal };
  })();

  // Resumen agrupado por Rango
  $: resumenPorRango = (() => {
    const groups = new Map();
    for (const r of records) {
      const rName = r.rango_nombre || 'Sin Rango';
      if (!groups.has(rName)) {
        groups.set(rName, {
          rango_nombre: rName,
          rango_uuid: r.rango_uuid || null,
          maquinasCount: 0,
          b100: 0,
          b50: 0,
          b20: 0,
          b10: 0,
          b5: 0,
          b1: 0,
          total: 0
        });
      }
      const g = groups.get(rName);
      g.maquinasCount += 1;
      g.b100 += Number(r.denominacion_100 ?? r.b100 ?? 0) || 0;
      g.b50 += Number(r.denominacion_50 ?? r.b50 ?? 0) || 0;
      g.b20 += Number(r.denominacion_20 ?? r.b20 ?? 0) || 0;
      g.b10 += Number(r.denominacion_10 ?? r.b10 ?? 0) || 0;
      g.b5 += Number(r.denominacion_5 ?? r.b5 ?? 0) || 0;
      g.b1 += Number(r.denominacion_1 ?? r.b1 ?? 0) || 0;
      g.total += Number(r.total || 0);
    }

    const list = Array.from(groups.values()).sort((a, b) => b.total - a.total);
    return list;
  })();

  // Encabezado oscuro superior: Gan Casino PLC - 14/09/2026
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

  function formatMonto(val) {
    const num = parseFloat(val);
    if (isNaN(num)) return '0.00';
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatNumber(val) {
    const num = parseInt(val, 10);
    if (isNaN(num)) return '0';
    return num.toLocaleString('en-US');
  }

  function formatMoney(num) {
    const val = Number(num) || 0;
    return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function limpiarCampos() {
    selectedMaquinaId = '';
    b100 = '';
    b50 = '';
    b20 = '';
    b10 = '';
    b5 = '';
    b1 = '';
  }

  function seleccionarMaquina(m) {
    const mId = String(m.uuid || m.id);
    selectedMaquinaId = mId;

    // Si ya existe un conteo previo para esta máquina, cargarlo en el formulario para revisión/edición
    const existing = conteosMap.get(mId);
    if (existing) {
      b100 = existing.denominacion_100 || existing.b100 || '';
      b50 = existing.denominacion_50 || existing.b50 || '';
      b20 = existing.denominacion_20 || existing.b20 || '';
      b10 = existing.denominacion_10 || existing.b10 || '';
      b5 = existing.denominacion_5 || existing.b5 || '';
      b1 = existing.denominacion_1 || existing.b1 || '';
      triggerToast(`Cargado conteo de ${m.nombre} ($${formatMonto(existing.total)})`, 'info');
    } else {
      b100 = '';
      b50 = '';
      b20 = '';
      b10 = '';
      b5 = '';
      b1 = '';
    }
  }

  // --- CARGA DE REGISTROS (OFFLINE FIRST 0ms) ---
  async function loadRecords() {
    const lId = libro?.uuid || libroId || libro?.id;
    if (!lId) return;

    // 1. Carga inmediata desde base de datos local IndexedDB (0ms)
    try {
      const local = await getLocalItems('libro_conteo_maquinas', r => 
        ((r.libro_uuid && (String(r.libro_uuid) === String(lId) || String(r.libro_uuid) === String(libro?.uuid))) ||
        (r.libro_id && (String(r.libro_id) === String(lId) || String(r.libro_id) === String(libro?.id)))) &&
        (multisalaUuid ? String(r.multisala_uuid) === String(multisalaUuid) : true)
      );
      if (Array.isArray(local) && local.length > 0) {
        records = local;
        isLoadingRecords = false;
      } else {
        records = [];
      }
    } catch (e) {
      console.warn('[LocalDb] Error leyendo libro_conteo_maquinas local:', e);
      records = [];
    }

    // 2. Sincronización en segundo plano con backend
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const fetchUrl = toBackendUrl(multisalaUuid 
        ? `/api/master/libros/${lId}/conteo-maquinas?multisala_uuid=${encodeURIComponent(multisalaUuid)}`
        : `/api/master/libros/${lId}/conteo-maquinas`);
      const res = await fetch(fetchUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const json = await res.json();
        if (json?.data && Array.isArray(json.data)) {
          const serverList = json.data;
          // Conservar registros locales pendientes para evitar que desaparezcan si aún no impactaron en BD
          const merged = [...serverList];
          for (const localRec of (records || [])) {
            const locKey = String(localRec.uuid || localRec.id || '');
            const locMaq = String(localRec.maquina_uuid || localRec.maquina_id || '');
            const exists = serverList.some(s => 
              (locKey && String(s.uuid || s.id) === locKey) ||
              (locMaq && String(s.maquina_uuid || s.maquina_id) === locMaq)
            );
            if (!exists) {
              merged.push(localRec);
            }
          }
          records = merged;
          await saveLocalItems('libro_conteo_maquinas', merged);
        }
      }
    } catch (err) {
      console.warn('[LocalDb] Sin conexión al backend para conteo máquinas, usando datos locales:', err);
    } finally {
      isLoadingRecords = false;
    }
  }

  // --- GUARDAR O ACTUALIZAR CONTEO ---
  async function handleGuardar() {
    if (!canAdd && !canEdit) {
      triggerToast('No tienes permiso para registrar conteo de máquinas', 'warning');
      return;
    }

    const lId = libro?.uuid || libroId || libro?.id;
    if (!lId) {
      triggerToast('No hay un libro activo válido', 'error');
      return;
    }

    if (!selectedMaquinaId) {
      triggerToast('Debe seleccionar una máquina', 'warning');
      return;
    }

    const n100 = Math.max(0, parseInt(b100, 10) || 0);
    const n50 = Math.max(0, parseInt(b50, 10) || 0);
    const n20 = Math.max(0, parseInt(b20, 10) || 0);
    const n10 = Math.max(0, parseInt(b10, 10) || 0);
    const n5 = Math.max(0, parseInt(b5, 10) || 0);
    const n1 = Math.max(0, parseInt(b1, 10) || 0);

    const totalCalculado = (n100 * 100) + (n50 * 50) + (n20 * 20) + (n10 * 10) + (n5 * 5) + (n1 * 1);
    if (totalCalculado <= 0) {
      triggerToast('Debe ingresar al menos una denominación con cantidad mayor a 0', 'warning');
      return;
    }

    isSaving = true;

    const targetMaquinaId = String(selectedMaquinaId);
    const maquinaObj = availableMaquinas.find(m => String(m.uuid || m.id) === targetMaquinaId);
    const itemUuid = generateSafeUuid();

    const newRecord = {
      uuid: itemUuid,
      libro_uuid: lId,
      multisala_uuid: multisalaUuid || null,
      maquina_uuid: targetMaquinaId,
      maquina_id: targetMaquinaId,
      maquina_nombre: maquinaObj?.nombre || `Máquina #${targetMaquinaId}`,
      maquina_serial: maquinaObj?.serial || '',
      rango_uuid: maquinaObj?.rango_uuid || null,
      rango_nombre: maquinaObj?.rango_nombre || 'Sin Rango',
      denominacion_100: n100,
      denominacion_50: n50,
      denominacion_20: n20,
      denominacion_10: n10,
      denominacion_5: n5,
      denominacion_1: n1,
      b100: n100,
      b50: n50,
      b20: n20,
      b10: n10,
      b5: n5,
      b1: n1,
      total: totalCalculado,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // 1. ACTUALIZACIÓN INSTANTÁNEA EN MEMORIA (0ms)
    // Si ya existía, reemplaza ese registro; si no, lo agrega
    const existingIdx = records.findIndex(r => String(r.maquina_uuid || r.maquina_id) === targetMaquinaId);
    if (existingIdx !== -1) {
      const existingUuid = records[existingIdx].uuid || records[existingIdx].id;
      newRecord.uuid = existingUuid;
      records[existingIdx] = newRecord;
      records = [...records];
    } else {
      records = [...records, newRecord];
    }

    // 2. Limpieza del formulario
    limpiarCampos();

    // 3. PERSISTENCIA EN INDEXEDDB LOCAL (<5ms)
    try {
      await upsertLocalItem('libro_conteo_maquinas', newRecord);
    } catch (dbErr) {
      console.warn('[LocalDb] Error guardando conteo local en IndexedDB:', dbErr);
    }

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    const postEndpoint = toBackendUrl(multisalaUuid
      ? `/api/master/libros/${lId}/conteo-maquinas?multisala_uuid=${encodeURIComponent(multisalaUuid)}`
      : `/api/master/libros/${lId}/conteo-maquinas`);

    if (isOffline) {
      triggerToast('Conteo guardado localmente (modo sin conexión)', 'info');
      await queueOutboxAction({
        entity: 'libro_conteo_maquinas',
        action: 'create',
        endpoint: postEndpoint,
        method: 'POST',
        payload: newRecord,
        uuid: newRecord.uuid
      });
      isSaving = false;
      return;
    }

    // 4. SINCRONIZACIÓN CON EL BACKEND
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(postEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRecord),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const json = await res.json();
        if (json?.data) {
          records = records.map(r => (String(r.uuid || r.id) === String(newRecord.uuid) || String(r.maquina_uuid || r.maquina_id) === targetMaquinaId) ? { ...newRecord, ...json.data } : r);
          await upsertLocalItem('libro_conteo_maquinas', json.data);
        }
        triggerToast('Conteo de máquina guardado con éxito', 'success');
      } else {
        const errJson = await res.json().catch(() => null);
        const errMsg = errJson?.error || errJson?.message || `Error del servidor (${res.status})`;
        console.warn('[handleGuardar] Error del backend:', errMsg);
        triggerToast(`Error al guardar en servidor: ${errMsg}`, 'warning');
        throw new Error(errMsg);
      }
    } catch (syncErr) {
      console.warn('[LocalDb] Falló sync con backend en vivo, asegurando en Outbox:', syncErr);
      await queueOutboxAction({
        entity: 'libro_conteo_maquinas',
        action: 'create',
        endpoint: postEndpoint,
        method: 'POST',
        payload: newRecord,
        uuid: newRecord.uuid
      });
    } finally {
      isSaving = false;
    }
  }

  // --- ELIMINAR CONTEO ---
  async function handleEliminar(record) {
    if (!canDelete) {
      triggerToast('No tienes permiso para eliminar registros en este módulo', 'warning');
      return;
    }

    if (!confirm(`¿Está seguro de eliminar el conteo de la máquina ${record.maquina_nombre || ''}?`)) {
      return;
    }

    const lId = libro?.uuid || libroId || libro?.id;
    const recordUuid = record.uuid || record.id;

    // 1. Eliminación instantánea en memoria (0ms)
    records = records.filter(r => String(r.uuid || r.id) !== String(recordUuid));
    triggerToast('Conteo eliminado correctamente', 'info');

    // 2. Eliminación en base de datos local IndexedDB (<5ms)
    try {
      await deleteLocalItem('libro_conteo_maquinas', recordUuid);
    } catch (delDbErr) {
      console.warn('[LocalDb] Error eliminando conteo local en IndexedDB:', delDbErr);
    }

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    const delEndpoint = toBackendUrl(`/api/master/libros/${lId}/conteo-maquinas/${recordUuid}`);

    if (isOffline) {
      await queueOutboxAction({
        entity: 'libro_conteo_maquinas',
        action: 'delete',
        endpoint: delEndpoint,
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
        const res = await fetch(delEndpoint, {
          method: 'DELETE',
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
      } catch (delErr) {
        console.warn('[LocalDb] Falló eliminación en vivo, encolando en Outbox:', delErr);
        await queueOutboxAction({
          entity: 'libro_conteo_maquinas',
          action: 'delete',
          endpoint: delEndpoint,
          method: 'DELETE',
          targetId: recordUuid
        });
      }
    })();
  }

  // --- MODAL DE EDICIÓN ---
  function abrirModalEditar(record) {
    if (!canEdit) {
      triggerToast('No tienes permiso para editar registros', 'warning');
      return;
    }
    editingRecord = record;
    modalB100 = record.denominacion_100 || record.b100 || '';
    modalB50 = record.denominacion_50 || record.b50 || '';
    modalB20 = record.denominacion_20 || record.b20 || '';
    modalB10 = record.denominacion_10 || record.b10 || '';
    modalB5 = record.denominacion_5 || record.b5 || '';
    modalB1 = record.denominacion_1 || record.b1 || '';
    showModalEditar = true;
  }

  function cerrarModalEditar() {
    showModalEditar = false;
    editingRecord = null;
    modalB100 = '';
    modalB50 = '';
    modalB20 = '';
    modalB10 = '';
    modalB5 = '';
    modalB1 = '';
  }

  async function handleGuardarEdicion() {
    if (!canEdit) {
      triggerToast('No tienes permiso para editar registros', 'warning');
      return;
    }
    const lId = libro?.uuid || libroId || libro?.id;
    if (!lId || !editingRecord) return;

    const n100 = Math.max(0, parseInt(modalB100, 10) || 0);
    const n50 = Math.max(0, parseInt(modalB50, 10) || 0);
    const n20 = Math.max(0, parseInt(modalB20, 10) || 0);
    const n10 = Math.max(0, parseInt(modalB10, 10) || 0);
    const n5 = Math.max(0, parseInt(modalB5, 10) || 0);
    const n1 = Math.max(0, parseInt(modalB1, 10) || 0);

    const totalCalculado = (n100 * 100) + (n50 * 50) + (n20 * 20) + (n10 * 10) + (n5 * 5) + (n1 * 1);
    if (totalCalculado <= 0) {
      triggerToast('Debe ingresar al menos una denominación mayor a 0', 'warning');
      return;
    }

    const targetUuid = editingRecord.uuid || editingRecord.id;
    const payload = {
      ...editingRecord,
      denominacion_100: n100,
      denominacion_50: n50,
      denominacion_20: n20,
      denominacion_10: n10,
      denominacion_5: n5,
      denominacion_1: n1,
      b100: n100,
      b50: n50,
      b20: n20,
      b10: n10,
      b5: n5,
      b1: n1,
      total: totalCalculado,
      updated_at: new Date().toISOString()
    };

    // 1. Actualización instantánea en memoria
    records = records.map(r => String(r.uuid || r.id) === String(targetUuid) ? payload : r);
    cerrarModalEditar();
    triggerToast('Conteo actualizado exitosamente', 'success');

    // 2. Guardado en IndexedDB local
    try {
      await upsertLocalItem('libro_conteo_maquinas', payload);
    } catch (e) {
      console.warn('[handleGuardarEdicion] Error guardando local:', e);
    }

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    const putEndpoint = toBackendUrl(`/api/master/libros/${lId}/conteo-maquinas/${targetUuid}`);
    const postEndpoint = toBackendUrl(multisalaUuid
      ? `/api/master/libros/${lId}/conteo-maquinas?multisala_uuid=${encodeURIComponent(multisalaUuid)}`
      : `/api/master/libros/${lId}/conteo-maquinas`);

    if (isOffline) {
      await queueOutboxAction({
        entity: 'libro_conteo_maquinas',
        action: 'update',
        endpoint: putEndpoint,
        method: 'PUT',
        payload: payload,
        uuid: targetUuid
      });
      return;
    }

    isSavingModal = true;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      let res = await fetch(putEndpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const c2 = new AbortController();
        const t2 = setTimeout(() => c2.abort(), 8000);
        res = await fetch(postEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: c2.signal
        });
        clearTimeout(t2);
      }

      if (res.ok) {
        const json = await res.json();
        if (json?.data) {
          records = records.map(r => String(r.uuid || r.id) === String(targetUuid) ? { ...payload, ...json.data } : r);
          await upsertLocalItem('libro_conteo_maquinas', json.data);
        }
      }
    } catch (editErr) {
      console.warn('[LocalDb] Falló edición en vivo, encolando en Outbox:', editErr);
      await queueOutboxAction({
        entity: 'libro_conteo_maquinas',
        action: 'create',
        endpoint: postEndpoint,
        method: 'POST',
        payload: payload,
        uuid: targetUuid
      });
    } finally {
      isSavingModal = false;
    }
  }

  let unsubWs = null;

  onMount(async () => {
    unsubWs = subscribeToLibroUpdates(
      () => [libro?.uuid, libroId, libro?.id].filter(Boolean),
      ['conteo_maquinas'],
      () => {
        loadRecords();
      }
    );
    loadLocalMasterData();
    loadMasterStoresFromBackend().catch(() => {});
    loadRecords();
  });

  onDestroy(() => {
    if (unsubWs) unsubWs();
  });
</script>

<div class="conteo-maquinas-wrapper">

  <!-- ═══════════════════════════════════════════════════════════════
       SECCIÓN SUPERIOR: LISTADO VISUAL DE MÁQUINAS DE LA SALA ("Arriba de eso")
       ═══════════════════════════════════════════════════════════════ -->
  <div class="top-maquinas-shelf-card">
    <div class="shelf-header">
      <div class="shelf-header-left">
        <h4 class="shelf-title">
          Máquinas de la Sala
          <span class="shelf-count-badge">
            {conteosMap.size} / {availableMaquinas.length} contadas
          </span>
          {#if selectedRangoFilter !== 'ALL'}
            <span class="active-filter-tag">{selectedRangoFilter} ({filteredAvailableMaquinas.length})</span>
          {/if}
        </h4>
        <span class="shelf-subtitle">
          Haga clic sobre una máquina para seleccionarla e ingresar su conteo
        </span>
      </div>

      <!-- Filtro por Rangos Existentes (Dónde indicó el usuario) -->
      {#if rangosExistentes.length > 0}
        <div class="shelf-rangos-filter-bar">
          <button 
            type="button" 
            class="rango-filter-pill {selectedRangoFilter === 'ALL' ? 'active' : ''}"
            on:click={() => selectedRangoFilter = 'ALL'}
          >
            <span>Todos</span>
            <span class="pill-count">({availableMaquinas.length})</span>
          </button>
          {#each rangosExistentes as rg}
            <button 
              type="button" 
              class="rango-filter-pill {selectedRangoFilter === rg.nombre ? 'active' : ''}"
              on:click={() => selectedRangoFilter = rg.nombre}
            >
              <span>{rg.nombre}</span>
              <span class="pill-count">({rg.count})</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Carrusel / Fila de Máquinas -->
    {#if (isLoadingMaquinas || !targetSala) && availableMaquinas.length === 0}
      <div class="shelf-empty">
        Cargando máquinas de la sala...
      </div>
    {:else if availableMaquinas.length === 0}
      <div class="shelf-empty">
        No hay máquinas asociadas a esta sala.
      </div>
    {:else if filteredAvailableMaquinas.length === 0}
      <div class="shelf-empty">
        No se encontraron máquinas para el rango "{selectedRangoFilter}".
      </div>
    {:else}
      <div class="maquinas-grid-scroll">
        {#each filteredAvailableMaquinas as maq}
          {@const yaContada = conteosMap.get(String(maq.uuid || maq.id))}
          {@const isSelected = String(selectedMaquinaId) === String(maq.uuid || maq.id)}
          <button
            type="button"
            class="maquina-chip-card {isSelected ? 'selected' : ''} {yaContada ? 'status-contada' : 'status-pendiente'}"
            on:click={() => seleccionarMaquina(maq)}
            title="Seleccionar máquina {maq.nombre}"
          >
            <div class="chip-row-top">
              <span class="chip-maquina-nombre">{maq.nombre}</span>
              {#if yaContada}
                <span class="chip-badge-done">✓ ${formatMonto(yaContada.total)}</span>
              {:else}
                <span class="chip-badge-pend">Pendiente</span>
              {/if}
            </div>
            <div class="chip-row-bottom">
              <span class="chip-rango-tag">{maq.rango_nombre || 'Sin Rango'}</span>
              {#if maq.serial}
                <span class="chip-serial-text">S/N: {maq.serial}</span>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <!-- ═══════════════════════════════════════════════════════════════
       LAYOUT PRINCIPAL: FORMULARIO A LA IZQUIERDA Y TABLA A LA DERECHA
       ═══════════════════════════════════════════════════════════════ -->
  <div class="conteo-layout-grid">
    
    <!-- TARJETA IZQUIERDA: FORMULARIO DE BILLETERO -->
    <div class="card-form-conteo">
      <div class="card-title-box">
        <h3 class="card-title">Billetero</h3>
        <div class="title-underline"></div>
      </div>

      <form on:submit|preventDefault={handleGuardar} class="conteo-form" autocomplete="off">
        
        {#if selectedMaquinaObj}
          <!-- Banner destacado de la máquina seleccionada -->
          <div class="selected-maquina-card">
            <div class="sel-card-header">
              <span class="sel-indicator-dot"></span>
              <span class="sel-label">MÁQUINA SELECCIONADA</span>
              <span class="sel-rango-pill">{selectedMaquinaObj.rango_nombre}</span>
            </div>
            <div class="sel-maq-name">{selectedMaquinaObj.nombre}</div>
            {#if selectedMaquinaObj.serial}
              <div class="sel-maq-serial">S/N: {selectedMaquinaObj.serial}</div>
            {/if}
          </div>
        {:else}
          <!-- Mensaje orientador para seleccionar una máquina de la sección superior -->
          <div class="no-maquina-hint-card">
            <span class="hint-icon">👆</span>
            <div class="hint-body">
              <strong class="hint-title">Seleccione una máquina</strong>
              <span class="hint-desc">Haga clic sobre cualquiera de las máquinas de la lista superior para ingresar su conteo.</span>
            </div>
          </div>
        {/if}

        <!-- Grilla de Denominaciones: $100, $50, $20, $10, $5, $1 -->
        <div class="denominaciones-grid">
          <div class="denom-field">
            <label for="c-b100" class="denom-label">$ 100:</label>
            <input 
              id="c-b100" 
              type="number" 
              min="0" 
              step="1" 
              placeholder="0" 
              class="denom-input" 
              bind:value={b100} 
            />
          </div>

          <div class="denom-field">
            <label for="c-b50" class="denom-label">$ 50:</label>
            <input 
              id="c-b50" 
              type="number" 
              min="0" 
              step="1" 
              placeholder="0" 
              class="denom-input" 
              bind:value={b50} 
            />
          </div>

          <div class="denom-field">
            <label for="c-b20" class="denom-label">$ 20:</label>
            <input 
              id="c-b20" 
              type="number" 
              min="0" 
              step="1" 
              placeholder="0" 
              class="denom-input" 
              bind:value={b20} 
            />
          </div>

          <div class="denom-field">
            <label for="c-b10" class="denom-label">$ 10:</label>
            <input 
              id="c-b10" 
              type="number" 
              min="0" 
              step="1" 
              placeholder="0" 
              class="denom-input" 
              bind:value={b10} 
            />
          </div>

          <div class="denom-field">
            <label for="c-b5" class="denom-label">$ 5:</label>
            <input 
              id="c-b5" 
              type="number" 
              min="0" 
              step="1" 
              placeholder="0" 
              class="denom-input" 
              bind:value={b5} 
            />
          </div>

          <div class="denom-field">
            <label for="c-b1" class="denom-label">$ 1:</label>
            <input 
              id="c-b1" 
              type="number" 
              min="0" 
              step="1" 
              placeholder="0" 
              class="denom-input" 
              bind:value={b1} 
            />
          </div>
        </div>

        <!-- Total calculado en vivo -->
        <div class="form-total-box">
          <span class="total-box-label">Total Conteo:</span>
          <span class="total-box-val">${formatMonto(formTotal)}</span>
        </div>

        <!-- Botones de Acción -->
        <div class="form-buttons-row">
          <button 
            type="submit" 
            class="btn-guardar" 
            disabled={isSaving || !selectedMaquinaId}
          >
            {#if isSaving}
              Guardando...
            {:else}
              {conteosMap.has(String(selectedMaquinaId)) ? 'Actualizar Conteo' : 'Guardar'}
            {/if}
          </button>
          {#if selectedMaquinaId || b100 || b50 || b20 || b10 || b5 || b1}
            <button 
              type="button" 
              class="btn-limpiar" 
              on:click={limpiarCampos}
            >
              Limpiar
            </button>
          {/if}
        </div>
      </form>
    </div>

    <!-- TARJETA DERECHA: TABLA CON PESTAÑAS (DETALLADO Y RESUMEN POR RANGO) -->
    <div class="card-table-conteo">
      
      <!-- Encabezado Oscuro Superior (Idéntico a Drop Mesas y Aportes) -->
      <div class="table-header-dark">
        <h4 class="dark-header-title">{tableHeaderTitle}</h4>
      </div>

      <!-- Pestañas Superiores: Detallado de Operaciones / Resumen por Rango -->
      <div class="resumen-tabs-header">
        <div class="tabs-nav-list">
          <button 
            type="button" 
            class="tab-nav-btn {activeTab === 'detallado' ? 'active' : ''}"
            on:click={() => activeTab = 'detallado'}
          >
            <span>Detallado de Operaciones ({records.length})</span>
          </button>
          <button 
            type="button" 
            class="tab-nav-btn {activeTab === 'rangos' ? 'active' : ''}"
            on:click={() => activeTab = 'rangos'}
          >
            <span>Resumen por Rango ({resumenPorRango.length})</span>
          </button>
        </div>
      </div>

      <!-- CONTENIDO PESTAÑA 1: DETALLADO DE OPERACIONES -->
      {#if activeTab === 'detallado'}
        <div class="table-wrapper">
          <table class="conteo-table">
            <thead>
              <tr>
                <th class="th-num">N°</th>
                <th class="th-maquina">Máquina</th>
                <th class="th-denom">$ 100</th>
                <th class="th-denom">$ 50</th>
                <th class="th-denom">$ 20</th>
                <th class="th-denom">$ 10</th>
                <th class="th-denom">$ 5</th>
                <th class="th-denom">$ 1</th>
                <th class="th-total">Total</th>
                {#if canDelete}
                  <th class="th-acciones">Acciones</th>
                {/if}
              </tr>
            </thead>
            <tbody>
              {#if isLoadingRecords}
                <tr>
                  <td colspan={canDelete ? 10 : 9} class="td-empty">Cargando registros...</td>
                </tr>
              {:else if records.length === 0}
                <tr>
                  <td colspan={canDelete ? 10 : 9} class="td-empty">No hay conteos de máquinas registrados en esta jornada.</td>
                </tr>
              {:else}
                {#each records as record, index (record.uuid || record.id || index)}
                  <tr 
                    class="tr-record-item"
                    title="Haga clic para cargar en el formulario superior"
                    on:click={() => {
                      const match = availableMaquinas.find(m => String(m.uuid || m.id) === String(record.maquina_uuid || record.maquina_id));
                      if (match) {
                        seleccionarMaquina(match);
                      } else {
                        abrirModalEditar(record);
                      }
                    }}
                  >
                    <td class="td-center td-index">{index + 1}</td>
                    <td class="td-left td-maquina-cell">
                      <div class="maquina-info-box">
                        <span class="maquina-title font-bold">{record.maquina_nombre || 'Máquina'}</span>
                        <span class="rango-sub-pill">{record.rango_nombre || 'Sin Rango'}</span>
                      </div>
                    </td>
                    <td class="td-center">{record.denominacion_100 ?? record.b100 ?? 0}</td>
                    <td class="td-center">{record.denominacion_50 ?? record.b50 ?? 0}</td>
                    <td class="td-center">{record.denominacion_20 ?? record.b20 ?? 0}</td>
                    <td class="td-center">{record.denominacion_10 ?? record.b10 ?? 0}</td>
                    <td class="td-center">{record.denominacion_5 ?? record.b5 ?? 0}</td>
                    <td class="td-center">{record.denominacion_1 ?? record.b1 ?? 0}</td>
                    <td class="td-right td-total-cell font-bold">
                      ${formatMonto(record.total)}
                    </td>
                    {#if canDelete}
                      <td class="td-center td-acciones-cell" on:click|stopPropagation>
                        <div class="acciones-btn-group">
                          <button 
                            type="button" 
                            class="btn-action-delete"
                            on:click={() => handleEliminar(record)}
                            title="Eliminar conteo"
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    {/if}
                  </tr>
                {/each}
              {/if}
            </tbody>
            {#if records.length > 0}
              <tfoot>
                <tr class="tfoot-totals-row">
                  <td colspan="2" class="td-foot-label font-bold">TOTAL</td>
                  <td class="td-center font-bold">${formatNumber(totalsDetallado.t100 * 100)}</td>
                  <td class="td-center font-bold">${formatNumber(totalsDetallado.t50 * 50)}</td>
                  <td class="td-center font-bold">${formatNumber(totalsDetallado.t20 * 20)}</td>
                  <td class="td-center font-bold">${formatNumber(totalsDetallado.t10 * 10)}</td>
                  <td class="td-center font-bold">${formatNumber(totalsDetallado.t5 * 5)}</td>
                  <td class="td-center font-bold">${formatNumber(totalsDetallado.t1 * 1)}</td>
                  <td class="td-right td-foot-grand font-bold">${formatMonto(totalsDetallado.grandTotal)}</td>
                  {#if canDelete}
                    <td></td>
                  {/if}
                </tr>
              </tfoot>
            {/if}
          </table>
        </div>

      <!-- CONTENIDO PESTAÑA 2: RESUMEN POR RANGO -->
      {:else if activeTab === 'rangos'}
        <div class="table-wrapper">
          <table class="conteo-table">
            <thead>
              <tr>
                <th class="th-num">N°</th>
                <th class="th-maquina">Rango</th>
                <th class="th-center">Máquinas</th>
                <th class="th-denom">$ 100</th>
                <th class="th-denom">$ 50</th>
                <th class="th-denom">$ 20</th>
                <th class="th-denom">$ 10</th>
                <th class="th-denom">$ 5</th>
                <th class="th-denom">$ 1</th>
                <th class="th-total">Total en Dinero</th>
                <th class="th-center">% Conteo</th>
              </tr>
            </thead>
            <tbody>
              {#if resumenPorRango.length === 0}
                <tr>
                  <td colspan="11" class="td-empty">No hay datos para agrupar por rango todavía.</td>
                </tr>
              {:else}
                {#each resumenPorRango as item, idx}
                  {@const pct = totalsDetallado.grandTotal > 0 ? ((item.total / totalsDetallado.grandTotal) * 100).toFixed(1) : '0'}
                  <tr>
                    <td class="td-center td-index">{idx + 1}</td>
                    <td class="td-left font-bold td-rango-cell">
                      <span class="badge-rango-group">{item.rango_nombre}</span>
                    </td>
                    <td class="td-center font-bold">{item.maquinasCount} maq</td>
                    <td class="td-center">{item.b100}</td>
                    <td class="td-center">{item.b50}</td>
                    <td class="td-center">{item.b20}</td>
                    <td class="td-center">{item.b10}</td>
                    <td class="td-center">{item.b5}</td>
                    <td class="td-center">{item.b1}</td>
                    <td class="td-right td-total-cell font-bold">${formatMonto(item.total)}</td>
                    <td class="td-center font-bold tag-pct">{pct}%</td>
                  </tr>
                {/each}
              {/if}
            </tbody>
            {#if resumenPorRango.length > 0}
              <tfoot>
                <tr class="tfoot-totals-row">
                  <td colspan="2" class="td-foot-label font-bold">TOTAL GENERAL</td>
                  <td class="td-center font-bold">{records.length} maq</td>
                  <td class="td-center font-bold">${formatNumber(totalsDetallado.t100 * 100)}</td>
                  <td class="td-center font-bold">${formatNumber(totalsDetallado.t50 * 50)}</td>
                  <td class="td-center font-bold">${formatNumber(totalsDetallado.t20 * 20)}</td>
                  <td class="td-center font-bold">${formatNumber(totalsDetallado.t10 * 10)}</td>
                  <td class="td-center font-bold">${formatNumber(totalsDetallado.t5 * 5)}</td>
                  <td class="td-center font-bold">${formatNumber(totalsDetallado.t1 * 1)}</td>
                  <td class="td-right td-foot-grand font-bold">${formatMonto(totalsDetallado.grandTotal)}</td>
                  <td class="td-center font-bold">100%</td>
                </tr>
              </tfoot>
            {/if}
          </table>
        </div>
      {/if}

    </div>
  </div>

</div>

<!-- ═══════════════════════════════════════════════════════════════
     MODAL PARA EDITAR CONTEO DE MÁQUINA
     ═══════════════════════════════════════════════════════════════ -->
{#if showModalEditar && editingRecord}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" on:click|self={cerrarModalEditar}>
    <div class="modal-card">
      <div class="modal-header">
        <h4 class="modal-title">Editar Conteo: {editingRecord.maquina_nombre}</h4>
        <button type="button" class="btn-modal-close" on:click={cerrarModalEditar}>×</button>
      </div>

      <form on:submit|preventDefault={handleGuardarEdicion} class="modal-body">
        <div class="modal-maquina-banner">
          <span class="m-maq-name">{editingRecord.maquina_nombre}</span>
          <span class="m-maq-rango">{editingRecord.rango_nombre}</span>
        </div>

        <div class="denominaciones-grid modal-denoms-grid">
          <div class="denom-field">
            <label for="m-b100" class="denom-label">$ 100:</label>
            <input id="m-b100" type="number" min="0" step="1" class="denom-input" bind:value={modalB100} />
          </div>
          <div class="denom-field">
            <label for="m-b50" class="denom-label">$ 50:</label>
            <input id="m-b50" type="number" min="0" step="1" class="denom-input" bind:value={modalB50} />
          </div>
          <div class="denom-field">
            <label for="m-b20" class="denom-label">$ 20:</label>
            <input id="m-b20" type="number" min="0" step="1" class="denom-input" bind:value={modalB20} />
          </div>
          <div class="denom-field">
            <label for="m-b10" class="denom-label">$ 10:</label>
            <input id="m-b10" type="number" min="0" step="1" class="denom-input" bind:value={modalB10} />
          </div>
          <div class="denom-field">
            <label for="m-b5" class="denom-label">$ 5:</label>
            <input id="m-b5" type="number" min="0" step="1" class="denom-input" bind:value={modalB5} />
          </div>
          <div class="denom-field">
            <label for="m-b1" class="denom-label">$ 1:</label>
            <input id="m-b1" type="number" min="0" step="1" class="denom-input" bind:value={modalB1} />
          </div>
        </div>

        <div class="modal-total-display">
          <span>Nuevo Total:</span>
          <span class="modal-total-value">${formatMonto(modalTotal)}</span>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn-modal-cancel" on:click={cerrarModalEditar}>
            Cancelar
          </button>
          <button type="submit" class="btn-modal-save" disabled={isSavingModal}>
            Guardar Cambios
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .conteo-maquinas-wrapper {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
    box-sizing: border-box;
  }

  /* ─────────────────────────────────────────────────────────────
     SECCIÓN SUPERIOR: SHELF DE MÁQUINAS ("Arriba de eso")
     ───────────────────────────────────────────────────────────── */
  .top-maquinas-shelf-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 16px 20px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .shelf-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }

  .shelf-header-left {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .shelf-title {
    margin: 0;
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .shelf-count-badge {
    background: #eff6ff;
    color: #2563eb;
    border: 1px solid #bfdbfe;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11.5px;
    font-weight: 700;
  }

  .shelf-subtitle {
    font-size: 12px;
    color: #64748b;
  }

  .active-filter-tag {
    font-size: 11px;
    font-weight: 700;
    color: #1e40af;
    background: #dbeafe;
    padding: 2px 7px;
    border-radius: 10px;
    border: 1px solid #93c5fd;
  }

  /* Barra de Filtros de Rangos Existentes (Dónde indicó el usuario) */
  .shelf-rangos-filter-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
    max-width: 60%;
  }

  .rango-filter-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 11px;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    color: #475569;
    border-radius: 20px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .rango-filter-pill:hover {
    background: #e2e8f0;
    color: #0f172a;
    border-color: #94a3b8;
  }

  .rango-filter-pill.active {
    background: #2563eb;
    color: #ffffff;
    border-color: #1d4ed8;
    box-shadow: 0 2px 4px rgba(37, 99, 235, 0.25);
  }

  .rango-filter-pill .pill-count {
    font-size: 10px;
    opacity: 0.85;
  }

  .shelf-empty {
    font-size: 13px;
    color: #94a3b8;
    padding: 12px;
    text-align: center;
    background: #f8fafc;
    border-radius: 8px;
  }

  /* Carrusel / Grid Horizontal Scrollable de Máquinas */
  .maquinas-grid-scroll {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 10px;
    max-height: 220px;
    overflow-y: auto;
    padding-right: 4px;
  }

  .maquinas-grid-scroll::-webkit-scrollbar {
    width: 6px;
  }
  .maquinas-grid-scroll::-webkit-scrollbar-thumb {
    background: #cbd5e1;
    border-radius: 4px;
  }

  .maquina-chip-card {
    background: #f8fafc;
    border: 1.5px solid #e2e8f0;
    border-radius: 8px;
    padding: 9px 12px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    text-align: left;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .maquina-chip-card:hover {
    background: #ffffff;
    border-color: #94a3b8;
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
  }

  .maquina-chip-card.selected {
    background: #eff6ff;
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
  }

  .maquina-chip-card.status-contada {
    border-left: 4px solid #10b981;
  }

  .maquina-chip-card.status-pendiente {
    border-left: 4px solid #f59e0b;
  }

  .chip-row-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .chip-maquina-nombre {
    font-size: 13px;
    font-weight: 800;
    color: #0f172a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chip-badge-done {
    font-size: 10.5px;
    font-weight: 800;
    color: #065f46;
    background: #d1fae5;
    padding: 1px 6px;
    border-radius: 4px;
    white-space: nowrap;
  }

  .chip-badge-pend {
    font-size: 10.5px;
    font-weight: 700;
    color: #92400e;
    background: #fef3c7;
    padding: 1px 6px;
    border-radius: 4px;
    white-space: nowrap;
  }

  .chip-row-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    font-size: 11px;
  }

  .chip-rango-tag {
    color: #475569;
    font-weight: 600;
    background: #e2e8f0;
    padding: 1px 5px;
    border-radius: 3px;
  }

  .chip-serial-text {
    color: #94a3b8;
    font-size: 10.5px;
  }

  /* ─────────────────────────────────────────────────────────────
     LAYOUT PRINCIPAL
     ───────────────────────────────────────────────────────────── */
  .conteo-layout-grid {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 20px;
    align-items: flex-start;
    width: 100%;
    box-sizing: border-box;
  }

  @media (max-width: 1024px) {
    .conteo-layout-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Tarjeta Izquierda */
  .card-form-conteo {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 22px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  .card-title-box {
    margin-bottom: 18px;
  }

  .card-title {
    margin: 0;
    font-size: 17px;
    font-weight: 800;
    color: #0f172a;
  }

  .title-underline {
    width: 100%;
    height: 2px;
    background-color: #3b82f6;
    margin-top: 6px;
    border-radius: 2px;
  }

  .conteo-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* Tarjeta de Máquina Seleccionada en el Formulario */
  .selected-maquina-card {
    background: #f8fafc;
    border: 1.5px solid #3b82f6;
    border-radius: 8px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-shadow: 0 1px 4px rgba(59, 130, 246, 0.1);
  }

  .sel-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    font-weight: 700;
  }

  .sel-indicator-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }

  .sel-label {
    color: #475569;
    letter-spacing: 0.3px;
  }

  .sel-rango-pill {
    margin-left: auto;
    background: #ede9fe;
    color: #6d28d9;
    border: 1px solid #ddd6fe;
    padding: 1px 7px;
    border-radius: 4px;
    font-size: 10.5px;
    font-weight: 800;
  }

  .sel-maq-name {
    font-size: 16px;
    font-weight: 800;
    color: #0f172a;
  }

  .sel-maq-serial {
    font-size: 11.5px;
    color: #64748b;
  }

  /* Tarjeta informativa cuando no hay máquina seleccionada */
  .no-maquina-hint-card {
    display: flex;
    align-items: center;
    gap: 12px;
    background: #fffbeb;
    border: 1.5px dashed #fcd34d;
    padding: 12px 14px;
    border-radius: 8px;
  }

  .hint-icon {
    font-size: 24px;
    line-height: 1;
  }

  .hint-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hint-title {
    font-size: 13px;
    color: #92400e;
    font-weight: 800;
  }

  .hint-desc {
    font-size: 11.5px;
    color: #b45309;
    line-height: 1.35;
  }

  .denominaciones-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 14px;
  }

  .denom-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
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
    box-sizing: border-box;
    transition: all 0.2s ease;
  }

  .denom-input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .form-total-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    padding: 10px 14px;
    border-radius: 8px;
    margin-top: 4px;
  }

  .total-box-label {
    font-size: 13.5px;
    font-weight: 700;
    color: #475569;
  }

  .total-box-val {
    font-size: 17px;
    font-weight: 800;
    color: #166534;
  }

  .form-buttons-row {
    display: flex;
    gap: 10px;
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
    box-shadow: 0 2px 4px rgba(91, 184, 126, 0.25);
  }

  .btn-guardar:hover:not(:disabled) {
    background-color: #4ca66e;
    box-shadow: 0 4px 8px rgba(91, 184, 126, 0.35);
  }

  .btn-guardar:disabled {
    opacity: 0.6;
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
    color: #1e293b;
  }

  /* Tarjeta Derecha */
  .card-table-conteo {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  .table-header-dark {
    background-color: #334155;
    color: #ffffff;
    padding: 14px 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dark-header-title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.3px;
  }

  .resumen-tabs-header {
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    padding: 8px 16px;
  }

  .tabs-nav-list {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tab-nav-btn {
    padding: 7px 14px;
    font-size: 12.5px;
    font-weight: 700;
    color: #475569;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .tab-nav-btn:hover {
    background: #e2e8f0;
    color: #0f172a;
  }

  .tab-nav-btn.active {
    background: #ffffff;
    color: #1e293b;
    border-color: #cbd5e1;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  }

  .table-wrapper {
    width: 100%;
    overflow-x: auto;
  }

  .conteo-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    color: #0f172a;
  }

  .conteo-table th {
    background-color: #1e293b;
    color: #ffffff;
    font-weight: 700;
    padding: 10px 12px;
    text-align: center;
    border-bottom: 1px solid #0f172a;
    white-space: nowrap;
    font-size: 12.5px;
  }

  .conteo-table td {
    padding: 10px 12px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: middle;
  }

  .conteo-table tbody tr:hover {
    background-color: #f8fafc;
  }

  .th-num { width: 45px; }
  .th-maquina { text-align: left !important; }
  .th-denom { width: 65px; }
  .th-total { text-align: right !important; width: 110px; }
  .th-acciones { width: 130px; }

  .td-center { text-align: center; }
  .td-left { text-align: left; }
  .td-right { text-align: right; }
  .td-index { color: #64748b; font-weight: 700; }

  .td-empty {
    text-align: center;
    padding: 40px 16px;
    color: #94a3b8;
    font-size: 14px;
    font-style: italic;
  }

  .maquina-info-box {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .maquina-title {
    font-size: 13.5px;
    color: #0f172a;
  }

  .rango-sub-pill {
    font-size: 11px;
    font-weight: 700;
    color: #475569;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    padding: 1px 6px;
    border-radius: 4px;
    display: inline-block;
    width: fit-content;
  }

  .badge-rango-group {
    background: #ede9fe;
    color: #6d28d9;
    border: 1px solid #ddd6fe;
    padding: 3px 9px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 800;
  }

  .td-total-cell {
    color: #0f172a;
    font-size: 14px;
  }

  .acciones-btn-group {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .tr-record-item {
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .tr-record-item:hover {
    background-color: #f1f5f9;
  }

  .btn-action-edit {
    padding: 4px 10px;
    background-color: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 4px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-action-edit:hover {
    background-color: #1d4ed8;
  }

  .btn-action-delete {
    padding: 4px 10px;
    background-color: #dc2626;
    color: #ffffff;
    border: none;
    border-radius: 4px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-action-delete:hover {
    background-color: #b91c1c;
  }

  /* Totales al pie de tabla */
  .tfoot-totals-row {
    background-color: #ffffff;
    border-top: 2px solid #cbd5e1;
  }

  .tfoot-totals-row td {
    padding: 12px;
    color: #0f172a;
  }

  .td-foot-label {
    text-align: left;
    font-size: 13.5px;
    letter-spacing: 0.5px;
  }

  .td-foot-grand {
    font-size: 15px;
    color: #166534;
  }

  .tag-pct {
    color: #2563eb;
  }

  .font-bold {
    font-weight: 700;
  }

  /* ─────────────────────────────────────────────────────────────
     MODAL DE EDICIÓN
     ───────────────────────────────────────────────────────────── */
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: rgba(15, 23, 42, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 16px;
    box-sizing: border-box;
  }

  .modal-card {
    background: #ffffff;
    border-radius: 12px;
    width: 100%;
    max-width: 480px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    animation: modalIn 0.2s ease-out;
  }

  @keyframes modalIn {
    from { opacity: 0; transform: scale(0.96); }
    to { opacity: 1; transform: scale(1); }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    background-color: #1e293b;
    color: #ffffff;
  }

  .modal-title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
  }

  .btn-modal-close {
    background: transparent;
    border: none;
    color: #94a3b8;
    font-size: 22px;
    cursor: pointer;
    line-height: 1;
  }

  .btn-modal-close:hover {
    color: #ffffff;
  }

  .modal-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .modal-maquina-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    padding: 8px 12px;
    border-radius: 6px;
  }

  .m-maq-name {
    font-weight: 800;
    color: #0f172a;
    font-size: 14px;
  }

  .m-maq-rango {
    font-size: 11.5px;
    font-weight: 700;
    color: #475569;
    background: #e2e8f0;
    padding: 2px 7px;
    border-radius: 4px;
  }

  .modal-total-display {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    padding: 10px 14px;
    border-radius: 8px;
    font-weight: 700;
    color: #166534;
    font-size: 15px;
  }

  .modal-total-value {
    font-size: 18px;
    font-weight: 800;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding-top: 10px;
    border-top: 1px solid #f1f5f9;
  }

  .btn-modal-cancel {
    padding: 8px 16px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #475569;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-modal-cancel:hover {
    background: #f1f5f9;
    color: #1e293b;
  }

  .btn-modal-save {
    padding: 8px 16px;
    border: none;
    background: #5bb87e;
    color: #ffffff;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
    box-shadow: 0 2px 4px rgba(91, 184, 126, 0.25);
  }

  .btn-modal-save:hover:not(:disabled) {
    background: #4ca66e;
  }

  .btn-modal-save:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>

