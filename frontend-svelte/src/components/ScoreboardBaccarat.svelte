<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { selectedSalaStore, currentUserStore, userSalasStore as authUserSalasStore } from '../controllers/auth.store.js';
  import { 
    masterSalasStore, 
    masterMesasStore, 
    masterJuegosStore, 
    userSalasStore as masterUserSalasStore, 
    loadMasterStoresFromBackend,
    currentRoutePermissionsStore,
    getUserModuleActions
  } from '../controllers/master.store.js';
  import { navigateToRoute, currentRouteStore } from '../controllers/router.store.js';
  import { toBackendUrl } from '../config/api.config.js';
  import {
    getLocalItems,
    saveLocalItems,
    replaceLocalItems,
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
  export let modo = null; // 'observar' | 'jugar'
  export let initialMonitorMode = false;
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

  $: nextSessionDateStr = (() => {
    const today = getTodayStr();
    if (!latestSessionInList || !latestSessionInList.fecha) return today;
    if (latestSessionInList.fecha < today) return today;
    return getNextDateStr(latestSessionInList.fecha);
  })();

  // Solo la última sesión permite jugar y editar (sesiones anteriores son histórico de solo lectura)
  $: isLatestSession = sessions.length > 0 && selectedSessionIndex === (sessions.length - 1);

  // Local overrides for dynamically selected sala and mesa
  let localSalaId = null;
  let localMesaId = null;

  // Selected Sala Context
  $: currentSalaId = localSalaId || salaId || (() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0];
      const parts = hash.split('/').filter(Boolean);
      if (parts[0] === 'herramientas' && parts[1] === 'scoreboard-baccarat') {
        const segs = parts.slice(2).filter(p => p.toLowerCase() !== 'monitor');
        if (segs[0]) return segs[0];
      }
      const sp = new URLSearchParams(window.location.search || window.location.hash.split('?')[1] || '');
      const s = sp.get('sala');
      if (s) return s;
    }
    return null;
  })();

  // Selected Mesa Context
  $: currentMesaId = localMesaId || mesaId || (() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0];
      const parts = hash.split('/').filter(Boolean);
      if (parts[0] === 'herramientas' && parts[1] === 'scoreboard-baccarat') {
        const segs = parts.slice(2).filter(p => p.toLowerCase() !== 'monitor');
        if (segs[1]) return segs[1];
      }
      const sp = new URLSearchParams(window.location.search || window.location.hash.split('?')[1] || '');
      const m = sp.get('mesa');
      if (m) return m;
    }
    return null;
  })();

  $: hasSelectedMesa = Boolean(currentMesaId && currentSalaId);

  $: currentSalaObj = (() => {
    const sId = currentSalaId;
    if (!sId) return null;
    const all = $masterSalasStore || [];
    const found = all.find(s => String(s.uuid || s.id) === String(sId));
    if (found) return found;
    const authSalas = $authUserSalasStore || [];
    const foundAuth = authSalas.find(s => typeof s === 'object' && String(s.uuid || s.id) === String(sId));
    if (foundAuth) return foundAuth;
    return { id: sId, nombre: `Sala #${String(sId).slice(0, 8)}` };
  })();

  $: currentMesaObj = (() => {
    if (!currentMesaId) return null;
    const all = $masterMesasStore || [];
    const found = all.find(m => String(m.uuid || m.id) === String(currentMesaId));
    if (found) return found;
    return { id: currentMesaId, nombre: `Mesa #${String(currentMesaId).slice(0, 8)}` };
  })();

  $: currentSalaUuid = currentSalaObj?.uuid || currentSalaId;
  $: currentMesaUuid = currentMesaObj?.uuid || currentMesaId;

  $: currentSalaName = hasSelectedMesa
    ? (currentSalaObj?.nombre || currentSalaObj?.name || '')
    : (currentSalaObj?.nombre || currentSalaObj?.name || 'Seleccione Sala');

  $: currentMesaName = hasSelectedMesa
    ? (currentMesaObj?.nombre || (currentMesaId ? `Mesa #${currentMesaId}` : ''))
    : 'Seleccionar Mesa';

  // 1. Resolve Salas assigned to current user strictly of type "SALA" (not GALPÓN)
  $: userSalasMap = $masterUserSalasStore || {};
  $: currentUserSalas = ($currentUserStore?.uuid || $currentUserStore?.id)
    ? (userSalasMap[$currentUserStore.uuid || $currentUserStore.id] || [])
    : [];

  $: rawAssignedSalas = (function () {
    const user = $currentUserStore;
    if (user && Array.isArray(user.salas) && user.salas.length > 0) {
      return user.salas;
    }
    if ($authUserSalasStore && Array.isArray($authUserSalasStore) && $authUserSalasStore.length > 0) {
      return $authUserSalasStore;
    }
    return [];
  })();

  $: assignedSalaIds = (currentUserSalas.length > 0
    ? currentUserSalas
    : rawAssignedSalas.map(s => typeof s === 'object' ? (s.uuid || s.id) : s)
  ).filter(Boolean).map(String);

  $: detailedSalas = (function () {
    const allSalas = $masterSalasStore || [];
    let list = [];
    if (assignedSalaIds.length === 0) {
      list = allSalas.length > 0 ? allSalas : (rawAssignedSalas.length > 0 ? rawAssignedSalas : [{ id: 1, nombre: 'Sala Principal', grupo_id: 1 }]);
    } else {
      list = assignedSalaIds.map((id) => {
        const found = allSalas.find((s) => String(s.uuid || s.id) === String(id));
        const fallback = rawAssignedSalas.find((s) => typeof s === 'object' && String(s.uuid || s.id) === String(id));
        return found || fallback || { id, uuid: id, nombre: `Sala #${String(id).slice(0, 8)}`, grupo_id: 1 };
      });
    }

    // Filtrar estrictamente solo salas tipo 1 (tipo SALA, no tipo GALPÓN)
    return list.filter((sala) => {
      if (sala.grupo_id !== undefined && sala.grupo_id !== null) {
        if (Number(sala.grupo_id) === 2 || Number(sala.grupo_id) !== 1) return false;
      }
      if (sala.grupo_nombre) {
        const gn = String(sala.grupo_nombre).toLowerCase().trim();
        if (gn.includes('galpon') || gn.includes('galpón')) return false;
      }
      if (sala.tipo_id !== undefined && sala.tipo_id !== null) {
        if (Number(sala.tipo_id) === 2 || Number(sala.tipo_id) !== 1) return false;
      }
      if (sala.tipo !== undefined && sala.tipo !== null) {
        const t = String(sala.tipo).toLowerCase().trim();
        if (t === '2' || t.includes('galpon') || t.includes('galpón')) return false;
      }
      const nom = String(sala.nombre || sala.name || '').toLowerCase().trim();
      if (nom.includes('galpon') || nom.includes('galpón')) {
        return false;
      }
      return true;
    });
  })();

  // 2. Mesas grouped by room for the user assigned rooms
  $: userAssignedSalasWithMesas = (function () {
    const allMesas = ($masterMesasStore || []).filter(m => (m.active ?? 1) === 1);
    const juegos = $masterJuegosStore || [];

    return detailedSalas.map(sala => {
      const sId = String(sala.uuid || sala.id || '');
      const sNombre = sala.nombre || sala.name || `Sala #${sId.slice(0, 8)}`;

      // Mesas de esta sala
      const forThisSala = allMesas.filter(m => {
        const mSala = String(m.sala_uuid || m.sala_id || '');
        return mSala === sId;
      });

      // Búsqueda de mesas de Baccarat / Punto y Banca
      const bacc = forThisSala.filter(m => {
        const jName = String(m.juego_nombre || '').toLowerCase();
        const mName = String(m.nombre || '').toLowerCase();
        const jObj = juegos.find(j => String(j.uuid || j.id) === String(m.juego_uuid || m.juego_id));
        const jFoundName = String(jObj?.nombre || '').toLowerCase();

        return jName.includes('baccarat') || jName.includes('punto') ||
               mName.includes('baccarat') || mName.includes('punto') ||
               jFoundName.includes('baccarat') || jFoundName.includes('punto');
      });

      let mesasFinal = [];
      if (bacc.length > 0) {
        mesasFinal = bacc;
      } else if (forThisSala.length > 0) {
        mesasFinal = forThisSala;
      } else {
        // Fallback mesas si no hay registradas en BD para que la sala tenga opciones funcionales
        mesasFinal = [
          { id: 1, uuid: 'mesa-01', nombre: 'Mesa 01 - Baccarat', sala_uuid: sId },
          { id: 2, uuid: 'mesa-02', nombre: 'Mesa 02 - Baccarat VIP', sala_uuid: sId }
        ];
      }

      return {
        id: sala.id,
        uuid: sala.uuid || sala.id,
        nombre: sNombre,
        mesas: mesasFinal
      };
    });
  })();

  $: currentSelectedValue = (currentSalaUuid && currentMesaUuid)
    ? `${currentSalaUuid}::${currentMesaUuid}`
    : ((currentSalaId && currentMesaId) ? `${currentSalaId}::${currentMesaId}` : '');

  function handleMesaSelectChange(e) {
    const val = e?.target?.value;
    if (!val) return;
    const [targetSala, targetMesa] = val.split('::');
    if (!targetSala || !targetMesa) return;

    if (isCurrentShoeActive) {
      saveShoe(true);
    }

    localSalaId = targetSala;
    localMesaId = targetMesa;
    selectedSalaStore.set(targetSala);

    const monitorSuffix = isMonitorMode ? '/monitor' : '';
    navigateToRoute(`herramientas/scoreboard-baccarat/${encodeURIComponent(targetSala)}/${encodeURIComponent(targetMesa)}${monitorSuffix}`);

    isOptionsModalOpen = false;
  }

  function handleGoToHerramientas() {
    if (isCurrentShoeActive) {
      saveShoe(true);
    }
    exitAppFullscreen();
    isOptionsModalOpen = false;
    navigateToRoute('herramientas');
    dispatch('close');
  }

  $: modulePermissions = (function() {
    const routePerms = $currentRoutePermissionsStore || getUserModuleActions('herramientas') || getUserModuleActions('mod-otros-herramientas');
    if (routePerms) return routePerms;
    const user = $currentUserStore;
    const username = (user?.usuario || '').trim().toLowerCase();
    const isAdmin = username === 'admin' || username === 'willinthon' || user?.is_admin === true || user?.rol === 'admin';
    if (isAdmin) return { canView: true, canEdit: true };
    return { canView: true, canEdit: false };
  })();

  $: canViewPerm = Boolean(modulePermissions?.canView ?? true);
  $: canEditPerm = Boolean(modulePermissions?.canEdit ?? false);

  // Modo Observador automático: si no tiene permiso de edición, la botonera queda en modo observador (solo lectura)
  $: isObserverMode = !canEditPerm;

  // Modo Monitor (Exclusivo visual para pantallas/TV: oculta la botonera completa y maximiza cuadrillas)
  function checkRouteHasMonitor() {
    if (typeof window === 'undefined') return false;
    const hash = window.location.hash.replace(/^#\/?/, '').split('?')[0];
    const parts = hash.split('/').filter(Boolean);
    if (parts[0] === 'herramientas' && parts[1] === 'scoreboard-baccarat') {
      return parts.includes('monitor');
    }
    const path = window.location.pathname.replace(/^\//, '').split('?')[0];
    const pathParts = path.split('/').filter(Boolean);
    if (pathParts[0] === 'herramientas' && pathParts[1] === 'scoreboard-baccarat') {
      return pathParts.includes('monitor');
    }
    return false;
  }

  let isMonitorMode = initialMonitorMode || checkRouteHasMonitor() || (() => {
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem('wisi_scoreboard_monitor_mode') === 'true';
      } catch (e) {
        return false;
      }
    }
    return false;
  })();

  $: if (initialMonitorMode !== undefined && initialMonitorMode !== null) {
    if (initialMonitorMode !== isMonitorMode) {
      isMonitorMode = initialMonitorMode;
    }
  }

  $: if ($currentRouteStore) {
    const routeHasMonitor = checkRouteHasMonitor();
    if (routeHasMonitor !== isMonitorMode) {
      isMonitorMode = routeHasMonitor;
    }
  }

  function updateMonitorRoute(monitorActive) {
    const salaParam = currentSalaUuid || currentSalaId || '';
    const mesaParam = currentMesaUuid || currentMesaId || '';
    
    let base = 'herramientas/scoreboard-baccarat';
    if (salaParam && mesaParam) {
      base = `herramientas/scoreboard-baccarat/${encodeURIComponent(salaParam)}/${encodeURIComponent(mesaParam)}`;
    } else if (salaParam) {
      base = `herramientas/scoreboard-baccarat/${encodeURIComponent(salaParam)}`;
    }
    
    const targetRoute = monitorActive ? `${base}/monitor` : base;
    navigateToRoute(targetRoute);
  }

  function toggleMonitorMode() {
    isMonitorMode = !isMonitorMode;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('wisi_scoreboard_monitor_mode', isMonitorMode ? 'true' : 'false');
      } catch (e) {}
    }

    // Actualiza la ruta URL agregando o quitando /monitor al final
    updateMonitorRoute(isMonitorMode);

    showFeedback(isMonitorMode ? 'Modo Monitor activado: Botonera oculta' : 'Modo Monitor desactivado: Botonera visible');
  }

  $: sessionUuid = currentSession?.uuid || (currentSession?.id ? String(currentSession.id) : null);
  $: storageKey = `wisi_baccarat_shoe_v3_${currentSalaUuid || 'default'}_${currentMesaUuid || 'default'}${sessionUuid ? `_sess_${sessionUuid}` : ''}`;

  let lastLoadedStorageKey = null;
  $: if (storageKey && storageKey !== lastLoadedStorageKey) {
    lastLoadedStorageKey = storageKey;
    if (sessionUuid && currentMesaUuid) {
      loadMesaDataForSession(sessionUuid, currentMesaUuid);
    }
  }

  let lastFetchedSalaId = null;
  $: if (currentSalaUuid && currentSalaUuid !== lastFetchedSalaId) {
    lastFetchedSalaId = currentSalaUuid;
    fetchSessions(currentSalaUuid);
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

  $: isObserverMode = (() => {
    // 1. Prop directa (pasada desde App.svelte)
    if (modo) {
      const m = String(modo).toLowerCase().trim();
      if (m === 'observar' || m === 'observe' || m === 'view' || m === 'ver') return true;
      if (m === 'jugar' || m === 'play' || m === 'edit') return false;
    }
    // 2. Ruta activa en el router store ($currentRouteStore)
    const route = String($currentRouteStore || '');
    if (route.includes('modo=observar') || route.includes('mode=observe') || route.includes('modo=ver') || route.includes('mode=view')) {
      return true;
    }
    // 3. Fallback a window.location (search o hash)
    if (typeof window !== 'undefined') {
      const href = String(window.location.href || '').toLowerCase();
      if (href.includes('modo=observar') || href.includes('mode=observe') || href.includes('modo=ver') || href.includes('mode=view')) {
        return true;
      }
      const hash = String(window.location.hash || '');
      const search = String(window.location.search || '');
      const sp = new URLSearchParams(search.replace(/^\?/, '') || hash.split('?')[1] || '');
      const paramModo = (sp.get('modo') || sp.get('mode') || '').toLowerCase();
      if (paramModo === 'observar' || paramModo === 'observe' || paramModo === 'view' || paramModo === 'ver') {
        return true;
      }
    }
    // 4. Permisos de usuario: Si no tiene permiso de edición, siempre entra como observador
    const perms = $currentRoutePermissionsStore || getUserModuleActions('herramientas') || getUserModuleActions('mod-otros-herramientas');
    if (perms && perms.canEdit === false) {
      return true;
    }
    return false;
  })();

  $: maxShoeNumber = shoes.length > 0 ? Math.max(...shoes.map(s => Number(s.shoe_number) || 1), 1) : 1;
  $: isViewingPastShoe = activeShoeNumber < maxShoeNumber;
  $: isCurrentShoeActive = !isObserverMode && hasSelectedMesa && isLatestSession && !isViewingPastShoe;

  // Keypad Staging Modifiers & Score
  let activePPair = false;
  let activeBPair = false;
  let activeNatural = false;
  let activeWin = false;
  let activeSpecial = false;
  let activeScore = null; // null | 0..9

  function selectScore(num) {
    if (!isCurrentShoeActive) return;
    if (activeNatural && num !== 8 && num !== 9) return;
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

  // Notificaciones silenciadas
  let feedbackMessage = "";

  function showFeedback(msg) {
    // Notificaciones silenciadas según preferencia del usuario
  }

  // Dynamic dimensions for 100% edge-to-edge coverage of grids
  let bigRoadWidth = 1400;
  let bigRoadHeight = 260;
  let beadWidth = 700;
  let beadHeight = 260;
  let derivedWidth = 700;
  let derivedHeight = 260;

  const BEAD_ROWS = 4;
  const BIG_ROWS = 6;
  const DERIVED_ROWS = 6;

  // Dynamic roadmap sizing: scales with available height (e.g. 24px - 50px depending on monitor)
  $: bigRoadCellSize = Math.max(Math.floor(((bigRoadHeight || 180) - 2) / 6), 20);
  $: bigRoadColsNeeded = Math.max(Math.ceil((bigRoadWidth || 1200) / bigRoadCellSize) + 1, 40);

  $: beadCellSize = Math.max(Math.floor(((beadHeight || 120) - 2) / BEAD_ROWS), 18);
  $: beadColsNeeded = Math.max(Math.ceil((beadWidth || 600) / beadCellSize) + 1, 24);

  // Derived roads: cuadrículas pequeñas y compactas estándar de casino (~9px a 10px, 6 filas)
  $: derivedBandHeight = Math.max(((derivedHeight || 180) - 16) / 3, 36);
  $: derivedRows = 6;
  $: derivedCellSize = Math.min(Math.max(Math.floor(((derivedBandHeight || 90) - 4) / 6), 7), 10);
  $: derivedColsNeeded = Math.max(Math.ceil((derivedWidth || 300) / derivedCellSize) + 1, 45);

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
    const sUuid = String(currentSalaUuid || sId);
    try {
      const local = await getLocalItems(
        'record_libro_score_baccarat',
        item => String(item.sala_uuid || item.sala_id) === sUuid,
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
    const sUuid = String(currentSalaUuid || sId);

    // 1. Cargar sesiones desde la base de datos interna local (Local-First)
    await loadSessionsFromLocalDb(sUuid);

    try {
      isSessionsLoading = true;
      const res = await fetch(toBackendUrl(`/api/baccarat/sessions?sala_uuid=${encodeURIComponent(sUuid)}&sala_id=${encodeURIComponent(sUuid)}`));
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data) && json.data.length > 0) {
          const serverSessions = json.data;
          sessions = serverSessions;

          // RECONCILIACIÓN ESTRICTA: Purgar de IndexedDB cualquier sesión local que ya no exista en el servidor
          const localSessions = await getLocalItems('record_libro_score_baccarat', item => String(item.sala_uuid || item.sala_id) === sUuid);
          const serverUuids = new Set(serverSessions.map(s => String(s.uuid)));
          for (const loc of localSessions) {
            if (!serverUuids.has(String(loc.uuid))) {
              if (loc.uuid) await deleteLocalItem('record_libro_score_baccarat', loc.uuid);
              if (loc._local_key) await deleteLocalItem('record_libro_score_baccarat', loc._local_key);
              // Purgar también sus registros de mesas huérfanas en IndexedDB
              const locSessId = String(loc.uuid || loc.id || '');
              if (locSessId) {
                const orphanMesas = await getLocalItems('record_libro_score_baccarat_mesa', m => String(m.record_libro_score_baccarat_uuid || m.session_uuid || m.session_id) === locSessId);
                for (const om of orphanMesas) {
                  if (om.uuid) await deleteLocalItem('record_libro_score_baccarat_mesa', om.uuid);
                  if (om._local_key) await deleteLocalItem('record_libro_score_baccarat_mesa', om._local_key);
                }
              }
            }
          }

          // Guardar en base de datos interna local (IndexedDB)
          await saveLocalItems('record_libro_score_baccarat', serverSessions);

          if (selectLatest || selectedSessionIndex === -1 || selectedSessionIndex >= sessions.length) {
            selectedSessionIndex = sessions.length - 1;
          }
          const activeSess = sessions[selectedSessionIndex];
          if (activeSess) {
            activeSessionId = activeSess.uuid || activeSess.id;
            await loadMesaDataForSession(activeSessionId, currentMesaUuid);
          }
          return;
        }
      }
    } catch (e) {
      console.warn('Error fetching baccarat sessions from backend (modo offline):', e);
    } finally {
      isSessionsLoading = false;
    }

    // MODO OFFLINE FALLBACK: Si no hay sesiones válidas (o estábamos offline), crear la primera sesión local limpia de HOY
    if (sessions.length === 0) {
      const offlineUuid = generateSafeUuid();
      const initialSession = {
        uuid: offlineUuid,
        sala_uuid: sUuid,
        sala_id: sUuid,
        fecha: todayStr,
        estado: 'abierta',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      await upsertLocalItem('record_libro_score_baccarat', initialSession);
      sessions = [initialSession];
      selectedSessionIndex = 0;
      activeSessionId = offlineUuid;

      // Inicializar mesa limpia [] para esta sesión offline
      const cleanMesa = {
        uuid: generateSafeUuid(),
        record_libro_score_baccarat_uuid: offlineUuid,
        mesa_uuid: currentMesaUuid,
        session_uuid: offlineUuid,
        session_id: offlineUuid,
        mesa_id: currentMesaUuid,
        shoe_number: 1,
        tie_mode: 'slash',
        history: [],
        shoes: [{ shoe_number: 1, history: [], tie_mode: 'slash' }]
      };
      await upsertLocalItem('record_libro_score_baccarat_mesa', cleanMesa);
      applyMesaData(cleanMesa);
    }
  }

  async function loadMesaDataForSession(sId, mId) {
    if (!sId || !mId) return;
    const strSessId = String(sId);
    const strMesaUuid = String(currentMesaUuid || mId);

    try {
      // 1. Cargar primero de la base de datos interna local (Local-First IndexedDB) por sesión estricta
      const localRows = await getLocalItems(
        'record_libro_score_baccarat_mesa',
        item => (String(item.record_libro_score_baccarat_uuid || item.session_uuid || item.session_id) === strSessId) &&
                (String(item.mesa_uuid || item.mesa_id) === strMesaUuid)
      );
      if (Array.isArray(localRows) && localRows.length > 0) {
        applyMesaData(localRows[0]);
      } else {
        applyMesaData(null);
      }

      // 2. Sincronizar con el backend PostgreSQL (Fuente autoritativa)
      const res = await fetch(toBackendUrl(`/api/baccarat/mesa-data?record_libro_score_baccarat_uuid=${encodeURIComponent(strSessId)}&mesa_uuid=${encodeURIComponent(strMesaUuid)}&session_id=${encodeURIComponent(strSessId)}&mesa_id=${encodeURIComponent(strMesaUuid)}`));
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          applyMesaData(json.data);

          // Purgar cualquier residuo de clave legacy un-namespaced
          const baseLegacyKey = `wisi_baccarat_shoe_v3_${currentSalaUuid || 'default'}_${strMesaUuid}`;
          try {
            localStorage.removeItem(baseLegacyKey);
          } catch (e) {}

          // Guardar en la base de datos interna local (IndexedDB) aislado para esta sesión
          await upsertLocalItem('record_libro_score_baccarat_mesa', {
            uuid: json.data.uuid || generateSafeUuid(),
            record_libro_score_baccarat_uuid: strSessId,
            mesa_uuid: strMesaUuid,
            session_uuid: strSessId,
            session_id: strSessId,
            mesa_id: strMesaUuid,
            shoe_number: json.data.shoe_number || 1,
            tie_mode: json.data.tie_mode || 'slash',
            history: json.data.history || [],
            shoes: json.data.shoes || [{ shoe_number: 1, history: [], tie_mode: 'slash' }]
          }).catch(() => {});

          try {
            localStorage.setItem(storageKey, JSON.stringify({
              shoeNumber: json.data.shoe_number || 1,
              history: json.data.history || [],
              shoes: json.data.shoes || [{ shoe_number: 1, history: [], tie_mode: 'slash' }],
              tieMode: json.data.tie_mode || 'slash',
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
        await loadMesaDataForSession(activeSessionId, currentMesaUuid);
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
        await loadMesaDataForSession(activeSessionId, currentMesaUuid);
      }
    }
  }

  async function handleCreateNewSession() {
    if (!currentSalaUuid || isSessionsLoading || !isLatestSession) return;
    try {
      isSessionsLoading = true;
      // Guardar la sesión y zapato actuales antes de crear la nueva sesión
      saveShoe(true);

      const targetFecha = nextSessionDateStr || getTodayStr();
      const clientGeneratedUuid = generateSafeUuid();
      const res = await fetch(toBackendUrl('/api/baccarat/sessions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sala_uuid: currentSalaUuid,
          sala_id: currentSalaUuid,
          fecha: targetFecha,
          uuid: clientGeneratedUuid
        })
      });
      let json = null;
      try {
        json = await res.json();
      } catch (err) {
        console.error('Error parseando respuesta de nueva sesión:', err);
      }

      if (res.ok && json && json.success && json.data) {
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
        activeNatural = false;
        activeSpecial = false;
        activeWin = false;
        selectedHandIndex = null;

        // Persistir explícitamente el nuevo registro de mesa con el UUID de la NUEVA sesión
        const newSessUuid = newSession.uuid || newSession.id;
        const targetMesaUuid = currentMesaUuid || currentMesaId || 'mesa_default';
        const newMesaRecord = {
          uuid: generateSafeUuid(),
          record_libro_score_baccarat_uuid: newSessUuid,
          mesa_uuid: targetMesaUuid,
          session_uuid: newSessUuid,
          session_id: newSessUuid,
          mesa_id: targetMesaUuid,
          shoe_number: 1,
          tie_mode: 'slash',
          history: [],
          shoes: [{ shoe_number: 1, history: [], tie_mode: 'slash' }]
        };

        // Guardar mesa limpia [] en la base de datos local interna (IndexedDB)
        await upsertLocalItem('record_libro_score_baccarat_mesa', newMesaRecord).catch(() => {});

        // Clave de almacenamiento aislada para la nueva sesión
        const newStorageKey = `wisi_baccarat_shoe_v3_${currentSalaUuid}_${targetMesaUuid}_sess_${newSessUuid}`;
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
        alert((json && json.message) || `Error del servidor (${res.status}): no se pudo crear la sesión`);
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
            body: JSON.stringify({ sala_uuid: currentSalaUuid, sala_id: currentSalaUuid })
          });
          const json = await res.json();
          if (json.success) {
            sessions = sessions.slice(0, -1);
            selectedSessionIndex = sessions.length - 1;
            const activeSess = sessions[selectedSessionIndex];
            if (activeSess) {
              activeSessionId = activeSess.uuid || activeSess.id;
              await loadMesaDataForSession(activeSessionId, currentMesaUuid);
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
      salaId: currentSalaUuid,
      salaUuid: currentSalaUuid,
      mesaId: currentMesaUuid,
      mesaUuid: currentMesaUuid,
      sessionId: sessUuid,
      sessionUuid: sessUuid,
      record_libro_score_baccarat_uuid: sessUuid,
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
    if (!sessUuid || !currentMesaUuid) return;

    // Actualizar el zapato activo en el arreglo shoes
    const currIdx = shoes.findIndex(s => s.shoe_number === shoeNumber);
    if (currIdx >= 0) {
      shoes[currIdx] = { shoe_number: shoeNumber, history, tie_mode: tieMode };
    } else {
      shoes.push({ shoe_number: shoeNumber, history, tie_mode: tieMode });
    }
    shoes = [...shoes];

    const mesaRecordUuid = `bacc_mesa_${sessUuid}_${currentMesaUuid}`;

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
      record_libro_score_baccarat_uuid: sessUuid,
      mesa_uuid: currentMesaUuid,
      session_uuid: sessUuid,
      session_id: sessUuid,
      mesa_id: currentMesaUuid,
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
        record_libro_score_baccarat_uuid: sessUuid,
        mesa_uuid: currentMesaUuid,
        session_id: sessUuid,
        session_uuid: sessUuid,
        mesa_id: currentMesaUuid,
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
  $: if ($isWsConnectedStore && isLatestSession && currentSalaUuid && currentMesaUuid && sessionUuid) {
    sendWebSocketMessage({
      type: 'BACCARAT_GET_STATE',
      storageKey,
      sessionId: sessionUuid,
      sessionUuid: sessionUuid,
      record_libro_score_baccarat_uuid: sessionUuid,
      salaId: currentSalaUuid,
      salaUuid: currentSalaUuid,
      mesaId: currentMesaUuid,
      mesaUuid: currentMesaUuid
    });
  }

  onMount(() => {
    loadMasterStoresFromBackend().catch(() => {});

    // Si no hay mesa seleccionada, abrir modal de opciones para seleccionar mesa
    if (!hasSelectedMesa) {
      isOptionsModalOpen = true;
    }

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
          localSalaId = s;
          selectedSalaStore.set(s);
        }
        const m = params.get('mesa');
        if (m) {
          localMesaId = m;
        }
      }
    } catch (e) {}

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

    if (typeof document !== 'undefined') {
      document.addEventListener('fullscreenchange', handleFullscreenChange);
    }
  });

  onDestroy(() => {
    if (unsubscribeWs) {
      unsubscribeWs();
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
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

  function toggleNatural() {
    if (!isCurrentShoeActive) return;
    if (!activeNatural && activeScore !== null && activeScore !== 8 && activeScore !== 9) {
      return;
    }
    playSound('click');
    activeNatural = !activeNatural;
    if (activeNatural && activeScore !== null && activeScore !== 8 && activeScore !== 9) {
      activeScore = null;
    }
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
      natural: Boolean(activeNatural),
      win: Boolean(activeWin),
      special: activeSpecial,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    history = [...history, newRecord];
    saveShoe();

    // Reset modifier pills and score for the next hand
    activePPair = false;
    activeBPair = false;
    activeNatural = false;
    activeWin = false;
    activeSpecial = false;
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
    if (field === 'natural') {
      const curScore = history[selectedHandIndex].score;
      if (!history[selectedHandIndex].natural && curScore !== null && curScore !== undefined && curScore !== 8 && curScore !== 9) {
        return;
      }
    }
    playSound('click');
    history[selectedHandIndex][field] = !history[selectedHandIndex][field];
    if (field === 'natural' && history[selectedHandIndex].natural) {
      const curScore = history[selectedHandIndex].score;
      if (curScore !== null && curScore !== undefined && curScore !== 8 && curScore !== 9) {
        history[selectedHandIndex].score = null;
      }
    }
    history = [...history];
    saveShoe();
  }

  function updateSelectedScore(num) {
    if (!isCurrentShoeActive || selectedHandIndex === null || !history[selectedHandIndex]) return;
    if (history[selectedHandIndex].natural && num !== 8 && num !== 9) return;
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

  $: isEditingHand = selectedHandIndex !== null && selectedHand !== null;

  function handleKeypadNumber(num) {
    if (!isCurrentShoeActive) return;
    if (isEditingHand) {
      updateSelectedScore(num);
    } else {
      selectScore(num);
    }
  }

  function handleTogglePPair() {
    if (!isCurrentShoeActive) return;
    if (isEditingHand) {
      toggleSelectedMod('pPair');
    } else {
      togglePPair();
    }
  }

  function handleToggleBPair() {
    if (!isCurrentShoeActive) return;
    if (isEditingHand) {
      toggleSelectedMod('bPair');
    } else {
      toggleBPair();
    }
  }

  function handleToggleNatural() {
    if (!isCurrentShoeActive) return;
    if (isEditingHand) {
      toggleSelectedMod('natural');
    } else {
      toggleNatural();
    }
  }

  function handleToggleWin() {
    if (!isCurrentShoeActive) return;
    if (isEditingHand) {
      toggleSelectedMod('win');
    } else {
      toggleWin();
    }
  }

  function handleSelectOutcome(winner) {
    if (!isCurrentShoeActive) return;
    if (isEditingHand) {
      updateSelectedWinner(winner);
    } else {
      recordOutcome(winner);
    }
  }

  function handleBackOrUndo() {
    if (isEditingHand) {
      playSound('click');
      selectedHandIndex = null;
    } else {
      undoLast();
    }
  }

  function handleConfirmEditOrTieToggle() {
    if (isEditingHand) {
      playSound('win');
      saveShoe();
      showFeedback(`Mano #${selectedHand.id || (selectedHandIndex + 1)} editada correctamente`);
      selectedHandIndex = null;
    } else {
      toggleTieMode();
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

    history.forEach((h, idx) => {
      if (h.winner === 'EMPATE') {
        if (tieMode === 'slash') {
          if (lastPlaced) {
            lastPlaced.tieCount = (lastPlaced.tieCount || 0) + 1;
          } else {
            grid[0][0] = { ...h, historyIndex: idx, isTieOnly: true, tieCount: 1 };
            lastPlaced = grid[0][0];
          }
          return;
        } else {
          // tieMode === 'circle': El empate ocupa su propia celda en la columna actual
          if (!prevWinner && !lastPlaced) {
            grid[0][0] = { ...h, historyIndex: idx, isTieOnly: true, tieCount: 0 };
            lastPlaced = grid[0][0];
            row = 1;
            col = 0;
            return;
          }

          if (row < BIG_ROWS && !grid[row][col]) {
            grid[row][col] = { ...h, historyIndex: idx, isTieOnly: true, tieCount: 0 };
            lastPlaced = grid[row][col];
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
          }
          return;
        }
      }

      if (!prevWinner) {
        if (grid[0][0] && grid[0][0].isTieOnly && tieMode === 'circle') {
          if (row < BIG_ROWS && !grid[row][col]) {
            grid[row][col] = { ...h, historyIndex: idx, tieCount: 0 };
            lastPlaced = grid[row][col];
            row++;
          } else {
            col++;
            row = 0;
            grid[0][col] = { ...h, historyIndex: idx, tieCount: 0 };
            lastPlaced = grid[0][col];
            row = 1;
          }
          prevWinner = h.winner;
          return;
        }

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
        row = 1;
        prevWinner = h.winner;
      }
    });

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
  function buildDerivedRoad(columns, k, minCols = 28, rowsCount = DERIVED_ROWS) {
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

    const ROWS = rowsCount || 6;
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

  $: bigEyeGrid = buildDerivedRoad(bigRoadLogicalColumns, 1, derivedColsNeeded, DERIVED_ROWS);
  $: smallRoadGrid = buildDerivedRoad(bigRoadLogicalColumns, 2, derivedColsNeeded, DERIVED_ROWS);
  $: cockroachGrid = buildDerivedRoad(bigRoadLogicalColumns, 3, derivedColsNeeded, DERIVED_ROWS);

  // 5. PREDICCIÓN DE CAMINOS DERIVADOS ("ASK BANKER" / "ASK PLAYER" / "NEXT")
  // Simula matemáticamente qué color (rojo o azul) se generaría en cada camino derivado (Gran Ojo, Camino Pequeño, Cucaracha)
  // si la siguiente mano la gana BANCA o PUNTO, siguiendo las reglas oficiales internacionales de Baccarat.
  function predictNextDerivedColor(cols, candidateWinner, k) {
    if (!cols || cols.length === 0) return null;

    const L = cols.length;
    const lastCol = cols[L - 1];
    let c, r;

    if (lastCol[0].winner === candidateWinner) {
      c = L - 1;
      r = lastCol.length;
    } else {
      c = L;
      r = 0;
    }

    if (c < k || (c === k && r === 0)) {
      return null;
    }

    let isRed = false;
    if (r === 0) {
      const lenPrev = cols[c - 1].length;
      const lenRef = cols[c - 1 - k] ? cols[c - 1 - k].length : 0;
      isRed = (lenPrev === lenRef);
    } else {
      const refCol = cols[c - k];
      const lenRef = refCol ? refCol.length : 0;
      if (r < lenRef) {
        isRed = true;
      } else if (r === lenRef) {
        isRed = false;
      } else {
        isRed = true;
      }
    }

    return isRed ? 'red' : 'blue';
  }

  $: nextBankerPrediction = {
    bigEye: predictNextDerivedColor(bigRoadLogicalColumns, 'BANCA', 1),
    smallRoad: predictNextDerivedColor(bigRoadLogicalColumns, 'BANCA', 2),
    cockroach: predictNextDerivedColor(bigRoadLogicalColumns, 'BANCA', 3)
  };

  $: nextPlayerPrediction = {
    bigEye: predictNextDerivedColor(bigRoadLogicalColumns, 'PUNTO', 1),
    smallRoad: predictNextDerivedColor(bigRoadLogicalColumns, 'PUNTO', 2),
    cockroach: predictNextDerivedColor(bigRoadLogicalColumns, 'PUNTO', 3)
  };

  function handlePredictionClick(candidateWinner) {
    playSound('click');
    const pred = candidateWinner === 'BANCA' ? nextBankerPrediction : nextPlayerPrediction;
    const name = candidateWinner === 'BANCA' ? 'BANCA' : 'PUNTO';
    const be = pred.bigEye === 'red' ? 'Rojo (Simetría)' : pred.bigEye === 'blue' ? 'Azul (Caos)' : 'Pendiente';
    const sr = pred.smallRoad === 'red' ? 'Rojo (Simetría)' : pred.smallRoad === 'blue' ? 'Azul (Caos)' : 'Pendiente';
    const cr = pred.cockroach === 'red' ? 'Rojo (Simetría)' : pred.cockroach === 'blue' ? 'Azul (Caos)' : 'Pendiente';
    showFeedback(`Predicción si gana ${name}: Gran Ojo = ${be}, Camino Pequeño = ${sr}, Cucaracha = ${cr}`);
  }

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

  // Modo de tema: 'dark' (predeterminado) | 'light'
  let currentTheme = 'dark';

  try {
    if (typeof localStorage !== 'undefined') {
      const savedTheme = localStorage.getItem('wisi_baccarat_theme');
      if (savedTheme === 'light' || savedTheme === 'dark') {
        currentTheme = savedTheme;
      }
    }
  } catch (e) {}

  function toggleTheme() {
    playSound('click');
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('wisi_baccarat_theme', currentTheme);
      }
    } catch (e) {}
  }

  function handleFullscreenChange() {
    if (typeof document !== 'undefined') {
      isFullscreen = !!document.fullscreenElement;
    }
  }

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
    handleGoToHerramientas();
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
  class:theme-light={currentTheme === 'light'}
  class:is-monitor-mode={isMonitorMode}
>
  <!-- TOP CASINO HEADER -->
  <header class="sb-header">
    <div class="sb-header-left">
      <div class="sb-pills-row">
        {#if hasSelectedMesa}
          <button
            type="button"
            class="sb-btn-table-info"
            on:click={openOptionsMenu}
            title="Opciones de la mesa ({currentSalaName} • {currentMesaName})"
          >
            <strong class="loc-val">{currentSalaName}</strong>
            <span class="loc-sep">•</span>
            <strong class="loc-val">{currentMesaName}</strong>
          </button>
        {:else}
          <button
            type="button"
            class="sb-btn-table-info is-unselected"
            on:click={openOptionsMenu}
            title="Clic para seleccionar sala y mesa"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; flex-shrink: 0;">
              <path d="M4 6h16M4 12h16m-7 6h7"/>
            </svg>
            <strong class="loc-val">👉 Seleccionar Mesa</strong>
          </button>
        {/if}

        {#if isObserverMode}
          <div class="sb-observer-badge-pill" title="Usted está en modo Observador (Solo Lectura)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <span>Observador</span>
          </div>
        {/if}

        {#if isMonitorMode}
          <button
            type="button"
            class="sb-monitor-badge-pill is-btn"
            on:click={toggleMonitorMode}
            title="Modo Monitor Activo (Clic para Salir de Monitor y mostrar botonera)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
            <span>Monitor</span>
            <span class="sb-monitor-badge-exit">✕</span>
          </button>
        {/if}

        <div class="sb-shoe-pill shoe-pill">
          <button
            type="button"
            class="nav-arrow-btn btn-prev-shoe"
            disabled={shoes.length <= 1 || activeShoeIndex <= 0}
            on:click={goToPrevShoe}
            title="Ver zapato anterior"
            aria-label="Zapato anterior"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>

          <div class="shoe-pill-content">
            <span class="pill-label">ZAPATO</span>
            <span class="pill-value">#{activeShoeNumber}</span>
            {#if shoes.length > 1}
              <span class="pill-sub">({activeShoeIndex + 1}/{shoes.length})</span>
            {/if}
            <span class="pill-sep">•</span>
            <span class="pill-label">MANOS</span>
            <span class="pill-value">#{totalHands}</span>
          </div>

          <button
            type="button"
            class="nav-arrow-btn btn-next-shoe"
            disabled={shoes.length <= 1 || activeShoeIndex >= shoes.length - 1}
            on:click={goToNextShoe}
            title="Ver zapato siguiente"
            aria-label="Zapato siguiente"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
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
      </div>
    </div>

    <!-- NAVEGADOR DE SESIONES EN LA DERECHA (EN REEMPLAZO DEL BOTÓN OPCIONES) -->
    <div class="sb-header-right">
      {#if currentSession}
        <div class="sb-session-navigator" class:is-past={!isLatestSession}>
          <button
            type="button"
            class="nav-arrow-btn btn-prev-session"
            disabled={selectedSessionIndex <= 0 || isSessionsLoading}
            on:click={goToPrevSession}
            title="Ver sesión anterior (Histórico)"
            aria-label="Sesión anterior"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>

          <div class="session-label-wrapper">
            {#if isLatestSession}
              <span class="session-label-text actual">Actual</span>
              <span class="session-date-text">( {currentSession.fecha} )</span>
            {:else}
              <span class="session-label-text past">Sesión</span>
              <span class="session-date-text">( {currentSession.fecha} )</span>
            {/if}
          </div>

          <button
            type="button"
            class="nav-arrow-btn btn-next-session"
            disabled={selectedSessionIndex >= sessions.length - 1 || isSessionsLoading}
            on:click={goToNextSession}
            title="Ver sesión siguiente"
            aria-label="Sesión siguiente"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </button>
        </div>
      {/if}
    </div>
  </header>



  <!-- OFFICIAL CASINO ROADMAPS MASTER SECTION -->
  <section class="sb-roadmaps-master">
    <!-- COL-9 IZQUIERDA: GRAN CAMINO (PRINCIPAL - ROJO) Y PLATO DE BOLAS (VERDE, ABAJO) -->
    <div class="sb-roadmaps-left-col">
      <!-- 1. BIG ROAD (CUADRILLA PRINCIPAL - ROJO) -->
      <div
        class="roadmap-card bigroad-card"
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
                      title={cell ? `Mano #${cell.id}: ${cell.winner}${cell.score !== undefined && cell.score !== null ? ` (${cell.score})` : ''}${cell.tieCount > 0 ? ` (+${cell.tieCount} Empates)` : ''}${cell.natural ? ' [Natural]' : ''}${cell.win ? ' [WIN]' : ''} (Clic para editar)` : ''}
                    >
                      {#if cell}
                        <div
                          class="bigroad-ring {cell.winner.toLowerCase()}"
                          class:is-tie={cell.isTieOnly}
                          class:tie-solid={cell.winner === 'EMPATE' && !cell.natural && !cell.win && cell.score === null}
                          class:is-win-solid={cell.win}
                        >
                          {#if cell.natural && (cell.score === undefined || cell.score === null)}
                            <span class="dot-natural" title="Victoria Natural (8 ó 9)"></span>
                          {/if}
                          {#if cell.score !== undefined && cell.score !== null}
                            <span class="bigroad-score" class:is-natural-score={cell.natural}>{cell.score}</span>
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

      <!-- 2. BEAD PLATE (OTRA CUADRILLA - VERDE, ABAJO DE LA PRINCIPAL) -->
      <div
        class="roadmap-card bead-card"
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

    <!-- COL-2 DERECHA: 3 CAMINOS DERIVADOS APILADOS VERTICALMENTE (CADA UNO COMO UNA TARJETA INDIVIDUAL) -->
    <div
      class="derived-roads-column"
      bind:clientWidth={derivedWidth}
      bind:clientHeight={derivedHeight}
      style="--derived-cell-size: {derivedCellSize}px;"
    >
      <!-- 1. BIG EYE BOY (GRAN OJO) -->
      <div class="roadmap-card derived-band" bind:this={bigEyeScrollEl}>
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
      <div class="roadmap-card derived-band" bind:this={smallRoadScrollEl}>
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
      <div class="roadmap-card derived-band" bind:this={cockroachScrollEl}>
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
  </section>

  <!-- FRANJA DE ESTADÍSTICAS Y PREDICCIÓN (3 COLUMNAS: COL-4 / COL-4 / COL-4) -->
  <section class="scoreboard-stats-bar">
    <!-- COLUMNA 1 (col-4): CONTADORES DE JUEGO -->
    <div class="stats-bar-col col-counters">
      <div class="stats-strip-counters">
        <!-- Total manos # -->
        <div class="counter-item" title="Total de manos jugadas en este zapato">
          <div class="bead-circle-badge bead-gray">#</div>
          <div class="counter-digit">{totalHands}</div>
        </div>

        <!-- Banker B -->
        <div class="counter-item" title="Victorias de Banca (Banker)">
          <div class="bead-circle-badge bead-red">B</div>
          <div class="counter-digit">{countBanca}</div>
        </div>

        <!-- Player P -->
        <div class="counter-item" title="Victorias de Punto (Player)">
          <div class="bead-circle-badge bead-blue">P</div>
          <div class="counter-digit">{countPunto}</div>
        </div>

        <!-- Tie T -->
        <div class="counter-item" title="Empates (Tie)">
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
    </div>

    <!-- COLUMNA 2 (col-4): PREDICCIÓN / NEXT (ASK BANKER & ASK PLAYER) -->
    <div class="stats-bar-col col-prediction">
      <span class="pred-title">Next</span>
      <div class="prediction-pills-row">
        <!-- Pill Ask Banker (B) -->
        <button
          type="button"
          class="pred-pill pred-pill-banker"
          on:click={() => handlePredictionClick('BANCA')}
          title="Predicción si gana BANCA: Gran Ojo ({nextBankerPrediction.bigEye || 'pendiente'}), Camino Pequeño ({nextBankerPrediction.smallRoad || 'pendiente'}), Cucaracha ({nextBankerPrediction.cockroach || 'pendiente'})"
        >
          <span class="pred-badge-circle b">B</span>
          <span class="pred-symbol pred-ring {nextBankerPrediction.bigEye || 'neutral'}" title="Gran Ojo: {nextBankerPrediction.bigEye || 'pendiente'}"></span>
          <span class="pred-symbol pred-dot {nextBankerPrediction.smallRoad || 'neutral'}" title="Camino Pequeño: {nextBankerPrediction.smallRoad || 'pendiente'}"></span>
          <svg class="pred-symbol pred-slash {nextBankerPrediction.cockroach || 'neutral'}" width="14" height="14" viewBox="0 0 14 14" title="Cucaracha: {nextBankerPrediction.cockroach || 'pendiente'}">
            <line x1="2" y1="12" x2="12" y2="2" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
          </svg>
        </button>

        <!-- Pill Ask Player (P) -->
        <button
          type="button"
          class="pred-pill pred-pill-player"
          on:click={() => handlePredictionClick('PUNTO')}
          title="Predicción si gana PUNTO: Gran Ojo ({nextPlayerPrediction.bigEye || 'pendiente'}), Camino Pequeño ({nextPlayerPrediction.smallRoad || 'pendiente'}), Cucaracha ({nextPlayerPrediction.cockroach || 'pendiente'})"
        >
          <span class="pred-badge-circle p">P</span>
          <span class="pred-symbol pred-ring {nextPlayerPrediction.bigEye || 'neutral'}" title="Gran Ojo: {nextPlayerPrediction.bigEye || 'pendiente'}"></span>
          <span class="pred-symbol pred-dot {nextPlayerPrediction.smallRoad || 'neutral'}" title="Camino Pequeño: {nextPlayerPrediction.smallRoad || 'pendiente'}"></span>
          <svg class="pred-symbol pred-slash {nextPlayerPrediction.cockroach || 'neutral'}" width="14" height="14" viewBox="0 0 14 14" title="Cucaracha: {nextPlayerPrediction.cockroach || 'pendiente'}">
            <line x1="2" y1="12" x2="12" y2="2" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>

    <!-- COLUMNA 3 (col-4): RESUMEN DE PORCENTAJES -->
    <div class="stats-bar-col col-percentages">
      <div class="stats-strip-pct-box">
        <span class="pct-tag b">B: {pctBanca}%</span>
        <span class="pct-tag p">P: {pctPunto}%</span>
        <span class="pct-tag t">T: {pctEmpate}%</span>
      </div>
    </div>
  </section>

  <!-- PANEL OPERATIVO DE CONTROLES (SEPARADO Y MÁS GRANDE) -->
  {#if !isMonitorMode}
    <footer
      class="scoreboard-footer-panel"
      class:is-editing={isEditingHand}
      class:no-mesa-selected={!hasSelectedMesa}
      class:is-observer-mode={isObserverMode}
    >
    {#if isObserverMode}
      <div class="footer-observer-strip" title="Modo Observador en Vivo: Solo Lectura">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
        <span>Modo Observador: Botones deshabilitados (Solo Lectura en Vivo)</span>
      </div>
    {:else if !hasSelectedMesa}
      <div class="footer-no-mesa-banner">
        <div class="no-mesa-message">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <span>Botonera bloqueada: Seleccione una mesa para registrar jugadas</span>
          <button type="button" class="btn-select-mesa-alert" on:click={openOptionsMenu}>
            Seleccionar Mesa
          </button>
        </div>
      </div>
    {/if}

    {#if isEditingHand}
      <div class="footer-edit-banner">
        <div class="footer-edit-info">
          <span class="footer-edit-badge">EDITANDO MANO #{selectedHand.id || (selectedHandIndex + 1)}</span>
          <span class="footer-edit-text">Modifica el ganador, valor o pares en la botonera y pulsa <strong>Editar</strong> para guardar</span>
        </div>
        <button
          type="button"
          class="footer-btn-del-hand"
          on:click={deleteSelectedHand}
          title="Eliminar esta mano del zapato"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
          Borrar Mano
        </button>
      </div>
    {/if}

    <!-- GRUPO 1: TECLADO NUMÉRICO (0 AL 9 - VALOR/PUNTAJE COMODÍN) -->
    <div class="footer-score-col">
      <div class="score-keypad-box">
        <div class="score-keypad-grid">
          {#each [1, 2, 3, 4, 5, 6, 7, 8, 9] as num}
            <button
              type="button"
              class="btn-num-key btn-num-{num}"
              class:active={isEditingHand ? selectedHand.score === num : activeScore === num}
              disabled={isObserverMode || !isCurrentShoeActive || (isEditingHand ? (selectedHand.natural && num !== 8 && num !== 9) : (activeNatural && num !== 8 && num !== 9))}
              on:click={() => handleKeypadNumber(num)}
              title={isObserverMode ? 'Modo Observador: Botón deshabilitado (Solo Lectura)' : (!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : ((isEditingHand ? selectedHand.natural : activeNatural) && num !== 8 && num !== 9 ? 'Con Natural activo solo se permiten 8 y 9' : `Seleccionar valor ${num} para la mano`))}
            >
              {num}
            </button>
          {/each}
          <!-- 0 al lado del 3, 6, 9 abarcando todo el largo de las 3 filas -->
          <button
            type="button"
            class="btn-num-key btn-num-zero"
            class:active={isEditingHand ? selectedHand.score === 0 : activeScore === 0}
            disabled={isObserverMode || !isCurrentShoeActive || (isEditingHand ? selectedHand.natural : activeNatural)}
            on:click={() => handleKeypadNumber(0)}
            title={isObserverMode ? 'Modo Observador: Botón deshabilitado (Solo Lectura)' : (!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : ((isEditingHand ? selectedHand.natural : activeNatural) ? 'Con Natural activo solo se permiten 8 y 9' : 'Seleccionar valor 0 para la mano'))}
          >
            0
          </button>
        </div>
      </div>
    </div>

    <!-- GRUPO 2: MODIFIERS (P.PAIR, B.PAIR, NATURAL) Y BOTÓN WIN MORADO AL LADO -->
    <div class="footer-modifiers-col">
      <div class="modifiers-subgrid">
        <div class="modifiers-left-stack">
          <button
            type="button"
            class="keypad-pill pill-ppair"
            class:active={isEditingHand ? selectedHand.pPair : activePPair}
            disabled={isObserverMode || !isCurrentShoeActive}
            on:click={handleTogglePPair}
            title={isObserverMode ? 'Modo Observador: Botón deshabilitado (Solo Lectura)' : (!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : 'Activar/Desactivar Pareja de Punto (P.Pair)')}
          >
            P.Pair
          </button>

          <button
            type="button"
            class="keypad-pill pill-bpair"
            class:active={isEditingHand ? selectedHand.bPair : activeBPair}
            disabled={isObserverMode || !isCurrentShoeActive}
            on:click={handleToggleBPair}
            title={isObserverMode ? 'Modo Observador: Botón deshabilitado (Solo Lectura)' : (!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : 'Activar/Desactivar Pareja de Banca (B.Pair)')}
          >
            B.Pair
          </button>

          <button
            type="button"
            class="keypad-pill pill-natural"
            class:active={isEditingHand ? selectedHand.natural : activeNatural}
            disabled={isObserverMode || !isCurrentShoeActive || (isEditingHand ? (selectedHand.score !== null && selectedHand.score !== undefined && selectedHand.score !== 8 && selectedHand.score !== 9) : (activeScore !== null && activeScore !== 8 && activeScore !== 9))}
            on:click={handleToggleNatural}
            title={isObserverMode ? 'Modo Observador: Botón deshabilitado (Solo Lectura)' : (!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : ((isEditingHand ? (selectedHand.score !== null && selectedHand.score !== undefined && selectedHand.score !== 8 && selectedHand.score !== 9) : (activeScore !== null && activeScore !== 8 && activeScore !== 9)) ? 'Natural solo aplica a puntajes 8 ó 9' : 'Activar/Desactivar Victoria Natural (8 ó 9)'))}
          >
            Natural
          </button>
        </div>

        <div class="modifiers-right-stack">
          <button
            type="button"
            class="keypad-pill pill-win"
            class:active={isEditingHand ? selectedHand.win : activeWin}
            disabled={isObserverMode || !isCurrentShoeActive}
            on:click={handleToggleWin}
            title={isObserverMode ? 'Modo Observador: Botón deshabilitado (Solo Lectura)' : (!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : 'Activar/Desactivar Victoria WIN (Círculo sólido en Gran Camino con letras blancas)')}
          >
            Win
          </button>
        </div>
      </div>
    </div>

    <!-- GRUPO 3: RESULTADOS PRINCIPALES (PUNTO, BANCA, EMPATE) - BOTONES GRANDES -->
    <div class="footer-outcomes-col">
      <div class="outcomes-grid-3col">
        <!-- PUNTO BUTTON -->
        <div class="action-btn-item">
          <button
            type="button"
            class="keypad-btn-circle btn-punto"
            class:is-chosen-winner={isEditingHand && selectedHand.winner === 'PUNTO'}
            disabled={isObserverMode || !isCurrentShoeActive}
            on:click={() => handleSelectOutcome('PUNTO')}
            title={isObserverMode ? 'Modo Observador: Botón deshabilitado (Solo Lectura)' : (isEditingHand ? 'Cambiar ganador a PUNTO (Player)' : (!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : 'Registrar victoria de PUNTO (Player)'))}
          >
            {#if isEditingHand ? selectedHand.bPair : activeBPair}
              <span class="badge-corner-tl" title="B.Pair activo"></span>
            {/if}
            {#if isEditingHand ? selectedHand.pPair : activePPair}
              <span class="badge-corner-br" title="P.Pair activo"></span>
            {/if}
            <div class="btn-inner-gloss">
              <span class="btn-letter">P</span>
            </div>
          </button>
          <span class="btn-caption punto-caption" class:is-chosen-caption={isEditingHand && selectedHand.winner === 'PUNTO'}>PUNTO</span>
        </div>

        <!-- BANCA BUTTON -->
        <div class="action-btn-item">
          <button
            type="button"
            class="keypad-btn-circle btn-banca"
            class:is-chosen-winner={isEditingHand && selectedHand.winner === 'BANCA'}
            disabled={isObserverMode || !isCurrentShoeActive}
            on:click={() => handleSelectOutcome('BANCA')}
            title={isObserverMode ? 'Modo Observador: Botón deshabilitado (Solo Lectura)' : (isEditingHand ? 'Cambiar ganador a BANCA (Banker)' : (!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : 'Registrar victoria de BANCA (Banker)'))}
          >
            {#if isEditingHand ? selectedHand.bPair : activeBPair}
              <span class="badge-corner-tl" title="B.Pair activo"></span>
            {/if}
            {#if isEditingHand ? selectedHand.pPair : activePPair}
              <span class="badge-corner-br" title="P.Pair activo"></span>
            {/if}
            <div class="btn-inner-gloss">
              <span class="btn-letter">B</span>
            </div>
          </button>
          <span class="btn-caption banca-caption" class:is-chosen-caption={isEditingHand && selectedHand.winner === 'BANCA'}>BANCA</span>
        </div>

        <!-- EMPATE BUTTON -->
        <div class="action-btn-item">
          <button
            type="button"
            class="keypad-btn-circle btn-tie"
            class:is-chosen-winner={isEditingHand && selectedHand.winner === 'EMPATE'}
            disabled={isObserverMode || !isCurrentShoeActive}
            on:click={() => handleSelectOutcome('EMPATE')}
            title={isObserverMode ? 'Modo Observador: Botón deshabilitado (Solo Lectura)' : (isEditingHand ? 'Cambiar ganador a EMPATE (Tie)' : (!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : 'Registrar EMPATE (Tie)'))}
          >
            {#if isEditingHand ? selectedHand.bPair : activeBPair}
              <span class="badge-corner-tl" title="B.Pair activo"></span>
            {/if}
            {#if isEditingHand ? selectedHand.pPair : activePPair}
              <span class="badge-corner-br" title="P.Pair activo"></span>
            {/if}
            <div class="btn-inner-gloss">
              <span class="btn-letter">T</span>
            </div>
          </button>
          <span class="btn-caption tie-caption" class:is-chosen-caption={isEditingHand && selectedHand.winner === 'EMPATE'}>EMPATE</span>
        </div>
      </div>
    </div>

    <!-- GRUPO 4: ACCIÓN RETROCEDER / ATRÁS Y BOTÓN VISUALIZAR TIE / EDITAR -->
    <div class="footer-undo-col">
      <div class="action-btn-item">
        <button
          type="button"
          class="keypad-btn-circle btn-undo"
          class:is-btn-atras={isEditingHand}
          on:click={handleBackOrUndo}
          disabled={isObserverMode || !isCurrentShoeActive || (!isEditingHand && history.length === 0)}
          title={isObserverMode ? 'Modo Observador: Botón deshabilitado (Solo Lectura)' : (isEditingHand ? 'Salir del modo edición sin guardar más cambios (Atrás)' : (!isCurrentShoeActive ? (isViewingPastShoe ? 'Zapato histórico en modo solo lectura' : 'Sesión histórica en modo solo lectura') : history.length === 0 ? 'No hay manos para retroceder' : 'Retroceder / Deshacer última mano registrada'))}
        >
          <div class="btn-inner-gloss">
            <svg class="btn-arrow-icon" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5m0 0l6-6M5 12l6 6" />
            </svg>
          </div>
        </button>
        <span class="btn-caption undo-caption" class:is-atras-caption={isEditingHand}>
          {isEditingHand ? 'Atrás' : 'RETROCEDER'}
        </span>
      </div>

      <!-- BOTÓN VISUALIZAR TIE (SLASH [/] vs CIRCLE [O]) O GUARDAR EDICIÓN -->
      <div class="action-btn-item">
        <button
          type="button"
          class="keypad-btn-tie-toggle"
          class:is-btn-editar={isEditingHand}
          on:click={handleConfirmEditOrTieToggle}
          title={isEditingHand ? 'Guardar y confirmar cambios de la mano' : (tieMode === 'slash' ? 'Modo Tie actual: Raya diagonal [/] (Clic para cambiar a Círculo [O])' : 'Modo Tie actual: Círculo [O] (Clic para cambiar a Raya diagonal [/])')}
        >
          <div class="tie-toggle-box">
            {#if isEditingHand}
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" class="editar-icon-svg">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            {:else if tieMode === 'slash'}
              <svg width="52" height="52" viewBox="0 0 32 32" class="tie-toggle-svg">
                <line x1="5" y1="27" x2="27" y2="5" stroke="#0f172a" stroke-width="4" stroke-linecap="round" />
              </svg>
            {:else}
              <svg width="52" height="52" viewBox="0 0 32 32" class="tie-toggle-svg">
                <circle cx="16" cy="16" r="11" stroke="#0f172a" stroke-width="4" fill="none" />
              </svg>
            {/if}
          </div>
        </button>
        <span class="btn-caption tie-toggle-caption" class:is-editar-caption={isEditingHand}>
          {isEditingHand ? 'Editar' : 'Tie'}
        </span>
      </div>
    </div>
  </footer>
  {/if}

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

            <!-- COL-6: Crear Nueva Sesión -->
            <button
              type="button"
              class="btn-opt col-6 btn-opt-new-session"
              on:click={handleCreateNewSession}
              disabled={isSessionsLoading || !isLatestSession}
              title={!isLatestSession ? 'Solo se puede crear nueva sesión desde la última sesión' : `Crear nueva sesión (${nextSessionDateStr})`}
            >
              <span>Crear Nueva Sesión</span>
              <span class="btn-opt-date-badge">Fecha: {nextSessionDateStr}</span>
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

            <!-- COL-6: Alternar Pantalla Completa -->
            <button
              type="button"
              class="btn-opt col-6 btn-opt-fullscreen"
              class:is-active={isFullscreen}
              on:click={toggleFullscreen}
              title={isFullscreen ? 'Salir de Pantalla Completa' : 'Entrar a Pantalla Completa'}
            >
              {#if isFullscreen}
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; flex-shrink: 0;">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
                </svg>
                Salir Pantalla Completa
              {:else}
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; flex-shrink: 0;">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                </svg>
                Pantalla Completa
              {/if}
            </button>

            <!-- COL-6: Alternar Tema Claro / Oscuro -->
            <button
              type="button"
              class="btn-opt col-6 btn-opt-theme"
              class:is-light={currentTheme === 'light'}
              on:click={toggleTheme}
              title={currentTheme === 'light' ? 'Cambiar a Tema Oscuro' : 'Cambiar a Tema Claro'}
            >
              {#if currentTheme === 'light'}
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; flex-shrink: 0;">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                </svg>
                Tema Oscuro
              {:else}
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; flex-shrink: 0;">
                  <circle cx="12" cy="12" r="5"></circle>
                  <line x1="12" y1="1" x2="12" y2="3"></line>
                  <line x1="12" y1="21" x2="12" y2="23"></line>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                  <line x1="1" y1="12" x2="3" y2="12"></line>
                  <line x1="21" y1="12" x2="23" y2="12"></line>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                </svg>
                Tema Claro
              {/if}
            </button>

            <!-- COL-12: MODO MONITOR (ENTRAR / SALIR) -->
            <button
              type="button"
              class="btn-opt col-12 btn-opt-monitor"
              class:is-active={isMonitorMode}
              on:click={toggleMonitorMode}
              title={isMonitorMode ? 'Salir de Modo Monitor (Mostrar botonera)' : 'Entrar a Modo Monitor (Ocultar botonera y maximizar cuadrillas para pantalla o TV)'}
            >
              <div class="btn-opt-monitor-inner">
                <div class="btn-opt-monitor-title">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px; flex-shrink: 0;">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                    <line x1="8" y1="21" x2="16" y2="21"></line>
                    <line x1="12" y1="17" x2="12" y2="21"></line>
                  </svg>
                  <span>{isMonitorMode ? 'Salir de Modo Monitor' : 'Entrar a Modo Monitor'}</span>
                </div>
                <span class="btn-opt-monitor-sub">
                  {isMonitorMode ? 'Mostrar botonera de control' : 'Ocultar botonera y maximizar cuadrillas para pantalla'}
                </span>
                {#if isMonitorMode}
                  <span class="btn-opt-mode-badge is-active">● Activo</span>
                {:else}
                  <span class="btn-opt-mode-badge">Activar</span>
                {/if}
              </div>
            </button>

            <!-- COL-12: SECCIÓN SELECCIONAR MESA (OPTGROUP POR SALA) -->
            <div class="col-12 opt-select-mesa-container">
              <label for="sb-opt-mesa-select" class="opt-select-label">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 6h16M4 12h16m-7 6h7"/>
                </svg>
                <span>Seleccionar Mesa</span>
              </label>
              <div class="opt-select-wrapper">
                <select
                  id="sb-opt-mesa-select"
                  class="opt-mesa-select"
                  value={currentSelectedValue}
                  on:change={handleMesaSelectChange}
                >
                  <option value="" disabled selected={!hasSelectedMesa}>-- Seleccione una mesa --</option>
                  {#each userAssignedSalasWithMesas as sGroup}
                    <optgroup label="Sala: {sGroup.nombre}">
                      {#each sGroup.mesas as mItem}
                        <option value="{sGroup.uuid || sGroup.id}::{mItem.uuid || mItem.id}">
                          {mItem.nombre || `Mesa ${mItem.id}`}
                        </option>
                      {/each}
                    </optgroup>
                  {/each}
                </select>
                <div class="opt-select-arrow">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>
              </div>
            </div>

            <!-- COL-12: VOLVER A HERRAMIENTAS (DIRECTAMENTE DEBAJO DEL SELECT) -->
            <button
              type="button"
              class="btn-opt col-12 btn-opt-back-herramientas"
              on:click={handleGoToHerramientas}
              title="Volver a la vista de Herramientas"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px; flex-shrink: 0;">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              Volver a Herramientas
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
    height: 100dvh;
    max-height: 100vh;
    max-height: 100dvh;
    width: 100vw;
    width: 100dvw;
    max-width: 100vw;
    max-width: 100dvw;
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
    width: 100vw;
    overflow: hidden;
  }

  /* HEADER */
  .sb-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 4px 2px 6px 2px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    flex-wrap: wrap;
    flex-shrink: 0;
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
    gap: 14px;
    flex-wrap: wrap;
  }

  /* BOTÓN SALA Y MESA EN ESQUINA IZQUIERDA (ABRE MODAL DE OPCIONES) */
  .sb-btn-table-info {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: #1e293b;
    border: 1.5px solid #334155;
    padding: 3px 14px;
    min-height: 36px;
    box-sizing: border-box;
    border-radius: 9999px;
    color: #f1f5f9;
    font-family: inherit;
    font-size: 14.5px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .sb-btn-table-info:hover {
    background: #334155;
    border-color: #475569;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
  }

  .sb-btn-table-info:active {
    transform: translateY(0);
  }

  .sb-btn-table-info .loc-val {
    color: #ffffff;
    font-weight: 800;
    font-size: 14.5px;
  }

  .sb-btn-table-info .loc-sep {
    color: #475569;
    font-weight: bold;
    margin: 0 3px;
  }

  /* CONTENEDORES ESTANDARIZADOS: ZAPATO Y SESIÓN */
  .sb-shoe-pill,
  .sb-session-navigator {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: #1e293b;
    border: 1.5px solid #334155;
    padding: 3px 5px;
    min-height: 36px;
    box-sizing: border-box;
    border-radius: 9999px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    transition: all 0.2s ease;
  }

  .sb-session-navigator.is-past {
    border-color: #475569;
  }

  /* BOTÓN NUEVO ZAPATO DIRECTO */
  .sb-btn-new-shoe {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    background: linear-gradient(135deg, rgba(2, 132, 199, 0.35) 0%, rgba(14, 165, 233, 0.2) 100%);
    border: 1.5px solid #0284c7;
    color: #38bdf8;
    padding: 0 16px;
    min-height: 38px;
    box-sizing: border-box;
    border-radius: 9999px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    line-height: 1;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    white-space: nowrap;
    user-select: none;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.3);
  }

  .sb-btn-new-shoe:hover:not(:disabled) {
    background: #0284c7;
    border-color: #38bdf8;
    color: #ffffff;
    transform: translateY(-1px);
    box-shadow: 0 0 12px rgba(56, 189, 248, 0.6);
  }

  .sb-btn-new-shoe:active:not(:disabled) {
    transform: translateY(0);
  }

  .sb-btn-new-shoe:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    background: #1e293b;
    border-color: #334155;
    color: #64748b;
    transform: none;
    box-shadow: none;
  }

  /* BOTONES DE NAVEGACIÓN UNIFICADOS (ADELANTE Y ATRÁS) */
  .nav-arrow-btn {
    width: 30px;
    height: 30px;
    min-width: 30px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.08);
    border: 1.5px solid rgba(255, 255, 255, 0.18);
    color: #38bdf8;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .nav-arrow-btn:hover:not(:disabled) {
    background: #0284c7;
    border-color: #38bdf8;
    color: #ffffff;
    transform: scale(1.08);
    box-shadow: 0 0 10px rgba(56, 189, 248, 0.5);
  }

  .nav-arrow-btn:active:not(:disabled) {
    transform: scale(0.94);
  }

  .nav-arrow-btn:disabled {
    opacity: 0.22;
    cursor: not-allowed;
    background: transparent;
    border-color: rgba(255, 255, 255, 0.08);
    color: #64748b;
    transform: none;
    box-shadow: none;
  }

  /* CONTENIDO DE ZAPATO */
  .shoe-pill-content {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 6px;
    user-select: none;
  }

  .pill-sub {
    font-size: 11px;
    color: #94a3b8;
    font-weight: 600;
  }

  .pill-label {
    color: #94a3b8;
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 0.5px;
  }

  .pill-value {
    color: #38bdf8;
    font-weight: 800;
    font-size: 13.5px;
  }

  .pill-sep {
    color: #475569;
    font-weight: bold;
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


  /* HEADER CENTER / NAVEGADOR DE SESIONES */
  .sb-header-center {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    min-width: 220px;
  }

  .session-label-wrapper {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 6px;
    user-select: none;
  }

  .session-label-text {
    font-size: 13.5px;
    font-weight: 800;
    letter-spacing: 0.5px;
    white-space: nowrap;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  }

  .session-label-text.actual {
    color: #38bdf8;
  }

  .session-label-text.past {
    color: #94a3b8;
  }

  .session-date-text {
    color: #f1f5f9;
    font-size: 13.5px;
    font-weight: 700;
    letter-spacing: 0.5px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  /* BOTONES SUPERIORES */
  .sb-header-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .sb-btn {
    border: none;
    border-radius: 8px;
    padding: 0 16px;
    min-height: 38px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
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
    width: clamp(22px, 1.8vw, 28px);
    height: clamp(22px, 1.8vw, 28px);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: clamp(11px, 0.9vw, 13.5px);
    font-weight: 900;
    color: #ffffff;
    box-shadow: 0 1.5px 3px rgba(0, 0, 0, 0.25), inset 0 1.5px 1.5px rgba(255, 255, 255, 0.6);
    position: relative;
    user-select: none;
    flex-shrink: 0;
  }

  .bead-gray { background: radial-gradient(circle at 35% 30%, #9ca3af, #4b5563); }
  .bead-red { background: radial-gradient(circle at 35% 30%, #ef4444, #b91c1c); }
  .bead-blue { background: radial-gradient(circle at 35% 30%, #3b82f6, #1d4ed8); }
  .bead-green { background: radial-gradient(circle at 35% 30%, #22c55e, #15803d); }
  .bead-orange { background: radial-gradient(circle at 35% 30%, #f97316, #c2410c); }
  
  .bead-white {
    background: radial-gradient(circle at 35% 30%, #ffffff, #f1f5f9);
    border: 1.5px solid #cbd5e1;
    color: #1e293b;
    overflow: visible;
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
    box-sizing: border-box;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  }
  .dot-tl.red-dot {
    top: 2px;
    left: 2px;
    background: #ef4444;
  }
  .dot-br.blue-dot {
    bottom: 2px;
    right: 2px;
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

  /* OFFICIAL CASINO ROADMAPS MASTER SECTION (COL-10 IZQUIERDA Y COL-2 DERECHA) */
  .sb-roadmaps-master {
    display: grid;
    grid-template-columns: minmax(0, 10fr) minmax(0, 2fr);
    gap: 8px;
    flex: 1 1 auto;
    min-height: 260px;
    width: 100%;
    align-items: stretch;
  }

  /* COLUMNA IZQUIERDA (COL-10): GRAN CAMINO ARRIBA (ABARCA 2 DERIVADAS) Y PLATO DE BOLAS ABAJO (ABARCA 1) */
  .sb-roadmaps-left-col {
    display: grid;
    grid-template-rows: calc((100% - 16px) * 2 / 3 + 8px) calc((100% - 16px) / 3);
    gap: 8px;
    height: 100%;
    min-height: 0;
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

  /* CUADRILLA PRINCIPAL (ROJO): GRAN CAMINO - ABARCA EXACTAMENTE 2 DE LAS 3 DERIVADAS */
  .bigroad-card {
    min-height: 0;
    height: 100%;
    width: 100%;
    display: flex;
  }

  /* OTRA CUADRILLA (VERDE): PLATO DE BOLAS - ABARCA EXACTAMENTE LA 3RA DERIVADA */
  .bead-card {
    min-height: 0;
    height: 100%;
    width: 100%;
    display: flex;
  }

  /* COLUMNA DERECHA (COL-2): 3 CUADRILLAS DERIVADAS - APILADAS CON SEPARACIÓN IDÉNTICA A LAS OTRAS (GAP: 8PX) */
  .derived-roads-column {
    display: grid;
    grid-template-rows: repeat(3, minmax(0, 1fr));
    gap: 8px;
    height: 100%;
    min-height: 0;
    min-width: 0;
    width: 100%;
  }

  .derived-band {
    min-height: 0;
    height: 100%;
    width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    display: flex;
    align-items: center;
    background: #020617;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .derived-band::-webkit-scrollbar {
    display: none;
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
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .grid-scrollable::-webkit-scrollbar {
    display: none;
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
    height: var(--derived-cell-size, 9.5px);
  }

  .derived-cell {
    width: var(--derived-cell-size, 9.5px);
    min-width: var(--derived-cell-size, 9.5px);
    max-width: var(--derived-cell-size, 9.5px);
    height: var(--derived-cell-size, 9.5px);
    box-sizing: border-box;
    border: 1px solid #1e293b;
    padding: 0;
    text-align: center;
    vertical-align: middle;
    line-height: 0;
    font-size: 0;
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
    display: inline-block;
    vertical-align: middle;
    width: max(5px, calc(var(--derived-cell-size, 9.5px) * 0.68));
    height: max(5px, calc(var(--derived-cell-size, 9.5px) * 0.68));
    margin: 0 auto;
    border-radius: 50%;
    border: 1.4px solid transparent;
    box-sizing: border-box;
  }
  .derived-ring.red { border-color: #ef4444; }
  .derived-ring.blue { border-color: #3b82f6; }

  /* 2. Small Road: Punto sólido rojo / azul */
  .derived-dot {
    display: inline-block;
    vertical-align: middle;
    width: max(3.5px, calc(var(--derived-cell-size, 9.5px) * 0.52));
    height: max(3.5px, calc(var(--derived-cell-size, 9.5px) * 0.52));
    margin: 0 auto;
    border-radius: 50%;
  }
  .derived-dot.red { background: #ef4444; }
  .derived-dot.blue { background: #3b82f6; }

  /* 3. Cockroach Pig (Cucaracha): Línea diagonal roja / azul */
  .derived-slash {
    display: inline-block;
    vertical-align: middle;
    width: max(5.5px, calc(var(--derived-cell-size, 9.5px) * 0.78));
    height: 1.5px;
    margin: 0 auto;
    transform: rotate(-45deg);
    border-radius: 1px;
  }
  .derived-slash.red { background: #ef4444; }
  .derived-slash.blue { background: #3b82f6; }

  /* BEAD TABLE (EXACT SQUARES & COMPACT SCALED BEADS) */
  .bead-table tr {
    height: var(--bead-cell-size, 23px);
  }

  .bead-cell {
    width: var(--bead-cell-size, 23px);
    min-width: var(--bead-cell-size, 23px);
    max-width: var(--bead-cell-size, 23px);
    height: var(--bead-cell-size, 23px);
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
    width: calc(var(--bead-cell-size, 23px) - 3px);
    height: calc(var(--bead-cell-size, 23px) - 3px);
    border-radius: 50%;
    margin: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    color: #ffffff;
    user-select: none;
    box-sizing: border-box;
    box-shadow: 0 1.5px 4px rgba(0, 0, 0, 0.4);
  }

  .bead-circle.banca { background: #dc2626; }
  .bead-circle.punto { background: #2563eb; }
  .bead-circle.empate { background: #16a34a; }

  .bead-letter {
    font-size: calc(var(--bead-cell-size, 23px) * 0.52);
    font-weight: 900;
    line-height: 1;
    color: #ffffff;
  }
  .bead-letter.has-score {
    font-size: calc(var(--bead-cell-size, 23px) * 0.54);
    font-weight: 900;
    color: #ffffff;
  }

  .dot-b-pair {
    position: absolute;
    top: 0px;
    left: 0px;
    width: clamp(6px, calc(var(--bead-cell-size, 23px) * 0.36), 11px);
    height: clamp(6px, calc(var(--bead-cell-size, 23px) * 0.36), 11px);
    background: radial-gradient(circle at 35% 35%, #ff4d4d, #dc2626);
    border: 1.5px solid #ffffff;
    border-radius: 50%;
    z-index: 4;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
    box-sizing: border-box;
  }

  .dot-p-pair {
    position: absolute;
    bottom: 0px;
    right: 0px;
    width: clamp(6px, calc(var(--bead-cell-size, 23px) * 0.36), 11px);
    height: clamp(6px, calc(var(--bead-cell-size, 23px) * 0.36), 11px);
    background: radial-gradient(circle at 35% 35%, #60a5fa, #2563eb);
    border: 1.5px solid #ffffff;
    border-radius: 50%;
    z-index: 4;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
    box-sizing: border-box;
  }

  .bead-circle .dot-b-pair {
    width: clamp(10px, calc(var(--bead-cell-size, 26px) * 0.32), 14px);
    height: clamp(10px, calc(var(--bead-cell-size, 26px) * 0.32), 14px);
    top: -1px;
    left: -1px;
    border: 1.5px solid #ffffff;
  }
  .bead-circle .dot-p-pair {
    width: clamp(10px, calc(var(--bead-cell-size, 26px) * 0.32), 14px);
    height: clamp(10px, calc(var(--bead-cell-size, 26px) * 0.32), 14px);
    bottom: -1px;
    right: -1px;
    border: 1.5px solid #ffffff;
  }

  .bead-empty, .bigroad-empty {
    width: 100%;
    height: 100%;
  }

  /* BIG ROAD TABLE (EXACT SQUARES & COMPACT SCALED RINGS) */
  .bigroad-table tr {
    height: var(--big-cell-size, 23px);
  }

  .bigroad-cell {
    width: var(--big-cell-size, 23px);
    min-width: var(--big-cell-size, 23px);
    max-width: var(--big-cell-size, 23px);
    height: var(--big-cell-size, 23px);
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

  /* PUNTICO 3D ESFÉRICO DE VICTORIA NATURAL */
  .dot-natural {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: calc(var(--big-cell-size, 23px) * 0.44);
    height: calc(var(--big-cell-size, 23px) * 0.44);
    max-width: 11px;
    max-height: 11px;
    min-width: 6px;
    min-height: 6px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 32%, #ffffff 0%, #fed7aa 22%, #f59e0b 58%, #b45309 100%);
    box-shadow: 0 1px 2.5px rgba(0, 0, 0, 0.45), inset 0 0 1.5px rgba(255, 255, 255, 0.8);
    z-index: 2;
    pointer-events: none;
  }

  .bigroad-ring {
    width: calc(var(--big-cell-size, 23px) - 3px);
    height: calc(var(--big-cell-size, 23px) - 3px);
    border-radius: 50%;
    margin: auto;
    border: 2px solid transparent;
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
    border-color: #2563eb;
  }
  .bigroad-ring.empate {
    border-color: #22c55e;
  }

  .bigroad-ring.empate.tie-solid,
  .bigroad-ring.is-tie {
    border-color: #22c55e;
    background: transparent;
  }

  /* CÍRCULO SÓLIDO CUANDO SE PRESIONA WIN (Fondo completo y letras blancas) */
  .bigroad-ring.is-win-solid {
    border: 2px solid transparent;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
  }

  .bigroad-ring.is-win-solid.banca {
    background: radial-gradient(circle at 35% 30%, #ef4444 0%, #dc2626 60%, #991b1b 100%);
  }

  .bigroad-ring.is-win-solid.punto {
    background: radial-gradient(circle at 35% 30%, #3b82f6 0%, #2563eb 60%, #1d4ed8 100%);
  }

  .bigroad-ring.is-win-solid.empate {
    background: radial-gradient(circle at 35% 30%, #22c55e 0%, #16a34a 60%, #15803d 100%);
  }

  /* NÚMEROS MÁS GRANDES EN GRAN CAMINO */
  .bigroad-score {
    font-size: calc(var(--big-cell-size, 23px) * 0.66);
    font-weight: 600;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    color: #0f172a;
    line-height: 1;
    position: relative;
    z-index: 2;
    user-select: none;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .scoreboard-container:not(.theme-light) .bigroad-ring:not(.is-win-solid) .bigroad-score:not(.is-natural-score) {
    color: #f8fafc;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
  }

  /* EN CÍRCULOS SÓLIDOS DE WIN: TEXTO EN BLANCO BRILLANTE */
  .bigroad-ring.is-win-solid .bigroad-score:not(.is-natural-score) {
    color: #ffffff !important;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65);
  }

  /* SI TIENE NATURAL ACOMPAÑADO CON NÚMERO (8 Ó 9): COLOR DORADO / NARANJA CASINO */
  .bigroad-score.is-natural-score {
    color: #f89210 !important;
    font-weight: 600 !important;
    text-shadow: none !important;
  }

  .bigroad-tie-slash {
    position: absolute;
    top: 50%;
    left: 50%;
    width: calc(var(--big-cell-size, 23px) * 0.7);
    height: 2.5px;
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
    width: clamp(7px, calc(var(--big-cell-size, 28px) * 0.28), 14px);
    height: clamp(7px, calc(var(--big-cell-size, 28px) * 0.28), 14px);
    top: -1px;
    left: -1px;
    border: 1.5px solid #ffffff;
  }
  .bigroad-ring .dot-p-pair {
    width: clamp(7px, calc(var(--big-cell-size, 28px) * 0.28), 14px);
    height: clamp(7px, calc(var(--big-cell-size, 28px) * 0.28), 14px);
    bottom: -1px;
    right: -1px;
    border: 1.5px solid #ffffff;
  }

  /* BARRA DE ESTADÍSTICAS Y PREDICCIÓN (3 COLUMNAS: COL-4 / COL-4 / COL-4) */
  .scoreboard-stats-bar {
    background: #ffffff;
    border-radius: 12px;
    padding: 10px 22px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
    border: 2px solid #e2e8f0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: center;
    gap: 16px;
    width: 100%;
    box-sizing: border-box;
    flex-shrink: 0;
  }

  .stats-bar-col {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .stats-bar-col.col-counters {
    justify-content: flex-start;
  }

  .stats-bar-col.col-prediction {
    justify-content: center;
    gap: 14px;
  }

  .stats-bar-col.col-percentages {
    justify-content: flex-end;
  }

  .stats-strip-counters {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-wrap: nowrap;
    overflow-x: auto;
  }

  .counter-item {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }

  .bead-circle-badge {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    font-weight: 900;
    color: #ffffff;
    box-shadow: 0 1.5px 3px rgba(0, 0, 0, 0.25), inset 0 1px 1px rgba(255, 255, 255, 0.6);
    position: relative;
    user-select: none;
  }

  .counter-digit {
    font-size: 18px;
    font-weight: 900;
    color: #0f172a;
    line-height: 1;
    min-width: 14px;
  }

  /* PREDICCIÓN (NEXT / ASK BANKER & ASK PLAYER) */
  .pred-title {
    font-size: 17px;
    font-weight: 900;
    color: #1e293b;
    letter-spacing: 0.4px;
    user-select: none;
  }

  .prediction-pills-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: nowrap;
  }

  .pred-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    border-radius: 999px;
    padding: 4px 14px 4px 8px;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    transition: all 0.15s ease;
    user-select: none;
    line-height: 1;
  }

  .pred-pill:hover {
    background: #f8fafc;
    border-color: #94a3b8;
    transform: translateY(-1px);
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.12);
  }

  .pred-pill:active {
    transform: scale(0.96);
  }

  .pred-badge-circle {
    width: 25px;
    height: 25px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 900;
    color: #ffffff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }

  .pred-badge-circle.b {
    background: radial-gradient(circle at 35% 30%, #ef4444 0%, #dc2626 60%, #991b1b 100%);
  }

  .pred-badge-circle.p {
    background: radial-gradient(circle at 35% 30%, #3b82f6 0%, #2563eb 60%, #1d4ed8 100%);
  }

  .pred-symbol {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  /* 1. Gran Ojo (Hollow Ring) */
  .pred-symbol.pred-ring {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2.5px solid transparent;
    box-sizing: border-box;
  }
  .pred-symbol.pred-ring.red {
    border-color: #dc2626;
  }
  .pred-symbol.pred-ring.blue {
    border-color: #2563eb;
  }
  .pred-symbol.pred-ring.neutral {
    border-color: #cbd5e1;
  }

  /* 2. Camino Pequeño (Solid Dot) */
  .pred-symbol.pred-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
  }
  .pred-symbol.pred-dot.red {
    background-color: #dc2626;
  }
  .pred-symbol.pred-dot.blue {
    background-color: #2563eb;
  }
  .pred-symbol.pred-dot.neutral {
    background-color: #cbd5e1;
  }

  /* 3. Cucaracha (Diagonal Slash) */
  .pred-symbol.pred-slash {
    width: 14px;
    height: 14px;
  }
  .pred-symbol.pred-slash.red {
    color: #dc2626;
  }
  .pred-symbol.pred-slash.blue {
    color: #2563eb;
  }
  .pred-symbol.pred-slash.neutral {
    color: #cbd5e1;
  }

  .stats-strip-pct-box {
    display: flex;
    align-items: center;
    gap: 14px;
    background: #f1f5f9;
    padding: 6px 16px;
    border-radius: 999px;
    border: 1px solid #cbd5e1;
    font-size: 13.5px;
    font-weight: 800;
    white-space: nowrap;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  .pct-tag.b { color: #dc2626; }
  .pct-tag.p { color: #2563eb; }
  .pct-tag.t { color: #16a34a; }

  @media (max-width: 1180px) {
    .scoreboard-stats-bar {
      grid-template-columns: 1fr;
      gap: 12px;
      padding: 10px 14px;
    }
    .stats-bar-col.col-counters,
    .stats-bar-col.col-prediction,
    .stats-bar-col.col-percentages {
      justify-content: center;
    }
  }

  /* PANEL OPERATIVO DE CONTROLES: SECCIÓN MÁS GRANDE */
  .scoreboard-footer-panel {
    background: #ffffff;
    border-radius: 14px;
    padding: 16px 24px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    border: 2px solid #e2e8f0;
    display: grid;
    grid-template-columns: minmax(185px, 1.15fr) minmax(215px, 1.35fr) minmax(410px, 2.7fr) minmax(220px, 1.4fr);
    gap: 26px;
    align-items: center;
    flex-shrink: 0;
    position: relative;
    box-sizing: border-box;
    width: 100%;
  }

  /* MODO EDICIÓN ACTIVO: Borde amarillo llamativo */
  .scoreboard-footer-panel.is-editing {
    border: 3px solid #f59e0b !important;
    box-shadow: 0 0 22px rgba(245, 158, 11, 0.45), 0 8px 24px rgba(0, 0, 0, 0.25) !important;
  }

  /* BANNER SUPERIOR DE EDICIÓN EN EL FOOTER */
  .footer-edit-banner {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
    padding: 3px 12px;
    background: #fef3c7;
    border: 1.5px solid #f59e0b;
    border-radius: 8px;
    box-sizing: border-box;
    animation: fadeInEdit 0.15s ease-out;
  }

  @keyframes fadeInEdit {
    from { opacity: 0; transform: translateY(-3px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .footer-edit-info {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .footer-edit-badge {
    background: #f59e0b;
    color: #0f172a;
    font-size: 11px;
    font-weight: 900;
    padding: 2px 8px;
    border-radius: 4px;
    letter-spacing: 0.5px;
    white-space: nowrap;
  }

  .footer-edit-text {
    font-size: 11.5px;
    font-weight: 600;
    color: #92400e;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .footer-btn-del-hand {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: #dc2626;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .footer-btn-del-hand:hover {
    background: #b91c1c;
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(220, 38, 38, 0.4);
  }

  /* GRUPO 1: TECLADO NUMÉRICO (0 AL 9 - VALOR/PUNTAJE COMODÍN) */
  .footer-score-col {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding-right: 22px;
    border-right: 2px solid #cbd5e1;
    min-width: 0;
  }

  .score-keypad-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    max-width: 225px;
  }

  .score-keypad-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr) 1.25fr;
    grid-template-rows: repeat(3, 48px);
    grid-template-areas:
      "n1 n2 n3 n0"
      "n4 n5 n6 n0"
      "n7 n8 n9 n0";
    gap: 6px;
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
    font-size: 28px;
    font-weight: 900;
  }

  .btn-num-key {
    border-radius: 8px;
    border: 1.5px solid #cbd5e1;
    background: linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%);
    color: #0f172a;
    font-family: inherit;
    font-size: 21px;
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

  /* GRUPO 2: MODIFIERS (P.PAIR, B.PAIR, NATURAL) Y BOTÓN WIN MORADO AL LADO */
  .footer-modifiers-col {
    display: flex;
    justify-content: center;
    align-items: center;
    padding-right: 22px;
    border-right: 2px solid #cbd5e1;
    min-width: 0;
    width: 100%;
  }

  .modifiers-subgrid {
    display: flex;
    align-items: stretch;
    justify-content: center;
    gap: 12px;
    width: 100%;
    max-width: 250px;
  }

  .modifiers-left-stack {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 8px;
    flex: 1 1 auto;
    min-width: 0;
  }

  .modifiers-left-stack .keypad-pill {
    width: 100%;
    max-width: 130px;
    height: 42px;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 0.3px;
    margin: 0 auto;
  }

  .modifiers-right-stack {
    display: flex;
    flex-direction: column;
    justify-content: stretch;
    flex: 0 0 auto;
    width: 82px;
  }

  .modifiers-right-stack .keypad-pill.pill-win {
    width: 100%;
    height: 100%;
    min-height: 142px;
    border-radius: 24px;
    font-size: 19px;
    font-weight: 900;
    letter-spacing: 0.5px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  /* GRUPO 3: RESULTADOS PRINCIPALES (PUNTO, BANCA, EMPATE) - MÁS GRANDES */
  .footer-outcomes-col {
    display: flex;
    justify-content: center;
    align-items: center;
    padding-right: 22px;
    border-right: 2px solid #cbd5e1;
    min-width: 0;
  }

  .outcomes-grid-3col {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 30px;
    width: 100%;
    max-width: 520px;
  }

  /* GRUPO 4: ACCIÓN RETROCEDER Y VISUALIZAR TIE */
  .footer-undo-col {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 22px;
    min-width: 0;
  }

  .action-btn-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  /* BOTÓN CUADRADO TOGGLE DE TIE (SLASH [/] vs CÍRCULO [O]) */
  .keypad-btn-tie-toggle {
    width: 94px;
    height: 94px;
    background: #ffffff;
    border: 3px solid #0f172a;
    border-radius: 14px;
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
    font-size: 15px;
    font-weight: 900;
    color: #1e293b;
    letter-spacing: 0.5px;
  }

  /* BOTÓN EDITAR EN MODO EDICIÓN */
  .keypad-btn-tie-toggle.is-btn-editar {
    border: 3.5px solid #f59e0b;
    background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
    color: #92400e;
    box-shadow: 0 0 14px rgba(245, 158, 11, 0.45);
  }

  .keypad-btn-tie-toggle.is-btn-editar:hover {
    background: #fde047;
    border-color: #d97706;
    color: #78350f;
    transform: translateY(-2px);
    box-shadow: 0 0 18px rgba(245, 158, 11, 0.65);
  }

  .editar-icon-svg {
    stroke: #b45309;
  }

  .is-editar-caption, .is-atras-caption {
    color: #b45309 !important;
    font-weight: 900 !important;
  }

  /* GANADOR SELECCIONADO EN MODO EDICIÓN */
  .keypad-btn-circle.is-chosen-winner {
    outline: 4.5px solid #f59e0b !important;
    outline-offset: 3px !important;
    transform: scale(1.08) !important;
    box-shadow: 0 0 20px rgba(245, 158, 11, 0.8), 0 8px 16px rgba(0, 0, 0, 0.35) !important;
    filter: brightness(1.12) !important;
    z-index: 3;
  }

  .scoreboard-footer-panel.is-editing .keypad-btn-circle:not(.is-chosen-winner) {
    opacity: 0.55;
    filter: grayscale(0.2);
  }

  .scoreboard-footer-panel.is-editing .keypad-btn-circle:not(.is-chosen-winner):hover {
    opacity: 0.95;
    filter: none;
    transform: scale(1.03);
  }

  .btn-caption.is-chosen-caption {
    color: #f59e0b !important;
    font-weight: 900 !important;
    text-shadow: 0 0 8px rgba(245, 158, 11, 0.4);
  }

  @media (max-width: 1024px) {
    .scoreboard-footer-panel {
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .footer-score-col, .footer-modifiers-col, .footer-outcomes-col {
      border-right: none;
      border-bottom: 2px solid #cbd5e1;
      padding-right: 0;
      padding-bottom: 14px;
    }
    .footer-modifiers-col {
      justify-content: center;
      padding-bottom: 14px;
    }
  }

  @media (max-width: 600px) {
    .outcomes-grid-3col {
      gap: 14px;
    }
    .modifiers-subgrid {
      gap: 6px;
    }
    .modifiers-left-stack .keypad-pill {
      height: 38px;
      font-size: 13px;
    }
    .modifiers-right-stack {
      width: 65px;
    }
    .modifiers-right-stack .keypad-pill.pill-win {
      font-size: 16px;
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
  .keypad-pill.pill-ppair:hover:not(.active):not(:disabled) {
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
  .keypad-pill.pill-bpair:hover:not(.active):not(:disabled) {
    background: rgba(220, 38, 38, 0.06);
  }
  .keypad-pill.pill-bpair.active {
    background: radial-gradient(circle at 50% 30%, #ef4444, #990000);
    color: #ffffff;
    border-color: #880000;
    box-shadow: 0 0 12px rgba(220, 38, 38, 0.5);
  }

  .keypad-pill.pill-natural {
    border: 2.5px solid #ea580c;
    color: #ea580c;
  }
  .keypad-pill.pill-natural:hover:not(.active):not(:disabled) {
    background: rgba(234, 88, 12, 0.06);
  }
  .keypad-pill.pill-natural.active {
    background: radial-gradient(circle at 50% 30%, #f97316, #c2410c);
    color: #ffffff;
    border-color: #9a3412;
    box-shadow: 0 0 12px rgba(234, 88, 12, 0.5);
  }

  /* BOTÓN WIN MORADO (Referencia Imagen 3 y 4) */
  .keypad-pill.pill-win {
    border: 2.5px solid #7c3aed;
    color: #7c3aed;
  }
  .keypad-pill.pill-win:hover:not(.active):not(:disabled) {
    background: rgba(124, 58, 237, 0.08);
  }
  .keypad-pill.pill-win.active {
    background: radial-gradient(circle at 50% 30%, #8b5cf6, #6d28d9);
    color: #ffffff;
    border-color: #5b21b6;
    box-shadow: 0 0 14px rgba(124, 58, 237, 0.55);
  }

  /* 3D CIRCULAR CASINO BUTTONS */
  .keypad-btn-circle {
    width: 118px;
    height: 118px;
    border-radius: 50%;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border: none;
    background: linear-gradient(145deg, #ffffff, #94a3b8, #cbd5e1);
    padding: 5px;
    box-shadow: 0 7px 20px rgba(0, 0, 0, 0.38), inset 0 2px 2px rgba(255, 255, 255, 0.9);
    transition: transform 0.1s ease, box-shadow 0.1s ease;
    user-select: none;
  }

  .keypad-btn-circle.btn-undo {
    width: 106px;
    height: 106px;
  }

  @media (max-width: 600px) {
    .keypad-btn-circle {
      width: 76px;
      height: 76px;
    }
    .keypad-btn-circle.btn-undo {
      width: 76px;
      height: 76px;
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
    font-size: 58px;
    font-weight: 900;
    color: #ffffff;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.6);
    line-height: 1;
  }

  @media (max-width: 600px) {
    .btn-letter {
      font-size: 34px;
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
    width: 48px;
    height: 48px;
    display: block;
    color: #ffffff;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.65));
    transition: transform 0.1s ease;
  }

  @media (max-width: 600px) {
    .btn-arrow-icon {
      width: 32px;
      height: 32px;
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
    font-size: 16px;
    font-weight: 900;
    letter-spacing: 0.6px;
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
    flex-direction: column;
    gap: 4px;
    padding: 10px 8px;
  }
  .btn-opt-new-session:hover:not(:disabled) {
    background: #0284c7;
    color: #ffffff;
    box-shadow: 0 4px 10px rgba(2, 132, 199, 0.35);
  }
  .btn-opt-new-session .btn-opt-date-badge {
    font-size: 11px;
    font-weight: 800;
    color: #bae6fd;
    background: rgba(14, 116, 144, 0.45);
    padding: 2px 8px;
    border-radius: 6px;
    border: 1px solid rgba(56, 189, 248, 0.3);
    letter-spacing: 0.3px;
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

  /* SELECTOR DE MESA EN MODAL CON OPTGROUP POR SALA */
  .opt-select-mesa-container {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    margin-top: 6px;
    margin-bottom: 2px;
  }

  .opt-select-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 800;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .opt-select-wrapper {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
  }

  .opt-mesa-select {
    width: 100%;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    background: #1e293b;
    color: #f8fafc;
    border: 2px solid #3b82f6;
    border-radius: 10px;
    padding: 12px 38px 12px 14px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    outline: none;
    transition: all 0.2s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  }

  .opt-mesa-select:hover {
    border-color: #60a5fa;
    background: #243248;
  }

  .opt-mesa-select:focus {
    border-color: #38bdf8;
    box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.35);
  }

  .opt-mesa-select optgroup {
    background: #0f172a;
    color: #38bdf8;
    font-weight: 800;
    font-size: 13px;
    padding: 6px;
  }

  .opt-mesa-select option {
    background: #1e293b;
    color: #f8fafc;
    font-weight: 600;
    font-size: 14px;
    padding: 8px 12px;
  }

  .opt-select-arrow {
    position: absolute;
    right: 14px;
    pointer-events: none;
    color: #38bdf8;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* BOTÓN VOLVER A HERRAMIENTAS (DIRECTAMENTE DEBAJO DEL SELECT) */
  .btn-opt-back-herramientas {
    background: #1e293b;
    color: #f1f5f9;
    border: 1.5px solid #334155;
    margin-top: 4px;
    font-size: 14px;
    font-weight: 700;
    padding: 13px 16px;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .btn-opt-back-herramientas:hover {
    background: #334155;
    color: #ffffff;
    border-color: #475569;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  /* BOTÓN DE CABECERA CUANDO NO HAY MESA SELECCIONADA */
  .sb-btn-table-info.is-unselected {
    background: #0284c7;
    color: #ffffff;
    border: 1.5px solid #38bdf8;
    animation: sb-pulse-btn 2s infinite ease-in-out;
  }
  .sb-btn-table-info.is-unselected:hover {
    background: #0369a1;
    border-color: #7dd3fc;
  }
  @keyframes sb-pulse-btn {
    0%, 100% {
      box-shadow: 0 0 0 0 rgba(2, 132, 199, 0.6);
    }
    50% {
      box-shadow: 0 0 0 6px rgba(2, 132, 199, 0);
    }
  }

  /* MODO OBSERVADOR */
  .sb-observer-badge-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(2, 132, 199, 0.18);
    border: 1.5px solid #0284c7;
    color: #38bdf8;
    padding: 3px 10px;
    border-radius: 9999px;
    font-size: 11.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* MODO MONITOR */
  .sb-monitor-badge-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(139, 92, 246, 0.18);
    border: 1.5px solid #8b5cf6;
    color: #c4b5fd;
    padding: 3px 10px;
    border-radius: 9999px;
    font-size: 11.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    user-select: none;
    transition: all 0.2s ease;
  }

  .sb-monitor-badge-pill.is-btn {
    cursor: pointer;
    background: rgba(139, 92, 246, 0.22);
  }

  .sb-monitor-badge-pill.is-btn:hover {
    background: #7c3aed;
    border-color: #a78bfa;
    color: #ffffff;
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(139, 92, 246, 0.4);
  }

  .sb-monitor-badge-exit {
    font-size: 10px;
    opacity: 0.75;
    margin-left: 2px;
  }

  .scoreboard-container.is-monitor-mode {
    padding-bottom: clamp(4px, 0.8vh, 10px);
  }

  .scoreboard-container.is-monitor-mode .scoreboard-footer-panel {
    display: none !important;
  }

  .scoreboard-footer-panel.is-observer-mode {
    position: relative;
    border-color: rgba(2, 132, 199, 0.45) !important;
  }

  .scoreboard-footer-panel.is-observer-mode .footer-score-col,
  .scoreboard-footer-panel.is-observer-mode .footer-modifiers-col,
  .scoreboard-footer-panel.is-observer-mode .footer-outcomes-col,
  .scoreboard-footer-panel.is-observer-mode .footer-undo-col {
    filter: grayscale(1) contrast(0.85);
    opacity: 0.38;
    pointer-events: none;
    user-select: none;
    cursor: not-allowed;
  }

  .scoreboard-footer-panel.is-observer-mode .btn-num-key,
  .scoreboard-footer-panel.is-observer-mode .keypad-pill,
  .scoreboard-footer-panel.is-observer-mode .keypad-btn-circle,
  .scoreboard-footer-panel.is-observer-mode .btn-undo,
  .scoreboard-footer-panel.is-observer-mode .keypad-btn-tie-toggle {
    cursor: not-allowed !important;
    pointer-events: none !important;
    box-shadow: none !important;
    opacity: 0.32 !important;
    filter: grayscale(100%) !important;
  }

  .scoreboard-footer-panel.is-observer-mode .btn-caption {
    opacity: 0.4 !important;
    filter: grayscale(100%) !important;
    color: #94a3b8 !important;
  }

  .footer-observer-strip {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
    background: rgba(2, 132, 199, 0.12);
    border: 1px solid rgba(2, 132, 199, 0.3);
    border-radius: 6px;
    padding: 3px 12px;
    margin-bottom: 4px;
    color: #38bdf8;
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.3px;
    text-transform: uppercase;
  }

  .footer-observer-strip svg {
    color: #38bdf8;
    flex-shrink: 0;
  }

  /* BOTONERA EN GRIS SI NO HAY MESA SELECCIONADA */
  .scoreboard-footer-panel.no-mesa-selected {
    position: relative;
  }

  .scoreboard-footer-panel.no-mesa-selected .footer-score-col,
  .scoreboard-footer-panel.no-mesa-selected .footer-modifiers-col,
  .scoreboard-footer-panel.no-mesa-selected .footer-outcomes-col,
  .scoreboard-footer-panel.no-mesa-selected .footer-undo-col {
    filter: grayscale(1) contrast(0.8);
    opacity: 0.35;
    pointer-events: none;
    user-select: none;
    cursor: not-allowed;
  }

  .footer-no-mesa-banner {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    pointer-events: auto;
    background: rgba(15, 23, 42, 0.55);
    backdrop-filter: blur(2px);
    border-radius: 8px;
    padding: 8px;
  }

  .no-mesa-message {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    background: #0f172a;
    color: #f8fafc;
    padding: 8px 18px;
    border-radius: 9999px;
    font-size: 0.88rem;
    font-weight: 600;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    border: 1.5px solid rgba(255, 255, 255, 0.15);
  }

  .no-mesa-message svg {
    color: #f59e0b;
    flex-shrink: 0;
  }

  .btn-select-mesa-alert {
    background: #0284c7;
    color: #ffffff;
    border: none;
    padding: 5px 14px;
    border-radius: 9999px;
    font-size: 0.82rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
  }

  .btn-select-mesa-alert:hover {
    background: #0369a1;
    transform: scale(1.04);
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
  .keypad-pill:disabled,
  .edit-choice-btn:disabled,
  .edit-pill-toggle:disabled {
    opacity: 0.35;
    cursor: not-allowed;
    pointer-events: none;
    filter: grayscale(0.6);
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.7);
    backdrop-filter: blur(4px);
    z-index: 10000005;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .modal-backdrop-confirm {
    z-index: 10000010;
  }

  .btn-opt-fullscreen {
    background: #334155;
    color: #f1f5f9;
    border: 1.5px solid #475569;
  }
  .btn-opt-fullscreen:hover {
    background: #475569;
    color: #ffffff;
    border-color: #64748b;
    box-shadow: 0 4px 10px rgba(51, 65, 85, 0.35);
  }
  .btn-opt-fullscreen.is-active {
    background: #0284c7;
    color: #ffffff;
    border-color: #38bdf8;
    box-shadow: 0 4px 10px rgba(2, 132, 199, 0.35);
  }

  .btn-opt-theme {
    background: #b45309;
    color: #fef3c7;
    border: 1.5px solid #f59e0b;
  }
  .btn-opt-theme:hover {
    background: #92400e;
    color: #ffffff;
    border-color: #fbbf24;
    box-shadow: 0 4px 10px rgba(245, 158, 11, 0.35);
  }
  .btn-opt-theme.is-light {
    background: #1e293b;
    color: #e2e8f0;
    border: 1.5px solid #475569;
  }
  .btn-opt-theme.is-light:hover {
    background: #0f172a;
    color: #ffffff;
    border-color: #64748b;
    box-shadow: 0 4px 10px rgba(30, 41, 59, 0.35);
  }

  .btn-opt-mode-badge {
    font-size: 10.5px;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 9999px;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.7);
  }

  .btn-opt-mode-badge.is-active {
    background: #10b981;
    color: #ffffff;
    box-shadow: 0 0 8px rgba(16, 185, 129, 0.4);
  }

  /* BOTÓN MODO MONITOR EN MODAL */
  .btn-opt-monitor {
    background: #1e1b4b;
    color: #c4b5fd;
    border: 1.5px solid #6366f1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px 14px;
    gap: 8px;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .btn-opt-monitor:hover {
    background: #312e81;
    color: #e0e7ff;
    border-color: #818cf8;
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
  }

  .btn-opt-monitor.is-active {
    background: linear-gradient(135deg, #4f46e5, #6366f1);
    color: #ffffff;
    border-color: #a5b4fc;
    box-shadow: 0 4px 14px rgba(99, 102, 241, 0.45);
  }

  .btn-opt-monitor-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 10px;
  }

  .btn-opt-monitor-title {
    display: inline-flex;
    align-items: center;
    font-size: 13.5px;
    font-weight: 800;
  }

  .btn-opt-monitor-sub {
    font-size: 11px;
    opacity: 0.8;
    font-weight: 500;
    margin-left: auto;
    margin-right: 8px;
  }

  /* ========================================== */
  /* TEMA CLARO (LIGHT THEME CASINO SPEC)       */
  /* ========================================== */
  .scoreboard-container.theme-light {
    background: #f1f5f9;
    color: #0f172a;
  }

  .theme-light .sb-header {
    border-bottom: 1px solid #cbd5e1;
    padding: 4px 2px 6px 2px;
  }

  .theme-light .sb-shoe-pill {
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  /* TEMA CLARO: TITULO SALA Y MESA */
  .theme-light .sb-table-title {
    color: #0f172a;
  }
  .theme-light .sb-table-title .loc-label {
    color: #64748b;
  }
  .theme-light .sb-table-title .loc-val {
    color: #0f172a;
  }
  .theme-light .sb-table-title .loc-sep {
    color: #94a3b8;
  }

  /* TEMA CLARO: PILLS ESTANDARIZADAS ZAPATO Y SESIÓN */
  .theme-light .sb-shoe-pill,
  .theme-light .sb-session-navigator {
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  }

  .theme-light .sb-session-navigator.is-past {
    border-color: #94a3b8;
  }

  .theme-light .sb-btn-new-shoe {
    background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
    border: 1.5px solid #0284c7;
    color: #ffffff;
    box-shadow: 0 2px 6px rgba(2, 132, 199, 0.3);
  }
  .theme-light .sb-btn-new-shoe:hover:not(:disabled) {
    background: #0369a1;
    border-color: #075985;
    color: #ffffff;
    box-shadow: 0 0 10px rgba(2, 132, 199, 0.5);
  }
  .theme-light .sb-btn-new-shoe:disabled {
    background: #f1f5f9;
    border-color: #cbd5e1;
    color: #94a3b8;
    opacity: 0.7;
    box-shadow: none;
  }

  /* TEMA CLARO: BOTONES DE NAVEGACIÓN UNIFICADOS */
  .theme-light .nav-arrow-btn {
    background: #f8fafc;
    border: 1.5px solid #cbd5e1;
    color: #0284c7;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  }

  .theme-light .nav-arrow-btn:hover:not(:disabled) {
    background: #0284c7;
    border-color: #0369a1;
    color: #ffffff;
    transform: scale(1.08);
    box-shadow: 0 2px 6px rgba(2, 132, 199, 0.35);
  }

  .theme-light .nav-arrow-btn:active:not(:disabled) {
    transform: scale(0.94);
  }

  .theme-light .nav-arrow-btn:disabled {
    opacity: 0.28;
    background: transparent;
    border-color: #e2e8f0;
    color: #cbd5e1;
    transform: none;
    box-shadow: none;
  }

  /* TEMA CLARO: ZAPATO Y SESIÓN CONTENIDO */
  .theme-light .pill-label { color: #64748b; font-weight: 700; }
  .theme-light .pill-value { color: #0284c7; font-weight: 800; }
  .theme-light .pill-sub { color: #64748b; }
  .theme-light .pill-sep { color: #94a3b8; }

  .theme-light .session-label-text.actual {
    color: #0284c7;
    text-shadow: none;
  }
  .theme-light .session-label-text.past {
    color: #64748b;
    text-shadow: none;
  }
  .theme-light .session-date-text {
    color: #0f172a;
  }

  .theme-light .sb-btn-table-info {
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    color: #0f172a;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }
  .theme-light .sb-btn-table-info:hover {
    background: #f1f5f9;
    border-color: #94a3b8;
    color: #000000;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.08);
  }
  .theme-light .sb-btn-table-info .loc-val {
    color: #0f172a;
  }
  .theme-light .sb-btn-table-info .loc-sep {
    color: #94a3b8;
  }

  .theme-light .sb-btn-options {
    background: #ffffff;
    color: #0f172a;
    border: 1.5px solid #cbd5e1;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }
  .theme-light .sb-btn-options:hover {
    background: #f1f5f9;
    border-color: #94a3b8;
    color: #000000;
  }

  .theme-light .sb-btn-back {
    background: #f8fafc;
    color: #334155;
    border: 1.5px solid #cbd5e1;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }
  .theme-light .sb-btn-back:hover {
    background: #e2e8f0;
    color: #0f172a;
  }

  .theme-light .roadmap-card,
  .theme-light .bead-card {
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }

  .theme-light .derived-band {
    background: #ffffff;
  }

  .theme-light .grid-scrollable {
    background: #ffffff;
  }

  .theme-light .bigroad-cell,
  .theme-light .bead-cell,
  .theme-light .derived-cell {
    border: 1px solid #e2e8f0;
  }

  .theme-light .bigroad-cell.has-hand:hover,
  .theme-light .bead-cell.has-hand:hover,
  .theme-light .derived-cell:hover {
    background: rgba(0, 0, 0, 0.04);
  }

  .theme-light .bigroad-ring:not(.is-win-solid) .bigroad-score:not(.is-natural-score) {
    color: #0f172a;
    text-shadow: none;
  }
  .theme-light .bigroad-ring.is-win-solid .bigroad-score:not(.is-natural-score) {
    color: #ffffff !important;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65);
  }
  .theme-light .bigroad-score.is-natural-score {
    color: #f89210 !important;
    text-shadow: none !important;
  }

  .theme-light .tie-badge-num {
    border: 1.5px solid #ffffff;
  }

  .theme-light .scoreboard-footer-panel {
    background: #ffffff;
    border: 2px solid #cbd5e1;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
  }
  .theme-light .scoreboard-footer-panel.is-editing {
    border: 3px solid #f59e0b !important;
    box-shadow: 0 0 20px rgba(245, 158, 11, 0.4), 0 4px 14px rgba(0, 0, 0, 0.08) !important;
  }
  .theme-light .scoreboard-stats-bar {
    background: #ffffff;
    border: 2px solid #cbd5e1;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
  }

  .theme-light .pred-pill {
    background: #ffffff;
    border: 1.5px solid #cbd5e1;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }
  .theme-light .pred-pill:hover {
    background: #f1f5f9;
    border-color: #94a3b8;
  }

  .theme-light .stats-strip-pct-box {
    background: #ffffff;
    border: 1px solid #cbd5e1;
  }

  .theme-light .modal-backdrop {
    background: rgba(15, 23, 42, 0.5);
  }

  .theme-light .opt-select-label {
    color: #475569;
  }

  .theme-light .opt-mesa-select {
    background: #ffffff;
    color: #0f172a;
    border: 2px solid #0284c7;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
  }

  .theme-light .opt-mesa-select:hover {
    background: #f8fafc;
    border-color: #0369a1;
  }

  .theme-light .opt-mesa-select optgroup {
    background: #f1f5f9;
    color: #0369a1;
  }

  .theme-light .opt-mesa-select option {
    background: #ffffff;
    color: #0f172a;
  }

  .theme-light .opt-select-arrow {
    color: #0284c7;
  }

  .theme-light .btn-opt-back-herramientas {
    background: #f1f5f9;
    color: #0f172a;
    border: 1.5px solid #cbd5e1;
  }
  .theme-light .btn-opt-back-herramientas:hover {
    background: #e2e8f0;
    color: #000000;
    border-color: #94a3b8;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  }

  .theme-light .footer-no-mesa-banner {
    background: rgba(241, 245, 249, 0.65);
  }

  .theme-light .no-mesa-message {
    background: #ffffff;
    color: #0f172a;
    border: 1.5px solid #cbd5e1;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
  }

  .theme-light .sb-observer-badge-pill {
    background: #e0f2fe;
    border-color: #0284c7;
    color: #0369a1;
  }

  .theme-light .scoreboard-footer-panel.is-observer-mode {
    border-color: #93c5fd !important;
  }

  .theme-light .footer-observer-strip {
    background: #e0f2fe;
    border-color: #bae6fd;
    color: #0369a1;
  }

  .theme-light .footer-observer-strip svg {
    color: #0284c7;
  }

  .theme-light .scoreboard-footer-panel.is-observer-mode .btn-caption {
    color: #64748b !important;
  }

  .theme-light .sb-monitor-badge-pill {
    background: #ede9fe;
    border-color: #8b5cf6;
    color: #6d28d9;
  }

  .theme-light .sb-monitor-badge-pill.is-btn:hover {
    background: #7c3aed;
    border-color: #6d28d9;
    color: #ffffff;
    box-shadow: 0 2px 8px rgba(124, 58, 237, 0.3);
  }

  .theme-light .btn-opt-monitor {
    background: #f5f3ff;
    color: #5b21b6;
    border: 1.5px solid #c4b5fd;
  }

  .theme-light .btn-opt-monitor:hover {
    background: #ede9fe;
    color: #4c1d95;
    border-color: #8b5cf6;
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.2);
  }

  .theme-light .btn-opt-monitor.is-active {
    background: linear-gradient(135deg, #7c3aed, #6d28d9);
    color: #ffffff;
    border-color: #8b5cf6;
    box-shadow: 0 4px 12px rgba(124, 58, 237, 0.35);
  }
</style>
