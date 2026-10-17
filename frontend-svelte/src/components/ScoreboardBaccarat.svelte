<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import { selectedSalaStore, userSalasStore } from '../controllers/auth.store.js';
  import { masterSalasStore, masterMesasStore } from '../controllers/master.store.js';
  import { navigateToRoute } from '../controllers/router.store.js';

  export let salaId = null;
  export let mesaId = null;
  export let isModal = false;
  const dispatch = createEventDispatcher();

  // Selected Sala Context
  $: currentSalaId = salaId || (() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0];
      const parts = hash.split('/').filter(Boolean);
      if (parts[0] === 'herramientas' && parts[1] === 'scoreboard-baccarat' && parts[2]) {
        return parts[2];
      }
      const sp = new URLSearchParams(window.location.search || window.location.hash.split('?')[1] || '');
      const s = sp.get('sala');
      if (s) return s;
    }
    return $selectedSalaStore;
  })();

  // Selected Mesa Context
  $: currentMesaId = mesaId || (() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0];
      const parts = hash.split('/').filter(Boolean);
      if (parts[0] === 'herramientas' && parts[1] === 'scoreboard-baccarat' && parts[3]) {
        return parts[3];
      }
      const sp = new URLSearchParams(window.location.search || window.location.hash.split('?')[1] || '');
      const m = sp.get('mesa');
      if (m) return m;
    }
    return null;
  })();

  $: currentSalaObj = (() => {
    const sId = currentSalaId || $selectedSalaStore;
    const all = $masterSalasStore || [];
    const found = all.find(s => String(s.uuid || s.id) === String(sId));
    if (found) return found;
    const authSalas = $userSalasStore || [];
    const foundAuth = authSalas.find(s => typeof s === 'object' && String(s.uuid || s.id) === String(sId));
    if (foundAuth) return foundAuth;
    return { id: sId, nombre: sId ? `Sala #${String(sId).slice(0, 8)}` : 'Sala Principal' };
  })();

  $: currentMesaObj = (() => {
    if (!currentMesaId) return null;
    const all = $masterMesasStore || [];
    const found = all.find(m => String(m.uuid || m.id) === String(currentMesaId));
    if (found) return found;
    return { id: currentMesaId, nombre: `Mesa #${String(currentMesaId).slice(0, 8)}` };
  })();

  $: currentSalaName = currentSalaObj?.nombre || currentSalaObj?.name || '';
  $: currentMesaName = currentMesaObj?.nombre || (currentMesaId ? `Mesa #${currentMesaId}` : 'Mesa 01');
  $: storageKey = `wisi_baccarat_shoe_v3_${currentSalaObj?.uuid || currentSalaObj?.id || 'default'}_${currentMesaObj?.uuid || currentMesaObj?.id || currentMesaId || 'default'}`;

  let lastLoadedStorageKey = null;
  $: if (storageKey && storageKey !== lastLoadedStorageKey) {
    lastLoadedStorageKey = storageKey;
    loadSavedShoe();
  }

  // Audio Context for tactile casino keypad sounds
  let audioCtx = null;

  function initAudio() {
    if (typeof window === 'undefined') return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext && !audioCtx) {
        audioCtx = new AudioContext();
      }
    } catch (e) {
      console.warn('AudioContext not supported', e);
    }
  }

  function playSound(type) {
    initAudio();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    try {
      const now = audioCtx.currentTime;
      if (type === 'click') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(450, now);
        osc.frequency.exponentialRampToValueAtTime(250, now + 0.04);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === 'win') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.setValueAtTime(880, now + 0.08); // A5
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.26);
      } else if (type === 'undo') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(160, now + 0.08);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.09);
      }
    } catch (e) {}
  }

  // Shoe State
  let shoeNumber = 1;
  let history = []; // [{ id, winner: 'PUNTO'|'BANCA'|'EMPATE', bPair, pPair, natural, special, time }]

  // Keypad Staging Modifiers & Score
  let activePPair = false;
  let activeBPair = false;
  let activeSpecial = false;
  let activeWin = false;
  let activeScore = null; // null | 0..9

  function selectScore(num) {
    playSound('click');
    if (activeScore === num) {
      activeScore = null;
    } else {
      activeScore = num;
    }
  }

  // Selected Hand for Editing
  let selectedHandIndex = null;
  $: selectedHand = selectedHandIndex !== null && history[selectedHandIndex] ? history[selectedHandIndex] : null;

  // Notification message
  let feedbackMessage = "";
  let feedbackTimer = null;

  function showFeedback(msg) {
    feedbackMessage = msg;
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      feedbackMessage = "";
    }, 3000);
  }

  // Grid dimensions for col-6 side-by-side roadmaps
  const BEAD_ROWS = 6;
  const BEAD_COLS = 18;
  const BIG_ROWS = 6;
  const BIG_COLS = 26;

  function loadSavedShoe() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.history)) history = parsed.history;
        if (parsed.shoeNumber) shoeNumber = parsed.shoeNumber;
      } else {
        history = [];
        shoeNumber = 1;
      }
    } catch (e) {
      console.warn('Error al cargar zapato guardado', e);
    }
  }

  function saveShoe() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        shoeNumber,
        history
      }));
    } catch (e) {}
  }

  onMount(() => {
    try {
      const hash = typeof window !== 'undefined' ? window.location.hash || '' : '';
      const qIdx = hash.indexOf('?');
      if (qIdx !== -1) {
        const params = new URLSearchParams(hash.slice(qIdx));
        const s = params.get('sala');
        if (s) {
          currentSalaId = s;
          selectedSalaStore.set(s);
        }
      }
    } catch (e) {}
    if (!currentSalaId) {
      currentSalaId = $selectedSalaStore;
    }
    loadSavedShoe();
  });

  // Derived Statistics
  $: totalHands = history.length;
  $: countBanca = history.filter(h => h.winner === 'BANCA').length;
  $: countPunto = history.filter(h => h.winner === 'PUNTO').length;
  $: countEmpate = history.filter(h => h.winner === 'EMPATE').length;
  $: countBPair = history.filter(h => h.bPair).length;
  $: countPPair = history.filter(h => h.pPair).length;
  $: countNatural = history.filter(h => h.natural).length;
  $: countSpecial = history.filter(h => h.special).length;

  $: pctBanca = totalHands > 0 ? ((countBanca / totalHands) * 100).toFixed(1) : '0.0';
  $: pctPunto = totalHands > 0 ? ((countPunto / totalHands) * 100).toFixed(1) : '0.0';
  $: pctEmpate = totalHands > 0 ? ((countEmpate / totalHands) * 100).toFixed(1) : '0.0';

  // Keypad Actions
  function togglePPair() {
    playSound('click');
    activePPair = !activePPair;
  }

  function toggleBPair() {
    playSound('click');
    activeBPair = !activeBPair;
  }

  function toggleSpecial() {
    playSound('click');
    activeSpecial = !activeSpecial;
  }

  function toggleWin() {
    playSound('click');
    activeWin = !activeWin;
  }

  function recordOutcome(winner) {
    playSound('win');
    const newRecord = {
      id: history.length + 1,
      winner,
      score: activeScore,
      bPair: activeBPair,
      pPair: activePPair,
      natural: activeWin,
      special: activeSpecial,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    history = [...history, newRecord];
    saveShoe();

    const wLabel = winner === 'BANCA' ? '🔴 BANCA' : winner === 'PUNTO' ? '🔵 PUNTO' : '🟢 EMPATE';
    const scoreLabel = activeScore !== null ? ` (${activeScore})` : '';
    const pairLabel = (activeBPair && activePPair) ? ' [Ambos Pares]' : activeBPair ? ' [B.Pair]' : activePPair ? ' [P.Pair]' : '';
    showFeedback(`Mano #${newRecord.id}: ${wLabel}${scoreLabel}${pairLabel} anotada`);

    // Reset modifier pills and score for the next hand
    activePPair = false;
    activeBPair = false;
    activeSpecial = false;
    activeWin = false;
    activeScore = null;
  }

  function undoLast() {
    if (history.length === 0) return;
    playSound('undo');
    const lastId = history[history.length - 1]?.id || history.length;
    history = history.slice(0, -1);
    if (selectedHandIndex >= history.length) {
      selectedHandIndex = null;
    }
    saveShoe();
    showFeedback(`Mano #${lastId} deshecha`);
  }

  // Modal de opciones y confirmación
  let isOptionsModalOpen = false;

  let confirmModalState = {
    isOpen: false,
    title: '',
    question: '',
    isDanger: true,
    confirmText: '',
    onConfirm: () => {}
  };

  function openOptionsMenu() {
    isOptionsModalOpen = true;
  }

  function closeOptionsMenu() {
    isOptionsModalOpen = false;
  }

  // Acción directa 1: Borrar Zapato #{shoeNumber}
  function handleDirectClearShoe() {
    playSound('undo');
    history = [];
    selectedHandIndex = null;
    saveShoe();
    showFeedback(`Registros del Zapato #${shoeNumber} borrados`);
    isOptionsModalOpen = false;
  }

  // Acción directa 2: Crear Nuevo Zapato #{shoeNumber + 1}
  function handleDirectNewShoe() {
    playSound('click');
    history = [];
    selectedHandIndex = null;
    shoeNumber += 1;
    saveShoe();
    showFeedback(`Nuevo Zapato #${shoeNumber} iniciado`);
    isOptionsModalOpen = false;
  }

  // Acción con confirmación 3: Borrar Todos los Registros de la Mesa
  function openResetAllModal() {
    confirmModalState = {
      isOpen: true,
      title: 'Borrar Todos los Registros',
      question: '¿Deseas borrar todos los registros de la mesa?',
      isDanger: true,
      confirmText: 'Borrar',
      onConfirm: handleConfirmResetAll
    };
  }

  function handleConfirmResetAll() {
    playSound('undo');
    history = [];
    selectedHandIndex = null;
    shoeNumber = 1;
    saveShoe();
    showFeedback('Todos los registros de la mesa han sido borrados');
    confirmModalState.isOpen = false;
    isOptionsModalOpen = false;
  }

  function closeConfirmModal() {
    confirmModalState.isOpen = false;
  }

  // Hand Selection & In-Place Editing
  function selectHand(idx) {
    playSound('click');
    if (idx === null || idx === undefined || idx < 0 || idx >= history.length) {
      selectedHandIndex = null;
      return;
    }
    if (selectedHandIndex === idx) {
      selectedHandIndex = null; // toggle off
    } else {
      selectedHandIndex = idx;
    }
  }

  function updateSelectedWinner(newWinner) {
    if (selectedHandIndex === null || !history[selectedHandIndex]) return;
    playSound('win');
    history[selectedHandIndex].winner = newWinner;
    history = [...history];
    saveShoe();
    showFeedback(`Mano #${history[selectedHandIndex].id} actualizada a ${newWinner}`);
  }

  function toggleSelectedMod(field) {
    if (selectedHandIndex === null || !history[selectedHandIndex]) return;
    playSound('click');
    history[selectedHandIndex][field] = !history[selectedHandIndex][field];
    history = [...history];
    saveShoe();
  }

  function updateSelectedScore(num) {
    if (selectedHandIndex === null || !history[selectedHandIndex]) return;
    playSound('click');
    history[selectedHandIndex].score = history[selectedHandIndex].score === num ? null : num;
    history = [...history];
    saveShoe();
  }

  function deleteSelectedHand() {
    if (selectedHandIndex === null || !history[selectedHandIndex]) return;
    const deletedId = history[selectedHandIndex].id;
    playSound('undo');
    history = history.filter((_, idx) => idx !== selectedHandIndex).map((h, i) => ({ ...h, id: i + 1 }));
    selectedHandIndex = null;
    saveShoe();
    showFeedback(`Mano #${deletedId} eliminada`);
  }

  function prevHand() {
    if (selectedHandIndex > 0) {
      playSound('click');
      selectedHandIndex--;
    }
  }

  function nextHand() {
    if (selectedHandIndex < history.length - 1) {
      playSound('click');
      selectedHandIndex++;
    }
  }

  // ROADMAP GENERATION (BEAD PLATE & BIG ROAD)
  $: beadGrid = (() => {
    const totalCols = Math.max(BEAD_COLS, Math.ceil(history.length / BEAD_ROWS) + 2);
    const grid = Array.from({ length: BEAD_ROWS }, () => Array(totalCols).fill(null));
    history.forEach((h, idx) => {
      const col = Math.floor(idx / BEAD_ROWS);
      const row = idx % BEAD_ROWS;
      if (col < totalCols) {
        grid[row][col] = { ...h, historyIndex: idx };
      }
    });
    return { grid, totalCols };
  })();

  $: bigRoadGrid = (() => {
    const totalCols = Math.max(BIG_COLS, 26);
    const grid = Array.from({ length: BIG_ROWS }, () => Array(totalCols).fill(null));

    let col = 0;
    let row = 0;
    let prevWinner = null;
    let lastPlaced = null;

    history.forEach((h, idx) => {
      if (h.winner === 'EMPATE') {
        if (lastPlaced) {
          lastPlaced.tieCount = (lastPlaced.tieCount || 0) + 1;
        } else {
          grid[0][0] = { ...h, historyIndex: idx, isTieOnly: true, tieCount: 1 };
          lastPlaced = grid[0][0];
        }
        return;
      }

      if (!prevWinner) {
        grid[0][0] = { ...h, historyIndex: idx, tieCount: 0 };
        lastPlaced = grid[0][0];
        prevWinner = h.winner;
        row = 1;
        col = 0;
      } else if (h.winner === prevWinner) {
        if (row < BIG_ROWS && !grid[row][col]) {
          grid[row][col] = { ...h, historyIndex: idx, tieCount: 0 };
          lastPlaced = grid[row][col];
          row++;
        } else {
          let dragonCol = col + 1;
          const dragonRow = row >= BIG_ROWS ? BIG_ROWS - 1 : row - 1;
          while (dragonCol < totalCols && grid[dragonRow][dragonCol]) {
            dragonCol++;
          }
          if (dragonCol < totalCols) {
            grid[dragonRow][dragonCol] = { ...h, historyIndex: idx, tieCount: 0 };
            lastPlaced = grid[dragonRow][dragonCol];
          }
        }
      } else {
        col++;
        while (col < totalCols && grid[0][col]) {
          col++;
        }
        row = 0;
        if (col < totalCols) {
          grid[0][col] = { ...h, historyIndex: idx, tieCount: 0 };
          lastPlaced = grid[0][col];
          row = 1;
        }
        prevWinner = h.winner;
      }
    });

    return { grid, totalCols };
  })();

  let isFullscreen = false;
  let rootElement;

  function toggleFullscreen() {
    if (!rootElement) return;
    if (!document.fullscreenElement) {
      rootElement.requestFullscreen?.().then(() => isFullscreen = true).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => isFullscreen = false).catch(() => {});
    }
  }

  function handleClose() {
    if (isFullscreen && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    const sId = currentSalaId || currentSalaObj?.uuid || currentSalaObj?.id;
    if (sId) {
      navigateToRoute(`herramientas/scoreboard-baccarat/${sId}`);
    } else {
      navigateToRoute('herramientas');
    }
    dispatch('close');
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      if (selectedHandIndex !== null) {
        selectedHandIndex = null;
        return;
      }
      if (isFullscreen && document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      } else {
        handleClose();
      }
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div
  bind:this={rootElement}
  class="scoreboard-container"
  class:fullscreen-mode={isFullscreen}
>
  <!-- TOP CASINO HEADER -->
  <header class="sb-header">
    <div class="sb-header-left">
      <div class="sb-pills-row">
        {#if currentSalaName}
          <div class="sb-shoe-pill sala-pill">
            <span class="pill-label">SALA</span>
            <span class="pill-value">{currentSalaName}</span>
          </div>
        {/if}

        {#if currentMesaName}
          <div class="sb-shoe-pill mesa-pill">
            <span class="pill-label">MESA</span>
            <span class="pill-value">{currentMesaName}</span>
          </div>
        {/if}

        <div class="sb-shoe-pill shoe-pill">
          <span class="pill-label">ZAPATO</span>
          <span class="pill-value">#{shoeNumber}</span>
          <span class="pill-sep">•</span>
          <span class="pill-label">MANOS</span>
          <span class="pill-value">#{totalHands}</span>
        </div>

        <!-- FULLSCREEN ICON BUTTON (SOLO EL ICONO) -->
        <button
          type="button"
          class="sb-icon-btn-fullscreen"
          class:active={isFullscreen}
          on:click={toggleFullscreen}
          title={isFullscreen ? 'Salir de Pantalla Completa' : 'Pantalla Completa'}
        >
          {#if isFullscreen}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
            </svg>
          {:else}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
            </svg>
          {/if}
        </button>

        {#if feedbackMessage}
          <div class="feedback-toast">
            {feedbackMessage}
          </div>
        {/if}
      </div>
    </div>

    <!-- BOTONES SUPERIORES SIN ICONOS -->
    <div class="sb-header-right">
      <button
        type="button"
        class="sb-btn sb-btn-options"
        on:click={openOptionsMenu}
        title="Opciones de la mesa y zapato"
      >
        Opciones
      </button>

      <button
        type="button"
        class="sb-btn sb-btn-back"
        on:click={handleClose}
        title="Volver a la lista de mesas de la sala"
      >
        Volver a Mesas
      </button>
    </div>
  </header>



  <!-- OFFICIAL CASINO ROADMAPS SECTION: COL-6 & COL-6 (SIDE BY SIDE) -->
  <section class="sb-roadmaps-grid-2col">
    <!-- COL-6 LEFT: BEAD PLATE (珠盘路) -->
    <div class="roadmap-card col-half">
      <div class="roadmap-header">
        <div class="rm-title">
          <span>●</span> BEAD PLATE (PLATO DE CUENTAS)
        </div>
        <div class="rm-legend">
          <span class="lg-b">🔴 B</span>
          <span class="lg-p">🔵 P</span>
          <span class="lg-t">🟢 T</span>
        </div>
      </div>

      <div class="grid-scrollable">
        <table class="bead-table">
          <tbody>
            {#each beadGrid.grid as row, rIdx}
              <tr>
                {#each row as cell, cIdx}
                  <td
                    class="bead-cell"
                    class:selected-cell={cell && cell.historyIndex === selectedHandIndex}
                    class:has-hand={!!cell}
                    on:click={() => cell && selectHand(cell.historyIndex)}
                    title={cell ? `Mano #${cell.id}: ${cell.winner}${cell.score !== undefined && cell.score !== null ? ` (${cell.score})` : ''}${cell.bPair ? ' [B.Pair]' : ''}${cell.pPair ? ' [P.Pair]' : ''} (Clic para editar)` : ''}
                  >
                    {#if cell}
                      <div
                        class="bead-circle {cell.winner.toLowerCase()}"
                        class:has-b-pair={cell.bPair}
                        class:has-p-pair={cell.pPair}
                      >
                        <span class="bead-letter" class:has-score={cell.score !== undefined && cell.score !== null}>
                          {cell.score !== undefined && cell.score !== null ? cell.score : (cell.winner === 'BANCA' ? 'B' : cell.winner === 'PUNTO' ? 'P' : 'T')}
                        </span>
                        {#if cell.bPair}
                          <span class="dot-b-pair" title="Par Banca"></span>
                        {/if}
                        {#if cell.pPair}
                          <span class="dot-p-pair" title="Par Punto"></span>
                        {/if}
                      </div>
                    {:else}
                      <div class="bead-empty"></div>
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <!-- COL-6 RIGHT: BIG ROAD (大路) -->
    <div class="roadmap-card col-half">
      <div class="roadmap-header">
        <div class="rm-title">
          <span>═</span> BIG ROAD (GRAN CAMINO)
        </div>
        <div class="rm-legend">
          <span class="rm-hint">Rachas y Tendencias</span>
        </div>
      </div>

      <div class="grid-scrollable">
        <table class="bigroad-table">
          <tbody>
            {#each bigRoadGrid.grid as row, rIdx}
              <tr>
                {#each row as cell, cIdx}
                  <td
                    class="bigroad-cell"
                    class:selected-cell={cell && cell.historyIndex === selectedHandIndex}
                    class:has-hand={!!cell}
                    on:click={() => cell && selectHand(cell.historyIndex)}
                    title={cell ? `Mano #${cell.id}: ${cell.winner}${cell.tieCount > 0 ? ` (+${cell.tieCount} Empates)` : ''} (Clic para editar)` : ''}
                  >
                    {#if cell}
                      <div
                        class="bigroad-ring {cell.winner.toLowerCase()}"
                        class:is-tie={cell.isTieOnly}
                      >
                        {#if cell.tieCount > 0}
                          <span class="bigroad-tie-slash"></span>
                          {#if cell.tieCount > 1}
                            <span class="tie-badge-num">{cell.tieCount}</span>
                          {/if}
                        {/if}
                        {#if cell.bPair}
                          <span class="dot-b-pair"></span>
                        {/if}
                        {#if cell.pPair}
                          <span class="dot-p-pair"></span>
                        {/if}
                      </div>
                    {:else}
                      <div class="bigroad-empty"></div>
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <!-- INLINE CELL EDIT TOOLBAR (En una sola línea) -->
  {#if selectedHandIndex !== null && selectedHand}
    <div class="edit-toolbar-box">
      <div class="edit-single-line">
        <span class="edit-badge">EDITANDO MANO #{selectedHand.id || (selectedHandIndex + 1)}</span>

        <div class="edit-group">
          <span class="edit-group-label">GANADOR:</span>
          <button
            type="button"
            class="edit-choice-btn punto"
            class:chosen={selectedHand.winner === 'PUNTO'}
            on:click={() => updateSelectedWinner('PUNTO')}
          >
            PUNTO
          </button>
          <button
            type="button"
            class="edit-choice-btn banca"
            class:chosen={selectedHand.winner === 'BANCA'}
            on:click={() => updateSelectedWinner('BANCA')}
          >
            BANCA
          </button>
          <button
            type="button"
            class="edit-choice-btn empate"
            class:chosen={selectedHand.winner === 'EMPATE'}
            on:click={() => updateSelectedWinner('EMPATE')}
          >
            EMPATE
          </button>
        </div>

        <div class="edit-group">
          <span class="edit-group-label">PARES Y ATRIBUTOS:</span>
          <button
            type="button"
            class="edit-pill-toggle pill-ppair"
            class:active-pill={selectedHand.pPair}
            on:click={() => toggleSelectedMod('pPair')}
          >
            P.Pair
          </button>
          <button
            type="button"
            class="edit-pill-toggle pill-bpair"
            class:active-pill={selectedHand.bPair}
            on:click={() => toggleSelectedMod('bPair')}
          >
            B.Pair
          </button>
          <button
            type="button"
            class="edit-pill-toggle pill-natural"
            class:active-pill={selectedHand.natural}
            on:click={() => toggleSelectedMod('natural')}
          >
            Natural
          </button>
        </div>

        <div class="edit-group">
          <span class="edit-group-label">VALOR:</span>
          {#each [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as num}
            <button
              type="button"
              class="edit-choice-btn edit-score-btn"
              class:chosen={selectedHand.score === num}
              on:click={() => updateSelectedScore(num)}
            >
              {num}
            </button>
          {/each}
        </div>

        <div class="edit-quick-actions">
          <button type="button" class="btn-tool-del" on:click={deleteSelectedHand} title="Borrar esta mano del zapato">
            Borrar
          </button>
          <button type="button" class="btn-tool-done" on:click={() => selectedHandIndex = null} title="Guardar cambios">
            Guardar
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- FOOTER OPERATIONAL PANEL: COL-4 STATS + COL-2 MODIFIERS + COL-6 MAIN ACTIONS -->
  <footer class="scoreboard-footer-panel">
    <!-- SECCIÓN 1 (COL-4): STATS INFO (CONTADORES Y PORCENTAJES) -->
    <div class="footer-stats-col">
      <div class="footer-counters-row">
        <!-- Total manos # -->
        <div class="counter-item">
          <div class="bead-circle-badge bead-gray">#</div>
          <div class="counter-digit">{totalHands}</div>
        </div>

        <!-- Banker B -->
        <div class="counter-item">
          <div class="bead-circle-badge bead-red">B</div>
          <div class="counter-digit">{countBanca}</div>
        </div>

        <!-- Player P -->
        <div class="counter-item">
          <div class="bead-circle-badge bead-blue">P</div>
          <div class="counter-digit">{countPunto}</div>
        </div>

        <!-- Tie T -->
        <div class="counter-item">
          <div class="bead-circle-badge bead-green">T</div>
          <div class="counter-digit">{countEmpate}</div>
        </div>

        <!-- Natural N -->
        <div class="counter-item" title="Victorias Naturales (8 ó 9 de mano)">
          <div class="bead-circle-badge bead-orange">N</div>
          <div class="counter-digit">{countNatural}</div>
        </div>

        <!-- Banker Pair -->
        <div class="counter-item" title="Parejas de Banca (B.Pair)">
          <div class="bead-circle-badge bead-white">
            <span class="bead-dot dot-tl red-dot"></span>
          </div>
          <div class="counter-digit">{countBPair}</div>
        </div>

        <!-- Player Pair -->
        <div class="counter-item" title="Parejas de Punto (P.Pair)">
          <div class="bead-circle-badge bead-white">
            <span class="bead-dot dot-br blue-dot"></span>
          </div>
          <div class="counter-digit">{countPPair}</div>
        </div>
      </div>

      <!-- Summary percentages -->
      <div class="footer-counter-pct-box">
        <span class="pct-tag b">B: {pctBanca}%</span>
        <span class="pct-tag p">P: {pctPunto}%</span>
        <span class="pct-tag t">T: {pctEmpate}%</span>
      </div>
    </div>

    <!-- GRUPO 2: TECLADO NUMÉRICO (0 AL 9 - VALOR/PUNTAJE COMODÍN) -->
    <div class="footer-score-col">
      <div class="score-keypad-box">
        <div class="score-keypad-grid">
          {#each [1, 2, 3, 4, 5, 6, 7, 8, 9] as num}
            <button
              type="button"
              class="btn-num-key btn-num-{num}"
              class:active={activeScore === num}
              on:click={() => selectScore(num)}
              title="Seleccionar valor {num} para la mano"
            >
              {num}
            </button>
          {/each}
          <!-- 0 al lado del 3, 6, 9 abarcando todo el largo de las 3 filas -->
          <button
            type="button"
            class="btn-num-key btn-num-zero"
            class:active={activeScore === 0}
            on:click={() => selectScore(0)}
            title="Seleccionar valor 0 para la mano"
          >
            0
          </button>
        </div>
      </div>
    </div>

    <!-- GRUPO 3: MODIFIERS APILADOS (P.PAIR, B.PAIR, NATURAL) -->
    <div class="footer-modifiers-col">
      <button
        type="button"
        class="keypad-pill pill-ppair"
        class:active={activePPair}
        on:click={togglePPair}
        title="Activar Pareja de Punto (P.Pair)"
      >
        P.Pair
      </button>

      <button
        type="button"
        class="keypad-pill pill-bpair"
        class:active={activeBPair}
        on:click={toggleBPair}
        title="Activar Pareja de Banca (B.Pair)"
      >
        B.Pair
      </button>

      <button
        type="button"
        class="keypad-pill pill-win"
        class:active={activeWin}
        on:click={toggleWin}
        title="Activar Victoria Natural (8 ó 9)"
      >
        Natural
      </button>
    </div>

    <!-- GRUPO 3 (COL-4): RESULTADOS (PUNTO, BANCA, EMPATE) -->
    <div class="footer-outcomes-col">
      <div class="outcomes-grid-3col">
        <!-- PUNTO BUTTON -->
        <div class="action-btn-item">
          <button
            type="button"
            class="keypad-btn-circle btn-punto"
            on:click={() => recordOutcome('PUNTO')}
            title="Registrar victoria de PUNTO (Player)"
          >
            {#if activeBPair}
              <span class="badge-corner-tl" title="B.Pair activo"></span>
            {/if}
            {#if activePPair}
              <span class="badge-corner-br" title="P.Pair activo"></span>
            {/if}
            <div class="btn-inner-gloss">
              <span class="btn-letter">P</span>
            </div>
          </button>
          <span class="btn-caption punto-caption">PUNTO</span>
        </div>

        <!-- BANCA BUTTON -->
        <div class="action-btn-item">
          <button
            type="button"
            class="keypad-btn-circle btn-banca"
            on:click={() => recordOutcome('BANCA')}
            title="Registrar victoria de BANCA (Banker)"
          >
            {#if activeBPair}
              <span class="badge-corner-tl" title="B.Pair activo"></span>
            {/if}
            {#if activePPair}
              <span class="badge-corner-br" title="P.Pair activo"></span>
            {/if}
            <div class="btn-inner-gloss">
              <span class="btn-letter">B</span>
            </div>
          </button>
          <span class="btn-caption banca-caption">BANCA</span>
        </div>

        <!-- EMPATE BUTTON -->
        <div class="action-btn-item">
          <button
            type="button"
            class="keypad-btn-circle btn-tie"
            on:click={() => recordOutcome('EMPATE')}
            title="Registrar EMPATE (Tie)"
          >
            {#if activeBPair}
              <span class="badge-corner-tl" title="B.Pair activo"></span>
            {/if}
            {#if activePPair}
              <span class="badge-corner-br" title="P.Pair activo"></span>
            {/if}
            <div class="btn-inner-gloss">
              <span class="btn-letter">T</span>
            </div>
          </button>
          <span class="btn-caption tie-caption">EMPATE</span>
        </div>
      </div>
    </div>

    <!-- GRUPO 4 (COL-2): ACCIÓN RETROCEDER -->
    <div class="footer-undo-col">
      <div class="action-btn-item">
        <button
          type="button"
          class="keypad-btn-circle btn-undo"
          on:click={undoLast}
          disabled={history.length === 0}
          title="Retroceder / Deshacer última mano registrada"
        >
          <div class="btn-inner-gloss">
            <svg class="btn-arrow-icon" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5m0 0l6-6M5 12l6 6" />
            </svg>
          </div>
        </button>
        <span class="btn-caption undo-caption">RETROCEDER</span>
      </div>
    </div>
  </footer>

  <!-- MODAL DE OPCIONES DE MESA -->
  {#if isOptionsModalOpen}
    <div class="modal-backdrop">
      <div class="modal-container options-modal-container" on:click|stopPropagation>
        <div class="modal-header">
          <div class="modal-title">
            Opciones de Mesa
          </div>
          <button type="button" class="close-btn" on:click={closeOptionsMenu} title="Cerrar modal">✕</button>
        </div>

        <div class="modal-body options-modal-body">
          <div class="options-grid">
            <!-- COL-6: Borrar Registros del Zapato #{shoeNumber} (Acción directa) -->
            <button
              type="button"
              class="btn-opt col-6 btn-opt-clear"
              on:click={handleDirectClearShoe}
            >
              Borrar Registros del Zapato #{shoeNumber}
            </button>

            <!-- COL-6: Crear Nuevo Zapato #{shoeNumber + 1} (Acción directa) -->
            <button
              type="button"
              class="btn-opt col-6 btn-opt-new"
              on:click={handleDirectNewShoe}
            >
              Crear Nuevo Zapato #{shoeNumber + 1}
            </button>

            <!-- COL-12: Borrar Todos los Registros de la Mesa (Acción con confirmación) -->
            <button
              type="button"
              class="btn-opt col-12 btn-opt-reset"
              on:click={openResetAllModal}
            >
              Borrar Todos los Registros de la Mesa
            </button>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn-cancel" on:click={closeOptionsMenu}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- MODAL DE CONFIRMACIÓN DIRECTA (BORRAR TODOS LOS REGISTROS) -->
  {#if confirmModalState.isOpen}
    <div class="modal-backdrop modal-backdrop-confirm">
      <div class="modal-container" on:click|stopPropagation>
        <!-- Modal Header -->
        <div class="modal-header">
          <div class="modal-title">
            {confirmModalState.title}
          </div>
          <button type="button" class="close-btn" on:click={closeConfirmModal} title="Cerrar modal">✕</button>
        </div>

        <!-- Modal Body -->
        <div class="modal-body">
          <h4 class="question-text">
            {confirmModalState.question}
          </h4>
        </div>

        <!-- Modal Footer -->
        <div class="modal-footer">
          <button type="button" class="btn-cancel" on:click={closeConfirmModal}>
            Cancelar
          </button>
          <button 
            type="button" 
            class={confirmModalState.isDanger ? 'btn-confirm-danger' : 'btn-confirm-primary'} 
            on:click={confirmModalState.onConfirm}
          >
            {confirmModalState.confirmText}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .scoreboard-container {
    background: #090d16;
    color: #f8fafc;
    min-height: 100vh;
    width: 100%;
    box-sizing: border-box;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 18px;
  }

  .fullscreen-mode {
    position: fixed;
    inset: 0;
    z-index: 9999999;
    padding: 14px 20px;
    overflow-y: auto;
  }

  /* HEADER */
  .sb-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-wrap: wrap;
  }

  .sb-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .sb-pills-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .sb-shoe-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #1e293b;
    padding: 3px 9px;
    border-radius: 999px;
    border: 1px solid #334155;
    font-size: 11px;
  }

  .sala-pill {
    border-color: #3b82f6;
    background: rgba(37, 99, 235, 0.18);
  }
  .sala-pill .pill-label { color: #93c5fd; }
  .sala-pill .pill-value { color: #ffffff; }

  .mesa-pill {
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.18);
  }
  .mesa-pill .pill-label { color: #6ee7b7; }
  .mesa-pill .pill-value { color: #ffffff; }

  .shoe-pill {
    border-color: #64748b;
  }

  .pill-label {
    color: #94a3b8;
    font-weight: 600;
    font-size: 10px;
  }

  .pill-value {
    color: #38bdf8;
    font-weight: 800;
  }

  .pill-sep {
    color: #475569;
  }

  /* ICONO PANTALLA COMPLETA AL LADO DE ZAPATO (SOLO EL ICONO) */
  .sb-icon-btn-fullscreen {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: #1e293b;
    border: 1.5px solid #0284c7;
    color: #38bdf8;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s ease;
    padding: 0;
  }
  .sb-icon-btn-fullscreen:hover {
    background: #0284c7;
    color: #ffffff;
    transform: scale(1.08);
  }
  .sb-icon-btn-fullscreen.active {
    background: #0284c7;
    color: #ffffff;
    border-color: #38bdf8;
    box-shadow: 0 0 10px rgba(56, 189, 248, 0.5);
  }

  .feedback-toast {
    background: #1e3a8a;
    border: 1px solid #3b82f6;
    color: #e0f2fe;
    font-size: 11px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 999px;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-3px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* BOTONES SUPERIORES SIN ICONOS */
  .sb-header-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .sb-btn {
    border: none;
    border-radius: 6px;
    padding: 7px 14px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
  }

  .sb-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .sb-btn-options {
    background: #1e293b;
    color: #f8fafc;
    border: 1px solid #475569;
  }
  .sb-btn-options:hover {
    background: #334155;
    color: #ffffff;
    border-color: #64748b;
  }

  .sb-btn-back {
    background: #1e293b;
    color: #ffffff;
    border: 1px solid #334155;
  }
  .sb-btn-back:hover {
    background: #334155;
  }

  /* CASINO BEAD COUNTERS STRIP (Exact Reference Spec) */
  .casino-bead-counters-strip {
    background: #ffffff;
    border-radius: 8px;
    padding: 6px 12px;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35);
    border: 1.5px solid #cbd5e1;
  }

  .counters-scroll {
    display: flex;
    align-items: center;
    gap: 12px;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .counter-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 34px;
  }

  .bead-circle-badge {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 900;
    color: #ffffff;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25), inset 0 2px 2px rgba(255, 255, 255, 0.6);
    position: relative;
    user-select: none;
  }

  .bead-gray { background: radial-gradient(circle at 35% 30%, #9ca3af, #4b5563); }
  .bead-red { background: radial-gradient(circle at 35% 30%, #ef4444, #b91c1c); }
  .bead-blue { background: radial-gradient(circle at 35% 30%, #3b82f6, #1d4ed8); }
  .bead-green { background: radial-gradient(circle at 35% 30%, #22c55e, #15803d); }
  .bead-orange { background: radial-gradient(circle at 35% 30%, #f97316, #c2410c); }
  
  .bead-white {
    background: radial-gradient(circle at 35% 30%, #ffffff, #e2e8f0);
    border: 2px solid #cbd5e1;
    color: #1e293b;
  }

  .bead-gold { background: radial-gradient(circle at 35% 30%, #facc15, #ca8a04); color: #000; font-size: 11px; }
  .bead-darkgreen { background: radial-gradient(circle at 35% 30%, #166534, #052e16); font-size: 11px; }
  .bead-darkred { background: radial-gradient(circle at 35% 30%, #991b1b, #450a0a); font-size: 11px; }
  .bead-lightblue { background: radial-gradient(circle at 35% 30%, #38bdf8, #0284c7); font-size: 11px; }
  .bead-navy { background: radial-gradient(circle at 35% 30%, #1d4ed8, #0f172a); font-size: 11px; }
  .bead-gold-flame { background: radial-gradient(circle at 35% 30%, #eab308, #713f12); color: #000; font-size: 11px; }
  .bead-orange-flame { background: radial-gradient(circle at 35% 30%, #f97316, #7c2d12); font-size: 11px; }

  .bead-dot {
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1.5px solid #ffffff;
  }
  .dot-tl.red-dot {
    top: 1px;
    left: 1px;
    background: #ef4444;
  }
  .dot-br.blue-dot {
    bottom: 1px;
    right: 1px;
    background: #2563eb;
  }

  .counter-digit {
    font-size: 14px;
    font-weight: 900;
    color: #0f172a;
    line-height: 1;
  }

  .counter-pct-box {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    background: #f1f5f9;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid #e2e8f0;
  }

  .pct-tag {
    font-size: 11px;
    font-weight: 800;
  }
  .pct-tag.b { color: #dc2626; }
  .pct-tag.p { color: #2563eb; }
  .pct-tag.t { color: #16a34a; }

  /* ROADMAPS SECTION: COL-6 & COL-6 (SIDE BY SIDE) */
  .sb-roadmaps-grid-2col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    align-items: stretch;
    flex: 1;
  }

  @media (max-width: 960px) {
    .sb-roadmaps-grid-2col {
      grid-template-columns: 1fr;
    }
  }

  .col-half {
    min-width: 0;
  }

  .roadmap-card {
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 10px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .roadmap-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    font-weight: 800;
    color: #94a3b8;
    gap: 8px;
  }

  .rm-title {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #f1f5f9;
    font-size: 11.5px;
  }

  .rm-hint {
    font-size: 10px;
    color: #64748b;
  }

  .rm-legend {
    display: flex;
    gap: 8px;
    font-size: 10.5px;
    font-weight: 700;
  }
  .lg-b { color: #f87171; }
  .lg-p { color: #60a5fa; }
  .lg-t { color: #4ade80; }

  .grid-scrollable {
    overflow-x: auto;
    background: #020617;
    border: 1px solid #1e293b;
    border-radius: 6px;
    padding: 4px;
    flex: 1;
    display: flex;
    align-items: center;
  }

  /* BEAD TABLE */
  .bead-table, .bigroad-table {
    border-collapse: collapse;
    margin: 0 auto;
  }

  .bead-cell {
    width: 25px;
    height: 25px;
    border: 1px solid #1e293b;
    padding: 0;
    text-align: center;
    vertical-align: middle;
    transition: background 0.15s ease;
  }

  .bead-cell.has-hand {
    cursor: pointer;
  }
  .bead-cell.has-hand:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  /* YELLOW HIGHLIGHT ON SELECTION (Exact Reference Image 5) */
  .bead-cell.selected-cell, .bigroad-cell.selected-cell {
    background: #ffc107 !important;
    outline: 2px solid #b45309;
    z-index: 5;
    position: relative;
    box-shadow: 0 0 10px rgba(255, 193, 7, 0.85);
  }

  .bead-circle {
    width: 21px;
    height: 21px;
    border-radius: 50%;
    margin: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    font-size: 10px;
    font-weight: 900;
    color: #ffffff;
    user-select: none;
  }

  .bead-circle.banca { background: #dc2626; }
  .bead-circle.punto { background: #2563eb; }
  .bead-circle.empate { background: #16a34a; }

  .bead-letter {
    font-size: 10px;
    font-weight: 900;
    line-height: 1;
  }
  .bead-letter.has-score {
    font-size: 11px;
    font-weight: 900;
  }

  .dot-b-pair {
    position: absolute;
    top: 1px;
    left: 1px;
    width: 5px;
    height: 5px;
    background: #ef4444;
    border: 1px solid #ffffff;
    border-radius: 50%;
  }

  .dot-p-pair {
    position: absolute;
    bottom: 1px;
    right: 1px;
    width: 5px;
    height: 5px;
    background: #3b82f6;
    border: 1px solid #ffffff;
    border-radius: 50%;
  }

  .bead-empty, .bigroad-empty {
    width: 21px;
    height: 21px;
  }

  /* BIG ROAD TABLE */
  .bigroad-cell {
    width: 21px;
    height: 21px;
    border: 1px solid #1e293b;
    padding: 0;
    text-align: center;
    vertical-align: middle;
    transition: background 0.15s ease;
  }

  .bigroad-cell.has-hand {
    cursor: pointer;
  }
  .bigroad-cell.has-hand:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .bigroad-ring {
    width: 17px;
    height: 17px;
    border-radius: 50%;
    margin: auto;
    border: 2px solid transparent;
    position: relative;
  }

  .bigroad-ring.banca {
    border-color: #ef4444;
  }
  .bigroad-ring.punto {
    border-color: #3b82f6;
  }
  .bigroad-ring.empate {
    border-color: #22c55e;
  }

  .bigroad-tie-slash {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 15px;
    height: 2px;
    background: #22c55e;
    transform: translate(-50%, -50%) rotate(45deg);
  }

  .tie-badge-num {
    position: absolute;
    top: -4px;
    right: -4px;
    background: #16a34a;
    color: #fff;
    font-size: 8px;
    font-weight: 900;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* INLINE EDIT TOOLBAR (En una sola línea) */
  .edit-toolbar-box {
    background: #0f172a;
    border: 1.5px solid #f59e0b;
    border-radius: 8px;
    padding: 6px 12px;
    display: flex;
    align-items: center;
    box-shadow: 0 0 16px rgba(245, 158, 11, 0.2);
    animation: slideDown 0.2s ease;
  }

  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .edit-single-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    flex-wrap: wrap;
  }

  .edit-badge {
    background: #f59e0b;
    color: #0f172a;
    font-size: 11px;
    font-weight: 900;
    padding: 3px 8px;
    border-radius: 5px;
    letter-spacing: 0.5px;
    white-space: nowrap;
  }

  .edit-quick-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .btn-tool-nav, .btn-tool-del, .btn-tool-done {
    border: none;
    border-radius: 5px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .btn-tool-nav {
    background: #1e293b;
    color: #cbd5e1;
    border: 1px solid #334155;
  }
  .btn-tool-nav:hover:not(:disabled) {
    background: #334155;
    color: #ffffff;
  }
  .btn-tool-nav:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-tool-del {
    background: #7f1d1d;
    color: #fee2e2;
  }
  .btn-tool-del:hover {
    background: #991b1b;
  }

  .btn-tool-done {
    background: #16a34a;
    color: #ffffff;
  }
  .btn-tool-done:hover {
    background: #22c55e;
  }

  .edit-group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .edit-group-label {
    font-size: 10px;
    font-weight: 800;
    color: #eab308;
    margin-right: 2px;
  }

  .edit-choice-btn {
    border: 1.5px solid transparent;
    border-radius: 6px;
    padding: 4px 12px;
    font-size: 11px;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.15s ease;
    opacity: 0.65;
    user-select: none;
  }

  .edit-choice-btn.punto {
    background: #1d4ed8;
    color: #ffffff;
    border-color: #3b82f6;
  }
  .edit-choice-btn.banca {
    background: #b91c1c;
    color: #ffffff;
    border-color: #ef4444;
  }
  .edit-choice-btn.empate {
    background: #15803d;
    color: #ffffff;
    border-color: #22c55e;
  }

  .edit-choice-btn.chosen {
    opacity: 1;
    transform: scale(1.06);
    box-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
    outline: 2px solid #ffffff;
  }

  .edit-choice-btn.edit-score-btn {
    min-width: 20px;
    padding: 3px 6px;
    font-size: 11px;
    background: #1e293b;
    color: #cbd5e1;
    border: 1px solid #334155;
  }
  .edit-choice-btn.edit-score-btn.chosen {
    background: radial-gradient(circle at 45% 35%, #fde047 0%, #eab308 60%, #ca8a04 100%);
    color: #000000;
    border-color: #a16207;
    font-weight: 900;
    outline: 1.5px solid #ffffff;
  }

  .edit-pill-toggle {
    background: #1e293b;
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 10.5px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
  }

  .edit-pill-toggle.pill-ppair {
    border: 1.5px solid #2563eb;
    color: #93c5fd;
    background: rgba(37, 99, 235, 0.18);
  }
  .edit-pill-toggle.pill-ppair.active-pill {
    background: #2563eb;
    color: #ffffff;
    border-color: #93c5fd;
    box-shadow: 0 0 8px rgba(37, 99, 235, 0.6);
  }

  .edit-pill-toggle.pill-bpair {
    border: 1.5px solid #dc2626;
    color: #fca5a5;
    background: rgba(220, 38, 38, 0.18);
  }
  .edit-pill-toggle.pill-bpair.active-pill {
    background: #dc2626;
    color: #ffffff;
    border-color: #fca5a5;
    box-shadow: 0 0 8px rgba(220, 38, 38, 0.6);
  }

  .edit-pill-toggle.pill-natural {
    border: 1.5px solid #ea580c;
    color: #fdba74;
    background: rgba(234, 88, 12, 0.18);
  }
  .edit-pill-toggle.pill-natural.active-pill {
    background: #ea580c;
    color: #ffffff;
    border-color: #fed7aa;
    box-shadow: 0 0 8px rgba(234, 88, 12, 0.6);
  }

  /* FOOTER OPERATIONAL PANEL: 5 GRUPOS (STATS, VALOR/KEYPAD, MODIFIERS, OUTCOMES, RETROCEDER) */
  .scoreboard-footer-panel {
    background: #ffffff;
    border-radius: 12px;
    padding: 10px 16px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
    border: 2px solid #e2e8f0;
    display: grid;
    grid-template-columns: minmax(240px, 3.2fr) minmax(130px, 2fr) minmax(110px, 1.7fr) minmax(260px, 3.7fr) minmax(95px, 1.4fr);
    gap: 14px;
    align-items: stretch;
    margin-top: auto;
  }

  /* GRUPO 1: STATS */
  .footer-stats-col {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 10px;
    padding: 6px 14px 6px 4px;
    border-right: 2px solid #cbd5e1;
    min-width: 0;
  }

  .footer-counters-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
  }

  .footer-counter-pct-box {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    background: #f1f5f9;
    padding: 6px 16px;
    border-radius: 999px;
    border: 1px solid #e2e8f0;
    font-size: 11.5px;
    font-weight: 800;
    margin-top: 6px;
    margin-bottom: 2px;
  }

  /* GRUPO 2: TECLADO NUMÉRICO (0 AL 9 - VALOR/PUNTAJE COMODÍN) */
  .footer-score-col {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding-right: 14px;
    border-right: 2px solid #cbd5e1;
    min-width: 0;
  }

  .score-keypad-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    max-width: 145px;
  }

  .score-keypad-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr) 1.25fr;
    grid-template-rows: repeat(3, 31px);
    grid-template-areas:
      "n1 n2 n3 n0"
      "n4 n5 n6 n0"
      "n7 n8 n9 n0";
    gap: 4px;
    width: 100%;
  }

  .btn-num-1 { grid-area: n1; }
  .btn-num-2 { grid-area: n2; }
  .btn-num-3 { grid-area: n3; }
  .btn-num-4 { grid-area: n4; }
  .btn-num-5 { grid-area: n5; }
  .btn-num-6 { grid-area: n6; }
  .btn-num-7 { grid-area: n7; }
  .btn-num-8 { grid-area: n8; }
  .btn-num-9 { grid-area: n9; }
  .btn-num-zero {
    grid-area: n0;
    height: 100%;
    font-size: 20px;
    font-weight: 900;
  }

  .btn-num-key {
    border-radius: 6px;
    border: 1.5px solid #cbd5e1;
    background: linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%);
    color: #0f172a;
    font-family: inherit;
    font-size: 15px;
    font-weight: 800;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    line-height: 1;
    transition: all 0.12s ease;
    user-select: none;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }

  .btn-num-key:hover:not(.active) {
    background: #e2e8f0;
    border-color: #94a3b8;
    transform: translateY(-1px);
  }

  .btn-num-key:active {
    transform: scale(0.95);
  }

  /* Activo: estilo brillante Casino Oro/Amarillo */
  .btn-num-key.active {
    background: radial-gradient(circle at 45% 35%, #fde047 0%, #eab308 60%, #ca8a04 100%);
    color: #000000;
    border-color: #a16207;
    box-shadow: 0 0 12px rgba(234, 179, 8, 0.8), inset 0 1px 1px rgba(255, 255, 255, 0.9);
    font-weight: 900;
    transform: scale(1.03);
    z-index: 2;
  }

  /* GRUPO 3: MODIFIERS APILADOS (P.PAIR, B.PAIR, NATURAL) + SEPARADOR SEÑALADO EN AZUL */
  .footer-modifiers-col {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 6px;
    padding-right: 14px;
    border-right: 2px solid #cbd5e1;
    min-width: 0;
  }

  .footer-modifiers-col .keypad-pill {
    width: 100%;
    max-width: 125px;
    height: 31px;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.3px;
    margin: 0 auto;
  }

  /* GRUPO 4: RESULTADOS PRINCIPALES (PUNTO, BANCA, EMPATE) + SEPARADOR CON RETROCEDER */
  .footer-outcomes-col {
    display: flex;
    justify-content: center;
    align-items: center;
    padding-right: 14px;
    border-right: 2px solid #cbd5e1;
    min-width: 0;
  }

  .outcomes-grid-3col {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 20px;
    width: 100%;
    max-width: 360px;
  }

  /* GRUPO 5: ACCIÓN RETROCEDER */
  .footer-undo-col {
    display: flex;
    justify-content: center;
    align-items: center;
    min-width: 0;
  }

  .action-btn-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  @media (max-width: 1024px) {
    .scoreboard-footer-panel {
      grid-template-columns: 1fr;
      gap: 14px;
    }
    .footer-stats-col, .footer-score-col, .footer-modifiers-col, .footer-outcomes-col {
      border-right: none;
      border-bottom: 2px solid #cbd5e1;
      padding-right: 0;
      padding-bottom: 12px;
    }
    .footer-modifiers-col {
      flex-direction: row;
      justify-content: center;
      gap: 8px;
    }
    .footer-modifiers-col .keypad-pill {
      max-width: 110px;
    }
  }

  @media (max-width: 600px) {
    .outcomes-grid-3col {
      gap: 10px;
    }
  }

  /* MODIFIER PILLS ROW */
  .keypad-pill {
    width: 100%;
    max-width: 110px;
    height: 38px;
    border-radius: 999px;
    background: #ffffff;
    font-family: inherit;
    font-size: 14px;
    font-weight: 800;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
    user-select: none;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
  }

  .keypad-pill:active {
    transform: scale(0.96);
  }

  .keypad-pill.pill-ppair {
    border: 2.5px solid #0000ff;
    color: #0000ff;
  }
  .keypad-pill.pill-ppair:hover:not(.active) {
    background: rgba(0, 0, 255, 0.06);
  }
  .keypad-pill.pill-ppair.active {
    background: radial-gradient(circle at 50% 30%, #1e40af, #0000cc);
    color: #ffffff;
    border-color: #0000aa;
    box-shadow: 0 0 12px rgba(0, 0, 255, 0.5);
  }

  .keypad-pill.pill-bpair {
    border: 2.5px solid #dc2626;
    color: #dc2626;
  }
  .keypad-pill.pill-bpair:hover:not(.active) {
    background: rgba(220, 38, 38, 0.06);
  }
  .keypad-pill.pill-bpair.active {
    background: radial-gradient(circle at 50% 30%, #ef4444, #990000);
    color: #ffffff;
    border-color: #880000;
    box-shadow: 0 0 12px rgba(220, 38, 38, 0.5);
  }

  .keypad-pill.pill-win {
    border: 2.5px solid #ea580c;
    color: #ea580c;
  }
  .keypad-pill.pill-win:hover:not(.active) {
    background: rgba(234, 88, 12, 0.06);
  }
  .keypad-pill.pill-win.active {
    background: radial-gradient(circle at 50% 30%, #f97316, #c2410c);
    color: #ffffff;
    border-color: #9a3412;
    box-shadow: 0 0 12px rgba(234, 88, 12, 0.5);
  }

  /* 3D CIRCULAR CASINO BUTTONS */
  .keypad-btn-circle {
    width: 78px;
    height: 78px;
    border-radius: 50%;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border: none;
    background: linear-gradient(145deg, #ffffff, #94a3b8, #cbd5e1);
    padding: 3.5px;
    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.35), inset 0 2px 2px rgba(255, 255, 255, 0.9);
    transition: transform 0.1s ease, box-shadow 0.1s ease;
    user-select: none;
  }

  @media (max-width: 600px) {
    .keypad-btn-circle {
      width: 62px;
      height: 62px;
    }
  }

  .keypad-btn-circle:hover {
    filter: brightness(1.05);
  }

  .keypad-btn-circle:active {
    transform: translateY(3px) scale(0.96);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  }

  .keypad-btn-circle:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .btn-inner-gloss {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    box-shadow: inset 0 4px 6px rgba(255, 255, 255, 0.5), inset 0 -4px 6px rgba(0, 0, 0, 0.4);
  }

  .btn-letter {
    font-size: 34px;
    font-weight: 900;
    color: #ffffff;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
    line-height: 1;
  }

  @media (max-width: 600px) {
    .btn-letter {
      font-size: 26px;
    }
  }

  /* P Button: Royal Blue */
  .btn-punto .btn-inner-gloss {
    background: radial-gradient(circle at 35% 30%, #3b82f6 0%, #1d4ed8 50%, #001f80 100%);
  }

  /* B Button: Crimson Red */
  .btn-banca .btn-inner-gloss {
    background: radial-gradient(circle at 35% 30%, #f87171 0%, #dc2626 50%, #7f1d1d 100%);
  }

  /* T Button: Emerald Green */
  .btn-tie .btn-inner-gloss {
    background: radial-gradient(circle at 35% 30%, #4ade80 0%, #16a34a 50%, #14532d 100%);
  }

  /* Undo Button: Amber / Gold */
  .btn-undo .btn-inner-gloss {
    background: radial-gradient(circle at 35% 30%, #fde047 0%, #eab308 50%, #854d0e 100%);
  }
  .btn-arrow-icon {
    width: 32px;
    height: 32px;
    display: block;
    color: #ffffff;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.65));
    transition: transform 0.1s ease;
  }

  @media (max-width: 600px) {
    .btn-arrow-icon {
      width: 25px;
      height: 25px;
    }
  }

  /* CORNER BADGES ON P, B, T */
  .badge-corner-tl {
    position: absolute;
    top: 0px;
    left: 0px;
    width: 19px;
    height: 19px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, #ff4d4d, #b91c1c);
    border: 2px solid #ffffff;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
    z-index: 10;
    animation: popBadge 0.15s ease-out;
  }

  .badge-corner-br {
    position: absolute;
    bottom: 0px;
    right: 0px;
    width: 19px;
    height: 19px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, #60a5fa, #1d4ed8);
    border: 2px solid #ffffff;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
    z-index: 10;
    animation: popBadge 0.15s ease-out;
  }

  @keyframes popBadge {
    0% { transform: scale(0.3); opacity: 0; }
    80% { transform: scale(1.15); }
    100% { transform: scale(1); opacity: 1; }
  }

  .btn-caption {
    font-size: 10.5px;
    font-weight: 800;
    letter-spacing: 0.5px;
    user-select: none;
  }
  .punto-caption { color: #2563eb; }
  .banca-caption { color: #dc2626; }
  .tie-caption { color: #16a34a; }
  .undo-caption { color: #854d0e; }

  /* MODAL DE CONFIRMACIÓN (ESTILO OFICIAL WISI) */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.7);
    backdrop-filter: blur(4px);
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .modal-container {
    background: #ffffff;
    border-radius: 12px;
    width: 100%;
    max-width: 400px;
    overflow: hidden;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2);
    border: 1px solid #e2e8f0;
    color: #0f172a;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: modalIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes modalIn {
    from {
      opacity: 0;
      transform: scale(0.95) translateY(8px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .modal-header {
    padding: 14px 20px;
    background: #fffbeb;
    border-bottom: 1px solid #fef3c7;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-title {
    font-size: 15px;
    font-weight: 800;
    color: #92400e;
    display: flex;
    align-items: center;
    gap: 8px;
    letter-spacing: -0.2px;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 16px;
    cursor: pointer;
    color: #92400e;
    padding: 4px 8px;
    border-radius: 4px;
    line-height: 1;
    transition: background 0.15s ease;
  }

  .close-btn:hover {
    background: #fef3c7;
  }

  .modal-body {
    padding: 24px 20px;
    display: flex;
    flex-direction: column;
  }

  .question-text {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: #1e293b;
    line-height: 1.45;
  }

  .modal-footer {
    padding: 12px 20px;
    background: #ffffff;
    border-top: 1px solid #f1f5f9;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
  }

  .btn-cancel {
    padding: 8px 20px;
    background: #64748b;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .btn-cancel:hover {
    background: #475569;
  }

  .btn-confirm-danger {
    padding: 8px 20px;
    background: #dc2626;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s ease;
    box-shadow: 0 2px 4px rgba(220, 38, 38, 0.2);
  }

  .btn-confirm-danger:hover {
    background: #b91c1c;
  }

  .btn-confirm-primary {
    padding: 8px 20px;
    background: #16a34a;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s ease;
    box-shadow: 0 2px 4px rgba(22, 163, 74, 0.2);
  }

  .btn-confirm-primary:hover {
    background: #15803d;
  }

  /* MODAL DE OPCIONES DE MESA */
  .options-modal-container {
    max-width: 480px;
  }

  .options-modal-body {
    padding: 20px;
  }

  .options-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    width: 100%;
    box-sizing: border-box;
  }

  .btn-opt {
    border: none;
    border-radius: 8px;
    padding: 15px 12px;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    line-height: 1.35;
    user-select: none;
  }

  .btn-opt.col-6 {
    /* Ocupa 1 columna de las 2 */
  }

  .btn-opt.col-12 {
    grid-column: 1 / -1;
  }

  .btn-opt-clear {
    background: #78350f;
    color: #fef3c7;
    border: 1.5px solid #b45309;
  }
  .btn-opt-clear:hover {
    background: #92400e;
    color: #ffffff;
    box-shadow: 0 4px 10px rgba(180, 83, 9, 0.35);
  }

  .btn-opt-new {
    background: #166534;
    color: #dcfce7;
    border: 1.5px solid #16a34a;
  }
  .btn-opt-new:hover {
    background: #15803d;
    color: #ffffff;
    box-shadow: 0 4px 10px rgba(22, 163, 74, 0.35);
  }

  .btn-opt-reset {
    background: #991b1b;
    color: #fee2e2;
    border: 1.5px solid #dc2626;
  }
  .btn-opt-reset:hover {
    background: #dc2626;
    color: #ffffff;
    box-shadow: 0 4px 10px rgba(220, 38, 38, 0.35);
  }

  .modal-backdrop-confirm {
    z-index: 1000000;
  }
</style>
