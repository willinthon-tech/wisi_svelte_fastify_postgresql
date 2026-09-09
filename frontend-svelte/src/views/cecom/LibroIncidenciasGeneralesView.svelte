<script>
  import { onMount } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { masterSalasStore, masterTipoIncidenciasStore, loadMasterStoresFromBackend } from '../../controllers/master.store.js';

  export let libro = null;
  export let libroId = null;

  const DEFAULT_TIPOS_INCIDENCIA = [
    { id: 1, nombre: 'General' },
    { id: 2, nombre: 'Empleado' },
    { id: 3, nombre: 'Mercancía' }
  ];

  $: availableTiposIncidencia = ($masterTipoIncidenciasStore && $masterTipoIncidenciasStore.length > 0)
    ? $masterTipoIncidenciasStore
    : DEFAULT_TIPOS_INCIDENCIA;

  // Estado del formulario
  let tipoIncidenciaId = 1;
  $: tipo = availableTiposIncidencia.find(t => Number(t.id) === Number(tipoIncidenciaId))?.nombre || 'General';
  let descripcion = '';
  let isSaving = false;

  // Pestaña activa para filtrar la tabla: 'all' (Detallado) o nombre de tipo
  let activeTab = 'all';

  // Lista de incidencias
  let records = [];
  let isLoadingRecords = true;

  function normalizeText(val) {
    return String(val || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  // Conteo reactivo e infalible por cada tipo de incidencia
  $: countsByTipo = (() => {
    const counts = {};
    for (const t of availableTiposIncidencia) {
      const tId = Number(t.id);
      const tNorm = normalizeText(t.nombre);
      const count = records.filter(r => {
        const rId = r.tipo_incidencia_id != null ? Number(r.tipo_incidencia_id) : null;
        if (rId && rId === tId) return true;
        const rTipoNorm = normalizeText(r.tipo);
        if (rTipoNorm && rTipoNorm === tNorm) return true;
        const rNomNorm = normalizeText(r.tipo_incidencia_nombre);
        if (rNomNorm && rNomNorm === tNorm) return true;
        return false;
      }).length;
      counts[t.id] = count;
      counts[t.nombre] = count;
    }
    return counts;
  })();

  function getPillClass(name) {
    const s = normalizeText(name);
    if (s.includes('mercanc')) return 'active-mercancia';
    if (s.includes('emplead')) return 'active-empleado';
    if (s.includes('general')) return 'active-general';
    return 'active-custom';
  }

  function getPillIcon(name) {
    const s = normalizeText(name);
    if (s.includes('mercanc')) return '📦';
    if (s.includes('emplead')) return '👤';
    if (s.includes('general')) return '📌';
    return '⚠️';
  }

  function getBadgeClass(name) {
    const s = normalizeText(name);
    if (s.includes('mercanc')) return 'badge-mercancia';
    if (s.includes('emplead')) return 'badge-empleado';
    if (s.includes('general')) return 'badge-general';
    return 'badge-custom';
  }

  // Lista ordenada por ID de la tabla (la más última primero / ID descendente)
  // Se ordena estrictamente por ID para evitar problemas con turnos nocturnos que cruzan la medianoche
  $: sortedRecords = [...records].sort((a, b) => Number(b.id) - Number(a.id));

  // Filtrado según la pestaña activa
  $: filteredRecords = (() => {
    if (activeTab === 'all') return sortedRecords;
    const activeNorm = normalizeText(activeTab);
    const matchTipo = availableTiposIncidencia.find(t => normalizeText(t.nombre) === activeNorm);
    const matchId = matchTipo ? Number(matchTipo.id) : null;

    return sortedRecords.filter(r => {
      const rId = r.tipo_incidencia_id != null ? Number(r.tipo_incidencia_id) : null;
      if (matchId && rId && rId === matchId) return true;
      if (normalizeText(r.tipo) === activeNorm) return true;
      if (normalizeText(r.tipo_incidencia_nombre) === activeNorm) return true;
      return false;
    });
  })();

  // Modal para editar incidencia completa (Tipo, Contenido y Hora)
  let showModalEditar = false;
  let editingRecord = null;
  let modalTipoIncidenciaId = 1;
  let modalTipo = 'General';
  let modalDescripcion = '';
  let modalHora = '';
  let isSavingModal = false;

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

  function getCurrentTimeString() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  // Preformateo de la incidencia para renderizado tipo Word (Título con hora en negrita e items en viñeta)
  function parseIncidenciaContent(desc, hora) {
    if (!desc) return { title: '', items: [] };
    const rawLines = String(desc).split('\n');
    const lines = rawLines.map(l => l.trimEnd()).filter(l => l.trim().length > 0);
    if (lines.length === 0) return { title: '', items: [] };

    let titleLine = lines[0].trim();
    
    // Si la primera línea ya empieza con la hora (ej. 08:35 ...), la dejamos intacta.
    // De lo contrario, se le antepone la hora para que quede como en la muestra: "08:35 Inversiones 2020..."
    const horaRegex = /^\d{1,2}:\d{2}/;
    if (hora && !horaRegex.test(titleLine)) {
      titleLine = `${hora} ${titleLine}`;
    }

    const items = lines.slice(1).map(l => {
      // Limpiar viñeta inicial si la tiene para normalizar
      return l.replace(/^[\s•\-\*]+/, '').trim();
    }).filter(Boolean);

    return {
      title: titleLine,
      items
    };
  }

  $: livePreviewParsed = parseIncidenciaContent(descripcion, getCurrentTimeString());

  // Manejo de teclado inteligente en el textarea para viñetas y tabulación automática
  function handleTextareaKeyDown(e) {
    const textarea = e.target;
    if (e.key === 'Tab') {
      e.preventDefault();
      insertAtCursor(textarea, '\n     • ');
    } else if (e.key === 'Enter') {
      const start = textarea.selectionStart;
      const val = textarea.value;
      const lineStart = val.lastIndexOf('\n', start - 1) + 1;
      const currentLine = val.substring(lineStart, start);

      // Si la línea actual es solo una viñeta vacía, cancelar viñeta
      if (currentLine.match(/^\s*•\s*$/)) {
        e.preventDefault();
        const before = val.substring(0, lineStart);
        const after = val.substring(start);
        textarea.value = before + after;
        textarea.selectionStart = textarea.selectionEnd = lineStart;
        if (textarea.id === 'm-desc-inc') modalDescripcion = textarea.value;
        else descripcion = textarea.value;
        return;
      }

      // Si ya hay viñeta o estamos en líneas posteriores, continuar con viñeta
      if (currentLine.includes('•') || lineStart > 0) {
        e.preventDefault();
        insertAtCursor(textarea, '\n     • ');
      } else {
        // Primera línea (título): al dar enter empezar viñetas
        e.preventDefault();
        insertAtCursor(textarea, '\n     • ');
      }
    }
  }

  function insertAtCursor(textarea, textToInsert) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const val = textarea.value;
    textarea.value = val.substring(0, start) + textToInsert + val.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + textToInsert.length;
    if (textarea.id === 'm-desc-inc') {
      modalDescripcion = textarea.value;
    } else {
      descripcion = textarea.value;
    }
  }

  function agregarVinetaToolbar(isModal = false) {
    const el = document.getElementById(isModal ? 'm-desc-inc' : 'input-desc-incidencia');
    if (el) {
      el.focus();
      insertAtCursor(el, '\n     • ');
    }
  }

  onMount(async () => {
    await Promise.all([
      loadMasterStoresFromBackend(),
      loadRecords()
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
      const res = await fetch(`/api/master/libros/${lId}/incidencias-generales`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success) {
          records = json.data || [];
        }
      }
    } catch (err) {
      console.error('Error al cargar incidencias generales:', err);
    } finally {
      isLoadingRecords = false;
    }
  }

  async function handleGuardar() {
    const lId = libroId || libro?.id;
    if (!lId) {
      triggerToast('No se encontró el ID del libro', 'error');
      return;
    }

    const cleanDesc = (descripcion || '').trim();
    if (!cleanDesc) {
      triggerToast('Debe ingresar la descripción de la incidencia', 'warning');
      return;
    }

    isSaving = true;
    try {
      const payload = {
        descripcion: cleanDesc,
        tipo_incidencia_id: Number(tipoIncidenciaId) || 1,
        tipo: tipo || 'General',
        hora: getCurrentTimeString()
      };

      const res = await fetch(`/api/master/libros/${lId}/incidencias-generales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Incidencia registrada exitosamente', 'success');
        descripcion = '';
        await loadRecords();
      } else {
        triggerToast(json?.error || 'Error al guardar incidencia', 'error');
      }
    } catch (err) {
      console.error('Error al guardar incidencia:', err);
      triggerToast(`Error de conexión: ${err.message}`, 'error');
    } finally {
      isSaving = false;
    }
  }

  async function handleEliminar(recordId) {
    const lId = libroId || libro?.id;
    if (!lId || !recordId) return;

    try {
      const res = await fetch(`/api/master/libros/${lId}/incidencias-generales/${recordId}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Incidencia eliminada correctamente', 'info');
        records = records.filter(r => Number(r.id) !== Number(recordId));
      } else {
        triggerToast(json?.error || 'Error al eliminar incidencia', 'error');
      }
    } catch (err) {
      console.error('Error al eliminar incidencia:', err);
      triggerToast(`Error: ${err.message}`, 'error');
    }
  }

  // Modal para editar Tipo, Contenido y Hora
  function abrirModalEditar(record) {
    editingRecord = record;
    const rTipoNorm = normalizeText(record.tipo || record.tipo_incidencia_nombre);
    const match = availableTiposIncidencia.find(t => 
      (record.tipo_incidencia_id != null && Number(t.id) === Number(record.tipo_incidencia_id)) ||
      normalizeText(t.nombre) === rTipoNorm
    );
    modalTipoIncidenciaId = match ? match.id : (record.tipo_incidencia_id || 1);
    modalTipo = match ? match.nombre : (record.tipo || 'General');
    modalDescripcion = record.descripcion || '';
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

    const cleanDesc = (modalDescripcion || '').trim();
    if (!cleanDesc) {
      triggerToast('Debe ingresar una descripción válida', 'warning');
      return;
    }

    if (!modalHora) {
      triggerToast('Debe indicar una hora válida', 'warning');
      return;
    }

    isSavingModal = true;
    try {
      const res = await fetch(`/api/master/libros/${lId}/incidencias-generales/${editingRecord.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo_incidencia_id: Number(modalTipoIncidenciaId) || 1,
          tipo: modalTipo || 'General',
          descripcion: cleanDesc,
          hora: modalHora
        })
      });

      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Incidencia actualizada correctamente', 'success');
        cerrarModalEditar();
        await loadRecords();
      } else {
        triggerToast(json?.error || 'Error al actualizar', 'error');
      }
    } catch (err) {
      console.error('Error al actualizar incidencia:', err);
      triggerToast(`Error: ${err.message}`, 'error');
    } finally {
      isSavingModal = false;
    }
  }
</script>

<div class="incidencias-layout-grid">
  <!-- Tarjeta Izquierda: Formulario "Incidencias Generales" -->
  <div class="card-form-incidencia">
    <div class="card-title-box">
      <h3 class="card-title">Incidencias Generales</h3>
      <div class="title-underline"></div>
    </div>

    <form on:submit|preventDefault={handleGuardar} class="incidencia-form">
      <!-- Sección Tipo de Incidencia: Radios Dinámicos desde tipo_incidencias -->
      <div class="form-group">
        <label class="form-label">TIPO DE INCIDENCIA: *</label>
        <div class="radio-tipo-group">
          {#each availableTiposIncidencia as tItem}
            {@const isAct = Number(tipoIncidenciaId) === Number(tItem.id)}
            {@const pillClass = getPillClass(tItem.nombre)}
            <label class="radio-tipo-pill {isAct ? pillClass : ''}">
              <input 
                type="radio" 
                name="tipo-incidencia" 
                value={tItem.id} 
                bind:group={tipoIncidenciaId} 
                on:change={() => tipo = tItem.nombre}
              />
              <span class="pill-icon">{getPillIcon(tItem.nombre)}</span>
              <span class="pill-text">{tItem.nombre}</span>
            </label>
          {/each}
        </div>
      </div>

      <!-- Editor de Texto con Formato (Título + Viñetas) -->
      <div class="form-group">
        <div class="editor-header-bar">
          <label for="input-desc-incidencia" class="form-label">DESCRIPCIÓN DE LA INCIDENCIA: *</label>
          <div class="editor-quick-tools">
            <button 
              type="button" 
              class="btn-tool-vineta" 
              on:click={() => agregarVinetaToolbar(false)}
              title="Insertar viñeta (o presiona Enter/Tab)"
            >
              • Viñeta
            </button>
          </div>
        </div>

        <textarea 
          id="input-desc-incidencia" 
          class="form-textarea-editor" 
          rows="6"
          placeholder="Línea 1: Título o motivo (ej. Inversiones 2020 ingresa pulpas)...&#10;Líneas siguientes: Pulsa Enter o Tab para items en viñeta..."
          bind:value={descripcion}
          on:keydown={handleTextareaKeyDown}
          required
        ></textarea>
        <span class="field-hint">
          Escribe el título en la 1ra línea y pulsa <b>Enter</b> o <b>Tab</b> para agregar items con viñetas.
        </span>
      </div>

      <!-- Vista Previa en Vivo del Preformateado -->
      {#if descripcion.trim()}
        <div class="live-preview-box">
          <div class="preview-header">
            <span>👁️ Vista Previa Preformateada:</span>
          </div>
          <div class="preview-content">
            <div class="preview-title">{livePreviewParsed.title}</div>
            {#if livePreviewParsed.items.length > 0}
              <ul class="preview-items-list">
                {#each livePreviewParsed.items as item}
                  <li>{item}</li>
                {/each}
              </ul>
            {/if}
          </div>
        </div>
      {/if}

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

  <!-- Tarjeta Derecha: Tabla Unificada con Pestañas -->
  <div class="card-table-incidencias">
    <!-- Barra Superior Oscura con Sala y Fecha -->
    <div class="table-top-bar">
      <span>{tableHeaderTitle}</span>
      <span class="tag-top-ops">{records.length} {records.length === 1 ? 'incidencia' : 'incidencias'} en total</span>
    </div>

    <!-- Pestañas de Filtro: Detallado (Todas), General, Empleado, Mercancía -->
    <div class="incidencias-tabs-header">
      <div class="tabs-nav-list">
        <button 
          type="button" 
          class="tab-nav-btn {activeTab === 'all' ? 'active' : ''}"
          on:click={() => activeTab = 'all'}
        >
          <span>📋 Detallado ({records.length})</span>
        </button>
        {#each availableTiposIncidencia as tItem}
          <button 
            type="button" 
            class="tab-nav-btn {activeTab === tItem.nombre ? 'active' : ''}"
            on:click={() => activeTab = tItem.nombre}
          >
            <span>{getPillIcon(tItem.nombre)} {tItem.nombre} ({countsByTipo[tItem.id] || 0})</span>
          </button>
        {/each}
      </div>
    </div>

    <!-- Tabla de Contenido (Sin columna de hora separada; hora integrada en la cabecera) -->
    <div class="table-wrapper">
      <table class="incidencias-table">
        <thead>
          <tr>
            <th class="th-center th-num">N°</th>
            <th class="th-center th-tipo">Tipo</th>
            <th class="th-desc">Descripción / Novedad</th>
            <th class="th-center th-acciones">Acciones</th>
          </tr>
        </thead>
        <tbody>
          {#if isLoadingRecords}
            <tr>
              <td colspan="4" class="empty-state-cell">
                <div class="loading-state-inline">
                  <div class="spinner-small"></div>
                  <span>Cargando incidencias generales...</span>
                </div>
              </td>
            </tr>
          {:else if filteredRecords.length === 0}
            <tr>
              <td colspan="4" class="empty-state-cell">
                <div class="empty-msg-box">
                  <span class="empty-icon">⚠️</span>
                  <p class="empty-text">
                    {#if activeTab === 'all'}
                      No se han reportado incidencias para esta fecha. Use el formulario de la izquierda para registrar una.
                    {:else}
                      No hay incidencias registradas en la categoría <b>{activeTab}</b>.
                    {/if}
                  </p>
                </div>
              </td>
            </tr>
          {:else}
            {#each filteredRecords as record, idx}
              {@const parsed = parseIncidenciaContent(record.descripcion, record.hora)}
              <tr class="incidencia-row">
                <td class="td-center td-num">{idx + 1}</td>
                <td class="td-center td-tipo">
                  <span class="badge-tipo {getBadgeClass(record.tipo)}">
                    {getPillIcon(record.tipo)} {record.tipo || 'General'}
                  </span>
                </td>
                <td class="td-desc">
                  <!-- Formato estilo muestra (Título en negrita con hora, e items indentados abajo) -->
                  <div class="incidencia-content-rendered">
                    <div class="inc-title-line">
                      <span class="inc-title-bold">{parsed.title}</span>
                    </div>
                    {#if parsed.items.length > 0}
                      <ul class="inc-items-list">
                        {#each parsed.items as item}
                          <li>{item}</li>
                        {/each}
                      </ul>
                    {/if}
                  </div>
                </td>
                <td class="td-center td-acciones">
                  <div class="acciones-btns-row">
                    <button 
                      type="button" 
                      class="btn-editar-accion"
                      on:click={() => abrirModalEditar(record)}
                      title="Editar contenido, tipo u hora"
                    >
                      ✏️ Editar
                    </button>
                    <button 
                      type="button" 
                      class="btn-eliminar"
                      on:click={() => handleEliminar(record.id)}
                      title="Eliminar esta incidencia"
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

<!-- ========================================================
     MODAL: EDITAR CONTENIDO, TIPO Y HORA DE LA INCIDENCIA
     (NO se cierra al hacer clic afuera)
======================================================== -->
{#if showModalEditar && editingRecord}
  <div class="modal-backdrop-fixed">
    <div class="modal-dialog-box" role="dialog" aria-modal="true" aria-labelledby="modal-editar-inc-title">
      <div class="modal-header">
        <h4 id="modal-editar-inc-title" class="modal-title">✏️ Editar Incidencia</h4>
        <button type="button" class="btn-close-modal" on:click={cerrarModalEditar} aria-label="Cerrar">
          &times;
        </button>
      </div>

      <form on:submit|preventDefault={handleGuardarModal} class="modal-body-form">
        <!-- Selector Tipo en Modal -->
        <div class="modal-field-group">
          <label class="modal-field-label">Tipo de Incidencia: *</label>
          <div class="radio-tipo-group">
            {#each availableTiposIncidencia as tItem}
              {@const isAct = Number(modalTipoIncidenciaId) === Number(tItem.id)}
              {@const pillClass = getPillClass(tItem.nombre)}
              <label class="radio-tipo-pill {isAct ? pillClass : ''}">
                <input 
                  type="radio" 
                  name="modal-tipo-inc" 
                  value={tItem.id} 
                  bind:group={modalTipoIncidenciaId} 
                  on:change={() => modalTipo = tItem.nombre}
                />
                <span class="pill-icon">{getPillIcon(tItem.nombre)}</span>
                <span class="pill-text">{tItem.nombre}</span>
              </label>
            {/each}
          </div>
        </div>

        <!-- Editor de Contenido en Modal -->
        <div class="modal-field-group">
          <div class="editor-header-bar">
            <label for="m-desc-inc" class="modal-field-label">Descripción / Novedad: *</label>
            <button 
              type="button" 
              class="btn-tool-vineta" 
              on:click={() => agregarVinetaToolbar(true)}
              title="Insertar viñeta"
            >
              • Viñeta
            </button>
          </div>
          <textarea 
            id="m-desc-inc" 
            class="form-textarea-editor" 
            rows="6"
            placeholder="Línea 1: Título o motivo...&#10;Líneas siguientes: Items con viñetas..."
            bind:value={modalDescripcion}
            on:keydown={handleTextareaKeyDown}
            required
          ></textarea>
        </div>

        <!-- Campo Hora en la parte de abajo del modal -->
        <div class="modal-field-group">
          <div class="modal-field-header">
            <label for="m-hora-inc" class="modal-field-label">Hora de la Incidencia: *</label>
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
            id="m-hora-inc" 
            type="time" 
            class="form-time-input-modal" 
            bind:value={modalHora} 
            required
          />
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
  .incidencias-layout-grid {
    display: grid;
    grid-template-columns: 350px 1fr;
    gap: 24px;
    align-items: flex-start;
    width: 100%;
    box-sizing: border-box;
  }

  @media (max-width: 1024px) {
    .incidencias-layout-grid {
      grid-template-columns: 1fr;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     Tarjeta Izquierda: Formulario
  ───────────────────────────────────────────────────────────── */
  .card-form-incidencia {
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

  .incidencia-form {
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

  /* Radios de Tipo (General, Empleado, Mercancía) */
  .radio-tipo-group {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .radio-tipo-pill {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
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
    user-select: none;
  }

  .radio-tipo-pill input[type="radio"] {
    display: none;
  }

  .radio-tipo-pill.active-general {
    border-color: #3b82f6;
    background: #eff6ff;
    color: #1d4ed8;
    box-shadow: 0 1px 4px rgba(59, 130, 246, 0.2);
    font-weight: 700;
  }

  .radio-tipo-pill.active-empleado {
    border-color: #8b5cf6;
    background: #f5f3ff;
    color: #6d28d9;
    box-shadow: 0 1px 4px rgba(139, 92, 246, 0.2);
    font-weight: 700;
  }

  .radio-tipo-pill.active-mercancia {
    border-color: #f59e0b;
    background: #fffbeb;
    color: #b45309;
    box-shadow: 0 1px 4px rgba(245, 158, 11, 0.2);
    font-weight: 700;
  }

  .radio-tipo-pill.active-custom {
    border-color: #10b981;
    background: #ecfdf5;
    color: #047857;
    box-shadow: 0 1px 4px rgba(16, 185, 129, 0.2);
    font-weight: 700;
  }

  .pill-icon {
    font-size: 13px;
  }

  .pill-text {
    font-size: 12px;
  }

  /* Editor Toolbar & Textarea */
  .editor-header-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .btn-tool-vineta {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    color: #334155;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 8px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-tool-vineta:hover {
    background: #e2e8f0;
    color: #0f172a;
  }

  .form-textarea-editor {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13px;
    color: #0f172a;
    background-color: #ffffff;
    outline: none;
    transition: all 0.2s ease;
    box-sizing: border-box;
    resize: vertical;
    line-height: 1.5;
    font-family: inherit;
  }

  .form-textarea-editor:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  /* Vista previa en vivo */
  .live-preview-box {
    background: #f8fafc;
    border: 1px dashed #cbd5e1;
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 12.5px;
  }

  .preview-header {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    margin-bottom: 6px;
  }

  .preview-content {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    padding: 8px 12px;
  }

  .preview-title {
    font-weight: 700;
    color: #0f172a;
    font-size: 13px;
  }

  .preview-items-list {
    margin: 4px 0 0 16px;
    padding: 0;
    list-style-type: disc;
    color: #334155;
    font-size: 12px;
    line-height: 1.45;
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
     Tarjeta Derecha: Tabla Unificada
  ───────────────────────────────────────────────────────────── */
  .card-table-incidencias {
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 18px;
    letter-spacing: 0.3px;
  }

  .tag-top-ops {
    font-size: 11.5px;
    background: rgba(255, 255, 255, 0.2);
    padding: 3px 8px;
    border-radius: 4px;
    color: #ffffff;
    font-weight: 600;
  }

  /* Pestañas de Filtro */
  .incidencias-tabs-header {
    background: #f1f5f9;
    padding: 8px 16px;
    border-bottom: 1px solid #e2e8f0;
  }

  .tabs-nav-list {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
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
    overflow-x: auto;
    width: 100%;
  }

  .incidencias-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    text-align: left;
  }

  .incidencias-table thead tr {
    background: #2b3544;
    color: #ffffff;
  }

  .incidencias-table th {
    padding: 12px 14px;
    font-size: 12.5px;
    font-weight: 700;
    letter-spacing: 0.2px;
    white-space: nowrap;
  }

  .th-center { text-align: center; }
  .th-num { width: 45px; }
  .th-tipo { width: 110px; }
  .th-desc { min-width: 320px; }
  .th-acciones { width: 150px; }

  .incidencia-row {
    border-bottom: 1px solid #f1f5f9;
    transition: background 0.15s ease;
  }

  .incidencia-row:hover {
    background: #f8fafc;
  }

  .incidencias-table td {
    padding: 12px 14px;
    color: #1e293b;
    font-size: 13px;
    vertical-align: top;
  }

  .td-center { text-align: center; }

  /* Badges de Tipo */
  .badge-tipo {
    display: inline-block;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
  }

  .badge-general {
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
  }

  .badge-empleado {
    background: #f5f3ff;
    color: #6d28d9;
    border: 1px solid #ddd6fe;
  }

  .badge-mercancia {
    background: #fffbeb;
    color: #b45309;
    border: 1px solid #fde68a;
  }

  .badge-custom {
    background: #ecfdf5;
    color: #047857;
    border: 1px solid #a7f3d0;
  }

  /* Renderizado de la Incidencia (Estilo muestra: Título en negrita con hora e items con sangría) */
  .incidencia-content-rendered {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .inc-title-bold {
    font-size: 13.5px;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.4;
  }

  .inc-items-list {
    margin: 2px 0 0 24px;
    padding: 0;
    list-style-type: disc;
    color: #334155;
    font-size: 12.5px;
    line-height: 1.5;
  }

  .inc-items-list li {
    margin-bottom: 2px;
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
    max-width: 520px;
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

  .modal-field-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
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
