<script>
  import { onMount, onDestroy } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { subscribeToLibroUpdates } from '../../controllers/websocket.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { 
    masterMesasStore, 
    masterSalasStore, 
    masterJuegosStore, 
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
    prevMultisala = multisalaUuid;
    selectedMesaId = '';
    limpiarFormulario();
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
    if (isNaN(num)) return '0.00';
    return Number(num).toLocaleString('en-US', {
      minimumFractionDigits: 2,
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
      // Cargar cantidades guardadas en apertura
      const fList = Array.isArray(existingApertura.fichas)
        ? existingApertura.fichas
        : (typeof existingApertura.fichas === 'string' ? JSON.parse(existingApertura.fichas || '[]') : []);

      for (const f of fList) {
        const v = Number(f.valor ?? f.denominacion);
        if (v > 0) newQuantities[v] = f.cantidad ?? 0;
      }
    } else {
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
        r.tipo === 'apertura'
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
        total,
        mesa_nombre: mesaObj?.nombre || '',
        juego_nombre: mesaObj?.juego_nombre || '',
        updated_at: new Date().toISOString()
      };

      // Si no existe registro de cierre para esta mesa, inicializarlo automáticamente a 0 fichas
      const existingCierre = arqueoRecords.find(r => 
        String(r.mesa_uuid || r.mesa_id) === String(selectedMesaId) && 
        r.tipo === 'cierre' && !r.is_deleted
      );

      let newCierreRecord = null;
      if (!existingCierre) {
        const cierreUuid = generateSafeUuid();
        const cierreFichasPayload = salaFichas.map(valor => ({
          valor,
          cantidad: 0,
          total: 0
        })).filter(f => f.valor > 0).sort((a, b) => b.valor - a.valor);

        newCierreRecord = {
          uuid: cierreUuid,
          id: cierreUuid,
          libro_uuid: lId,
          libro_id: lId,
          mesa_uuid: selectedMesaId,
          mesa_id: selectedMesaId,
          multisala_uuid: multisalaUuid || null,
          tipo: 'cierre',
          fichas: cierreFichasPayload,
          total: 0,
          rellenos_devoluciones: [],
          mesa_nombre: mesaObj?.nombre || '',
          juego_nombre: mesaObj?.juego_nombre || '',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      }

      // 1. Actualizar estado en memoria inmediatamente (0ms)
      const existingIdx = arqueoRecords.findIndex(r => String(r.uuid || r.id) === String(recordUuid));
      if (existingIdx !== -1) {
        arqueoRecords[existingIdx] = newRecord;
      } else {
        arqueoRecords = [...arqueoRecords, newRecord];
      }

      if (newCierreRecord) {
        const cIdx = arqueoRecords.findIndex(r => String(r.uuid || r.id) === String(newCierreRecord.uuid || newCierreRecord.id));
        if (cIdx !== -1) {
          arqueoRecords[cIdx] = newCierreRecord;
        } else {
          arqueoRecords = [...arqueoRecords, newCierreRecord];
        }
      }
      arqueoRecords = [...arqueoRecords];

      // 2. Guardar en base de datos local IndexedDB (<5ms)
      await upsertLocalItem('libro_arqueo_fichas', newRecord);
      if (newCierreRecord) {
        await upsertLocalItem('libro_arqueo_fichas', newCierreRecord);
      }

      triggerToast(`Mesa "${mesaObj?.nombre || 'Mesa'}" aperturada con cierre inicial en $0.00.`, 'success');

      // Limpiar y resetear el formulario tras aperturar
      selectedMesaId = '';
      limpiarFormulario();

      // 3. Sincronizar en segundo plano con el backend
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      const recordsToSync = [newRecord, ...(newCierreRecord ? [newCierreRecord] : [])];

      for (const rec of recordsToSync) {
        const recUuid = rec.uuid || rec.id;
        if (isOffline) {
          await queueOutboxAction({
            entity: 'libro_arqueo_fichas',
            action: 'save',
            endpoint: `/api/master/libros/${lId}/arqueo-fichas`,
            method: 'POST',
            payload: rec,
            uuid: recUuid
          });
        } else {
          (async () => {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 4500);
              const res = await fetch(toBackendUrl(`/api/master/libros/${lId}/arqueo-fichas`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(rec),
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
                payload: rec,
                uuid: recUuid
              });
            }
          })();
        }
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
      if (r.tipo === 'apertura') {
        g.apertura = r;
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

  // Abrir Modal de Cierre ("Arquear")
  function handleOpenCierreModal(group) {
    modalMesa = group.mesaObj || { uuid: group.mesaId, id: group.mesaId, nombre: group.mesaNombre, juego_nombre: group.juegoNombre };
    modalAperturaRecord = group.apertura;
    modalCierreRecord = group.cierre;
    isModalOpen = true;
  }

  // Abrir Modal de Rellenos y Devoluciones (Fill / Cred)
  function handleOpenRellenoModal(tipo = 'relleno', mesaObj = null, aperturaRecord = null) {
    const targetMesa = mesaObj || (selectedMesaId ? availableMesas.find(m => String(m.uuid || m.id) === String(selectedMesaId)) : null);
    if (!targetMesa) {
      triggerToast('Debe seleccionar una mesa primero', 'warning');
      return;
    }

    const mId = String(targetMesa.uuid || targetMesa.id);
    const ap = aperturaRecord || arqueoRecords.find(r => 
      String(r.mesa_uuid || r.mesa_id) === mId &&
      r.tipo === 'apertura'
    );

    rdModalTipo = tipo;
    rdModalMesa = targetMesa;
    rdModalApertura = ap || null;
    isRDModalOpen = true;
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

    // Sincronizar también con el cierre de esta misma mesa si existe
    const mesaId = String(updatedApertura.mesa_uuid || updatedApertura.mesa_id || '');
    if (mesaId) {
      const cierreIdx = arqueoRecords.findIndex(r => 
        String(r.mesa_uuid || r.mesa_id || '') === mesaId && r.tipo === 'cierre' && !r.is_deleted
      );
      if (cierreIdx !== -1) {
        const updatedCierre = {
          ...arqueoRecords[cierreIdx],
          rellenos_devoluciones: updatedApertura.rellenos_devoluciones || [],
          updated_at: new Date().toISOString()
        };
        arqueoRecords[cierreIdx] = updatedCierre;
        upsertLocalItem('libro_arqueo_fichas', updatedCierre).catch(() => {});
        const lId = libro?.uuid || libroId || libro?.id;
        if (lId) {
          fetch(toBackendUrl(`/api/master/libros/${lId}/arqueo-fichas`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedCierre)
          }).catch(() => {});
        }
      }
    }

    arqueoRecords = [...arqueoRecords];
    rdModalApertura = updatedApertura;
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

    // Buscar si ya existe registro de cierre real en arqueoRecords
    const existingCierre = arqueoRecords.find(r => 
      String(r.mesa_uuid || r.mesa_id) === String(mId) && 
      r.tipo === 'cierre' && !r.is_deleted &&
      !String(r.uuid || r.id).startsWith('virtual-')
    );

    const cierreUuid = existingCierre?.uuid || existingCierre?.id || generateSafeUuid();

    const updatedCierre = {
      ...(existingCierre || {}),
      uuid: cierreUuid,
      id: cierreUuid,
      libro_uuid: lId,
      libro_id: lId,
      mesa_uuid: mId,
      mesa_id: mId,
      multisala_uuid: multisalaUuid || null,
      tipo: 'cierre',
      fichas: clonedFichas,
      total: apTotal,
      rellenos_devoluciones: group.rellenosDevoluciones || group.apertura.rellenos_devoluciones || [],
      mesa_nombre: group.mesaNombre || '',
      juego_nombre: group.juegoNombre || '',
      observaciones: existingCierre?.observaciones || 'Liquidado automáticamente (Cierre = Apertura)',
      updated_at: new Date().toISOString()
    };

    // 1. Actualizar estado en memoria inmediatamente (0ms)
    const existingIdx = arqueoRecords.findIndex(r => String(r.uuid || r.id) === String(cierreUuid));
    if (existingIdx !== -1) {
      arqueoRecords[existingIdx] = updatedCierre;
    } else {
      arqueoRecords = [...arqueoRecords, updatedCierre];
    }
    arqueoRecords = [...arqueoRecords];

    triggerToast(`Mesa "${group.mesaNombre}" liquidada (Cierre igualado a Apertura: $${formatMoney(apTotal)}).`, 'success');

    // 2. Guardar en base de datos local IndexedDB (<5ms)
    await upsertLocalItem('libro_arqueo_fichas', updatedCierre);

    // 3. Sincronizar en segundo plano con el backend
    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (isOffline) {
      await queueOutboxAction({
        entity: 'libro_arqueo_fichas',
        action: 'save',
        endpoint: `/api/master/libros/${lId}/arqueo-fichas`,
        method: 'POST',
        payload: updatedCierre,
        uuid: cierreUuid
      });
    } else {
      (async () => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4500);
          const res = await fetch(toBackendUrl(`/api/master/libros/${lId}/arqueo-fichas`), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedCierre),
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
            payload: updatedCierre,
            uuid: cierreUuid
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

  let unsubWs = null;

  onMount(() => {
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

    <!-- Tabla de Contenido con 3 Sublíneas por Mesa -->
    <div class="table-wrapper">
      <table class="drop-table arqueo-table">
        <thead>
          <tr>
            <th class="th-center th-num">N°</th>
            <th class="th-mesa">Mesa</th>
            <th class="th-center th-movimiento"></th>
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
              <td colspan={salaFichas.length + 5} class="empty-state-cell">
                <div class="loading-state-inline">
                  <div class="spinner-small"></div>
                  <span>Cargando arqueo de fichas...</span>
                </div>
              </td>
            </tr>
          {:else if mesaGroups.length === 0}
            <tr>
              <td colspan={salaFichas.length + 5} class="empty-state-cell">
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
              {@const totalRowsForMesa = 2 + allMovs.length + 1}

              <!-- Sub-fila 1: APERTURA -->
              <tr class="drop-row row-apertura" class:mesa-first-row={true}>
                <td class="td-center td-num" rowspan={totalRowsForMesa}>
                  <span class="index-num">{idx + 1}</span>
                </td>
                <td class="td-mesa" rowspan={totalRowsForMesa}>
                  <div class="mesa-title-cell">
                    <span class="mesa-main-name">{group.mesaNombre}</span>
                    {#if group.juegoNombre}
                      <span class="mesa-sub-juego">{group.juegoNombre}</span>
                    {/if}
                  </div>
                </td>
                <td class="td-center td-movimiento">
                  <span class="mov-badge mov-apertura" title="Apertura">Apertura</span>
                </td>
                {#each salaFichas as valor}
                  {@const apCount = getChipCount(group.apertura, valor)}
                  <td class="td-center count-val">
                    {apCount !== null ? apCount : '—'}
                  </td>
                {/each}
                <td class="td-center td-total-val ap-total-cell">
                  $ {formatMoney(apTotal)}
                </td>
                <td class="td-center td-acciones-cell" rowspan={totalRowsForMesa}>
                  <div class="acciones-btn-col">
                    <button 
                      type="button" 
                      class="btn-table-fill"
                      on:click={() => handleOpenRellenoModal('relleno', group.mesaObj || { uuid: group.mesaId, id: group.mesaId, nombre: group.mesaNombre, juego_nombre: group.juegoNombre }, group.apertura)}
                      title="Registrar Fill (Relleno) para esta mesa"
                    >
                      Fill
                    </button>
                    <button 
                      type="button" 
                      class="btn-table-cred"
                      on:click={() => handleOpenRellenoModal('devolucion', group.mesaObj || { uuid: group.mesaId, id: group.mesaId, nombre: group.mesaNombre, juego_nombre: group.juegoNombre }, group.apertura)}
                      title="Registrar Cred (Devolución) para esta mesa"
                    >
                      Cred
                    </button>
                    <button 
                      type="button" 
                      class="btn-arquear"
                      on:click={() => handleOpenCierreModal(group)}
                      title="Registrar o editar el Cierre de esta mesa"
                    >
                      Cierre
                    </button>
                    <button 
                      type="button" 
                      class="btn-liquidar"
                      on:click={() => handleLiquidarMesa(group)}
                      title="Liquidar mesa"
                    >
                      Liquidar
                    </button>
                    {#if canDelete}
                      <button 
                        type="button" 
                        class="btn-eliminar"
                        on:click={() => handleEliminarMesa(group)}
                        title="Eliminar registro de esta mesa"
                      >
                        Eliminar
                      </button>
                    {/if}
                  </div>
                </td>
              </tr>

              <!-- Sub-filas dinámicas para cada RELLENO / DEVOLUCIÓN -->
              {#each allMovs as mov}
                <tr class="drop-row row-mov" class:row-relleno={mov.tipo === 'relleno'} class:row-devolucion={mov.tipo === 'devolucion'}>
                  <td class="td-center td-movimiento">
                    <span class="mov-badge {mov.tipo === 'relleno' ? 'mov-relleno' : 'mov-devolucion'}" title="{mov.tipo === 'relleno' ? 'Fill' : 'Cred'} {mov.numero || mov.codigo}">
                      {formatMovBadge(mov, allMovs)}
                    </span>
                  </td>
                  {#each salaFichas as valor}
                    {@const count = getMovChipCount(mov, valor)}
                    <td class="td-center count-val font-mono">
                      {count > 0 ? count : '—'}
                    </td>
                  {/each}
                  <td class="td-center td-total-val font-mono {mov.tipo === 'relleno' ? 'text-blue' : 'text-purple'}">
                    $ {formatMoney(mov.total)}
                  </td>
                </tr>
              {/each}

              <!-- Sub-fila 2: CIERRE -->
              <tr class="drop-row row-cierre">
                <td class="td-center td-movimiento">
                  <span class="mov-badge {hasCierre ? 'mov-cierre' : 'mov-pendiente'}" title="{hasCierre ? 'Cierre' : 'Pendiente de Cierre'}">
                    Cierre
                  </span>
                </td>
                {#each salaFichas as valor}
                  {@const ciCount = hasCierre ? getChipCount(group.cierre, valor) : null}
                  <td class="td-center count-val" class:val-pending={!hasCierre}>
                    {ciCount !== null ? ciCount : '—'}
                  </td>
                {/each}
                <td class="td-center td-total-val ci-total-cell" class:val-pending={!hasCierre}>
                  {hasCierre ? `$ ${formatMoney(ciTotal)}` : '—'}
                </td>
              </tr>

              <!-- Sub-fila 3: DIFERENCIA / TOTAL -->
              <tr class="drop-row row-diferencia mesa-last-row">
                <td class="td-center td-movimiento">
                  <span class="mov-badge mov-diferencia" title="Total">Total</span>
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
                      >
                        {Math.abs(difChips)}
                      </span>
                    {:else}
                      <span class="val-pending">—</span>
                    {/if}
                  </td>
                {/each}
                <td class="td-center td-total-val dif-total-cell">
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
              </tr>
            {/each}
          {/if}
        </tbody>

        <!-- Fila de Totales Generales -->
        {#if mesaGroups.length > 0}
          <tfoot>
            <tr class="total-row footer-apertura">
              <td colspan="2" class="total-label-cell">TOTAL APERTURA</td>
              <td class="td-center"><span class="mov-badge mov-apertura" title="Apertura">Apertura</span></td>
              {#each salaFichas as valor}
                {@const sumAp = mesaGroups.reduce((acc, g) => acc + (getChipCount(g.apertura, valor) || 0), 0)}
                <td class="td-center total-val-cell">{sumAp}</td>
              {/each}
              <td class="td-center grand-total-cell ap-grand-total">
                $ {formatMoney(totalGeneralApertura)}
              </td>
              <td></td>
            </tr>

            {#if totalGeneralRellenos > 0}
              <tr class="total-row footer-rellenos">
                <td colspan="2" class="total-label-cell">TOTAL FILL</td>
                <td class="td-center"><span class="mov-badge mov-relleno" title="Fill">Fill</span></td>
                {#each salaFichas as valor}
                  {@const sumR = mesaGroups.reduce((acc, g) => acc + (g.rellenosDevoluciones || []).filter(m => m.tipo === 'relleno').reduce((a, b) => a + getMovChipCount(b, valor), 0), 0)}
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
                <td class="td-center"><span class="mov-badge mov-devolucion" title="Cred">Cred</span></td>
                {#each salaFichas as valor}
                  {@const sumD = mesaGroups.reduce((acc, g) => acc + (g.rellenosDevoluciones || []).filter(m => m.tipo === 'devolucion').reduce((a, b) => a + getMovChipCount(b, valor), 0), 0)}
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
              <td class="td-center"><span class="mov-badge mov-cierre" title="Cierre">Cierre</span></td>
              {#each salaFichas as valor}
                {@const sumCi = mesaGroups.reduce((acc, g) => acc + (g.cierre ? (getChipCount(g.cierre, valor) || 0) : 0), 0)}
                <td class="td-center total-val-cell">{sumCi}</td>
              {/each}
              <td class="td-center grand-total-cell ci-grand-total">
                $ {formatMoney(totalGeneralCierre)}
              </td>
              <td></td>
            </tr>

            <tr class="total-row footer-diferencia">
              <td colspan="2" class="total-label-cell">TOTAL FINAL</td>
              <td class="td-center"><span class="mov-badge mov-diferencia" title="Total">Total</span></td>
              {#each salaFichas as valor}
                {@const sumAp = mesaGroups.reduce((acc, g) => acc + (getChipCount(g.apertura, valor) || 0), 0)}
                {@const sumR = mesaGroups.reduce((acc, g) => acc + (g.rellenosDevoluciones || []).filter(m => m.tipo === 'relleno').reduce((a, b) => a + getMovChipCount(b, valor), 0), 0)}
                {@const sumD = mesaGroups.reduce((acc, g) => acc + (g.rellenosDevoluciones || []).filter(m => m.tipo === 'devolucion').reduce((a, b) => a + getMovChipCount(b, valor), 0), 0)}
                {@const sumCi = mesaGroups.reduce((acc, g) => acc + (g.cierre ? (getChipCount(g.cierre, valor) || 0) : 0), 0)}
                {@const expectedTotal = sumAp + sumR - sumD}
                {@const dif = sumCi - expectedTotal}
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
  on:close={() => { isModalOpen = false; }}
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
  on:close={() => { isRDModalOpen = false; }}
  on:saved={handleRDSaved}
/>

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
</style>

