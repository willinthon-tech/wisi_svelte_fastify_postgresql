<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import { selectedSalaStore, currentUserStore, userSalasStore } from '../controllers/auth.store.js';
  import { masterSalasStore, masterMesasStore } from '../controllers/master.store.js';

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
  $: storageKey = `wisi_baccarat_shoe_v2_${currentSalaObj?.uuid || currentSalaObj?.id || 'default'}_${currentMesaObj?.uuid || currentMesaObj?.id || currentMesaId || 'default'}`;

  let lastLoadedStorageKey = null;
  $: if (storageKey && storageKey !== lastLoadedStorageKey) {
    lastLoadedStorageKey = storageKey;
    loadSavedShoe();
  }

  // Audio Context for subtle casino sound effects (synthesized offline)
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
      if (type === 'deal') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.08);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.09);
      } else if (type === 'win') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.2); // G5
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.36);
      }
    } catch (e) {
      // Audio error silently ignored
    }
  }

  // Shoe state
  let shoeNumber = 1;
  let history = []; // array of records: { winner: 'BANCA'|'PUNTO'|'EMPATE', scoreB, scoreP, natural, bPair, pPair, bancaCards, puntoCards }
  
  // Current Live Hand State
  let puntoCards = [];
  let bancaCards = [];
  let puntoScore = 0;
  let bancaScore = 0;
  let currentWinner = null;
  let isDealing = false;
  let lastVerdict = "";
  let isNatural = false;

  // Manual Quick Input Form State
  let manualWinner = "BANCA";
  let manualScoreB = 7;
  let manualScoreP = 5;
  let manualBPair = false;
  let manualPPair = false;
  let manualNatural = false;

  // Roadmaps grid dimensions
  const BEAD_ROWS = 6;
  const BEAD_COLS = 20;
  const BIG_ROWS = 6;
  const BIG_COLS = 30;

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

  // Load saved shoe from localStorage if available
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

  function saveShoe() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        shoeNumber,
        history
      }));
    } catch (e) {}
  }

  // Stats derivation
  $: totalHands = history.length;
  $: countBanca = history.filter(h => h.winner === 'BANCA').length;
  $: countPunto = history.filter(h => h.winner === 'PUNTO').length;
  $: countEmpate = history.filter(h => h.winner === 'EMPATE').length;
  $: countBPair = history.filter(h => h.bPair).length;
  $: countPPair = history.filter(h => h.pPair).length;
  $: countNatural = history.filter(h => h.natural).length;

  $: pctBanca = totalHands > 0 ? ((countBanca / totalHands) * 100).toFixed(1) : '0.0';
  $: pctPunto = totalHands > 0 ? ((countPunto / totalHands) * 100).toFixed(1) : '0.0';
  $: pctEmpate = totalHands > 0 ? ((countEmpate / totalHands) * 100).toFixed(1) : '0.0';

  // --------------------------------------------------------------------------
  // BACCARAT CARD DECK & ENGINE
  // --------------------------------------------------------------------------
  const SUITS = [
    { symbol: '♠', name: 'spades', color: '#1e293b' },
    { symbol: '♥', name: 'hearts', color: '#dc2626' },
    { symbol: '♦', name: 'diamonds', color: '#dc2626' },
    { symbol: '♣', name: 'clubs', color: '#1e293b' }
  ];

  const RANKS = [
    { rank: 'A', value: 1 },
    { rank: '2', value: 2 },
    { rank: '3', value: 3 },
    { rank: '4', value: 4 },
    { rank: '5', value: 5 },
    { rank: '6', value: 6 },
    { rank: '7', value: 7 },
    { rank: '8', value: 8 },
    { rank: '9', value: 9 },
    { rank: '10', value: 0 },
    { rank: 'J', value: 0 },
    { rank: 'Q', value: 0 },
    { rank: 'K', value: 0 }
  ];

  function drawCard() {
    const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
    const r = RANKS[Math.floor(Math.random() * RANKS.length)];
    return {
      rank: r.rank,
      value: r.value,
      suit: suit.symbol,
      suitColor: suit.color,
      label: `${r.rank}${suit.symbol}`
    };
  }

  function calcBaccaratTotal(cards) {
    const sum = cards.reduce((acc, c) => acc + c.value, 0);
    return sum % 10;
  }

  // Live Deal with Official International Baccarat Rules
  async function dealLiveHand() {
    if (isDealing) return;
    isDealing = true;
    currentWinner = null;
    lastVerdict = "Repartiendo cartas...";
    playSound('deal');

    // 1. Initial 2 cards for Punto and Banca
    puntoCards = [drawCard(), drawCard()];
    bancaCards = [drawCard(), drawCard()];
    puntoScore = calcBaccaratTotal(puntoCards);
    bancaScore = calcBaccaratTotal(bancaCards);

    // Check pairs on first 2 cards
    const pPair = puntoCards[0].rank === puntoCards[1].rank;
    const bPair = bancaCards[0].rank === bancaCards[1].rank;

    await new Promise(r => setTimeout(r, 400));
    playSound('deal');

    // 2. Check for Natural (8 or 9)
    if (puntoScore >= 8 || bancaScore >= 8) {
      isNatural = true;
      finalizeHand(puntoCards, bancaCards, pPair, bPair, true);
      isDealing = false;
      return;
    }

    isNatural = false;

    // 3. Player's Third Card Rule
    let p3 = null;
    if (puntoScore <= 5) {
      lastVerdict = "Punto pide 3ra carta...";
      await new Promise(r => setTimeout(r, 450));
      p3 = drawCard();
      puntoCards = [...puntoCards, p3];
      puntoScore = calcBaccaratTotal(puntoCards);
      playSound('deal');
    }

    // 4. Banker's Third Card Rule
    let bDraws = false;
    if (p3 === null) {
      // Player stood on 6 or 7
      if (bancaScore <= 5) bDraws = true;
    } else {
      // Player drew a 3rd card
      const p3Val = p3.value;
      if (bancaScore <= 2) {
        bDraws = true;
      } else if (bancaScore === 3 && p3Val !== 8) {
        bDraws = true;
      } else if (bancaScore === 4 && [2, 3, 4, 5, 6, 7].includes(p3Val)) {
        bDraws = true;
      } else if (bancaScore === 5 && [4, 5, 6, 7].includes(p3Val)) {
        bDraws = true;
      } else if (bancaScore === 6 && [6, 7].includes(p3Val)) {
        bDraws = true;
      }
    }

    if (bDraws) {
      lastVerdict = "Banca pide 3ra carta...";
      await new Promise(r => setTimeout(r, 450));
      const b3 = drawCard();
      bancaCards = [...bancaCards, b3];
      bancaScore = calcBaccaratTotal(bancaCards);
      playSound('deal');
    }

    await new Promise(r => setTimeout(r, 300));
    finalizeHand(puntoCards, bancaCards, pPair, bPair, false);
    isDealing = false;
  }

  function finalizeHand(pCards, bCards, pPair, bPair, natural) {
    const pScore = calcBaccaratTotal(pCards);
    const bScore = calcBaccaratTotal(bCards);
    let win = 'EMPATE';
    if (bScore > pScore) win = 'BANCA';
    else if (pScore > bScore) win = 'PUNTO';

    currentWinner = win;
    playSound('win');

    if (win === 'BANCA') {
      lastVerdict = `🏆 BANCA GANA (${bScore} a ${pScore})${natural ? ' ★ NATURAL' : ''}`;
    } else if (win === 'PUNTO') {
      lastVerdict = `🏆 PUNTO GANA (${pScore} a ${bScore})${natural ? ' ★ NATURAL' : ''}`;
    } else {
      lastVerdict = `🤝 EMPATE (TIE) (${bScore} a ${pScore})`;
    }

    const record = {
      id: history.length + 1,
      winner: win,
      scoreB: bScore,
      scoreP: pScore,
      natural,
      bPair,
      pPair,
      puntoCards: [...pCards],
      bancaCards: [...bCards],
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    history = [...history, record];
    saveShoe();
  }

  // Manual Quick Input
  function addManualResult(winner) {
    const record = {
      id: history.length + 1,
      winner,
      scoreB: manualScoreB,
      scoreP: manualScoreP,
      natural: manualNatural,
      bPair: manualBPair,
      pPair: manualPPair,
      puntoCards: [],
      bancaCards: [],
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
    history = [...history, record];
    currentWinner = winner;
    lastVerdict = `${winner === 'BANCA' ? '🔴 BANCA' : winner === 'PUNTO' ? '🔵 PUNTO' : '🟢 EMPATE'} registrado (${manualScoreB} - ${manualScoreP})`;
    playSound('win');
    saveShoe();

    // Reset manual options
    manualBPair = false;
    manualPPair = false;
    manualNatural = false;
  }

  function undoLast() {
    if (history.length === 0) return;
    history = history.slice(0, -1);
    currentWinner = history.length > 0 ? history[history.length - 1].winner : null;
    lastVerdict = "Última mano deshecha";
    saveShoe();
  }

  function resetShoe() {
    if (history.length > 0) {
      if (!confirm(`¿Deseas reiniciar el Zapato #${shoeNumber} y comenzar uno nuevo?`)) return;
    }
    history = [];
    puntoCards = [];
    bancaCards = [];
    puntoScore = 0;
    bancaScore = 0;
    currentWinner = null;
    lastVerdict = "Nuevo zapato iniciado";
    shoeNumber += 1;
    saveShoe();
  }

  // --------------------------------------------------------------------------
  // ROADMAP GENERATION (BEAD PLATE & BIG ROAD)
  // --------------------------------------------------------------------------
  // Bead Plate: fills 6 rows vertically per column, then moves right
  $: beadGrid = (() => {
    const totalCols = Math.max(BEAD_COLS, Math.ceil(history.length / BEAD_ROWS) + 2);
    const grid = Array.from({ length: BEAD_ROWS }, () => Array(totalCols).fill(null));
    history.forEach((h, idx) => {
      const col = Math.floor(idx / BEAD_ROWS);
      const row = idx % BEAD_ROWS;
      if (col < totalCols) {
        grid[row][col] = h;
      }
    });
    return { grid, totalCols };
  })();

  // Big Road: streaks go down, turn right on collision / bottom, ties are green slash
  $: bigRoadGrid = (() => {
    const totalCols = Math.max(BIG_COLS, 30);
    const grid = Array.from({ length: BIG_ROWS }, () => Array(totalCols).fill(null));

    let col = 0;
    let row = 0;
    let prevWinner = null;
    let lastPlaced = null;

    for (const h of history) {
      if (h.winner === 'EMPATE') {
        // Tie attaches to the last outcome if exists
        if (lastPlaced) {
          lastPlaced.tieCount = (lastPlaced.tieCount || 0) + 1;
        } else {
          // Starting with tie: put green mark at 0,0
          grid[0][0] = { ...h, isTieOnly: true, tieCount: 1 };
          lastPlaced = grid[0][0];
        }
        continue;
      }

      if (!prevWinner) {
        // First non-tie
        grid[0][0] = { ...h, tieCount: 0 };
        lastPlaced = grid[0][0];
        prevWinner = h.winner;
        row = 1;
        col = 0;
      } else if (h.winner === prevWinner) {
        // Same winner: go down or turn right if blocked/bottom
        if (row < BIG_ROWS && !grid[row][col]) {
          grid[row][col] = { ...h, tieCount: 0 };
          lastPlaced = grid[row][col];
          row++;
        } else {
          // Dragon tail: turn right
          let dragonCol = col + 1;
          const dragonRow = row >= BIG_ROWS ? BIG_ROWS - 1 : row - 1;
          while (dragonCol < totalCols && grid[dragonRow][dragonCol]) {
            dragonCol++;
          }
          if (dragonCol < totalCols) {
            grid[dragonRow][dragonCol] = { ...h, tieCount: 0 };
            lastPlaced = grid[dragonRow][dragonCol];
          }
        }
      } else {
        // Winner changed: find next available column at row 0
        col++;
        while (col < totalCols && grid[0][col]) {
          col++;
        }
        row = 0;
        if (col < totalCols) {
          grid[0][col] = { ...h, tieCount: 0 };
          lastPlaced = grid[0][col];
          row = 1;
        }
        prevWinner = h.winner;
      }
    }

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
      document.exitFullscreen?.();
    }
    dispatch('close');
  }
</script>

<div
  bind:this={rootElement}
  class="scoreboard-container"
  class:fullscreen-mode={isFullscreen}
>
  <!-- TOP CASINO HEADER BAR -->
  <header class="sb-header">
    <div class="sb-header-left">
      <div class="sb-title-badge">
        <span class="sb-icon">🎴</span>
        <div>
          <h2 class="sb-title">SCOREBOARD BACCARAT</h2>
          <span class="sb-subtitle">PUNTO Y BANCA • CASINO LIVE AUDIT</span>
        </div>
      </div>
      {#if currentSalaName}
        <div class="sb-shoe-pill" style="border-color: #3b82f6; background: rgba(37, 99, 235, 0.2);">
          <span class="pill-label" style="color: #93c5fd;">SALA</span>
          <span class="pill-value" style="color: #ffffff;">{currentSalaName}</span>
        </div>
      {/if}
      {#if currentMesaName}
        <div class="sb-shoe-pill" style="border-color: #10b981; background: rgba(16, 185, 129, 0.2);">
          <span class="pill-label" style="color: #6ee7b7;">MESA</span>
          <span class="pill-value" style="color: #ffffff;">{currentMesaName}</span>
        </div>
      {/if}
      <div class="sb-shoe-pill">
        <span class="pill-label">ZAPATO</span>
        <span class="pill-value">#{shoeNumber}</span>
        <span class="pill-sep">•</span>
        <span class="pill-label">MANO</span>
        <span class="pill-value">#{totalHands}</span>
      </div>
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
        title="Deshacer última mano registrada"
      >
        <span>↶</span> Deshacer
      </button>

      <button
        type="button"
        class="sb-btn sb-btn-danger"
        on:click={resetShoe}
        title="Reiniciar zapato actual y limpiar marcador"
      >
        <span>🔄</span> Nuevo Zapato
      </button>

      <button
        type="button"
        class="sb-btn sb-btn-secondary"
        on:click={toggleFullscreen}
        title="Modo Pantalla Completa (Ideal para monitores de sala/mesa)"
      >
        <span>{isFullscreen ? '⤦' : '⛶'}</span> {isFullscreen ? 'Salir' : 'Pantalla Completa'}
      </button>

      <button
        type="button"
        class="sb-btn sb-btn-close"
        on:click={handleClose}
        title="Volver a la lista de mesas de la sala"
      >
        ✕ Volver a Mesas
      </button>
    </div>
  </header>

  <!-- LIVE CASINO STATISTICS STRIP -->
  <section class="sb-stats-strip">
    <div class="stat-card">
      <div class="stat-lbl">TOTAL MANOS</div>
      <div class="stat-num">{totalHands}</div>
    </div>

    <div class="stat-card punto-card">
      <div class="stat-lbl">PUNTO (PLAYER)</div>
      <div class="stat-num">{countPunto}</div>
      <div class="stat-sub">{pctPunto}%</div>
    </div>

    <div class="stat-card banca-card">
      <div class="stat-lbl">BANCA (BANKER)</div>
      <div class="stat-num">{countBanca}</div>
      <div class="stat-sub">{pctBanca}%</div>
    </div>

    <div class="stat-card empate-card">
      <div class="stat-lbl">EMPATE (TIE)</div>
      <div class="stat-num">{countEmpate}</div>
      <div class="stat-sub">{pctEmpate}%</div>
    </div>

    <div class="stat-card pairs-card">
      <div class="stat-lbl">PARES</div>
      <div class="stat-pair-row">
        <span class="pair-tag punto">P. Par: <b>{countPPair}</b></span>
        <span class="pair-tag banca">B. Par: <b>{countBPair}</b></span>
      </div>
    </div>

    <div class="stat-card natural-card">
      <div class="stat-lbl">NATURALES (8/9)</div>
      <div class="stat-num">{countNatural}</div>
      <div class="stat-sub">{totalHands > 0 ? ((countNatural / totalHands) * 100).toFixed(0) : 0}%</div>
    </div>
  </section>

  <!-- MAIN PLAYING FELT TABLE & DEALER SECTION -->
  <main class="sb-table-felt">
    <!-- Punto vs Banca Live Card Arena -->
    <div class="felt-arena">
      <!-- LADO BANCA (RED) -->
      <div class="felt-side banca-side" class:winner-glow={currentWinner === 'BANCA'}>
        <div class="side-badge-header">
          <span class="side-title">🔴 BANCA (BANKER)</span>
          <span class="side-score-circle" class:active-score={bancaCards.length > 0}>
            {bancaCards.length > 0 ? bancaScore : '—'}
          </span>
        </div>

        <div class="cards-holder">
          {#if bancaCards.length > 0}
            {#each bancaCards as c, i}
              <div class="casino-card" style="--card-color: {c.suitColor};">
                <span class="card-rank">{c.rank}</span>
                <span class="card-suit">{c.suit}</span>
                <span class="card-corner-bottom">{c.rank}</span>
              </div>
            {/each}
          {:else}
            <div class="card-placeholder">Carta 1</div>
            <div class="card-placeholder">Carta 2</div>
            <div class="card-placeholder optional">Carta 3</div>
          {/if}
        </div>
      </div>

      <!-- ARENA CENTER: VS & DEAL CONTROLS -->
      <div class="felt-center">
        <div class="vs-circle" class:banca-win={currentWinner === 'BANCA'} class:punto-win={currentWinner === 'PUNTO'} class:tie-win={currentWinner === 'EMPATE'}>
          {#if currentWinner === 'BANCA'}
            <span>B</span>
          {:else if currentWinner === 'PUNTO'}
            <span>P</span>
          {:else if currentWinner === 'EMPATE'}
            <span>T</span>
          {:else}
            <span>VS</span>
          {/if}
        </div>

        <button
          type="button"
          class="btn-deal-action"
          on:click={dealLiveHand}
          disabled={isDealing}
        >
          {#if isDealing}
            <span class="spin-icon">⏳</span> Repartiendo...
          {:else}
            <span>🎴</span> REPARTIR MANO
          {/if}
        </button>

        {#if lastVerdict}
          <div class="verdict-banner" class:banca-b={currentWinner === 'BANCA'} class:punto-b={currentWinner === 'PUNTO'} class:empate-b={currentWinner === 'EMPATE'}>
            {lastVerdict}
          </div>
        {/if}
      </div>

      <!-- LADO PUNTO (BLUE) -->
      <div class="felt-side punto-side" class:winner-glow={currentWinner === 'PUNTO'}>
        <div class="side-badge-header">
          <span class="side-title">🔵 PUNTO (PLAYER)</span>
          <span class="side-score-circle" class:active-score={puntoCards.length > 0}>
            {puntoCards.length > 0 ? puntoScore : '—'}
          </span>
        </div>

        <div class="cards-holder">
          {#if puntoCards.length > 0}
            {#each puntoCards as c, i}
              <div class="casino-card" style="--card-color: {c.suitColor};">
                <span class="card-rank">{c.rank}</span>
                <span class="card-suit">{c.suit}</span>
                <span class="card-corner-bottom">{c.rank}</span>
              </div>
            {/each}
          {:else}
            <div class="card-placeholder">Carta 1</div>
            <div class="card-placeholder">Carta 2</div>
            <div class="card-placeholder optional">Carta 3</div>
          {/if}
        </div>
      </div>
    </div>

    <!-- QUICK MANUAL REGISTRATION PANEL FOR DEALERS / SUPERVISORS -->
    <div class="manual-input-strip">
      <div class="manual-input-label">
        <span>⚡ REGISTRO RÁPIDO CRUPIER:</span>
      </div>

      <div class="quick-btn-group">
        <button
          type="button"
          class="btn-quick banca"
          on:click={() => addManualResult('BANCA')}
          title="Registrar victoria de BANCA"
        >
          + BANCA
        </button>
        <button
          type="button"
          class="btn-quick punto"
          on:click={() => addManualResult('PUNTO')}
          title="Registrar victoria de PUNTO"
        >
          + PUNTO
        </button>
        <button
          type="button"
          class="btn-quick empate"
          on:click={() => addManualResult('EMPATE')}
          title="Registrar EMPATE (TIE)"
        >
          + EMPATE
        </button>
      </div>

      <div class="quick-options">
        <label class="check-pill">
          <input type="checkbox" bind:checked={manualBPair} />
          <span>Par Banca</span>
        </label>
        <label class="check-pill">
          <input type="checkbox" bind:checked={manualPPair} />
          <span>Par Punto</span>
        </label>
        <label class="check-pill">
          <input type="checkbox" bind:checked={manualNatural} />
          <span>Natural (8/9)</span>
        </label>
      </div>
    </div>
  </main>

  <!-- OFFICIAL CASINO ROADMAPS SECTION -->
  <section class="sb-roadmaps-section">
    <!-- 1. BEAD PLATE (珠盘路) -->
    <div class="roadmap-card">
      <div class="roadmap-header">
        <div class="rm-title">
          <span>●</span> BEAD PLATE (PLATO DE CUENTAS)
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
                  <td class="bead-cell">
                    {#if cell}
                      <div
                        class="bead-circle {cell.winner.toLowerCase()}"
                        class:has-b-pair={cell.bPair}
                        class:has-p-pair={cell.pPair}
                        title="Mano #{cell.id}: {cell.winner} ({cell.scoreB}-{cell.scoreP}){cell.natural ? ' [Natural]' : ''}"
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
        </div>
        <div class="rm-legend">
          <span>Rachas y Tendencias de Juego</span>
        </div>
      </div>

      <div class="grid-scrollable">
        <table class="bigroad-table">
          <tbody>
            {#each bigRoadGrid.grid as row, rIdx}
              <tr>
                {#each row as cell, cIdx}
                  <td class="bigroad-cell">
                    {#if cell}
                      <div
                        class="bigroad-ring {cell.winner.toLowerCase()}"
                        class:is-tie={cell.isTieOnly}
                        title="{cell.winner}{cell.tieCount > 0 ? ` (+${cell.tieCount} Empates)` : ''}"
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
    border-radius: 14px;
    border: 1px solid #1e293b;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    font-family: inherit;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
  }

  .fullscreen-mode {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 9999999;
    border-radius: 0;
    padding: 20px;
    overflow-y: auto;
  }

  /* HEADER */
  .sb-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-wrap: wrap;
  }

  .sb-header-left {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  .sb-title-badge {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .sb-icon {
    font-size: 26px;
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
    letter-spacing: 1.5px;
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

  /* STATS STRIP */
  .sb-stats-strip {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 10px;
  }

  .stat-card {
    background: #0f172a;
    border: 1px solid #1e293b;
    border-radius: 10px;
    padding: 10px 12px;
    text-align: center;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    position: relative;
    overflow: hidden;
  }

  .stat-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: #475569;
  }

  .punto-card::before { background: #2563eb; }
  .banca-card::before { background: #dc2626; }
  .empate-card::before { background: #16a34a; }
  .pairs-card::before { background: #d97706; }
  .natural-card::before { background: #eab308; }

  .stat-lbl {
    font-size: 10px;
    font-weight: 800;
    color: #94a3b8;
    letter-spacing: 0.5px;
  }

  .stat-num {
    font-size: 20px;
    font-weight: 900;
    color: #ffffff;
    line-height: 1.1;
  }

  .stat-sub {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
  }

  .punto-card .stat-num { color: #60a5fa; }
  .punto-card .stat-sub { color: #3b82f6; }
  .banca-card .stat-num { color: #f87171; }
  .banca-card .stat-sub { color: #ef4444; }
  .empate-card .stat-num { color: #4ade80; }
  .empate-card .stat-sub { color: #22c55e; }

  .stat-pair-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 2px;
  }
  .pair-tag {
    font-size: 11px;
    font-weight: 700;
  }
  .pair-tag.punto { color: #93c5fd; }
  .pair-tag.banca { color: #fca5a5; }

  /* CASINO TABLE FELT */
  .sb-table-felt {
    background: radial-gradient(ellipse at center, #0f3928 0%, #071f16 100%);
    border: 2px solid #ca8a04;
    border-radius: 14px;
    padding: 20px;
    box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .felt-arena {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 20px;
    align-items: center;
  }

  @media (max-width: 860px) {
    .felt-arena {
      grid-template-columns: 1fr;
    }
  }

  .felt-side {
    background: rgba(0, 0, 0, 0.35);
    border-radius: 12px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    transition: all 0.3s ease;
  }

  .banca-side { border-color: rgba(239, 68, 68, 0.3); }
  .punto-side { border-color: rgba(59, 130, 246, 0.3); }

  .winner-glow.banca-side {
    box-shadow: 0 0 25px rgba(239, 68, 68, 0.5);
    border-color: #ef4444;
    background: rgba(220, 38, 38, 0.15);
  }

  .winner-glow.punto-side {
    box-shadow: 0 0 25px rgba(59, 130, 246, 0.5);
    border-color: #3b82f6;
    background: rgba(37, 99, 235, 0.15);
  }

  .side-badge-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .side-title {
    font-size: 14px;
    font-weight: 900;
    letter-spacing: 0.5px;
  }
  .banca-side .side-title { color: #fca5a5; }
  .punto-side .side-title { color: #93c5fd; }

  .side-score-circle {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #0f172a;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 900;
    color: #94a3b8;
    border: 1px solid #334155;
  }

  .banca-side .active-score {
    background: #dc2626;
    color: #ffffff;
    border-color: #f87171;
    box-shadow: 0 0 10px rgba(220, 38, 38, 0.5);
  }

  .punto-side .active-score {
    background: #2563eb;
    color: #ffffff;
    border-color: #60a5fa;
    box-shadow: 0 0 10px rgba(37, 99, 235, 0.5);
  }

  .cards-holder {
    display: flex;
    gap: 10px;
    min-height: 105px;
    justify-content: center;
    align-items: center;
  }

  .card-placeholder {
    width: 68px;
    height: 98px;
    border: 1.5px dashed rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10.5px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.3);
  }

  .casino-card {
    width: 68px;
    height: 98px;
    background: #ffffff;
    border-radius: 8px;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 6px;
    position: relative;
    user-select: none;
    animation: cardDrop 0.25s ease-out;
  }

  @keyframes cardDrop {
    from {
      transform: translateY(-20px) scale(0.85);
      opacity: 0;
    }
    to {
      transform: translateY(0) scale(1);
      opacity: 1;
    }
  }

  .card-rank {
    font-size: 15px;
    font-weight: 900;
    color: var(--card-color);
    line-height: 1;
  }

  .card-suit {
    font-size: 26px;
    color: var(--card-color);
    text-align: center;
    line-height: 1;
  }

  .card-corner-bottom {
    font-size: 12px;
    font-weight: 800;
    color: var(--card-color);
    align-self: flex-end;
    transform: rotate(180deg);
  }

  /* CENTER ARENA CONTROLS */
  .felt-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
  }

  .vs-circle {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: #0f172a;
    border: 2px solid #ca8a04;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 900;
    color: #eab308;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  }

  .vs-circle.banca-win {
    background: #dc2626;
    color: #fff;
    border-color: #fca5a5;
  }
  .vs-circle.punto-win {
    background: #2563eb;
    color: #fff;
    border-color: #93c5fd;
  }
  .vs-circle.tie-win {
    background: #16a34a;
    color: #fff;
    border-color: #86efac;
  }

  .btn-deal-action {
    background: linear-gradient(135deg, #eab308, #ca8a04);
    color: #0f172a;
    border: none;
    border-radius: 10px;
    padding: 12px 24px;
    font-size: 14px;
    font-weight: 900;
    letter-spacing: 0.5px;
    cursor: pointer;
    box-shadow: 0 6px 16px rgba(202, 138, 4, 0.4);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transition: all 0.15s ease;
  }

  .btn-deal-action:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(202, 138, 4, 0.6);
  }

  .btn-deal-action:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .verdict-banner {
    font-size: 13px;
    font-weight: 800;
    padding: 6px 14px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.6);
    color: #f8fafc;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .verdict-banner.banca-b {
    background: rgba(220, 38, 38, 0.3);
    border-color: #dc2626;
    color: #fca5a5;
  }
  .verdict-banner.punto-b {
    background: rgba(37, 99, 235, 0.3);
    border-color: #2563eb;
    color: #93c5fd;
  }
  .verdict-banner.empate-b {
    background: rgba(22, 163, 74, 0.3);
    border-color: #16a34a;
    color: #86efac;
  }

  /* MANUAL STRIP */
  .manual-input-strip {
    background: rgba(0, 0, 0, 0.4);
    border-radius: 10px;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .manual-input-label {
    font-size: 11px;
    font-weight: 800;
    color: #ca8a04;
  }

  .quick-btn-group {
    display: flex;
    gap: 8px;
  }

  .btn-quick {
    border: none;
    border-radius: 6px;
    padding: 7px 16px;
    font-size: 12px;
    font-weight: 900;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-quick.banca {
    background: #dc2626;
    color: #ffffff;
  }
  .btn-quick.banca:hover { background: #ef4444; }

  .btn-quick.punto {
    background: #2563eb;
    color: #ffffff;
  }
  .btn-quick.punto:hover { background: #3b82f6; }

  .btn-quick.empate {
    background: #16a34a;
    color: #ffffff;
  }
  .btn-quick.empate:hover { background: #22c55e; }

  .quick-options {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .check-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11.5px;
    font-weight: 700;
    color: #cbd5e1;
    cursor: pointer;
  }

  .check-pill input {
    cursor: pointer;
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
  }

  .rm-title {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #f1f5f9;
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
