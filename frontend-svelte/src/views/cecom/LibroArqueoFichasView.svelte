<script>
  import { onMount, onDestroy } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { subscribeToLibroUpdates } from '../../controllers/websocket.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { 
    masterMesasStore, 
    masterSalasStore, 
    masterJuegosStore, 
    masterEmpleadosStore,
    userSalasStore as masterUserSalasStore,
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
  import ArqueoCierreModal from '../../components/modals/ArqueoCierreModal.svelte';
  import RellenoDevolucionModal from '../../components/modals/RellenoDevolucionModal.svelte';

  export let libro = null;
  export let libroId = null;
  export let multisalaUuid = null;

  let prevMultisala = undefined;
  $: if (multisalaUuid !== prevMultisala) {
    const isFirstTime = prevMultisala === undefined;
    prevMultisala = multisalaUuid;
    if (!isFirstTime) {
      selectedMesaId = '';
      limpiarFormulario();
    }
    loadArqueoRecords();
  }

  $: canEdit = $currentRoutePermissionsStore ? Boolean($currentRoutePermissionsStore.canEdit) : true;
  $: canDelete = $currentRoutePermissionsStore ? Boolean($currentRoutePermissionsStore.canDelete) : true;
  $: canAdd = $currentRoutePermissionsStore ? Boolean($currentRoutePermissionsStore.canAdd) : true;

  // Lista de registros de arqueo (aperturas y cierres)
  let arqueoRecords = [];
  let isLoadingRecords = true;

  // Estado del formulario de Apertura (Tarjeta Izquierda: "Sobrantes y Faltantes")
  let selectedMesaId = '';
  let formQuantities = {}; // { [valor]: cantidad }
  let isSaving = false;

  // Modal de Cierre ("Arquear")
  let isModalOpen = false;
  let modalMesa = null;
  let modalAperturaRecord = null;
  let modalCierreRecord = null;

  // Modal de Rellenos y Devoluciones
  let isRDModalOpen = false;
  let rdModalTipo = 'relleno'; // 'relleno' | 'devolucion'
  let rdModalMesa = null;
  let rdModalApertura = null;

  // Modal de Opciones de Mesa
  let isOpcionesModalOpen = false;
  let selectedOpcionesGroup = null;
  let isEditingNota = false;
  let notaTexto = '';
  let isNotaModalOpen = false;
  let selectedNotaGroup = null;

  // Datos de empleados y horas para Apertura
  let localEmpleados = [];
  let empleadoAperturaNombre = '';
  let empleadoAperturaUuid = null;
  let horaApertura = '';
  let aperturaEmpSugTarget = false;
  let aperturaEmpSugIndex = -1;

  async function syncLocalEmpleados() {
    try {
      const stored = await getLocalItems('empleados');
      if (Array.isArray(stored) && stored.length > 0) {
        localEmpleados = stored;
      }
    } catch (_) {}
  }

  function setActualHoraApertura() {
    const now = new Date();
    horaApertura = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  function normalizeSearchStr(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  let serverSalaEmpleados = [];
  let lastFetchedSalaUuid = null;

  async function fetchEmpleadosDeSala(salaId) {
    if (!salaId) return;
    lastFetchedSalaUuid = salaId;
    try {
      const res = await fetch(toBackendUrl(`/api/master/empleados?sala_uuid=${salaId}&limit=1000`));
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.data)) {
          serverSalaEmpleados = json.data;
        }
      }
    } catch (err) {
      console.warn('[ArqueoFichas] Error fetching empleados de sala:', err);
    }
  }

  $: targetSalaId = (libro?.sala_id || null);
  $: targetSalaUuid = (libro?.sala_uuid || null);

  $: effectiveSalaUuid = (() => {
    if (targetSalaUuid) return String(targetSalaUuid);
    if (targetSalaId) return String(targetSalaId);
    if (currentSala?.uuid) return String(currentSala.uuid);
    if (currentSala?.id) return String(currentSala.id);
    return null;
  })();

  $: if (effectiveSalaUuid && effectiveSalaUuid !== lastFetchedSalaUuid) {
    fetchEmpleadosDeSala(effectiveSalaUuid);
  }

  $: allEmpleados = (() => {
    const storeEmps = $masterEmpleadosStore || [];
    const map = new Map();
    for (const e of storeEmps) {
      if (e && (e.uuid || e.id)) map.set(String(e.uuid || e.id), e);
    }
    for (const e of serverSalaEmpleados) {
      if (e && (e.uuid || e.id)) map.set(String(e.uuid || e.id), e);
    }
    for (const e of localEmpleados) {
      if (e && (e.uuid || e.id) && !map.has(String(e.uuid || e.id))) map.set(String(e.uuid || e.id), e);
    }
    return Array.from(map.values());
  })();

  $: listaEmpleados = (() => {
    let filtered = allEmpleados.filter(e => {
      if (e.activo !== undefined && (Number(e.activo) === 0 || e.activo === false || String(e.activo).toLowerCase() === 'false')) return false;
      if (!effectiveSalaUuid) return true;
      const eSala = String(e.sala_uuid || e.sala_id || '');
      if (eSala && eSala === effectiveSalaUuid) return true;
      return !eSala;
    });

    if (filtered.length === 0 && allEmpleados.length > 0) {
      filtered = allEmpleados.filter(e => e.activo !== false && Number(e.activo) !== 0 && String(e.activo).toLowerCase() !== 'false');
    }

    return filtered.map(e => {
      const fullName = [e.nombre, e.apellido].filter(Boolean).join(' ').trim() || e.nombre || (e.uuid ? `Empleado #${e.uuid.slice(0, 8)}` : `Empleado #${e.id}`);
      return {
        uuid: e.uuid || e.id,
        id: e.uuid || e.id,
        nombre: fullName,
        cedula: e.cedula || '',
        cargo_nombre: (e.cargo_nombre || '').trim() || 'General',
        departamento_nombre: (e.departamento_nombre || '').trim(),
        foto: e.foto || null,
        sala_uuid: e.sala_uuid || e.sala_id
      };
    })
    .filter(e => Boolean(e.nombre))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
  })();

  $: filteredAperturaEmpSuggestions = (() => {
    if (!aperturaEmpSugTarget) return [];
    const q = (empleadoAperturaNombre || '').trim();
    if (!q) return listaEmpleados;
    const normQ = normalizeSearchStr(q);
    const tokens = normQ.split(/\s+/).filter(Boolean);
    return (listaEmpleados || []).filter(emp => {
      const targetText = normalizeSearchStr(`${emp.nombre || ''} ${emp.cargo_nombre || ''} ${emp.cedula || ''}`);
      return tokens.every(token => targetText.includes(token));
    });
  })();

  function handleFocusAperturaEmp() {
    aperturaEmpSugTarget = true;
    aperturaEmpSugIndex = -1;
  }

  function handleInputAperturaEmp(val) {
    empleadoAperturaNombre = val;
    empleadoAperturaUuid = null;
    aperturaEmpSugTarget = true;
    aperturaEmpSugIndex = -1;
  }

  function handleKeyDownAperturaEmp(e) {
    if (!aperturaEmpSugTarget) return;
    if (e.key === 'ArrowDown') {
      if (filteredAperturaEmpSuggestions.length > 0) {
        e.preventDefault();
        aperturaEmpSugIndex = (aperturaEmpSugIndex + 1) % filteredAperturaEmpSuggestions.length;
      }
    } else if (e.key === 'ArrowUp') {
      if (filteredAperturaEmpSuggestions.length > 0) {
        e.preventDefault();
        aperturaEmpSugIndex = (aperturaEmpSugIndex - 1 + filteredAperturaEmpSuggestions.length) % filteredAperturaEmpSuggestions.length;
      }
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (filteredAperturaEmpSuggestions.length > 0) {
        e.preventDefault();
        const selected = aperturaEmpSugIndex >= 0 ? filteredAperturaEmpSuggestions[aperturaEmpSugIndex] : filteredAperturaEmpSuggestions[0];
        selectAperturaEmpSuggestion(selected);
      }
    } else if (e.key === 'Escape') {
      aperturaEmpSugTarget = false;
      aperturaEmpSugIndex = -1;
    }
  }

  function selectAperturaEmpSuggestion(sug) {
    empleadoAperturaNombre = sug.nombre || '';
    empleadoAperturaUuid = sug.uuid || sug.id || null;
    aperturaEmpSugTarget = false;
    aperturaEmpSugIndex = -1;
  }

  function handleBlurAperturaEmp() {
    setTimeout(() => {
      aperturaEmpSugTarget = false;
      aperturaEmpSugIndex = -1;
    }, 200);
  }

  function handleOpenOpcionesModal(group) {
    selectedOpcionesGroup = group;
    notaTexto = group.apertura?.nota || group.cierre?.nota || group.nota || '';
    isEditingNota = false;
    isOpcionesModalOpen = true;
  }

  function handleCloseOpcionesModal() {
    isOpcionesModalOpen = false;
    selectedOpcionesGroup = null;
    isEditingNota = false;
  }

  function handleOpenNotaModal(group) {
    selectedNotaGroup = group;
    notaTexto = group.apertura?.nota || group.cierre?.nota || group.nota || '';
    isOpcionesModalOpen = false;
    isNotaModalOpen = true;
  }

  function handleCloseNotaModal() {
    isNotaModalOpen = false;
    if (selectedNotaGroup) {
      selectedOpcionesGroup = mesaGroups.find(g => g.mesaId === selectedNotaGroup.mesaId) || selectedNotaGroup;
      isOpcionesModalOpen = true;
    }
  }

  async function handleGuardarNota() {
    const targetGroup = selectedNotaGroup || selectedOpcionesGroup;
    if (!targetGroup) return;
    const lId = libro?.uuid || libroId || libro?.id;
    const mId = targetGroup.mesaId;
    if (!lId || !mId) return;

    const nuevaNota = (notaTexto || '').trim() || null;

    if (targetGroup.apertura) {
      targetGroup.apertura.nota = nuevaNota;
      const recUuid = targetGroup.apertura.uuid || targetGroup.apertura.id;
      await upsertLocalItem('libro_arqueo_fichas', targetGroup.apertura);

      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        await queueOutboxAction({
          entity: 'libro_arqueo_fichas',
          action: 'save',
          endpoint: `/api/master/libros/${lId}/arqueo-fichas`,
          method: 'POST',
          payload: targetGroup.apertura,
          uuid: recUuid
        });
      } else {
        fetch(toBackendUrl(`/api/master/libros/${lId}/arqueo-fichas`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(targetGroup.apertura)
        }).catch(err => console.warn('Error syncing nota:', err));
      }
    }

    arqueoRecords = [...arqueoRecords];
    isNotaModalOpen = false;
    isEditingNota = false;
    triggerToast('Nota guardada con éxito', 'success');

    if (targetGroup) {
      selectedOpcionesGroup = mesaGroups.find(g => g.mesaId === targetGroup.mesaId) || targetGroup;
      isOpcionesModalOpen = true;
    }
  }

  // Resolver Sala del Libro
  $: currentSala = ($masterSalasStore || []).find(s => 
    (libro?.sala_uuid && (String(s.uuid) === String(libro.sala_uuid) || String(s.id) === String(libro.sala_uuid))) || 
    (libro?.sala_id && String(s.uuid || s.id) === String(libro.sala_id))
  );

  // Extraer Fichas configuradas en la Sala (ordenadas de mayor a menor)
  $: salaFichas = (() => {
    let raw = [];
    if (Array.isArray(currentSala?.fichas)) {
      raw = currentSala.fichas;
    } else if (typeof currentSala?.fichas === 'string') {
      try { raw = JSON.parse(currentSala.fichas); } catch (e) { raw = []; }
    }
    const parsed = (Array.isArray(raw) ? raw : []).map(f => {
      if (typeof f === 'number' || (typeof f === 'string' && !isNaN(Number(f)))) {
        return Number(f);
      }
      if (f && typeof f === 'object') {
        const v = Number(f.valor ?? f.value ?? f.denominacion);
        return isNaN(v) ? 0 : v;
      }
      return 0;
    }).filter(v => v > 0);

    // Si la sala no tiene fichas definidas, proveer denominaciones estándar de casino
    const baseList = parsed.length > 0 ? parsed : [100, 50, 20, 10, 5, 1];
    return Array.from(new Set(baseList)).sort((a, b) => b - a);
  })();

  // Lista de mesas disponibles para esta sala
  $: availableMesas = (() => {
    const list = $masterMesasStore || [];
    const targetSala = libro?.sala_uuid || libro?.sala_id;
    return list.filter(m => {
      if ((m.active ?? 1) === 0) return false;
      const mSala = m.sala_uuid || m.sala_id;
      if (targetSala && String(mSala) !== String(targetSala)) return false;
      return true;
    });
  })();

  function formatMesaOptionLabel(m) {
    const juegoName = m.juego_nombre || ($masterJuegosStore || []).find(j => String(j.uuid || j.id) === String(m.juego_uuid || m.juego_id))?.nombre || '';
    if (juegoName) {
      return `${m.nombre} - ${juegoName}`;
    }
    return m.nombre || (m.uuid ? `Mesa #${m.uuid.slice(0, 8)}` : `Mesa #${m.id}`);
  }

  // Título de la tabla derecha: Casino El Tamanaco - 16/11/2026
  $: tableHeaderTitle = (() => {
    const salaName = libro?.sala_nombre || currentSala?.nombre || libro?.sala_nombre_comercial || currentSala?.nombre_comercial || 'Sala';
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

  function formatMoney(num) {
    if (isNaN(num)) return '0';
    const val = Number(num) || 0;
    const hasDecimals = val % 1 !== 0;
    return val.toLocaleString('en-US', {
      minimumFractionDigits: hasDecimals ? 2 : 0,
      maximumFractionDigits: 2
    });
  }

  // Al seleccionar una mesa en el formulario de la izquierda
  function handleMesaChange() {
    if (!selectedMesaId) {
      limpiarFormulario();
      return;
    }

    const mesaObj = availableMesas.find(m => String(m.uuid || m.id) === String(selectedMesaId));
    if (!mesaObj) return;

    // 1. Revisar si ya existe un registro de apertura en el arqueo actual para esta mesa
    const existingApertura = arqueoRecords.find(r => 
      String(r.mesa_uuid || r.mesa_id) === String(selectedMesaId) && 
      r.tipo === 'apertura'
    );

    const newQuantities = {};

    if (existingApertura) {
      // Cargar cantidades y responsable guardados en apertura
      empleadoAperturaNombre = existingApertura.empleado_apertura_nombre || '';
      empleadoAperturaUuid = existingApertura.empleado_apertura_uuid || null;
      horaApertura = existingApertura.hora_apertura || '';

      const fList = Array.isArray(existingApertura.fichas)
        ? existingApertura.fichas
        : (typeof existingApertura.fichas === 'string' ? JSON.parse(existingApertura.fichas || '[]') : []);

      for (const f of fList) {
        const v = Number(f.valor ?? f.denominacion);
        if (v > 0) newQuantities[v] = f.cantidad ?? 0;
      }
    } else {
      empleadoAperturaNombre = '';
      empleadoAperturaUuid = null;
      setActualHoraApertura();

      // 2. Traer cantidades por defecto de mesa.banca
      let bancaList = [];
      if (Array.isArray(mesaObj.banca)) {
        bancaList = mesaObj.banca;
      } else if (typeof mesaObj.banca === 'string') {
        try { bancaList = JSON.parse(mesaObj.banca); } catch (e) { bancaList = []; }
      }

      for (const b of (Array.isArray(bancaList) ? bancaList : [])) {
        const v = Number(b.valor ?? b.denominacion);
        if (v > 0) newQuantities[v] = b.cantidad ?? 0;
      }
    }

    // Inicializar las fichas de la sala que no estén en banca con '' o 0
    for (const valor of salaFichas) {
      if (newQuantities[valor] === undefined) {
        newQuantities[valor] = '';
      }
    }

    formQuantities = newQuantities;
  }

  function limpiarFormulario() {
    formQuantities = {};
    empleadoAperturaNombre = '';
    empleadoAperturaUuid = null;
    setActualHoraApertura();
  }

  // Cálculo de total en vivo del formulario de la izquierda
  $: formTotalCalculado = salaFichas.reduce((acc, valor) => {
    const cant = Number(formQuantities[valor]) || 0;
    return acc + (valor * cant);
  }, 0);

  // Carga de registros de arqueo (Local-First: IndexedDB -> Backend)
  async function loadArqueoRecords(isBackground = false) {
    const lId = libro?.uuid || libroId || libro?.id;
    if (!lId) return;

    if (!isBackground && arqueoRecords.length === 0) {
      isLoadingRecords = true;
    }
    try {
      // 1. LocalDB (<5ms)
      const local = await getLocalItems('libro_arqueo_fichas', r => 
        String(r.libro_uuid || r.libro_id) === String(lId) &&
        (multisalaUuid ? String(r.multisala_uuid) === String(multisalaUuid) : !r.multisala_uuid) &&
        !r.is_deleted
      );
      if (local && local.length > 0) {
        arqueoRecords = local;
        isLoadingRecords = false;
      }

      // 2. Segundo plano: Backend
      const q = multisalaUuid ? `?multisala_uuid=${multisalaUuid}` : '';
      const res = await fetch(toBackendUrl(`/api/master/libros/${lId}/arqueo-fichas${q}`));
      if (res.ok) {
        const json = await res.json();
        if (json?.data) {
          arqueoRecords = json.data;
          saveLocalItems('libro_arqueo_fichas', json.data).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('[ArqueoFichas] Error cargando registros:', err);
    } finally {
      isLoadingRecords = false;
    }
  }

  // Guardar Apertura (Botón "Aperturar")
  async function handleAperturar() {
    if (!selectedMesaId) {
      triggerToast('Debe seleccionar una mesa para aperturar', 'warning');
      return;
    }

    const lId = libro?.uuid || libroId || libro?.id;
    if (!lId) return;

    isSaving = true;
    try {
      const mesaObj = availableMesas.find(m => String(m.uuid || m.id) === String(selectedMesaId));

      // Preparar payload de fichas ordenado de mayor a menor
      const fichasPayload = salaFichas.map(valor => {
        const cant = Math.max(0, parseInt(formQuantities[valor], 10) || 0);
        return {
          valor,
          cantidad: cant,
          total: valor * cant
        };
      }).filter(f => f.valor > 0).sort((a, b) => b.valor - a.valor);

      const total = fichasPayload.reduce((acc, f) => acc + f.total, 0);

      // Buscar si ya existe registro de apertura
      const existing = arqueoRecords.find(r => 
        String(r.mesa_uuid || r.mesa_id) === String(selectedMesaId) && 
        (r.tipo === 'apertura' || !r.tipo)
      );
      const recordUuid = existing?.uuid || existing?.id || generateSafeUuid();

      const newRecord = {
        uuid: recordUuid,
        id: recordUuid,
        libro_uuid: lId,
        libro_id: lId,
        mesa_uuid: selectedMesaId,
        mesa_id: selectedMesaId,
        multisala_uuid: multisalaUuid || null,
        tipo: 'apertura',
        fichas: fichasPayload,
        fichas_cierre: existing?.fichas_cierre || [],
        total,
        total_apertura: total,
        total_cierre: existing?.total_cierre || 0,
        hora_apertura: horaApertura || new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        empleado_apertura_uuid: empleadoAperturaUuid || null,
        empleado_apertura_nombre: empleadoAperturaNombre?.trim() || null,
        hora_cierre: existing?.hora_cierre || null,
        empleado_cierre_uuid: existing?.empleado_cierre_uuid || null,
        empleado_cierre_nombre: existing?.empleado_cierre_nombre || null,
        rellenos_devoluciones: existing?.rellenos_devoluciones || [],
        diferencia: existing?.diferencia || 0,
        nota: existing?.nota || null,
        mesa_nombre: mesaObj?.nombre || '',
        juego_nombre: mesaObj?.juego_nombre || '',
        updated_at: new Date().toISOString()
      };

      // 1. Actualizar estado en memoria inmediatamente (0ms)
      const existingIdx = arqueoRecords.findIndex(r => String(r.uuid || r.id) === String(recordUuid));
      if (existingIdx !== -1) {
        arqueoRecords[existingIdx] = newRecord;
      } else {
        arqueoRecords = [...arqueoRecords, newRecord];
      }
      arqueoRecords = [...arqueoRecords];

      // 2. Guardar en base de datos local IndexedDB (<5ms)
      await upsertLocalItem('libro_arqueo_fichas', newRecord);

      triggerToast(`Mesa "${mesaObj?.nombre || 'Mesa'}" aperturada con éxito.`, 'success');

      // Limpiar y resetear el formulario tras aperturar
      selectedMesaId = '';
      limpiarFormulario();

      // 3. Sincronizar en segundo plano con el backend
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        await queueOutboxAction({
          entity: 'libro_arqueo_fichas',
          action: 'save',
          endpoint: `/api/master/libros/${lId}/arqueo-fichas`,
          method: 'POST',
          payload: newRecord,
          uuid: recordUuid
        });
      } else {
        (async () => {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4500);
            const res = await fetch(toBackendUrl(`/api/master/libros/${lId}/arqueo-fichas`), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(newRecord),
              signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok) {
              const json = await res.json();
              if (json?.data) {
                await upsertLocalItem('libro_arqueo_fichas', json.data);
              }
            }
          } catch (syncErr) {
            console.warn('[ArqueoFichas] Encolando en Outbox:', syncErr);
            await queueOutboxAction({
              entity: 'libro_arqueo_fichas',
              action: 'save',
              endpoint: `/api/master/libros/${lId}/arqueo-fichas`,
              method: 'POST',
              payload: newRecord,
              uuid: recordUuid
            });
          }
        })();
      }
    } catch (err) {
      console.error('Error aperturando mesa:', err);
      triggerToast(err.message || 'Error al guardar la apertura', 'error');
    } finally {
      isSaving = false;
    }
  }

  function extractMovements(record) {
    if (!record) return [];
    const raw = record.rellenos_devoluciones;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch (e) { return []; }
    }
    return [];
  }

  // Agrupación de registros por mesa para mostrar sub-líneas (Apertura, Rellenos/Devoluciones, Cierre, Diferencia)
  $: mesaGroups = (() => {
    const groupsMap = new Map();

    for (const r of arqueoRecords) {
      if (r.is_deleted) continue;
      const mId = String(r.mesa_uuid || r.mesa_id);
      if (!groupsMap.has(mId)) {
        const mesaObj = availableMesas.find(m => String(m.uuid || m.id) === mId);
        groupsMap.set(mId, {
          mesaId: mId,
          mesaNombre: r.mesa_nombre || mesaObj?.nombre || `Mesa #${mId.slice(0, 8)}`,
          juegoNombre: r.juego_nombre || mesaObj?.juego_nombre || '',
          mesaObj,
          apertura: null,
          cierre: null,
          rellenosDevoluciones: [],
          totalRellenos: 0,
          totalDevoluciones: 0
        });
      }

      const g = groupsMap.get(mId);
      if (r.tipo === 'apertura' || !r.tipo) {
        g.apertura = r;
        const rawFC = r.fichas_cierre;
        const parsedFC = Array.isArray(rawFC) ? rawFC : (typeof rawFC === 'string' ? JSON.parse(rawFC || '[]') : []);
        const hasCierreData = parsedFC.length > 0 || (r.total_cierre !== undefined && Number(r.total_cierre) > 0) || Boolean(r.hora_cierre);
        if (hasCierreData) {
          g.cierre = {
            ...r,
            tipo: 'cierre',
            fichas: parsedFC,
            total: Number(r.total_cierre) || 0,
            hora_cierre: r.hora_cierre,
            empleado_cierre_uuid: r.empleado_cierre_uuid,
            empleado_cierre_nombre: r.empleado_cierre_nombre
          };
        }
      } else if (r.tipo === 'cierre') {
        g.cierre = r;
      }
    }

    // Calcular movimientos consolidados y totales para cada mesa
    for (const g of groupsMap.values()) {
      // Si la mesa está aperturada pero no tiene cierre aún, inicializar cierre a 0 fichas
      if (g.apertura && !g.cierre) {
        g.cierre = {
          uuid: `virtual-cierre-${g.mesaId}`,
          id: `virtual-cierre-${g.mesaId}`,
          mesa_uuid: g.mesaId,
          mesa_id: g.mesaId,
          tipo: 'cierre',
          fichas: salaFichas.map(v => ({ valor: v, cantidad: 0, total: 0 })),
          total: 0
        };
      }

      const apMovs = extractMovements(g.apertura);
      const ciMovs = extractMovements(g.cierre);
      // Apertura es siempre la fuente primaria de verdad si existe
      g.rellenosDevoluciones = g.apertura ? apMovs : ciMovs;
      g.totalRellenos = g.rellenosDevoluciones.filter(m => m.tipo === 'relleno').reduce((a, b) => a + (Number(b.total) || 0), 0);
      g.totalDevoluciones = g.rellenosDevoluciones.filter(m => m.tipo === 'devolucion').reduce((a, b) => a + (Number(b.total) || 0), 0);
    }

    // Ordenar mesas alfabéticamente
    return Array.from(groupsMap.values()).sort((a, b) => 
      a.mesaNombre.localeCompare(b.mesaNombre, undefined, { numeric: true, sensitivity: 'base' })
    );
  })();

  // Obtener cantidad de fichas de un registro para una denominación dada
  function getChipCount(record, valor) {
    if (!record) return null;
    const fList = Array.isArray(record.fichas)
      ? record.fichas
      : (typeof record.fichas === 'string' ? JSON.parse(record.fichas || '[]') : []);

    const found = fList.find(f => Number(f.valor ?? f.denominacion) === Number(valor));
    return found ? (Number(found.cantidad) || 0) : 0;
  }

  // Obtener cantidad de fichas de un movimiento de relleno o devolución
  function getMovChipCount(mov, valor) {
    if (!mov || !Array.isArray(mov.fichas)) return 0;
    const found = mov.fichas.find(f => Number(f.valor ?? f.denominacion) === Number(valor));
    return found ? (Number(found.cantidad) || 0) : 0;
  }

  // Formatear texto del badge de movimiento (FILL 1, CRED 1, etc.)
  function formatMovBadge(mov, allMovs = []) {
    if (!mov) return '';
    const sameType = (allMovs && allMovs.length > 0) ? allMovs.filter(m => m.tipo === mov.tipo) : [];
    const pos = sameType.findIndex(m => (m.id || m.uuid) === (mov.id || mov.uuid));
    const num = pos !== -1 ? (pos + 1) : (mov.numero || (mov.codigo ? String(mov.codigo).replace(/[^0-9]/g, '') : 1));
    return mov.tipo === 'relleno' ? `FILL ${num}` : `CRED ${num}`;
  }

  let returnToOpcionesGroup = null;

  // Abrir Modal de Cierre ("Arquear")
  function handleOpenCierreModal(group) {
    if (isOpcionesModalOpen) {
      returnToOpcionesGroup = group;
      isOpcionesModalOpen = false;
    }
    modalMesa = group.mesaObj || { uuid: group.mesaId, id: group.mesaId, nombre: group.mesaNombre, juego_nombre: group.juegoNombre };
    modalAperturaRecord = group.apertura;
    modalCierreRecord = group.cierre;
    isModalOpen = true;
  }

  function handleCloseCierreModal() {
    isModalOpen = false;
    if (returnToOpcionesGroup) {
      selectedOpcionesGroup = mesaGroups.find(g => g.mesaId === returnToOpcionesGroup.mesaId) || returnToOpcionesGroup;
      returnToOpcionesGroup = null;
      isOpcionesModalOpen = true;
    }
  }

  // Abrir Modal de Rellenos y Devoluciones (Fill / Cred)
  function handleOpenRellenoModal(tipo = 'relleno', mesaObj = null, aperturaRecord = null, fromOpciones = false) {
    const targetMesa = mesaObj || (selectedMesaId ? availableMesas.find(m => String(m.uuid || m.id) === String(selectedMesaId)) : null);
    if (!targetMesa) {
      triggerToast('Debe seleccionar una mesa primero', 'warning');
      return;
    }

    const mId = String(targetMesa.uuid || targetMesa.id);
    const ap = aperturaRecord || arqueoRecords.find(r => 
      String(r.mesa_uuid || r.mesa_id) === mId &&
      (r.tipo === 'apertura' || !r.tipo)
    );

    if (fromOpciones && selectedOpcionesGroup) {
      returnToOpcionesGroup = selectedOpcionesGroup;
      isOpcionesModalOpen = false;
    }

    rdModalTipo = tipo;
    rdModalMesa = targetMesa;
    rdModalApertura = ap || null;
    isRDModalOpen = true;
  }

  function handleCloseRDModal() {
    isRDModalOpen = false;
    if (returnToOpcionesGroup) {
      selectedOpcionesGroup = mesaGroups.find(g => g.mesaId === returnToOpcionesGroup.mesaId) || returnToOpcionesGroup;
      returnToOpcionesGroup = null;
      isOpcionesModalOpen = true;
    }
  }

  // Callback cuando se guardan Rellenos o Devoluciones desde el Modal
  function handleRDSaved(event) {
    const updatedApertura = event.detail;
    if (!updatedApertura) return;

    const existingIdx = arqueoRecords.findIndex(r => String(r.uuid || r.id) === String(updatedApertura.uuid || updatedApertura.id));
    if (existingIdx !== -1) {
      arqueoRecords[existingIdx] = updatedApertura;
    } else {
      arqueoRecords = [...arqueoRecords, updatedApertura];
    }

    arqueoRecords = [...arqueoRecords];
    rdModalApertura = updatedApertura;
    isRDModalOpen = false;

    if (returnToOpcionesGroup) {
      selectedOpcionesGroup = mesaGroups.find(g => g.mesaId === returnToOpcionesGroup.mesaId) || returnToOpcionesGroup;
      returnToOpcionesGroup = null;
      isOpcionesModalOpen = true;
    } else if (selectedOpcionesGroup) {
      selectedOpcionesGroup = mesaGroups.find(g => g.mesaId === selectedOpcionesGroup.mesaId) || selectedOpcionesGroup;
    }
  }

  // Callback cuando se guarda el Cierre desde el Modal
  function handleCierreSaved(event) {
    const savedRecord = event.detail;
    if (!savedRecord) return;

    const existingIdx = arqueoRecords.findIndex(r => String(r.uuid || r.id) === String(savedRecord.uuid || savedRecord.id));
    if (existingIdx !== -1) {
      arqueoRecords[existingIdx] = savedRecord;
      arqueoRecords = [...arqueoRecords];
    } else {
      arqueoRecords = [...arqueoRecords, savedRecord];
    }
    isModalOpen = false;

    if (returnToOpcionesGroup) {
      selectedOpcionesGroup = mesaGroups.find(g => g.mesaId === returnToOpcionesGroup.mesaId) || returnToOpcionesGroup;
      returnToOpcionesGroup = null;
      isOpcionesModalOpen = true;
    } else if (selectedOpcionesGroup) {
      selectedOpcionesGroup = mesaGroups.find(g => g.mesaId === selectedOpcionesGroup.mesaId) || selectedOpcionesGroup;
    }
  }

  // Liquidar mesa: cierra la mesa con las mismas cantidades de fichas con las que se abrió
  async function handleLiquidarMesa(group) {
    if (!group) return;

    const lId = libro?.uuid || libroId || libro?.id;
    const mId = group.mesaId;
    if (!lId || !mId) return;

    if (!group.apertura) {
      triggerToast(`La mesa "${group.mesaNombre}" no tiene registro de apertura.`, 'warning');
      return;
    }

    // Obtener desglose de fichas de apertura
    const apFichas = Array.isArray(group.apertura.fichas)
      ? group.apertura.fichas
      : (typeof group.apertura.fichas === 'string' ? JSON.parse(group.apertura.fichas || '[]') : []);

    const clonedFichas = apFichas.map(f => ({
      valor: Number(f.valor ?? f.denominacion),
      cantidad: Number(f.cantidad || 0),
      total: Number(f.total || (Number(f.valor ?? f.denominacion) * Number(f.cantidad || 0)))
    }));

    const apTotal = Number(group.apertura.total) || clonedFichas.reduce((a, b) => a + b.total, 0);
    const targetUuid = group.apertura.uuid || group.apertura.id;

    const updatedMesa = {
      ...group.apertura,
      uuid: targetUuid,
      id: targetUuid,
      libro_uuid: lId,
      libro_id: lId,
      mesa_uuid: mId,
      mesa_id: mId,
      multisala_uuid: multisalaUuid || null,
      tipo: 'apertura',
      fichas_cierre: clonedFichas,
      total_cierre: apTotal,
      diferencia: 0,
      hora_cierre: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
      empleado_cierre_uuid: group.apertura.empleado_apertura_uuid || null,
      empleado_cierre_nombre: group.apertura.empleado_apertura_nombre || null,
      observaciones: group.apertura.observaciones || 'Liquidado automáticamente (Cierre = Apertura)',
      updated_at: new Date().toISOString()
    };

    // 1. Actualizar estado en memoria inmediatamente (0ms)
    const existingIdx = arqueoRecords.findIndex(r => String(r.uuid || r.id) === String(targetUuid));
    if (existingIdx !== -1) {
      arqueoRecords[existingIdx] = updatedMesa;
    } else {
      arqueoRecords = [...arqueoRecords, updatedMesa];
    }
    arqueoRecords = [...arqueoRecords];

    if (selectedOpcionesGroup && selectedOpcionesGroup.mesaId === mId) {
      selectedOpcionesGroup = mesaGroups.find(g => g.mesaId === mId) || selectedOpcionesGroup;
    }

    triggerToast(`Mesa "${group.mesaNombre}" liquidada (Cierre igualado a Apertura: $${formatMoney(apTotal)}).`, 'success');

    // 2. Guardar en base de datos local IndexedDB (<5ms)
    await upsertLocalItem('libro_arqueo_fichas', updatedMesa);

    // 3. Sincronizar en segundo plano con el backend
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (isOffline) {
      await queueOutboxAction({
        entity: 'libro_arqueo_fichas',
        action: 'save',
        endpoint: `/api/master/libros/${lId}/arqueo-fichas`,
        method: 'POST',
        payload: updatedMesa,
        uuid: targetUuid
      });
    } else {
      (async () => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4500);
          const res = await fetch(toBackendUrl(`/api/master/libros/${lId}/arqueo-fichas`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedMesa),
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (res.ok) {
            const json = await res.json();
            if (json?.data) {
              await upsertLocalItem('libro_arqueo_fichas', json.data);
            }
          }
        } catch (syncErr) {
          console.warn('[ArqueoFichas] Encolando liquidación en Outbox:', syncErr);
          await queueOutboxAction({
            entity: 'libro_arqueo_fichas',
            action: 'save',
            endpoint: `/api/master/libros/${lId}/arqueo-fichas`,
            method: 'POST',
            payload: updatedMesa,
            uuid: targetUuid
          });
        }
      })();
    }
  }

  // Eliminar Arqueo completo de una Mesa (Apertura y Cierre)
  async function handleEliminarMesa(group) {
    if (!group) return;

    const lId = libro?.uuid || libroId || libro?.id;
    const mId = group.mesaId;
    if (!lId || !mId) return;

    // 1. Eliminar en memoria inmediatamente (0ms)
    arqueoRecords = arqueoRecords.filter(r => String(r.mesa_uuid || r.mesa_id) !== String(mId));
    if (String(selectedMesaId) === String(mId)) {
      selectedMesaId = '';
      limpiarFormulario();
    }
    triggerToast(`Arqueo de la mesa "${group.mesaNombre}" eliminado`, 'info');

    // 2. Eliminar en base de datos local IndexedDB (<5ms)
    if (group.apertura?.uuid) await deleteLocalItem('libro_arqueo_fichas', group.apertura.uuid);
    if (group.cierre?.uuid) await deleteLocalItem('libro_arqueo_fichas', group.cierre.uuid);

    // 3. Sincronizar en segundo plano
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (isOffline) {
      await queueOutboxAction({
        entity: 'libro_arqueo_fichas',
        action: 'delete',
        endpoint: `/api/master/libros/${lId}/arqueo-fichas/${mId}`,
        method: 'DELETE',
        targetId: mId
      });
    } else {
      (async () => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);
          const res = await fetch(toBackendUrl(`/api/master/libros/${lId}/arqueo-fichas/${mId}`), {
            method: 'DELETE',
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (!res.ok) throw new Error(`Server returned ${res.status}`);
        } catch (delErr) {
          console.warn('[ArqueoFichas] Encolando eliminación en Outbox:', delErr);
          await queueOutboxAction({
            entity: 'libro_arqueo_fichas',
            action: 'delete',
            endpoint: `/api/master/libros/${lId}/arqueo-fichas/${mId}`,
            method: 'DELETE',
            targetId: mId
          });
        }
      })();
    }
  }

  // Totales consolidados para el footer de la tabla
  $: totalGeneralApertura = mesaGroups.reduce((acc, g) => acc + (Number(g.apertura?.total) || 0), 0);
  $: totalGeneralRellenos = mesaGroups.reduce((acc, g) => acc + (Number(g.totalRellenos) || 0), 0);
  $: totalGeneralDevoluciones = mesaGroups.reduce((acc, g) => acc + (Number(g.totalDevoluciones) || 0), 0);
  $: totalGeneralCierre = mesaGroups.reduce((acc, g) => acc + (Number(g.cierre?.total) || 0), 0);
  $: totalGeneralDiferencia = (totalGeneralCierre + totalGeneralDevoluciones) - (totalGeneralApertura + totalGeneralRellenos);

  function getSumAperturaChip(valor) {
    return mesaGroups.reduce((acc, g) => acc + (getChipCount(g.apertura, valor) || 0), 0);
  }
  function getSumRellenosChip(valor) {
    return mesaGroups.reduce((acc, g) => acc + (g.rellenosDevoluciones || []).filter(m => m.tipo === 'relleno').reduce((a, b) => a + getMovChipCount(b, valor), 0), 0);
  }
  function getSumDevolucionesChip(valor) {
    return mesaGroups.reduce((acc, g) => acc + (g.rellenosDevoluciones || []).filter(m => m.tipo === 'devolucion').reduce((a, b) => a + getMovChipCount(b, valor), 0), 0);
  }
  function getSumCierreChip(valor) {
    return mesaGroups.reduce((acc, g) => acc + (g.cierre ? (getChipCount(g.cierre, valor) || 0) : 0), 0);
  }
  function getDifTotalChip(valor) {
    const expected = getSumAperturaChip(valor) + getSumRellenosChip(valor) - getSumDevolucionesChip(valor);
    return getSumCierreChip(valor) - expected;
  }

  let unsubWs = null;

  onMount(() => {
    syncLocalEmpleados();
    setActualHoraApertura();
    unsubWs = subscribeToLibroUpdates(
      () => [libro?.uuid, libroId, libro?.id].filter(Boolean),
      ['arqueo_fichas'],
      () => {
        loadArqueoRecords(true);
      }
    );
    loadArqueoRecords();
  });

  onDestroy(() => {
    if (unsubWs) unsubWs();
  });
