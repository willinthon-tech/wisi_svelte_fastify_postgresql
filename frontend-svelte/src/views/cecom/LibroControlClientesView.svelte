<script>
  import { onMount } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { masterSalasStore, loadMasterStoresFromBackend } from '../../controllers/master.store.js';

  export let libro = null;
  export let libroId = null;

  // Estado del formulario
  let cliente = '';
  let tipo = 'Compra'; // 'Compra' o 'Pago'
  let monto = '';
  let isSaving = false;

  // Sugerencias interactivas de clientes
  let sugerenciasRemotas = [];
  let showSugerencias = false;
  let selectedSugerenciaIndex = -1;

  // Lista de registros
  let records = [];
  let isLoadingRecords = false;

  // Extraer clientes únicos para sugerencias locales
  $: clientesLocales = [...new Set(records.map(r => r.cliente).filter(Boolean))];

  // Sugerencias combinadas filtradas por lo que escribe el usuario
  $: sugerenciasFiltradas = (() => {
    const q = (cliente || '').trim().toLowerCase();
    if (!q) return [];
    const pool = [...new Set([...clientesLocales, ...sugerenciasRemotas])];
    return pool
      .filter(name => name.toLowerCase().includes(q))
      .slice(0, 8);
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
  let modalMetodo = 'General';
  let modalHora = '';
  let isSavingModal = false;

  const METODOS_DISPONIBLES = ['General', 'PDV', 'Cash', 'USDT'];

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

  onMount(async () => {
    await Promise.all([
      loadMasterStoresFromBackend(),
      loadRecords(),
      loadSugerenciasRemotas()
    ]);
  });

  $: if (libroId) {
    loadRecords();
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

  async function loadSugerenciasRemotas(q = '') {
    try {
      const url = q 
        ? `/api/master/libros/control-clientes/sugerencias?q=${encodeURIComponent(q)}` 
        : `/api/master/libros/control-clientes/sugerencias`;
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
  function onClienteInput() {
    showSugerencias = true;
    selectedSugerenciaIndex = -1;
    if (cliente.trim().length >= 1) {
      loadSugerenciasRemotas(cliente.trim());
    }
  }

  function onClienteKeyDown(e) {
    if (!showSugerencias || sugerenciasFiltradas.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedSugerenciaIndex = (selectedSugerenciaIndex + 1) % sugerenciasFiltradas.length;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedSugerenciaIndex = (selectedSugerenciaIndex - 1 + sugerenciasFiltradas.length) % sugerenciasFiltradas.length;
    } else if (e.key === 'Tab') {
      // Al presionar Tabulador rellena automáticamente con la coincidencia
      const match = selectedSugerenciaIndex >= 0 
        ? sugerenciasFiltradas[selectedSugerenciaIndex] 
        : sugerenciasFiltradas[0];
      if (match) {
        cliente = match;
        showSugerencias = false;
        selectedSugerenciaIndex = -1;
      }
    } else if (e.key === 'Enter') {
      if (selectedSugerenciaIndex >= 0) {
        e.preventDefault();
        cliente = sugerenciasFiltradas[selectedSugerenciaIndex];
        showSugerencias = false;
        selectedSugerenciaIndex = -1;
      }
    } else if (e.key === 'Escape') {
      showSugerencias = false;
      selectedSugerenciaIndex = -1;
    }
  }

  function seleccionarSugerencia(nombre) {
    cliente = nombre;
    showSugerencias = false;
    selectedSugerenciaIndex = -1;
  }

  function onClienteBlur() {
    // Retardo pequeño para permitir el clic sobre la sugerencia
    setTimeout(() => {
      showSugerencias = false;
      selectedSugerenciaIndex = -1;
    }, 200);
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
      const payload = {
        cliente: cleanCliente,
        tipo: tipo || 'Compra',
        monto: cleanMonto,
        metodo: 'General', // Por defecto General según requerimiento
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
        monto = '';
        tipo = 'Compra';
        showSugerencias = false;
        await loadRecords();
        loadSugerenciasRemotas();
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
    modalMetodo = record.metodo || 'General';
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
      <!-- Campo Cliente con Autocompletado / Recomendación -->
      <div class="form-group relative-autocomplete">
        <label for="input-cliente-nombre" class="form-label">CLIENTE: *</label>
        <div class="input-with-hint">
          <input 
            id="input-cliente-nombre" 
            type="text" 
            class="form-input" 
            placeholder="Escriba el nombre del cliente..." 
            bind:value={cliente}
            on:input={onClienteInput}
            on:keydown={onClienteKeyDown}
            on:blur={onClienteBlur}
            on:focus={onClienteInput}
            list="clientes-datalist-native"
            required
          />
          <datalist id="clientes-datalist-native">
            {#each [...new Set([...clientesLocales, ...sugerenciasRemotas])] as item}
              <option value={item}></option>
            {/each}
          </datalist>
        </div>

        <!-- Desplegable visual de sugerencias rápidas -->
        {#if showSugerencias && sugerenciasFiltradas.length > 0}
          <div class="sugerencias-dropdown">
            <div class="sugerencias-header">
              <span>Sugerencias (Pulsa <b>Tab</b> para autocompletar):</span>
            </div>
            <ul class="sugerencias-list">
              {#each sugerenciasFiltradas as sug, idx}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <li 
                  class="sugerencia-item {idx === selectedSugerenciaIndex ? 'active' : ''}"
                  on:mousedown|preventDefault={() => seleccionarSugerencia(sug)}
                >
                  <span class="sug-icon">👤</span>
                  <span class="sug-text">{sug}</span>
                  <span class="sug-tab-badge">Tab ⇥</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        <span class="field-hint">Al escribir saldrán sugerencias. Pulsa <b>Tab</b> para rellenar rápido.</span>
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

  <!-- Tarjeta Derecha: Tabla de Control de Clientes -->
  <div class="card-table-clientes">
    <!-- Barra Superior Oscura con Sala y Fecha -->
    <div class="table-top-bar">
      <span>{tableHeaderTitle}</span>
    </div>

    <!-- Tabla de Contenido -->
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
                  <span class="cliente-name">{record.cliente}</span>
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
              {#each METODOS_DISPONIBLES as met}
                <label class="metodo-radio-pill {modalMetodo === met ? 'active' : ''}">
                  <input 
                    type="radio" 
                    name="modal-metodo" 
                    value={met} 
                    bind:group={modalMetodo}
                  />
                  <span>{met}</span>
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

  /* Desplegable de Sugerencias Interactivas */
  .sugerencias-dropdown {
    position: absolute;
    top: 68px;
    left: 0;
    right: 0;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    z-index: 50;
    overflow: hidden;
  }

  .sugerencias-header {
    background: #f8fafc;
    padding: 6px 12px;
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
    padding: 8px 12px;
    cursor: pointer;
    font-size: 13px;
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
  }

  .sug-tab-badge {
    font-size: 10.5px;
    background: #e2e8f0;
    color: #475569;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 600;
  }

  .sugerencia-item.active .sug-tab-badge {
    background: #bfdbfe;
    color: #1e40af;
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
     Tarjeta Derecha: Tabla
  ───────────────────────────────────────────────────────────── */
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

  .td-center {
    text-align: center;
  }

  .td-right {
    text-align: right;
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

  /* Estados vacíos y loading */
  .empty-state-cell {
    padding: 40px 20px !important;
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
</style>
