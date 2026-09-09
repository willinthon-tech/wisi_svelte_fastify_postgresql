<script>
  import { onMount } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { masterSalasStore, masterLibrosStore, masterMetodosPagoStore, loadMasterStoresFromBackend } from '../../controllers/master.store.js';

  export let libro = null;
  export let libroId = null;

  $: targetSalaId = Number(libro?.sala_id || ($masterLibrosStore || []).find(l => Number(l.id) === Number(libroId))?.sala_id);

  // Estado del formulario
  let cliente = '';
  let tipo = 'Compra'; // 'Compra' o 'Pago'
  let monto = '';
  let isSaving = false;

  // Sugerencias interactivas de clientes
  let sugerenciasRemotas = [];
  let showSugerencias = false;
  let selectedSugerenciaIndex = -1;

  // Lista de registros de operaciones de clientes
  let records = [];
  let isLoadingRecords = false;

  // Drop de mesas para el consolidado global
  let dropRecords = [];
  let isLoadingDrop = false;

  // Pestaña activa: 'detallado', 'metodos' o 'clientes'
  let activeResumenTab = 'detallado';
  let busquedaClienteResumen = '';

  // Estado para el cliente seleccionado
  let selectedClienteId = null;
  let selectedTipoClienteNombre = '';

  // Extraer clientes únicos para sugerencias locales
  $: clientesLocales = [...new Set(records.map(r => r.cliente).filter(Boolean))];

  // Lista unificada y enriquecida de clientes para sugerencias
  $: allClientesList = (() => {
    const map = new Map();
    // 1. Sugerencias remotas de la tabla clientes (vinculadas a la sala)
    for (const item of sugerenciasRemotas) {
      if (!item) continue;
      const nombre = typeof item === 'object' ? item.nombre : String(item);
      if (!nombre) continue;
      const key = `${item.id || nombre.toLowerCase().trim()}`;
      if (!map.has(key)) {
        map.set(key, {
          id: typeof item === 'object' ? item.id : null,
          nombre: nombre,
          tipo_cliente_nombre: typeof item === 'object' ? (item.tipo_cliente_nombre || 'General') : 'General'
        });
      }
    }

    // 2. Clientes locales de registros previos
    for (const r of records) {
      if (!r || !r.cliente) continue;
      const key = `${r.cliente_id || r.cliente.toLowerCase().trim()}`;
      if (!map.has(key)) {
        map.set(key, {
          id: r.cliente_id || null,
          nombre: r.cliente,
          tipo_cliente_nombre: r.tipo_cliente_nombre || 'General'
        });
      }
    }

    return Array.from(map.values());
  })();

  // Sugerencias combinadas estructuradas filtradas por nombre o por tipo de cliente
  $: sugerenciasFiltradas = (() => {
    const q = (cliente || '').trim().toLowerCase();
    if (!q) return allClientesList.slice(0, 10);

    return allClientesList
      .filter(item => 
        item.nombre.toLowerCase().includes(q) || 
        (item.tipo_cliente_nombre && item.tipo_cliente_nombre.toLowerCase().includes(q))
      )
      .slice(0, 10);
  })();

  // Ordenadas de más reciente a más antigua por hora
  $: sortedRecords = [...records].sort((a, b) => {
    const hA = a.hora || '';
    const hB = b.hora || '';
    if (hA !== hB) return hB.localeCompare(hA);
    return Number(b.id) - Number(a.id);
  });

  // Modal para editar Método y Hora
  let showModalEditar = false;
  let editingRecord = null;
  let modalMetodoPagoId = 1;
  let modalMetodo = 'General';
  let modalHora = '';
  let isSavingModal = false;

  const DEFAULT_METODOS = [
    { id: 1, nombre: 'General' },
    { id: 2, nombre: 'PDV' },
    { id: 3, nombre: 'Cash' },
    { id: 4, nombre: 'USDT' }
  ];

  $: metodosDisponibles = ($masterMetodosPagoStore && $masterMetodosPagoStore.length > 0)
    ? $masterMetodosPagoStore
    : DEFAULT_METODOS;

  // Encabezado oscuro de la tabla con nombre de sala (no comercial) y fecha
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

  function formatMonto(val) {
    const num = parseFloat(val);
    if (isNaN(num)) return '0.00';
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function getCurrentTimeString() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  // ==========================================
  // CÁLCULOS REACTIVOS PARA EL RESUMEN
  // ==========================================
  // 1. Drop de mesas total
  $: totalDrop = dropRecords.reduce((acc, r) => acc + (Number(r.total) || 0), 0);

  // 2. Compras globales
  $: totalCompras = records
    .filter(r => (r.tipo || '').toLowerCase() === 'compra')
    .reduce((acc, r) => acc + (Number(r.monto) || 0), 0);

  $: countCompras = records
    .filter(r => (r.tipo || '').toLowerCase() === 'compra').length;

  // 3. Pagos globales
  $: totalPagos = records
    .filter(r => (r.tipo || '').toLowerCase() === 'pago')
    .reduce((acc, r) => acc + (Number(r.monto) || 0), 0);

  $: countPagos = records
    .filter(r => (r.tipo || '').toLowerCase() === 'pago').length;

  // 4. Balance neto de clientes (Compras - Pagos)
  $: balanceNeto = totalCompras - totalPagos;

  // 5. Resultado consolidado con Drop de Mesas (Drop + Balance Clientes)
  $: resultadoConDrop = totalDrop + balanceNeto;

  // 6. Resumen por Métodos de Pago
  $: resumenMetodos = metodosDisponibles.map(met => {
    const metId = Number(met.id);
    const metNom = (met.nombre || '').toLowerCase().trim();
    const ops = records.filter(r => {
      if (r.metodo_pago_id && Number(r.metodo_pago_id) === metId) return true;
      return (r.metodo || 'General').toLowerCase().trim() === metNom;
    });
    const compras = ops
      .filter(r => (r.tipo || '').toLowerCase() === 'compra')
      .reduce((acc, r) => acc + (Number(r.monto) || 0), 0);
    const pagos = ops
      .filter(r => (r.tipo || '').toLowerCase() === 'pago')
      .reduce((acc, r) => acc + (Number(r.monto) || 0), 0);
    const neto = compras - pagos;
    return {
      id: met.id,
      metodo: met.nombre,
      compras,
      pagos,
      neto,
      count: ops.length,
      countCompras: ops.filter(r => (r.tipo || '').toLowerCase() === 'compra').length,
      countPagos: ops.filter(r => (r.tipo || '').toLowerCase() === 'pago').length
    };
  });

  // 7. Resumen detallado por Cliente
  $: resumenClientes = (() => {
    const map = {};
    for (const r of records) {
      const cli = (r.cliente || '').trim();
      if (!cli) continue;
      if (!map[cli]) {
        map[cli] = { cliente: cli, compras: 0, pagos: 0, count: 0, countCompras: 0, countPagos: 0 };
      }
      const montoNum = Number(r.monto) || 0;
      map[cli].count += 1;
      if ((r.tipo || '').toLowerCase() === 'compra') {
        map[cli].compras += montoNum;
        map[cli].countCompras += 1;
      } else if ((r.tipo || '').toLowerCase() === 'pago') {
        map[cli].pagos += montoNum;
        map[cli].countPagos += 1;
      }
    }
    return Object.values(map).map(c => {
      const balance = c.compras - c.pagos;
      // balance > 0: El cliente compró más de lo que cobró (Casa a favor)
      // balance < 0: El cliente cobró más premios de lo que compró (Jugador ganando)
      return {
        ...c,
        balance
      };
    }).sort((a, b) => (b.compras + b.pagos) - (a.compras + a.pagos));
  })();

  $: resumenClientesFiltrados = (() => {
    const q = (busquedaClienteResumen || '').trim().toLowerCase();
    if (!q) return resumenClientes;
    return resumenClientes.filter(c => c.cliente.toLowerCase().includes(q));
  })();

  onMount(async () => {
    await Promise.all([
      loadMasterStoresFromBackend(),
      loadRecords(),
      loadDropRecords(),
      loadSugerenciasRemotas()
    ]);
  });

  $: if (libroId || targetSalaId) {
    loadRecords();
    loadDropRecords();
    loadSugerenciasRemotas('');
  }

  async function loadRecords() {
    const lId = libroId || libro?.id;
    if (!lId) return;
    isLoadingRecords = true;
    try {
      const res = await fetch(`/api/master/libros/${lId}/control-clientes`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success) {
          records = json.data || [];
        }
      }
    } catch (err) {
      console.error('Error al cargar control de clientes:', err);
    } finally {
      isLoadingRecords = false;
    }
  }

  async function loadDropRecords() {
    const lId = libroId || libro?.id;
    if (!lId) return;
    isLoadingDrop = true;
    try {
      const res = await fetch(`/api/master/libros/${lId}/drop-mesas`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success) {
          dropRecords = json.data || [];
        }
      }
    } catch (err) {
      console.error('Error al cargar drop mesas para resumen:', err);
    } finally {
      isLoadingDrop = false;
    }
  }

  async function loadSugerenciasRemotas(q = '') {
    try {
      const lId = libroId || libro?.id;
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (targetSalaId) params.set('sala_id', String(targetSalaId));

      const url = lId 
        ? `/api/master/libros/${lId}/control-clientes/sugerencias?${params.toString()}` 
        : `/api/master/libros/control-clientes/sugerencias?${params.toString()}`;

      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && Array.isArray(json.data)) {
          sugerenciasRemotas = json.data;
        }
      }
    } catch (err) {
      // Silencioso
    }
  }

  // Manejo de autocompletado en el input cliente
  function onClienteFocus() {
    showSugerencias = true;
    selectedSugerenciaIndex = -1;
    loadSugerenciasRemotas((cliente || '').trim());
  }

  function onClienteInput() {
    showSugerencias = true;
    selectedSugerenciaIndex = -1;
    const q = (cliente || '').trim().toLowerCase();
    const match = allClientesList.find(s => 
      s.nombre.toLowerCase().trim() === q
    );
    if (match) {
      selectedClienteId = match.id || null;
      selectedTipoClienteNombre = match.tipo_cliente_nombre || 'General';
    } else {
      selectedClienteId = null;
      selectedTipoClienteNombre = '';
    }
    loadSugerenciasRemotas(cliente.trim());
  }

  function onClienteKeyDown(e) {
    if (!showSugerencias || sugerenciasFiltradas.length === 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        showSugerencias = true;
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedSugerenciaIndex = (selectedSugerenciaIndex + 1) % sugerenciasFiltradas.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedSugerenciaIndex = (selectedSugerenciaIndex - 1 + sugerenciasFiltradas.length) % sugerenciasFiltradas.length;
    } else if (e.key === 'Tab') {
      // Al presionar Tabulador rellena automáticamente con la coincidencia seleccionada o primera
      const match = selectedSugerenciaIndex >= 0 
        ? sugerenciasFiltradas[selectedSugerenciaIndex] 
        : sugerenciasFiltradas[0];
      if (match) {
        e.preventDefault();
        seleccionarSugerencia(match);
      }
    } else if (e.key === 'Enter') {
      if (selectedSugerenciaIndex >= 0 && sugerenciasFiltradas[selectedSugerenciaIndex]) {
        e.preventDefault();
        seleccionarSugerencia(sugerenciasFiltradas[selectedSugerenciaIndex]);
      }
    } else if (e.key === 'Escape') {
      showSugerencias = false;
      selectedSugerenciaIndex = -1;
    }
  }

  function seleccionarSugerencia(sug) {
    if (typeof sug === 'object' && sug !== null) {
      cliente = sug.nombre || '';
      selectedClienteId = sug.id || null;
      selectedTipoClienteNombre = sug.tipo_cliente_nombre || 'General';
    } else {
      cliente = String(sug || '');
      selectedClienteId = null;
      selectedTipoClienteNombre = 'General';
    }
    showSugerencias = false;
    selectedSugerenciaIndex = -1;
  }

  function onClienteBlur() {
    setTimeout(() => {
      showSugerencias = false;
      selectedSugerenciaIndex = -1;
    }, 250);
  }

  async function handleGuardar() {
    const lId = libroId || libro?.id;
    if (!lId) {
      triggerToast('No se encontró el ID del libro', 'error');
      return;
    }

    const cleanCliente = (cliente || '').trim();
    if (!cleanCliente) {
      triggerToast('Debe ingresar el nombre del cliente', 'warning');
      return;
    }

    const cleanMonto = parseFloat(monto);
    if (isNaN(cleanMonto) || cleanMonto <= 0) {
      triggerToast('Debe ingresar un monto válido mayor a 0', 'warning');
      return;
    }

    isSaving = true;
    try {
      const defaultMetodo = metodosDisponibles.find(m => (m.nombre || '').toLowerCase() === 'general') || metodosDisponibles[0] || { id: 1, nombre: 'General' };
      const payload = {
        cliente: cleanCliente,
        cliente_id: selectedClienteId || null,
        tipo: tipo || 'Compra',
        monto: cleanMonto,
        metodo_pago_id: defaultMetodo.id || 1,
        metodo: defaultMetodo.nombre || 'General',
        hora: getCurrentTimeString() // Hora en curso automáticamente
      };

      const res = await fetch(`/api/master/libros/${lId}/control-clientes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Registro de cliente guardado exitosamente', 'success');
        cliente = '';
        selectedClienteId = null;
        selectedTipoClienteNombre = '';
        monto = '';
        tipo = 'Compra';
        showSugerencias = false;
        await loadRecords();
        loadSugerenciasRemotas();
        loadDropRecords();
        try {
          await loadMasterStoresFromBackend();
        } catch (e) {}
      } else {
        triggerToast(json?.error || 'Error al registrar cliente', 'error');
      }
    } catch (err) {
      console.error('Error al registrar cliente:', err);
      triggerToast(`Error de conexión: ${err.message}`, 'error');
    } finally {
      isSaving = false;
    }
  }

  async function handleEliminar(recordId) {
    const lId = libroId || libro?.id;
    if (!lId || !recordId) return;

    try {
      const res = await fetch(`/api/master/libros/${lId}/control-clientes/${recordId}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Registro eliminado correctamente', 'info');
        records = records.filter(r => Number(r.id) !== Number(recordId));
      } else {
        triggerToast(json?.error || 'Error al eliminar registro', 'error');
      }
    } catch (err) {
      console.error('Error al eliminar registro:', err);
      triggerToast(`Error: ${err.message}`, 'error');
    }
  }

  // Modal para editar Método y Hora
  function abrirModalEditar(record) {
    editingRecord = record;
    modalMetodoPagoId = record.metodo_pago_id 
      ? Number(record.metodo_pago_id) 
      : (metodosDisponibles.find(m => (m.nombre || '').toLowerCase().trim() === (record.metodo || '').toLowerCase().trim())?.id || 1);
    const matched = metodosDisponibles.find(m => Number(m.id) === Number(modalMetodoPagoId));
    modalMetodo = matched ? matched.nombre : (record.metodo || 'General');
    modalHora = record.hora || getCurrentTimeString();
    showModalEditar = true;
  }

  function cerrarModalEditar() {
    showModalEditar = false;
    editingRecord = null;
  }

  function ponerHoraActualModal() {
    modalHora = getCurrentTimeString();
  }

  async function handleGuardarModal() {
    if (!editingRecord) return;
    const lId = libroId || libro?.id;
    if (!lId) return;

    if (!modalHora) {
      triggerToast('Debe indicar una hora válida', 'warning');
      return;
    }

    isSavingModal = true;
    try {
      const res = await fetch(`/api/master/libros/${lId}/control-clientes/${editingRecord.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metodo_pago_id: modalMetodoPagoId,
          metodo: modalMetodo || 'General',
          hora: modalHora
        })
      });

      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Método y hora actualizados correctamente', 'success');
        cerrarModalEditar();
        await loadRecords();
      } else {
        triggerToast(json?.error || 'Error al actualizar', 'error');
      }
    } catch (err) {
      console.error('Error al actualizar método y hora:', err);
      triggerToast(`Error: ${err.message}`, 'error');
    } finally {
      isSavingModal = false;
    }
  }
</script>

<div class="clientes-layout-grid">
  <!-- Tarjeta Izquierda: Formulario "Control de Clientes" -->
  <div class="card-form-cliente">
    <div class="card-title-box">
      <h3 class="card-title">Control de Clientes</h3>
      <div class="title-underline"></div>
    </div>

    <form on:submit|preventDefault={handleGuardar} class="cliente-form" autocomplete="off">
      <!-- Campo Cliente con Autocompletado / Coincidencias -->
      <div class="form-group relative-autocomplete">
        <label for="input-cliente-nombre" class="form-label">CLIENTE: *</label>
        <div class="cell-autocomplete-container">
          <input 
            id="input-cliente-nombre" 
            type="text" 
            class="form-input {showSugerencias && sugerenciasFiltradas.length > 0 ? 'input-active' : ''}" 
            placeholder="Escriba Cliente (coincidencias con Tab ⇥)..." 
            bind:value={cliente}
            on:focus={onClienteFocus}
            on:input={onClienteInput}
            on:keydown={onClienteKeyDown}
            on:blur={onClienteBlur}
            autocomplete="off"
            required
          />

          <!-- Desplegable visual de sugerencias rápidas -->
          {#if showSugerencias && sugerenciasFiltradas.length > 0}
            <div class="inline-dropdown">
              <div class="inline-dropdown-header">
                <span>Coincidencias (<b>Tab ⇥</b> o clic):</span>
              </div>
              <ul class="inline-dropdown-list">
                {#each sugerenciasFiltradas as sug, idx}
                  <!-- svelte-ignore a11y-click-events-have-key-events -->
                  <li 
                    class="inline-dropdown-item {idx === selectedSugerenciaIndex ? 'selected' : ''}"
                    on:mousedown|preventDefault={() => seleccionarSugerencia(sug)}
                  >
                    <span class="sug-avatar">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="#3b2b73">
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                      </svg>
                    </span>
                    <div class="sug-info">
                      <span class="sug-name">{sug.nombre}</span>
                      <span class="sug-cargo">{sug.tipo_cliente_nombre || 'General'}</span>
                    </div>
                    <span class="sug-tab-badge">Tab ⇥</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
        <span class="field-hint">Escriba nombre o tipo de cliente. Pulsa <b>Tab ⇥</b> para autocompletar. Si no existe, se creará automáticamente como General.</span>
      </div>

      <!-- Sección Tipo: Compra o Pago (2 Radios) -->
      <div class="form-group">
        <label class="form-label">TIPO DE OPERACIÓN: *</label>
        <div class="radio-toggle-group">
          <label class="radio-option {tipo === 'Compra' ? 'selected-compra' : ''}">
            <input 
              type="radio" 
              name="tipo-operacion" 
              value="Compra" 
              bind:group={tipo}
            />
            <span class="radio-custom"></span>
            <span class="radio-text">🛒 Compra</span>
          </label>

          <label class="radio-option {tipo === 'Pago' ? 'selected-pago' : ''}">
            <input 
              type="radio" 
              name="tipo-operacion" 
              value="Pago" 
              bind:group={tipo}
            />
            <span class="radio-custom"></span>
            <span class="radio-text">💳 Pago</span>
          </label>
        </div>
      </div>

      <!-- Campo Monto -->
      <div class="form-group">
        <label for="input-cliente-monto" class="form-label">MONTO: *</label>
        <div class="input-currency-wrapper">
          <span class="currency-symbol">$</span>
          <input 
            id="input-cliente-monto" 
            type="number" 
            step="0.01" 
            min="0.01"
            class="form-input input-currency" 
            placeholder="0.00" 
            bind:value={monto}
            required
          />
        </div>
        <span class="field-hint">Se registrará automáticamente con el método <b>General</b> y la hora en curso.</span>
      </div>

      <!-- Botón Guardar Verde -->
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
    </form>
  </div>

  <!-- Columna Derecha: Tarjeta Unificada con KPIs y Pestañas (1. Detallado, 2. Métodos, 3. Clientes) -->
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
        <!-- KPI 1: Compras -->
        <div class="kpi-card kpi-compras">
          <div class="kpi-header">
            <span class="kpi-icon">🛒</span>
            <span class="kpi-label">TOTAL COMPRAS</span>
          </div>
          <div class="kpi-value-row">
            <span class="kpi-value text-green">${formatMonto(totalCompras)}</span>
          </div>
          <div class="kpi-subtext">
            <span>{countCompras} {countCompras === 1 ? 'operación' : 'operaciones'}</span>
          </div>
        </div>

        <!-- KPI 2: Pagos -->
        <div class="kpi-card kpi-pagos">
          <div class="kpi-header">
            <span class="kpi-icon">💳</span>
            <span class="kpi-label">TOTAL PAGOS</span>
          </div>
          <div class="kpi-value-row">
            <span class="kpi-value text-purple">${formatMonto(totalPagos)}</span>
          </div>
          <div class="kpi-subtext">
            <span>{countPagos} {countPagos === 1 ? 'operación' : 'operaciones'}</span>
          </div>
        </div>

        <!-- KPI 3: Balance Neto Clientes (Compras - Pagos) -->
        <div class="kpi-card kpi-balance {balanceNeto >= 0 ? 'border-favor-casa' : 'border-favor-cliente'}">
          <div class="kpi-header">
            <span class="kpi-icon">⚖️</span>
            <span class="kpi-label">RESULTADO CLIENTES (COMPRA - PAGO)</span>
          </div>
          <div class="kpi-value-row">
            <span class="kpi-value {balanceNeto >= 0 ? 'text-blue' : 'text-amber'}">
              {balanceNeto >= 0 ? '+' : '-'}${formatMonto(Math.abs(balanceNeto))}
            </span>
          </div>
          <div class="kpi-subtext">
            {#if balanceNeto > 0}
              <span class="badge-kpi-status status-casa">🟢 Casa a favor</span>
            {:else if balanceNeto < 0}
              <span class="badge-kpi-status status-jugadores">🔴 Clientes a favor</span>
            {:else}
              <span class="badge-kpi-status status-tablas">⚪ En tablas</span>
            {/if}
          </div>
        </div>

        <!-- KPI 4: Drop Mesas & Total Combinado -->
        <div class="kpi-card kpi-drop">
          <div class="kpi-header">
            <span class="kpi-icon">🎲</span>
            <span class="kpi-label">PRODUCCIÓN DÍA</span>
          </div>
          <div class="kpi-value-row">
            <span class="kpi-value text-slate">${formatMonto(resultadoConDrop)}</span>
          </div>
          <div class="kpi-subtext kpi-drop-breakdown">
            <span>Drop Mesas: <b>${formatMonto(totalDrop)}</b></span>
            <span class="dot-sep">•</span>
            <span>Neto: <b>{balanceNeto >= 0 ? '+' : '-'}${formatMonto(Math.abs(balanceNeto))}</b></span>
          </div>
        </div>
      </div>

      <!-- Selector de Pestañas: 1. Detallado, 2. Métodos, 3. Clientes -->
      <div class="resumen-tabs-header">
        <div class="tabs-nav-list">
          <button 
            type="button" 
            class="tab-nav-btn {activeResumenTab === 'detallado' ? 'active' : ''}"
            on:click={() => activeResumenTab = 'detallado'}
          >
            <span>📋 Detallado de Operaciones ({records.length})</span>
          </button>
          <button 
            type="button" 
            class="tab-nav-btn {activeResumenTab === 'metodos' ? 'active' : ''}"
            on:click={() => activeResumenTab = 'metodos'}
          >
            <span>💳 Resumen por Métodos de Pago</span>
          </button>
          <button 
            type="button" 
            class="tab-nav-btn {activeResumenTab === 'clientes' ? 'active' : ''}"
            on:click={() => activeResumenTab = 'clientes'}
          >
            <span>👥 Resumen por Cliente ({resumenClientes.length})</span>
          </button>
        </div>

        {#if activeResumenTab === 'clientes'}
          <div class="tab-search-wrapper">
            <span class="search-icon">🔍</span>
            <input 
              type="text" 
              class="input-search-cliente-resumen" 
              placeholder="Buscar cliente..." 
              bind:value={busquedaClienteResumen} 
            />
          </div>
        {/if}
      </div>

      <!-- Pestaña 1: Detallado de Operaciones -->
      {#if activeResumenTab === 'detallado'}
        <div class="table-wrapper">
          <table class="clientes-table">
            <thead>
              <tr>
                <th class="th-center th-num">N°</th>
                <th class="th-cliente">Cliente</th>
                <th class="th-center th-tipo">Tipo</th>
                <th class="th-right th-monto">Monto</th>
                <th class="th-center th-metodo">Método</th>
                <th class="th-center th-hora">Hora</th>
                <th class="th-center th-acciones">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {#if isLoadingRecords}
                <tr>
                  <td colspan="7" class="empty-state-cell">
                    <div class="loading-state-inline">
                      <div class="spinner-small"></div>
                      <span>Cargando registros de clientes...</span>
                    </div>
                  </td>
                </tr>
              {:else if records.length === 0}
                <tr>
                  <td colspan="7" class="empty-state-cell">
                    <div class="empty-msg-box">
                      <span class="empty-icon">👥</span>
                      <p class="empty-text">
                        No se han registrado operaciones de clientes para esta fecha. Use el formulario de la izquierda para registrar una Compra o Pago.
                      </p>
                    </div>
                  </td>
                </tr>
              {:else}
                {#each sortedRecords as record, idx}
                  <tr class="cliente-row">
                    <td class="td-center td-num">{idx + 1}</td>
                    <td class="td-cliente">
                      <div class="cliente-cell-content">
                        <span class="cliente-name">{record.cliente}</span>
                        {#if record.tipo_cliente_nombre}
                          <span class="cliente-tipo-pill">{record.tipo_cliente_nombre}</span>
                        {/if}
                      </div>
                    </td>
                    <td class="td-center td-tipo">
                      {#if record.tipo === 'Compra'}
                        <span class="badge-tipo badge-compra">🛒 Compra</span>
                      {:else}
                        <span class="badge-tipo badge-pago">💳 Pago</span>
                      {/if}
                    </td>
                    <td class="td-right td-monto">
                      <span class="monto-value">${formatMonto(record.monto)}</span>
                    </td>
                    <td class="td-center td-metodo">
                      <span class="badge-metodo metodo-{String(record.metodo || 'General').toLowerCase()}">
                        {record.metodo || 'General'}
                      </span>
                    </td>
                    <td class="td-center td-hora-val">
                      <span class="time-badge">{record.hora || '—'}</span>
                    </td>
                    <td class="td-center td-acciones">
                      <div class="acciones-btns-row">
                        <button 
                          type="button" 
                          class="btn-metodo-hora-accion"
                          on:click={() => abrirModalEditar(record)}
                          title="Editar Método y Hora"
                        >
                          ⚙️ Método / Hora
                        </button>
                        <button 
                          type="button" 
                          class="btn-eliminar"
                          on:click={() => handleEliminar(record.id)}
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
      {/if}


      <!-- Contenido Tab 1: Desglose por Métodos de Pago -->
      {#if activeResumenTab === 'metodos'}
        <div class="table-wrapper">
          <table class="resumen-table">
            <thead>
              <tr>
                <th class="th-metodo-name">Método de Pago</th>
                <th class="th-right">Total Compras</th>
                <th class="th-right">Total Pagos</th>
                <th class="th-right">Balance Neto (Compras - Pagos)</th>
                <th class="th-center">Operaciones</th>
              </tr>
            </thead>
            <tbody>
              {#each resumenMetodos as m}
                <tr>
                  <td>
                    <span class="badge-metodo metodo-{m.metodo.toLowerCase()}">{m.metodo}</span>
                  </td>
                  <td class="td-right font-mono text-green">
                    ${formatMonto(m.compras)}
                  </td>
                  <td class="td-right font-mono text-purple">
                    ${formatMonto(m.pagos)}
                  </td>
                  <td class="td-right font-mono font-bold {m.neto >= 0 ? 'text-blue' : 'text-amber'}">
                    {m.neto >= 0 ? '+' : '-'}${formatMonto(Math.abs(m.neto))}
                  </td>
                  <td class="td-center">
                    <span class="ops-badge">{m.count} ({m.countCompras}C / {m.countPagos}P)</span>
                  </td>
                </tr>
              {/each}
            </tbody>
            <tfoot>
              <tr class="tfoot-totals-row">
                <td class="font-bold">TOTALES</td>
                <td class="td-right font-mono font-bold text-green">${formatMonto(totalCompras)}</td>
                <td class="td-right font-mono font-bold text-purple">${formatMonto(totalPagos)}</td>
                <td class="td-right font-mono font-bold {balanceNeto >= 0 ? 'text-blue' : 'text-amber'}">
                  {balanceNeto >= 0 ? '+' : '-'}${formatMonto(Math.abs(balanceNeto))}
                </td>
                <td class="td-center font-bold">{records.length}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      {/if}

      <!-- Contenido Tab 2: Desglose por Cliente -->
      {#if activeResumenTab === 'clientes'}
        <div class="table-wrapper">
          <table class="resumen-table">
            <thead>
              <tr>
                <th class="th-center th-num">N°</th>
                <th>Cliente</th>
                <th class="th-right">Compras Realizadas</th>
                <th class="th-right">Pagos Recibidos</th>
                <th class="th-right">Balance Neto</th>
                <th class="th-center">Resultado</th>
                <th class="th-center">Operaciones</th>
              </tr>
            </thead>
            <tbody>
              {#if resumenClientesFiltrados.length === 0}
                <tr>
                  <td colspan="7" class="empty-state-cell">
                    <span class="empty-text">No hay clientes coincidentes registrados en esta fecha.</span>
                  </td>
                </tr>
              {:else}
                {#each resumenClientesFiltrados as c, idx}
                  <tr>
                    <td class="td-center td-num">{idx + 1}</td>
                    <td>
                      <span class="cliente-resumen-name">👤 {c.cliente}</span>
                    </td>
                    <td class="td-right font-mono text-green">
                      ${formatMonto(c.compras)}
                    </td>
                    <td class="td-right font-mono text-purple">
                      ${formatMonto(c.pagos)}
                    </td>
                    <td class="td-right font-mono font-bold {c.balance >= 0 ? 'text-blue' : 'text-amber'}">
                      {c.balance >= 0 ? '+' : '-'}${formatMonto(Math.abs(c.balance))}
                    </td>
                    <td class="td-center">
                      {#if c.balance < 0}
                        <span class="badge-jugador-res ganando" title="El jugador cobró más premios de lo que compró">
                          🏆 Ganando (${formatMonto(Math.abs(c.balance))})
                        </span>
                      {:else if c.balance > 0}
                        <span class="badge-jugador-res perdiendo" title="La sala retuvo más compras de este jugador">
                          🔴 En Contra (-${formatMonto(c.balance)})
                        </span>
                      {:else}
                        <span class="badge-jugador-res tablas">
                          ⚪ En Tablas ($0.00)
                        </span>
                      {/if}
                    </td>
                    <td class="td-center">
                      <span class="ops-badge">{c.count} ({c.countCompras}C / {c.countPagos}P)</span>
                    </td>
                  </tr>
                {/each}
              {/if}
            </tbody>
            {#if resumenClientes.length > 0}
              <tfoot>
                <tr class="tfoot-totals-row">
                  <td colspan="2" class="font-bold">TOTAL ({resumenClientes.length} Clientes)</td>
                  <td class="td-right font-mono font-bold text-green">${formatMonto(totalCompras)}</td>
                  <td class="td-right font-mono font-bold text-purple">${formatMonto(totalPagos)}</td>
                  <td class="td-right font-mono font-bold {balanceNeto >= 0 ? 'text-blue' : 'text-amber'}">
                    {balanceNeto >= 0 ? '+' : '-'}${formatMonto(Math.abs(balanceNeto))}
                  </td>
                  <td class="td-center font-bold">
                    {#if balanceNeto > 0}
                      <span class="text-blue">Casa a Favor</span>
                    {:else if balanceNeto < 0}
                      <span class="text-amber">Clientes a Favor</span>
                    {:else}
                      <span>Nivelado</span>
                    {/if}
                  </td>
                  <td class="td-center font-bold">{records.length}</td>
                </tr>
              </tfoot>
            {/if}
          </table>
        </div>
      {/if}
    </div>
  </div>
</div>

<!-- Modal para editar Método y Hora (NO se cierra al hacer clic afuera) -->
{#if showModalEditar && editingRecord}
  <div class="modal-backdrop-fixed">
    <div class="modal-dialog-box" role="dialog" aria-modal="true" aria-labelledby="modal-editar-title">
      <div class="modal-header">
        <h4 id="modal-editar-title" class="modal-title">⚙️ Editar Método y Hora</h4>
        <button type="button" class="btn-close-modal" on:click={cerrarModalEditar} aria-label="Cerrar">
          &times;
        </button>
      </div>

      <form on:submit|preventDefault={handleGuardarModal} class="modal-body-form">
        <!-- Resumen del Registro -->
        <div class="modal-info-banner">
          <span class="info-label">Cliente:</span>
          <span class="info-val">{editingRecord.cliente}</span>
          <span class="info-sep">•</span>
          <span class="info-label">Tipo:</span>
          <span class="info-badge {editingRecord.tipo === 'Compra' ? 'badge-compra' : 'badge-pago'}">{editingRecord.tipo}</span>
          <span class="info-sep">•</span>
          <span class="info-label">Monto:</span>
          <span class="info-val">${formatMonto(editingRecord.monto)}</span>
        </div>

        <div class="modal-inputs-grid">
          <!-- Selección de Método -->
          <div class="modal-field-group">
            <label class="modal-field-label">Método de Pago: *</label>
            <div class="metodos-options-grid">
              {#each metodosDisponibles as met}
                <label class="metodo-radio-pill {Number(modalMetodoPagoId) === Number(met.id) ? 'active' : ''}">
                  <input 
                    type="radio" 
                    name="modal-metodo" 
                    value={met.id} 
                    bind:group={modalMetodoPagoId}
                    on:change={() => modalMetodo = met.nombre}
                  />
                  <span>{met.nombre}</span>
                </label>
              {/each}
            </div>
          </div>

          <!-- Selección de Hora -->
          <div class="modal-field-group">
            <div class="modal-field-header">
              <label for="m-hora-cliente" class="modal-field-label">Hora de la Operación: *</label>
              <button 
                type="button" 
                class="btn-hora-now" 
                on:click={ponerHoraActualModal}
                title="Poner hora actual ahora"
              >
                ⚡ Usar hora actual
              </button>
            </div>
            <input 
              id="m-hora-cliente" 
              type="time" 
              class="form-time-input-modal" 
              bind:value={modalHora} 
              required
            />
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
    gap: 10px;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 13px;
    color: #1e293b;
    border-bottom: 1px solid #f1f5f9;
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
    gap: 2px;
    text-align: left;
  }

  .sug-name {
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sug-cargo {
    font-size: 11px;
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
    font-size: 11px;
    background: #f1f5f9;
    color: #334155;
    padding: 3px 8px;
    border-radius: 6px;
    font-weight: 700;
    border: 1px solid #cbd5e1;
    flex-shrink: 0;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .inline-dropdown-item:hover .sug-tab-badge,
  .inline-dropdown-item.selected .sug-tab-badge {
    background: #dbeafe;
    border-color: #93c5fd;
    color: #1d4ed8;
  }

  /* Sección Tipo: Radios */
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

  .radio-option.selected-compra {
    border-color: #22c55e;
    background: #f0fdf4;
    color: #15803d;
    font-weight: 700;
  }

  .radio-option.selected-pago {
    border-color: #8b5cf6;
    background: #f5f3ff;
    color: #6d28d9;
    font-weight: 700;
  }

  .radio-text {
    font-size: 13.5px;
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
     Columna Derecha: Tabla + Resumen
  ───────────────────────────────────────────────────────────── */
  .clientes-right-column {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
    min-width: 0;
  }

  .card-table-clientes {
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

  .clientes-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    text-align: left;
  }

  /* Cabeceras Oscuras */
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

  .th-center {
    text-align: center;
  }

  .th-right {
    text-align: right;
  }

  .th-num {
    width: 45px;
  }

  .th-cliente {
    min-width: 180px;
  }

  .th-tipo {
    width: 110px;
  }

  .th-monto {
    width: 120px;
  }

  .th-metodo {
    width: 110px;
  }

  .th-hora {
    width: 90px;
  }

  .th-acciones {
    width: 190px;
  }

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

  .cliente-name {
    font-weight: 700;
    color: #0f172a;
  }

  /* Badges de Tipo */
  .badge-tipo {
    display: inline-block;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11.5px;
    font-weight: 700;
  }

  .badge-compra {
    background: #dcfce7;
    color: #15803d;
    border: 1px solid #bbf7d0;
  }

  .badge-pago {
    background: #ede9fe;
    color: #6d28d9;
    border: 1px solid #ddd6fe;
  }

  .monto-value {
    font-weight: 700;
    color: #0f172a;
    font-variant-numeric: tabular-nums;
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

  .badge-metodo.metodo-cash {
    background: #ecfdf5;
    color: #047857;
    border-color: #a7f3d0;
  }

  .badge-metodo.metodo-usdt {
    background: #fef3c7;
    color: #b45309;
    border-color: #fde68a;
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

  /* ─────────────────────────────────────────────────────────────
     Tarjeta de Resumen Consolidado
  ───────────────────────────────────────────────────────────── */
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
  .text-amber { color: #d97706; }
  .text-slate { color: #0f172a; }

  .kpi-subtext {
    font-size: 11.5px;
    color: #64748b;
    margin-top: 2px;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .badge-kpi-status {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10.5px;
    font-weight: 700;
  }

  .status-casa {
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
  }

  .status-jugadores {
    background: #fef2f2;
    color: #b91c1c;
    border: 1px solid #fecaca;
  }

  .status-tablas {
    background: #f1f5f9;
    color: #475569;
  }

  .kpi-drop-breakdown {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
  }

  .dot-sep {
    color: #cbd5e1;
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
    font-size: 12px;
    border: 1px solid #cbd5e1;
    border-radius: 5px;
    outline: none;
    background: #ffffff;
    transition: all 0.2s ease;
    width: 170px;
  }

  .input-search-cliente-resumen:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
  }

  /* Tablas de Resumen */
  .resumen-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
    text-align: left;
  }

  .resumen-table thead tr {
    background: #334155;
    color: #ffffff;
  }

  .resumen-table th {
    padding: 10px 14px;
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
  }

  .resumen-table td {
    padding: 10px 14px;
    color: #1e293b;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: middle;
  }

  .resumen-table tr:hover {
    background: #f8fafc;
  }

  .th-metodo-name {
    min-width: 140px;
  }

  .font-mono {
    font-variant-numeric: tabular-nums;
  }

  .font-bold {
    font-weight: 700;
  }

  .ops-badge {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    background: #f1f5f9;
    color: #475569;
  }

  .cliente-resumen-name {
    font-weight: 700;
    color: #0f172a;
  }

  .badge-jugador-res {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
  }

  .badge-jugador-res.ganando {
    background: #ecfdf5;
    color: #059669;
    border: 1px solid #a7f3d0;
  }

  .badge-jugador-res.perdiendo {
    background: #fef2f2;
    color: #dc2626;
    border: 1px solid #fecaca;
  }

  .badge-jugador-res.tablas {
    background: #f1f5f9;
    color: #64748b;
    border: 1px solid #e2e8f0;
  }

  .tfoot-totals-row {
    background: #f8fafc;
    border-top: 2px solid #cbd5e1;
  }

  .tfoot-totals-row td {
    padding: 11px 14px;
    font-size: 13px;
  }

  /* Estados vacíos y loading */
  .empty-state-cell {
    padding: 30px 16px !important;
    text-align: center;
  }

  .loading-state-inline {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: #64748b;
    font-size: 14px;
    font-weight: 500;
  }

  .spinner-small {
    width: 20px;
    height: 20px;
    border: 2px solid #e2e8f0;
    border-top: 2px solid #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .empty-msg-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    max-width: 480px;
    margin: 0 auto;
  }

  .empty-icon {
    font-size: 32px;
  }

  .empty-text {
    margin: 0;
    font-size: 13px;
    color: #64748b;
    line-height: 1.5;
  }

  /* ─────────────────────────────────────────────────────────────
     Modal Estilos (NO cierra al dar click afuera)
  ───────────────────────────────────────────────────────────── */
  .modal-backdrop-fixed {
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
    z-index: 9999;
    padding: 16px;
  }

  .modal-dialog-box {
    background: #ffffff;
    border-radius: 8px;
    width: 100%;
    max-width: 460px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    animation: modalScale 0.15s ease-out;
  }

  @keyframes modalScale {
    from {
      opacity: 0;
      transform: scale(0.96);
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

  .modal-field-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-field-label {
    font-size: 13px;
    font-weight: 700;
    color: #334155;
  }

  .btn-hora-now {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    color: #2563eb;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 8px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-hora-now:hover {
    background: #e2e8f0;
    color: #1d4ed8;
  }

  /* Grid de Métodos */
  .metodos-options-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .metodo-radio-pill {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px 6px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    background: #f8fafc;
    color: #334155;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
    transition: all 0.15s ease;
  }

  .metodo-radio-pill input[type="radio"] {
    display: none;
  }

  .metodo-radio-pill.active {
    background: #3b82f6;
    color: #ffffff;
    border-color: #2563eb;
    box-shadow: 0 2px 6px rgba(59, 130, 246, 0.3);
  }

  .form-time-input-modal {
    width: 100%;
    padding: 9px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    color: #0f172a;
    background: #ffffff;
    outline: none;
    box-sizing: border-box;
    transition: all 0.15s ease;
  }

  .form-time-input-modal:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
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

  /* Autocompletado y Dropdown Interactivo */
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
    border: 1px solid #94a3b8;
    border-radius: 6px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
    margin-top: 3px;
    min-width: 260px;
    overflow: hidden;
  }

  .inline-dropdown-header {
    background: #f1f5f9;
    padding: 6px 12px;
    border-bottom: 1px solid #e2e8f0;
    font-size: 11px;
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

  .inline-dropdown-item:hover,
  .inline-dropdown-item.selected {
    background: #eff6ff;
    color: #1d4ed8;
  }

  .sug-avatar {
    font-size: 13px;
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
  }

  /* Badge de Tipo de Cliente en la tabla */
  .cliente-cell-content {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
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
</style>
