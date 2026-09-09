<script>
  import { onMount } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { masterSalasStore, masterEmpleadosStore, masterLibrosStore, loadMasterStoresFromBackend } from '../../controllers/master.store.js';

  export let libro = null;
  export let libroId = null;

  $: targetSalaId = Number(libro?.sala_id || ($masterLibrosStore || []).find(l => Number(l.id) === Number(libroId))?.sala_id);

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

  // Operadores
  let operadorTurnoA = '';
  let operadorTurnoC = '';
  let operadoresTurnoAList = [];
  let operadoresTurnoCList = [];

  // Inputs temporales para escribir/elegir operadores
  let inputTempOperadorA = '';
  let inputTempOperadorC = '';

  // Estados de dropdown de sugerencias visuales
  let showSugerenciasA = false;
  let selectedIndexA = -1;

  let showSugerenciasC = false;
  let selectedIndexC = -1;

  let isSaving = false;
  let isLoadingData = false;
  let recordId = null;
  let lastUpdatedAt = null;

  // Estado de autoguardado reactivo
  let autoSaveTimeout = null;
  let saveStatus = 'idle'; // 'idle' | 'saving' | 'saved'
  let saveStatusTimeout = null;

  // Encabezado superior: Roraima - 07/09/2026
  $: tableHeaderTitle = (() => {
    const salaName = libro?.sala_nombre || 
      ($masterSalasStore || []).find(s => Number(s.id) === Number(libro?.sala_id))?.nombre ||
      libro?.sala_nombre_comercial ||
      ($masterSalasStore || []).find(s => Number(s.id) === Number(libro?.sala_id))?.nombre_comercial || 'Sala';
    const dateFormatted = formatDateDisplay(libro?.descripcion);
    return `${salaName} - ${dateFormatted}`;
  })();

  // Sugerencias de empleados para operadores CECOM (filtrados por la sala del libro)
  $: listaEmpleados = ($masterEmpleadosStore || [])
    .filter(e => {
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

  // Sugerencias filtradas reactivas para Turno A
  $: sugerenciasFiltradasA = (() => {
    const q = (inputTempOperadorA || '').trim().toLowerCase();
    const disponibles = listaEmpleados.filter(emp => !operadoresTurnoAList.includes(emp.nombre));
    if (!q) return disponibles.slice(0, 10);
    return disponibles.filter(emp => matchEmpleado(emp, q)).slice(0, 10);
  })();

  // Sugerencias filtradas reactivas para Turno C
  $: sugerenciasFiltradasC = (() => {
    const q = (inputTempOperadorC || '').trim().toLowerCase();
    const disponibles = listaEmpleados.filter(emp => !operadoresTurnoCList.includes(emp.nombre));
    if (!q) return disponibles.slice(0, 10);
    return disponibles.filter(emp => matchEmpleado(emp, q)).slice(0, 10);
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

  function parseOperadores(val) {
    if (!val) return [];
    return String(val)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  // Disparar autoguardado con debounce para guardar al escribir o cambiar
  function triggerAutoSave() {
    if (isLoadingData) return;
    if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
      handleGuardar(true);
    }, 400);
  }

  // Funciones de Turno A
  function addOperadorA(val) {
    if (!val) return;
    const strVal = (typeof val === 'object' && val.nombre) ? val.nombre : String(val);
    const parts = strVal
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const current = [...operadoresTurnoAList];
    for (const p of parts) {
      if (!current.includes(p)) {
        current.push(p);
      }
    }
    operadoresTurnoAList = current;
    operadorTurnoA = operadoresTurnoAList.join(', ');
    inputTempOperadorA = '';
    showSugerenciasA = false;
    selectedIndexA = -1;
    triggerAutoSave();
  }

  function removeOperadorA(name) {
    operadoresTurnoAList = operadoresTurnoAList.filter(n => n !== name);
    operadorTurnoA = operadoresTurnoAList.join(', ');
    triggerAutoSave();
  }

  function onInputOperadorA() {
    showSugerenciasA = true;
    selectedIndexA = -1;
  }

  function onKeyDownOperadorA(e) {
    if (e.key === 'ArrowDown') {
      if (!showSugerenciasA) {
        showSugerenciasA = true;
        selectedIndexA = -1;
      }
      if (sugerenciasFiltradasA.length > 0) {
        e.preventDefault();
        selectedIndexA = (selectedIndexA + 1) % sugerenciasFiltradasA.length;
      }
    } else if (e.key === 'ArrowUp') {
      if (showSugerenciasA && sugerenciasFiltradasA.length > 0) {
        e.preventDefault();
        selectedIndexA = (selectedIndexA - 1 + sugerenciasFiltradasA.length) % sugerenciasFiltradasA.length;
      }
    } else if (e.key === 'Tab') {
      if (showSugerenciasA && sugerenciasFiltradasA.length > 0) {
        e.preventDefault();
        const match = selectedIndexA >= 0 ? sugerenciasFiltradasA[selectedIndexA] : sugerenciasFiltradasA[0];
        addOperadorA(match);
      } else if (inputTempOperadorA.trim()) {
        e.preventDefault();
        addOperadorA(inputTempOperadorA.trim());
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showSugerenciasA && selectedIndexA >= 0 && sugerenciasFiltradasA[selectedIndexA]) {
        addOperadorA(sugerenciasFiltradasA[selectedIndexA]);
      } else if (inputTempOperadorA.trim()) {
        addOperadorA(inputTempOperadorA.trim());
      }
    } else if (e.key === ',') {
      e.preventDefault();
      if (inputTempOperadorA.trim()) {
        addOperadorA(inputTempOperadorA.trim());
      }
    } else if (e.key === 'Escape') {
      showSugerenciasA = false;
      selectedIndexA = -1;
    }
  }

  function onBlurOperadorA() {
    setTimeout(() => {
      showSugerenciasA = false;
      selectedIndexA = -1;
      if (inputTempOperadorA.trim()) {
        addOperadorA(inputTempOperadorA.trim());
      }
    }, 200);
  }

  // Funciones de Turno C
  function addOperadorC(val) {
    if (!val) return;
    const strVal = (typeof val === 'object' && val.nombre) ? val.nombre : String(val);
    const parts = strVal
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const current = [...operadoresTurnoCList];
    for (const p of parts) {
      if (!current.includes(p)) {
        current.push(p);
      }
    }
    operadoresTurnoCList = current;
    operadorTurnoC = operadoresTurnoCList.join(', ');
    inputTempOperadorC = '';
    showSugerenciasC = false;
    selectedIndexC = -1;
    triggerAutoSave();
  }

  function removeOperadorC(name) {
    operadoresTurnoCList = operadoresTurnoCList.filter(n => n !== name);
    operadorTurnoC = operadoresTurnoCList.join(', ');
    triggerAutoSave();
  }

  function onInputOperadorC() {
    showSugerenciasC = true;
    selectedIndexC = -1;
  }

  function onKeyDownOperadorC(e) {
    if (e.key === 'ArrowDown') {
      if (!showSugerenciasC) {
        showSugerenciasC = true;
        selectedIndexC = -1;
      }
      if (sugerenciasFiltradasC.length > 0) {
        e.preventDefault();
        selectedIndexC = (selectedIndexC + 1) % sugerenciasFiltradasC.length;
      }
    } else if (e.key === 'ArrowUp') {
      if (showSugerenciasC && sugerenciasFiltradasC.length > 0) {
        e.preventDefault();
        selectedIndexC = (selectedIndexC - 1 + sugerenciasFiltradasC.length) % sugerenciasFiltradasC.length;
      }
    } else if (e.key === 'Tab') {
      if (showSugerenciasC && sugerenciasFiltradasC.length > 0) {
        e.preventDefault();
        const match = selectedIndexC >= 0 ? sugerenciasFiltradasC[selectedIndexC] : sugerenciasFiltradasC[0];
        addOperadorC(match);
      } else if (inputTempOperadorC.trim()) {
        e.preventDefault();
        addOperadorC(inputTempOperadorC.trim());
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showSugerenciasC && selectedIndexC >= 0 && sugerenciasFiltradasC[selectedIndexC]) {
        addOperadorC(sugerenciasFiltradasC[selectedIndexC]);
      } else if (inputTempOperadorC.trim()) {
        addOperadorC(inputTempOperadorC.trim());
      }
    } else if (e.key === ',') {
      e.preventDefault();
      if (inputTempOperadorC.trim()) {
        addOperadorC(inputTempOperadorC.trim());
      }
    } else if (e.key === 'Escape') {
      showSugerenciasC = false;
      selectedIndexC = -1;
    }
  }

  function onBlurOperadorC() {
    setTimeout(() => {
      showSugerenciasC = false;
      selectedIndexC = -1;
      if (inputTempOperadorC.trim()) {
        addOperadorC(inputTempOperadorC.trim());
      }
    }, 200);
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

          operadoresTurnoAList = parseOperadores(operadorTurnoA);
          operadoresTurnoCList = parseOperadores(operadorTurnoC);

          lastUpdatedAt = d.updated_at || d.created_at || null;
        } else {
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
          operadoresTurnoAList = [];
          operadoresTurnoCList = [];
          lastUpdatedAt = null;
        }
      }
    } catch (err) {
      console.error('Error al cargar datos operativos del libro:', err);
    } finally {
      isLoadingData = false;
    }
  }

  async function handleGuardar(silent = false) {
    const lId = libroId || libro?.id;
    if (!lId) {
      if (!silent) triggerToast('No se encontró el ID del libro', 'error');
      return;
    }

    if (inputTempOperadorA.trim()) {
      addOperadorA(inputTempOperadorA.trim());
    }
    if (inputTempOperadorC.trim()) {
      addOperadorC(inputTempOperadorC.trim());
    }

    isSaving = true;
    saveStatus = 'saving';
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
        operador_turno_a: operadoresTurnoAList.join(', '),
        operador_turno_c: operadoresTurnoCList.join(', ')
      };

      const res = await fetch(`/api/master/libros/${lId}/datos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (res.ok && json && json.success) {
        saveStatus = 'saved';
        if (!silent) {
          triggerToast('Datos operativos guardados correctamente', 'success');
        }
        if (json.data) {
          recordId = json.data.id;
          lastUpdatedAt = json.data.updated_at || json.data.created_at;
        }

        if (saveStatusTimeout) clearTimeout(saveStatusTimeout);
        saveStatusTimeout = setTimeout(() => {
          if (saveStatus === 'saved') saveStatus = 'idle';
        }, 2500);
      } else {
        saveStatus = 'idle';
        if (!silent) {
          triggerToast(json?.error || 'Error al guardar los datos operativos', 'error');
        }
      }
    } catch (err) {
      saveStatus = 'idle';
      console.error('Error al guardar datos:', err);
      if (!silent) {
        triggerToast(`Error de conexión: ${err.message}`, 'error');
      }
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
      <div class="card-title-row">
        <h3 class="card-title">Datos Operativos</h3>
        {#if saveStatus === 'saving'}
          <span class="autosave-tag saving">
            <span class="dot-spin"></span>
            Guardando...
          </span>
        {:else if saveStatus === 'saved'}
          <span class="autosave-tag saved">✓ Guardado</span>
        {/if}
      </div>
      <div class="title-underline"></div>
    </div>

    <form on:submit|preventDefault={() => handleGuardar(true)} class="datos-form">
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
                on:click={() => { aperturaSalaInicio = getCurrentTimeString(); triggerAutoSave(); }}
                title="Poner hora actual y guardar"
              >⚡ Ahora</button>
            </div>
            <input 
              id="sala-inicio" 
              type="time" 
              class="form-time-input" 
              bind:value={aperturaSalaInicio} 
              on:change={triggerAutoSave}
              on:blur={triggerAutoSave}
            />
          </div>
          <div class="time-col">
            <div class="col-header-mini">
              <label for="sala-fin" class="mini-label">Hora Fin:</label>
              <button 
                type="button" 
                class="btn-mini-now" 
                on:click={() => { aperturaSalaFin = getCurrentTimeString(); triggerAutoSave(); }}
                title="Poner hora actual y guardar"
              >⚡ Ahora</button>
            </div>
            <input 
              id="sala-fin" 
              type="time" 
              class="form-time-input" 
              bind:value={aperturaSalaFin} 
              on:change={triggerAutoSave}
              on:blur={triggerAutoSave}
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
                on:click={() => { aperturaMaquinasInicio = getCurrentTimeString(); triggerAutoSave(); }}
                title="Poner hora actual y guardar"
              >⚡ Ahora</button>
            </div>
            <input 
              id="maq-inicio" 
              type="time" 
              class="form-time-input" 
              bind:value={aperturaMaquinasInicio} 
              on:change={triggerAutoSave}
              on:blur={triggerAutoSave}
            />
          </div>
          <div class="time-col">
            <div class="col-header-mini">
              <label for="maq-fin" class="mini-label">Hora Fin:</label>
              <button 
                type="button" 
                class="btn-mini-now" 
                on:click={() => { aperturaMaquinasFin = getCurrentTimeString(); triggerAutoSave(); }}
                title="Poner hora actual y guardar"
              >⚡ Ahora</button>
            </div>
            <input 
              id="maq-fin" 
              type="time" 
              class="form-time-input" 
              bind:value={aperturaMaquinasFin} 
              on:change={triggerAutoSave}
              on:blur={triggerAutoSave}
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
                on:click={() => { aperturaBingoInicio = getCurrentTimeString(); triggerAutoSave(); }}
                title="Poner hora actual y guardar"
              >⚡ Ahora</button>
            </div>
            <input 
              id="bingo-inicio" 
              type="time" 
              class="form-time-input" 
              bind:value={aperturaBingoInicio} 
              on:change={triggerAutoSave}
              on:blur={triggerAutoSave}
            />
          </div>
          <div class="time-col">
            <div class="col-header-mini">
              <label for="bingo-fin" class="mini-label">Hora Fin:</label>
              <button 
                type="button" 
                class="btn-mini-now" 
                on:click={() => { aperturaBingoFin = getCurrentTimeString(); triggerAutoSave(); }}
                title="Poner hora actual y guardar"
              >⚡ Ahora</button>
            </div>
            <input 
              id="bingo-fin" 
              type="time" 
              class="form-time-input" 
              bind:value={aperturaBingoFin} 
              on:change={triggerAutoSave}
              on:blur={triggerAutoSave}
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
                on:click={() => { retirosDropboxInicio = getCurrentTimeString(); triggerAutoSave(); }}
                title="Poner hora actual y guardar"
              >⚡ Ahora</button>
            </div>
            <input 
              id="retiro-inicio" 
              type="time" 
              class="form-time-input" 
              bind:value={retirosDropboxInicio} 
              on:change={triggerAutoSave}
              on:blur={triggerAutoSave}
            />
          </div>
          <div class="time-col">
            <div class="col-header-mini">
              <label for="retiro-fin" class="mini-label">Hora Fin:</label>
              <button 
                type="button" 
                class="btn-mini-now" 
                on:click={() => { retirosDropboxFin = getCurrentTimeString(); triggerAutoSave(); }}
                title="Poner hora actual y guardar"
              >⚡ Ahora</button>
            </div>
            <input 
              id="retiro-fin" 
              type="time" 
              class="form-time-input" 
              bind:value={retirosDropboxFin} 
              on:change={triggerAutoSave}
              on:blur={triggerAutoSave}
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
                on:click={() => { conteoDropboxInicio = getCurrentTimeString(); triggerAutoSave(); }}
                title="Poner hora actual y guardar"
              >⚡ Ahora</button>
            </div>
            <input 
              id="conteo-inicio" 
              type="time" 
              class="form-time-input" 
              bind:value={conteoDropboxInicio} 
              on:change={triggerAutoSave}
              on:blur={triggerAutoSave}
            />
          </div>
          <div class="time-col">
            <div class="col-header-mini">
              <label for="conteo-fin" class="mini-label">Hora Fin:</label>
              <button 
                type="button" 
                class="btn-mini-now" 
                on:click={() => { conteoDropboxFin = getCurrentTimeString(); triggerAutoSave(); }}
                title="Poner hora actual y guardar"
              >⚡ Ahora</button>
            </div>
            <input 
              id="conteo-fin" 
              type="time" 
              class="form-time-input" 
              bind:value={conteoDropboxFin} 
              on:change={triggerAutoSave}
              on:blur={triggerAutoSave}
            />
          </div>
        </div>
      </div>

      <!-- 6. Operadores CECOM -->
      <div class="form-section-box">
        <div class="section-label-header">
          <span class="section-title">👥 Operadores CECOM</span>
        </div>
        <div class="operadores-dual-row">
          <!-- Turno A (Apertura) -->
          <div class="operador-input-col">
            <div class="col-header-mini">
              <label for="operador-a-input" class="mini-label">Turno A (Apertura):</label>
              {#if operadoresTurnoAList.length > 0}
                <span class="op-counter-mini">{operadoresTurnoAList.length}</span>
              {/if}
            </div>

            <div class="autocomplete-wrapper">
              <input 
                id="operador-a-input" 
                type="text" 
                class="form-text-input" 
                placeholder="Escriba o elija operador..."
                bind:value={inputTempOperadorA} 
                on:input={onInputOperadorA}
                on:keydown={onKeyDownOperadorA}
                on:blur={onBlurOperadorA}
                on:focus={onInputOperadorA}
                autocomplete="off"
              />

              <!-- Desplegable visual de sugerencias rápidas -->
              {#if showSugerenciasA && sugerenciasFiltradasA.length > 0}
                <div class="sugerencias-dropdown">
                  <div class="sugerencias-header">
                    <span>Sugerencias (Pulsa <b>Tab</b> o clic):</span>
                  </div>
                  <ul class="sugerencias-list">
                    {#each sugerenciasFiltradasA as sug, idx}
                      <!-- svelte-ignore a11y-click-events-have-key-events -->
                      <li 
                        class="sugerencia-item {idx === selectedIndexA ? 'active' : ''}"
                        on:mousedown|preventDefault={() => addOperadorA(sug)}
                      >
                        <span class="sug-icon">👤</span>
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

            <!-- Chips de Operadores Turno A abajito -->
            {#if operadoresTurnoAList.length > 0}
              <div class="chips-box">
                {#each operadoresTurnoAList as op}
                  <span class="op-chip chip-a">
                    <span class="chip-avatar">👤</span>
                    <span class="chip-text">{op}</span>
                    <button 
                      type="button" 
                      class="chip-del-btn" 
                      on:click={() => removeOperadorA(op)}
                      title="Quitar operador"
                    >×</button>
                  </span>
                {/each}
              </div>
            {/if}
          </div>

          <!-- Turno C (Cierre) -->
          <div class="operador-input-col">
            <div class="col-header-mini">
              <label for="operador-c-input" class="mini-label">Turno C (Cierre):</label>
              {#if operadoresTurnoCList.length > 0}
                <span class="op-counter-mini">{operadoresTurnoCList.length}</span>
              {/if}
            </div>

            <div class="autocomplete-wrapper">
              <input 
                id="operador-c-input" 
                type="text" 
                class="form-text-input" 
                placeholder="Escriba o elija operador..."
                bind:value={inputTempOperadorC} 
                on:input={onInputOperadorC}
                on:keydown={onKeyDownOperadorC}
                on:blur={onBlurOperadorC}
                on:focus={onInputOperadorC}
                autocomplete="off"
              />

              <!-- Desplegable visual de sugerencias rápidas -->
              {#if showSugerenciasC && sugerenciasFiltradasC.length > 0}
                <div class="sugerencias-dropdown">
                  <div class="sugerencias-header">
                    <span>Sugerencias (Pulsa <b>Tab</b> o clic):</span>
                  </div>
                  <ul class="sugerencias-list">
                    {#each sugerenciasFiltradasC as sug, idx}
                      <!-- svelte-ignore a11y-click-events-have-key-events -->
                      <li 
                        class="sugerencia-item {idx === selectedIndexC ? 'active' : ''}"
                        on:mousedown|preventDefault={() => addOperadorC(sug)}
                      >
                        <span class="sug-icon">👤</span>
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

            <!-- Chips de Operadores Turno C abajito -->
            {#if operadoresTurnoCList.length > 0}
              <div class="chips-box">
                {#each operadoresTurnoCList as op}
                  <span class="op-chip chip-c">
                    <span class="chip-avatar">👤</span>
                    <span class="chip-text">{op}</span>
                    <button 
                      type="button" 
                      class="chip-del-btn" 
                      on:click={() => removeOperadorC(op)}
                      title="Quitar operador"
                    >×</button>
                  </span>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>
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

      <!-- Métrica 4: Operadores CECOM -->
      <div class="metric-card">
        <div class="mc-header">
          <span class="mc-icon">👥</span>
          <span class="mc-title">Personal CECOM</span>
        </div>
        <div class="mc-value-box">
          {#if operadoresTurnoAList.length > 0 || operadoresTurnoCList.length > 0}
            <span class="mc-time-range">{operadoresTurnoAList.length + operadoresTurnoCList.length} en guardia</span>
          {:else}
            <span class="mc-empty-txt">No asignados</span>
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
          <div class="op-item-top">
            <span class="op-turno-tag tag-a">Turno A</span>
            <span class="op-label">Apertura ({operadoresTurnoAList.length})</span>
          </div>
          <div class="op-chips-display">
            {#if operadoresTurnoAList.length === 0}
              <span class="op-empty-name">No asignado</span>
            {:else}
              {#each operadoresTurnoAList as op}
                <span class="op-badge-view badge-a">👤 {op}</span>
              {/each}
            {/if}
          </div>
        </div>

        <div class="operador-item">
          <div class="op-item-top">
            <span class="op-turno-tag tag-c">Turno C</span>
            <span class="op-label">Cierre ({operadoresTurnoCList.length})</span>
          </div>
          <div class="op-chips-display">
            {#if operadoresTurnoCList.length === 0}
              <span class="op-empty-name">No asignado</span>
            {:else}
              {#each operadoresTurnoCList as op}
                <span class="op-badge-view badge-c">👤 {op}</span>
              {/each}
            {/if}
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

  .card-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .card-title {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    color: #1e293b;
    letter-spacing: -0.2px;
  }

  .autosave-tag {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 10px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    transition: all 0.2s ease;
  }

  .autosave-tag.saving {
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #fde68a;
  }

  .autosave-tag.saved {
    background: #dcfce7;
    color: #166534;
    border: 1px solid #bbf7d0;
  }

  .dot-spin {
    width: 8px;
    height: 8px;
    border: 1.5px solid #d97706;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
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

  /* Operadores CECOM */
  .operadores-dual-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .operador-input-col {
    display: flex;
    flex-direction: column;
    gap: 5px;
    position: relative;
  }

  .op-counter-mini {
    font-size: 10px;
    font-weight: 700;
    color: #2563eb;
    background: #eff6ff;
    padding: 1px 5px;
    border-radius: 8px;
    border: 1px solid #bfdbfe;
  }

  .autocomplete-wrapper {
    position: relative;
    width: 100%;
  }

  .form-text-input {
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

  .form-text-input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  /* Desplegable de Sugerencias Interactivas */
  .sugerencias-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    z-index: 100;
    overflow: hidden;
  }

  .sugerencias-header {
    background: #f8fafc;
    padding: 5px 10px;
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
    padding: 7px 10px;
    cursor: pointer;
    font-size: 12.5px;
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

  .sugerencia-item:hover .sug-cargo,
  .sugerencia-item.active .sug-cargo {
    color: #3b82f6;
  }

  .sug-text {
    flex: 1;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sug-tab-badge {
    font-size: 10px;
    background: #e2e8f0;
    color: #475569;
    padding: 2px 5px;
    border-radius: 3px;
    font-weight: 600;
  }

  .sugerencia-item.active .sug-tab-badge {
    background: #bfdbfe;
    color: #1e40af;
  }

  /* Chips de Operadores "abajito" */
  .chips-box {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 4px;
  }

  .op-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 700;
    max-width: 100%;
    box-sizing: border-box;
  }

  .op-chip.chip-a {
    background: #dbeafe;
    color: #1e40af;
    border: 1px solid #bfdbfe;
  }

  .op-chip.chip-c {
    background: #f3e8ff;
    color: #6b21a8;
    border: 1px solid #e9d5ff;
  }

  .chip-avatar {
    font-size: 11px;
  }

  .chip-text {
    max-width: 110px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chip-del-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 2px;
    color: inherit;
    opacity: 0.7;
    transition: opacity 0.1s ease;
  }

  .chip-del-btn:hover {
    opacity: 1;
    color: #dc2626;
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
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .op-item-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .op-turno-tag {
    font-size: 11.5px;
    font-weight: 800;
    padding: 3px 8px;
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

  .op-label {
    font-size: 11.5px;
    font-weight: 600;
    color: #64748b;
  }

  .op-chips-display {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 28px;
    align-items: center;
  }

  .op-badge-view {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12.5px;
    font-weight: 700;
  }

  .op-badge-view.badge-a {
    background: #eff6ff;
    color: #1e40af;
    border: 1px solid #bfdbfe;
  }

  .op-badge-view.badge-c {
    background: #faf5ff;
    color: #6b21a8;
    border: 1px solid #e9d5ff;
  }

  .op-empty-name {
    font-size: 13px;
    color: #94a3b8;
    font-style: italic;
  }
</style>