</script>

<div class="drop-layout-grid">
  <!-- Tarjeta Izquierda: Formulario "Apertura de mesas" -->
  <div class="card-form-drop">
    <div class="card-title-box">
      <h3 class="card-title">Apertura de mesas</h3>
      <div class="title-underline"></div>
    </div>

    <form on:submit|preventDefault={handleAperturar} class="drop-form">
      <!-- Selector de Mesas -->
      <div class="form-group">
        <label for="select-mesa" class="form-label">MESAS:</label>
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

      <!-- Responsable que Apertura (con autocompletado y coincidencia Tab ⇥) -->
      <div class="form-group">
        <label for="apertura-pitboss" class="form-label">Responsable:</label>
        <div class="cell-autocomplete-container">
          <input 
            id="apertura-pitboss" 
            type="text" 
            class="form-input {aperturaEmpSugTarget ? 'input-active' : ''}" 
            placeholder="Escriba Responsable (coincidencias con Tab ⇥)..." 
            value={empleadoAperturaNombre}
            on:focus={handleFocusAperturaEmp}
            on:input={(e) => handleInputAperturaEmp(e.target.value)}
            on:keydown={handleKeyDownAperturaEmp}
            on:blur={handleBlurAperturaEmp}
            autocomplete="off"
          />

          {#if aperturaEmpSugTarget && filteredAperturaEmpSuggestions.length > 0}
            <div class="inline-dropdown">
              <div class="inline-dropdown-header">
                <span>Coincidencias (<b>Tab ⇥</b> o clic):</span>
              </div>
              <ul class="inline-dropdown-list">
                {#each filteredAperturaEmpSuggestions as sug, idx}
                  <!-- svelte-ignore a11y-click-events-have-key-events -->
                  <li 
                    class="inline-dropdown-item {idx === aperturaEmpSugIndex ? 'selected' : ''}"
                    on:mousedown|preventDefault={() => selectAperturaEmpSuggestion(sug)}
                  >
                    <div class="sug-info">
                      <span class="sug-name">{sug.nombre}</span>
                      {#if sug.cargo_nombre}
                        <span class="sug-cargo">{sug.cargo_nombre}</span>
                      {/if}
                    </div>
                    <span class="sug-tab-badge">Tab ⇥</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      </div>

      <!-- Hora de Apertura con Botón Rayito ⚡ -->
      <div class="form-group">
        <div class="hora-header-line">
          <label for="apertura-hora" class="form-label">HORA APERTURA:</label>
          <button type="button" class="btn-mini-now" on:click={setActualHoraApertura} title="Poner hora actual">
            ⚡ Ahora
          </button>
        </div>
        <input id="apertura-hora" type="time" class="form-input" bind:value={horaApertura} />
      </div>

      <!-- Denominaciones de Fichas (Ordenadas de Mayor a Menor) -->
      <div class="denominaciones-grid">
        {#each salaFichas as valor}
          <div class="denom-field">
            <label for="denom-{valor}" class="denom-label">$ {valor}:</label>
            <input 
              id="denom-{valor}" 
              type="number" 
              min="0" 
              step="1"
              placeholder="0"
              class="denom-input" 
              bind:value={formQuantities[valor]}
            />
          </div>
        {/each}
      </div>

      <!-- Total Calculado en Vivo en el Formulario -->
      <div class="form-total-badge">
        <span class="total-badge-label">TOTAL APERTURA:</span>
        <span class="total-badge-amount">$ {formatMoney(formTotalCalculado)}</span>
      </div>

      <!-- Botón de Envío: "Aperturar" -->
      {#if canAdd || canEdit}
        <button 
          type="submit" 
          class="btn-guardar"
          disabled={isSaving || !selectedMesaId}
        >
          {#if isSaving}
            <span>Aperturando...</span>
          {:else}
            <span>Aperturar</span>
          {/if}
        </button>
      {/if}
    </form>
  </div>

  <!-- Tarjeta Derecha: Tabla de Arqueo de Fichas -->
  <div class="card-table-drop">
    <!-- Barra Superior con Sala y Fecha -->
    <div class="table-top-bar">
      <span>{tableHeaderTitle}</span>
    </div>

    <!-- Tabla de Contenido: 1 Sola Línea Consolidada por Mesa -->
    <div class="table-wrapper">
      <table class="drop-table arqueo-table">
        <thead>
          <tr>
            <th class="th-center th-num">N°</th>
            <th class="th-mesa">Mesa</th>
            {#each salaFichas as valor}
              <th class="th-center">$ {valor}</th>
            {/each}
            <th class="th-center th-total">Total</th>
            <th class="th-center th-acciones">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {#if isLoadingRecords}
            <tr>
              <td colspan={salaFichas.length + 4} class="empty-state-cell">
                <div class="loading-state-inline">
                  <div class="spinner-small"></div>
                  <span>Cargando arqueo de fichas...</span>
                </div>
              </td>
            </tr>
          {:else if mesaGroups.length === 0}
            <tr>
              <td colspan={salaFichas.length + 4} class="empty-state-cell">
                <div class="empty-msg-box">
                  <p class="empty-text">
                    No hay mesas arqueadas para esta fecha. Seleccione una mesa en el formulario de la izquierda e ingrese las cantidades para aperturar.
                  </p>
                </div>
              </td>
            </tr>
          {:else}
            {#each mesaGroups as group, idx (group.mesaId)}
              {@const apTotal = Number(group.apertura?.total) || 0}
              {@const hasCierre = Boolean(group.cierre)}
              {@const ciTotal = hasCierre ? (Number(group.cierre.total) || 0) : null}
              {@const allMovs = group.rellenosDevoluciones || []}
              {@const totalR = group.totalRellenos || 0}
              {@const totalD = group.totalDevoluciones || 0}
              {@const difTotal = hasCierre ? ((ciTotal + totalD) - (apTotal + totalR)) : null}
              {@const canLiquidar = allMovs.length === 0}
              {@const canEliminarMesa = allMovs.length === 0 && (!hasCierre || ciTotal === 0)}

              <tr class="drop-row single-mesa-row">
                <td class="td-center td-num">
                  <span class="index-num">{idx + 1}</span>
                </td>
                <td class="td-mesa">
                  <div class="mesa-title-cell">
                    <span class="mesa-main-name">{group.mesaNombre}</span>
                  </div>
                </td>
                {#each salaFichas as valor}
                  {@const apC = getChipCount(group.apertura, valor)}
                  {@const ciC = hasCierre ? getChipCount(group.cierre, valor) : null}
                  {@const rChips = allMovs.filter(m => m.tipo === 'relleno').reduce((a, b) => a + getMovChipCount(b, valor), 0)}
                  {@const dChips = allMovs.filter(m => m.tipo === 'devolucion').reduce((a, b) => a + getMovChipCount(b, valor), 0)}
                  {@const expected = (apC !== null ? apC : 0) + rChips - dChips}
                  {@const difChips = (hasCierre && ciC !== null && apC !== null) ? (ciC - expected) : null}
                  <td class="td-center count-val">
                    {#if difChips !== null}
                      <span 
                        class="dif-chips-val"
                        class:dif-pos={difChips > 0}
                        class:dif-neg={difChips < 0}
                        class:dif-zero={difChips === 0}
                      >
                        {difChips > 0 ? `+${difChips}` : (difChips < 0 ? `${difChips}` : '0')}
                      </span>
                    {:else}
                      <span class="val-pending">—</span>
                    {/if}
                  </td>
                {/each}
                <td class="td-center td-total-val dif-total-cell font-mono font-bold">
                  {#if difTotal !== null}
                    <span 
                      class="dif-monto-badge"
                      class:dif-pos={difTotal > 0}
                      class:dif-neg={difTotal < 0}
                      class:dif-neu={difTotal === 0}
                    >
                      {difTotal < 0 ? `( - $${formatMoney(Math.abs(difTotal))} )` : `$ ${formatMoney(difTotal)}`}
                    </span>
                  {:else}
                    <span class="val-pending">—</span>
                  {/if}
                </td>
                <td class="td-center td-acciones-cell">
                  <button 
                    type="button" 
                    class="btn-action-pill btn-action-opciones"
                    on:click={() => handleOpenOpcionesModal(group)}
                    title="Opciones de la mesa (Fills, Creds, Cierre, Liquidar, Nota y Eliminar)"
                  >
                    Opciones
                  </button>
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>

        <!-- Fila de Totales Generales -->
        {#if mesaGroups.length > 0}
          <tfoot>
            <tr class="total-row footer-apertura">
              <td colspan="2" class="total-label-cell">TOTAL APERTURA</td>
              {#each salaFichas as valor}
                <td class="td-center total-val-cell">{getSumAperturaChip(valor)}</td>
              {/each}
              <td class="td-center grand-total-cell ap-grand-total">
                $ {formatMoney(totalGeneralApertura)}
              </td>
              <td></td>
            </tr>

            {#if totalGeneralRellenos > 0}
              <tr class="total-row footer-rellenos">
                <td colspan="2" class="total-label-cell">TOTAL FILL</td>
                {#each salaFichas as valor}
                  {@const sumR = getSumRellenosChip(valor)}
                  <td class="td-center total-val-cell font-mono">{sumR > 0 ? sumR : '—'}</td>
                {/each}
                <td class="td-center grand-total-cell text-blue">
                  $ {formatMoney(totalGeneralRellenos)}
                </td>
                <td></td>
              </tr>
            {/if}

            {#if totalGeneralDevoluciones > 0}
              <tr class="total-row footer-devoluciones">
                <td colspan="2" class="total-label-cell">TOTAL CRED</td>
                {#each salaFichas as valor}
                  {@const sumD = getSumDevolucionesChip(valor)}
                  <td class="td-center total-val-cell font-mono">{sumD > 0 ? sumD : '—'}</td>
                {/each}
                <td class="td-center grand-total-cell text-purple">
                  $ {formatMoney(totalGeneralDevoluciones)}
                </td>
                <td></td>
              </tr>
            {/if}

            <tr class="total-row footer-cierre">
              <td colspan="2" class="total-label-cell">TOTAL CIERRE</td>
              {#each salaFichas as valor}
                <td class="td-center total-val-cell">{getSumCierreChip(valor)}</td>
              {/each}
              <td class="td-center grand-total-cell ci-grand-total">
                $ {formatMoney(totalGeneralCierre)}
              </td>
              <td></td>
            </tr>

            <tr class="total-row footer-diferencia">
              <td colspan="2" class="total-label-cell">TOTAL FINAL</td>
              {#each salaFichas as valor}
                {@const dif = getDifTotalChip(valor)}
                <td class="td-center total-val-cell">
                  <span class:dif-pos={dif > 0} class:dif-neg={dif < 0}>
                    {Math.abs(dif)}
                  </span>
                </td>
              {/each}
              <td class="td-center grand-total-cell dif-grand-total">
                <span class:dif-pos={totalGeneralDiferencia > 0} class:dif-neg={totalGeneralDiferencia < 0}>
                  {totalGeneralDiferencia < 0 ? `( - $${formatMoney(Math.abs(totalGeneralDiferencia))} )` : `$ ${formatMoney(totalGeneralDiferencia)}`}
                </span>
              </td>
              <td></td>
            </tr>
          </tfoot>
        {/if}
      </table>
    </div>
  </div>
</div>

<!-- Modal de Cierre ("Arquear") -->
<ArqueoCierreModal 
  show={isModalOpen}
  mesa={modalMesa}
  {libro}
  {libroId}
  {multisalaUuid}
  aperturaRecord={modalAperturaRecord}
  cierreRecord={modalCierreRecord}
  availableDenominaciones={salaFichas}
  {listaEmpleados}
  on:close={handleCloseCierreModal}
  on:saved={handleCierreSaved}
/>

<!-- Modal de Rellenos y Devoluciones -->
<RellenoDevolucionModal
  show={isRDModalOpen}
  mesa={rdModalMesa}
  {libro}
  {libroId}
  {multisalaUuid}
  aperturaRecord={rdModalApertura}
  availableDenominaciones={salaFichas}
  initialTipo={rdModalTipo}
  {listaEmpleados}
  on:close={handleCloseRDModal}
  on:saved={handleRDSaved}
/>

<!-- Modal de Opciones de la Mesa -->
{#if isOpcionesModalOpen && selectedOpcionesGroup}
  {@const apTotal = Number(selectedOpcionesGroup.apertura?.total) || 0}
  {@const hasCierre = Boolean(selectedOpcionesGroup.cierre)}
  {@const ciTotal = hasCierre ? (Number(selectedOpcionesGroup.cierre.total) || 0) : null}
  {@const allMovs = selectedOpcionesGroup.rellenosDevoluciones || []}
  {@const totalR = selectedOpcionesGroup.totalRellenos || 0}
  {@const totalD = selectedOpcionesGroup.totalDevoluciones || 0}
  {@const difTotal = hasCierre ? ((ciTotal + totalD) - (apTotal + totalR)) : null}
  {@const canLiquidarGroup = allMovs.length === 0 && Boolean(selectedOpcionesGroup.apertura)}
  {@const canEliminarGroup = allMovs.length === 0 && (!hasCierre || ciTotal === 0)}

  <div class="modal-backdrop" on:click|self|preventDefault|stopPropagation={() => {}}>
    <div class="modal-card modal-opciones-card">
      <!-- Modal Header -->
      <div class="modal-header">
        <div class="modal-header-info">
          <div class="header-badges-row">
            <span class="header-badge">Control de Mesa</span>
            {#if selectedOpcionesGroup.juegoNombre}
              <span class="badge-juego">{selectedOpcionesGroup.juegoNombre}</span>
            {/if}
          </div>
          <h3 class="header-main-title">
            Opciones: <span class="mesa-highlight">{selectedOpcionesGroup.mesaNombre}</span>
          </h3>
          <p class="header-sub">
            Balance general &bull; Total Neto: 
            <strong class={difTotal !== null ? (difTotal > 0 ? 'text-green' : (difTotal < 0 ? 'text-red' : 'text-neutral')) : ''}>
              {difTotal !== null ? (difTotal < 0 ? `( - ${formatMoney(Math.abs(difTotal))} )` : `$ ${formatMoney(difTotal)}`) : '—'}
            </strong>
          </p>
        </div>
        <button type="button" class="btn-close" on:click={handleCloseOpcionesModal} title="Cerrar">✕</button>
      </div>

      <!-- Modal Body -->
      <div class="modal-body modal-opciones-body">
        <!-- 3 Botones Principales: Fill, Cierre, Cred -->
        <div class="opciones-action-buttons-grid">
          <button 
            type="button" 
            class="btn-opc-action btn-opc-fill"
            on:click={() => {
              handleOpenRellenoModal('relleno', selectedOpcionesGroup.mesaObj || { uuid: selectedOpcionesGroup.mesaId, id: selectedOpcionesGroup.mesaId, nombre: selectedOpcionesGroup.mesaNombre, juego_nombre: selectedOpcionesGroup.juegoNombre }, selectedOpcionesGroup.apertura, true);
            }}
          >
            <div class="opc-btn-text">
              <span class="opc-title">FILL</span>
              <span class="opc-sub">Relleno de Mesa</span>
            </div>
          </button>

          <button 
            type="button" 
            class="btn-opc-action btn-opc-cierre"
            on:click={() => {
              handleOpenCierreModal(selectedOpcionesGroup);
            }}
          >
            <div class="opc-btn-text">
              <span class="opc-title">CIERRE</span>
              <span class="opc-sub">Arquear Mesa</span>
            </div>
          </button>

          <button 
            type="button" 
            class="btn-opc-action btn-opc-cred"
            on:click={() => {
              handleOpenRellenoModal('devolucion', selectedOpcionesGroup.mesaObj || { uuid: selectedOpcionesGroup.mesaId, id: selectedOpcionesGroup.mesaId, nombre: selectedOpcionesGroup.mesaNombre, juego_nombre: selectedOpcionesGroup.juegoNombre }, selectedOpcionesGroup.apertura, true);
            }}
          >
            <div class="opc-btn-text">
              <span class="opc-title">CRED</span>
              <span class="opc-sub">Devolución</span>
            </div>
          </button>
        </div>

        <!-- 3 Botones Secundarios: Liquidar, Nota, Eliminar -->
        <div class="opciones-secondary-buttons-grid">
          <button 
            type="button" 
            class="btn-opc-sec btn-opc-sec-liquidar"
            disabled={!canLiquidarGroup}
            on:click={() => handleLiquidarMesa(selectedOpcionesGroup)}
            title={canLiquidarGroup ? "Liquidar mesa (Cierre = Apertura)" : "Deshabilitado porque la mesa tiene Fills o Creds"}
          >
            <div class="sec-text">
              <span class="sec-title">Liquidar</span>
              <span class="sec-sub">Cierre = Apertura</span>
            </div>
          </button>

          <button 
            type="button" 
            class="btn-opc-sec btn-opc-sec-nota"
            on:click={() => handleOpenNotaModal(selectedOpcionesGroup)}
            title="Agregar o editar nota a la mesa"
          >
            <div class="sec-text">
              <span class="sec-title">Nota</span>
              <span class="sec-sub">{selectedOpcionesGroup.apertura?.nota ? 'Editar Nota' : 'Agregar Nota'}</span>
            </div>
          </button>

          {#if canDelete}
            <button 
              type="button" 
              class="btn-opc-sec btn-opc-sec-eliminar"
              disabled={!canEliminarGroup}
              on:click={async () => {
                if (confirm(`¿Está seguro de eliminar el registro de arqueo de "${selectedOpcionesGroup.mesaNombre}"?`)) {
                  const toDelete = selectedOpcionesGroup;
                  handleCloseOpcionesModal();
                  await handleEliminarMesa(toDelete);
                }
              }}
              title={canEliminarGroup ? "Eliminar registro de esta mesa" : "Solo se puede eliminar si la mesa únicamente tiene apertura"}
            >
              <div class="sec-text">
                <span class="sec-title">Eliminar</span>
                <span class="sec-sub">Quitar Arqueo</span>
              </div>
            </button>
          {/if}
        </div>

        <!-- Visualizador de Nota si existe -->
        {#if selectedOpcionesGroup.apertura?.nota}
          <div class="nota-display-box">
            <span class="nota-display-label">Nota registrada:</span>
            <p class="nota-display-text">{selectedOpcionesGroup.apertura.nota}</p>
          </div>
        {/if}

        <!-- Tabla detallada de la Mesa: Apertura, Fills, Creds, Cierre, Total -->
        <div class="opciones-table-container">
          <div class="opciones-table-header-title">
            <span>Historial y Estado Detallado de la Mesa</span>
          </div>
          <table class="opciones-detail-table">
            <thead>
              <tr>
                <th class="th-left">Operación</th>
                <th class="th-center">Hora</th>
                <th class="th-left">Responsable</th>
                {#each salaFichas as valor}
                  <th class="th-center">$ {valor}</th>
                {/each}
                <th class="th-right">Total</th>
              </tr>
            </thead>
            <tbody>
              <!-- 1. Apertura -->
              <tr class="opc-row-apertura">
                <td class="td-left">
                  <span class="mov-badge mov-apertura">Apertura</span>
                </td>
                <td class="td-center font-mono">
                  {selectedOpcionesGroup.apertura?.hora_apertura || '—'}
                </td>
                <td class="td-left emp-name-cell">
                  {selectedOpcionesGroup.apertura?.empleado_apertura_nombre || '—'}
                </td>
                {#each salaFichas as valor}
                  {@const apCount = getChipCount(selectedOpcionesGroup.apertura, valor)}
                  <td class="td-center count-val">
                    {apCount !== null ? apCount : '—'}
                  </td>
                {/each}
                <td class="td-right total-val font-mono font-bold">
                  $ {formatMoney(apTotal)}
                </td>
              </tr>

              <!-- 2. Movimientos Fills y Creds -->
              {#each allMovs as mov}
                <tr class="opc-row-mov" class:row-relleno={mov.tipo === 'relleno'} class:row-devolucion={mov.tipo === 'devolucion'}>
                  <td class="td-left">
                    <span class="mov-badge {mov.tipo === 'relleno' ? 'mov-relleno' : 'mov-devolucion'}">
                      {formatMovBadge(mov, allMovs)}
                    </span>
                  </td>
                  <td class="td-center font-mono">
                    {mov.hora || '—'}
                  </td>
                  <td class="td-left emp-name-cell">
                    {mov.empleado_nombre || '—'}
                  </td>
                  {#each salaFichas as valor}
                    {@const count = getMovChipCount(mov, valor)}
                    <td class="td-center count-val font-mono">
                      {count > 0 ? count : '—'}
                    </td>
                  {/each}
                  <td class="td-right total-val font-mono font-bold {mov.tipo === 'relleno' ? 'text-blue' : 'text-purple'}">
                    $ {formatMoney(mov.total)}
                  </td>
                </tr>
              {/each}

              <!-- 3. Cierre -->
              <tr class="opc-row-cierre">
                <td class="td-left">
                  <span class="mov-badge {hasCierre ? 'mov-cierre' : 'mov-pendiente'}">Cierre</span>
                </td>
                <td class="td-center font-mono">
                  {selectedOpcionesGroup.cierre?.hora_cierre || selectedOpcionesGroup.apertura?.hora_cierre || '—'}
                </td>
                <td class="td-left emp-name-cell">
                  {selectedOpcionesGroup.cierre?.empleado_cierre_nombre || selectedOpcionesGroup.apertura?.empleado_cierre_nombre || '—'}
                </td>
                {#each salaFichas as valor}
                  {@const ciCount = hasCierre ? getChipCount(selectedOpcionesGroup.cierre, valor) : null}
                  <td class="td-center count-val" class:val-pending={!hasCierre}>
                    {ciCount !== null ? ciCount : '—'}
                  </td>
                {/each}
                <td class="td-right total-val font-mono font-bold">
                  {hasCierre ? `$ ${formatMoney(ciTotal)}` : '—'}
                </td>
              </tr>

              <!-- 4. Total (Diferencia) -->
              <tr class="opc-row-total">
                <td class="td-left font-bold" colspan="3">
                  <span class="mov-badge mov-diferencia">TOTAL (DIFERENCIA)</span>
                </td>
                {#each salaFichas as valor}
                  {@const apC = getChipCount(selectedOpcionesGroup.apertura, valor)}
                  {@const ciC = hasCierre ? getChipCount(selectedOpcionesGroup.cierre, valor) : null}
                  {@const rChips = allMovs.filter(m => m.tipo === 'relleno').reduce((a, b) => a + getMovChipCount(b, valor), 0)}
                  {@const dChips = allMovs.filter(m => m.tipo === 'devolucion').reduce((a, b) => a + getMovChipCount(b, valor), 0)}
                  {@const expected = (apC !== null ? apC : 0) + rChips - dChips}
                  {@const difChips = (hasCierre && ciC !== null && apC !== null) ? (ciC - expected) : null}
                  <td class="td-center count-val">
                    {#if difChips !== null}
                      <span 
                        class="dif-chips-val"
                        class:dif-pos={difChips > 0}
                        class:dif-neg={difChips < 0}
                        class:dif-zero={difChips === 0}
                      >
                        {difChips > 0 ? `+${difChips}` : (difChips < 0 ? `${difChips}` : '0')}
                      </span>
                    {:else}
                      <span class="val-pending">—</span>
                    {/if}
                  </td>
                {/each}
                <td class="td-right total-val font-mono font-bold">
                  {#if difTotal !== null}
                    <span 
                      class="dif-monto-badge"
                      class:dif-pos={difTotal > 0}
                      class:dif-neg={difTotal < 0}
                      class:dif-neu={difTotal === 0}
                    >
                      {difTotal < 0 ? `( - ${formatMoney(Math.abs(difTotal))} )` : `$ ${formatMoney(difTotal)}`}
                    </span>
                  {:else}
                    <span class="val-pending">—</span>
                  {/if}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Modal Footer -->
      <div class="modal-footer">
        <button type="button" class="btn-cancelar" on:click={handleCloseOpcionesModal}>
          Cerrar
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Modal Separada de Nota para la Mesa -->
{#if isNotaModalOpen && selectedNotaGroup}
  <div class="modal-backdrop" on:click|self|preventDefault|stopPropagation={() => {}}>
    <div class="modal-card modal-nota-card">
      <div class="modal-header">
        <div class="modal-header-info">
          <span class="header-badge">Nota de Mesa</span>
          <h3 class="header-main-title">{selectedNotaGroup.mesaNombre}</h3>
        </div>
        <button type="button" class="btn-close" on:click={handleCloseNotaModal} title="Cerrar">✕</button>
      </div>
      <div class="modal-body" style="padding: 20px 24px;">
        <div class="form-group" style="margin-bottom: 0;">
          <label for="textarea-nota-modal" class="form-label font-bold" style="margin-bottom: 8px; font-size: 12px; color: #475569;">
            NOTA / OBSERVACIÓN DE LA MESA:
          </label>
          <textarea 
            id="textarea-nota-modal"
            class="nota-textarea"
            placeholder="Escriba aquí la nota o novedad relevante para esta mesa..."
            bind:value={notaTexto}
            rows="4"
          ></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-cancelar" on:click={handleCloseNotaModal}>
          Cancelar
        </button>
        <button type="button" class="btn-guardar-nota" on:click={handleGuardarNota}>
          Guardar Nota
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ─────────────────────────────────────────────────────────────
     Diseño General Grid (2 Columnas: Formulario Izq + Tabla Der)
  ───────────────────────────────────────────────────────────── */
  .drop-layout-grid {
    display: grid;
    grid-template-columns: 310px 1fr;
    gap: 24px;
    align-items: start;
    width: 100%;
    margin-top: 10px;
  }

  @media (max-width: 1024px) {
    .drop-layout-grid {
      grid-template-columns: 1fr;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     Tarjeta Izquierda: Formulario "Arqueo"
  ───────────────────────────────────────────────────────────── */
  .card-form-drop {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 24px 20px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  }

  .card-title-box {
    margin-bottom: 20px;
  }

  .card-title {
    margin: 0 0 8px 0;
    font-size: 18px;
    font-weight: 800;
    color: #1e293b;
    letter-spacing: -0.3px;
  }

  .title-underline {
    width: 100%;
    height: 3px;
    background-color: #3b82f6;
    border-radius: 2px;
  }

  .drop-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-label {
    font-size: 12.5px;
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
    gap: 12px 14px;
    max-height: 380px;
    overflow-y: auto;
    padding-right: 4px;
  }

  .denom-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .denom-label {
    font-size: 12.5px;
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

  /* Badge de Total Calculado */
  .form-total-badge {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #f1f5f9;
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid #cbd5e1;
  }

  .total-badge-label {
    font-size: 11px;
    font-weight: 700;
    color: #475569;
  }

  .total-badge-amount {
    font-size: 14px;
    font-weight: 800;
    color: #16a34a;
  }

  /* Botón Aperturar Verde */
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
     Tarjeta Derecha: Tabla
  ───────────────────────────────────────────────────────────── */
  .card-table-drop {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  }

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

  .drop-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    text-align: left;
  }

  .drop-table thead tr {
    background: #2b3544;
    color: #ffffff;
  }

  .drop-table th {
    padding: 12px 12px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.2px;
    white-space: nowrap;
  }

  .th-center {
    text-align: center;
  }

  .th-num {
    width: 45px;
  }

  .th-mesa {
    min-width: 95px;
    max-width: 130px;
  }

  .th-movimiento {
    width: 82px;
    min-width: 80px;
  }

  .th-total {
    min-width: 100px;
  }

  .th-acciones {
    width: 110px;
  }

  /* Filas de la Tabla */
  .drop-row {
    border-bottom: 1px solid #f1f5f9;
    transition: background 0.15s ease;
  }

  .drop-row:hover {
    background: #f8fafc;
  }

  .mesa-first-row {
    border-top: 2px solid #cbd5e1;
  }

  .mesa-last-row {
    border-bottom: 2px solid #cbd5e1;
  }

  .drop-table td {
    padding: 7px 10px;
    color: #1e293b;
    font-size: 12.5px;
    white-space: nowrap;
    vertical-align: middle;
  }

  .td-center {
    text-align: center;
  }

  .td-num {
    vertical-align: middle;
    background: #fafafa;
    border-right: 1px solid #e2e8f0;
  }

  .index-num {
    font-weight: 800;
    color: #64748b;
    font-size: 13px;
  }

  .td-mesa {
    vertical-align: middle;
    background: #fafafa;
    border-right: 1px solid #e2e8f0;
  }

  .mesa-title-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mesa-main-name {
    font-weight: 800;
    color: #0f172a;
    font-size: 13.5px;
  }

  .mesa-sub-juego {
    font-size: 11px;
    color: #64748b;
    font-weight: 500;
  }

  .td-movimiento {
    padding: 6px 4px !important;
  }

  /* Badges de Movimiento */
  .mov-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2.5px 8px;
    min-width: 62px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 800;
    white-space: nowrap;
    letter-spacing: 0.2px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .mov-apertura {
    background: #e0f2fe;
    color: #0369a1;
    border: 1px solid #bae6fd;
  }

  .mov-cierre {
    background: #ede9fe;
    color: #6d28d9;
    border: 1px solid #ddd6fe;
  }

  .mov-pendiente {
    background: #fef3c7;
    color: #b45309;
    border: 1px solid #fde68a;
  }

  .mov-diferencia {
    background: #f1f5f9;
    color: #334155;
    border: 1px solid #cbd5e1;
  }

  .mov-relleno {
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #93c5fd;
  }

  .mov-devolucion {
    background: #faf5ff;
    color: #7e22ce;
    border: 1px solid #d8b4fe;
  }

  .text-blue {
    color: #2563eb !important;
  }

  .text-purple {
    color: #9333ea !important;
  }

  .count-val {
    font-weight: 600;
    color: #334155;
  }

  .val-pending {
    color: #94a3b8;
    font-weight: 400;
  }

  .ap-total-cell {
    font-weight: 700;
    color: #0369a1;
  }

  .ci-total-cell {
    font-weight: 700;
    color: #6d28d9;
  }

  .dif-total-cell {
    font-weight: 800;
  }

  .dif-chips-val {
    font-weight: 700;
    font-size: 11.5px;
  }

  .dif-chips-val.dif-pos,
  .dif-pos {
    color: #16a34a !important;
  }

  .dif-chips-val.dif-neg,
  .dif-neg {
    color: #dc2626 !important;
  }

  .dif-neu {
    color: #64748b !important;
  }

  .dif-monto-badge {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 800;
  }

  /* Columna de Acciones */
  .td-acciones-cell {
    vertical-align: middle;
    background: #fafafa;
    border-left: 1px solid #e2e8f0;
  }

  .acciones-btn-col {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: center;
    justify-content: center;
    padding: 4px 0;
  }

  .btn-table-fill,
  .btn-table-cred,
  .btn-arquear,
  .btn-liquidar,
  .btn-eliminar {
    width: 78px;
    border-radius: 4px;
    padding: 4.5px 8px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: center;
    box-sizing: border-box;
    line-height: 1.2;
  }

  .btn-table-fill {
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #93c5fd;
    box-shadow: 0 1px 2px rgba(37, 99, 235, 0.1);
  }

  .btn-table-fill:hover {
    background: #dbeafe;
    border-color: #3b82f6;
  }

  .btn-table-cred {
    background: #faf5ff;
    color: #7e22ce;
    border: 1px solid #d8b4fe;
    box-shadow: 0 1px 2px rgba(126, 34, 206, 0.1);
  }

  .btn-table-cred:hover {
    background: #f3e8ff;
    border-color: #a855f7;
  }

  .btn-arquear {
    background: #2563eb;
    color: #ffffff;
    border: 1px solid #1d4ed8;
    box-shadow: 0 1px 2px rgba(37, 99, 235, 0.25);
  }

  .btn-arquear:hover {
    background: #1d4ed8;
  }

  .btn-liquidar {
    background: #059669;
    color: #ffffff;
    border: 1px solid #047857;
    box-shadow: 0 1px 2px rgba(5, 150, 105, 0.25);
  }

  .btn-liquidar:hover {
    background: #047857;
  }

  .btn-eliminar {
    background: #dc2626;
    color: #ffffff;
    border: 1px solid #b91c1c;
    box-shadow: 0 1px 2px rgba(220, 38, 38, 0.25);
  }

  .btn-eliminar:hover {
    background: #b91c1c;
  }

  /* Footer de Totales Generales */
  .total-row {
    background: #f8fafc;
    font-weight: 700;
  }

  .footer-apertura {
    border-top: 2px solid #94a3b8;
  }

  .footer-diferencia {
    border-bottom: 2px solid #94a3b8;
    background: #f1f5f9;
  }

  .total-row td {
    padding: 9px 10px;
    font-size: 12.5px;
    color: #0f172a;
  }

  .total-label-cell {
    font-weight: 800;
    letter-spacing: 0.5px;
    color: #0f172a;
    padding-left: 14px !important;
  }

  .total-val-cell {
    font-weight: 700;
    color: #0f172a;
  }

  .grand-total-cell {
    font-weight: 800;
    font-size: 13.5px;
  }

  .ap-grand-total {
    color: #0369a1 !important;
  }

  .ci-grand-total {
    color: #6d28d9 !important;
  }

  .dif-grand-total {
    font-size: 14px;
  }

  /* Estados Vacíos y Carga */
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
    max-width: 440px;
    margin: 0 auto;
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
    width: 16px;
    height: 16px;
    border: 2px solid #cbd5e1;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Estilos para Fila única consolidada y Acciones */
  .single-mesa-row {
    transition: background 0.15s ease;
  }
  .single-mesa-row:hover {
    background: #f8fafc;
  }
  .mesa-hora-tag {
    display: inline-block;
    font-size: 10.5px;
    color: #64748b;
    background: #f1f5f9;
    padding: 1px 6px;
    border-radius: 4px;
    margin-top: 2px;
    font-family: monospace;
  }
  .acciones-btn-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex-wrap: nowrap;
  }
  .btn-action-pill {
    padding: 5px 12px;
    font-size: 11.5px;
    font-weight: 700;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    border: 1px solid transparent;
    white-space: nowrap;
  }
  .btn-action-liquidar {
    background: #ecfdf5;
    color: #047857;
    border-color: #a7f3d0;
  }
  .btn-action-liquidar:hover:not(:disabled) {
    background: #d1fae5;
    border-color: #6ee7b7;
  }
  .btn-action-liquidar:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    background: #f1f5f9;
    color: #94a3b8;
    border-color: #e2e8f0;
  }
  .btn-action-opciones {
    background: #eff6ff;
    color: #1d4ed8;
    border-color: #bfdbfe;
  }
  .btn-action-opciones:hover {
    background: #dbeafe;
    border-color: #93c5fd;
  }
  .btn-action-eliminar {
    background: #fef2f2;
    color: #dc2626;
    border-color: #fecaca;
  }
  .btn-action-eliminar:hover:not(:disabled) {
    background: #fee2e2;
    border-color: #fca5a5;
  }
  .btn-action-eliminar:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    background: #f8fafc;
    color: #cbd5e1;
    border-color: #f1f5f9;
  }

  /* Rayo y Autocompletado en Apertura */
  .hora-header-line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2px;
  }
  .btn-mini-now {
    background: none;
    border: none;
    color: #2563eb;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
    transition: color 0.15s ease;
  }
  .btn-mini-now:hover {
    color: #1d4ed8;
    text-decoration: underline;
  }
  .cell-autocomplete-container {
    position: relative;
    width: 100%;
  }
  .form-input {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    font-size: 13px;
    color: #1e293b;
    background: #ffffff;
    box-sizing: border-box;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .form-input:focus, .form-input.input-active {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
    outline: none;
  }
  .inline-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15);
    z-index: 10000;
    max-height: 320px;
    overflow-y: auto;
  }
  .inline-dropdown-header {
    padding: 6px 10px;
    background: #f1f5f9;
    font-size: 11px;
    color: #64748b;
    border-bottom: 1px solid #e2e8f0;
  }
  .inline-dropdown-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .inline-dropdown-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    cursor: pointer;
    border-bottom: 1px solid #f8fafc;
    transition: background 0.12s;
  }
  .inline-dropdown-item:hover, .inline-dropdown-item.selected {
    background: #eff6ff;
  }
  .sug-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .sug-name {
    font-size: 12.5px;
    font-weight: 600;
    color: #1e293b;
  }
  .sug-cargo {
    font-size: 11px;
    color: #64748b;
  }
  .sug-tab-badge {
    background: #e2e8f0;
    color: #475569;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
  }

  /* Modal de Opciones de Mesa */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 16px;
  }
  .modal-opciones-card {
    background: #ffffff;
    border-radius: 16px;
    box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.25);
    width: 100%;
    max-width: 900px;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #e2e8f0;
  }
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 20px 24px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }
  .modal-header-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .header-badges-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 2px;
  }
  .header-badge {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .header-main-title {
    margin: 0;
    font-size: 19px;
    font-weight: 800;
    color: #0f172a;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .mesa-highlight {
    color: #2563eb;
  }
  .header-sub {
    margin: 0;
    font-size: 12.5px;
    color: #64748b;
  }
  .modal-opciones-body {
    padding: 20px 24px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .opciones-action-buttons-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .btn-opc-action {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
    background: #ffffff;
    cursor: pointer;
    transition: all 0.18s ease;
    text-align: left;
  }
  .btn-opc-fill {
    background: #eff6ff;
    border-color: #bfdbfe;
    color: #1e40af;
  }
  .btn-opc-fill:hover {
    background: #dbeafe;
    border-color: #93c5fd;
    transform: translateY(-1px);
  }
  .btn-opc-cierre {
    background: #ecfdf5;
    border-color: #a7f3d0;
    color: #065f46;
  }
  .btn-opc-cierre:hover {
    background: #d1fae5;
    border-color: #6ee7b7;
    transform: translateY(-1px);
  }
  .btn-opc-cred {
    background: #faf5ff;
    border-color: #e9d5ff;
    color: #6b21a8;
  }
  .btn-opc-cred:hover {
    background: #f3e8ff;
    border-color: #d8b4fe;
    transform: translateY(-1px);
  }
  .opc-btn-icon {
    font-size: 20px;
  }
  .opc-btn-text {
    display: flex;
    flex-direction: column;
  }
  .opc-title {
    font-size: 13.5px;
    font-weight: 800;
    letter-spacing: 0.5px;
  }
  .opc-sub {
    font-size: 11px;
    opacity: 0.85;
  }

  /* Fila de 3 Botones Secundarios: Liquidar, Nota, Eliminar */
  .opciones-secondary-buttons-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .btn-opc-sec {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
  }
  .btn-opc-sec:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    background: #f1f5f9;
    border-color: #e2e8f0;
  }
  .btn-opc-sec-liquidar {
    background: #f0fdf4;
    border-color: #bbf7d0;
    color: #15803d;
  }
  .btn-opc-sec-liquidar:hover:not(:disabled) {
    background: #dcfce7;
    border-color: #86efac;
    transform: translateY(-1px);
  }
  .btn-opc-sec-nota {
    background: #fffbeb;
    border-color: #fde68a;
    color: #b45309;
  }
  .btn-opc-sec-nota:hover:not(:disabled), .btn-opc-sec-nota.active {
    background: #fef3c7;
    border-color: #fcd34d;
    transform: translateY(-1px);
  }
  .btn-opc-sec-eliminar {
    background: #fef2f2;
    border-color: #fecaca;
    color: #b91c1c;
  }
  .btn-opc-sec-eliminar:hover:not(:disabled) {
    background: #fee2e2;
    border-color: #fca5a5;
    transform: translateY(-1px);
  }
  .sec-icon {
    font-size: 18px;
  }
  .sec-text {
    display: flex;
    flex-direction: column;
  }
  .sec-title {
    font-size: 12.5px;
    font-weight: 800;
  }
  .sec-sub {
    font-size: 10.5px;
    opacity: 0.85;
  }

  /* Sección de Nota */
  .nota-section-container {
    width: 100%;
  }
  .btn-nota-full {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 11px 16px;
    background: #f8fafc;
    border: 1px dashed #cbd5e1;
    border-radius: 10px;
    color: #334155;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn-nota-full:hover {
    background: #f1f5f9;
    border-color: #94a3b8;
    color: #0f172a;
  }
  .nota-preview-chip {
    background: #dbeafe;
    color: #1e40af;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 12px;
  }
  .nota-display-box {
    margin-top: 8px;
    padding: 10px 14px;
    background: #fffbeb;
    border: 1px solid #fef3c7;
    border-left: 4px solid #f59e0b;
    border-radius: 6px;
  }
  .nota-display-label {
    font-size: 10.5px;
    font-weight: 800;
    text-transform: uppercase;
    color: #b45309;
    letter-spacing: 0.5px;
  }
  .nota-display-text {
    margin: 4px 0 0;
    font-size: 12.5px;
    color: #78350f;
    line-height: 1.4;
  }
  .nota-editor-box {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
  }
  .nota-editor-label {
    font-size: 11.5px;
    font-weight: 700;
    color: #475569;
  }
  .nota-textarea {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    font-size: 13px;
    color: #1e293b;
    background: #ffffff;
    box-sizing: border-box;
    font-family: inherit;
  }
  .nota-editor-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .btn-nota-cancel {
    padding: 6px 14px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    color: #64748b;
    cursor: pointer;
  }
  .btn-nota-save {
    padding: 6px 16px;
    background: #2563eb;
    border: 1px solid #1d4ed8;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    color: #ffffff;
    cursor: pointer;
  }

  /* Tabla de Detalle en Modal de Opciones */
  .opciones-table-container {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
  }
  .opciones-table-header-title {
    padding: 10px 14px;
    background: #0f172a;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .opciones-detail-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .opciones-detail-table th {
    background: #1e293b;
    color: #94a3b8;
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    border-bottom: 1px solid #334155;
  }
  .opciones-detail-table td {
    padding: 8px 12px;
    border-bottom: 1px solid #f1f5f9;
  }
  .opc-row-apertura {
    background: #ffffff;
  }
  .opc-row-cierre {
    background: #f8fafc;
  }
  .opc-row-total {
    background: #f1f5f9;
    font-weight: 700;
    border-top: 2px solid #cbd5e1;
  }
  .badge-juego {
    background: #dbeafe;
    color: #1e40af;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
  }
  .emp-name-cell {
    font-size: 12px;
    font-weight: 600;
    color: #1e293b;
  }
  .text-green { color: #16a34a !important; }
  .text-red { color: #dc2626 !important; }
  .text-neutral { color: #475569 !important; }
  .btn-close {
    background: transparent;
    border: none;
    font-size: 16px;
    color: #64748b;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
  }
  .btn-close:hover {
    background: #fee2e2;
    color: #ef4444;
  }
  .btn-cancelar {
    padding: 8px 18px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    color: #475569;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-cancelar:hover {
    background: #f1f5f9;
    color: #0f172a;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 12px;
    padding: 14px 24px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
  }
  .modal-nota-card {
    background: #ffffff;
    border-radius: 16px;
    box-shadow: 0 20px 40px -10px rgba(0, 0, 0, 0.25);
    width: 100%;
    max-width: 520px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #e2e8f0;
  }
  .btn-guardar-nota {
    padding: 8px 18px;
    background: #16a34a;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-guardar-nota:hover {
    background: #15803d;
  }
</style>

