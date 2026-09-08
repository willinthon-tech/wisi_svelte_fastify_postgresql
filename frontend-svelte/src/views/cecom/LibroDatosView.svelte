<script>
  import { onMount } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { masterSalasStore, masterEmpleadosStore, loadMasterStoresFromBackend } from '../../controllers/master.store.js';

  export let libro = null;
  export let libroId = null;

  // Estado del formulario
  let aperturaSalaInicio = '';
  let aperturaSalaFin = '';

  let aperturaMaquinasInicio = '';
  let aperturaMaquinasFin = '';

  let aperturaBingoInicio = '';
  let aperturaBingoFin = '';

  let retirosDropboxInicio = '';
  let retirosDropboxFin = '';

  let conteoDropboxInicio = '';
  let conteoDropboxFin = '';

  let operadorTurnoA = '';
  let operadorTurnoC = '';

  let isSaving = false;
  let isLoadingData = false;
  let recordId = null;
  let lastUpdatedAt = null;

  // Encabezado superior: Roraima - 07/09/2026
  $: tableHeaderTitle = (() => {
    const salaName = libro?.sala_nombre || 
      ($masterSalasStore || []).find(s => Number(s.id) === Number(libro?.sala_id))?.nombre ||
      libro?.sala_nombre_comercial ||
      ($masterSalasStore || []).find(s => Number(s.id) === Number(libro?.sala_id))?.nombre_comercial || 'Sala';
    const dateFormatted = formatDateDisplay(libro?.descripcion);
    return `${salaName} - ${dateFormatted}`;
  })();

  // Sugerencias de empleados para operadores CECOM
  $: listaEmpleados = ($masterEmpleadosStore || []).map(e => {
    const nom = [e.nombre, e.apellido].filter(Boolean).join(' ').trim();
    return nom || e.nombre || '';
  }).filter(Boolean);

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
      loadDatos()
    ]);
  });

  $: if (libroId) {
    loadDatos();
  }

  async function loadDatos() {
    const lId = libroId || libro?.id;
    if (!lId) return;

    isLoadingData = true;
    try {
      const res = await fetch(`/api/master/libros/${lId}/datos`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && json.data) {
          const d = json.data;
          recordId = d.id;
          aperturaSalaInicio = d.apertura_sala_inicio || '';
          aperturaSalaFin = d.apertura_sala_fin || '';

          aperturaMaquinasInicio = d.apertura_maquinas_inicio || '';
          aperturaMaquinasFin = d.apertura_maquinas_fin || '';

          aperturaBingoInicio = d.apertura_bingo_inicio || '';
          aperturaBingoFin = d.apertura_bingo_fin || '';

          retirosDropboxInicio = d.retiros_dropbox_inicio || '';
          retirosDropboxFin = d.retiros_dropbox_fin || '';

          conteoDropboxInicio = d.conteo_dropbox_inicio || '';
          conteoDropboxFin = d.conteo_dropbox_fin || '';

          operadorTurnoA = d.operador_turno_a || '';
          operadorTurnoC = d.operador_turno_c || '';

          lastUpdatedAt = d.updated_at || d.created_at || null;
        } else {
          // Limpiar si no hay datos guardados aún
          recordId = null;
          aperturaSalaInicio = '';
          aperturaSalaFin = '';
          aperturaMaquinasInicio = '';
          aperturaMaquinasFin = '';
          aperturaBingoInicio = '';
          aperturaBingoFin = '';
          retirosDropboxInicio = '';
          retirosDropboxFin = '';
          conteoDropboxInicio = '';
          conteoDropboxFin = '';
          operadorTurnoA = '';
          operadorTurnoC = '';
          lastUpdatedAt = null;
        }
      }
    } catch (err) {
      console.error('Error al cargar datos operativos del libro:', err);
    } finally {
      isLoadingData = false;
    }
  }

  async function handleGuardar() {
    const lId = libroId || libro?.id;
    if (!lId) {
      triggerToast('No se encontró el ID del libro', 'error');
      return;
    }

    isSaving = true;
    try {
      const payload = {
        apertura_sala_inicio: aperturaSalaInicio,
        apertura_sala_fin: aperturaSalaFin,
        apertura_maquinas_inicio: aperturaMaquinasInicio,
        apertura_maquinas_fin: aperturaMaquinasFin,
        apertura_bingo_inicio: aperturaBingoInicio,
        apertura_bingo_fin: aperturaBingoFin,
        retiros_dropbox_inicio: retirosDropboxInicio,
        retiros_dropbox_fin: retirosDropboxFin,
        conteo_dropbox_inicio: conteoDropboxInicio,
        conteo_dropbox_fin: conteoDropboxFin,
        operador_turno_a: operadorTurnoA,
        operador_turno_c: operadorTurnoC
      };

      const res = await fetch(`/api/master/libros/${lId}/datos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (res.ok && json && json.success) {
        triggerToast('Datos operativos guardados correctamente', 'success');
        if (json.data) {
          recordId = json.data.id;
          lastUpdatedAt = json.data.updated_at || json.data.created_at;
        }
      } else {
        triggerToast(json?.error || 'Error al guardar los datos operativos', 'error');
      }
    } catch (err) {
      console.error('Error al guardar datos:', err);
      triggerToast(`Error de conexión: ${err.message}`, 'error');
    } finally {
      isSaving = false;
    }
  }

  // Contar cuántas secciones están completadas
  $: totalSecciones = 6;
  $: seccionesCompletadas = [
    Boolean(aperturaSalaInicio || aperturaSalaFin),
    Boolean(aperturaMaquinasInicio || aperturaMaquinasFin),
    Boolean(aperturaBingoInicio || aperturaBingoFin),
    Boolean(retirosDropboxInicio || retirosDropboxFin),
    Boolean(conteoDropboxInicio || conteoDropboxFin),
    Boolean(operadorTurnoA || operadorTurnoC)
  ].filter(Boolean).length;
</script>

<div class="datos-grid">
  <!-- Tarjeta Izquierda: Formulario "Datos" -->
  <div class="card-form-datos">
    <div class="card-title-box">
      <h3 class="card-title">Datos Operativos</h3>
      <div class="title-underline"></div>
    </div>

    <form on:submit|preventDefault={handleGuardar} class="datos-form">
      <!-- 1. Apertura de Sala -->
      <div class="form-section-box">
        <div class="section-label-header">
          <span class="section-title">🏛️ Apertura de Sala</span>
        </div>
        <div class="time-dual-row">
          <div class="time-col">
            <div class="col-header-mini">
              <label for="sala-inicio" class="mini-label">Hora Inicio:</label>
              <button 
                type="button" 
                class="btn-mini-now" 
                on:click={() => aperturaSalaInicio = getCurrentTimeString()}
                title="Poner hora actual"
              >⚡ Ahora</button>
            </div>
            <input 
              id="sala-inicio" 
              type="time" 
              class="form-time-input" 
              bind:value={aperturaSalaInicio} 
            />
          </div>
          <div class="time-col">
            <div class="col-header-mini">
              <label for="sala-fin" class="mini-label">Hora Fin:</label>
              <button 
                type="button" 
                class="btn-mini-now" 
                on:click={() => aperturaSalaFin = getCurrentTimeString()}
                title="Poner hora actual"
              >⚡ Ahora</button>
            </div>
            <input 
              id="sala-fin" 
              type="time" 
              class="form-time-input" 
              bind:value={aperturaSalaFin} 
            />
          </div>
        </div>
      </div>

      <!-- 2. Apertura de Máquinas -->
      <div class="form-section-box">
        <div class="section-label-header">
          <span class="section-title">🎰 Apertura de Máquinas</span>
        </div>
        <div class="time-dual-row">
          <div class="time-col">
            <div class="col-header-mini">
              <label for="maq-inicio" class="mini-label">Hora Inicio:</label>
              <button 
                type="button" 
                class="btn-mini-now" 
                on:click={() => aperturaMaquinasInicio = getCurrentTimeString()}
                title="Poner hora actual"
              >⚡ Ahora</button>
            </div>
            <input 
              id="maq-inicio" 
              type="time" 
              class="form-time-input" 
              bind:value={aperturaMaquinasInicio} 
            />
          </div>
          <div class="time-col">
            <div class="col-header-mini">
              <label for="maq-fin" class="mini-label">Hora Fin:</label>
              <button 
                type="button" 
                class="btn-mini-now" 
                on:click={() => aperturaMaquinasFin = getCurrentTimeString()}
                title="Poner hora actual"
              >⚡ Ahora</button>
            </div>
            <input 
              id="maq-fin" 
              type="time" 
              class="form-time-input" 
              bind:value={aperturaMaquinasFin} 
            />
          </div>
        </div>
      </div>

      <!-- 3. Apertura de Bingo -->
      <div class="form-section-box">
        <div class="section-label-header">
          <span class="section-title">🎱 Apertura de Bingo</span>
        </div>
        <div class="time-dual-row">
          <div class="time-col">
            <div class="col-header-mini">
              <label for="bingo-inicio" class="mini-label">Hora Inicio:</label>
              <button 
                type="button" 
                class="btn-mini-now" 
                on:click={() => aperturaBingoInicio = getCurrentTimeString()}
                title="Poner hora actual"
              >⚡ Ahora</button>
            </div>
            <input 
              id="bingo-inicio" 
              type="time" 
              class="form-time-input" 
              bind:value={aperturaBingoInicio} 
            />
          </div>
          <div class="time-col">
            <div class="col-header-mini">
              <label for="bingo-fin" class="mini-label">Hora Fin:</label>
              <button 
                type="button" 
                class="btn-mini-now" 
                on:click={() => aperturaBingoFin = getCurrentTimeString()}
                title="Poner hora actual"
              >⚡ Ahora</button>
            </div>
            <input 
              id="bingo-fin" 
              type="time" 
              class="form-time-input" 
              bind:value={aperturaBingoFin} 
            />
          </div>
        </div>
      </div>

      <!-- 4. Retiros de Dropbox -->
      <div class="form-section-box">
        <div class="section-label-header">
          <span class="section-title">📦 Retiros de Dropbox</span>
        </div>
        <div class="time-dual-row">
          <div class="time-col">
            <div class="col-header-mini">
              <label for="retiro-inicio" class="mini-label">Hora Inicio:</label>
              <button 
                type="button" 
                class="btn-mini-now" 
                on:click={() => retirosDropboxInicio = getCurrentTimeString()}
                title="Poner hora actual"
              >⚡ Ahora</button>
            </div>
            <input 
              id="retiro-inicio" 
              type="time" 
              class="form-time-input" 
              bind:value={retirosDropboxInicio} 
            />
          </div>
          <div class="time-col">
            <div class="col-header-mini">
              <label for="retiro-fin" class="mini-label">Hora Fin:</label>
              <button 
                type="button" 
                class="btn-mini-now" 
                on:click={() => retirosDropboxFin = getCurrentTimeString()}
                title="Poner hora actual"
              >⚡ Ahora</button>
            </div>
            <input 
              id="retiro-fin" 
              type="time" 
              class="form-time-input" 
              bind:value={retirosDropboxFin} 
            />
          </div>
        </div>
      </div>

      <!-- 5. Conteo Dropbox -->
      <div class="form-section-box">
        <div class="section-label-header">
          <span class="section-title">💰 Conteo Dropbox</span>
        </div>
        <div class="time-dual-row">
          <div class="time-col">
            <div class="col-header-mini">
              <label for="conteo-inicio" class="mini-label">Hora Inicio:</label>
              <button 
                type="button" 
                class="btn-mini-now" 
                on:click={() => conteoDropboxInicio = getCurrentTimeString()}
                title="Poner hora actual"
              >⚡ Ahora</button>
            </div>
            <input 
              id="conteo-inicio" 
              type="time" 
              class="form-time-input" 
              bind:value={conteoDropboxInicio} 
            />
          </div>
          <div class="time-col">
            <div class="col-header-mini">
              <label for="conteo-fin" class="mini-label">Hora Fin:</label>
              <button 
                type="button" 
                class="btn-mini-now" 
                on:click={() => conteoDropboxFin = getCurrentTimeString()}
                title="Poner hora actual"
              >⚡ Ahora</button>
            </div>
            <input 
              id="conteo-fin" 
              type="time" 
              class="form-time-input" 
              bind:value={conteoDropboxFin} 
            />
          </div>
        </div>
      </div>

      <!-- 6. Operadores CECOM -->
      <div class="form-section-box">
        <div class="section-label-header">
          <span class="section-title">👥 Operadores CECOM</span>
        </div>
        <div class="time-dual-row">
          <div class="time-col">
            <label for="operador-a" class="mini-label">Turno A (Apertura):</label>
            <input 
              id="operador-a" 
              type="text" 
              list="empleados-cecom-list"
              class="form-text-input" 
              placeholder="Operador de Apertura..."
              bind:value={operadorTurnoA} 
            />
          </div>
          <div class="time-col">
            <label for="operador-c" class="mini-label">Turno C (Cierre):</label>
            <input 
              id="operador-c" 
              type="text" 
              list="empleados-cecom-list"
              class="form-text-input" 
              placeholder="Operador de Cierre..."
              bind:value={operadorTurnoC} 
            />
          </div>
        </div>
        <datalist id="empleados-cecom-list">
          {#each listaEmpleados as emp}
            <option value={emp}></option>
          {/each}
        </datalist>
      </div>

      <!-- Botón Guardar Verde -->
      <button 
        type="submit" 
        class="btn-guardar"
        disabled={isSaving || isLoadingData}
      >
        {#if isSaving}
          <div class="spinner-inline"></div>
          <span>Guardando...</span>
        {:else}
          <span>Guardar Registro</span>
        {/if}
      </button>
    </form>
  </div>

  <!-- Tarjeta Derecha: Resumen de Horarios y Cronograma Operativo -->
  <div class="datos-right-column">
    <!-- Barra Superior Oscura con Sala y Fecha -->
    <div class="table-top-bar">
      <div class="top-bar-content">
        <span class="top-bar-title">{tableHeaderTitle}</span>
        <div class="top-bar-badge">
          {#if seccionesCompletadas === totalSecciones}
            <span class="badge-status complete">✓ Completo ({seccionesCompletadas}/{totalSecciones})</span>
          {:else if seccionesCompletadas > 0}
            <span class="badge-status partial">⚡ En Progreso ({seccionesCompletadas}/{totalSecciones})</span>
          {:else}
            <span class="badge-status pending">Pendiente de registro</span>
          {/if}
        </div>
      </div>
    </div>

    <!-- Bloque de Métricas Rápidas -->
    <div class="metrics-cards-grid">
      <!-- Métrica 1: Apertura Sala -->
      <div class="metric-card">
        <div class="mc-header">
          <span class="mc-icon">🏛️</span>
          <span class="mc-title">Apertura de Sala</span>
        </div>
        <div class="mc-value-box">
          {#if aperturaSalaInicio || aperturaSalaFin}
            <span class="mc-time-range">{aperturaSalaInicio || '—'} a {aperturaSalaFin || '—'}</span>
          {:else}
            <span class="mc-empty-txt">No registrado</span>
          {/if}
        </div>
      </div>

      <!-- Métrica 2: Máquinas -->
      <div class="metric-card">
        <div class="mc-header">
          <span class="mc-icon">🎰</span>
          <span class="mc-title">Máquinas</span>
        </div>
        <div class="mc-value-box">
          {#if aperturaMaquinasInicio || aperturaMaquinasFin}
            <span class="mc-time-range">{aperturaMaquinasInicio || '—'} a {aperturaMaquinasFin || '—'}</span>
          {:else}
            <span class="mc-empty-txt">No registrado</span>
          {/if}
        </div>
      </div>

      <!-- Métrica 3: Bingo -->
      <div class="metric-card">
        <div class="mc-header">
          <span class="mc-icon">🎱</span>
          <span class="mc-title">Bingo</span>
        </div>
        <div class="mc-value-box">
          {#if aperturaBingoInicio || aperturaBingoFin}
            <span class="mc-time-range">{aperturaBingoInicio || '—'} a {aperturaBingoFin || '—'}</span>
          {:else}
            <span class="mc-empty-txt">No registrado</span>
          {/if}
        </div>
      </div>

      <!-- Métrica 4: Dropbox -->
      <div class="metric-card">
        <div class="mc-header">
          <span class="mc-icon">📦</span>
          <span class="mc-title">Dropbox (Retiro/Conteo)</span>
        </div>
        <div class="mc-value-box">
          {#if retirosDropboxInicio || conteoDropboxInicio}
            <span class="mc-time-range">R: {retirosDropboxInicio || '—'} | C: {conteoDropboxInicio || '—'}</span>
          {:else}
            <span class="mc-empty-txt">No registrado</span>
          {/if}
        </div>
      </div>
    </div>

    <!-- Tabla Detallada de Horarios Operativos de la Jornada -->
    <div class="card-table-datos">
      <div class="table-wrapper">
        <table class="datos-table">
          <thead>
            <tr>
              <th class="th-center th-num">N°</th>
              <th class="th-left th-actividad">Actividad / Operación</th>
              <th class="th-center th-hora">Hora Inicio</th>
              <th class="th-center th-hora">Hora Fin</th>
              <th class="th-center th-estado">Estado</th>
            </tr>
          </thead>
          <tbody>
            <!-- 1. Apertura de Sala -->
            <tr class="datos-row">
              <td class="td-center td-num">1</td>
              <td class="td-left td-name">
                <span class="item-icon">🏛️</span>
                <strong>Apertura de Sala</strong>
              </td>
              <td class="td-center">
                {#if aperturaSalaInicio}
                  <span class="badge-hora">{aperturaSalaInicio}</span>
                {:else}
                  <span class="badge-vacio">—</span>
                {/if}
              </td>
              <td class="td-center">
                {#if aperturaSalaFin}
                  <span class="badge-hora">{aperturaSalaFin}</span>
                {:else}
                  <span class="badge-vacio">—</span>
                {/if}
              </td>
              <td class="td-center">
                {#if aperturaSalaInicio && aperturaSalaFin}
                  <span class="status-pill ok">Completado</span>
                {:else if aperturaSalaInicio}
                  <span class="status-pill active">En sala</span>
                {:else}
                  <span class="status-pill wait">Pendiente</span>
                {/if}
              </td>
            </tr>

            <!-- 2. Apertura de Máquinas -->
            <tr class="datos-row">
              <td class="td-center td-num">2</td>
              <td class="td-left td-name">
                <span class="item-icon">🎰</span>
                <strong>Apertura de Máquinas</strong>
              </td>
              <td class="td-center">
                {#if aperturaMaquinasInicio}
                  <span class="badge-hora">{aperturaMaquinasInicio}</span>
                {:else}
                  <span class="badge-vacio">—</span>
                {/if}
              </td>
              <td class="td-center">
                {#if aperturaMaquinasFin}
                  <span class="badge-hora">{aperturaMaquinasFin}</span>
                {:else}
                  <span class="badge-vacio">—</span>
                {/if}
              </td>
              <td class="td-center">
                {#if aperturaMaquinasInicio && aperturaMaquinasFin}
                  <span class="status-pill ok">Completado</span>
                {:else if aperturaMaquinasInicio}
                  <span class="status-pill active">Operando</span>
                {:else}
                  <span class="status-pill wait">Pendiente</span>
                {/if}
              </td>
            </tr>

            <!-- 3. Apertura de Bingo -->
            <tr class="datos-row">
              <td class="td-center td-num">3</td>
              <td class="td-left td-name">
                <span class="item-icon">🎱</span>
                <strong>Apertura de Bingo</strong>
              </td>
              <td class="td-center">
                {#if aperturaBingoInicio}
                  <span class="badge-hora">{aperturaBingoInicio}</span>
                {:else}
                  <span class="badge-vacio">—</span>
                {/if}
              </td>
              <td class="td-center">
                {#if aperturaBingoFin}
                  <span class="badge-hora">{aperturaBingoFin}</span>
                {:else}
                  <span class="badge-vacio">—</span>
                {/if}
              </td>
              <td class="td-center">
                {#if aperturaBingoInicio && aperturaBingoFin}
                  <span class="status-pill ok">Completado</span>
                {:else if aperturaBingoInicio}
                  <span class="status-pill active">En juego</span>
                {:else}
                  <span class="status-pill wait">Pendiente</span>
                {/if}
              </td>
            </tr>

            <!-- 4. Retiros de Dropbox -->
            <tr class="datos-row">
              <td class="td-center td-num">4</td>
              <td class="td-left td-name">
                <span class="item-icon">📦</span>
                <strong>Retiros de Dropbox</strong>
              </td>
              <td class="td-center">
                {#if retirosDropboxInicio}
                  <span class="badge-hora">{retirosDropboxInicio}</span>
                {:else}
                  <span class="badge-vacio">—</span>
                {/if}
              </td>
              <td class="td-center">
                {#if retirosDropboxFin}
                  <span class="badge-hora">{retirosDropboxFin}</span>
                {:else}
                  <span class="badge-vacio">—</span>
                {/if}
              </td>
              <td class="td-center">
                {#if retirosDropboxInicio && retirosDropboxFin}
                  <span class="status-pill ok">Completado</span>
                {:else if retirosDropboxInicio}
                  <span class="status-pill active">En retiro</span>
                {:else}
                  <span class="status-pill wait">Pendiente</span>
                {/if}
              </td>
            </tr>

            <!-- 5. Conteo Dropbox -->
            <tr class="datos-row">
              <td class="td-center td-num">5</td>
              <td class="td-left td-name">
                <span class="item-icon">💰</span>
                <strong>Conteo Dropbox</strong>
              </td>
              <td class="td-center">
                {#if conteoDropboxInicio}
                  <span class="badge-hora">{conteoDropboxInicio}</span>
                {:else}
                  <span class="badge-vacio">—</span>
                {/if}
              </td>
              <td class="td-center">
                {#if conteoDropboxFin}
                  <span class="badge-hora">{conteoDropboxFin}</span>
                {:else}
                  <span class="badge-vacio">—</span>
                {/if}
              </td>
              <td class="td-center">
                {#if conteoDropboxInicio && conteoDropboxFin}
                  <span class="status-pill ok">Completado</span>
                {:else if conteoDropboxInicio}
                  <span class="status-pill active">Contando</span>
                {:else}
                  <span class="status-pill wait">Pendiente</span>
                {/if}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Sección de Operadores CECOM Asignados -->
    <div class="card-operadores">
      <div class="operadores-header">
        <span class="op-icon">👥</span>
        <div>
          <h4 class="op-title">Operadores CECOM de la Jornada</h4>
          <span class="op-subtitle">Personal responsable registrado para el control y seguimiento operativo</span>
        </div>
      </div>
      <div class="operadores-grid">
        <div class="operador-item">
          <span class="op-turno-tag tag-a">Turno A</span>
          <div class="op-detail">
            <span class="op-name">{operadorTurnoA || 'No asignado'}</span>
            <span class="op-label">Apertura</span>
          </div>
        </div>
        <div class="operador-item">
          <span class="op-turno-tag tag-c">Turno C</span>
          <div class="op-detail">
            <span class="op-name">{operadorTurnoC || 'No asignado'}</span>
            <span class="op-label">Cierre</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .datos-grid {
    display: grid;
    grid-template-columns: 360px 1fr;
    gap: 24px;
    align-items: flex-start;
    width: 100%;
    box-sizing: border-box;
  }

  @media (max-width: 1024px) {
    .datos-grid {
      grid-template-columns: 1fr;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     Tarjeta Izquierda: Formulario
  ───────────────────────────────────────────────────────────── */
  .card-form-datos {
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

  .datos-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .form-section-box {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .section-label-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .section-title {
    font-size: 13px;
    font-weight: 700;
    color: #1e293b;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .time-dual-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .time-col {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .col-header-mini {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .mini-label {
    font-size: 11.5px;
    font-weight: 600;
    color: #475569;
  }

  .btn-mini-now {
    background: none;
    border: none;
    color: #2563eb;
    font-size: 10.5px;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
    transition: color 0.15s ease;
  }

  .btn-mini-now:hover {
    color: #1d4ed8;
    text-decoration: underline;
  }

  .form-time-input {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid #cbd5e1;
    border-radius: 5px;
    font-size: 13px;
    color: #0f172a;
    background-color: #ffffff;
    outline: none;
    box-sizing: border-box;
    transition: all 0.2s ease;
    font-family: inherit;
  }

  .form-time-input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .form-text-input {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 5px;
    font-size: 12.5px;
    color: #0f172a;
    background-color: #ffffff;
    outline: none;
    box-sizing: border-box;
    transition: all 0.2s ease;
  }

  .form-text-input:focus {
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
    gap: 8px;
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

  .spinner-inline {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ─────────────────────────────────────────────────────────────
     Columna Derecha: Tarjetas + Tabla
  ───────────────────────────────────────────────────────────── */
  .datos-right-column {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100%;
    min-width: 0;
  }

  /* Barra Superior Oscura */
  .table-top-bar {
    background: #54626f;
    color: #ffffff;
    border-radius: 8px;
    padding: 12px 18px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
  }

  .top-bar-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }

  .top-bar-title {
    font-size: 14.5px;
    font-weight: 700;
    letter-spacing: 0.3px;
  }

  .badge-status {
    font-size: 11.5px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 12px;
    letter-spacing: 0.2px;
  }

  .badge-status.complete {
    background: #10b981;
    color: #ffffff;
  }

  .badge-status.partial {
    background: #f59e0b;
    color: #ffffff;
  }

  .badge-status.pending {
    background: #64748b;
    color: #ffffff;
  }

  /* Tarjetas de Métricas */
  .metrics-cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
  }

  .metric-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 14px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .mc-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .mc-icon {
    font-size: 18px;
  }

  .mc-title {
    font-size: 12px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
  }

  .mc-value-box {
    display: flex;
    align-items: baseline;
  }

  .mc-time-range {
    font-size: 14.5px;
    font-weight: 700;
    color: #0f172a;
    font-variant-numeric: tabular-nums;
  }

  .mc-empty-txt {
    font-size: 13px;
    color: #94a3b8;
    font-style: italic;
  }

  /* Tabla de Horarios */
  .card-table-datos {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  }

  .table-wrapper {
    overflow-x: auto;
    width: 100%;
  }

  .datos-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    text-align: left;
  }

  .datos-table thead tr {
    background: #2b3544;
    color: #ffffff;
  }

  .datos-table th {
    padding: 12px 14px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.2px;
    white-space: nowrap;
  }

  .th-center { text-align: center; }
  .th-left { text-align: left; }
  .th-num { width: 50px; }
  .th-actividad { min-width: 220px; }
  .th-hora { width: 140px; }
  .th-estado { width: 140px; }

  .datos-row {
    border-bottom: 1px solid #f1f5f9;
    transition: background 0.15s ease;
  }

  .datos-row:hover {
    background: #f8fafc;
  }

  .td-center {
    text-align: center;
    padding: 12px 14px;
  }

  .td-left {
    text-align: left;
    padding: 12px 14px;
  }

  .td-name {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #1e293b;
  }

  .badge-hora {
    display: inline-block;
    padding: 4px 10px;
    background: #eff6ff;
    color: #1e40af;
    font-weight: 700;
    font-size: 12.5px;
    border-radius: 4px;
    border: 1px solid #bfdbfe;
    font-variant-numeric: tabular-nums;
  }

  .badge-vacio {
    color: #94a3b8;
    font-weight: 600;
  }

  .status-pill {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 12px;
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.2px;
  }

  .status-pill.ok {
    background: #dcfce7;
    color: #166534;
  }

  .status-pill.active {
    background: #fef3c7;
    color: #92400e;
  }

  .status-pill.wait {
    background: #f1f5f9;
    color: #64748b;
  }

  /* Tarjeta Operadores CECOM */
  .card-operadores {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 16px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .operadores-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .op-icon {
    font-size: 24px;
  }

  .op-title {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    color: #1e293b;
  }

  .op-subtitle {
    font-size: 11.5px;
    color: #64748b;
  }

  .operadores-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }

  @media (max-width: 600px) {
    .operadores-grid {
      grid-template-columns: 1fr;
    }
  }

  .operador-item {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px 14px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .op-turno-tag {
    font-size: 11.5px;
    font-weight: 800;
    padding: 4px 8px;
    border-radius: 4px;
    letter-spacing: 0.3px;
    white-space: nowrap;
  }

  .op-turno-tag.tag-a {
    background: #dbeafe;
    color: #1e40af;
    border: 1px solid #bfdbfe;
  }

  .op-turno-tag.tag-c {
    background: #f3e8ff;
    color: #6b21a8;
    border: 1px solid #e9d5ff;
  }

  .op-detail {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .op-name {
    font-size: 13.5px;
    font-weight: 700;
    color: #0f172a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .op-label {
    font-size: 11px;
    color: #64748b;
  }
</style>
