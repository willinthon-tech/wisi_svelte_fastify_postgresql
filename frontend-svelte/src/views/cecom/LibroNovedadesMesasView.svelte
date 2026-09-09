<script>
  import { onMount } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { currentUserStore, userSalasStore as authUserSalasStore } from '../../controllers/auth.store.js';
  import { 
    masterMesasStore, 
    masterSalasStore, 
    masterJuegosStore, 
    masterEmpleadosStore,
    masterLibrosStore,
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
  let rowsData = {};

  // Conjuntos reactivos para retroalimentación visual de guardado por fila
  let savingMesaIds = new Set();
  let savedSuccessMesaIds = new Set();
  let saveDebounceTimers = {};

  // Estado del dropdown de autocompletado en celda activa (croupiers de la tabla)
  let activeSug = null; // { mesaId, field: 'croupier_apertura'|'croupier_cierre' }
  let activeSugIndex = -1;

  // --- Estado para el Formulario de Asignación a Todas las Mesas (Izquierda) ---
  let batchHoraApertura = '';
  let batchHoraCierre = '';
  let batchPitboss = '';
  let batchObservacion = '';
  let isSavingBatch = false;

  // --- Autocompletado de Pitboss (con coincidencias y soporte para Tab ⇥) ---
  let pitbossSugTarget = null; // 'batch' | 'modal'
  let pitbossSugIndex = -1;

  // --- Estado para el Modal de Edición Individual ---
  let isEditModalOpen = false;
  let editingMesaId = null;
  let modalMesa = null;
  let modalHoraApertura = '';
  let modalHoraCierre = '';
  let modalPitboss = '';
  let modalObservacion = '';
  let isSavingModal = false;

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

  $: targetSalaId = Number(libro?.sala_id || ($masterLibrosStore || []).find(l => Number(l.id) === Number(libroId))?.sala_id);

  // Lista de empleados disponibles para sugerencias y autocompletado (filtrados por la sala del libro)
  $: listaEmpleados = ($masterEmpleadosStore || [])
    .filter(e => {
      // Filtrar estrictamente por la sala asociada al libro
      if (targetSalaId) {
        if (Number(e.sala_id) !== targetSalaId) return false;
      }
      if (e.activo !== undefined && (Number(e.activo) === 0 || e.activo === false)) return false;
      return true;
    })
    .map(e => {
      const nom = [e.nombre, e.apellido].filter(Boolean).join(' ').trim() || e.nombre || '';
      return {
        id: e.id,
        nombre: nom,
        cargo_nombre: (e.cargo_nombre || '').trim(),
        sala_id: e.sala_id
      };
    })
    .filter(e => Boolean(e.nombre))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  function matchEmpleado(emp, q) {
    if (!q) return true;
    const matchNom = emp.nombre.toLowerCase().includes(q);
    const matchCargo = emp.cargo_nombre.toLowerCase().includes(q);
    return matchNom || matchCargo;
  }

  // --- Sugerencias de Croupiers en tabla ---
  $: currentQueryCroupier = (activeSug && rowsData[activeSug.mesaId]) 
    ? (rowsData[activeSug.mesaId][activeSug.field] || '').trim().toLowerCase() 
    : '';

  $: filteredCroupierSuggestions = (() => {
    if (!activeSug) return [];
    if (!currentQueryCroupier) return listaEmpleados.slice(0, 10);
    return listaEmpleados.filter(emp => matchEmpleado(emp, currentQueryCroupier)).slice(0, 10);
  })();

  // --- Sugerencias de Pitboss (con coincidencias y Tab) ---
  $: currentQueryPitboss = pitbossSugTarget === 'batch'
    ? (batchPitboss || '').trim().toLowerCase()
    : (pitbossSugTarget === 'modal' ? (modalPitboss || '').trim().toLowerCase() : '');

  $: filteredPitbossSuggestions = (() => {
    if (!pitbossSugTarget) return [];
    if (!currentQueryPitboss) return listaEmpleados.slice(0, 10);
    return listaEmpleados.filter(emp => matchEmpleado(emp, currentQueryPitboss)).slice(0, 10);
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

  function syncRowsData(records) {
    const map = new Map();
    for (const r of (records || [])) {
      map.set(Number(r.mesa_id), r);
    }

    const updated = { ...rowsData };
    for (const m of availableMesas) {
      const mid = Number(m.id);
      const rec = map.get(mid);
      
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

  function updateField(mesaId, field, val) {
    const row = getRow(mesaId);
    row[field] = val;
    rowsData[mesaId] = row;
    rowsData = { ...rowsData };
  }

  function triggerAutoSave(mesaId, delay = 700) {
    if (saveDebounceTimers[mesaId]) {
      clearTimeout(saveDebounceTimers[mesaId]);
    }
    saveDebounceTimers[mesaId] = setTimeout(() => {
      saveRowToBackend(mesaId);
    }, delay);
  }

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

  function limpiarBatchForm() {
    batchHoraApertura = '';
    batchHoraCierre = '';
    batchPitboss = '';
    batchObservacion = '';
  }

  // Asignar en Lote a TODAS las mesas disponibles de la sala
  async function handleBatchAssign() {
    const lId = libroId || libro?.id;
    if (!lId) {
      triggerToast('No se encontró el ID del libro', 'error');
      return;
    }

    if (availableMesas.length === 0) {
      triggerToast('No hay mesas activas para aplicar', 'warning');
      return;
    }

    const hasAnyField = Boolean(
      batchHoraApertura.trim() || 
      batchHoraCierre.trim() || 
      batchPitboss.trim() || 
      batchObservacion.trim()
    );

    if (!hasAnyField) {
      triggerToast('Complete al menos un campo (Hora apertura, Hora cierre, Pitboss u Observación) para aplicar a todas las mesas', 'warning');
      return;
    }

    isSavingBatch = true;
    try {
      const promises = availableMesas.map(async (mesa) => {
        const mid = mesa.id;
        const cur = getRow(mid);
        const payload = {
          mesa_id: Number(mid),
          hora_apertura: batchHoraApertura.trim() ? batchHoraApertura.trim() : (cur.hora_apertura || ''),
          hora_cierre: batchHoraCierre.trim() ? batchHoraCierre.trim() : (cur.hora_cierre || ''),
          pitboss: batchPitboss.trim() ? batchPitboss.trim() : (cur.pitboss || ''),
          croupier_apertura: cur.croupier_apertura || '',
          croupier_cierre: cur.croupier_cierre || '',
          observacion: batchObservacion.trim() ? batchObservacion.trim() : (cur.observacion || '')
        };

        const res = await fetch(`/api/master/libros/${lId}/novedades-mesas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const json = await res.json();
          if (json && json.success) {
            updateField(mid, 'hora_apertura', payload.hora_apertura);
            updateField(mid, 'hora_cierre', payload.hora_cierre);
            updateField(mid, 'pitboss', payload.pitboss);
            updateField(mid, 'observacion', payload.observacion);
            return json.data;
          }
        }
        return null;
      });

      const results = await Promise.all(promises);
      const successCount = results.filter(Boolean).length;
      triggerToast(`¡Asignación aplicada a las ${successCount} mesas!`, 'success');
      await loadRecords();
    } catch (err) {
      console.error('Error en asignación a mesas:', err);
      triggerToast(`Error al asignar: ${err.message}`, 'error');
    } finally {
      isSavingBatch = false;
    }
  }

  // --- Handlers de Modal de Edición Individual ---
  function abrirModalEditar(mesaId) {
    editingMesaId = mesaId;
    modalMesa = availableMesas.find(m => m.id === mesaId);
    const r = getRow(mesaId);
    modalHoraApertura = r.hora_apertura || '';
    modalHoraCierre = r.hora_cierre || '';
    modalPitboss = r.pitboss || '';
    modalObservacion = r.observacion || '';
    isEditModalOpen = true;
  }

  function cerrarModalEditar() {
    isEditModalOpen = false;
    editingMesaId = null;
    modalMesa = null;
    pitbossSugTarget = null;
    pitbossSugIndex = -1;
  }

  async function handleGuardarModal() {
    const lId = libroId || libro?.id;
    if (!lId || !editingMesaId) return;

    const cur = getRow(editingMesaId);
    isSavingModal = true;
    try {
      const payload = {
        mesa_id: Number(editingMesaId),
        hora_apertura: modalHoraApertura.trim(),
        hora_cierre: modalHoraCierre.trim(),
        pitboss: modalPitboss.trim(),
        croupier_apertura: cur.croupier_apertura || '',
        croupier_cierre: cur.croupier_cierre || '',
        observacion: modalObservacion.trim()
      };

      const res = await fetch(`/api/master/libros/${lId}/novedades-mesas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (res.ok && json && json.success) {
        updateField(editingMesaId, 'hora_apertura', payload.hora_apertura);
        updateField(editingMesaId, 'hora_cierre', payload.hora_cierre);
        updateField(editingMesaId, 'pitboss', payload.pitboss);
        updateField(editingMesaId, 'observacion', payload.observacion);

        const savedRecord = json.data;
        const idx = novedadesRecords.findIndex(r => Number(r.mesa_id) === Number(editingMesaId));
        if (idx >= 0) {
          novedadesRecords[idx] = savedRecord;
        } else {
          novedadesRecords = [...novedadesRecords, savedRecord];
        }

        triggerToast(`Mesa ${modalMesa?.nombre || ''} actualizada correctamente`, 'success');
        cerrarModalEditar();
      } else {
        triggerToast(json?.error || 'Error al guardar cambios de mesa', 'error');
      }
    } catch (err) {
      console.error('Error al guardar modal de mesa:', err);
      triggerToast(`Error: ${err.message}`, 'error');
    } finally {
      isSavingModal = false;
    }
  }

  // --- Handlers de Autocompletado de Croupiers (en la tabla) ---
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
      if (filteredCroupierSuggestions.length > 0) {
        e.preventDefault();
        activeSugIndex = (activeSugIndex + 1) % filteredCroupierSuggestions.length;
      }
    } else if (e.key === 'ArrowUp') {
      if (filteredCroupierSuggestions.length > 0) {
        e.preventDefault();
        activeSugIndex = (activeSugIndex - 1 + filteredCroupierSuggestions.length) % filteredCroupierSuggestions.length;
      }
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (filteredCroupierSuggestions.length > 0) {
        e.preventDefault();
        const selected = activeSugIndex >= 0 ? filteredCroupierSuggestions[activeSugIndex] : filteredCroupierSuggestions[0];
        selectSuggestion(mesaId, field, selected);
      }
    } else if (e.key === 'Escape') {
      activeSug = null;
      activeSugIndex = -1;
    }
  }

  function selectSuggestion(mesaId, field, sugOrName) {
    const val = (sugOrName && typeof sugOrName === 'object') ? sugOrName.nombre : (sugOrName || '');
    updateField(mesaId, field, val);
    activeSug = null;
    activeSugIndex = -1;
    triggerAutoSave(mesaId, 0);
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

  // --- Handlers de Autocompletado de Pitboss (con coincidencias y Tab ⇥) ---
  function handleFocusPitboss(target) {
    pitbossSugTarget = target;
    pitbossSugIndex = -1;
  }

  function handleInputPitboss(target, val) {
    if (target === 'batch') batchPitboss = val;
    if (target === 'modal') modalPitboss = val;
    pitbossSugTarget = target;
    pitbossSugIndex = -1;
  }

  function handleKeyDownPitboss(e, target) {
    if (pitbossSugTarget !== target) return;

    if (e.key === 'ArrowDown') {
      if (filteredPitbossSuggestions.length > 0) {
        e.preventDefault();
        pitbossSugIndex = (pitbossSugIndex + 1) % filteredPitbossSuggestions.length;
      }
    } else if (e.key === 'ArrowUp') {
      if (filteredPitbossSuggestions.length > 0) {
        e.preventDefault();
        pitbossSugIndex = (pitbossSugIndex - 1 + filteredPitbossSuggestions.length) % filteredPitbossSuggestions.length;
      }
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (filteredPitbossSuggestions.length > 0) {
        e.preventDefault();
        const selected = pitbossSugIndex >= 0 ? filteredPitbossSuggestions[pitbossSugIndex] : filteredPitbossSuggestions[0];
        selectPitbossSuggestion(target, selected);
      }
    } else if (e.key === 'Escape') {
      pitbossSugTarget = null;
      pitbossSugIndex = -1;
    }
  }

  function selectPitbossSuggestion(target, sugOrName) {
    const val = (sugOrName && typeof sugOrName === 'object') ? sugOrName.nombre : (sugOrName || '');
    if (target === 'batch') batchPitboss = val;
    if (target === 'modal') modalPitboss = val;
    pitbossSugTarget = null;
    pitbossSugIndex = -1;
  }

  function handleBlurPitboss(target) {
    setTimeout(() => {
      if (pitbossSugTarget === target) {
        pitbossSugTarget = null;
        pitbossSugIndex = -1;
      }
    }, 200);
  }
</script>

<div class="novedades-layout-grid">
  <!-- Tarjeta Izquierda: Formulario "Novedades de Mesas" (Asignación a todas las mesas) -->
  <div class="card-form-novedades">
    <div class="card-title-box">
      <h3 class="card-title">Novedades de Mesas</h3>
      <div class="title-underline"></div>
    </div>

    <form on:submit|preventDefault={handleBatchAssign} class="batch-form">
      <!-- Fila 1: Hora Apertura (col-6) y Hora Cierre (col-6) -->
      <div class="form-row-2col">
        <div class="form-group col-6">
          <div class="label-with-now">
            <label for="batch-hora-apertura" class="form-label">Apertura:</label>
            <button 
              type="button" 
              class="btn-now-text" 
              on:click={() => batchHoraApertura = getCurrentTimeString()}
              title="Establecer hora actual"
            >⚡ Ahora</button>
          </div>
          <input 
            id="batch-hora-apertura" 
            type="time" 
            class="form-input" 
            bind:value={batchHoraApertura} 
          />
        </div>

        <div class="form-group col-6">
          <div class="label-with-now">
            <label for="batch-hora-cierre" class="form-label">Cierre:</label>
            <button 
              type="button" 
              class="btn-now-text" 
              on:click={() => batchHoraCierre = getCurrentTimeString()}
              title="Establecer hora actual"
            >⚡ Ahora</button>
          </div>
          <input 
            id="batch-hora-cierre" 
            type="time" 
            class="form-input" 
            bind:value={batchHoraCierre} 
          />
        </div>
      </div>

      <!-- Fila 2: Pitboss (col-12) con autocompletado y coincidencia a Tab ⇥ -->
      <div class="form-group col-12">
        <label for="batch-pitboss" class="form-label">Pitboss:</label>
        <div class="cell-autocomplete-container">
          <input 
            id="batch-pitboss" 
            type="text" 
            class="form-input {pitbossSugTarget === 'batch' ? 'input-active' : ''}" 
            placeholder="Escriba Pitboss (coincidencias con Tab ⇥)..." 
            value={batchPitboss}
            on:focus={() => handleFocusPitboss('batch')}
            on:input={(e) => handleInputPitboss('batch', e.target.value)}
            on:keydown={(e) => handleKeyDownPitboss(e, 'batch')}
            on:blur={() => handleBlurPitboss('batch')}
            autocomplete="off"
          />

          {#if pitbossSugTarget === 'batch' && filteredPitbossSuggestions.length > 0}
            <div class="inline-dropdown">
              <div class="inline-dropdown-header">
                <span>Coincidencias (<b>Tab ⇥</b> o clic):</span>
              </div>
              <ul class="inline-dropdown-list">
                {#each filteredPitbossSuggestions as sug, idx}
                  <!-- svelte-ignore a11y-click-events-have-key-events -->
                  <li 
                    class="inline-dropdown-item {idx === pitbossSugIndex ? 'selected' : ''}"
                    on:mousedown|preventDefault={() => selectPitbossSuggestion('batch', sug)}
                  >
                    <span class="sug-avatar">👤</span>
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

      <!-- Fila 3: Observación (col-12 textarea) -->
      <div class="form-group col-12">
        <label for="batch-obs" class="form-label">Observación:</label>
        <textarea 
          id="batch-obs" 
          class="form-textarea" 
          rows="3" 
          placeholder="VIP, cambio de paño, incidentes..." 
          bind:value={batchObservacion}
        ></textarea>
      </div>

      <!-- Botón de Guardar -->
      <div class="form-actions-batch">
        <button 
          type="submit" 
          class="btn-primary-batch" 
          disabled={isSavingBatch || availableMesas.length === 0}
        >
          {#if isSavingBatch}
            <span class="btn-spinner"></span>
            <span>Guardando...</span>
          {:else}
            <span>Guardar</span>
          {/if}
        </button>
      </div>
    </form>
  </div>

  <!-- Tarjeta Derecha: Tabla de Novedades de Mesas -->
  <div class="card-table-novedades">
    <!-- Barra Superior Oscura: Sala - Fecha + Buscador -->
    <div class="table-top-bar">
      <div class="top-bar-left">
        <span class="top-bar-title">{tableHeaderTitle}</span>
        <span class="top-bar-subtitle">Mesas operativas • Asignación y croupiers</span>
      </div>

      <div class="top-bar-right">
        <!-- Buscador de mesa o empleado -->
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input 
            type="text" 
            class="search-input" 
            placeholder="Filtrar mesa o croupier..." 
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
      </div>
    </div>

    <!-- Tabla Limpia: Solo MESA, CROUPIER APERTURA, CROUPIER CIERRE y ACCIONES -->
    <div class="table-wrapper">
      <table class="novedades-table">
        <thead>
          <tr>
            <th class="th-left th-col-mesa">MESA</th>
            <th class="th-left th-col-croupier">CROUPIER APERTURA</th>
            <th class="th-left th-col-croupier">CROUPIER CIERRE</th>
            <th class="th-center th-col-acciones">ACCIONES</th>
          </tr>
        </thead>
        <tbody>
          {#if isLoadingRecords || isLoadingMesas}
            <tr>
              <td colspan="4" class="empty-state-cell">
                <div class="loading-state-inline">
                  <div class="spinner-small"></div>
                  <span>Cargando mesas y novedades...</span>
                </div>
              </td>
            </tr>
          {:else if availableMesas.length === 0}
            <tr>
              <td colspan="4" class="empty-state-cell">
                <div class="empty-msg-box">
                  <span class="empty-icon">🎲</span>
                  <p class="empty-text">No se encontraron mesas activas configuradas para esta sala.</p>
                </div>
              </td>
            </tr>
          {:else if filteredMesas.length === 0}
            <tr>
              <td colspan="4" class="empty-state-cell">
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
              <tr class="novedad-row {hasData ? 'row-has-data' : 'row-empty'}">
                
                <!-- MESA (Solo Nombre y Juego) -->
                <td class="td-left td-col-mesa">
                  <div class="mesa-badge-cell">
                    <span class="mesa-nombre">{mesa.nombre}</span>
                    {#if mesa.juego_nombre}
                      <span class="mesa-juego">{mesa.juego_nombre}</span>
                    {/if}
                  </div>
                </td>

                <!-- CROUPIER APERTURA (Con autocompletado en celda) -->
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

                    {#if activeSug && activeSug.mesaId === mesa.id && activeSug.field === 'croupier_apertura' && filteredCroupierSuggestions.length > 0}
                      <div class="inline-dropdown">
                        <div class="inline-dropdown-header">
                          <span>Sugerencias (<b>Tab ⇥</b> o clic):</span>
                        </div>
                        <ul class="inline-dropdown-list">
                          {#each filteredCroupierSuggestions as sug, idx}
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <li 
                              class="inline-dropdown-item {idx === activeSugIndex ? 'selected' : ''}"
                              on:mousedown|preventDefault={() => selectSuggestion(mesa.id, 'croupier_apertura', sug)}
                            >
                              <span class="sug-avatar">👤</span>
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
                </td>

                <!-- CROUPIER CIERRE (Con autocompletado en celda) -->
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

                    {#if activeSug && activeSug.mesaId === mesa.id && activeSug.field === 'croupier_cierre' && filteredCroupierSuggestions.length > 0}
                      <div class="inline-dropdown">
                        <div class="inline-dropdown-header">
                          <span>Sugerencias (<b>Tab ⇥</b> o clic):</span>
                        </div>
                        <ul class="inline-dropdown-list">
                          {#each filteredCroupierSuggestions as sug, idx}
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <li 
                              class="inline-dropdown-item {idx === activeSugIndex ? 'selected' : ''}"
                              on:mousedown|preventDefault={() => selectSuggestion(mesa.id, 'croupier_cierre', sug)}
                            >
                              <span class="sug-avatar">👤</span>
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
                </td>

                <!-- ACCIONES (Botón Editar Modal + Botón Eliminar) -->
                <td class="td-center td-col-acciones">
                  <div class="row-status-actions">
                    {#if isSavingThis}
                      <span class="status-saving-inline" title="Guardando cambios...">
                        <span class="mini-spinner"></span>
                      </span>
                    {/if}

                    <!-- Botón de Editar individual que abre el Modal -->
                    <button 
                      type="button" 
                      class="btn-inline-edit" 
                      on:click={() => abrirModalEditar(mesa.id)}
                      title="Editar individualmente hora apertura/cierre, pitboss y observación"
                    >
                      ✏️
                    </button>

                    {#if hasData || recordsMap.has(Number(mesa.id))}
                      <button 
                        type="button" 
                        class="btn-inline-delete" 
                        on:click={() => handleEliminar(mesa.id)}
                        title="Limpiar novedad de esta mesa"
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

<!-- ============================================================
     MODAL DE EDICIÓN INDIVIDUAL POR MESA
     (NO se cierra al dar clic afuera)
     ============================================================ -->
{#if isEditModalOpen && modalMesa}
  <div class="modal-overlay">
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div class="modal-header-info">
          <span class="modal-header-icon">🎲</span>
          <div>
            <h3 class="modal-heading">Editar Mesa: {modalMesa.nombre}</h3>
            <span class="modal-subheading">{modalMesa.juego_nombre || 'Mesa Operativa'} • Novedad individual</span>
          </div>
        </div>
        <button type="button" class="btn-modal-close" on:click={cerrarModalEditar} title="Cerrar ventana">×</button>
      </div>

      <form on:submit|preventDefault={handleGuardarModal} class="modal-form">
        <div class="modal-body">
          <!-- Fila: Apertura y Cierre -->
          <div class="modal-row-2col">
            <div class="form-group-modal">
              <div class="label-with-action">
                <label for="m-hora-inicio" class="form-label-modal">Apertura:</label>
                <button 
                  type="button" 
                  class="btn-inline-now" 
                  on:click={() => modalHoraApertura = getCurrentTimeString()}
                  title="Establecer hora actual"
                >⚡ Ahora</button>
              </div>
              <input 
                id="m-hora-inicio" 
                type="time" 
                class="form-time-input-modal" 
                bind:value={modalHoraApertura} 
              />
            </div>

            <div class="form-group-modal">
              <div class="label-with-action">
                <label for="m-hora-fin" class="form-label-modal">Cierre:</label>
                <button 
                  type="button" 
                  class="btn-inline-now" 
                  on:click={() => modalHoraCierre = getCurrentTimeString()}
                  title="Establecer hora actual"
                >⚡ Ahora</button>
              </div>
              <input 
                id="m-hora-fin" 
                type="time" 
                class="form-time-input-modal" 
                bind:value={modalHoraCierre} 
              />
            </div>
          </div>

          <!-- Pitboss con autocompletado y Tab ⇥ -->
          <div class="form-group-modal">
            <label for="m-pitboss" class="form-label-modal">Pitboss:</label>
            <div class="cell-autocomplete-container">
              <input 
                id="m-pitboss"
                type="text" 
                class="form-input-modal {pitbossSugTarget === 'modal' ? 'input-active' : ''}" 
                placeholder="Escriba Pitboss (coincidencias con Tab ⇥)..." 
                value={modalPitboss}
                on:focus={() => handleFocusPitboss('modal')}
                on:input={(e) => handleInputPitboss('modal', e.target.value)}
                on:keydown={(e) => handleKeyDownPitboss(e, 'modal')}
                on:blur={() => handleBlurPitboss('modal')}
                autocomplete="off"
              />

              {#if pitbossSugTarget === 'modal' && filteredPitbossSuggestions.length > 0}
                <div class="inline-dropdown">
                  <div class="inline-dropdown-header">
                    <span>Coincidencias (<b>Tab ⇥</b> o clic):</span>
                  </div>
                  <ul class="inline-dropdown-list">
                    {#each filteredPitbossSuggestions as sug, idx}
                      <!-- svelte-ignore a11y-click-events-have-key-events -->
                      <li 
                        class="inline-dropdown-item {idx === pitbossSugIndex ? 'selected' : ''}"
                        on:mousedown|preventDefault={() => selectPitbossSuggestion('modal', sug)}
                      >
                        <span class="sug-avatar">👤</span>
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

          <!-- Observación -->
          <div class="form-group-modal">
            <label for="m-observacion" class="form-label-modal">Observación:</label>
            <textarea 
              id="m-observacion" 
              class="form-textarea-modal" 
              rows="3" 
              placeholder="VIP, cambio de paño, incidentes..." 
              bind:value={modalObservacion}
            ></textarea>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn-modal-cancel" on:click={cerrarModalEditar}>
            Cancelar
          </button>
          <button type="submit" class="btn-modal-save" disabled={isSavingModal}>
            {#if isSavingModal}
              Guardando...
            {:else}
              Guardar Cambios
            {/if}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  /* Layout Grid en 2 Columnas idéntico a las otras subvistas */
  .novedades-layout-grid {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 20px;
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
     Tarjeta Izquierda: Formulario "Novedades de Mesas" (Lote)
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

  .card-title {
    margin: 0;
    font-size: 19px;
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

  .batch-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .form-row-2col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .label-with-now {
    display: flex;
    align-items: center;
    justify-content: space-between;
    white-space: nowrap;
    gap: 4px;
  }

  .form-label {
    font-size: 12.5px;
    font-weight: 700;
    color: #1e293b;
  }

  .btn-now-text {
    background: none;
    border: none;
    color: #2563eb;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
    transition: color 0.15s ease;
  }

  .btn-now-text:hover {
    color: #1d4ed8;
    text-decoration: underline;
  }

  .form-input, .form-textarea {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13px;
    color: #0f172a;
    background: #ffffff;
    box-sizing: border-box;
    outline: none;
    transition: all 0.15s ease;
    font-family: inherit;
  }

  .form-input:focus, .form-textarea:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
  }

  .form-textarea {
    resize: vertical;
    min-height: 65px;
  }

  .form-actions-batch {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
  }

  .btn-primary-batch {
    background: #2563eb;
    color: #ffffff;
    border: none;
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .btn-primary-batch:hover:not(:disabled) {
    background: #1d4ed8;
    box-shadow: 0 2px 6px rgba(37, 99, 235, 0.3);
  }

  .btn-primary-batch:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-reset-batch {
    background: transparent;
    border: 1px solid #cbd5e1;
    color: #64748b;
    padding: 7px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: center;
  }

  .btn-reset-batch:hover {
    background: #f1f5f9;
    color: #334155;
  }

  .btn-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  /* ─────────────────────────────────────────────────────────────
     Tarjeta Derecha: Tabla
     ───────────────────────────────────────────────────────────── */
  .card-table-novedades {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    width: 100%;
    overflow: visible;
  }

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
    width: 210px;
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

  .table-wrapper {
    overflow-x: auto;
    width: 100%;
    min-height: 480px;
    padding-bottom: 80px;
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

  .th-col-mesa { min-width: 170px; }
  .th-col-croupier { min-width: 200px; }
  .th-col-acciones { width: 100px; text-align: center; }

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

  /* Celda de Mesa limpia (solo nombre y juego) */
  .mesa-badge-cell {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .mesa-nombre {
    font-weight: 800;
    color: #0f172a;
    font-size: 13.5px;
  }

  .mesa-juego {
    font-size: 11px;
    color: #64748b;
    font-weight: 600;
  }

  /* Input con autocompletado en celda */
  .cell-autocomplete-container {
    position: relative;
    width: 100%;
  }

  .inline-text-input {
    width: 100%;
    padding: 6px 9px;
    border: 1px solid #cbd5e1;
    border-radius: 5px;
    font-size: 12.5px;
    color: #1e293b;
    background: #ffffff;
    box-sizing: border-box;
    outline: none;
    transition: all 0.15s ease;
  }

  .inline-text-input:focus,
  .inline-text-input.input-active,
  .form-input.input-active,
  .form-input-modal.input-active {
    border-color: #2563eb;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
    background: #ffffff;
  }

  .inline-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 100;
    background: #ffffff;
    border: 1px solid #94a3b8;
    border-radius: 6px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
    margin-top: 3px;
    min-width: 250px;
    overflow: hidden;
  }

  .inline-dropdown-header {
    background: #f1f5f9;
    padding: 5px 10px;
    border-bottom: 1px solid #e2e8f0;
    font-size: 11px;
    color: #475569;
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
    gap: 8px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 12.5px;
    color: #1e293b;
    border-bottom: 1px solid #f8fafc;
    transition: background 0.1s ease;
  }

  .inline-dropdown-item:hover,
  .inline-dropdown-item.selected {
    background: #eff6ff;
    color: #1d4ed8;
  }

  .sug-avatar {
    font-size: 12px;
  }

  .sug-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    gap: 1px;
    text-align: left;
  }

  .sug-name {
    font-size: 12.5px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sug-cargo {
    font-size: 10.5px;
    color: #64748b;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .inline-dropdown-item:hover .sug-cargo,
  .inline-dropdown-item.selected .sug-cargo {
    color: #3b82f6;
  }

  .sug-tab-badge {
    font-size: 10px;
    background: #e2e8f0;
    color: #475569;
    padding: 1px 4px;
    border-radius: 3px;
    font-weight: 700;
  }

  /* Acciones de la fila */
  .row-status-actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .status-saving-inline {
    display: inline-flex;
    align-items: center;
  }

  .mini-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid #cbd5e1;
    border-top-color: #2563eb;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  .btn-inline-edit {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    color: #2563eb;
    border-radius: 6px;
    padding: 4px 7px;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .btn-inline-edit:hover {
    background: #dbeafe;
    border-color: #93c5fd;
    transform: scale(1.05);
  }

  .btn-inline-delete {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #dc2626;
    border-radius: 6px;
    padding: 4px 7px;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .btn-inline-delete:hover {
    background: #fee2e2;
    border-color: #fca5a5;
    transform: scale(1.05);
  }

  /* Estados vacíos */
  .empty-state-cell {
    padding: 40px 20px;
    text-align: center;
  }

  .loading-state-inline {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: #64748b;
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
    gap: 8px;
  }

  .empty-icon {
    font-size: 32px;
  }

  .empty-text {
    margin: 0;
    color: #64748b;
    font-size: 13.5px;
  }

  /* ─────────────────────────────────────────────────────────────
     Modal de Edición Individual (No se cierra al dar clic afuera)
     ───────────────────────────────────────────────────────────── */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(15, 23, 42, 0.6);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 16px;
    box-sizing: border-box;
  }

  .modal-card {
    background: #ffffff;
    border-radius: 12px;
    width: 100%;
    max-width: 480px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    animation: modalIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes modalIn {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  .modal-header {
    padding: 16px 20px;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #f8fafc;
  }

  .modal-header-info {
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
    font-size: 12px;
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
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-height: 65vh;
    overflow-y: auto;
  }

  .modal-row-2col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .form-group-modal {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .label-with-action {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .form-label-modal {
    font-size: 12.5px;
    font-weight: 700;
    color: #1e293b;
  }

  .btn-inline-now {
    background: none;
    border: none;
    color: #2563eb;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
    transition: color 0.15s ease;
  }

  .btn-inline-now:hover {
    color: #1d4ed8;
    text-decoration: underline;
  }

  .form-time-input-modal, .form-input-modal, .form-textarea-modal {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13px;
    box-sizing: border-box;
    outline: none;
    font-family: inherit;
  }

  .form-time-input-modal:focus, .form-input-modal:focus, .form-textarea-modal:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
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

  .btn-modal-cancel {
    padding: 8px 16px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    color: #475569;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-modal-cancel:hover {
    background: #f1f5f9;
  }

  .btn-modal-save {
    padding: 8px 18px;
    background: #2563eb;
    border: none;
    color: #ffffff;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .btn-modal-save:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .btn-modal-save:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
