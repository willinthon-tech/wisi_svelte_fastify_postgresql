<script>
  import { onMount, tick } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import {
    masterSalasStore,
    masterEmpleadosStore,
    masterRangosStore,
    masterLibrosStore,
    loadMasterStoresFromBackend
  } from '../../controllers/master.store.js';

  export let libro = null;
  export let libroId = null;

  $: targetSalaId = Number(libro?.sala_id || ($masterLibrosStore || []).find(l => Number(l.id) === Number(libroId))?.sala_id);

  // --- ESTADO DEL FORMULARIO ---
  let selectedEmpleado = null; // Objeto empleado seleccionado
  let empleadoSearchQuery = '';
  let showEmpleadoDropdown = false;
  let selectedDropdownIndex = -1;

  let selectedRango = null; // Objeto rango seleccionado
  let selectedRangoId = '';
  let rangoSearchQuery = '';
  let showRangoDropdown = false;
  let selectedRangoDropdownIndex = -1;

  let tipo = 'Aporte'; // 'Aporte' | 'Devolución'
  let monto = '';
  let isSaving = false;

  // Referencias para navegación por teclado (Tab / Enter)
  let empleadoInputEl = null;
  let rangoInputEl = null;
  let montoInputEl = null;

  // --- DATOS Y REGISTROS ---
  let records = [];
  let isLoadingRecords = true;
  let serverRangos = [];

  // Pestaña activa en la tarjeta derecha: 'detallado' | 'rangos' | 'empleados'
  let activeTab = 'detallado';
  let busquedaEmpleadoResumen = '';

  // Modal de Edición
  let showModalEditar = false;
  let editingRecord = null;
  let modalTipo = 'Aporte';
  let modalEmpleadoId = null;
  let modalRangoId = null;
  let modalMonto = '';
  let isSavingModal = false;

  // Encabezado superior oscuro (ej. "Roraima - 10/09/2026")
  $: tableHeaderTitle = (() => {
    const salaName = libro?.sala_nombre || 
      ($masterSalasStore || []).find(s => Number(s.id) === Number(libro?.sala_id))?.nombre ||
      libro?.sala_nombre_comercial ||
      ($masterSalasStore || []).find(s => Number(s.id) === Number(libro?.sala_id))?.nombre_comercial || 'Sala';
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

  function formatHora(dt) {
    if (!dt) return '—';
    try {
      const d = new Date(dt);
      if (isNaN(d.getTime())) return dt;
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } catch {
      return dt;
    }
  }

  function formatMonto(val) {
    const num = parseFloat(val);
    if (isNaN(num)) return '0.00';
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Lista de rangos disponibles
  $: listaRangos = (() => {
    const storeRangos = $masterRangosStore || [];
    const list = storeRangos.length > 0 ? storeRangos : serverRangos;
    return [...list].sort((a, b) => Number(a.id) - Number(b.id));
  })();

  // Coincidencias de búsqueda de Rangos (idéntico a empleados)
  $: rangosSugerencias = (() => {
    const q = (rangoSearchQuery || '').trim().toLowerCase();
    if (!q) return listaRangos;
    return listaRangos.filter(rg => 
      rg.nombre.toLowerCase().includes(q) ||
      String(rg.id).includes(q)
    );
  })();

  // Lista de empleados activos de la sala
  $: listaEmpleados = ($masterEmpleadosStore || [])
    .filter(e => {
      if (targetSalaId && e.sala_id && Number(e.sala_id) !== targetSalaId) {
        return false;
      }
      if (e.activo !== undefined && (Number(e.activo) === 0 || e.activo === false)) {
        return false;
      }
      return true;
    })
    .map(e => {
      const fullName = [e.nombre, e.apellido].filter(Boolean).join(' ').trim() || e.nombre || `Empleado #${e.id}`;
      return {
        id: e.id,
        nombre: fullName,
        cedula: e.cedula || '',
        cargo_nombre: (e.cargo_nombre || '').trim() || 'General',
        departamento_nombre: (e.departamento_nombre || '').trim(),
        foto: e.foto || null,
        sala_id: e.sala_id
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  // Coincidencias de búsqueda por NOMBRE o por CARGO (o por Cédula)
  $: empleadosSugerencias = (() => {
    const q = (empleadoSearchQuery || '').trim().toLowerCase();
    if (!q) return listaEmpleados.slice(0, 10);
    return listaEmpleados.filter(emp => {
      const matchNom = emp.nombre.toLowerCase().includes(q);
      const matchCargo = emp.cargo_nombre.toLowerCase().includes(q);
      const matchCedula = String(emp.cedula || '').toLowerCase().includes(q);
      return matchNom || matchCargo || matchCedula;
    }).slice(0, 10);
  })();

  // Registros ordenados por el más reciente primero (ID DESC)
  $: sortedRecords = [...records].sort((a, b) => Number(b.id) - Number(a.id));

  // --- CÁLCULOS ESTADÍSTICOS Y TOTALES ---
  $: aportesList = records.filter(r => (r.tipo || 'Aporte') === 'Aporte');
  $: devolucionesList = records.filter(r => r.tipo === 'Devolución');

  $: totalAportesMonto = aportesList.reduce((acc, r) => acc + (Number(r.monto) || 0), 0);
  $: totalDevolucionesMonto = devolucionesList.reduce((acc, r) => acc + (Number(r.monto) || 0), 0);
  $: netoMonto = totalAportesMonto - totalDevolucionesMonto;

  $: totalAportesCount = aportesList.length;
  $: totalDevolucionesCount = devolucionesList.length;
  $: totalMonto = totalAportesMonto;
  $: promedioMonto = totalAportesCount > 0 ? (totalAportesMonto / totalAportesCount) : 0;

  // Resumen agrupado por Rango (ordenado por monto mayor a menor)
  $: resumenRangos = (() => {
    const map = new Map();
    for (const r of records) {
      const rId = r.rango_id || 0;
      const rName = r.rango_nombre || `Rango #${rId}`;
      if (!map.has(rId)) {
        map.set(rId, {
          rango_id: rId,
          rango_nombre: rName,
          cantidad: 0,
          total_monto: 0
        });
      }
      const entry = map.get(rId);
      entry.cantidad += 1;
      const val = Number(r.monto) || 0;
      if (r.tipo === 'Devolución') {
        entry.total_monto -= val;
      } else {
        entry.total_monto += val;
      }
    }

    const list = Array.from(map.values()).map(item => ({
      ...item,
      porcentaje: netoMonto > 0 ? ((item.total_monto / netoMonto) * 100) : 0,
      promedio: item.cantidad > 0 ? (item.total_monto / item.cantidad) : 0
    }));

    return list.sort((a, b) => b.total_monto - a.total_monto);
  })();

  // Resumen agrupado por Empleado (ordenado por monto mayor a menor)
  $: resumenEmpleados = (() => {
    const map = new Map();
    for (const r of records) {
      const eId = r.empleado_id || 0;
      if (!map.has(eId)) {
        map.set(eId, {
          empleado_id: eId,
          empleado_nombre: r.empleado_nombre || `Empleado #${eId}`,
          empleado_cedula: r.empleado_cedula || '',
          cargo_nombre: r.cargo_nombre || 'General',
          cantidad: 0,
          total_monto: 0,
          rangos_usados: new Set()
        });
      }
      const entry = map.get(eId);
      entry.cantidad += 1;
      const val = Number(r.monto) || 0;
      if (r.tipo === 'Devolución') {
        entry.total_monto -= val;
      } else {
        entry.total_monto += val;
      }
      if (r.rango_nombre) entry.rangos_usados.add(r.rango_nombre);
    }

    const list = Array.from(map.values()).map(item => ({
      ...item,
      rangos_texto: Array.from(item.rangos_usados).join(', '),
      porcentaje: netoMonto > 0 ? ((item.total_monto / netoMonto) * 100) : 0,
      promedio: item.cantidad > 0 ? (item.total_monto / item.cantidad) : 0
    }));

    let filtered = list;
    if (busquedaEmpleadoResumen.trim()) {
      const q = busquedaEmpleadoResumen.trim().toLowerCase();
      filtered = list.filter(item => 
        item.empleado_nombre.toLowerCase().includes(q) ||
        item.cargo_nombre.toLowerCase().includes(q) ||
        item.empleado_cedula.toLowerCase().includes(q)
      );
    }

    return filtered.sort((a, b) => b.total_monto - a.total_monto);
  })();

  onMount(async () => {
    await Promise.all([
      loadMasterStoresFromBackend(),
      fetchRangosServer(),
      loadRecords()
    ]);
  });

  $: if (libroId) {
    loadRecords();
  }

  async function fetchRangosServer() {
    try {
      const res = await fetch('/api/master/rangos?limit=all');
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && Array.isArray(json.data)) {
          serverRangos = json.data;
        }
      }
    } catch (e) {
      console.warn('Error fetching rangos:', e);
    }
  }

  async function loadRecords() {
    const lId = libroId || libro?.id;
    if (!lId) return;
    isLoadingRecords = true;
    try {
      const res = await fetch(`/api/master/libros/${lId}/aportes-maquinas`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success) {
          records = json.data || [];
        }
      }
    } catch (err) {
      console.error('Error al cargar aportes de máquinas:', err);
    } finally {
      isLoadingRecords = false;
    }
  }

  // --- MANEJO DE AUTOCOMPLETADO Y TECLADO PARA EMPLEADO (TAB / ENTER) ---
  function onEmpleadoInputFocus() {
    showEmpleadoDropdown = true;
    selectedDropdownIndex = -1;
  }

  function onEmpleadoInputChange() {
    showEmpleadoDropdown = true;
    selectedDropdownIndex = -1;
    const q = (empleadoSearchQuery || '').trim().toLowerCase();
    const match = listaEmpleados.find(e => e.nombre.toLowerCase() === q);
    if (match) {
      selectedEmpleado = match;
    } else {
      selectedEmpleado = null;
    }
  }

  function onEmpleadoInputBlur() {
    setTimeout(() => {
      showEmpleadoDropdown = false;
    }, 200);
  }

  function seleccionarEmpleado(emp) {
    selectedEmpleado = emp;
    empleadoSearchQuery = emp.nombre;
    showEmpleadoDropdown = false;
    selectedDropdownIndex = -1;

    // Salto automático al campo Rango
    tick().then(() => {
      if (rangoInputEl) rangoInputEl.focus();
    });
  }

  function onEmpleadoInputKeyDown(e) {
    if (!showEmpleadoDropdown || empleadosSugerencias.length === 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        showEmpleadoDropdown = true;
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedDropdownIndex = (selectedDropdownIndex + 1) % empleadosSugerencias.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedDropdownIndex = (selectedDropdownIndex - 1 + empleadosSugerencias.length) % empleadosSugerencias.length;
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (selectedDropdownIndex >= 0 && empleadosSugerencias[selectedDropdownIndex]) {
        e.preventDefault();
        seleccionarEmpleado(empleadosSugerencias[selectedDropdownIndex]);
      } else if (empleadosSugerencias.length > 0) {
        e.preventDefault();
        seleccionarEmpleado(empleadosSugerencias[0]);
      }
    } else if (e.key === 'Escape') {
      showEmpleadoDropdown = false;
      selectedDropdownIndex = -1;
    }
  }

  // --- MANEJO DE AUTOCOMPLETADO Y TECLADO PARA RANGO (TAB / ENTER) ---
  function onRangoInputFocus() {
    showRangoDropdown = true;
    selectedRangoDropdownIndex = -1;
  }

  function onRangoInputChange() {
    showRangoDropdown = true;
    selectedRangoDropdownIndex = -1;
    const q = (rangoSearchQuery || '').trim().toLowerCase();
    const match = listaRangos.find(r => r.nombre.toLowerCase().trim() === q);
    if (match) {
      selectedRango = match;
      selectedRangoId = String(match.id);
    } else {
      selectedRango = null;
      selectedRangoId = '';
    }
  }

  function onRangoInputBlur() {
    setTimeout(() => {
      showRangoDropdown = false;
    }, 200);
  }

  function seleccionarRango(rg) {
    selectedRango = rg;
    selectedRangoId = String(rg.id);
    rangoSearchQuery = rg.nombre;
    showRangoDropdown = false;
    selectedRangoDropdownIndex = -1;

    // Salto automático al campo Monto
    tick().then(() => {
      if (montoInputEl) montoInputEl.focus();
    });
  }

  function onRangoInputKeyDown(e) {
    if (!showRangoDropdown || rangosSugerencias.length === 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        showRangoDropdown = true;
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedRangoDropdownIndex = (selectedRangoDropdownIndex + 1) % rangosSugerencias.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedRangoDropdownIndex = (selectedRangoDropdownIndex - 1 + rangosSugerencias.length) % rangosSugerencias.length;
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      if (selectedRangoDropdownIndex >= 0 && rangosSugerencias[selectedRangoDropdownIndex]) {
        e.preventDefault();
        seleccionarRango(rangosSugerencias[selectedRangoDropdownIndex]);
      } else if (rangosSugerencias.length > 0) {
        e.preventDefault();
        seleccionarRango(rangosSugerencias[0]);
      }
    } else if (e.key === 'Escape') {
      showRangoDropdown = false;
      selectedRangoDropdownIndex = -1;
    }
  }

  function onMontoKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleGuardar();
    }
  }

  async function handleGuardar() {
    const lId = libroId || libro?.id;
    if (!lId) {
      triggerToast('No se encontró el ID del libro', 'error');
      return;
    }

    let empId = selectedEmpleado?.id;
    if (!empId) {
      const q = (empleadoSearchQuery || '').trim().toLowerCase();
      const match = listaEmpleados.find(e => e.nombre.toLowerCase() === q);
      if (match) {
        empId = match.id;
        selectedEmpleado = match;
      } else {
        triggerToast('Debe seleccionar un empleado de la lista', 'warning');
        if (empleadoInputEl) empleadoInputEl.focus();
        return;
      }
    }

    let rId = Number(selectedRangoId);
    if (!rId) {
      const q = (rangoSearchQuery || '').trim().toLowerCase();
      const match = listaRangos.find(r => r.nombre.toLowerCase().trim() === q);
      if (match) {
        rId = Number(match.id);
        selectedRango = match;
        selectedRangoId = String(match.id);
      } else {
        triggerToast('Debe seleccionar un rango de la lista', 'warning');
        if (rangoInputEl) rangoInputEl.focus();
        return;
      }
    }

    const numMonto = parseFloat(monto);
    if (isNaN(numMonto) || numMonto <= 0) {
      triggerToast('Debe ingresar un monto válido mayor a 0', 'warning');
      if (montoInputEl) montoInputEl.focus();
      return;
    }

    isSaving = true;
    try {
      const res = await fetch(`/api/master/libros/${lId}/aportes-maquinas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empleado_id: empId,
          rango_id: rId,
          monto: numMonto,
          tipo: tipo || 'Aporte'
        })
      });

      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast(`${tipo === 'Devolución' ? 'Devolución' : 'Aporte'} guardado correctamente`, 'success');
        
        // Limpiar formulario
        selectedEmpleado = null;
        empleadoSearchQuery = '';
        selectedRango = null;
        selectedRangoId = '';
        rangoSearchQuery = '';
        monto = '';
        tipo = 'Aporte';
        
        await loadRecords();

        // Refocus de inmediato en el empleado para continuar cargando
        tick().then(() => {
          if (empleadoInputEl) empleadoInputEl.focus();
        });
      } else {
        triggerToast(json?.error || 'Error al registrar operación', 'error');
      }
    } catch (err) {
      console.error('Error al guardar:', err);
      triggerToast(`Error: ${err.message}`, 'error');
    } finally {
      isSaving = false;
    }
  }

  async function handleEliminar(record) {
    const label = record.tipo === 'Devolución' ? 'la devolución' : 'el aporte';
    if (!confirm(`¿Está seguro de eliminar ${label} de $${formatMonto(record.monto)} para ${record.empleado_nombre}?`)) {
      return;
    }

    const lId = libroId || libro?.id;
    try {
      const res = await fetch(`/api/master/libros/${lId}/aportes-maquinas/${record.id}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Registro eliminado correctamente', 'success');
        await loadRecords();
      } else {
        triggerToast(json?.error || 'Error al eliminar', 'error');
      }
    } catch (err) {
      console.error('Error al eliminar:', err);
      triggerToast(`Error: ${err.message}`, 'error');
    }
  }

  function abrirModalEditar(record) {
    editingRecord = record;
    modalTipo = record.tipo || 'Aporte';
    modalEmpleadoId = record.empleado_id;
    modalRangoId = String(record.rango_id);
    modalMonto = String(record.monto);
    showModalEditar = true;
  }

  function cerrarModalEditar() {
    showModalEditar = false;
    editingRecord = null;
    modalTipo = 'Aporte';
    modalEmpleadoId = null;
    modalRangoId = null;
    modalMonto = '';
  }

  async function handleGuardarEdicion() {
    const lId = libroId || libro?.id;
    if (!lId || !editingRecord) return;

    const numMonto = parseFloat(modalMonto);
    if (isNaN(numMonto) || numMonto <= 0) {
      triggerToast('Debe ingresar un monto válido', 'warning');
      return;
    }

    isSavingModal = true;
    try {
      const res = await fetch(`/api/master/libros/${lId}/aportes-maquinas/${editingRecord.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empleado_id: Number(modalEmpleadoId),
          rango_id: Number(modalRangoId),
          monto: numMonto,
          tipo: modalTipo || 'Aporte'
        })
      });

      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Registro actualizado exitosamente', 'success');
        cerrarModalEditar();
        await loadRecords();
      } else {
        triggerToast(json?.error || 'Error al actualizar', 'error');
      }
    } catch (err) {
      console.error('Error al actualizar:', err);
      triggerToast(`Error: ${err.message}`, 'error');
    } finally {
      isSavingModal = false;
    }
  }
</script>

<div class="clientes-layout-grid">
  <!-- Tarjeta Izquierda: Formulario "Aportes Máquinas" -->
  <div class="card-form-cliente">
    <div class="card-title-box">
      <h3 class="card-title">Aportes Máquinas</h3>
      <div class="title-underline"></div>
    </div>

    <form on:submit|preventDefault={handleGuardar} class="cliente-form" autocomplete="off">
      
      <!-- Campo 1: Empleado con Autocompletado / Coincidencias -->
      <div class="form-group relative-autocomplete">
        <label for="input-empleado-nombre" class="form-label">EMPLEADO: *</label>
        <div class="cell-autocomplete-container">
          <input 
            id="input-empleado-nombre" 
            bind:this={empleadoInputEl}
            type="text" 
            class="form-input {showEmpleadoDropdown && empleadosSugerencias.length > 0 ? 'input-active' : ''}" 
            placeholder="Escriba Empleado (coincidencias con Tab ⇥)..." 
            bind:value={empleadoSearchQuery}
            on:focus={onEmpleadoInputFocus}
            on:input={onEmpleadoInputChange}
            on:keydown={onEmpleadoInputKeyDown}
            on:blur={onEmpleadoInputBlur}
            autocomplete="off"
            required
          />

          <!-- Desplegable visual de sugerencias rápidas -->
          {#if showEmpleadoDropdown && empleadosSugerencias.length > 0}
            <div class="inline-dropdown">
              <div class="inline-dropdown-header">
                <span>Coincidencias (<b>Tab ⇥</b> o clic):</span>
              </div>
              <ul class="inline-dropdown-list">
                {#each empleadosSugerencias as emp, idx}
                  <!-- svelte-ignore a11y-click-events-have-key-events -->
                  <li 
                    class="inline-dropdown-item {idx === selectedDropdownIndex ? 'selected' : ''}"
                    on:mousedown|preventDefault={() => seleccionarEmpleado(emp)}
                  >
                    <span class="sug-avatar">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="#3b2b73">
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                      </svg>
                    </span>
                    <div class="sug-info">
                      <span class="sug-name">{emp.nombre}</span>
                      <span class="sug-cargo">{emp.cargo_nombre}</span>
                    </div>
                    <span class="sug-tab-badge">Tab ⇥</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
        <span class="field-hint">Escriba nombre o cargo del empleado. Pulsa <b>Tab ⇥</b> para autocompletar.</span>
      </div>

      <!-- Campo Tipo de Operación: Aporte o Devolución (Estilo idéntico a Control Clientes) -->
      <div class="form-group">
        <label class="form-label">TIPO: *</label>
        <div class="radio-toggle-group">
          <label class="radio-option {tipo === 'Aporte' ? 'selected-aporte' : ''}">
            <input 
              type="radio" 
              name="tipo-aporte" 
              value="Aporte" 
              bind:group={tipo}
            />
            <span class="radio-custom"></span>
            <span class="radio-text">💰 Aporte</span>
          </label>

          <label class="radio-option {tipo === 'Devolución' ? 'selected-devolucion' : ''}">
            <input 
              type="radio" 
              name="tipo-aporte" 
              value="Devolución" 
              bind:group={tipo}
            />
            <span class="radio-custom"></span>
            <span class="radio-text">🔄 Devolución</span>
          </label>
        </div>
      </div>

      <!-- Campo 2: Rango con Autocompletado / Coincidencias idéntico a Empleado -->
      <div class="form-group relative-autocomplete">
        <label for="input-rango-nombre" class="form-label">RANGO: *</label>
        <div class="cell-autocomplete-container">
          <input 
            id="input-rango-nombre" 
            bind:this={rangoInputEl}
            type="text" 
            class="form-input {showRangoDropdown && rangosSugerencias.length > 0 ? 'input-active' : ''}" 
            placeholder="Escriba Rango (coincidencias con Tab ⇥)..." 
            bind:value={rangoSearchQuery}
            on:focus={onRangoInputFocus}
            on:input={onRangoInputChange}
            on:keydown={onRangoInputKeyDown}
            on:blur={onRangoInputBlur}
            autocomplete="off"
            required
          />

          <!-- Desplegable visual de sugerencias rápidas de rango -->
          {#if showRangoDropdown && rangosSugerencias.length > 0}
            <div class="inline-dropdown">
              <div class="inline-dropdown-header">
                <span>Coincidencias (<b>Tab ⇥</b> o clic):</span>
              </div>
              <ul class="inline-dropdown-list">
                {#each rangosSugerencias as rg, idx}
                  <!-- svelte-ignore a11y-click-events-have-key-events -->
                  <li 
                    class="inline-dropdown-item {idx === selectedRangoDropdownIndex ? 'selected' : ''}"
                    on:mousedown|preventDefault={() => seleccionarRango(rg)}
                  >
                    <span class="sug-avatar">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="#3b2b73">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                      </svg>
                    </span>
                    <div class="sug-info">
                      <span class="sug-name">{rg.nombre}</span>
                      <span class="sug-cargo">Asignación de Rango</span>
                    </div>
                    <span class="sug-tab-badge">Tab ⇥</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
        <span class="field-hint">Escriba o seleccione el rango. Pulsa <b>Tab ⇥</b> para autocompletar.</span>
      </div>

      <!-- Campo 3: Monto -->
      <div class="form-group">
        <label for="input-monto" class="form-label">MONTO: *</label>
        <div class="input-currency-wrapper">
          <span class="currency-symbol">$</span>
          <input 
            id="input-monto" 
            bind:this={montoInputEl}
            type="number" 
            step="0.01" 
            min="0.01" 
            class="form-input input-currency" 
            placeholder="0.00" 
            bind:value={monto}
            on:keydown={onMontoKeyDown}
            required
          />
        </div>
        <span class="field-hint">Ingrese el monto en divisas. Pulsa <b>Enter ↵</b> para guardar.</span>
      </div>

      <!-- Botón Guardar -->
      <button 
        type="submit" 
        class="btn-guardar {tipo === 'Devolución' ? 'btn-guardar-devolucion' : ''}"
        disabled={isSaving}
      >
        {#if isSaving}
          <span>Guardando...</span>
        {:else}
          <span>Guardar {tipo}</span>
        {/if}
      </button>
    </form>
  </div>

  <!-- Columna Derecha: Tarjeta Unificada con KPIs y Pestañas -->
  <div class="clientes-right-column">
    <div class="card-resumen-clientes">
      
      <!-- Barra Superior Oscura con Sala y Fecha -->
      <div class="resumen-top-bar">
        <div class="resumen-bar-title">
          <span>{tableHeaderTitle}</span>
        </div>
        <span class="resumen-tag-ops">{records.length} {records.length === 1 ? 'operación' : 'operaciones'} en total</span>
      </div>

      <!-- Tarjetas de Métricas Globales (KPIs) -->
      <div class="kpi-metrics-grid">
        <!-- KPI 1: Total Aportes $ -->
        <div class="kpi-card kpi-compras">
          <div class="kpi-header">
            <span class="kpi-icon">💰</span>
            <span class="kpi-label">TOTAL APORTES</span>
          </div>
          <div class="kpi-value-row">
            <span class="kpi-value text-green">${formatMonto(totalAportesMonto)}</span>
          </div>
          <div class="kpi-subtext">
            <span>{totalAportesCount} {totalAportesCount === 1 ? 'operación' : 'operaciones'}</span>
          </div>
        </div>

        <!-- KPI 2: Total Devoluciones $ -->
        <div class="kpi-card kpi-pagos">
          <div class="kpi-header">
            <span class="kpi-icon">🔄</span>
            <span class="kpi-label">TOTAL DEVOLUCIONES</span>
          </div>
          <div class="kpi-value-row">
            <span class="kpi-value text-purple">${formatMonto(totalDevolucionesMonto)}</span>
          </div>
          <div class="kpi-subtext">
            <span>{totalDevolucionesCount} {totalDevolucionesCount === 1 ? 'operación' : 'operaciones'}</span>
          </div>
        </div>

        <!-- KPI 3: Neto Aportes $ -->
        <div class="kpi-card kpi-balance">
          <div class="kpi-header">
            <span class="kpi-icon">📈</span>
            <span class="kpi-label">NETO APORTES</span>
          </div>
          <div class="kpi-value-row">
            <span class="kpi-value text-blue">${formatMonto(netoMonto)}</span>
          </div>
          <div class="kpi-subtext">
            <span>Aportes - Devoluciones</span>
          </div>
        </div>

        <!-- KPI 4: Rango Líder -->
        <div class="kpi-card kpi-drop">
          <div class="kpi-header">
            <span class="kpi-icon">🏅</span>
            <span class="kpi-label">RANGO CON MÁS APORTES</span>
          </div>
          <div class="kpi-value-row">
            <span class="kpi-value text-slate font-truncate">{resumenRangos.length > 0 ? resumenRangos[0].rango_nombre : '—'}</span>
          </div>
          <div class="kpi-subtext">
            <span>{resumenRangos.length > 0 ? `$${formatMonto(resumenRangos[0].total_monto)} (${resumenRangos[0].cantidad} ops)` : 'Sin datos'}</span>
          </div>
        </div>
      </div>

      <!-- Selector de Pestañas: 1. Detallado, 2. Rangos, 3. Empleados -->
      <div class="resumen-tabs-header">
        <div class="tabs-nav-list">
          <button 
            type="button" 
            class="tab-nav-btn {activeTab === 'detallado' ? 'active' : ''}"
            on:click={() => activeTab = 'detallado'}
          >
            <span>📋 Detallado de Operaciones ({records.length})</span>
          </button>
          <button 
            type="button" 
            class="tab-nav-btn {activeTab === 'rangos' ? 'active' : ''}"
            on:click={() => activeTab = 'rangos'}
          >
            <span>🏅 Resumen por Rango ({resumenRangos.length})</span>
          </button>
          <button 
            type="button" 
            class="tab-nav-btn {activeTab === 'empleados' ? 'active' : ''}"
            on:click={() => activeTab = 'empleados'}
          >
            <span>👥 Resumen por Empleado ({resumenEmpleados.length})</span>
          </button>
        </div>

        {#if activeTab === 'empleados'}
          <div class="tab-search-wrapper">
            <span class="search-icon">🔍</span>
            <input 
              type="text" 
              class="input-search-cliente-resumen" 
              placeholder="Buscar empleado..." 
              bind:value={busquedaEmpleadoResumen} 
            />
          </div>
        {/if}
      </div>

      <!-- Pestaña 1: Detallado de Operaciones (MÁS RECIENTE PRIMERO: ID DESC) -->
      {#if activeTab === 'detallado'}
        <div class="table-wrapper">
          <table class="clientes-table">
            <thead>
              <tr>
                <th class="th-center th-num">N°</th>
                <th class="th-center th-tipo-col">Tipo</th>
                <th class="th-cliente">Empleado</th>
                <th class="th-center th-tipo">Rango</th>
                <th class="th-right th-monto">Monto</th>
                <th class="th-center th-metodo">Cargo</th>
                <th class="th-center th-hora">Hora</th>
                <th class="th-center th-acciones">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {#if isLoadingRecords}
                <tr>
                  <td colspan="8" class="empty-state-cell">
                    <div class="loading-state-inline">
                      <div class="spinner-small"></div>
                      <span>Cargando registros de operaciones...</span>
                    </div>
                  </td>
                </tr>
              {:else if sortedRecords.length === 0}
                <tr>
                  <td colspan="8" class="empty-state-cell">
                    <span class="empty-text">No hay operaciones registradas en esta fecha.</span>
                  </td>
                </tr>
              {:else}
                {#each sortedRecords as record, idx (record.id)}
                  <tr class="cliente-row">
                    <td class="td-center td-num">{idx + 1}</td>
                    <td class="td-center td-tipo-col">
                      {#if (record.tipo || 'Aporte') === 'Devolución'}
                        <span class="badge-tipo badge-devolucion">🔄 Devolución</span>
                      {:else}
                        <span class="badge-tipo badge-aporte">💰 Aporte</span>
                      {/if}
                    </td>
                    <td class="td-cliente">
                      <div class="cliente-cell-content">
                        <span class="cliente-name">{record.empleado_nombre}</span>
                      </div>
                    </td>
                    <td class="td-center td-tipo">
                      <span class="badge-tipo badge-pago">🏅 {record.rango_nombre || `Rango #${record.rango_id}`}</span>
                    </td>
                    <td class="td-right td-monto">
                      <span class="monto-value {record.tipo === 'Devolución' ? 'monto-devolucion' : ''}">
                        {record.tipo === 'Devolución' ? '-' : ''}${formatMonto(record.monto)}
                      </span>
                    </td>
                    <td class="td-center td-metodo">
                      <span class="badge-metodo metodo-pdv">
                        {record.cargo_nombre || 'General'}
                      </span>
                    </td>
                    <td class="td-center td-hora-val">
                      <span class="time-badge">{formatHora(record.created_at)}</span>
                    </td>
                    <td class="td-center td-acciones">
                      <div class="acciones-btns-row">
                        <button 
                          type="button" 
                          class="btn-metodo-hora-accion"
                          on:click={() => abrirModalEditar(record)}
                          title="Editar Aporte"
                        >
                          ✏️ Editar
                        </button>
                        <button 
                          type="button" 
                          class="btn-eliminar"
                          on:click={() => handleEliminar(record)}
                          title="Eliminar este registro"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                {/each}
              {/if}
            </tbody>
          </table>
        </div>

      <!-- Pestaña 2: Resumen por Rango -->
      {:else if activeTab === 'rangos'}
        <div class="table-wrapper">
          <table class="clientes-table">
            <thead>
              <tr>
                <th class="th-center th-num">N°</th>
                <th class="th-cliente">Rango</th>
                <th class="th-center th-tipo">Cant. Aportes</th>
                <th class="th-right th-monto">Monto Total</th>
                <th class="th-center th-metodo">% del Total</th>
                <th class="th-right th-monto">Promedio</th>
              </tr>
            </thead>
            <tbody>
              {#if isLoadingRecords}
                <tr>
                  <td colspan="6" class="loading-state">
                    <div class="spinner-small"></div>
                    <span>Cargando datos de rangos...</span>
                  </td>
                </tr>
              {:else if resumenRangos.length === 0}
                <tr>
                  <td colspan="6" class="empty-state-cell">
                    <span class="empty-text">Sin datos de aportes por rango para esta fecha.</span>
                  </td>
                </tr>
              {:else}
                {#each resumenRangos as rg, idx}
                  <tr class="cliente-row">
                    <td class="td-center td-num">{idx + 1}</td>
                    <td class="td-cliente">
                      <span class="cliente-name">{rg.rango_nombre}</span>
                    </td>
                    <td class="td-center td-tipo">
                      <span class="badge-tipo badge-compra">{rg.cantidad} ops</span>
                    </td>
                    <td class="td-right td-monto">
                      <span class="monto-value">${formatMonto(rg.total_monto)}</span>
                    </td>
                    <td class="td-center td-metodo">
                      <span class="badge-metodo metodo-pdv">{rg.porcentaje.toFixed(1)}%</span>
                    </td>
                    <td class="td-right td-monto">
                      <span class="monto-value">${formatMonto(rg.promedio)}</span>
                    </td>
                  </tr>
                {/each}
              {/if}
            </tbody>
          </table>
        </div>

      <!-- Pestaña 3: Resumen por Empleado -->
      {:else if activeTab === 'empleados'}
        <div class="table-wrapper">
          <table class="clientes-table">
            <thead>
              <tr>
                <th class="th-center th-num">N°</th>
                <th class="th-cliente">Empleado</th>
                <th class="th-center th-metodo">Cargo</th>
                <th class="th-center th-tipo">Cant. Aportes</th>
                <th class="th-right th-monto">Monto Total</th>
                <th class="th-center th-metodo">% del Total</th>
                <th class="th-right th-monto">Promedio</th>
              </tr>
            </thead>
            <tbody>
              {#if isLoadingRecords}
                <tr>
                  <td colspan="7" class="loading-state">
                    <div class="spinner-small"></div>
                    <span>Cargando datos de empleados...</span>
                  </td>
                </tr>
              {:else if resumenEmpleados.length === 0}
                <tr>
                  <td colspan="7" class="empty-state-cell">
                    <span class="empty-text">Sin datos de aportes por empleado para esta fecha.</span>
                  </td>
                </tr>
              {:else}
                {#each resumenEmpleados as emp, idx}
                  <tr class="cliente-row">
                    <td class="td-center td-num">{idx + 1}</td>
                    <td class="td-cliente">
                      <div class="cliente-cell-content">
                        <span class="cliente-name">{emp.empleado_nombre}</span>
                      </div>
                    </td>
                    <td class="td-center td-metodo">
                      <span class="badge-metodo metodo-general">{emp.cargo_nombre}</span>
                    </td>
                    <td class="td-center td-tipo">
                      <span class="badge-tipo badge-compra">{emp.cantidad} ops</span>
                    </td>
                    <td class="td-right td-monto">
                      <span class="monto-value">${formatMonto(emp.total_monto)}</span>
                    </td>
                    <td class="td-center td-metodo">
                      <span class="badge-metodo metodo-pdv">{emp.porcentaje.toFixed(1)}%</span>
                    </td>
                    <td class="td-right td-monto">
                      <span class="monto-value">${formatMonto(emp.promedio)}</span>
                    </td>
                  </tr>
                {/each}
              {/if}
            </tbody>
          </table>
        </div>
      {/if}

    </div>
  </div>
</div>

<!-- Modal para editar Aporte (idéntico a Control de Clientes) -->
{#if showModalEditar && editingRecord}
  <div class="modal-backdrop-fixed">
    <div class="modal-dialog-box" role="dialog" aria-modal="true" aria-labelledby="modal-editar-title">
      <div class="modal-header">
        <h4 id="modal-editar-title" class="modal-title">⚙️ Editar Aporte #{editingRecord.id}</h4>
        <button type="button" class="btn-close-modal" on:click={cerrarModalEditar} aria-label="Cerrar">
          &times;
        </button>
      </div>

      <form on:submit|preventDefault={handleGuardarEdicion} class="modal-body-form">
        <!-- Resumen del Registro -->
        <div class="modal-info-banner">
          <span class="info-label">Empleado:</span>
          <span class="info-val">{editingRecord.empleado_nombre}</span>
          <span class="info-sep">•</span>
          <span class="info-label">Rango:</span>
          <span class="info-badge badge-pago">{editingRecord.rango_nombre || 'Rango'}</span>
          <span class="info-sep">•</span>
          <span class="info-label">Monto:</span>
          <span class="info-val">${formatMonto(editingRecord.monto)}</span>
        </div>

        <div class="modal-inputs-grid">
          <!-- Tipo de Operación en Modal -->
          <div class="modal-field-group">
            <label class="modal-field-label">Tipo: *</label>
            <div class="radio-toggle-group">
              <label class="radio-option {modalTipo === 'Aporte' ? 'selected-aporte' : ''}">
                <input 
                  type="radio" 
                  name="modal-tipo-aporte" 
                  value="Aporte" 
                  bind:group={modalTipo}
                />
                <span class="radio-custom"></span>
                <span class="radio-text">💰 Aporte</span>
              </label>

              <label class="radio-option {modalTipo === 'Devolución' ? 'selected-devolucion' : ''}">
                <input 
                  type="radio" 
                  name="modal-tipo-aporte" 
                  value="Devolución" 
                  bind:group={modalTipo}
                />
                <span class="radio-custom"></span>
                <span class="radio-text">🔄 Devolución</span>
              </label>
            </div>
          </div>

          <!-- Selección de Empleado -->
          <div class="modal-field-group">
            <label for="modal-select-emp" class="modal-field-label">Empleado: *</label>
            <select id="modal-select-emp" class="form-input" bind:value={modalEmpleadoId} required>
              {#each listaEmpleados as e}
                <option value={e.id}>{e.nombre} ({e.cargo_nombre})</option>
              {/each}
            </select>
          </div>

          <!-- Selección de Rango -->
          <div class="modal-field-group">
            <label for="modal-select-rg" class="modal-field-label">Rango: *</label>
            <select id="modal-select-rg" class="form-input" bind:value={modalRangoId} required>
              {#each listaRangos as r}
                <option value={String(r.id)}>{r.nombre}</option>
              {/each}
            </select>
          </div>

          <!-- Monto -->
          <div class="modal-field-group">
            <label for="modal-input-monto" class="modal-field-label">Monto: *</label>
            <div class="input-currency-wrapper">
              <span class="currency-symbol">$</span>
              <input 
                id="modal-input-monto"
                type="number" 
                step="0.01" 
                min="0.01" 
                class="form-input input-currency" 
                bind:value={modalMonto} 
                required
              />
            </div>
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
  .clientes-layout-grid {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 24px;
    align-items: flex-start;
    width: 100%;
    box-sizing: border-box;
  }

  @media (max-width: 1024px) {
    .clientes-layout-grid {
      grid-template-columns: 1fr;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     Tarjeta Izquierda: Formulario
  ───────────────────────────────────────────────────────────── */
  .card-form-cliente {
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

  .cliente-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .relative-autocomplete {
    position: relative;
  }

  .form-label {
    font-size: 13px;
    font-weight: 700;
    color: #1e293b;
    letter-spacing: 0.3px;
  }

  .field-hint {
    font-size: 11.5px;
    color: #64748b;
    margin-top: 2px;
    line-height: 1.35;
  }

  .form-input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13.5px;
    color: #0f172a;
    background-color: #ffffff;
    outline: none;
    transition: all 0.2s ease;
    box-sizing: border-box;
  }

  .form-input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  /* Input con autocompletado en celda */
  .cell-autocomplete-container {
    position: relative;
    width: 100%;
  }

  .form-input.input-active {
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
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08);
    margin-top: 4px;
    min-width: 250px;
    overflow: hidden;
  }

  .inline-dropdown-header {
    background: #f8fafc;
    padding: 6px 12px;
    border-bottom: 1px solid #e2e8f0;
    font-size: 11px;
    font-weight: 700;
    color: #475569;
  }

  .inline-dropdown-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 200px;
    overflow-y: auto;
  }

  .inline-dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    cursor: pointer;
    font-size: 13px;
    color: #1e293b;
    border-bottom: 1px solid #f8fafc;
    transition: background 0.1s ease;
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
    font-size: 13px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
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
    padding: 1px 5px;
    border-radius: 3px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .inline-dropdown-item:hover .sug-tab-badge,
  .inline-dropdown-item.selected .sug-tab-badge {
    background: #dbeafe;
    color: #1d4ed8;
  }

  /* Input Currency */
  .input-currency-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .currency-symbol {
    position: absolute;
    left: 12px;
    font-size: 14px;
    font-weight: 700;
    color: #64748b;
    pointer-events: none;
  }

  .input-currency {
    padding-left: 28px;
    font-weight: 600;
  }

  /* Radio Toggle Group (Estilo idéntico a Control Clientes) */
  .radio-toggle-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .radio-option {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    cursor: pointer;
    background: #f8fafc;
    transition: all 0.2s ease;
    user-select: none;
  }

  .radio-option input[type="radio"] {
    accent-color: #2563eb;
    cursor: pointer;
  }

  .radio-option.selected-aporte {
    border-color: #22c55e;
    background: #f0fdf4;
    color: #15803d;
    font-weight: 700;
  }

  .radio-option.selected-devolucion {
    border-color: #8b5cf6;
    background: #f5f3ff;
    color: #6d28d9;
    font-weight: 700;
  }

  .radio-text {
    font-size: 13.5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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

  .btn-guardar.btn-guardar-devolucion {
    background-color: #8b5cf6;
    box-shadow: 0 2px 4px rgba(139, 92, 246, 0.25);
  }

  .btn-guardar.btn-guardar-devolucion:hover:not(:disabled) {
    background-color: #7c3aed;
    box-shadow: 0 4px 8px rgba(139, 92, 246, 0.35);
  }

  .btn-guardar:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  /* ─────────────────────────────────────────────────────────────
     Columna Derecha: Tabla + Resumen
  ───────────────────────────────────────────────────────────── */
  .clientes-right-column {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
    min-width: 0;
  }

  .card-resumen-clientes {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
  }

  .resumen-top-bar {
    background: #1e293b;
    color: #ffffff;
    padding: 12px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }

  .resumen-bar-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.2px;
  }

  .resumen-tag-ops {
    font-size: 11.5px;
    background: #334155;
    padding: 3px 8px;
    border-radius: 4px;
    color: #cbd5e1;
    font-weight: 600;
  }

  /* Grid de Métricas (KPIs) */
  .kpi-metrics-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    padding: 16px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }

  @media (max-width: 900px) {
    .kpi-metrics-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .kpi-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  .kpi-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .kpi-icon {
    font-size: 14px;
  }

  .kpi-label {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    letter-spacing: 0.4px;
  }

  .kpi-value-row {
    margin-top: 2px;
  }

  .kpi-value {
    font-size: 20px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.3px;
  }

  .text-green { color: #16a34a; }
  .text-purple { color: #7c3aed; }
  .text-blue { color: #2563eb; }
  .text-slate { color: #0f172a; }

  .font-truncate {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .kpi-subtext {
    font-size: 11.5px;
    color: #64748b;
    margin-top: 2px;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* Pestañas del Resumen */
  .resumen-tabs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: #f1f5f9;
    border-bottom: 1px solid #e2e8f0;
    flex-wrap: wrap;
    gap: 8px;
  }

  .tabs-nav-list {
    display: flex;
    align-items: center;
    gap: 6px;
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

  .tab-search-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 8px;
    font-size: 11px;
    opacity: 0.6;
    pointer-events: none;
  }

  .input-search-cliente-resumen {
    padding: 5px 10px 5px 26px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 12px;
    outline: none;
    width: 170px;
    background: #ffffff;
    transition: all 0.2s ease;
  }

  .input-search-cliente-resumen:focus {
    border-color: #3b82f6;
    width: 200px;
  }

  /* ─────────────────────────────────────────────────────────────
     Tabla y Cabeceras Oscuras
  ───────────────────────────────────────────────────────────── */
  .table-wrapper {
    overflow-x: auto;
    width: 100%;
  }

  .clientes-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    text-align: left;
  }

  /* Cabeceras Oscuras IDÉNTICAS */
  .clientes-table thead tr {
    background: #2b3544;
    color: #ffffff;
  }

  .clientes-table th {
    padding: 12px 14px;
    font-size: 12.5px;
    font-weight: 700;
    letter-spacing: 0.2px;
    white-space: nowrap;
  }

  .th-center { text-align: center; }
  .th-right { text-align: right; }
  .th-num { width: 45px; }
  .th-tipo-col { width: 130px; }
  .td-tipo-col { width: 130px; }
  .th-cliente { min-width: 180px; }
  .th-tipo { width: 140px; }
  .th-monto { width: 120px; }
  .th-metodo { width: 120px; }
  .th-hora { width: 90px; }
  .th-acciones { width: 180px; }

  /* Filas de la Tabla */
  .cliente-row {
    border-bottom: 1px solid #f1f5f9;
    transition: background 0.15s ease;
  }

  .cliente-row:hover {
    background: #f8fafc;
  }

  .clientes-table td {
    padding: 11px 14px;
    color: #1e293b;
    font-size: 13px;
    vertical-align: middle;
  }

  .td-center { text-align: center; }
  .td-right { text-align: right; }

  .cliente-cell-content {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .cliente-name {
    font-weight: 700;
    color: #0f172a;
  }

  .cliente-tipo-pill {
    display: inline-block;
    padding: 1px 6px;
    font-size: 10.5px;
    font-weight: 600;
    background: #f1f5f9;
    color: #475569;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    text-transform: uppercase;
  }

  /* Badges de Tipo */
  .badge-tipo {
    display: inline-block;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11.5px;
    font-weight: 700;
  }

  .badge-aporte {
    background: #dcfce7;
    color: #15803d;
    border: 1px solid #bbf7d0;
  }

  .badge-devolucion {
    background: #ede9fe;
    color: #6d28d9;
    border: 1px solid #ddd6fe;
  }

  .badge-pago {
    background: #ede9fe;
    color: #6d28d9;
    border: 1px solid #ddd6fe;
  }

  .badge-compra {
    background: #dcfce7;
    color: #15803d;
    border: 1px solid #bbf7d0;
  }

  .monto-value {
    font-weight: 700;
    color: #0f172a;
    font-variant-numeric: tabular-nums;
  }

  .monto-value.monto-devolucion {
    color: #dc2626;
  }

  /* Badges de Método */
  .badge-metodo {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11.5px;
    font-weight: 700;
    background: #f1f5f9;
    color: #334155;
    border: 1px solid #cbd5e1;
  }

  .badge-metodo.metodo-general {
    background: #f1f5f9;
    color: #475569;
    border-color: #cbd5e1;
  }

  .badge-metodo.metodo-pdv {
    background: #e0f2fe;
    color: #0369a1;
    border-color: #bae6fd;
  }

  /* Badge de Hora */
  .time-badge {
    display: inline-block;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 700;
    background: #f1f5f9;
    color: #334155;
    border: 1px solid #cbd5e1;
  }

  /* Acciones */
  .acciones-btns-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .btn-metodo-hora-accion {
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

  .btn-metodo-hora-accion:hover {
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
    text-align: center;
    padding: 36px 16px;
    color: #94a3b8;
  }

  .empty-text {
    font-size: 13.5px;
    font-style: italic;
    color: #64748b;
  }

  .loading-state-inline {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: #64748b;
    font-size: 13px;
  }

  .spinner-small {
    width: 16px;
    height: 16px;
    border: 2px solid #e2e8f0;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Modal para editar Aporte */
  .modal-backdrop-fixed {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(15, 23, 42, 0.6);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 16px;
    box-sizing: border-box;
  }

  .modal-dialog-box {
    background: #ffffff;
    border-radius: 10px;
    width: 100%;
    max-width: 480px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    animation: modalPopIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes modalPopIn {
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
    background: #1e293b;
    color: #ffffff;
    padding: 14px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-close-modal {
    background: transparent;
    border: none;
    color: #94a3b8;
    font-size: 24px;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
    transition: color 0.15s ease;
  }

  .btn-close-modal:hover {
    color: #ffffff;
  }

  .modal-body-form {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .modal-info-banner {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    font-size: 12.5px;
    flex-wrap: wrap;
  }

  .info-label {
    color: #64748b;
    font-weight: 500;
  }

  .info-val {
    font-weight: 700;
    color: #0f172a;
  }

  .info-sep {
    color: #cbd5e1;
  }

  .info-badge {
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 700;
  }

  .modal-inputs-grid {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .modal-field-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .modal-field-label {
    font-size: 13px;
    font-weight: 700;
    color: #334155;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding-top: 8px;
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
