<script>
  import { onMount } from "svelte";
  import { triggerToast } from "../../controllers/ui.store.js";
  import { masterSalasStore, masterMesasStore, masterJuegosStore } from "../../controllers/master.store.js";
  import { getMesaCamaras } from "../../services/cecomVideo.service.js";

  let salas = [];
  let selectedSalaUuid = "";
  let selectedMesaUuid = "";
  let assignedCameras = [];
  let isLoadingCameras = false;

  // Estado del motor de IA / Juego
  let isAuditing = false;
  let auditLogs = [];
  let isEventDrivenActive = true;

  let currentGameType = "BACCARAT"; // BACCARAT, BLACKJACK, POKER_CARIBENO, TEXAS_BONUS, RULETA

  // Estado de Baccarat
  let baccaratState = {
    puntoCards: [{ rank: "9", suit: "♠", val: 9 }, { rank: "8", suit: "♦", val: 8 }],
    bancaCards: [{ rank: "K", suit: "♣", val: 0 }, { rank: "6", suit: "♥", val: 6 }],
    puntoScore: 7, // (9+8=17 -> 7)
    bancaScore: 6, // (0+6=6)
    winner: "PUNTO GANA (7 contra 6)",
    hasMaldon: false,
    maldonText: ""
  };

  // Estado de Blackjack
  let blackjackState = {
    dealerCards: [{ rank: "10", suit: "♠", val: 10 }, { rank: "7", suit: "♥", val: 7 }],
    dealerTotal: 17,
    dealerStatus: "SE PLANTA EN 17 (Regla Casino Cumplida)",
    playerCards: [{ rank: "A", suit: "♠", val: 11 }, { rank: "K", suit: "♦", val: 10 }],
    playerTotal: 21,
    playerStatus: "BLACKJACK NATURAL (Paga 3:2)",
    hasMaldon: false,
    maldonText: ""
  };

  // Estado de Poker Caribeño
  let pokerCaribenoState = {
    dealerCards: [
      { rank: "A", suit: "♠" },
      { rank: "K", suit: "♦" },
      { rank: "10", suit: "♣" },
      { rank: "7", suit: "♥" },
      { rank: "3", suit: "♠" }
    ],
    qualifies: true,
    qualifyReason: "CASA CALIFICA (Mínimo As y Rey presentes)",
    playerCards: [
      { rank: "Q", suit: "♠" },
      { rank: "Q", suit: "♥" },
      { rank: "8", suit: "♦" },
      { rank: "4", suit: "♣" },
      { rank: "2", suit: "♦" }
    ],
    playerHand: "Par de Damas",
    outcome: "Jugador Gana (Par de Damas vs As-Rey)"
  };

  // Estado de Texas Bonus
  let texasBonusState = {
    communityCards: [
      { rank: "J", suit: "♠" },
      { rank: "10", suit: "♠" },
      { rank: "2", suit: "♦" },
      { rank: "8", suit: "♠" },
      { rank: "A", suit: "♠" }
    ],
    playerCards: [{ rank: "K", suit: "♠" }, { rank: "9", suit: "♠" }],
    dealerCards: [{ rank: "A", suit: "♥" }, { rank: "J", suit: "♦" }],
    playerBest: "Color al As de Picas (A-K-J-10-8 ♠)",
    dealerBest: "Doble Par de Ases y Jotas",
    outcome: "Jugador Gana con Color"
  };

  // Estado de Ruleta Americana
  let ruletaState = {
    winningNumber: 17,
    color: "NEGRO",
    isEven: false,
    dozen: "2da Docena (13-24)",
    column: "2da Columna",
    dollyDetected: true,
    dollyCoord: "X: 420px, Y: 185px (Sector 17)",
    lateBetMaldon: false,
    dropCounterCount: 8, // Conteo de billetes/fichas ingresados al drop
    hotNumbers: [17, 23, 0, 32, 11],
    coldNumbers: [4, 19, 35, 12, 2]
  };

  $: salas = $masterSalasStore || [];

  $: availableMesas = ($masterMesasStore || []).filter(
    m => String(m.sala_uuid || m.sala_id) === String(selectedSalaUuid) && (m.active ?? 1) === 1
  );

  onMount(async () => {
    if (salas.length > 0) {
      selectedSalaUuid = salas[0].uuid || salas[0].id;
      await onSalaChange();
    }
  });

  async function onSalaChange() {
    selectedMesaUuid = "";
    assignedCameras = [];
    if (availableMesas.length > 0) {
      selectedMesaUuid = availableMesas[0].uuid || availableMesas[0].id;
      await onMesaChange();
    }
  }

  async function onMesaChange() {
    if (!selectedMesaUuid) {
      assignedCameras = [];
      return;
    }

    isLoadingCameras = true;
    try {
      const res = await getMesaCamaras(selectedMesaUuid);
      if (res && res.success) {
        assignedCameras = res.data || [];
      }
    } catch (err) {
      console.error("Error cargando cámaras de mesa:", err);
    } finally {
      isLoadingCameras = false;
    }

    // Identificar juego de la mesa para cambiar la vista de auditoría
    const mesaObj = availableMesas.find(m => String(m.uuid || m.id) === String(selectedMesaUuid));
    if (mesaObj) {
      const nom = ((mesaObj.nombre || "") + " " + (mesaObj.juego_nombre || "")).toUpperCase();
      if (nom.includes("RULETA") || nom.includes("ROULETTE")) {
        currentGameType = "RULETA";
      } else if (nom.includes("BLACKJACK") || nom.includes("BJ")) {
        currentGameType = "BLACKJACK";
      } else if (nom.includes("BACCARAT") || nom.includes("PUNTO")) {
        currentGameType = "BACCARAT";
      } else if (nom.includes("TEXAS") || nom.includes("HOLD")) {
        currentGameType = "TEXAS_BONUS";
      } else if (nom.includes("CARIBE") || nom.includes("POKER")) {
        currentGameType = "POKER_CARIBENO";
      }
    }
  }

  function handleTriggerAudit() {
    isAuditing = true;
    triggerToast("Analizando paño estabilizado con IA...", "info");

    setTimeout(() => {
      isAuditing = false;
      const timeStr = new Date().toLocaleTimeString();

      let logItem = {
        time: timeStr,
        mesa: availableMesas.find(m => String(m.uuid || m.id) === String(selectedMesaUuid))?.nombre || "Mesa",
        game: currentGameType,
        result: "",
        status: "NORMAL",
        maldon: "Ninguno"
      };

      if (currentGameType === "BACCARAT") {
        logItem.result = baccaratState.winner;
      } else if (currentGameType === "BLACKJACK") {
        logItem.result = `${blackjackState.playerStatus} | Dealer: ${blackjackState.dealerTotal}`;
      } else if (currentGameType === "POKER_CARIBENO") {
        logItem.result = `${pokerCaribenoState.outcome}`;
      } else if (currentGameType === "TEXAS_BONUS") {
        logItem.result = `${texasBonusState.outcome}`;
      } else if (currentGameType === "RULETA") {
        logItem.result = `Número ${ruletaState.winningNumber} ${ruletaState.color} (Dolly Confirmado)`;
      }

      auditLogs = [logItem, ...auditLogs];
      triggerToast("Jugada auditada exitosamente. Sin irregularidades.", "success");
    }, 600);
  }
