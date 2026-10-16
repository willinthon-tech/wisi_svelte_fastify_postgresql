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
  let soundEnabled = true;

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
    if (!soundEnabled) return;
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

  // Grid dimensions
  const BEAD_ROWS = 6;
  const BEAD_COLS = 22;
  const BIG_ROWS = 6;
  const BIG_COLS = 34;

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

  function resetShoe() {
    if (history.length > 0) {
      if (!confirm(`¿Deseas reiniciar el Zapato #${shoeNumber} y comenzar un nuevo zapato en blanco?`)) return;
    }
    playSound('click');
    history = [];
    selectedHandIndex = null;
    shoeNumber += 1;
    saveShoe();
    showFeedback(`Zapato #${shoeNumber} iniciado`);
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
    if (!confirm(`¿Eliminar la Mano #${deletedId}?`)) return;
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
    const totalCols = Math.max(BIG_COLS, 32);
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
  <!-- TOP CASINO HEADER BAR -->
  <header class="sb-header">
    <div class="sb-header-left">
      <div class="sb-title-badge">
        <div>
          <h2 class="sb-title">SCOREBOARD BACCARAT</h2>
          <span class="sb-subtitle">PUNTO Y BANCA • TECLADO CRUPIER Y AUDITORÍA</span>
        </div>
      </div>

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

      <div class="sb-shoe-pill">
        <span class="pill-label">ZAPATO</span>
        <span class="pill-value">#{shoeNumber}</span>
        <span class="pill-sep">•</span>
        <span class="pill-label">MANOS</span>
        <span class="pill-value">#{totalHands}</span>
      </div>

      {#if feedbackMessage}
        <div class="feedback-toast">
          {feedbackMessage}
        </div>
      {/if}
    </div>

    <div class="sb-header-right">
      <button
        type="button"
        class="sb-btn sb-btn-ghost"
        on:click={() => soundEnabled = !soundEnabled}
        title={soundEnabled ? 'Silenciar sonidos' : 'Activar sonidos'}
      >
        <span>{soundEnabled ? '🔊' : '🔇'}</span>
      </button>

      <button
        type="button"
        class="sb-btn sb-btn-warning"
        on:click={undoLast}
        disabled={history.length === 0}
        title="Deshacer la última mano registrada (O presiona el botón ← del teclado)"
      >
        <span>←</span> Deshacer
      </button>

      <button
        type="button"
        class="sb-btn sb-btn-danger"
        on:click={resetShoe}
        title="Limpiar marcador e iniciar un nuevo zapato"
      >
        <span>🔄</span> Nuevo Zapato
      </button>

      <button
        type="button"
        class="sb-btn sb-btn-secondary"
        on:click={toggleFullscreen}
        title="Pantalla Completa para monitor de mesa"
      >
        <span>{isFullscreen ? '⤦' : '⛶'}</span> {isFullscreen ? 'Salir' : 'Pantalla Completa'}
      </button>

      <button
        type="button"
        class="sb-btn sb-btn-close"
        on:click={handleClose}
        title="Volver a la lista de mesas de la sala"
      >
        ← Volver a Mesas
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

      <!-- Natural N -->
      <div class="counter-item">
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

      <!-- Extra side bets -->
      <div class="counter-item" title="Lucky 6 / Side bets">
        <div class="bead-circle-badge bead-gold">L6</div>
        <div class="counter-digit">{countSpecial}</div>
      </div>

      <div class="counter-item" title="Super 6">
        <div class="bead-circle-badge bead-darkgreen">S6</div>
        <div class="counter-digit">0</div>
      </div>

      <div class="counter-item" title="Banker 6">
        <div class="bead-circle-badge bead-darkred">B6</div>
        <div class="counter-digit">0</div>
      </div>

      <div class="counter-item" title="Lucky 7">
        <div class="bead-circle-badge bead-lightblue">L7</div>
        <div class="counter-digit">0</div>
      </div>

      <div class="counter-item" title="Super 7">
        <div class="bead-circle-badge bead-navy">S7</div>
        <div class="counter-digit">0</div>
      </div>

      <div class="counter-item" title="Banker 7">
        <div class="bead-circle-badge bead-gold-flame">B7</div>
        <div class="counter-digit">0</div>
      </div>

      <div class="counter-item" title="Player 8">
        <div class="bead-circle-badge bead-orange-flame">P8</div>
        <div class="counter-digit">0</div>
      </div>

      <!-- Summary percentages -->
      <div class="counter-pct-box">
        <span class="pct-tag b">B: {pctBanca}%</span>
        <span class="pct-tag p">P: {pctPunto}%</span>
        <span class="pct-tag t">T: {pctEmpate}%</span>
      </div>
    </div>
  </section>

  <!-- PROFESSIONAL CROUPIER ARCADE KEYPAD (Exact Reference Alignment) -->
  <section class="croupier-keypad-panel">
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

      <!-- COLUMN 3: SPECIAL + T BUTTON -->
      <div class="keypad-column">
        <button
          type="button"
          class="keypad-pill pill-special"
          class:active={activeSpecial}
          on:click={toggleSpecial}
          title="Activar apuesta especial / Lucky 6"
        >
          Special
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

      <!-- COLUMN 4: WIN / NATURAL + UNDO BUTTON -->
      <div class="keypad-column">
        <button
          type="button"
          class="keypad-pill pill-win"
          class:active={activeWin}
          on:click={toggleWin}
          title="Activar Victoria Natural (8 ó 9)"
        >
          Win
        </button>

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
  </section>

  <!-- INLINE CELL EDIT TOOLBAR (Active when any cell in roadmaps is clicked) -->
  {#if selectedHandIndex !== null && selectedHand}
    <div class="edit-toolbar-box">
      <div class="edit-toolbar-header">
        <div class="edit-title-group">
          <span class="edit-badge">🟡 EDITANDO MANO #{selectedHand.id || (selectedHandIndex + 1)}</span>
          <span class="edit-hint">Haz clic en los botones para cambiar el resultado o los pares de esta mano</span>
        </div>

        <div class="edit-quick-actions">
          <button type="button" class="btn-tool-nav" on:click={prevHand} disabled={selectedHandIndex === 0} title="Mano anterior">
            ◀ Anterior
          </button>
          <button type="button" class="btn-tool-nav" on:click={nextHand} disabled={selectedHandIndex === history.length - 1} title="Siguiente mano">
            Siguiente ▶
          </button>
          <button type="button" class="btn-tool-del" on:click={deleteSelectedHand} title="Eliminar esta mano del zapato">
            🗑️ Eliminar
          </button>
          <button type="button" class="btn-tool-done" on:click={() => selectedHandIndex = null} title="Cerrar edición">
            ✓ Guardar / Listo
          </button>
        </div>
      </div>

      <div class="edit-controls-row">
        <div class="edit-group">
          <span class="edit-group-label">GANADOR:</span>
          <button
            type="button"
            class="edit-choice-btn punto"
            class:chosen={selectedHand.winner === 'PUNTO'}
            on:click={() => updateSelectedWinner('PUNTO')}
          >
            🔵 PUNTO
          </button>
          <button
            type="button"
            class="edit-choice-btn banca"
            class:chosen={selectedHand.winner === 'BANCA'}
            on:click={() => updateSelectedWinner('BANCA')}
          >
            🔴 BANCA
          </button>
          <button
            type="button"
            class="edit-choice-btn empate"
            class:chosen={selectedHand.winner === 'EMPATE'}
            on:click={() => updateSelectedWinner('EMPATE')}
          >
            🟢 EMPATE
          </button>
        </div>

        <div class="edit-group">
          <span class="edit-group-label">PARES Y ATRIBUTOS:</span>
          <button
            type="button"
            class="edit-pill-toggle"
            class:active-pill={selectedHand.pPair}
            on:click={() => toggleSelectedMod('pPair')}
          >
            🔵 P.Pair {selectedHand.pPair ? '✓' : ''}
          </button>
          <button
            type="button"
            class="edit-pill-toggle"
            class:active-pill={selectedHand.bPair}
            on:click={() => toggleSelectedMod('bPair')}
          >
            🔴 B.Pair {selectedHand.bPair ? '✓' : ''}
          </button>
          <button
            type="button"
            class="edit-pill-toggle"
            class:active-pill={selectedHand.natural}
            on:click={() => toggleSelectedMod('natural')}
          >
            ⚡ Natural (Win) {selectedHand.natural ? '✓' : ''}
          </button>
          <button
            type="button"
            class="edit-pill-toggle"
            class:active-pill={selectedHand.special}
            on:click={() => toggleSelectedMod('special')}
          >
            ⭐ Special {selectedHand.special ? '✓' : ''}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- OFFICIAL CASINO ROADMAPS SECTION (Interactive & Clickable to Edit) -->
  <section class="sb-roadmaps-section">
    <!-- 1. BEAD PLATE (珠盘路) -->
    <div class="roadmap-card">
      <div class="roadmap-header">
        <div class="rm-title">
          <span>●</span> BEAD PLATE (PLATO DE CUENTAS)
          <span class="rm-instruction">Haz clic en cualquier celda para seleccionarla y editarla</span>
        </div>
        <div class="rm-legend">
          <span class="lg-b">🔴 B: Banca</span>
          <span class="lg-p">🔵 P: Punto</span>
          <span class="lg-t">🟢 T: Empate</span>
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

    <!-- 2. BIG ROAD (大路) -->
    <div class="roadmap-card">
      <div class="roadmap-header">
        <div class="rm-title">
          <span>═</span> BIG ROAD (GRAN CAMINO)
          <span class="rm-instruction">Haz clic en una celda para editar</span>
        </div>
        <div class="rm-legend">
          <span>Tendencias y Rachas</span>
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
    padding: 14px 20px;
  }

  .fullscreen-mode {
    position: fixed;
    inset: 0;
    z-index: 9999999;
    padding: 18px 24px;
    overflow-y: auto;
  }

  /* HEADER */
  .sb-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-wrap: wrap;
  }

  .sb-header-left {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .sb-title-badge {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .sb-title {
    margin: 0;
    font-size: 19px;
    font-weight: 900;
    letter-spacing: 0.5px;
    background: linear-gradient(135deg, #ffffff, #cbd5e1);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .sb-subtitle {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.2px;
    color: #eab308;
    display: block;
  }

  .sb-shoe-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #1e293b;
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid #334155;
    font-size: 12px;
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

  .pill-label {
    color: #94a3b8;
    font-weight: 600;
    font-size: 11px;
  }

  .pill-value {
    color: #38bdf8;
    font-weight: 800;
  }

  .pill-sep {
    color: #475569;
  }

  .feedback-toast {
    background: #1e3a8a;
    border: 1px solid #3b82f6;
    color: #e0f2fe;
    font-size: 11.5px;
    font-weight: 700;
    padding: 4px 12px;
    border-radius: 999px;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .sb-header-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .sb-btn {
    border: none;
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: all 0.15s ease;
  }

  .sb-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .sb-btn-ghost {
    background: #1e293b;
    color: #cbd5e1;
    border: 1px solid #334155;
  }
  .sb-btn-ghost:hover:not(:disabled) {
    background: #334155;
    color: #ffffff;
  }

  .sb-btn-warning {
    background: #854d0e;
    color: #fef08a;
  }
  .sb-btn-warning:hover:not(:disabled) {
    background: #a16207;
  }

  .sb-btn-danger {
    background: #991b1b;
    color: #fee2e2;
  }
  .sb-btn-danger:hover:not(:disabled) {
    background: #b91c1c;
  }

  .sb-btn-secondary {
    background: #1e293b;
    color: #38bdf8;
    border: 1px solid #0284c7;
  }
  .sb-btn-secondary:hover {
    background: #0284c7;
    color: #ffffff;
  }

  .sb-btn-close {
    background: #475569;
    color: #ffffff;
  }
  .sb-btn-close:hover {
    background: #64748b;
  }

  /* CASINO BEAD COUNTERS STRIP (Exact Reference Spec) */
  .casino-bead-counters-strip {
    background: #ffffff;
    border-radius: 8px;
    padding: 8px 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    border: 1.5px solid #cbd5e1;
  }

  .counters-scroll {
    display: flex;
    align-items: center;
    gap: 16px;
    overflow-x: auto;
    padding-bottom: 2px;
  }

  .counter-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 38px;
  }

  .bead-circle-badge {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 900;
    color: #ffffff;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.25), inset 0 2px 2px rgba(255, 255, 255, 0.6);
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

  .bead-gold { background: radial-gradient(circle at 35% 30%, #facc15, #ca8a04); color: #000; font-size: 12px; }
  .bead-darkgreen { background: radial-gradient(circle at 35% 30%, #166534, #052e16); font-size: 12px; }
  .bead-darkred { background: radial-gradient(circle at 35% 30%, #991b1b, #450a0a); font-size: 12px; }
  .bead-lightblue { background: radial-gradient(circle at 35% 30%, #38bdf8, #0284c7); font-size: 12px; }
  .bead-navy { background: radial-gradient(circle at 35% 30%, #1d4ed8, #0f172a); font-size: 12px; }
  .bead-gold-flame { background: radial-gradient(circle at 35% 30%, #eab308, #713f12); color: #000; font-size: 12px; }
  .bead-orange-flame { background: radial-gradient(circle at 35% 30%, #f97316, #7c2d12); font-size: 12px; }

  .bead-dot {
    position: absolute;
    width: 9px;
    height: 9px;
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
    font-size: 16px;
    font-weight: 900;
    color: #0f172a;
    line-height: 1;
  }

  .counter-pct-box {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    background: #f1f5f9;
    padding: 6px 14px;
    border-radius: 999px;
    border: 1px solid #e2e8f0;
  }

  .pct-tag {
    font-size: 12px;
    font-weight: 800;
  }
  .pct-tag.b { color: #dc2626; }
  .pct-tag.p { color: #2563eb; }
  .pct-tag.t { color: #16a34a; }

  /* CROUPIER ARCADE KEYPAD (Exact Reference Alignment) */
  .croupier-keypad-panel {
    background: #ffffff;
    border-radius: 12px;
    padding: 16px 20px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
    border: 2px solid #e2e8f0;
    display: flex;
    justify-content: center;
  }

  .keypad-grid-4col {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 28px;
    max-width: 680px;
    width: 100%;
  }

  @media (max-width: 600px) {
    .keypad-grid-4col {
      gap: 12px;
    }
  }

  .keypad-column {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  /* MODIFIER PILLS ROW */
  .keypad-pill {
    width: 100%;
    max-width: 125px;
    height: 42px;
    border-radius: 999px;
    background: #ffffff;
    font-family: inherit;
    font-size: 16px;
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
    box-shadow: 0 0 14px rgba(0, 0, 255, 0.5);
  }

  .keypad-pill.pill-bpair {
    border: 2.5px solid #dc2626;
    color: #dc2626;
  }
  .keypad-pill.pill-bpair.active {
    background: radial-gradient(circle at 50% 30%, #ef4444, #990000);
    color: #ffffff;
    border-color: #880000;
    box-shadow: 0 0 14px rgba(220, 38, 38, 0.5);
  }

  .keypad-pill.pill-special {
    border: 2.5px solid #94a3b8;
    color: #94a3b8;
  }
  .keypad-pill.pill-special.active {
    background: radial-gradient(circle at 50% 30%, #64748b, #334155);
    color: #ffffff;
    border-color: #1e293b;
    box-shadow: 0 0 14px rgba(100, 116, 139, 0.5);
  }

  .keypad-pill.pill-win {
    border: 2.5px solid #7c3aed;
    color: #7c3aed;
  }
  .keypad-pill.pill-win.active {
    background: radial-gradient(circle at 50% 30%, #a855f7, #6b21a8);
    color: #ffffff;
    border-color: #581c87;
    box-shadow: 0 0 14px rgba(124, 58, 237, 0.5);
  }

  /* 3D CIRCULAR CASINO BUTTONS */
  .keypad-btn-circle {
    width: 86px;
    height: 86px;
    border-radius: 50%;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border: none;
    background: linear-gradient(145deg, #ffffff, #94a3b8, #cbd5e1);
    padding: 4px;
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.35), inset 0 2px 2px rgba(255, 255, 255, 0.9);
    transition: transform 0.1s ease, box-shadow 0.1s ease;
    user-select: none;
  }

  @media (max-width: 600px) {
    .keypad-btn-circle {
      width: 70px;
      height: 70px;
    }
  }

  .keypad-btn-circle:hover {
    filter: brightness(1.05);
  }

  .keypad-btn-circle:active {
    transform: translateY(3px) scale(0.96);
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.35);
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
    font-size: 38px;
    font-weight: 900;
    color: #ffffff;
    text-shadow: 0 2px 5px rgba(0, 0, 0, 0.6);
    line-height: 1;
  }

  @media (max-width: 600px) {
    .btn-letter {
      font-size: 30px;
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
    font-size: 34px;
  }

  /* CORNER BADGES ON P, B, T (When P.Pair / B.Pair active) */
  .badge-corner-tl {
    position: absolute;
    top: 0px;
    left: 0px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, #ff4d4d, #b91c1c);
    border: 2.5px solid #ffffff;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
    z-index: 10;
    animation: popBadge 0.15s ease-out;
  }

  .badge-corner-br {
    position: absolute;
    bottom: 0px;
    right: 0px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, #60a5fa, #1d4ed8);
    border: 2.5px solid #ffffff;
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
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.5px;
    user-select: none;
  }
  .punto-caption { color: #2563eb; }
  .banca-caption { color: #dc2626; }
  .tie-caption { color: #16a34a; }
  .undo-caption { color: #854d0e; }

  /* INLINE EDIT TOOLBAR */
  .edit-toolbar-box {
    background: #0f172a;
    border: 2px solid #f59e0b;
    border-radius: 10px;
    padding: 12px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 0 20px rgba(245, 158, 11, 0.25);
    animation: slideDown 0.2s ease;
  }

  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .edit-toolbar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 8px;
  }

  .edit-title-group {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .edit-badge {
    background: #f59e0b;
    color: #0f172a;
    font-size: 13px;
    font-weight: 900;
    padding: 4px 12px;
    border-radius: 6px;
    letter-spacing: 0.5px;
  }

  .edit-hint {
    font-size: 12px;
    color: #94a3b8;
  }

  .edit-quick-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-tool-nav, .btn-tool-del, .btn-tool-done {
    border: none;
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
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

  .edit-controls-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .edit-group {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .edit-group-label {
    font-size: 11px;
    font-weight: 800;
    color: #eab308;
    margin-right: 4px;
  }

  .edit-choice-btn {
    border: none;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.15s ease;
    opacity: 0.6;
  }

  .edit-choice-btn.punto { background: #1d4ed8; color: #ffffff; }
  .edit-choice-btn.banca { background: #b91c1c; color: #ffffff; }
  .edit-choice-btn.empate { background: #15803d; color: #ffffff; }

  .edit-choice-btn.chosen {
    opacity: 1;
    transform: scale(1.06);
    box-shadow: 0 0 10px rgba(255, 255, 255, 0.4);
    outline: 2px solid #ffffff;
  }

  .edit-pill-toggle {
    background: #1e293b;
    color: #cbd5e1;
    border: 1px solid #334155;
    border-radius: 999px;
    padding: 5px 12px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .edit-pill-toggle.active-pill {
    background: #3b82f6;
    color: #ffffff;
    border-color: #60a5fa;
    box-shadow: 0 0 8px rgba(59, 130, 246, 0.4);
  }

  /* ROADMAPS SECTION */
  .sb-roadmaps-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .roadmap-card {
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 10px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .roadmap-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 800;
    color: #94a3b8;
    flex-wrap: wrap;
    gap: 8px;
  }

  .rm-title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #f1f5f9;
  }

  .rm-instruction {
    font-size: 10.5px;
    font-weight: 600;
    color: #eab308;
    background: rgba(234, 179, 8, 0.12);
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid rgba(234, 179, 8, 0.3);
  }

  .rm-legend {
    display: flex;
    gap: 12px;
    font-size: 11px;
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
    padding: 6px;
  }

  /* BEAD TABLE */
  .bead-table, .bigroad-table {
    border-collapse: collapse;
    margin: 0 auto;
  }

  .bead-cell {
    width: 28px;
    height: 28px;
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
    box-shadow: 0 0 12px rgba(255, 193, 7, 0.85);
  }

  .bead-circle {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    margin: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    font-size: 11px;
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
    width: 24px;
    height: 24px;
  }

  /* BIG ROAD TABLE */
  .bigroad-cell {
    width: 24px;
    height: 24px;
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
    width: 20px;
    height: 20px;
    border-radius: 50%;
    margin: auto;
    border: 2.5px solid transparent;
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
    width: 18px;
    height: 2.5px;
    background: #22c55e;
    transform: translate(-50%, -50%) rotate(45deg);
  }

  .tie-badge-num {
    position: absolute;
    top: -4px;
    right: -4px;
    background: #16a34a;
    color: #fff;
    font-size: 8.5px;
    font-weight: 900;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
