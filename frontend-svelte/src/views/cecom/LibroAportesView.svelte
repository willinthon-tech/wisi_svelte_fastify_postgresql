<script>
  import { onMount, tick } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { toBackendUrl } from '../../config/api.config.js';
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

  let selectedRangoId = '';
  let monto = '';
  let isSaving = false;

  // Referencias de elementos para navegación por teclado con Tab / Enter
  let empleadoInputEl = null;
  let rangoSelectEl = null;
  let montoInputEl = null;

  // --- DATOS Y REGISTROS ---
  let records = [];
  let isLoadingRecords = false;

  // Servidor rangos fallback
  let serverRangos = [];

  // Pestaña activa en la tarjeta derecha: 'detallado' | 'rangos' | 'empleados'
  let activeTab = 'detallado';
  let busquedaEmpleadoResumen = '';

  // Modal de Edición
  let showModalEditar = false;
  let editingRecord = null;
  let modalEmpleadoId = null;
  let modalRangoId = null;
  let modalMonto = '';
  let isSavingModal = false;

  // Encabezado superior oscuro
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

  function formatDateTime(dt) {
    if (!dt) return '—';
    try {
      const d = new Date(dt);
      if (isNaN(d.getTime())) return dt;
      const day = String(d.getDate()).padStart(2, '0');
      const mon = String(d.getMonth() + 1).padStart(2, '0');
      const yr = d.getFullYear();
      const hr = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return `${day}/${mon}/${yr} ${hr}:${min}`;
    } catch {
      return dt;
    }
  }

  function formatMonto(val) {
    const num = parseFloat(val);
    if (isNaN(num)) return '0.00';
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function getEmployeePhotoUrl(foto, id) {
    if (!foto && id) foto = `/empleados/${id}.jpg`;
    if (!foto) return null;
    if (foto.startsWith('http') || foto.startsWith('data:')) return foto;
    let cleanFoto = String(foto).replace(/^\/+/, '');
    return toBackendUrl(`/${cleanFoto}`, { preview: true });
  }

  // Lista de rangos disponibles
  $: listaRangos = (() => {
    const storeRangos = $masterRangosStore || [];
    const list = storeRangos.length > 0 ? storeRangos : serverRangos;
    return [...list].sort((a, b) => Number(a.id) - Number(b.id));
  })();

  // Selección de rango por defecto si hay rangos y no hay seleccionado
  $: if (listaRangos.length > 0 && !selectedRangoId) {
    selectedRangoId = String(listaRangos[0].id);
  }

  // Lista de empleados activos asociados a la sala del libro
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
        cargo_nombre: (e.cargo_nombre || '').trim() || 'Sin Cargo',
        departamento_nombre: (e.departamento_nombre || '').trim(),
        foto: e.foto || null,
        sala_id: e.sala_id
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  // Coincidencias de búsqueda por NOMBRE o por CARGO (o por Cédula)
  $: empleadosSugerencias = (() => {
    const q = (empleadoSearchQuery || '').trim().toLowerCase();
    if (!q) return listaEmpleados.slice(0, 15);
    return listaEmpleados.filter(emp => {
      const matchNom = emp.nombre.toLowerCase().includes(q);
      const matchCargo = emp.cargo_nombre.toLowerCase().includes(q);
      const matchCedula = String(emp.cedula || '').toLowerCase().includes(q);
      return matchNom || matchCargo || matchCedula;
    }).slice(0, 15);
  })();

  // Registros ordenados estrictamente por ID descendente (la más reciente primero)
  $: sortedRecords = [...records].sort((a, b) => Number(b.id) - Number(a.id));

  // --- CÁLCULOS ESTADÍSTICOS Y TOTALES ---
  $: totalAportesCount = records.length;
  $: totalMonto = records.reduce((acc, r) => acc + (Number(r.monto) || 0), 0);
  $: promedioMonto = totalAportesCount > 0 ? (totalMonto / totalAportesCount) : 0;

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
      entry.total_monto += Number(r.monto) || 0;
    }

    const list = Array.from(map.values()).map(item => ({
      ...item,
      porcentaje: totalMonto > 0 ? ((item.total_monto / totalMonto) * 100) : 0,
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
          empleado_foto: r.empleado_foto || null,
          cargo_nombre: r.cargo_nombre || 'Sin Cargo',
          cantidad: 0,
          total_monto: 0,
          rangos_usados: new Set()
        });
      }
      const entry = map.get(eId);
      entry.cantidad += 1;
      entry.total_monto += Number(r.monto) || 0;
      if (r.rango_nombre) entry.rangos_usados.add(r.rango_nombre);
    }

    const list = Array.from(map.values()).map(item => ({
      ...item,
      rangos_texto: Array.from(item.rangos_usados).join(', '),
      porcentaje: totalMonto > 0 ? ((item.total_monto / totalMonto) * 100) : 0,
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
      const res = await fetch(`/api/master/libros/${lId}/aportes`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success) {
          records = json.data || [];
        }
      }
    } catch (err) {
      console.error('Error al cargar aportes de libro:', err);
    } finally {
      isLoadingRecords = false;
    }
  }

  // --- MANEJO DE SELECCIÓN Y TECLADO (TAB / ENTER) ---
  function onEmpleadoInputFocus() {
    showEmpleadoDropdown = true;
    selectedDropdownIndex = -1;
  }

  function onEmpleadoInputChange() {
    showEmpleadoDropdown = true;
    selectedDropdownIndex = -1;
    // Si borra el texto, resetear empleado seleccionado
    if (!empleadoSearchQuery.trim()) {
      selectedEmpleado = null;
    }
  }

  function onEmpleadoInputBlur() {
    // Timeout para permitir clicks en los elementos de la lista
    setTimeout(() => {
      showEmpleadoDropdown = false;
    }, 250);
  }

  function seleccionarEmpleado(emp) {
    selectedEmpleado = emp;
    empleadoSearchQuery = emp.nombre;
    showEmpleadoDropdown = false;
    selectedDropdownIndex = -1;

    // Saltar automáticamente al siguiente campo (Rango) con Tab flow
    tick().then(() => {
      if (rangoSelectEl) rangoSelectEl.focus();
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
      // Si hay un índice seleccionado o hay al menos 1 sugerencia coincidente, autocompletar
      if (selectedDropdownIndex >= 0 && empleadosSugerencias[selectedDropdownIndex]) {
        e.preventDefault();
        seleccionarEmpleado(empleadosSugerencias[selectedDropdownIndex]);
      } else if (empleadosSugerencias.length > 0) {
        // Seleccionar la primera sugerencia coincidente
        e.preventDefault();
        seleccionarEmpleado(empleadosSugerencias[0]);
      }
    }
  }

  function onRangoKeyDown(e) {
    if (e.key === 'Tab' && !e.shiftKey) {
      // Salto natural a monto
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (montoInputEl) montoInputEl.focus();
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

    // Validaciones
    let empId = selectedEmpleado?.id;
    if (!empId) {
      // Intentar resolver si el usuario escribió exactamente el nombre
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

    const rId = Number(selectedRangoId);
    if (!rId) {
      triggerToast('Debe seleccionar un rango', 'warning');
      if (rangoSelectEl) rangoSelectEl.focus();
      return;
    }

    const numMonto = parseFloat(monto);
    if (isNaN(numMonto) || numMonto <= 0) {
      triggerToast('Debe ingresar un monto válido mayor a 0', 'warning');
      if (montoInputEl) montoInputEl.focus();
      return;
    }

    isSaving = true;
    try {
      const res = await fetch(`/api/master/libros/${lId}/aportes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empleado_id: empId,
          rango_id: rId,
          monto: numMonto
        })
      });

      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Aporte registrado exitosamente', 'success');
        
        // Limpiar formulario
        selectedEmpleado = null;
        empleadoSearchQuery = '';
        monto = '';
        
        // Recargar datos
        await loadRecords();

        // Refocalizar de inmediato en el empleado para continuar cargando rápidamente
        tick().then(() => {
          if (empleadoInputEl) empleadoInputEl.focus();
        });
      } else {
        triggerToast(json?.error || 'Error al registrar aporte', 'error');
      }
    } catch (err) {
      console.error('Error al guardar aporte:', err);
      triggerToast(`Error al guardar aporte: ${err.message}`, 'error');
    } finally {
      isSaving = false;
    }
  }

  // --- ELIMINAR REGISTRO ---
  async function handleEliminar(record) {
    if (!confirm(`¿Está seguro de eliminar el aporte de $${formatMonto(record.monto)} para ${record.empleado_nombre}?`)) {
      return;
    }

    const lId = libroId || libro?.id;
    try {
      const res = await fetch(`/api/master/libros/${lId}/aportes/${record.id}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Aporte eliminado correctamente', 'success');
        await loadRecords();
      } else {
        triggerToast(json?.error || 'Error al eliminar aporte', 'error');
      }
    } catch (err) {
      console.error('Error al eliminar aporte:', err);
      triggerToast(`Error al eliminar: ${err.message}`, 'error');
    }
  }

  // --- MODAL EDITAR ---
  function abrirModalEditar(record) {
    editingRecord = record;
    modalEmpleadoId = record.empleado_id;
    modalRangoId = String(record.rango_id);
    modalMonto = String(record.monto);
    showModalEditar = true;
  }

  function cerrarModalEditar() {
    showModalEditar = false;
    editingRecord = null;
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
      const res = await fetch(`/api/master/libros/${lId}/aportes/${editingRecord.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empleado_id: Number(modalEmpleadoId),
          rango_id: Number(modalRangoId),
          monto: numMonto
        })
      });

      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Aporte actualizado exitosamente', 'success');
        cerrarModalEditar();
        await loadRecords();
      } else {
        triggerToast(json?.error || 'Error al actualizar aporte', 'error');
      }
    } catch (err) {
      console.error('Error al actualizar aporte:', err);
      triggerToast(`Error: ${err.message}`, 'error');
    } finally {
      isSavingModal = false;
    }
  }
</script>

<div class="aportes-layout-grid">
  <!-- Tarjeta Izquierda: Formulario "Aportes de Libro" -->
  <div class="card-form-aporte">
    <div class="card-title-box">
      <div class="title-with-icon">
        <span class="header-icon">💰</span>
        <h3 class="card-title">Aportes Libro</h3>
      </div>
      <div class="title-underline"></div>
    </div>

    <form on:submit|preventDefault={handleGuardar} class="aporte-form" autocomplete="off">
      
      <!-- Campo 1: Empleado con Data-Select / Combobox (por Nombre o por Cargo) -->
      <div class="form-group relative-combobox">
        <label for="input-empleado-search" class="form-label">
          EMPLEADO: <span class="required-star">*</span>
        </label>

        <div class="combobox-container">
          <div class="input-with-avatar">
            {#if selectedEmpleado}
              <div class="selected-avatar-preview">
                {#if getEmployeePhotoUrl(selectedEmpleado.foto, selectedEmpleado.id)}
                  <img 
                    src={getEmployeePhotoUrl(selectedEmpleado.foto, selectedEmpleado.id)} 
                    alt={selectedEmpleado.nombre}
                    class="avatar-img"
                  />
                {:else}
                  <div class="avatar-placeholder">{selectedEmpleado.nombre.charAt(0)}</div>
                {/if}
              </div>
            {:else}
              <span class="search-leading-icon">👤</span>
            {/if}

            <input
              id="input-empleado-search"
              bind:this={empleadoInputEl}
              type="text"
              class="form-input combobox-input {showEmpleadoDropdown && empleadosSugerencias.length > 0 ? 'input-focused' : ''}"
              placeholder="Buscar empleado por nombre o cargo (Tab ⇥)..."
              bind:value={empleadoSearchQuery}
              on:focus={onEmpleadoInputFocus}
              on:input={onEmpleadoInputChange}
              on:keydown={onEmpleadoInputKeyDown}
              on:blur={onEmpleadoInputBlur}
              autocomplete="off"
              required
            />

            {#if selectedEmpleado}
              <button 
                type="button" 
                class="btn-clear-selection" 
                title="Cambiar empleado" 
                on:click={() => { selectedEmpleado = null; empleadoSearchQuery = ''; empleadoInputEl.focus(); }}
              >
                ✕
              </button>
            {/if}
          </div>

          <!-- Dropdown con coincidencias detalladas (Nombre, Cédula y Cargo) -->
          {#if showEmpleadoDropdown && empleadosSugerencias.length > 0}
            <div class="inline-dropdown">
              <div class="inline-dropdown-header">
                <span>Coincidencias ({empleadosSugerencias.length}) — <b>Tab ⇥</b> o <b>Enter</b>:</span>
              </div>
              <ul class="inline-dropdown-list">
                {#each empleadosSugerencias as emp, idx}
                  <!-- svelte-ignore a11y-click-events-have-key-events -->
                  <li
                    class="inline-dropdown-item {idx === selectedDropdownIndex ? 'selected' : ''}"
                    on:mousedown|preventDefault={() => seleccionarEmpleado(emp)}
                  >
                    <div class="emp-item-avatar">
                      {#if getEmployeePhotoUrl(emp.foto, emp.id)}
                        <img 
                          src={getEmployeePhotoUrl(emp.foto, emp.id)} 
                          alt={emp.nombre}
                          class="avatar-thumb"
                        />
                      {:else}
                        <div class="avatar-thumb-placeholder">{emp.nombre.charAt(0)}</div>
                      {/if}
                    </div>

                    <div class="emp-item-details">
                      <div class="emp-row-main">
                        <span class="emp-name">{emp.nombre}</span>
                        {#if emp.cedula}
                          <span class="emp-cedula">V-{emp.cedula}</span>
                        {/if}
                      </div>
                      <div class="emp-row-sub">
                        <span class="badge-cargo">{emp.cargo_nombre}</span>
                        {#if emp.departamento_nombre}
                          <span class="emp-depto">{emp.departamento_nombre}</span>
                        {/if}
                      </div>
                    </div>

                    <span class="tab-badge">Tab ⇥</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>

        {#if selectedEmpleado}
          <div class="selected-emp-badge">
            <span class="badge-label">Seleccionado:</span>
            <span class="badge-emp-name">{selectedEmpleado.nombre}</span>
            <span class="badge-emp-cargo">• {selectedEmpleado.cargo_nombre}</span>
          </div>
        {:else}
          <span class="field-hint">
            Escriba nombre o cargo del empleado. Use <b>Tab ⇥</b> para seleccionar y avanzar a Rango.
          </span>
        {/if}
      </div>

      <!-- Campo 2: Rango (de la tabla rangos) -->
      <div class="form-group">
        <label for="select-rango" class="form-label">
          RANGO: <span class="required-star">*</span>
        </label>
        <div class="select-wrapper">
          <span class="select-leading-icon">🏅</span>
          <select 
            id="select-rango" 
            bind:this={rangoSelectEl}
            class="form-select" 
            bind:value={selectedRangoId}
            on:keydown={onRangoKeyDown}
            required
          >
            {#if listaRangos.length === 0}
              <option value="">Cargando rangos...</option>
            {:else}
              {#each listaRangos as rg}
                <option value={String(rg.id)}>{rg.nombre}</option>
              {/each}
            {/if}
          </select>
        </div>
        <span class="field-hint">Seleccione el rango asignado. Pulsa <b>Tab ⇥</b> o <b>Enter</b> para avanzar a Monto.</span>
      </div>

      <!-- Campo 3: Monto -->
      <div class="form-group">
        <label for="input-monto" class="form-label">
          MONTO ($): <span class="required-star">*</span>
        </label>
        <div class="input-currency-wrapper">
          <span class="currency-symbol">$</span>
          <input
            id="input-monto"
            bind:this={montoInputEl}
            type="number"
            step="0.01"
            min="0.01"
            class="form-input input-monto"
            placeholder="0.00"
            bind:value={monto}
            on:keydown={onMontoKeyDown}
            required
          />
        </div>
        <span class="field-hint">Ingrese el monto del aporte en divisas. Pulsa <b>Enter ↵</b> para guardar al instante.</span>
      </div>

      <!-- Botón Registrar Aporte -->
      <div class="form-actions">
        <button 
          type="submit" 
          class="btn-submit-aporte" 
          disabled={isSaving || !selectedEmpleado || !monto}
        >
          {#if isSaving}
            <span class="spinner-small"></span>
            <span>Guardando...</span>
          {:else}
            <span>💾 Registrar Aporte (Enter ↵)</span>
          {/if}
        </button>
      </div>

    </form>
  </div>

  <!-- Tarjeta Derecha: Lista Detallada + Pestañas de Resumen -->
  <div class="card-list-aporte">
    <!-- Header Oscuro con Nombre de Sala y Fecha -->
    <div class="list-dark-header">
      <div class="header-info">
        <h2 class="header-title">{tableHeaderTitle}</h2>
        <span class="header-subtitle">Libro de Trabajo • Control y Auditoría de Aportes</span>
      </div>
      <div class="header-actions">
        <button 
          type="button" 
          class="btn-refresh" 
          on:click={loadRecords}
          title="Recargar registros"
        >
          🔄 Actualizar
        </button>
      </div>
    </div>

    <!-- Barra de KPIs Resumen -->
    <div class="kpi-banner-grid">
      <div class="kpi-card kpi-total">
        <div class="kpi-header">
          <span class="kpi-icon">📊</span>
          <span class="kpi-title">TOTAL APORTES</span>
        </div>
        <div class="kpi-value">{totalAportesCount}</div>
        <div class="kpi-subtext">registros en jornada</div>
      </div>

      <div class="kpi-card kpi-monto">
        <div class="kpi-header">
          <span class="kpi-icon">💵</span>
          <span class="kpi-title">TOTAL ENTREGADO</span>
        </div>
        <div class="kpi-value text-emerald">${formatMonto(totalMonto)}</div>
        <div class="kpi-subtext">monto acumulado</div>
      </div>

      <div class="kpi-card kpi-promedio">
        <div class="kpi-header">
          <span class="kpi-icon">📈</span>
          <span class="kpi-title">PROMEDIO / APORTE</span>
        </div>
        <div class="kpi-value text-blue">${formatMonto(promedioMonto)}</div>
        <div class="kpi-subtext">media por entrega</div>
      </div>

      <div class="kpi-card kpi-top">
        <div class="kpi-header">
          <span class="kpi-icon">🏅</span>
          <span class="kpi-title">RANGO CON MÁS APORTES</span>
        </div>
        <div class="kpi-value text-purple font-truncate">
          {resumenRangos.length > 0 ? resumenRangos[0].rango_nombre : '—'}
        </div>
        <div class="kpi-subtext">
          {resumenRangos.length > 0 ? `$${formatMonto(resumenRangos[0].total_monto)} (${resumenRangos[0].cantidad} reg)` : 'Sin datos'}
        </div>
      </div>
    </div>

    <!-- Pestañas de Navegación: 1. Detallado, 2. Resumen Rangos, 3. Resumen Empleados -->
    <div class="tabs-header-wrapper">
      <div class="subtabs-nav">
        <button
          type="button"
          class="subtab-btn {activeTab === 'detallado' ? 'active' : ''}"
          on:click={() => activeTab = 'detallado'}
        >
          <span>📋 Detallado de Aportes ({records.length})</span>
        </button>

        <button
          type="button"
          class="subtab-btn {activeTab === 'rangos' ? 'active' : ''}"
          on:click={() => activeTab = 'rangos'}
        >
          <span>🏅 Resumen por Rango ({resumenRangos.length})</span>
        </button>

        <button
          type="button"
          class="subtab-btn {activeTab === 'empleados' ? 'active' : ''}"
          on:click={() => activeTab = 'empleados'}
        >
          <span>👥 Resumen por Empleado ({resumenEmpleados.length})</span>
        </button>
      </div>

      {#if activeTab === 'empleados'}
        <div class="tab-search-box">
          <span class="search-ico">🔍</span>
          <input 
            type="text" 
            class="input-search-tab" 
            placeholder="Buscar en resumen..." 
            bind:value={busquedaEmpleadoResumen}
          />
        </div>
      {/if}
    </div>

    <!-- Contenido de las Pestañas -->
    <div class="tab-body-wrapper">
      
      <!-- PESTAÑA 1: DETALLADO DE APORTES (Ordenado por el más reciente primero: ID DESC) -->
      {#if activeTab === 'detallado'}
        {#if isLoadingRecords}
          <div class="state-container">
            <div class="spinner-mid"></div>
            <p>Cargando registros de aportes...</p>
          </div>
        {:else if sortedRecords.length === 0}
          <div class="state-container empty-state">
            <span class="empty-icon">💸</span>
            <h4>No hay aportes registrados</h4>
            <p>Utilice el formulario de la izquierda para registrar el primer aporte por empleado y rango.</p>
          </div>
        {:else}
          <div class="table-responsive">
            <table class="aportes-table">
              <thead>
                <tr>
                  <th class="th-center th-id">ID</th>
                  <th class="th-empleado">Empleado</th>
                  <th class="th-cargo">Cargo</th>
                  <th class="th-center th-rango">Rango</th>
                  <th class="th-right th-monto">Monto</th>
                  <th class="th-center th-fecha">Fecha / Hora</th>
                  <th class="th-center th-acciones">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {#each sortedRecords as rec, idx (rec.id)}
                  <tr class="table-row">
                    <td class="td-center td-id-cell">
                      <span class="badge-id">#{rec.id}</span>
                    </td>
                    <td class="td-empleado-cell">
                      <div class="emp-card-cell">
                        <div class="emp-photo-box">
                          {#if getEmployeePhotoUrl(rec.empleado_foto, rec.empleado_id)}
                            <img 
                              src={getEmployeePhotoUrl(rec.empleado_foto, rec.empleado_id)} 
                              alt={rec.empleado_nombre} 
                              class="cell-avatar-img"
                            />
                          {:else}
                            <div class="cell-avatar-placeholder">
                              {(rec.empleado_nombre || 'E').charAt(0)}
                            </div>
                          {/if}
                        </div>
                        <div class="emp-info-box">
                          <span class="emp-full-name">{rec.empleado_nombre}</span>
                          {#if rec.empleado_cedula}
                            <span class="emp-doc-sub">C.I: V-{rec.empleado_cedula}</span>
                          {/if}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class="badge-cargo-cell">{rec.cargo_nombre || 'Sin Cargo'}</span>
                    </td>
                    <td class="td-center">
                      <span class="badge-rango-cell">{rec.rango_nombre || `Rango #${rec.rango_id}`}</span>
                    </td>
                    <td class="td-right">
                      <span class="cell-monto-highlight">${formatMonto(rec.monto)}</span>
                    </td>
                    <td class="td-center td-date-cell">
                      <span>{formatDateTime(rec.created_at)}</span>
                    </td>
                    <td class="td-center td-actions-cell">
                      <button 
                        type="button" 
                        class="btn-action btn-edit" 
                        title="Editar aporte"
                        on:click={() => abrirModalEditar(rec)}
                      >
                        ✏️
                      </button>
                      <button 
                        type="button" 
                        class="btn-action btn-delete" 
                        title="Eliminar aporte"
                        on:click={() => handleEliminar(rec)}
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

      <!-- PESTAÑA 2: RESUMEN POR RANGO (Ver qué rango se le ha dado más aporte) -->
      {:else if activeTab === 'rangos'}
        {#if resumenRangos.length === 0}
          <div class="state-container empty-state">
            <span class="empty-icon">🏅</span>
            <h4>Sin datos de rangos</h4>
            <p>Registre aportes para visualizar las estadísticas consolidadas por rango.</p>
          </div>
        {:else}
          <div class="table-responsive">
            <table class="aportes-table">
              <thead>
                <tr>
                  <th class="th-center th-rank">#</th>
                  <th class="th-rango-nombre">Rango</th>
                  <th class="th-center th-cant">Cant. Aportes</th>
                  <th class="th-right th-total">Monto Total ($)</th>
                  <th class="th-center th-share">% del Total</th>
                  <th class="th-right th-prom">Promedio ($)</th>
                </tr>
              </thead>
              <tbody>
                {#each resumenRangos as rg, idx}
                  <tr class="table-row">
                    <td class="td-center">
                      <span class="badge-rank {idx === 0 ? 'rank-gold' : idx === 1 ? 'rank-silver' : idx === 2 ? 'rank-bronze' : ''}">
                        {idx + 1}
                      </span>
                    </td>
                    <td>
                      <div class="rango-name-box">
                        <span class="rango-icon">🏅</span>
                        <span class="rango-label-title">{rg.rango_nombre}</span>
                      </div>
                    </td>
                    <td class="td-center font-bold">{rg.cantidad}</td>
                    <td class="td-right">
                      <span class="cell-monto-highlight">${formatMonto(rg.total_monto)}</span>
                    </td>
                    <td class="td-center">
                      <div class="progress-bar-container">
                        <div class="progress-bar-fill" style="width: {rg.porcentaje}%"></div>
                        <span class="progress-text">{rg.porcentaje.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td class="td-right text-slate font-medium">
                      ${formatMonto(rg.promedio)}
                    </td>
                  </tr>
                {/each}
              </tbody>
              <tfoot>
                <tr class="tfoot-total-row">
                  <td colspan="2" class="font-bold">TOTAL CONSOLIDADO:</td>
                  <td class="td-center font-bold">{totalAportesCount}</td>
                  <td class="td-right font-bold text-emerald">${formatMonto(totalMonto)}</td>
                  <td class="td-center font-bold">100%</td>
                  <td class="td-right font-bold">${formatMonto(promedioMonto)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        {/if}

      <!-- PESTAÑA 3: RESUMEN POR EMPLEADO (Ver a qué empleado se le ha dado más aporte) -->
      {:else if activeTab === 'empleados'}
        {#if resumenEmpleados.length === 0}
          <div class="state-container empty-state">
            <span class="empty-icon">👥</span>
            <h4>No hay empleados con aportes</h4>
            <p>Registre aportes para ver la distribución individual por colaborador.</p>
          </div>
        {:else}
          <div class="table-responsive">
            <table class="aportes-table">
              <thead>
                <tr>
                  <th class="th-center th-rank">#</th>
                  <th class="th-empleado">Empleado</th>
                  <th class="th-cargo">Cargo</th>
                  <th class="th-center th-cant">Aportes</th>
                  <th class="th-center th-rangos-usados">Rangos Asignados</th>
                  <th class="th-right th-total">Monto Total ($)</th>
                  <th class="th-center th-share">% del Total</th>
                  <th class="th-right th-prom">Promedio ($)</th>
                </tr>
              </thead>
              <tbody>
                {#each resumenEmpleados as emp, idx}
                  <tr class="table-row">
                    <td class="td-center">
                      <span class="badge-rank {idx === 0 ? 'rank-gold' : idx === 1 ? 'rank-silver' : idx === 2 ? 'rank-bronze' : ''}">
                        {idx + 1}
                      </span>
                    </td>
                    <td class="td-empleado-cell">
                      <div class="emp-card-cell">
                        <div class="emp-photo-box">
                          {#if getEmployeePhotoUrl(emp.empleado_foto, emp.empleado_id)}
                            <img 
                              src={getEmployeePhotoUrl(emp.empleado_foto, emp.empleado_id)} 
                              alt={emp.empleado_nombre} 
                              class="cell-avatar-img"
                            />
                          {:else}
                            <div class="cell-avatar-placeholder">
                              {(emp.empleado_nombre || 'E').charAt(0)}
                            </div>
                          {/if}
                        </div>
                        <div class="emp-info-box">
                          <span class="emp-full-name">{emp.empleado_nombre}</span>
                          {#if emp.empleado_cedula}
                            <span class="emp-doc-sub">C.I: V-{emp.empleado_cedula}</span>
                          {/if}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class="badge-cargo-cell">{emp.cargo_nombre}</span>
                    </td>
                    <td class="td-center font-bold">{emp.cantidad}</td>
                    <td class="td-center">
                      <span class="badge-rangos-tags">{emp.rangos_texto || '—'}</span>
                    </td>
                    <td class="td-right">
                      <span class="cell-monto-highlight text-emerald">${formatMonto(emp.total_monto)}</span>
                    </td>
                    <td class="td-center">
                      <div class="progress-bar-container">
                        <div class="progress-bar-fill fill-blue" style="width: {emp.porcentaje}%"></div>
                        <span class="progress-text">{emp.porcentaje.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td class="td-right text-slate font-medium">
                      ${formatMonto(emp.promedio)}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

      {/if}
    </div>
  </div>
</div>

<!-- MODAL DE EDICIÓN DE APORTE -->
{#if showModalEditar}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="modal-backdrop" on:click|self={cerrarModalEditar}>
    <div class="modal-card">
      <div class="modal-header">
        <h4 class="modal-title">✏️ Editar Aporte #{editingRecord?.id}</h4>
        <button type="button" class="modal-close-btn" on:click={cerrarModalEditar}>✕</button>
      </div>

      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">EMPLEADO:</label>
          <select class="form-select" bind:value={modalEmpleadoId}>
            {#each listaEmpleados as e}
              <option value={e.id}>{e.nombre} ({e.cargo_nombre})</option>
            {/each}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">RANGO:</label>
          <select class="form-select" bind:value={modalRangoId}>
            {#each listaRangos as r}
              <option value={String(r.id)}>{r.nombre}</option>
            {/each}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">MONTO ($):</label>
          <div class="input-currency-wrapper">
            <span class="currency-symbol">$</span>
            <input 
              type="number" 
              step="0.01" 
              min="0.01" 
              class="form-input input-monto" 
              bind:value={modalMonto} 
            />
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn-cancel" on:click={cerrarModalEditar}>Cancelar</button>
        <button 
          type="button" 
          class="btn-save-modal" 
          disabled={isSavingModal} 
          on:click={handleGuardarEdicion}
        >
          {isSavingModal ? 'Guardando...' : 'Guardar Cambios'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .aportes-layout-grid {
    display: grid;
    grid-template-columns: 360px 1fr;
    gap: 20px;
    width: 100%;
    align-items: start;
    box-sizing: border-box;
  }

  @media (max-width: 1080px) {
    .aportes-layout-grid {
      grid-template-columns: 1fr;
    }
  }

  /* --- TARJETA FORMULARIO IZQUIERDA --- */
  .card-form-aporte {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .card-title-box {
    border-bottom: 2px solid #f1f5f9;
    padding-bottom: 12px;
  }

  .title-with-icon {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .header-icon {
    font-size: 22px;
  }

  .card-title {
    margin: 0;
    font-size: 18px;
    font-weight: 800;
    color: #1e293b;
    letter-spacing: -0.3px;
  }

  .aporte-form {
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
    font-size: 12px;
    font-weight: 800;
    color: #334155;
    letter-spacing: 0.3px;
    text-transform: uppercase;
  }

  .required-star {
    color: #ef4444;
  }

  .field-hint {
    font-size: 11px;
    color: #64748b;
    line-height: 1.35;
  }

  .form-input, .form-select {
    width: 100%;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    font-size: 14px;
    background: #f8fafc;
    color: #0f172a;
    box-sizing: border-box;
    transition: all 0.15s ease;
  }

  .form-input:focus, .form-select:focus {
    outline: none;
    border-color: #3b82f6;
    background: #ffffff;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  /* Combobox con búsqueda de empleado */
  .combobox-container {
    position: relative;
    width: 100%;
  }

  .input-with-avatar {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-leading-icon {
    position: absolute;
    left: 12px;
    font-size: 16px;
    pointer-events: none;
  }

  .selected-avatar-preview {
    position: absolute;
    left: 8px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #e2e8f0;
  }

  .avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar-placeholder {
    font-size: 13px;
    font-weight: 800;
    color: #475569;
  }

  .combobox-input {
    padding-left: 42px;
    padding-right: 32px;
  }

  .btn-clear-selection {
    position: absolute;
    right: 8px;
    background: none;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    font-size: 14px;
    padding: 4px;
    border-radius: 4px;
  }

  .btn-clear-selection:hover {
    color: #ef4444;
    background: #fee2e2;
  }

  .inline-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 4px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.12);
    z-index: 100;
    max-height: 280px;
    overflow-y: auto;
  }

  .inline-dropdown-header {
    padding: 8px 12px;
    background: #f1f5f9;
    font-size: 11px;
    color: #475569;
    border-bottom: 1px solid #e2e8f0;
  }

  .inline-dropdown-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .inline-dropdown-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    cursor: pointer;
    border-bottom: 1px solid #f8fafc;
    transition: background 0.1s ease;
  }

  .inline-dropdown-item:hover, .inline-dropdown-item.selected {
    background: #eff6ff;
  }

  .emp-item-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    overflow: hidden;
    background: #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .avatar-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar-thumb-placeholder {
    font-size: 14px;
    font-weight: 800;
    color: #475569;
  }

  .emp-item-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .emp-row-main {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .emp-name {
    font-size: 13px;
    font-weight: 700;
    color: #0f172a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .emp-cedula {
    font-size: 11px;
    color: #64748b;
    font-family: monospace;
  }

  .emp-row-sub {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .badge-cargo {
    font-size: 10px;
    font-weight: 700;
    background: #e0e7ff;
    color: #3730a3;
    padding: 1px 6px;
    border-radius: 4px;
  }

  .emp-depto {
    font-size: 10px;
    color: #64748b;
  }

  .tab-badge {
    font-size: 10px;
    font-weight: 700;
    color: #3b82f6;
    background: #dbeafe;
    padding: 2px 6px;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .selected-emp-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    padding: 6px 10px;
    border-radius: 6px;
    font-size: 11px;
  }

  .badge-label {
    font-weight: 800;
    color: #1d4ed8;
  }

  .badge-emp-name {
    font-weight: 700;
    color: #1e293b;
  }

  .badge-emp-cargo {
    color: #64748b;
  }

  .select-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .select-leading-icon {
    position: absolute;
    left: 12px;
    font-size: 16px;
    pointer-events: none;
  }

  .select-wrapper .form-select {
    padding-left: 40px;
  }

  .input-currency-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .currency-symbol {
    position: absolute;
    left: 14px;
    font-size: 18px;
    font-weight: 800;
    color: #059669;
    pointer-events: none;
  }

  .input-monto {
    padding-left: 36px;
    font-size: 18px;
    font-weight: 800;
    color: #059669;
  }

  .form-actions {
    margin-top: 8px;
  }

  .btn-submit-aporte {
    width: 100%;
    padding: 12px 16px;
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    color: #ffffff;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 800;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    box-shadow: 0 4px 10px rgba(16, 185, 129, 0.25);
    transition: all 0.15s ease;
  }

  .btn-submit-aporte:hover:not(:disabled) {
    background: linear-gradient(135deg, #059669 0%, #047857 100%);
    box-shadow: 0 6px 14px rgba(16, 185, 129, 0.35);
    transform: translateY(-1px);
  }

  .btn-submit-aporte:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }

  /* --- TARJETA LISTA DERECHA --- */
  .card-list-aporte {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .list-dark-header {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    padding: 16px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }

  .header-title {
    margin: 0;
    color: #ffffff;
    font-size: 18px;
    font-weight: 800;
    letter-spacing: -0.3px;
  }

  .header-subtitle {
    font-size: 12px;
    color: #94a3b8;
  }

  .btn-refresh {
    background: rgba(255, 255, 255, 0.1);
    color: #f8fafc;
    border: 1px solid rgba(255, 255, 255, 0.2);
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-refresh:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  /* KPI Banner */
  .kpi-banner-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 14px;
    padding: 16px 20px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }

  @media (max-width: 860px) {
    .kpi-banner-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .kpi-card {
    background: #ffffff;
    padding: 12px 14px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
  }

  .kpi-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .kpi-icon {
    font-size: 14px;
  }

  .kpi-title {
    font-size: 11px;
    font-weight: 800;
    color: #64748b;
    letter-spacing: 0.3px;
  }

  .kpi-value {
    font-size: 20px;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.2;
  }

  .kpi-subtext {
    font-size: 11px;
    color: #94a3b8;
    margin-top: 2px;
  }

  .text-emerald { color: #059669; }
  .text-blue { color: #2563eb; }
  .text-purple { color: #7c3aed; }
  .text-slate { color: #475569; }
  .font-truncate {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Pestañas */
  .tabs-header-wrapper {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    background: #ffffff;
    border-bottom: 1px solid #e2e8f0;
    flex-wrap: wrap;
    gap: 10px;
  }

  .subtabs-nav {
    display: flex;
    gap: 8px;
  }

  .subtab-btn {
    padding: 12px 16px;
    background: none;
    border: none;
    border-bottom: 3px solid transparent;
    font-size: 13px;
    font-weight: 700;
    color: #64748b;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .subtab-btn:hover {
    color: #0f172a;
  }

  .subtab-btn.active {
    color: #2563eb;
    border-bottom-color: #2563eb;
    background: #eff6ff;
  }

  .tab-search-box {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 4px 10px;
  }

  .input-search-tab {
    border: none;
    background: none;
    font-size: 12px;
    color: #0f172a;
    outline: none;
    width: 140px;
  }

  /* Contenido Tablas */
  .tab-body-wrapper {
    padding: 16px 20px;
  }

  .table-responsive {
    overflow-x: auto;
    width: 100%;
  }

  .aportes-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    color: #1e293b;
  }

  .aportes-table th {
    background: #f8fafc;
    color: #475569;
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 10px 12px;
    border-bottom: 2px solid #e2e8f0;
  }

  .aportes-table td {
    padding: 10px 12px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: middle;
  }

  .table-row:hover {
    background: #f8fafc;
  }

  .th-center, .td-center { text-align: center; }
  .th-right, .td-right { text-align: right; }

  .badge-id {
    font-family: monospace;
    font-size: 11px;
    font-weight: 800;
    color: #64748b;
    background: #f1f5f9;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .emp-card-cell {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .emp-photo-box {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    overflow: hidden;
    background: #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .cell-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .cell-avatar-placeholder {
    font-size: 14px;
    font-weight: 800;
    color: #475569;
  }

  .emp-info-box {
    display: flex;
    flex-direction: column;
  }

  .emp-full-name {
    font-weight: 700;
    color: #0f172a;
  }

  .emp-doc-sub {
    font-size: 11px;
    color: #64748b;
    font-family: monospace;
  }

  .badge-cargo-cell {
    background: #f1f5f9;
    color: #334155;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    display: inline-block;
  }

  .badge-rango-cell {
    background: #e0e7ff;
    color: #3730a3;
    padding: 3px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 800;
    border: 1px solid #c7d2fe;
    display: inline-block;
  }

  .cell-monto-highlight {
    font-size: 15px;
    font-weight: 800;
    color: #059669;
  }

  .td-actions-cell {
    white-space: nowrap;
  }

  .btn-action {
    background: none;
    border: 1px solid #e2e8f0;
    padding: 5px 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    margin: 0 2px;
    transition: all 0.15s ease;
  }

  .btn-action:hover {
    transform: translateY(-1px);
  }

  .btn-edit:hover {
    background: #eff6ff;
    border-color: #bfdbfe;
  }

  .btn-delete:hover {
    background: #fee2e2;
    border-color: #fecaca;
  }

  /* Badges de Ranking */
  .badge-rank {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    font-size: 11px;
    font-weight: 800;
    background: #f1f5f9;
    color: #64748b;
  }

  .rank-gold {
    background: #fef08a;
    color: #854d0e;
    border: 1px solid #facc15;
  }

  .rank-silver {
    background: #e2e8f0;
    color: #334155;
    border: 1px solid #cbd5e1;
  }

  .rank-bronze {
    background: #fed7aa;
    color: #9a3412;
    border: 1px solid #fdba74;
  }

  .rango-name-box {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .rango-label-title {
    font-weight: 800;
    color: #1e293b;
    font-size: 13px;
  }

  .progress-bar-container {
    width: 110px;
    height: 18px;
    background: #f1f5f9;
    border-radius: 9px;
    overflow: hidden;
    position: relative;
    display: inline-block;
    vertical-align: middle;
  }

  .progress-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #10b981 0%, #059669 100%);
    border-radius: 9px;
    transition: width 0.3s ease;
  }

  .progress-bar-fill.fill-blue {
    background: linear-gradient(90deg, #3b82f6 0%, #2563eb 100%);
  }

  .progress-text {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 800;
    color: #0f172a;
  }

  .badge-rangos-tags {
    font-size: 11px;
    color: #475569;
    background: #f8fafc;
    padding: 2px 8px;
    border-radius: 6px;
    border: 1px solid #e2e8f0;
  }

  .tfoot-total-row td {
    background: #f8fafc;
    border-top: 2px solid #cbd5e1;
    font-size: 13px;
  }

  /* Estados vacíos y spinners */
  .state-container {
    padding: 40px 20px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: #64748b;
  }

  .empty-icon {
    font-size: 36px;
    margin-bottom: 4px;
  }

  .state-container h4 {
    margin: 0;
    font-size: 16px;
    font-weight: 800;
    color: #334155;
  }

  .spinner-small {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  .spinner-mid {
    width: 28px;
    height: 28px;
    border: 3px solid #e2e8f0;
    border-top-color: #2563eb;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Modal */
  .modal-backdrop {
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
    padding: 20px;
  }

  .modal-card {
    background: #ffffff;
    border-radius: 12px;
    width: 100%;
    max-width: 440px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    background: #0f172a;
    color: #ffffff;
  }

  .modal-title {
    margin: 0;
    font-size: 16px;
    font-weight: 800;
  }

  .modal-close-btn {
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 16px;
    cursor: pointer;
  }

  .modal-close-btn:hover {
    color: #ffffff;
  }

  .modal-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 14px 20px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
  }

  .btn-cancel {
    padding: 8px 14px;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    color: #475569;
    border-radius: 6px;
    font-weight: 700;
    cursor: pointer;
  }

  .btn-save-modal {
    padding: 8px 16px;
    background: #2563eb;
    border: none;
    color: #ffffff;
    border-radius: 6px;
    font-weight: 700;
    cursor: pointer;
  }

  .btn-save-modal:hover:not(:disabled) {
    background: #1d4ed8;
  }
</style>