</script>

<div class="ia-mesas-container">
  <!-- Header Principal -->
  <div class="view-header">
    <div class="header-left">
      <div class="icon-badge">🎰</div>
      <div>
        <h1 class="header-title">Auditor de Mesas en Vivo (IA CECOM)</h1>
        <p class="header-subtitle">
          Auditoría en tiempo real para juegos de cartas y ruleta americana con visión artificial y reglas de casino.
        </p>
      </div>
    </div>
    <div class="header-badges">
      <span class="badge-tech live">🟢 Modo Event-Driven Activo</span>
      <span class="badge-tech">⚡ 0% CPU en Reposo</span>
      <span class="badge-tech">🎯 10-15 Cámaras Asignadas</span>
    </div>
  </div>

  <!-- Barra de Selección de Mesa y Juego -->
  <div class="selector-card">
    <div class="sel-group">
      <label for="sala-ia-select">1. Sala del Casino:</label>
      <select id="sala-ia-select" bind:value={selectedSalaUuid} on:change={onSalaChange}>
        {#each salas as s}
          <option value={s.uuid || s.id}>{s.nombre}</option>
        {/each}
      </select>
    </div>

    <div class="sel-group flex-2">
      <label for="mesa-ia-select">2. Mesa de Juego a Auditar:</label>
      <select id="mesa-ia-select" bind:value={selectedMesaUuid} on:change={onMesaChange}>
        {#if availableMesas.length === 0}
          <option value="">No hay mesas activas en esta sala</option>
        {:else}
          {#each availableMesas as m}
            <option value={m.uuid || m.id}>
              {m.nombre} - {m.juego_nombre || "Juego de Mesa"}
            </option>
          {/each}
        {/if}
      </select>
    </div>

    <!-- Selector Rápido de Juego -->
    <div class="game-toggle-bar">
      <button type="button" class="btn-game" class:active={currentGameType === 'BACCARAT'} on:click={() => currentGameType = 'BACCARAT'}>
        Baccarat
      </button>
      <button type="button" class="btn-game" class:active={currentGameType === 'BLACKJACK'} on:click={() => currentGameType = 'BLACKJACK'}>
        Blackjack
      </button>
      <button type="button" class="btn-game" class:active={currentGameType === 'POKER_CARIBENO'} on:click={() => currentGameType = 'POKER_CARIBENO'}>
        Poker Caribeño
      </button>
      <button type="button" class="btn-game" class:active={currentGameType === 'TEXAS_BONUS'} on:click={() => currentGameType = 'TEXAS_BONUS'}>
        Texas Bonus
      </button>
      <button type="button" class="btn-game" class:active={currentGameType === 'RULETA'} on:click={() => currentGameType = 'RULETA'}>
        Ruleta Americana
      </button>
    </div>
  </div>

  <!-- Cámaras Asignadas a Esta Mesa -->
  <div class="cameras-strip">
    <span class="strip-label">Cámaras Asignadas ({assignedCameras.length}):</span>
    {#if assignedCameras.length === 0}
      <span class="no-cams-warn">⚠️ Esta mesa no tiene cámaras asignadas. Configúralas en Master Admin ➔ "Mesas & Cámaras (IA)".</span>
    {:else}
      {#each assignedCameras as cam}
        <div class="cam-chip">
          <span class="cam-role-icon">🎥</span>
          <span class="cam-role">Cámara Mesa</span>
          <span class="cam-name">{cam.camara_nombre || `Canal ${cam.numero_canal}`}</span>
          <span class="cam-status-dot"></span>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Grid Principal: Visor IA + Auditoría del Juego -->
  <div class="content-grid">
    <!-- Panel Izquierdo: Simulación de la Visión Computacional -->
    <div class="card feed-card">
      <div class="feed-top">
        <h3 class="feed-title">
          <span class="material-icons-round">visibility</span>
          Visión Computacional Cenital
        </h3>
        <span class="fps-badge">Monitoreo en Vivo • Red LAN</span>
      </div>

      <div class="canvas-feed">
        <div class="feed-overlay">
          {#if currentGameType === "BACCARAT"}
            <div class="ai-box punto-box">
              <span class="box-label">PUNTO [9♠ 98%] [8♦ 99%] = 7</span>
            </div>
            <div class="ai-box banca-box">
              <span class="box-label">BANCA [K♣ 97%] [6♥ 98%] = 6</span>
            </div>
          {:else if currentGameType === "BLACKJACK"}
            <div class="ai-box dealer-box">
              <span class="box-label">DEALER [10♠ 99%] [7♥ 97%] = 17 (STAND)</span>
            </div>
            <div class="ai-box player-box">
              <span class="box-label">JUGADOR 1 [A♠ 99%] [K♦ 99%] = 21 (BJ)</span>
            </div>
          {:else if currentGameType === "RULETA"}
            <div class="ai-box dolly-box">
              <span class="box-label">DOLLY EN CASILLA #17 [NEGRO] 99.4%</span>
            </div>
            <div class="ai-box drop-box">
              <span class="box-label">BUZÓN DROP: {ruletaState.dropCounterCount} Entradas</span>
            </div>
          {:else if currentGameType === "POKER_CARIBENO"}
            <div class="ai-box dealer-box">
              <span class="box-label">DEALER: A♠ K♦ 10♣ 7♥ 3♠ (CALIFICA)</span>
            </div>
          {:else if currentGameType === "TEXAS_BONUS"}
            <div class="ai-box community-box">
              <span class="box-label">COMMUNITY: J♠ 10♠ 2♦ 8♠ A♠ (FLUSH)</span>
            </div>
          {/if}
        </div>
        <div class="table-felt-bg">
          <div class="watermark">WISI IA CASINO AUDITOR</div>
        </div>
      </div>

      <!-- Controles del Feed -->
      <div class="feed-controls">
        <button type="button" class="btn-audit" on:click={handleTriggerAudit} disabled={isAuditing}>
          {#if isAuditing}
            <span>⏳ Auditando Cuadro...</span>
          {:else}
            <span>📸 Capturar & Auditar Jugada</span>
          {/if}
        </button>
      </div>
    </div>

    <!-- Panel Derecho: Motor de Reglas y Decisión del Juego -->
    <div class="card rule-card">
      {#if currentGameType === "BACCARAT"}
        <div class="game-section">
          <h2 class="section-title">🃏 Auditoría Baccarat (Punto y Banca)</h2>

          <div class="score-board">
            <div class="side-box punto">
              <div class="side-title">PUNTO (JUGADOR)</div>
              <div class="cards-row">
                {#each baccaratState.puntoCards as c}
                  <div class="card-chip">{c.rank}{c.suit}</div>
                {/each}
              </div>
              <div class="score-val">Total: {baccaratState.puntoScore}</div>
            </div>

            <div class="vs-divider">VS</div>

            <div class="side-box banca">
              <div class="side-title">BANCA</div>
              <div class="cards-row">
                {#each baccaratState.bancaCards as c}
                  <div class="card-chip">{c.rank}{c.suit}</div>
                {/each}
              </div>
              <div class="score-val">Total: {baccaratState.bancaScore}</div>
            </div>
          </div>

          <div class="verdict-banner success">
            <span class="verdict-icon">🏆</span>
            <div>
              <div class="verdict-text">{baccaratState.winner}</div>
              <div class="verdict-sub">Tableau de 3ra carta auditado: Conforme a reglas internacionales.</div>
            </div>
          </div>
        </div>

      {:else if currentGameType === "BLACKJACK"}
        <div class="game-section">
          <h2 class="section-title">♠️ Auditoría Blackjack</h2>

          <div class="bj-panel">
            <div class="dealer-row">
              <div class="bj-role">CASA / DEALER:</div>
              <div class="cards-row">
                {#each blackjackState.dealerCards as c}
                  <div class="card-chip">{c.rank}{c.suit}</div>
                {/each}
              </div>
              <span class="bj-badge">{blackjackState.dealerStatus}</span>
            </div>

            <div class="player-row">
              <div class="bj-role">JUGADOR 1:</div>
              <div class="cards-row">
                {#each blackjackState.playerCards as c}
                  <div class="card-chip gold">{c.rank}{c.suit}</div>
                {/each}
              </div>
              <span class="bj-badge gold">{blackjackState.playerStatus}</span>
            </div>
          </div>

          <div class="verdict-banner success">
            <span class="verdict-icon">✅</span>
            <div>
              <div class="verdict-text">Pago Correcto: 3 a 2 para Jugador 1</div>
              <div class="verdict-sub">El dealer respetó la parada obligatoria en 17.</div>
            </div>
          </div>
        </div>

      {:else if currentGameType === "POKER_CARIBENO"}
        <div class="game-section">
          <h2 class="section-title">🌴 Auditoría Poker Caribeño</h2>

          <div class="poker-box">
            <div class="hand-row">
              <span class="hand-role">Mano de la Casa (5 cartas):</span>
              <div class="cards-row">
                {#each pokerCaribenoState.dealerCards as c}
                  <div class="card-chip">{c.rank}{c.suit}</div>
                {/each}
              </div>
            </div>
            <div class="qualify-banner" class:qualifies={pokerCaribenoState.qualifies}>
              ⚖️ {pokerCaribenoState.qualifyReason}
            </div>

            <div class="hand-row" style="margin-top: 14px;">
              <span class="hand-role">Mano Jugador:</span>
              <div class="cards-row">
                {#each pokerCaribenoState.playerCards as c}
                  <div class="card-chip gold">{c.rank}{c.suit}</div>
                {/each}
              </div>
              <span class="hand-eval font-bold">{pokerCaribenoState.playerHand}</span>
            </div>
          </div>

          <div class="verdict-banner success">
            <span class="verdict-icon">💰</span>
            <div>
              <div class="verdict-text">{pokerCaribenoState.outcome}</div>
              <div class="verdict-sub">Paga Ante y Raise según tabla oficial de pagos.</div>
            </div>
          </div>
        </div>

      {:else if currentGameType === "TEXAS_BONUS"}
        <div class="game-section">
          <h2 class="section-title">🤠 Auditoría Texas Hold'em Bonus</h2>

          <div class="texas-box">
            <div class="comm-title">Cartas Comunitarias (Flop / Turn / River):</div>
            <div class="cards-row">
              {#each texasBonusState.communityCards as c}
                <div class="card-chip blue">{c.rank}{c.suit}</div>
              {/each}
            </div>

            <div class="hands-split">
              <div class="hand-col">
                <span class="h-label">Hole Cards Jugador:</span>
                <div class="cards-row">
                  {#each texasBonusState.playerCards as c}
                    <div class="card-chip gold">{c.rank}{c.suit}</div>
                  {/each}
                </div>
                <div class="best-txt">{texasBonusState.playerBest}</div>
              </div>

              <div class="hand-col">
                <span class="h-label">Hole Cards Dealer:</span>
                <div class="cards-row">
                  {#each texasBonusState.dealerCards as c}
                    <div class="card-chip">{c.rank}{c.suit}</div>
                  {/each}
                </div>
                <div class="best-txt">{texasBonusState.dealerBest}</div>
              </div>
            </div>
          </div>

          <div class="verdict-banner success">
            <span class="verdict-icon">🏆</span>
            <div>
              <div class="verdict-text">{texasBonusState.outcome}</div>
              <div class="verdict-sub">Jerarquía de manos validada por el motor de reglas.</div>
            </div>
          </div>
        </div>

      {:else if currentGameType === "RULETA"}
        <div class="game-section">
          <h2 class="section-title">🎡 Auditoría Ruleta Americana & Dolly</h2>

          <div class="ruleta-panel">
            <div class="dolly-display">
              <div class="dolly-ball black">
                {ruletaState.winningNumber}
              </div>
              <div class="dolly-meta">
                <div class="dolly-stat"><strong>Número Ganador:</strong> {ruletaState.winningNumber} ({ruletaState.color})</div>
                <div class="dolly-stat"><strong>Docena:</strong> {ruletaState.dozen}</div>
                <div class="dolly-stat"><strong>Columna:</strong> {ruletaState.column}</div>
                <div class="dolly-pos">📍 {ruletaState.dollyCoord}</div>
              </div>
            </div>

            <!-- Hot and Cold Numbers -->
            <div class="hot-cold-container">
              <div class="hot-col">
                <span class="hc-label hot">🔥 Números Calientes:</span>
                <div class="num-row">
                  {#each ruletaState.hotNumbers as n}
                    <span class="hc-badge hot">{n}</span>
                  {/each}
                </div>
              </div>
              <div class="cold-col">
                <span class="hc-label cold">❄️ Números Fríos:</span>
                <div class="num-row">
                  {#each ruletaState.coldNumbers as n}
                    <span class="hc-badge cold">{n}</span>
                  {/each}
                </div>
              </div>
            </div>

            <!-- Contador de Drop -->
            <div class="drop-monitor">
              <span class="drop-icon">💵</span>
              <div class="drop-info">
                <strong>Auditor de Buzón de Drop:</strong>
                <span>{ruletaState.dropCounterCount} ingresos de efectivo detectados en el turno.</span>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- Historial de Auditorías en Vivo -->
  <div class="card history-card">
    <div class="hist-header">
      <h3 class="hist-title">
        <span class="material-icons-round">history</span>
        Registro de Auditorías e Incidencias en Vivo ({auditLogs.length})
      </h3>
      {#if auditLogs.length > 0}
        <button type="button" class="btn-clear-hist" on:click={() => auditLogs = []}>
          Limpiar Historial
        </button>
      {/if}
    </div>

    {#if auditLogs.length === 0}
      <div class="empty-hist">
        <span>📋</span>
        <p>No hay jugadas auditadas en esta sesión. Pulsa "Capturar & Auditar Jugada" para registrar eventos.</p>
      </div>
    {:else}
      <div class="table-wrap">
        <table class="audit-table">
          <thead>
            <tr>
              <th>Hora</th>
              <th>Mesa</th>
              <th>Juego</th>
              <th>Resultado / Jugada</th>
              <th>Estado Reglas</th>
              <th>Alerta Maldón</th>
            </tr>
          </thead>
          <tbody>
            {#each auditLogs as log}
              <tr class:row-maldon={log.status === 'MALDÓN'}>
                <td class="font-mono">{log.time}</td>
                <td><strong>{log.mesa}</strong></td>
                <td><span class="game-tag">{log.game}</span></td>
                <td>{log.result}</td>
                <td>
                  <span class="status-pill" class:maldon={log.status === 'MALDÓN'}>
                    {log.status}
                  </span>
                </td>
                <td class:text-danger={log.status === 'MALDÓN'}>
                  {log.maldon}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

<style>
  .ia-mesas-container {
    padding: 24px;
    max-width: 1400px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .view-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #ffffff;
    padding: 20px 24px;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 2px 4px rgba(0,0,0,0.03);
    flex-wrap: wrap;
    gap: 16px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .icon-badge {
    font-size: 32px;
    background: #fef3c7;
    padding: 10px;
    border-radius: 12px;
    border: 1px solid #fde68a;
  }

  .header-title {
    margin: 0;
    font-size: 20px;
    font-weight: 800;
    color: #0f172a;
  }

  .header-subtitle {
    margin: 4px 0 0 0;
    font-size: 13px;
    color: #64748b;
  }

  .header-badges {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .badge-tech {
    font-size: 11.5px;
    font-weight: 700;
    padding: 6px 12px;
    border-radius: 20px;
    background: #f1f5f9;
    color: #334155;
    border: 1px solid #cbd5e1;
  }

  .badge-tech.live {
    background: #ecfdf5;
    color: #047857;
    border-color: #a7f3d0;
  }

  /* Selector Card */
  .selector-card {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    padding: 18px 24px;
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
    box-shadow: 0 2px 4px rgba(0,0,0,0.03);
  }

  .sel-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .flex-2 {
    flex: 1;
    min-width: 240px;
  }

  .sel-group label {
    font-size: 11.5px;
    font-weight: 700;
    color: #475569;
    text-transform: uppercase;
  }

  .sel-group select {
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    font-size: 13.5px;
    font-weight: 700;
    color: #0f172a;
    outline: none;
  }

  .game-toggle-bar {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-left: auto;
  }

  .btn-game {
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #334155;
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-game.active {
    background: #2563eb;
    color: #ffffff;
    border-color: #2563eb;
  }

  /* Cameras Strip */
  .cameras-strip {
    display: flex;
    align-items: center;
    gap: 10px;
    background: #f8fafc;
    padding: 12px 18px;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
    flex-wrap: wrap;
  }

  .strip-label {
    font-size: 12px;
    font-weight: 800;
    color: #475569;
  }

  .no-cams-warn {
    font-size: 12px;
    color: #b45309;
    font-weight: 600;
  }

  .cam-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #ffffff;
    padding: 4px 10px;
    border-radius: 20px;
    border: 1px solid #cbd5e1;
    font-size: 12px;
  }

  .cam-role {
    font-weight: 800;
    color: #2563eb;
    font-size: 10.5px;
  }

  .cam-name {
    color: #334155;
    font-weight: 600;
  }

  .cam-status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #10b981;
  }

  /* Grid */
  .content-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
  }

  @media (max-width: 1024px) {
    .content-grid {
      grid-template-columns: 1fr;
    }
  }

  .card {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    padding: 22px;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.04);
  }

  /* Feed Card */
  .feed-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
  }

  .feed-title {
    margin: 0;
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .fps-badge {
    font-size: 11px;
    font-weight: 700;
    background: #ecfdf5;
    color: #047857;
    padding: 3px 8px;
    border-radius: 12px;
  }

  .canvas-feed {
    position: relative;
    width: 100%;
    height: 280px;
    background: #064e3b;
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid #047857;
  }

  .watermark {
    font-size: 14px;
    font-weight: 900;
    color: rgba(255,255,255,0.15);
    letter-spacing: 2px;
  }

  .feed-overlay {
    position: absolute;
    inset: 0;
    padding: 16px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    pointer-events: none;
  }

  .ai-box {
    border: 2px solid #22c55e;
    background: rgba(34, 197, 94, 0.15);
    padding: 6px 10px;
    border-radius: 6px;
    display: inline-block;
    align-self: flex-start;
  }

  .ai-box.banca-box, .ai-box.player-box {
    align-self: flex-end;
    border-color: #38bdf8;
    background: rgba(56, 189, 248, 0.15);
  }

  .ai-box.dolly-box {
    align-self: center;
    border-color: #f59e0b;
    background: rgba(245, 158, 11, 0.25);
  }

  .box-label {
    font-size: 11px;
    font-weight: 800;
    color: #ffffff;
    text-shadow: 0 1px 3px rgba(0,0,0,0.8);
    font-family: ui-monospace, SFMono-Regular, monospace;
  }

  .feed-controls {
    display: flex;
    gap: 12px;
    margin-top: 16px;
  }

  .btn-audit {
    flex: 1;
    padding: 12px;
    background: linear-gradient(135deg, #059669, #047857);
    color: #ffffff;
    border: none;
    border-radius: 8px;
    font-weight: 800;
    font-size: 13.5px;
    cursor: pointer;
    box-shadow: 0 4px 10px rgba(5, 150, 105, 0.3);
  }

  .btn-sim-maldon {
    padding: 12px 16px;
    background: #fef2f2;
    color: #dc2626;
    border: 1px solid #fecaca;
    border-radius: 8px;
    font-weight: 700;
    font-size: 12.5px;
    cursor: pointer;
  }

  /* Rule Card */
  .section-title {
    margin: 0 0 18px 0;
    font-size: 16px;
    font-weight: 800;
    color: #0f172a;
  }

  .cards-row {
    display: flex;
    gap: 8px;
    margin: 8px 0;
  }

  .card-chip {
    padding: 8px 14px;
    background: #ffffff;
    color: #0f172a;
    border-radius: 6px;
    font-weight: 800;
    font-size: 15px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.15);
    border: 1px solid #cbd5e1;
    font-family: ui-monospace, SFMono-Regular, monospace;
  }

  .card-chip.gold {
    border-color: #f59e0b;
    background: #fffbeb;
  }

  .card-chip.blue {
    border-color: #3b82f6;
    background: #eff6ff;
  }

  .score-board {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 18px;
  }

  .side-box {
    flex: 1;
    background: #f8fafc;
    padding: 14px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    text-align: center;
  }

  .side-title {
    font-size: 12px;
    font-weight: 800;
    color: #475569;
  }

  .score-val {
    font-size: 18px;
    font-weight: 900;
    color: #0f172a;
    margin-top: 6px;
  }

  .vs-divider {
    font-weight: 900;
    color: #94a3b8;
    font-size: 14px;
  }

  .verdict-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 18px;
    border-radius: 8px;
    background: #ecfdf5;
    border-left: 5px solid #10b981;
  }

  .verdict-icon {
    font-size: 26px;
  }

  .verdict-text {
    font-size: 14px;
    font-weight: 800;
    color: #065f46;
  }

  .verdict-sub {
    font-size: 12px;
    color: #047857;
    margin-top: 2px;
  }

  /* Ruleta */
  .dolly-display {
    display: flex;
    align-items: center;
    gap: 18px;
    background: #f8fafc;
    padding: 16px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    margin-bottom: 14px;
  }

  .dolly-ball {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    font-size: 24px;
    font-weight: 900;
    box-shadow: 0 4px 10px rgba(0,0,0,0.3);
  }

  .dolly-ball.black {
    background: #0f172a;
    border: 3px solid #f59e0b;
  }

  .dolly-meta {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 13px;
  }

  .dolly-pos {
    font-size: 11px;
    color: #64748b;
    font-family: ui-monospace, monospace;
    margin-top: 4px;
  }

  .hot-cold-container {
    display: flex;
    gap: 16px;
    margin-bottom: 14px;
  }

  .hot-col, .cold-col {
    flex: 1;
    background: #f8fafc;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
  }

  .hc-label {
    font-size: 11px;
    font-weight: 800;
    display: block;
    margin-bottom: 6px;
  }

  .hc-label.hot { color: #dc2626; }
  .hc-label.cold { color: #0284c7; }

  .num-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .hc-badge {
    padding: 3px 8px;
    border-radius: 6px;
    font-weight: 800;
    font-size: 12px;
  }

  .hc-badge.hot { background: #fee2e2; color: #991b1b; }
  .hc-badge.cold { background: #e0f2fe; color: #075985; }

  .drop-monitor {
    display: flex;
    align-items: center;
    gap: 12px;
    background: #faf5ff;
    padding: 12px 16px;
    border-radius: 8px;
    border-left: 4px solid #7c3aed;
  }

  .drop-icon {
    font-size: 24px;
  }

  .drop-info {
    display: flex;
    flex-direction: column;
    font-size: 12.5px;
    color: #4c1d95;
  }

  /* History Table */
  .hist-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
  }

  .hist-title {
    margin: 0;
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-clear-hist {
    background: none;
    border: 1px solid #cbd5e1;
    color: #64748b;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
  }

  .empty-hist {
    text-align: center;
    padding: 30px;
    color: #94a3b8;
    font-size: 13px;
  }

  .empty-hist span {
    font-size: 32px;
    display: block;
    margin-bottom: 6px;
  }

  .table-wrap {
    overflow-x: auto;
  }

  .audit-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }

  .audit-table th {
    background: #f8fafc;
    padding: 10px 14px;
    text-align: left;
    font-weight: 800;
    color: #475569;
    border-bottom: 2px solid #e2e8f0;
  }

  .audit-table td {
    padding: 10px 14px;
    border-bottom: 1px solid #e2e8f0;
  }

  .row-maldon {
    background: #fef2f2 !important;
  }

  .game-tag {
    background: #f1f5f9;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 700;
    font-size: 11px;
    color: #334155;
  }

  .status-pill {
    padding: 3px 8px;
    border-radius: 12px;
    font-weight: 800;
    font-size: 11px;
    background: #ecfdf5;
    color: #047857;
  }

  .status-pill.maldon {
    background: #fee2e2;
    color: #991b1b;
  }

  .text-danger {
    color: #dc2626;
    font-weight: 700;
  }

  .font-mono {
    font-family: ui-monospace, SFMono-Regular, monospace;
  }

  .font-bold {
    font-weight: 800;
  }
</style>
