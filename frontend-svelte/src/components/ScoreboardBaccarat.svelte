<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { selectedSalaStore, userSalasStore } from '../controllers/auth.store.js';
  import { masterSalasStore, masterMesasStore } from '../controllers/master.store.js';
  import { navigateToRoute } from '../controllers/router.store.js';
  import { toBackendUrl } from '../config/api.config.js';
  import {
    getLocalItems,
    saveLocalItems,
    upsertLocalItem,
    deleteLocalItem,
    generateSafeUuid
  } from '../services/localDb.service.js';
  import {
    sendWebSocketMessage,
    latestBaccaratUpdateStore,
    isWsConnectedStore,
    initWebSocketConnection
  } from '../controllers/websocket.store.js';

  export let salaId = null;
  export let mesaId = null;
  export let isModal = false;
  const dispatch = createEventDispatcher();

  // Unique client identifier for real-time WebSocket synchronization
  const myClientId = 'bacc_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now();
  let unsubscribeWs = null;

  // Tie visualization mode: 'slash' (rayitas diagonales) | 'circle' (círculos verdes en columna)
  let tieMode = 'slash';

  // Sesiones de Libro Score Baccarat (Persistencia Global y por Mesa)
  let sessions = []; // [{ id, uuid, sala_id, fecha, estado, created_at, updated_at }]
  let selectedSessionIndex = -1;
  let isSessionsLoading = false;
  let activeSessionId = null;

  function getTodayStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getNextDateStr(dateStr) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return getTodayStr();
    }
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + 1));
    const ny = date.getUTCFullYear();
    const nm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const nd = String(date.getUTCDate()).padStart(2, '0');
    return `${ny}-${nm}-${nd}`;
  }

  $: currentSession = (sessions && selectedSessionIndex >= 0 && selectedSessionIndex < sessions.length)
    ? sessions[selectedSessionIndex]
    : null;

  $: latestSessionInList = sessions.length > 0 ? sessions[sessions.length - 1] : null;

  // Solo la última sesión permite jugar y editar (sesiones anteriores son histórico de solo lectura)
  $: isLatestSession = sessions.length > 0 && selectedSessionIndex === (sessions.length - 1);

  $: nextSessionDateStr = latestSessionInList ? getNextDateStr(latestSessionInList.fecha) : getTodayStr();

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
  $: sessionUuid = currentSession?.uuid || (currentSession?.id ? String(currentSession.id) : null);
  $: storageKey = `wisi_baccarat_shoe_v3_${currentSalaObj?.uuid || currentSalaObj?.id || 'default'}_${currentMesaObj?.uuid || currentMesaObj?.id || currentMesaId || 'default'}${sessionUuid ? `_sess_${sessionUuid}` : ''}`;

  let lastLoadedStorageKey = null;
  $: if (storageKey && storageKey !== lastLoadedStorageKey) {
    lastLoadedStorageKey = storageKey;
    if (sessionUuid && currentMesaId) {
      loadMesaDataForSession(sessionUuid, currentMesaId);
    }
  }

  let lastFetchedSalaId = null;
  $: if (currentSalaId && currentSalaId !== lastFetchedSalaId) {
    lastFetchedSalaId = currentSalaId;
    fetchSessions(currentSalaId);
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
  let activeShoeNumber = 1;
  let activeShoeIndex = 0;
  let shoes = [{ shoe_number: 1, history: [], tie_mode: 'slash' }];
  let history = []; // [{ id, winner: 'PUNTO'|'BANCA'|'EMPATE', bPair, pPair, natural, special, time }]

  $: maxShoeNumber = shoes.length > 0 ? Math.max(...shoes.map(s => Number(s.shoe_number) || 1), 1) : 1;
  $: isViewingPastShoe = activeShoeNumber < maxShoeNumber;
  $: isCurrentShoeActive = isLatestSession && !isViewingPastShoe;

  // Keypad Staging Modifiers & Score
  let activePPair = false;
  let activeBPair = false;
  let activeSpecial = false;
  let activeWin = false;
  let activeScore = null; // null | 0..9

  function selectScore(num) {
    if (!isCurrentShoeActive) return;
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

  // Dynamic dimensions for 100% edge-to-edge coverage of grids
  let bigRoadWidth = 1400;
  let bigRoadHeight = 260;
  let beadWidth = 700;
  let beadHeight = 260;
  let derivedWidth = 700;
  let derivedHeight = 260;

  const BEAD_ROWS = 6;
  const BIG_ROWS = 6;
  const DERIVED_ROWS = 6;

  // Exact 1:1 square cell sizes based on container height (6 rows each)
  $: bigRoadCellSize = Math.max(Math.floor(((bigRoadHeight || 240) - 2) / 6), 28);
  $: bigRoadColsNeeded = Math.max(Math.ceil((bigRoadWidth || 1200) / bigRoadCellSize) + 1, 30);

  $: beadCellSize = Math.max(Math.floor(((beadHeight || 240) - 2) / 6), 28);
  $: beadColsNeeded = Math.max(Math.ceil((beadWidth || 600) / beadCellSize) + 1, 16);

  // Derived roads: each of the 3 bands has 6 rows (total 18 rows)
  $: derivedBandHeight = (derivedHeight || 240) / 3;
  $: derivedCellSize = Math.max(Math.floor((derivedBandHeight - 2) / 6), 11);
  $: derivedColsNeeded = Math.max(Math.ceil((derivedWidth || 600) / derivedCellSize) + 1, 36);

  function safeJsonParse(val, fallback = []) {
    if (val === null || val === undefined) return fallback;
    if (typeof val === 'object') return val;
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val);
        if (typeof parsed === 'string') {
          try { return JSON.parse(parsed); } catch { return parsed; }
        }
        return parsed;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }

  function applyMesaData(data) {
    if (!data) {
      shoes = [{ shoe_number: 1, history: [], tie_mode: 'slash' }];
      activeShoeIndex = 0;
      activeShoeNumber = 1;
      shoeNumber = 1;
      history = [];
      tieMode = 'slash';
      selectedHandIndex = null;
      return;
    }

    const rawShoes = safeJsonParse(data.shoes, []);
    const rawHistory = safeJsonParse(data.history, []);

    let sList = [];
    if (Array.isArray(rawShoes) && rawShoes.length > 0) {
      sList = rawShoes.map(s => ({
        ...s,
        shoe_number: Number(s.shoe_number) || 1,
        tie_mode: s.tie_mode || 'slash',
        history: Array.isArray(s.history) ? s.history : safeJsonParse(s.history, [])
      }));
    } else {
      const sNum = Math.max(1, Number(data.shoe_number) || 1);
      const h = Array.isArray(rawHistory) ? rawHistory : [];
      sList = [{ shoe_number: sNum, tie_mode: data.tie_mode || 'slash', history: h }];
    }

    // Asegurar que siempre exista al menos el Zapato #1
    if (!sList.some(s => s.shoe_number === 1)) {
      sList.unshift({ shoe_number: 1, history: [], tie_mode: 'slash' });
    }
    sList.sort((a, b) => a.shoe_number - b.shoe_number);
    shoes = sList;

    // Si data especifica shoe_number, buscar ese zapato; de lo contrario seleccionar el último
    const targetShoeNum = Number(data.shoe_number) || (shoes[shoes.length - 1]?.shoe_number || 1);
    const foundIdx = shoes.findIndex(s => s.shoe_number === targetShoeNum);
    activeShoeIndex = foundIdx >= 0 ? foundIdx : shoes.length - 1;

    const activeS = shoes[activeShoeIndex] || { shoe_number: 1, history: [], tie_mode: 'slash' };
    shoeNumber = activeS.shoe_number;
    activeShoeNumber = activeS.shoe_number;
    history = Array.isArray(activeS.history) ? activeS.history : [];
    tieMode = activeS.tie_mode || 'slash';
    selectedHandIndex = null;
  }

  function goToPrevShoe() {
    if (activeShoeIndex > 0) {
      switchShoe(activeShoeIndex - 1);
    }
  }

  function goToNextShoe() {
    if (activeShoeIndex < shoes.length - 1) {
      switchShoe(activeShoeIndex + 1);
    }
  }

  function switchShoe(newIndex) {
    if (newIndex < 0 || newIndex >= shoes.length) return;
    // Si estábamos en el zapato activo y se editaron manos, sincronizar en shoes
    if (isLatestSession && activeShoeNumber === maxShoeNumber) {
      const currIdx = shoes.findIndex(s => s.shoe_number === activeShoeNumber);
      if (currIdx >= 0) {
        shoes[currIdx] = { shoe_number: activeShoeNumber, history, tie_mode: tieMode };
      }
    }
    activeShoeIndex = newIndex;
    const targetShoe = shoes[activeShoeIndex];
    if (targetShoe) {
      activeShoeNumber = targetShoe.shoe_number;
      shoeNumber = targetShoe.shoe_number;
      history = Array.isArray(targetShoe.history) ? targetShoe.history : [];
      tieMode = targetShoe.tie_mode || 'slash';
      selectedHandIndex = null;
    }
  }

  function loadSavedShoe() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        applyMesaData(parsed);
      } else {
        applyMesaData(null);
      }
    } catch (e) {
      console.warn('Error al cargar zapato guardado', e);
      applyMesaData(null);
    }
  }

  async function loadSessionsFromLocalDb(sId) {
    if (!sId) return false;
    try {
      const local = await getLocalItems(
        'record_libro_score_baccarat',
        item => String(item.sala_id || item.sala_uuid) === String(sId),
        'fecha',
        'asc'
      );
      if (Array.isArray(local) && local.length > 0) {
        sessions = local;
        if (selectedSessionIndex === -1 || selectedSessionIndex >= sessions.length) {
          selectedSessionIndex = sessions.length - 1;
        }
        const activeSess = sessions[selectedSessionIndex];
        if (activeSess) {
          activeSessionId = activeSess.uuid || activeSess.id;
        }
        return true;
      }
    } catch (e) {
      console.warn('Error al cargar sesiones de base de datos local:', e);
    }
    return false;
  }

  async function fetchSessions(sId, selectLatest = true) {
    if (!sId) return;
    // 1. Cargar sesiones desde la base de datos interna local (Local-First)
    await loadSessionsFromLocalDb(sId);

    try {
      isSessionsLoading = true;
      const res = await fetch(toBackendUrl(`/api/baccarat/sessions?sala_id=${encodeURIComponent(sId)}`));
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data) && json.data.length > 0) {
          sessions = json.data;

          // Guardar en base de datos interna local (IndexedDB)
          await saveLocalItems('record_libro_score_baccarat', sessions);

          if (selectLatest || selectedSessionIndex === -1 || selectedSessionIndex >= sessions.length) {
            selectedSessionIndex = sessions.length - 1;
          }
          const activeSess = sessions[selectedSessionIndex];
          if (activeSess) {
            activeSessionId = activeSess.uuid || activeSess.id;
            await loadMesaDataForSession(activeSessionId, currentMesaId);
          }
        }
      }
    } catch (e) {
      console.warn('Error fetching baccarat sessions from backend:', e);
    } finally {
      isSessionsLoading = false;
    }
  }

  async function loadMesaDataForSession(sId, mId) {
    if (!sId || !mId) return;
    const strSessId = String(sId);
    const strMesaId = String(mId);

    try {
      // 1. Cargar primero de la base de datos interna local (Local-First IndexedDB) por sesión estricta
      const localRows = await getLocalItems(
        'record_libro_score_baccarat_mesa',
        item => (String(item.session_uuid || item.session_id) === strSessId) &&
                (String(item.mesa_id || item.mesa_uuid) === strMesaId)
      );
      if (Array.isArray(localRows) && localRows.length > 0) {
        applyMesaData(localRows[0]);
      }

      // 2. Sincronizar con el backend PostgreSQL (Fuente autoritativa)
      const res = await fetch(toBackendUrl(`/api/baccarat/mesa-data?session_id=${encodeURIComponent(strSessId)}&mesa_id=${encodeURIComponent(strMesaId)}`));
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          applyMesaData(json.data);

          // Purgar cualquier residuo de clave legacy un-namespaced
          const baseLegacyKey = `wisi_baccarat_shoe_v3_${currentSalaObj?.uuid || currentSalaObj?.id || 'default'}_${currentMesaObj?.uuid || currentMesaObj?.id || currentMesaId || 'default'}`;
          try {
            localStorage.removeItem(baseLegacyKey);
          } catch (e) {}

          // Guardar en la base de datos interna local (IndexedDB) aislado para esta sesión
          await upsertLocalItem('record_libro_score_baccarat_mesa', {
            uuid: json.data.uuid || `bacc_mesa_${strSessId}_${strMesaId}`,
            session_uuid: strSessId,
            session_id: strSessId,
            mesa_id: strMesaId,
            shoe_number: shoeNumber,
            tie_mode: tieMode,
            history,
            shoes
          }).catch(() => {});

          try {
            localStorage.setItem(storageKey, JSON.stringify({
              shoeNumber,
              history,
              shoes,
              tieMode,
              sessionId: strSessId
            }));
          } catch (e) {}
          return;
        }
      }
    } catch (e) {
      console.warn('Error loading mesa data from backend:', e);
    }
  }

  async function goToPrevSession() {
    if (selectedSessionIndex > 0 && !isSessionsLoading) {
      // Guardar el zapato actual antes de cambiar de sesión
      if (isCurrentShoeActive) {
        saveShoe(true);
      }
      selectedSessionIndex--;
      const sess = sessions[selectedSessionIndex];
      if (sess) {
        activeSessionId = sess.uuid || (sess.id ? String(sess.id) : null);
        await loadMesaDataForSession(activeSessionId, currentMesaId);
      }
    }
  }

  async function goToNextSession() {
    if (selectedSessionIndex < sessions.length - 1 && !isSessionsLoading) {
      if (isCurrentShoeActive) {
        saveShoe(true);
      }
      selectedSessionIndex++;
      const sess = sessions[selectedSessionIndex];
      if (sess) {
        activeSessionId = sess.uuid || (sess.id ? String(sess.id) : null);
        await loadMesaDataForSession(activeSessionId, currentMesaId);
      }
    }
  }

  async function handleCreateNewSession() {
    if (!currentSalaId || isSessionsLoading || !isLatestSession) return;
    try {
      isSessionsLoading = true;
      // Guardar la sesión y zapato actuales antes de crear la nueva sesión
      saveShoe(true);

      const clientGeneratedUuid = generateSafeUuid();
      const res = await fetch(toBackendUrl('/api/baccarat/sessions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sala_id: currentSalaId,
          uuid: clientGeneratedUuid
        })
      });
      const json = await res.json();
      if (json.success && json.data) {
        const newSession = json.data;

        // Guardar en la base de datos interna local (IndexedDB)
        await upsertLocalItem('record_libro_score_baccarat', newSession);

        sessions = [...sessions, newSession];
        selectedSessionIndex = sessions.length - 1;
        activeSessionId = newSession.uuid || newSession.id;

        // Inicializar mesa limpia EXCLUSIVAMENTE para la nueva sesión
        shoeNumber = 1;
        activeShoeNumber = 1;
        activeShoeIndex = 0;
        history = [];
        shoes = [{ shoe_number: 1, history: [], tie_mode: 'slash' }];
        activeScore = null;
        activePPair = false;
        activeBPair = false;
        activeSpecial = false;
        activeWin = false;
        selectedHandIndex = null;

        // Persistir explícitamente el nuevo registro de mesa con el UUID de la NUEVA sesión
        const newSessUuid = newSession.uuid || newSession.id;
        const newMesaRecord = {
          uuid: generateSafeUuid(),
          session_uuid: newSessUuid,
          session_id: newSessUuid,
          mesa_id: currentMesaId,
          shoe_number: 1,
          tie_mode: 'slash',
          history: [],
          shoes: [{ shoe_number: 1, history: [], tie_mode: 'slash' }]
        };

        // Guardar mesa limpia [] en la base de datos local interna (IndexedDB)
        await upsertLocalItem('record_libro_score_baccarat_mesa', newMesaRecord).catch(() => {});

        // Clave de almacenamiento aislada para la nueva sesión
        const newStorageKey = `wisi_baccarat_shoe_v3_${currentSalaObj?.uuid || currentSalaObj?.id || 'default'}_${currentMesaObj?.uuid || currentMesaObj?.id || currentMesaId || 'default'}_sess_${newSessUuid}`;
        lastLoadedStorageKey = newStorageKey;
        try {
          localStorage.setItem(newStorageKey, JSON.stringify({
            shoeNumber: 1,
            history: [],
            shoes: [{ shoe_number: 1, history: [], tie_mode: 'slash' }],
            tieMode: 'slash',
            sessionId: newSessUuid
          }));
        } catch (e) {}

        await fetch(toBackendUrl('/api/baccarat/mesa-data'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newMesaRecord)
        }).catch(e => console.warn('Advertencia guardando nueva mesa:', e));

        closeOptionsMenu();
        showFeedback(`¡Nueva sesión creada! (${newSession.fecha})`);
      } else {
        alert(json.message || 'Error al crear nueva sesión');
      }
    } catch (e) {
      console.error('Error al crear nueva sesión:', e);
      alert('Error de conexión al crear nueva sesión');
    } finally {
      isSessionsLoading = false;
    }
  }

  function handleConfirmDeleteLastSession() {
    if (sessions.length <= 1) {
      alert('No se puede borrar la sesión porque debe haber al menos una registrada.');
      return;
    }
    const target = sessions[sessions.length - 1];
    openConfirmModal({
      title: 'Borrar Última Sesión',
      question: `¿Está seguro de que desea borrar la última sesión (${target.fecha})? Esta acción no se puede deshacer y se seleccionará la sesión anterior.`,
      isDanger: true,
      confirmText: 'Borrar Sesión',
      onConfirm: async () => {
        try {
          isSessionsLoading = true;

          // Eliminar de base de datos interna local
          if (target.uuid) {
            await deleteLocalItem('record_libro_score_baccarat', target.uuid);
          }
          if (target.id) {
            await deleteLocalItem('record_libro_score_baccarat', target.id);
          }

          const res = await fetch(toBackendUrl('/api/baccarat/sessions/delete-last'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sala_id: currentSalaId })
          });
          const json = await res.json();
          if (json.success) {
            sessions = sessions.slice(0, -1);
            selectedSessionIndex = sessions.length - 1;
            const activeSess = sessions[selectedSessionIndex];
            if (activeSess) {
              activeSessionId = activeSess.uuid || activeSess.id;
              await loadMesaDataForSession(activeSessionId, currentMesaId);
              showFeedback(`Última sesión eliminada. Sesión activa: ${activeSess.fecha}`);
            }
            closeOptionsMenu();
          } else {
            alert(json.message || 'Error al borrar última sesión');
          }
        } catch (e) {
          console.error('Error al borrar última sesión:', e);
          alert('Error de conexión al borrar última sesión');
        } finally {
          isSessionsLoading = false;
        }
      }
    });
  }

  function broadcastTableUpdate() {
    if (!isCurrentShoeActive) return; // Solo sincronizar en tiempo real si es el zapato activo de la última sesión
    const sessUuid = currentSession?.uuid || (currentSession?.id ? String(currentSession.id) : null);
    sendWebSocketMessage({
      type: 'BACCARAT_TABLE_UPDATE',
      storageKey,
      salaId: currentSalaId,
      salaUuid: currentSalaObj?.uuid || currentSalaId,
      mesaId: currentMesaId,
      mesaUuid: currentMesaObj?.uuid || currentMesaId,
      sessionId: sessUuid,
      sessionUuid: sessUuid,
      isLatestSession: true,
      shoeNumber,
      shoes,
      history,
      tieMode,
      senderClientId: myClientId,
      timestamp: Date.now()
    });
  }

  function saveShoe(skipBroadcast = false) {
    if (!isCurrentShoeActive) {
      // Las sesiones anteriores o zapatos anteriores son histórico de solo lectura
      return;
    }

    const sessUuid = currentSession?.uuid || (currentSession?.id ? String(currentSession.id) : null);
    if (!sessUuid || !currentMesaId) return;

    // Actualizar el zapato activo en el arreglo shoes
    const currIdx = shoes.findIndex(s => s.shoe_number === shoeNumber);
    if (currIdx >= 0) {
      shoes[currIdx] = { shoe_number: shoeNumber, history, tie_mode: tieMode };
    } else {
      shoes.push({ shoe_number: shoeNumber, history, tie_mode: tieMode });
    }
    shoes = [...shoes];

    const mesaRecordUuid = `bacc_mesa_${sessUuid}_${currentMesaId}`;

    try {
      localStorage.setItem(storageKey, JSON.stringify({
        shoeNumber,
        history,
        shoes,
        tieMode,
        sessionId: sessUuid
      }));
    } catch (e) {}

    // 1. Guardar de inmediato en la base de datos interna local (Local-First IndexedDB)
    upsertLocalItem('record_libro_score_baccarat_mesa', {
      uuid: mesaRecordUuid,
      session_uuid: sessUuid,
      session_id: sessUuid,
      mesa_id: currentMesaId,
      shoe_number: shoeNumber,
      tie_mode: tieMode,
      history,
      shoes
    }).catch(err => console.warn('Advertencia guardando en base de datos interna local:', err));

    if (!skipBroadcast) {
      broadcastTableUpdate();
    }

    // 2. Persistir directamente en la base de datos PostgreSQL en el backend
    fetch(toBackendUrl('/api/baccarat/mesa-data'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uuid: mesaRecordUuid,
        session_id: sessUuid,
        session_uuid: sessUuid,
        mesa_id: currentMesaId,
        shoe_number: shoeNumber,
        tie_mode: tieMode,
        history,
        shoes
      })
    }).catch(e => console.warn('Advertencia guardando mesa en base de datos:', e));
  }

  function toggleTieMode() {
    playSound('click');
    tieMode = tieMode === 'slash' ? 'circle' : 'slash';
    if (shoes && shoes[activeShoeIndex]) {
      shoes[activeShoeIndex].tie_mode = tieMode;
    }
    if (isCurrentShoeActive) {
      saveShoe();
    }
  }

  // Solicitar estado actualizado de la mesa al conectar o cambiar de mesa (estrictamente por sesión)
  $: if ($isWsConnectedStore && isLatestSession && currentSalaId && currentMesaId && sessionUuid) {
    sendWebSocketMessage({
      type: 'BACCARAT_GET_STATE',
      storageKey,
      sessionId: sessionUuid,
      sessionUuid: sessionUuid,
      salaId: currentSalaId,
      salaUuid: currentSalaObj?.uuid || currentSalaId,
      mesaId: currentMesaId,
      mesaUuid: currentMesaObj?.uuid || currentMesaId
    });
  }

  onMount(() => {
    // 1. Limpiar claves legacy y cachés locales antiguos para evitar que contaminen nuevas sesiones
    try {
      if (typeof localStorage !== 'undefined') {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('wisi_baccarat_shoe_v3_')) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
      }
    } catch (e) {}

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
    if (currentSalaId) {
      fetchSessions(currentSalaId);
    } else {
      loadSavedShoe();
    }

    // Asegurar conexión WebSocket activa
    initWebSocketConnection();

    // Sincronización en tiempo real entre múltiples clientes observando/editando la misma mesa
    unsubscribeWs = latestBaccaratUpdateStore.subscribe((update) => {
      if (!update) return;
      if (update.senderClientId === myClientId) return;

      // Verificar si la actualización pertenece a la misma mesa/sala
      const matchesSala = 
        (update.salaId && String(update.salaId) === String(currentSalaId)) ||
        (update.salaUuid && currentSalaObj?.uuid && String(update.salaUuid) === String(currentSalaObj.uuid)) ||
        (update.salaId && currentSalaObj?.uuid && String(update.salaId) === String(currentSalaObj.uuid)) ||
        (update.salaUuid && String(update.salaUuid) === String(currentSalaId));

      const matchesMesa = 
        (update.mesaId && String(update.mesaId) === String(currentMesaId)) ||
        (update.mesaUuid && currentMesaObj?.uuid && String(update.mesaUuid) === String(currentMesaObj.uuid)) ||
        (update.mesaId && currentMesaObj?.uuid && String(update.mesaId) === String(currentMesaObj.uuid)) ||
        (update.mesaUuid && String(update.mesaUuid) === String(currentMesaId));

      // CRITICAL: Verificar que la actualización pertenece EXACTAMENTE a la sesión actual abierta
      const currentSessUuid = currentSession?.uuid || (currentSession?.id ? String(currentSession.id) : null);
      const updateSessUuid = update.sessionUuid || update.sessionId;
      const matchesSession = Boolean(currentSessUuid && updateSessUuid && String(currentSessUuid) === String(updateSessUuid));

      const isCurrentTable = (update.storageKey && update.storageKey === storageKey) || (matchesSala && matchesMesa && matchesSession);

      if (isCurrentTable) {
        // Si el usuario está viendo una sesión histórica o zapato histórico pasado, no sobreescribir la vista actual
        if (!isCurrentShoeActive && !isSessionsLoading) {
          return;
        }

        let changed = false;
        if (Array.isArray(update.shoes) && update.shoes.length > 0) {
          shoes = update.shoes;
          changed = true;
        }
        if (Array.isArray(update.history)) {
          history = update.history;
          changed = true;
        }
        if (update.shoeNumber !== undefined && update.shoeNumber !== null) {
          shoeNumber = update.shoeNumber;
          activeShoeNumber = update.shoeNumber;
          activeShoeIndex = shoes.findIndex(s => s.shoe_number === shoeNumber);
          if (activeShoeIndex === -1) activeShoeIndex = shoes.length - 1;
          changed = true;
        }
        if (update.tieMode && (update.tieMode === 'slash' || update.tieMode === 'circle')) {
          if (tieMode !== update.tieMode) {
            tieMode = update.tieMode;
            changed = true;
          }
        }
        if (changed) {
          // Guardar en caché para esta sesión específica
          const sessUuid = currentSession?.uuid || update.sessionUuid || update.sessionId;
          if (sessUuid && currentMesaId) {
            try {
              localStorage.setItem(storageKey, JSON.stringify({
                shoeNumber,
                history,
                shoes,
                tieMode,
                sessionId: sessUuid
              }));
            } catch (e) {}
          }
        }
      }
    });
  });

  onDestroy(() => {
    if (unsubscribeWs) {
      unsubscribeWs();
    }
    if (isFullscreen) {
      exitAppFullscreen();
    }
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
    if (!isCurrentShoeActive) return;
    playSound('click');
    activePPair = !activePPair;
  }

  function toggleBPair() {
    if (!isCurrentShoeActive) return;
    playSound('click');
    activeBPair = !activeBPair;
  }

  function toggleSpecial() {
    if (!isCurrentShoeActive) return;
    playSound('click');
    activeSpecial = !activeSpecial;
  }

  function toggleWin() {
    if (!isCurrentShoeActive) return;
    playSound('click');
    activeWin = !activeWin;
  }

  function recordOutcome(winner) {
    if (!isCurrentShoeActive) return;
    playSound('win');
    const newRecord = {
      id: history.length + 1,
      winner,
      score: activeScore,
      bPair: activeBPair,
      pPair: activePPair,
      natural: activeWin || activeScore === 8 || activeScore === 9,
      special: activeSpecial,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    history = [...history, newRecord];
    saveShoe();

    // Reset modifier pills and score for the next hand
    activePPair = false;
    activeBPair = false;
    activeSpecial = false;
    activeWin = false;
    activeScore = null;
  }

  function undoLast() {
    if (!isCurrentShoeActive || history.length === 0) return;
    playSound('undo');
    history = history.slice(0, -1);
    if (selectedHandIndex >= history.length) {
      selectedHandIndex = null;
    }
    saveShoe();
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

  function openConfirmModal(opts = {}) {
    confirmModalState = {
      isOpen: true,
      title: opts.title || 'Confirmar Acción',
      question: opts.question || '¿Está seguro?',
      isDanger: opts.isDanger !== false,
      confirmText: opts.confirmText || 'Confirmar',
      onConfirm: opts.onConfirm || (() => {})
    };
  }

  function openOptionsMenu() {
    isOptionsModalOpen = true;
  }

  function closeOptionsMenu() {
    isOptionsModalOpen = false;
  }

  // Acción directa 1: Borrar Registros del Zapato #{activeShoeNumber}
  function handleDirectClearShoe() {
    if (!isLatestSession || isViewingPastShoe || history.length === 0) return;
    playSound('undo');
    history = [];
    selectedHandIndex = null;

    const idx = shoes.findIndex(s => s.shoe_number === shoeNumber);
    if (idx >= 0) {
      shoes[idx].history = [];
    }
    shoes = [...shoes];

    saveShoe();
    showFeedback(`Registros del Zapato #${shoeNumber} borrados`);
    isOptionsModalOpen = false;
  }

  // Acción directa 2: Crear Nuevo Zapato #{maxShoeNumber + 1}
  function handleDirectNewShoe() {
    if (!isLatestSession || history.length === 0) return;
    playSound('click');

    // Asegurar que el zapato actual esté guardado con su historia
    const currIdx = shoes.findIndex(s => s.shoe_number === shoeNumber);
    if (currIdx >= 0) {
      shoes[currIdx] = { shoe_number: shoeNumber, history, tie_mode: tieMode };
    }

    const newNum = maxShoeNumber + 1;
    history = [];
    selectedHandIndex = null;
    shoeNumber = newNum;
    activeShoeNumber = newNum;

    shoes = [...shoes, { shoe_number: newNum, history: [], tie_mode: tieMode }];
    activeShoeIndex = shoes.length - 1;

    saveShoe();
    isOptionsModalOpen = false;
  }

  // Acción con confirmación 3: Borrar Zapato #{shoeNumber}
  function openDeleteCurrentShoeModal() {
    if (!isLatestSession || shoeNumber <= 1 || history.length > 0) return;
    openConfirmModal({
      title: `Borrar Zapato #${shoeNumber}`,
      question: `¿Desea borrar el Zapato #${shoeNumber} y volver al Zapato #${shoeNumber - 1}?`,
      isDanger: true,
      confirmText: 'Borrar Zapato',
      onConfirm: handleConfirmDeleteCurrentShoe
    });
  }

  function handleConfirmDeleteCurrentShoe() {
    if (!isLatestSession || shoeNumber <= 1 || history.length > 0) return;
    playSound('undo');

    // Quitar el zapato actual
    shoes = shoes.filter(s => s.shoe_number !== shoeNumber);
    if (shoes.length === 0) {
      shoes = [{ shoe_number: 1, history: [], tie_mode: 'slash' }];
    }

    // Regresar al zapato anterior
    const prevShoe = shoes[shoes.length - 1];
    shoeNumber = prevShoe.shoe_number;
    activeShoeNumber = prevShoe.shoe_number;
    activeShoeIndex = shoes.length - 1;
    history = Array.isArray(prevShoe.history) ? prevShoe.history : [];
    tieMode = prevShoe.tie_mode || 'slash';
    selectedHandIndex = null;

    saveShoe();
    showFeedback(`Zapato eliminado. Se regresó al Zapato #${shoeNumber}`);
    confirmModalState.isOpen = false;
    isOptionsModalOpen = false;
  }

  function closeConfirmModal() {
    confirmModalState.isOpen = false;
  }

  // Hand Selection & In-Place Editing
  function selectHand(idx) {
    if (!isCurrentShoeActive) return;
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
    if (!isCurrentShoeActive || selectedHandIndex === null || !history[selectedHandIndex]) return;
    playSound('win');
    history[selectedHandIndex].winner = newWinner;
    history = [...history];
    saveShoe();
  }

  function toggleSelectedMod(field) {
    if (!isCurrentShoeActive || selectedHandIndex === null || !history[selectedHandIndex]) return;
    playSound('click');
    history[selectedHandIndex][field] = !history[selectedHandIndex][field];
    history = [...history];
    saveShoe();
  }

  function updateSelectedScore(num) {
    if (!isCurrentShoeActive || selectedHandIndex === null || !history[selectedHandIndex]) return;
    playSound('click');
    history[selectedHandIndex].score = history[selectedHandIndex].score === num ? null : num;
    history = [...history];
    saveShoe();
  }

  function deleteSelectedHand() {
    if (!isCurrentShoeActive || selectedHandIndex === null || !history[selectedHandIndex]) return;
    playSound('undo');
    history = history.filter((_, idx) => idx !== selectedHandIndex).map((h, i) => ({ ...h, id: i + 1 }));
    selectedHandIndex = null;
    saveShoe();
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

  // ==========================================
  // ROADMAPS GENERATION (BEAD, BIG ROAD & DERIVED)
  // ==========================================

  // 1. BEAD PLATE (PLATO DE CUENTAS) - Matriz 6 Filas x N Columnas secuencial
  $: beadGrid = (() => {
    const totalCols = Math.max(beadColsNeeded, Math.ceil(history.length / BEAD_ROWS) + 2);
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

  // 2. BIG ROAD (GRAN CAMINO) - Columnas de rachas con soporte para turnos (Dragon Tails)
  $: bigRoadGrid = (() => {
    let totalCols = Math.max(bigRoadColsNeeded, 52);
    let grid = Array.from({ length: BIG_ROWS }, () => Array(totalCols).fill(null));

    let col = 0;
    let row = 0;
    let prevWinner = null;
    let lastPlaced = null;
    let currentRun = []; // Array de { r, c, cell } pertenecientes a la corrida actual

    history.forEach((h, idx) => {
      if (h.winner === 'EMPATE') {
        if (tieMode === 'slash') {
          if (lastPlaced) {
            lastPlaced.tieCount = (lastPlaced.tieCount || 0) + 1;
          } else {
            grid[0][0] = { ...h, historyIndex: idx, isTieOnly: true, tieCount: 1 };
            lastPlaced = grid[0][0];
            currentRun = [{ r: 0, c: 0, cell: grid[0][0] }];
          }
          return;
        } else {
          // tieMode === 'circle': El empate ocupa su propia celda en la columna actual
          if (!prevWinner && !lastPlaced) {
            grid[0][0] = { ...h, historyIndex: idx, isTieOnly: true, tieCount: 0 };
            lastPlaced = grid[0][0];
            row = 1;
            col = 0;
            currentRun = [{ r: 0, c: 0, cell: grid[0][0] }];
            return;
          }

          if (row < BIG_ROWS && !grid[row][col]) {
            grid[row][col] = { ...h, historyIndex: idx, isTieOnly: true, tieCount: 0 };
            lastPlaced = grid[row][col];
            currentRun.push({ r: row, c: col, cell: grid[row][col] });
            row++;
          } else {
            let dragonCol = col + 1;
            const dragonRow = row >= BIG_ROWS ? BIG_ROWS - 1 : row - 1;
            while (dragonCol >= totalCols) {
              grid.forEach(rArr => rArr.push(null));
              totalCols++;
            }
            while (grid[dragonRow][dragonCol]) {
              dragonCol++;
              if (dragonCol >= totalCols) {
                grid.forEach(rArr => rArr.push(null));
                totalCols++;
              }
            }
            grid[dragonRow][dragonCol] = { ...h, historyIndex: idx, isTieOnly: true, tieCount: 0 };
            lastPlaced = grid[dragonRow][dragonCol];
            currentRun.push({ r: dragonRow, c: dragonCol, cell: grid[dragonRow][dragonCol] });
          }
          return;
        }
      }

      if (!prevWinner) {
        if (grid[0][0] && grid[0][0].isTieOnly && tieMode === 'circle') {
          if (row < BIG_ROWS && !grid[row][col]) {
            grid[row][col] = { ...h, historyIndex: idx, tieCount: 0 };
            lastPlaced = grid[row][col];
            currentRun.push({ r: row, c: col, cell: grid[row][col] });
            row++;
          } else {
            col++;
            row = 0;
            grid[0][col] = { ...h, historyIndex: idx, tieCount: 0 };
            lastPlaced = grid[0][col];
            currentRun = [{ r: 0, c: col, cell: grid[0][col] }];
            row = 1;
          }
          prevWinner = h.winner;
          return;
        }

        grid[0][0] = { ...h, historyIndex: idx, tieCount: 0 };
        lastPlaced = grid[0][0];
        prevWinner = h.winner;
        currentRun = [{ r: 0, c: 0, cell: grid[0][0] }];
        row = 1;
        col = 0;
      } else if (h.winner === prevWinner) {
        if (row < BIG_ROWS && !grid[row][col]) {
          grid[row][col] = { ...h, historyIndex: idx, tieCount: 0 };
          lastPlaced = grid[row][col];
          currentRun.push({ r: row, c: col, cell: grid[row][col] });
          row++;
        } else {
          let dragonCol = col + 1;
          const dragonRow = row >= BIG_ROWS ? BIG_ROWS - 1 : row - 1;
          while (dragonCol >= totalCols) {
            grid.forEach(rArr => rArr.push(null));
            totalCols++;
          }
          while (grid[dragonRow][dragonCol]) {
            dragonCol++;
            if (dragonCol >= totalCols) {
              grid.forEach(rArr => rArr.push(null));
              totalCols++;
            }
          }
          grid[dragonRow][dragonCol] = { ...h, historyIndex: idx, tieCount: 0 };
          lastPlaced = grid[dragonRow][dragonCol];
          currentRun.push({ r: dragonRow, c: dragonCol, cell: grid[dragonRow][dragonCol] });
        }
      } else {
        col++;
        while (col >= totalCols) {
          grid.forEach(rArr => rArr.push(null));
          totalCols++;
        }
        while (col < totalCols && grid[0][col]) {
          col++;
          if (col >= totalCols) {
            grid.forEach(rArr => rArr.push(null));
            totalCols++;
          }
        }
        row = 0;
        grid[0][col] = { ...h, historyIndex: idx, tieCount: 0 };
        lastPlaced = grid[0][col];
        currentRun = [{ r: 0, c: col, cell: grid[0][col] }];
        row = 1;
        prevWinner = h.winner;
      }
    });

    // La raya de corrida SOLO se visualiza en la última jugada (la corrida actual en curso),
    // si ya lleva 3 o más de 3, y siguiendo la corrida completa (columnas verticales y dragon tails horizontales)
    if (currentRun.length >= 3) {
      for (let i = 0; i < currentRun.length; i++) {
        const item = currentRun[i];
        const cell = item.cell;
        cell.hasStreakLine = true;

        const prev = i > 0 ? currentRun[i - 1] : null;
        const next = i < currentRun.length - 1 ? currentRun[i + 1] : null;

        if (prev) {
          if (prev.r === item.r - 1 && prev.c === item.c) cell.streakTop = true;
          if (prev.r === item.r + 1 && prev.c === item.c) cell.streakBottom = true;
          if (prev.r === item.r && prev.c === item.c - 1) cell.streakLeft = true;
          if (prev.r === item.r && prev.c === item.c + 1) cell.streakRight = true;
        }

        if (next) {
          if (next.r === item.r - 1 && next.c === item.c) cell.streakTop = true;
          if (next.r === item.r + 1 && next.c === item.c) cell.streakBottom = true;
          if (next.r === item.r && next.c === item.c - 1) cell.streakLeft = true;
          if (next.r === item.r && next.c === item.c + 1) cell.streakRight = true;
        }
      }
    }

    return { grid, totalCols };
  })();

  // 3. LOGICAL COLUMNS FOR DERIVED ROADS
  $: bigRoadLogicalColumns = (() => {
    const columns = [];
    let currentCol = null;

    history.forEach((h, idx) => {
      if (h.winner === 'EMPATE') {
        if (currentCol && currentCol.length > 0) {
          const lastEntry = currentCol[currentCol.length - 1];
          lastEntry.tieCount = (lastEntry.tieCount || 0) + 1;
        }
        return;
      }

      if (!currentCol || currentCol[0].winner !== h.winner) {
        currentCol = [{ ...h, historyIndex: idx, tieCount: 0 }];
        columns.push(currentCol);
      } else {
        currentCol.push({ ...h, historyIndex: idx, tieCount: 0 });
      }
    });

    return columns;
  })();

  // 4. DERIVED ROADS ALGORITHM (Big Eye Boy: k=1, Small Road: k=2, Cockroach Road: k=3)
  function buildDerivedRoad(columns, k, minCols = 28) {
    const marks = [];

    for (let c = 0; c < columns.length; c++) {
      for (let r = 0; r < columns[c].length; r++) {
        if (c < k || (c === k && r === 0)) {
          continue;
        }

        let isRed = false;
        if (r === 0) {
          const lenPrev = columns[c - 1].length;
          const lenRef = columns[c - 1 - k].length;
          isRed = (lenPrev === lenRef);
        } else {
          const refCol = columns[c - k];
          const lenRef = refCol ? refCol.length : 0;
          if (r < lenRef) {
            isRed = true;
          } else if (r === lenRef) {
            isRed = false;
          } else {
            isRed = true;
          }
        }

        marks.push({
          color: isRed ? 'red' : 'blue',
          handId: columns[c][r].id,
          historyIndex: columns[c][r].historyIndex
        });
      }
    }

    const ROWS = DERIVED_ROWS;
    let totalCols = Math.max(minCols, 24);
    let grid = Array.from({ length: ROWS }, () => Array(totalCols).fill(null));

    let col = 0;
    let row = 0;
    let prevColor = null;

    marks.forEach((m) => {
      if (!prevColor) {
        grid[0][0] = m;
        prevColor = m.color;
        row = 1;
        col = 0;
      } else if (m.color === prevColor) {
        if (row < ROWS && !grid[row][col]) {
          grid[row][col] = m;
          row++;
        } else {
          let dCol = col + 1;
          const dRow = row >= ROWS ? ROWS - 1 : row - 1;
          while (dCol >= totalCols) {
            grid.forEach(rArr => rArr.push(null));
            totalCols++;
          }
          while (grid[dRow][dCol]) {
            dCol++;
            if (dCol >= totalCols) {
              grid.forEach(rArr => rArr.push(null));
              totalCols++;
            }
          }
          grid[dRow][dCol] = m;
        }
      } else {
        let nextCol = col + 1;
        while (nextCol >= totalCols) {
          grid.forEach(rArr => rArr.push(null));
          totalCols++;
        }
        while (grid[0][nextCol]) {
          nextCol++;
          if (nextCol >= totalCols) {
            grid.forEach(rArr => rArr.push(null));
            totalCols++;
          }
        }
        col = nextCol;
        row = 0;
        grid[0][col] = m;
        row = 1;
        prevColor = m.color;
      }
    });

    const redCount = marks.filter(m => m.color === 'red').length;
    const blueCount = marks.filter(m => m.color === 'blue').length;

    return { marks, grid, totalCols, redCount, blueCount };
  }

  $: bigEyeGrid = buildDerivedRoad(bigRoadLogicalColumns, 1, derivedColsNeeded);
  $: smallRoadGrid = buildDerivedRoad(bigRoadLogicalColumns, 2, derivedColsNeeded);
  $: cockroachGrid = buildDerivedRoad(bigRoadLogicalColumns, 3, derivedColsNeeded);

  // Smart auto-scroll: Solo desplazar cuando las jugadas realmente se desbordan de la pantalla visible
  let bigRoadScrollEl;
  let beadScrollEl;
  let bigEyeScrollEl;
  let smallRoadScrollEl;
  let cockroachScrollEl;

  function smartScroll(el, latestCol, cellSize) {
    if (!el) return;
    if (latestCol <= 0) {
      if (el.scrollLeft !== 0) el.scrollTo({ left: 0, behavior: 'smooth' });
      return;
    }
    const visibleWidth = el.clientWidth || 0;
    // Borde derecho de la última columna ocupada + 2 columnas de margen visual
    const latestRightX = (latestCol + 2) * (cellSize || 40);
    if (latestRightX <= visibleWidth) {
      // Las jugadas aún caben dentro de la pantalla visible inicial -> mantener en el principio
      if (el.scrollLeft !== 0) {
        el.scrollTo({ left: 0, behavior: 'smooth' });
      }
    } else {
      // La jugada se desbordó: desplazar suavemente solo lo necesario para mostrarla
      const targetLeft = latestRightX - visibleWidth;
      el.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
    }
  }

  function getLatestBeadCol() {
    if (!history.length) return 0;
    return Math.floor((history.length - 1) / BEAD_ROWS);
  }

  function getLatestBigRoadCol() {
    if (!history.length || !bigRoadGrid?.grid) return 0;
    let maxCol = 0;
    for (let r = 0; r < bigRoadGrid.grid.length; r++) {
      const row = bigRoadGrid.grid[r];
      for (let c = row.length - 1; c >= 0; c--) {
        if (row[c]) {
          if (c > maxCol) maxCol = c;
          break;
        }
      }
    }
    return maxCol;
  }

  function getLatestDerivedCol(gridObj) {
    if (!gridObj?.grid) return 0;
    let maxCol = 0;
    for (let r = 0; r < gridObj.grid.length; r++) {
      const row = gridObj.grid[r];
      for (let c = row.length - 1; c >= 0; c--) {
        if (row[c]) {
          if (c > maxCol) maxCol = c;
          break;
        }
      }
    }
    return maxCol;
  }

  function scrollToLatest() {
    if (typeof window === 'undefined') return;
    setTimeout(() => {
      const beadCol = getLatestBeadCol();
      smartScroll(beadScrollEl, beadCol, beadCellSize);

      const bigCol = getLatestBigRoadCol();
      smartScroll(bigRoadScrollEl, bigCol, bigRoadCellSize);

      const eyeCol = getLatestDerivedCol(bigEyeGrid);
      smartScroll(bigEyeScrollEl, eyeCol, derivedCellSize);

      const smallCol = getLatestDerivedCol(smallRoadGrid);
      smartScroll(smallRoadScrollEl, smallCol, derivedCellSize);

      const roachCol = getLatestDerivedCol(cockroachGrid);
      smartScroll(cockroachScrollEl, roachCol, derivedCellSize);
    }, 60);
  }

  $: if (history.length === 0) {
    setTimeout(() => {
      if (bigRoadScrollEl) bigRoadScrollEl.scrollLeft = 0;
      if (beadScrollEl) beadScrollEl.scrollLeft = 0;
      if (bigEyeScrollEl) bigEyeScrollEl.scrollLeft = 0;
      if (smallRoadScrollEl) smallRoadScrollEl.scrollLeft = 0;
      if (cockroachScrollEl) cockroachScrollEl.scrollLeft = 0;
    }, 30);
  } else {
    scrollToLatest();
  }

  let isFullscreen = false;
  let rootElement;

  function exitAppFullscreen() {
    if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
      try { window.Capacitor?.Plugins?.KioskPlugin?.setFullscreen?.({ enable: false }); } catch (e) {}
    }
    if (typeof window !== 'undefined' && window.AndroidKiosk?.setFullscreen) {
      try { window.AndroidKiosk.setFullscreen(false); } catch (e) {}
    }
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    isFullscreen = false;
  }

  function toggleFullscreen() {
    playSound('click');
    const nextState = !isFullscreen;
    isFullscreen = nextState;

    // 1. En Capacitor Android nativo (Plugin Bridge)
    if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
      try {
        const KioskPlugin = window.Capacitor?.Plugins?.KioskPlugin;
        if (KioskPlugin?.setFullscreen) {
          KioskPlugin.setFullscreen({ enable: nextState });
        }
      } catch (e) {
        console.warn('Error en Capacitor KioskPlugin:', e);
      }
    }

    // 2. En Android Nativo: Ocultar/Mostrar el banner del sistema (Status Bar y Navigation Bar)
    if (typeof window !== 'undefined' && window.AndroidKiosk) {
      try {
        if (typeof window.AndroidKiosk.setFullscreen === 'function') {
          window.AndroidKiosk.setFullscreen(nextState);
        } else if (typeof window.AndroidKiosk.setImmersive === 'function') {
          window.AndroidKiosk.setImmersive(nextState);
        } else if (typeof window.AndroidKiosk.setKiosk === 'function') {
          window.AndroidKiosk.setKiosk(nextState);
        }
      } catch (e) {
        console.warn('Error en AndroidKiosk fullscreen:', e);
      }
    }

    // 3. En Navegadores Web y Desktop: HTML5 Fullscreen API
    if (typeof document !== 'undefined') {
      try {
        if (nextState) {
          if (!document.fullscreenElement) {
            const target = rootElement || document.documentElement;
            const req = target.requestFullscreen || document.documentElement.requestFullscreen;
            req?.call(target, { navigationUI: 'hide' })?.catch(() => {});
          }
        } else {
          if (document.fullscreenElement) {
            document.exitFullscreen?.().catch(() => {});
          }
        }
      } catch (e) {}
    }
  }

  function handleClose() {
    exitAppFullscreen();
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
      if (isFullscreen) {
        toggleFullscreen();
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
          {#if shoes.length > 1}
            <button
              type="button"
              class="shoe-pill-arrow btn-prev-shoe"
              disabled={activeShoeIndex <= 0}
              on:click={goToPrevShoe}
              title="Ver zapato anterior"
            >
              ‹
            </button>
          {/if}

          <span class="pill-label">ZAPATO</span>
          <span class="pill-value">#{activeShoeNumber}</span>
          {#if shoes.length > 1}
            <span class="pill-sub">({activeShoeIndex + 1}/{shoes.length})</span>
          {/if}
          <span class="pill-sep">•</span>
          <span class="pill-label">MANOS</span>
          <span class="pill-value">#{totalHands}</span>

          {#if shoes.length > 1}
            <button
              type="button"
              class="shoe-pill-arrow btn-next-shoe"
              disabled={activeShoeIndex >= shoes.length - 1}
              on:click={goToNextShoe}
              title="Ver zapato siguiente"
            >
              ›
            </button>
          {/if}
        </div>

        <!-- BOTÓN NUEVO ZAPATO DIRECTO -->
        <button
          type="button"
          class="sb-btn-new-shoe"
          disabled={!isLatestSession || history.length === 0}
          on:click={handleDirectNewShoe}
          title={!isLatestSession ? 'Sesión histórica en modo solo lectura' : history.length === 0 ? 'Debe registrar al menos una jugada en el zapato actual para crear uno nuevo' : `Crear Nuevo Zapato #${maxShoeNumber + 1}`}
        >
          Nuevo Zapato
        </button>

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

    <!-- NAVEGADOR DE SESIONES EN EL MEDIO SUPERIOR -->
    <div class="sb-header-center">
      {#if currentSession}
        <div class="sb-session-navigator" class:is-past={!isLatestSession}>
          <button
            type="button"
            class="session-nav-arrow btn-prev-session"
            disabled={selectedSessionIndex <= 0 || isSessionsLoading}
            on:click={goToPrevSession}
            title="Ver sesión anterior (Histórico)"
            aria-label="Sesión anterior"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>

          <div class="session-label-wrapper">
            {#if isLatestSession}
              <span class="session-status-dot"></span>
              <span class="session-label-text actual">Actual</span>
              <span class="session-date-text">( {currentSession.fecha} )</span>
            {:else}
              <span class="session-label-text past">Sesión</span>
              <span class="session-date-text">( {currentSession.fecha} )</span>
            {/if}
          </div>

          <button
            type="button"
            class="session-nav-arrow btn-next-session"
            disabled={selectedSessionIndex >= sessions.length - 1 || isSessionsLoading}
            on:click={goToNextSession}
            title="Ver sesión siguiente"
            aria-label="Sesión siguiente"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      {/if}
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



  <!-- OFFICIAL CASINO ROADMAPS MASTER SECTION -->
  <section class="sb-roadmaps-master">
    <div
      class="roadmap-card col-full bigroad-card"
      bind:clientWidth={bigRoadWidth}
      bind:clientHeight={bigRoadHeight}
      style="--big-cell-size: {bigRoadCellSize}px;"
    >
      <div class="grid-scrollable" bind:this={bigRoadScrollEl}>
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
                    title={cell ? `Mano #${cell.id}: ${cell.winner}${cell.score !== undefined && cell.score !== null ? ` (${cell.score})` : ''}${cell.tieCount > 0 ? ` (+${cell.tieCount} Empates)` : ''}${cell.natural ? ' [Natural]' : ''} (Clic para editar)` : ''}
                  >
                    {#if cell}
                      {#if cell.hasStreakLine}
                        {#if cell.streakTop}<span class="streak-seg streak-seg-top"></span>{/if}
                        {#if cell.streakBottom}<span class="streak-seg streak-seg-bottom"></span>{/if}
                        {#if cell.streakLeft}<span class="streak-seg streak-seg-left"></span>{/if}
                        {#if cell.streakRight}<span class="streak-seg streak-seg-right"></span>{/if}
                      {/if}
                      <div
                        class="bigroad-ring {cell.winner.toLowerCase()}"
                        class:is-tie={cell.isTieOnly}
                        class:tie-solid={cell.winner === 'EMPATE' && !cell.natural && cell.score === null}
                      >
                        {#if cell.natural}
                          <span class="dot-natural" title="Victoria Natural (8 ó 9)"></span>
                        {/if}
                        {#if cell.score !== undefined && cell.score !== null}
                          <span class="bigroad-score">{cell.score}</span>
                        {/if}
                        {#if cell.tieCount > 0 && tieMode === 'slash'}
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

    <!-- INFERIOR: 2 COLUMNAS (COL-6 IZQUIERDA Y COL-6 DERECHA) -->
    <div class="sb-roadmaps-bottom-split">
      <!-- COL-6 IZQUIERDA: 3 CAMINOS DERIVADOS APILADOS VERTICALMENTE (1/3 CADA UNO) -->
      <div
        class="roadmap-card col-half derived-roads-column"
        bind:clientWidth={derivedWidth}
        bind:clientHeight={derivedHeight}
        style="--derived-cell-size: {derivedCellSize}px;"
      >
        <!-- 1. BIG EYE BOY (GRAN OJO) -->
        <div class="derived-band" bind:this={bigEyeScrollEl}>
          <table class="derived-table">
            <tbody>
              {#each bigEyeGrid.grid as row}
                <tr>
                  {#each row as cell}
                    <td
                      class="derived-cell"
                      class:selected-cell={cell && cell.historyIndex === selectedHandIndex}
                      on:click={() => cell && cell.historyIndex !== undefined && selectHand(cell.historyIndex)}
                      title={cell ? `Gran Ojo - Mano #${cell.handId}: ${cell.color === 'red' ? 'Rojo (Simetría/Repetición)' : 'Azul (Cambio/Caos)'}` : ''}
                    >
                      {#if cell}
                        <span class="derived-ring {cell.color}"></span>
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <!-- 2. SMALL ROAD (CAMINO PEQUEÑO) -->
        <div class="derived-band" bind:this={smallRoadScrollEl}>
          <table class="derived-table">
            <tbody>
              {#each smallRoadGrid.grid as row}
                <tr>
                  {#each row as cell}
                    <td
                      class="derived-cell"
                      class:selected-cell={cell && cell.historyIndex === selectedHandIndex}
                      on:click={() => cell && cell.historyIndex !== undefined && selectHand(cell.historyIndex)}
                      title={cell ? `Camino Pequeño - Mano #${cell.handId}: ${cell.color === 'red' ? 'Rojo (Simetría/Repetición)' : 'Azul (Cambio/Caos)'}` : ''}
                    >
                      {#if cell}
                        <span class="derived-dot {cell.color}"></span>
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <!-- 3. COCKROACH ROAD (CUCARACHA) -->
        <div class="derived-band" bind:this={cockroachScrollEl}>
          <table class="derived-table">
            <tbody>
              {#each cockroachGrid.grid as row}
                <tr>
                  {#each row as cell}
                    <td
                      class="derived-cell"
                      class:selected-cell={cell && cell.historyIndex === selectedHandIndex}
                      on:click={() => cell && cell.historyIndex !== undefined && selectHand(cell.historyIndex)}
                      title={cell ? `Cucaracha - Mano #${cell.handId}: ${cell.color === 'red' ? 'Rojo (Simetría/Repetición)' : 'Azul (Cambio/Caos)'}` : ''}
                    >
                      {#if cell}
                        <span class="derived-slash {cell.color}"></span>
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>

      <!-- COL-6 DERECHA: BEAD PLATE (PLATO DE CUENTAS) -->
      <div
        class="roadmap-card col-half bead-card"
        bind:clientWidth={beadWidth}
        bind:clientHeight={beadHeight}
        style="--bead-cell-size: {beadCellSize}px;"
      >
        <div class="grid-scrollable" bind:this={beadScrollEl}>
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
              disabled={!isCurrentShoeActive}
              on:click={() => selectScore(num)}
              title={!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : `Seleccionar valor ${num} para la mano`}
            >
              {num}
            </button>
          {/each}
          <!-- 0 al lado del 3, 6, 9 abarcando todo el largo de las 3 filas -->
          <button
            type="button"
            class="btn-num-key btn-num-zero"
            class:active={activeScore === 0}
            disabled={!isCurrentShoeActive}
            on:click={() => selectScore(0)}
            title={!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : 'Seleccionar valor 0 para la mano'}
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
        disabled={!isCurrentShoeActive}
        on:click={togglePPair}
        title={!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : 'Activar Pareja de Punto (P.Pair)'}
      >
        P.Pair
      </button>

      <button
        type="button"
        class="keypad-pill pill-bpair"
        class:active={activeBPair}
        disabled={!isCurrentShoeActive}
        on:click={toggleBPair}
        title={!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : 'Activar Pareja de Banca (B.Pair)'}
      >
        B.Pair
      </button>

      <button
        type="button"
        class="keypad-pill pill-win"
        class:active={activeWin}
        disabled={!isCurrentShoeActive}
        on:click={toggleWin}
        title={!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : 'Activar Victoria Natural (8 ó 9)'}
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
            disabled={!isCurrentShoeActive}
            on:click={() => recordOutcome('PUNTO')}
            title={!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : 'Registrar victoria de PUNTO (Player)'}
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
            disabled={!isCurrentShoeActive}
            on:click={() => recordOutcome('BANCA')}
            title={!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : 'Registrar victoria de BANCA (Banker)'}
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
            disabled={!isCurrentShoeActive}
            on:click={() => recordOutcome('EMPATE')}
            title={!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : 'Registrar EMPATE (Tie)'}
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

    <!-- GRUPO 4 (COL-2): ACCIÓN RETROCEDER Y BOTÓN VISUALIZAR TIE -->
    <div class="footer-undo-col">
      <div class="action-btn-item">
        <button
          type="button"
          class="keypad-btn-circle btn-undo"
          on:click={undoLast}
          disabled={!isCurrentShoeActive || history.length === 0}
          title={!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : history.length === 0 ? 'No hay manos para retroceder' : 'Retroceder / Deshacer última mano registrada'}
        >
          <div class="btn-inner-gloss">
            <svg class="btn-arrow-icon" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5m0 0l6-6M5 12l6 6" />
            </svg>
          </div>
        </button>
        <span class="btn-caption undo-caption">RETROCEDER</span>
      </div>

      <!-- BOTÓN VISUALIZAR TIE (SLASH [/] vs CIRCLE [O]) -->
      <div class="action-btn-item">
        <button
          type="button"
          class="keypad-btn-tie-toggle"
          on:click={toggleTieMode}
          title={tieMode === 'slash' ? 'Modo Tie actual: Raya diagonal [/] (Clic para cambiar a Círculo [O])' : 'Modo Tie actual: Círculo [O] (Clic para cambiar a Raya diagonal [/])'}
        >
          <div class="tie-toggle-box">
            {#if tieMode === 'slash'}
              <svg width="34" height="34" viewBox="0 0 32 32" class="tie-toggle-svg">
                <line x1="5" y1="27" x2="27" y2="5" stroke="#0f172a" stroke-width="3.6" stroke-linecap="round" />
              </svg>
            {:else}
              <svg width="34" height="34" viewBox="0 0 32 32" class="tie-toggle-svg">
                <circle cx="16" cy="16" r="10.5" stroke="#0f172a" stroke-width="3.6" fill="none" />
              </svg>
            {/if}
          </div>
        </button>
        <span class="btn-caption tie-toggle-caption">Tie</span>
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
            <!-- COL-6: Borrar Registros del Zapato #{activeShoeNumber} (Acción directa) -->
            <button
              type="button"
              class="btn-opt col-6 btn-opt-clear"
              on:click={handleDirectClearShoe}
              disabled={!isLatestSession || isViewingPastShoe || history.length === 0}
              title={!isLatestSession ? 'Sesión histórica en modo solo lectura' : isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : history.length === 0 ? 'No hay registros en el zapato actual para borrar' : `Borrar registros del Zapato #${activeShoeNumber}`}
            >
              Borrar Registros del Zapato #{activeShoeNumber}
            </button>

            <!-- COL-6: Crear Nuevo Zapato #{maxShoeNumber + 1} (Acción directa) -->
            <button
              type="button"
              class="btn-opt col-6 btn-opt-new"
              on:click={handleDirectNewShoe}
              disabled={!isLatestSession || history.length === 0}
              title={!isLatestSession ? 'Sesión histórica en modo solo lectura' : history.length === 0 ? 'Debe registrar al menos una jugada en el zapato actual para crear uno nuevo' : `Crear Nuevo Zapato #${maxShoeNumber + 1}`}
            >
              Crear Nuevo Zapato #{maxShoeNumber + 1}
            </button>

            <!-- COL-12: Borrar Zapato #{shoeNumber} (Acción con confirmación) -->
            <button
              type="button"
              class="btn-opt col-12 btn-opt-reset"
              on:click={openDeleteCurrentShoeModal}
              disabled={!isLatestSession || shoeNumber <= 1 || history.length > 0}
              title={!isLatestSession ? 'Sesión histórica en modo solo lectura' : shoeNumber <= 1 ? 'No se puede borrar el primer zapato de la mesa' : history.length > 0 ? 'No se puede borrar si el zapato tiene jugadas registradas' : `Borrar Zapato #${shoeNumber}`}
            >
              Borrar Zapato #{shoeNumber}
            </button>

            <!-- COL-6: Crear Nueva Sesión (Fecha + 1 día) -->
            <button
              type="button"
              class="btn-opt col-6 btn-opt-new-session"
              on:click={handleCreateNewSession}
              disabled={isSessionsLoading || !isLatestSession}
              title={!isLatestSession ? 'Solo se puede crear nueva sesión desde la última sesión' : `Crear nueva sesión sumando 1 día (${nextSessionDateStr})`}
            >
              Crear Nueva Sesión ({nextSessionDateStr})
            </button>

            <!-- COL-6: Borrar Última Sesión -->
            <button
              type="button"
              class="btn-opt col-6 btn-opt-delete-session"
              on:click={handleConfirmDeleteLastSession}
              disabled={sessions.length <= 1 || isSessionsLoading || !isLatestSession}
              title={!isLatestSession ? 'Solo se puede borrar la última sesión' : sessions.length <= 1 ? 'Debe existir al menos una sesión' : 'Borrar última sesión registrada y seleccionar la anterior'}
            >
              Borrar Última Sesión
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
    height: 100vh;
    max-height: 100vh;
    width: 100vw;
    box-sizing: border-box;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 12px;
    overflow: hidden;
  }

  .fullscreen-mode {
    position: fixed;
    inset: 0;
    z-index: 9999999;
    padding: 8px 12px;
    height: 100vh;
    max-height: 100vh;
    overflow: hidden;
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

  .shoe-pill-arrow {
    background: rgba(56, 189, 248, 0.2);
    border: 1px solid rgba(56, 189, 248, 0.4);
    color: #38bdf8;
    border-radius: 4px;
    width: 17px;
    height: 17px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 900;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    transition: all 0.15s ease;
  }
  .shoe-pill-arrow:hover:not(:disabled) {
    background: #38bdf8;
    color: #0f172a;
  }
  .shoe-pill-arrow:disabled {
    opacity: 0.25;
    cursor: not-allowed;
    border-color: transparent;
  }

  .pill-sub {
    font-size: 10px;
    color: #94a3b8;
    font-weight: 500;
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

  /* BOTÓN NUEVO ZAPATO DIRECTO */
  .sb-btn-new-shoe {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: linear-gradient(135deg, rgba(2, 132, 199, 0.22) 0%, rgba(14, 165, 233, 0.12) 100%);
    border: 1.5px solid #0284c7;
    color: #38bdf8;
    padding: 3px 11px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    line-height: 1.2;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    white-space: nowrap;
    user-select: none;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  }

  .sb-btn-new-shoe:hover:not(:disabled) {
    background: #0284c7;
    border-color: #38bdf8;
    color: #ffffff;
    transform: translateY(-1px);
    box-shadow: 0 0 10px rgba(56, 189, 248, 0.5);
  }

  .sb-btn-new-shoe:active:not(:disabled) {
    transform: translateY(0);
  }

  .sb-btn-new-shoe:disabled {
    opacity: 0.35;
    cursor: not-allowed;
    background: #1e293b;
    border-color: #334155;
    color: #64748b;
    transform: none;
    box-shadow: none;
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

  /* HEADER CENTER / NAVEGADOR DE SESIONES */
  .sb-header-center {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    min-width: 220px;
  }

  .sb-session-navigator {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: linear-gradient(180deg, rgba(30, 41, 59, 0.9) 0%, rgba(15, 23, 42, 0.98) 100%);
    border: 1.5px solid rgba(239, 68, 68, 0.5);
    padding: 3px 6px;
    border-radius: 9999px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5), 0 0 14px rgba(239, 68, 68, 0.18);
    backdrop-filter: blur(8px);
    transition: all 0.25s ease;
  }

  .sb-session-navigator.is-past {
    border-color: rgba(148, 163, 184, 0.35);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
  }

  .session-nav-arrow {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #e2e8f0;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    cursor: pointer;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .session-nav-arrow:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.25);
    border-color: #ef4444;
    color: #ffffff;
    transform: scale(1.1);
    box-shadow: 0 0 10px rgba(239, 68, 68, 0.4);
  }

  .session-nav-arrow:active:not(:disabled) {
    transform: scale(0.95);
  }

  .session-nav-arrow:disabled {
    opacity: 0.18;
    cursor: not-allowed;
    background: transparent;
    border-color: transparent;
    color: #475569;
    transform: none;
    box-shadow: none;
  }

  .session-label-wrapper {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 0 6px;
    user-select: none;
  }

  .session-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ef4444;
    box-shadow: 0 0 8px #ef4444;
    display: inline-block;
    animation: sessionDotPulse 2s infinite ease-in-out;
  }

  @keyframes sessionDotPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.8); }
  }

  .session-label-text {
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.5px;
    white-space: nowrap;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  }

  .session-label-text.actual {
    color: #f87171;
  }

  .session-label-text.past {
    color: #94a3b8;
  }

  .session-date-text {
    color: #f1f5f9;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.5px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
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

  /* OFFICIAL CASINO ROADMAPS MASTER SECTION */
  .sb-roadmaps-master {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    min-height: 0;
  }

  .col-full {
    width: 100%;
    box-sizing: border-box;
  }

  .col-half {
    min-width: 0;
  }

  .roadmap-card {
    background: #020617;
    border: 1.5px solid #1e293b;
    border-radius: 8px;
    padding: 0;
    margin: 0;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .bigroad-card {
    flex: 1;
    min-height: 0;
    width: 100%;
    display: flex;
  }

  /* SPLIT BOTTOM SECTION: COL-6 DERIVED ROADS & COL-6 BEAD PLATE */
  .sb-roadmaps-bottom-split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    flex: 1;
    min-height: 0;
    align-items: stretch;
  }

  /* GRUPO IZQUIERDO: 3 CAMINOS DERIVADOS APILADOS VERTICALMENTE (1/3 CADA UNO) */
  .derived-roads-column {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: #020617;
    border: 1.5px solid #1e293b;
    border-radius: 8px;
    padding: 0;
    margin: 0;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .derived-band {
    flex: 1;
    min-height: 0;
    width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    display: flex;
    align-items: stretch;
    border-bottom: 2px solid #334155;
    background: #020617;
  }
  .derived-band:last-child {
    border-bottom: none;
  }

  .bead-card {
    height: 100%;
    min-height: 0;
    display: flex;
    background: #020617;
    border: 1.5px solid #1e293b;
    border-radius: 8px;
    padding: 0;
    margin: 0;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .grid-scrollable {
    flex: 1;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow-x: auto;
    overflow-y: hidden;
    background: #020617;
    display: flex;
    align-items: center;
    padding: 0;
    margin: 0;
  }

  /* TABLES: DO NOT STRETCH CELLS INTO RECTANGLES, PRESERVE EXACT 1:1 SQUARES */
  .bigroad-table, .bead-table, .derived-table {
    border-collapse: collapse;
    width: max-content;
    height: auto;
    margin: 0;
    table-layout: fixed;
  }

  /* 1. Big Eye Boy: Anillo hueco rojo / azul */
  .derived-table tr {
    height: var(--derived-cell-size, 13px);
  }

  .derived-cell {
    width: var(--derived-cell-size, 13px);
    min-width: var(--derived-cell-size, 13px);
    max-width: var(--derived-cell-size, 13px);
    height: var(--derived-cell-size, 13px);
    box-sizing: border-box;
    border: 1px solid #1e293b;
    padding: 0;
    text-align: center;
    vertical-align: middle;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .derived-cell:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .derived-cell.selected-cell {
    background: #ffc107 !important;
  }

  .derived-ring {
    display: block;
    width: calc(var(--derived-cell-size, 13px) - 5px);
    height: calc(var(--derived-cell-size, 13px) - 5px);
    margin: auto;
    border-radius: 50%;
    border: 2px solid transparent;
    box-sizing: border-box;
  }
  .derived-ring.red { border-color: #ef4444; }
  .derived-ring.blue { border-color: #3b82f6; }

  /* 2. Small Road: Punto sólido rojo / azul */
  .derived-dot {
    display: block;
    width: calc(var(--derived-cell-size, 13px) * 0.55);
    height: calc(var(--derived-cell-size, 13px) * 0.55);
    margin: auto;
    border-radius: 50%;
  }
  .derived-dot.red { background: #ef4444; }
  .derived-dot.blue { background: #3b82f6; }

  /* 3. Cockroach Pig: Línea diagonal roja / azul */
  .derived-slash {
    display: block;
    width: calc(var(--derived-cell-size, 13px) * 0.75);
    height: 2.2px;
    margin: auto;
    transform: rotate(-45deg);
    border-radius: 1px;
  }
  .derived-slash.red { background: #ef4444; }
  .derived-slash.blue { background: #3b82f6; }

  /* BEAD TABLE (EXACT SQUARES & LARGE PROMINENT BEADS) */
  .bead-table tr {
    height: var(--bead-cell-size, 40px);
  }

  .bead-cell {
    width: var(--bead-cell-size, 40px);
    min-width: var(--bead-cell-size, 40px);
    max-width: var(--bead-cell-size, 40px);
    height: var(--bead-cell-size, 40px);
    box-sizing: border-box;
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
    width: calc(var(--bead-cell-size, 40px) - 6px);
    height: calc(var(--bead-cell-size, 40px) - 6px);
    border-radius: 50%;
    margin: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    color: #ffffff;
    user-select: none;
    box-sizing: border-box;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
  }

  .bead-circle.banca { background: #dc2626; }
  .bead-circle.punto { background: #2563eb; }
  .bead-circle.empate { background: #16a34a; }

  .bead-letter {
    font-size: calc(var(--bead-cell-size, 40px) * 0.44);
    font-weight: 900;
    line-height: 1;
    color: #ffffff;
  }
  .bead-letter.has-score {
    font-size: calc(var(--bead-cell-size, 40px) * 0.46);
    font-weight: 900;
    color: #ffffff;
  }

  .dot-b-pair {
    position: absolute;
    top: 1px;
    left: 1px;
    width: 8px;
    height: 8px;
    background: #ef4444;
    border: 1.5px solid #ffffff;
    border-radius: 50%;
    z-index: 3;
  }

  .dot-p-pair {
    position: absolute;
    bottom: 1px;
    right: 1px;
    width: 8px;
    height: 8px;
    background: #3b82f6;
    border: 1.5px solid #ffffff;
    border-radius: 50%;
    z-index: 3;
  }

  .bead-circle .dot-b-pair {
    top: 1px;
    left: 1px;
  }
  .bead-circle .dot-p-pair {
    bottom: 1px;
    right: 1px;
  }

  .bead-empty, .bigroad-empty {
    width: 100%;
    height: 100%;
  }

  /* BIG ROAD TABLE (EXACT SQUARES & LARGE PROMINENT RINGS) */
  .bigroad-table tr {
    height: var(--big-cell-size, 40px);
  }

  .bigroad-cell {
    width: var(--big-cell-size, 40px);
    min-width: var(--big-cell-size, 40px);
    max-width: var(--big-cell-size, 40px);
    height: var(--big-cell-size, 40px);
    box-sizing: border-box;
    border: 1px solid #1e293b;
    padding: 0;
    text-align: center;
    vertical-align: middle;
    transition: background 0.15s ease;
    position: relative;
    overflow: visible;
  }

  .bigroad-cell.has-hand {
    cursor: pointer;
  }
  .bigroad-cell.has-hand:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  /* RAYA CONTINUA DE CORRIDA EN JUGADA ACTUAL (Soporta columnas verticales y Dragon Tails horizontales) */
  .streak-seg {
    position: absolute;
    background: #f59e0b;
    z-index: 1;
    pointer-events: none;
    box-shadow: 0 0 5px rgba(245, 158, 11, 0.6);
  }

  .streak-seg.streak-seg-top {
    left: 50%;
    top: -1px;
    bottom: 50%;
    width: 3.5px;
    transform: translateX(-50%);
  }

  .streak-seg.streak-seg-bottom {
    left: 50%;
    top: 50%;
    bottom: -1px;
    width: 3.5px;
    transform: translateX(-50%);
  }

  .streak-seg.streak-seg-left {
    top: 50%;
    left: -1px;
    right: 50%;
    height: 3.5px;
    transform: translateY(-50%);
  }

  .streak-seg.streak-seg-right {
    top: 50%;
    left: 50%;
    right: -1px;
    height: 3.5px;
    transform: translateY(-50%);
  }

  /* PUNTICO 3D ESFÉRICO DE VICTORIA NATURAL (Referencia Imagen 4) */
  .dot-natural {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: calc(var(--big-cell-size, 40px) * 0.44);
    height: calc(var(--big-cell-size, 40px) * 0.44);
    max-width: 17px;
    max-height: 17px;
    min-width: 10px;
    min-height: 10px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 32%, #ffffff 0%, #fed7aa 22%, #f59e0b 58%, #b45309 100%);
    box-shadow: 0 1.5px 3.5px rgba(0, 0, 0, 0.45), inset 0 0 2px rgba(255, 255, 255, 0.8);
    z-index: 2;
    pointer-events: none;
  }

  .bigroad-ring {
    width: calc(var(--big-cell-size, 40px) - 8px);
    height: calc(var(--big-cell-size, 40px) - 8px);
    border-radius: 50%;
    margin: auto;
    border: 3px solid transparent;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    z-index: 2;
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

  .bigroad-ring.empate.tie-solid,
  .bigroad-ring.is-tie {
    border-color: #22c55e;
    background: transparent;
  }

  .bigroad-score {
    font-size: calc(var(--big-cell-size, 40px) * 0.40);
    font-weight: 900;
    color: #ffffff;
    line-height: 1;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
    position: relative;
    z-index: 2;
  }

  .bigroad-tie-slash {
    position: absolute;
    top: 50%;
    left: 50%;
    width: calc(var(--big-cell-size, 40px) * 0.7);
    height: 3px;
    background: #22c55e;
    transform: translate(-50%, -50%) rotate(45deg);
    z-index: 1;
    border-radius: 1px;
  }

  .tie-badge-num {
    position: absolute;
    top: -5px;
    right: -5px;
    background: #16a34a;
    color: #ffffff;
    font-size: 11px;
    font-weight: 900;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 3;
    border: 1.5px solid #0f172a;
  }

  .bigroad-ring .dot-b-pair {
    top: 0px;
    left: 0px;
  }
  .bigroad-ring .dot-p-pair {
    bottom: 0px;
    right: 0px;
  }

  /* RESPONSIVE: CUANDO NO ES 16:9 O EN PANTALLAS PEQUEÑAS / MÓVILES */
  @media (max-width: 960px), (max-aspect-ratio: 4/3) {
    .scoreboard-container, .fullscreen-mode {
      height: auto;
      max-height: none;
      min-height: 100vh;
      overflow-y: auto;
    }
    .sb-roadmaps-master {
      flex: none;
    }
    .bigroad-card {
      height: 220px;
      flex: none;
    }
    .sb-roadmaps-bottom-split {
      grid-template-columns: 1fr;
      flex: none;
    }
    .derived-roads-column {
      height: 270px;
      flex: none;
    }
    .bead-card {
      height: 220px;
      flex: none;
    }
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
    grid-template-columns: minmax(230px, 3fr) minmax(120px, 1.8fr) minmax(100px, 1.5fr) minmax(250px, 3.5fr) minmax(160px, 2.2fr);
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

  /* GRUPO 5: ACCIÓN RETROCEDER Y VISUALIZAR TIE */
  .footer-undo-col {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 16px;
    min-width: 0;
  }

  .action-btn-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  /* BOTÓN CUADRADO TOGGLE DE TIE (SLASH [/] vs CÍRCULO [O]) */
  .keypad-btn-tie-toggle {
    width: 66px;
    height: 66px;
    background: #ffffff;
    border: 2.5px solid #0f172a;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
    transition: all 0.15s ease-out;
    padding: 0;
  }

  .keypad-btn-tie-toggle:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 12px -2px rgba(0, 0, 0, 0.15);
    background: #f8fafc;
    border-color: #000000;
  }

  .keypad-btn-tie-toggle:active {
    transform: translateY(1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .tie-toggle-box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }

  .tie-toggle-svg {
    display: block;
  }

  .tie-toggle-caption {
    font-size: 13.5px;
    font-weight: 800;
    color: #1e293b;
    letter-spacing: 0.5px;
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

  .btn-opt-new-session {
    background: #0369a1;
    color: #e0f2fe;
    border: 1.5px solid #0284c7;
  }
  .btn-opt-new-session:hover:not(:disabled) {
    background: #0284c7;
    color: #ffffff;
    box-shadow: 0 4px 10px rgba(2, 132, 199, 0.35);
  }

  .btn-opt-delete-session {
    background: #881337;
    color: #ffe4e6;
    border: 1.5px solid #be123c;
  }
  .btn-opt-delete-session:hover:not(:disabled) {
    background: #be123c;
    color: #ffffff;
    box-shadow: 0 4px 10px rgba(190, 18, 60, 0.35);
  }

  .btn-opt:disabled {
    opacity: 0.35;
    cursor: not-allowed;
    box-shadow: none !important;
  }

  .keypad-btn-circle:disabled {
    opacity: 0.35;
    filter: grayscale(85%);
    cursor: not-allowed;
    pointer-events: none;
    box-shadow: none;
  }

  .btn-num-key:disabled,
  .keypad-pill:disabled {
    opacity: 0.35;
    cursor: not-allowed;
    pointer-events: none;
  }

  .modal-backdrop-confirm {
    z-index: 1000000;
  }
</style>
