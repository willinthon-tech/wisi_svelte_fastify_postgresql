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

  // Keypad Staging Modifiers
  let activePPair = false;
  let activeBPair = false;
  let activeSpecial = false;
  let activeWin = false;

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
      bPair: activeBPair,
      pPair: activePPair,
      natural: activeWin,
      special: activeSpecial,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    history = [...history, newRecord];
    saveShoe();

    const wLabel = winner === 'BANCA' ? '🔴 BANCA' : winner === 'PUNTO' ? '🔵 PUNTO' : '🟢 EMPATE';
    const pairLabel = (activeBPair && activePPair) ? ' [Ambos Pares]' : activeBPair ? ' [B.Pair]' : activePPair ? ' [P.Pair]' : '';
    showFeedback(`Mano #${newRecord.id}: ${wLabel}${pairLabel} anotada`);

    // Reset modifier pills for the next hand
    activePPair = false;
    activeBPair = false;
    activeSpecial = false;
    activeWin = false;
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

  // Modal de confirmación (Borrar Zapato / Nuevo Zapato)
  let confirmModalState = {
    isOpen: false,
    title: '',
    question: '',
    isDanger: true,
    confirmText: '',
    onConfirm: () => {}
  };

  function openClearShoeModal() {
    if (history.length === 0) return;
    confirmModalState = {
      isOpen: true,
      title: 'Borrar Zapato',
      question: `¿Deseas borrar el Zapato #${shoeNumber}?`,
      isDanger: true,
      confirmText: 'Borrar',
      onConfirm: doClearShoe
    };
  }

  function doClearShoe() {
    playSound('undo');
    history = [];
    selectedHandIndex = null;
    saveShoe();
    showFeedback(`Zapato #${shoeNumber} borrado`);
    confirmModalState.isOpen = false;
  }

  function openNewShoeModal() {
    confirmModalState = {
      isOpen: true,
      title: 'Nuevo Zapato',
      question: '¿Deseas iniciar un nuevo zapato?',
      isDanger: false,
      confirmText: 'Iniciar',
      onConfirm: doNewShoe
    };
  }

  function doNewShoe() {
    playSound('click');
    history = [];
    selectedHandIndex = null;
    shoeNumber += 1;
    saveShoe();
    showFeedback(`Nuevo Zapato #${shoeNumber} iniciado`);
    confirmModalState.isOpen = false;
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
      <h2 class="sb-title">SCOREBOARD BACCARAT</h2>
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
        class="sb-btn sb-btn-clear"
        on:click={openClearShoeModal}
        disabled={history.length === 0}
        title="Borrar las manos registradas del zapato actual"
      >
        Borrar Zapato
      </button>

      <button
        type="button"
        class="sb-btn sb-btn-new-shoe"
        on:click={openNewShoeModal}
        title="Iniciar un nuevo zapato"
      >
        Nuevo Zapato
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

  <!-- TOP STATS BEAD COUNTERS STRIP (Exact Casino Spec) -->
  <section class="casino-bead-counters-strip">
    <div class="counters-scroll">
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

      <!-- Natural N (Victorias con 8 ó 9 de mano) -->
      <div class="counter-item" title="Victorias Naturales (8 ó 9 de mano)">
        <div class="bead-circle-badge bead-orange">N</div>
        <div class="counter-digit">{countNatural}</div>
      </div>

      <!-- Banker Pair (White circle with top-left red dot) -->
      <div class="counter-item" title="Parejas de Banca (B.Pair)">
        <div class="bead-circle-badge bead-white">
          <span class="bead-dot dot-tl red-dot"></span>
        </div>
        <div class="counter-digit">{countBPair}</div>
      </div>

      <!-- Player Pair (White circle with bottom-right blue dot) -->
      <div class="counter-item" title="Parejas de Punto (P.Pair)">
        <div class="bead-circle-badge bead-white">
          <span class="bead-dot dot-br blue-dot"></span>
        </div>
        <div class="counter-digit">{countPPair}</div>
      </div>

      <!-- Summary percentages -->
      <div class="counter-pct-box">
        <span class="pct-tag b">B: {pctBanca}%</span>
        <span class="pct-tag p">P: {pctPunto}%</span>
        <span class="pct-tag t">T: {pctEmpate}%</span>
      </div>
    </div>
  </section>

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
                    title={cell ? `Mano #${cell.id}: ${cell.winner}${cell.bPair ? ' [B.Pair]' : ''}${cell.pPair ? ' [P.Pair]' : ''} (Clic para editar)` : ''}
                  >
                    {#if cell}
                      <div
                        class="bead-circle {cell.winner.toLowerCase()}"
                        class:has-b-pair={cell.bPair}
                        class:has-p-pair={cell.pPair}
                      >
                        <span class="bead-letter">
                          {cell.winner === 'BANCA' ? 'B' : cell.winner === 'PUNTO' ? 'P' : 'T'}
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

  <!-- CROUPIER ARCADE KEYPAD (AL PIE DE PÁGINA) -->
  <footer class="croupier-keypad-panel">
    <div class="keypad-grid-4col">
      <!-- COLUMN 1: P.PAIR + P BUTTON -->
      <div class="keypad-column">
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

      <!-- COLUMN 2: B.PAIR + B BUTTON -->
      <div class="keypad-column">
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

      <!-- COLUMN 3: T BUTTON -->
      <div class="keypad-column">
        <button
          type="button"
          class="keypad-pill pill-win"
          class:active={activeWin}
          on:click={toggleWin}
          title="Activar Victoria Natural (8 ó 9)"
        >
          Natural
        </button>

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

      <!-- COLUMN 4: UNDO BUTTON -->
      <div class="keypad-column">
        <div class="keypad-pill-placeholder"></div>

        <button
          type="button"
          class="keypad-btn-circle btn-undo"
          on:click={undoLast}
          disabled={history.length === 0}
          title="Retroceder / Deshacer última mano registrada"
        >
          <div class="btn-inner-gloss">
            <span class="btn-letter">←</span>
          </div>
        </button>
        <span class="btn-caption undo-caption">RETROCEDER</span>
      </div>
    </div>
  </footer>

  <!-- MODAL DE CONFIRMACIÓN ELEGANTE (BORRAR ZAPATO / NUEVO ZAPATO) -->
  {#if confirmModalState.isOpen}
    <div class="modal-backdrop">
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
    flex-direction: column;
    gap: 5px;
  }

  .sb-title {
    margin: 0;
    font-size: 20px;
    font-weight: 900;
    letter-spacing: 0.8px;
    background: linear-gradient(135deg, #ffffff, #cbd5e1);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
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

  .sb-btn-clear {
    background: #78350f;
    color: #fef08a;
    border: 1px solid #b45309;
  }
  .sb-btn-clear:hover:not(:disabled) {
    background: #92400e;
  }

  .sb-btn-new-shoe {
    background: #991b1b;
    color: #fee2e2;
    border: 1px solid #dc2626;
  }
  .sb-btn-new-shoe:hover:not(:disabled) {
    background: #b91c1c;
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

  .keypad-pill-placeholder {
    width: 100%;
    max-width: 110px;
    height: 38px;
  }

  /* CROUPIER ARCADE KEYPAD (AL PIE DE PÁGINA) */
  .croupier-keypad-panel {
    background: #ffffff;
    border-radius: 12px;
    padding: 12px 16px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
    border: 2px solid #e2e8f0;
    display: flex;
    justify-content: center;
    margin-top: auto;
  }

  .keypad-grid-4col {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 20px;
    max-width: 620px;
    width: 100%;
  }

  @media (max-width: 600px) {
    .keypad-grid-4col {
      gap: 10px;
    }
  }

  .keypad-column {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
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
  .btn-undo .btn-letter {
    font-size: 30px;
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
</style>
