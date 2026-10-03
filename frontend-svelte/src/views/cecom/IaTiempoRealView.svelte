<script>
  import { onMount, onDestroy } from "svelte";
  import { triggerToast } from "../../controllers/ui.store.js";
  import { masterSalasStore, masterMesasStore, masterJuegosStore } from "../../controllers/master.store.js";
  import { getCecomIaEventos, getMesasConCamaras, getMesaCamaras, clearCecomIaEventos } from "../../services/cecomVideo.service.js";
  import { getSafeUrl } from "../../config/api.config.js";
  import {
    mesasLiveStatusStore,
    cecomIaLiveEventsStore,
    initCecomIaBackgroundWorker
  } from "../../services/cecomIaBackground.service.js";

  // Filtros
  let selectedSalaUuid = "all";
  let selectedJuego = "all";
  let selectedMesaUuid = "all";
  let fechaDesde = "";
  let fechaHasta = "";
  let searchQuery = "";

  let isLoading = false;
  let eventsList = [];
  let refreshTimer = null;

  // Paginación
  let currentPage = 1;
  let pageSize = 15;

  // Modal Detalle
  let selectedEventDetail = null;

  let mesasConCamaras = [];
  let isLoadingMesas = false;

  function getLocalDateStr(offsetDays = 0) {
    const d = new Date();
    if (offsetDays !== 0) d.setDate(d.getDate() + offsetDays);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function getEvidenceUrl(item) {
    if (!item) return '';
    const foto = item.foto_url || item.foto || item.metadata?.foto_url || item.metadata?.foto;
    if (foto) {
      if (foto.startsWith('http://') || foto.startsWith('https://')) return getSafeUrl(foto);
      if (foto.startsWith('/api/')) return getSafeUrl(foto);
      if (foto.startsWith('/mesas_ia/')) return getSafeUrl(foto);
      return getSafeUrl(`/api/mesas_ia/${foto}`);
    }
    const b64 = item.metadata?.imagen_captura || item.metadata?.foto_base64 || item.imagen_base64;
    if (b64 && b64.length > 100 && !b64.endsWith('...')) {
      return b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`;
    }
    return '';
  }

  $: salas = $masterSalasStore || [];
  $: liveMesasMap = $mesasLiveStatusStore || {};

  // Modal de Visor de Visión Artificial en Vivo
  let viewingAiMesa = null;
  let isSavingFeedback = false;

  let selectedTipoRegistro = "all"; // 'all' | 'JUGADA' | 'ERROR_MESA'
  let editingMesaJuego = null;
  let selectedNewJuegoUuid = "";
  let isSavingJuego = false;

  function matchJuegos(j1, j2) {
    if (!j1 || !j2) return false;
    const clean = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/;/g, "n").trim();
    const s1 = clean(j1);
    const s2 = clean(j2);
    if (s1 === s2) return true;

    // Texas Bonus (distinto de Poker Caribeño)
    const isTx1 = s1.includes("texas") || s1.includes("holdem") || s1.includes("txb") || (s1.includes("bonus") && !s1.includes("baccarat"));
    const isTx2 = s2.includes("texas") || s2.includes("holdem") || s2.includes("txb") || (s2.includes("bonus") && !s2.includes("baccarat"));
    if (isTx1 && isTx2) return true;
    if (isTx1 !== isTx2 && (isTx1 || isTx2)) return false;

    // Ruleta Americana
    const isRuleta1 = s1.includes("ruleta") || s1.includes("roulette") || s1 === "ra" || s1.startsWith("ra ") || s1.startsWith("ra1") || s1.includes("americana");
    const isRuleta2 = s2.includes("ruleta") || s2.includes("roulette") || s2 === "ra" || s2.startsWith("ra ") || s2.startsWith("ra1") || s2.includes("americana");
    if (isRuleta1 && isRuleta2) return true;
    if (isRuleta1 !== isRuleta2 && (isRuleta1 || isRuleta2)) return false;

    // Poker Caribeño (solo si no es Texas)
    const isPoker1 = s1.includes("poker") || s1.includes("caribe") || s1.includes("stud") || s1.startsWith("pk");
    const isPoker2 = s2.includes("poker") || s2.includes("caribe") || s2.includes("stud") || s2.startsWith("pk");
    if (isPoker1 && isPoker2) return true;

    // Blackjack
    const isBj1 = s1.includes("blackjack") || s1.includes("21") || s1.startsWith("bj");
    const isBj2 = s2.includes("blackjack") || s2.includes("21") || s2.startsWith("bj");
    if (isBj1 && isBj2) return true;

    // Baccarat
    const isBac1 = s1.includes("baccarat") || s1.includes("punto") || s1.startsWith("pb") || s1.includes("banca");
    const isBac2 = s2.includes("baccarat") || s2.includes("punto") || s2.startsWith("pb") || s2.includes("banca");
    if (isBac1 && isBac2) return true;

    return false;
  }

  function openChangeGameModal(badge) {
    editingMesaJuego = badge;
    const currentM = ($masterMesasStore || []).find(m => String(m.uuid || m.id) === String(badge.uuid));
    selectedNewJuegoUuid = currentM?.juego_uuid || "";
    if ((!selectedNewJuegoUuid || badge.tiene_discrepancia) && badge.juego_detectado_ia) {
      const matchJ = ($masterJuegosStore || []).find(j => matchJuegos(j.nombre, badge.juego_detectado_ia));
      if (matchJ) selectedNewJuegoUuid = matchJ.uuid || matchJ.id;
    }
  }

  function closeChangeGameModal() {
    editingMesaJuego = null;
    selectedNewJuegoUuid = "";
  }

  async function autoFixMesaJuego(badge) {
    if (!badge || isSavingJuego) return;
    const detectedName = badge.juego_detectado_ia || 'Baccarat';

    let targetJuego = ($masterJuegosStore || []).find(j => matchJuegos(j.nombre, detectedName));

    if (!targetJuego) {
      try {
        const res = await fetch('https://wisi.space/api/master/juegos');
        const d = await res.json();
        if (d && Array.isArray(d.data)) {
          masterJuegosStore.set(d.data);
          targetJuego = d.data.find(j => matchJuegos(j.nombre, detectedName));
        }
      } catch (e) {}
    }

    if (!targetJuego) {
      triggerToast(`No se encontró el juego "${detectedName}" en el catálogo. Puedes seleccionarlo manualmente.`, 'warning');
      openChangeGameModal(badge);
      return;
    }

    selectedNewJuegoUuid = targetJuego.uuid || targetJuego.id;
    editingMesaJuego = badge;
    await handleSaveMesaJuego();
  }

  async function handleSaveMesaJuego() {
    if (!editingMesaJuego || !selectedNewJuegoUuid) return;
    isSavingJuego = true;
    try {
      const targetJuego = ($masterJuegosStore || []).find(j => String(j.uuid || j.id) === String(selectedNewJuegoUuid));
      const juegoNombre = targetJuego?.nombre || "Baccarat";

      // 1. Actualizar en backend Fastify / PostgreSQL
      const endpoints = [
        `https://wisi.space/api/master/mesas/${editingMesaJuego.uuid}`,
        `http://127.0.0.1:3030/api/master/mesas/${editingMesaJuego.uuid}`
      ];
      for (const ep of endpoints) {
        try {
          await fetch(ep, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ juego_uuid: selectedNewJuegoUuid })
          });
        } catch (e) {}
      }

      // 2. Notificar motor IA Python
      try {
        await fetch(`http://127.0.0.1:5005/mesas/${editingMesaJuego.uuid}/configurar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ juego: juegoNombre })
        });
      } catch (e) {}

      // 3. Actualizar stores reactivos locales
      masterMesasStore.update(list => list.map(m => {
        if (String(m.uuid || m.id) === String(editingMesaJuego.uuid)) {
          return { ...m, juego_uuid: selectedNewJuegoUuid, juego_nombre: juegoNombre };
        }
        return m;
      }));

      mesasConCamaras = mesasConCamaras.map(m => {
        if (String(m.mesa_uuid || m.uuid || m.id) === String(editingMesaJuego.uuid)) {
          return { ...m, juego_uuid: selectedNewJuegoUuid, juego_nombre: juegoNombre };
        }
        return m;
      });

      triggerToast(`✅ Mesa ${editingMesaJuego.nombre} verificada y configurada como: ${juegoNombre}`, 'success');
      closeChangeGameModal();
    } catch (err) {
      triggerToast(`Error al guardar juego: ${err.message}`, 'error');
    } finally {
      isSavingJuego = false;
    }
  }

  let streamFailed = false;

  function openAiVisionModal(badge) {
    streamFailed = false;
    viewingAiMesa = badge;
  }

  function closeAiVisionModal() {
    viewingAiMesa = null;
    streamFailed = false;
  }

  // Lista de mesas para Badges: ÚNICAMENTE mesas asociadas a cámaras
  $: liveMesasBadges = (() => {
    return mesasConCamaras.map(m => {
      const mId = m.mesa_uuid || m.uuid || m.id;
      const live = liveMesasMap[mId] || null;

      // 1. Nombre tal y como está en la base de datos (lo que el usuario configuró)
      const userConfigJuego = (m.juego_nombre && m.juego_nombre.trim()) ? m.juego_nombre.trim() : 'General';

      // 2. Lo que la IA detecta en el paño según cámaras / prefijo de mesa / modelo de visión
      const mesaTxt = `${m.mesa_nombre || m.nombre || ''}`.toUpperCase().trim();
      const cfgTxt = `${userConfigJuego}`.toUpperCase().trim();
      let juegoDetectadoIa = 'Baccarat';
      let juegoTipo = live?.juego_tipo;

      // 1. Ruleta Americana (RA 1, RA 2, RULETA, ROULETTE)
      if (mesaTxt.startsWith('RA') || mesaTxt.startsWith('RT') || mesaTxt.includes('RULETA') || mesaTxt.includes('ROULETTE') || cfgTxt.includes('RULETA') || cfgTxt.includes('ROULETTE')) {
        juegoDetectadoIa = 'Ruleta Americana';
        if (!juegoTipo) juegoTipo = 'RULETA';
      }
      // 2. Texas Hold'em Bonus (TXB 1, TX 1, TEXAS, HOLDEM, BONUS)
      else if (mesaTxt.startsWith('TX') || mesaTxt.startsWith('TB') || mesaTxt.includes('TEXAS') || mesaTxt.includes('HOLDEM') || cfgTxt.includes('TEXAS') || cfgTxt.includes('HOLDEM') || (cfgTxt.includes('BONUS') && !cfgTxt.includes('BACCARAT'))) {
        juegoDetectadoIa = 'Texas Bonus';
        if (!juegoTipo) juegoTipo = 'TEXAS_BONUS';
      }
      // 3. Poker Caribeño (PK 3, POKER, CARIBE, STUD) - NO confundir con Texas
      else if (mesaTxt.startsWith('PK') || mesaTxt.includes('CARIBE') || mesaTxt.includes('STUD') || cfgTxt.includes('CARIBE') || (cfgTxt.includes('POKER') && !cfgTxt.includes('TEXAS'))) {
        juegoDetectadoIa = 'Poker Caribeño';
        if (!juegoTipo) juegoTipo = 'POKER_CARIBENO';
      }
      // 4. Blackjack (BJ 1, BLACKJACK, 21)
      else if (mesaTxt.startsWith('BJ') || mesaTxt.includes('BLACKJACK') || cfgTxt.includes('BLACKJACK')) {
        juegoDetectadoIa = 'Blackjack';
        if (!juegoTipo) juegoTipo = 'BLACKJACK';
      }
      // 5. Baccarat (PB 1, PB 2, BACCARAT, PUNTO, BANCA)
      else if (mesaTxt.startsWith('PB') || mesaTxt.includes('BACCARAT') || mesaTxt.includes('PUNTO') || cfgTxt.includes('BACCARAT')) {
        juegoDetectadoIa = 'Baccarat';
        if (!juegoTipo) juegoTipo = 'BACCARAT';
      } else {
        juegoDetectadoIa = 'Baccarat';
        if (!juegoTipo) juegoTipo = 'BACCARAT';
      }

      if (live?.juego_tipo === 'RULETA') {
        juegoDetectadoIa = 'Ruleta Americana';
        juegoTipo = 'RULETA';
      } else if (live?.juego_tipo === 'TEXAS_BONUS') {
        juegoDetectadoIa = 'Texas Bonus';
        juegoTipo = 'TEXAS_BONUS';
      } else if (live?.juego_tipo === 'POKER_CARIBENO') {
        juegoDetectadoIa = 'Poker Caribeño';
        juegoTipo = 'POKER_CARIBENO';
      } else if (live?.juego_tipo === 'BLACKJACK') {
        juegoDetectadoIa = 'Blackjack';
        juegoTipo = 'BLACKJACK';
      } else if (live?.juego_tipo === 'BACCARAT') {
        juegoDetectadoIa = 'Baccarat';
        juegoTipo = 'BACCARAT';
      }

      // 3. Doble Verificación:
      const isGeneral = userConfigJuego.toUpperCase() === 'GENERAL';
      const isMatch = matchJuegos(userConfigJuego, juegoDetectadoIa);
      const tieneDiscrepancia = isGeneral || !isMatch;
      const verificadoIa = !isGeneral && isMatch;
      const motivoDiscrepancia = isGeneral ? 'CONFIG_GENERAL' : 'MISMATCH';

      const hasCards = Boolean(
        (live?.punto && live.punto.length > 0) ||
        (live?.banca && live.banca.length > 0) ||
        (live?.dealer_cards && live.dealer_cards.length > 0)
      );
      const isMoving = hasCards;

      let ultimoEvento = 'SIN JUGADA (EN ESPERA)';
      let descripcion = 'Mesa despejada - En espera';

      if (juegoTipo === 'RULETA') {
        ultimoEvento = 'CILINDRO / PAÑO ACTIVO';
        descripcion = 'Mesa de Ruleta Americana activa (0, 00, 1-36)';
      } else if (hasCards) {
        if (live?.ganador && live.ganador !== 'ESPERANDO' && live.ganador !== 'SIN JUGADA') {
          ultimoEvento = (juegoTipo === 'POKER_CARIBENO' || juegoTipo === 'TEXAS_BONUS') ? live.ganador : `${live.ganador} GANA`;
        } else if (live?.estado_mesa === 'REPARTIENDO') {
          ultimoEvento = 'REPARTIENDO CARTAS...';
        } else {
          ultimoEvento = 'RONDA EN PROCESO';
        }
        descripcion = live?.descripcion || 'Jugada activa en paño';
      }

      return {
        uuid: mId,
        nombre: m.mesa_nombre || m.nombre,
        juego: userConfigJuego,
        juego_detectado_ia: juegoDetectadoIa,
        tiene_discrepancia: tieneDiscrepancia,
        verificado_ia: verificadoIa,
        motivo_discrepancia: motivoDiscrepancia,
        total_camaras: m.total_camaras || 1,
        canal: m.numero_canal,
        camara_nombre: m.camara_nombre,
        ultimo_evento: ultimoEvento,
        descripcion: descripcion,
        hora: live?.hora || "",
        es_novedad: live?.es_novedad || false,
        nivel_alerta: live?.nivel_alerta || "INFO",
        is_moving: isMoving,
        has_cards: hasCards,
        // DATOS EN VIVO IA (YOLO + REGLAS DE CASINO)
        ai_active: true,
        juego_tipo: juegoTipo,
        scoreP: live?.scoreP ?? 0,
        scoreB: live?.scoreB ?? 0,
        ganador: live?.ganador || 'SIN JUGADA',
        punto: live?.punto || [],
        banca: live?.banca || [],
        dealer_cards: live?.dealer_cards || (juegoTipo === 'POKER_CARIBENO' ? (live?.punto?.concat(live?.banca || []) || []) : []),
        dealer_jugada: live?.dealer_jugada || '',
        califica: live?.califica,
        detalle: live?.detalle || '',
        estado_mesa: live?.estado_mesa || 'SIN JUGADA',
        resultado: live?.resultado || {},
        image_b64: live?.image_b64 || ''
      };
    });
  })();

  $: if (viewingAiMesa) {
    const updated = liveMesasBadges.find(b => b.uuid === viewingAiMesa.uuid);
    if (updated) viewingAiMesa = updated;
  }

  async function handleOperatorFeedback(mesaUuid) {
    if (!mesaUuid) return;
    isSavingFeedback = true;
    try {
      const res = await fetch('http://127.0.0.1:5005/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mesa_uuid: mesaUuid,
          nota: 'Guardado manual por auditor para reentrenamiento activo',
          operador: 'Auditor CECOM'
        })
      });
      if (res.ok) {
        triggerToast('Muestra guardada para aprendizaje activo en dataset IA', 'success');
      } else {
        triggerToast('No se pudo guardar la muestra en el motor IA', 'error');
      }
    } catch (e) {
      triggerToast(`Error conectando con Motor IA: ${e.message}`, 'error');
    } finally {
      isSavingFeedback = false;
    }
  }

  onMount(async () => {
    // Iniciar worker de fondo si aún no corre
    initCecomIaBackgroundWorker();

    // Fecha por defecto: hoy en hora local (evita bug de UTC +1 día)
    const today = getLocalDateStr();
    fechaDesde = today;
    fechaHasta = today;

    // Precargar catálogo de juegos para Doble Verificación
    if (!$masterJuegosStore || $masterJuegosStore.length === 0) {
      try {
        const rj = await fetch('https://wisi.space/api/master/juegos');
        const dj = await rj.json();
        if (dj && Array.isArray(dj.data)) {
          masterJuegosStore.set(dj.data);
        }
      } catch (e) {}
    }

    await loadMesasConCamaras();
    await loadEvents();

    // Auto-actualizar vista periódicamente cada 4 segundos
    refreshTimer = setInterval(() => {
      loadEvents(false);
    }, 4000);
  });

  onDestroy(() => {
    if (refreshTimer) clearInterval(refreshTimer);
  });

  async function loadEvents(showLoading = true) {
    if (showLoading) isLoading = true;
    try {
      const params = { limit: 100 };
      if (selectedSalaUuid && selectedSalaUuid !== "all") {
        params.sala_uuid = selectedSalaUuid;
      }
      if (selectedMesaUuid && selectedMesaUuid !== "all") {
        params.mesa_uuid = selectedMesaUuid;
      }
      if (selectedJuego && selectedJuego !== "all") {
        params.juego_nombre = selectedJuego;
      }
      if (fechaDesde) params.fecha_desde = fechaDesde;
      if (fechaHasta) params.fecha_hasta = fechaHasta;
      if (searchQuery.trim()) params.search = searchQuery.trim();

      const res = await getCecomIaEventos(params);
      if (res && res.success) {
        eventsList = res.data || [];
      }
    } catch (err) {
      console.error("Error al cargar eventos en tiempo real:", err);
    } finally {
      if (showLoading) isLoading = false;
    }
  }

  async function loadMesasConCamaras() {
    isLoadingMesas = true;
    try {
      // 1. Probar ruta centralizada backend
      let loadedFromCentral = false;
      try {
        const res = await getMesasConCamaras({ sala_uuid: selectedSalaUuid });
        if (res && res.success && Array.isArray(res.data) && res.data.length > 0) {
          mesasConCamaras = res.data;
          loadedFromCentral = true;
        }
      } catch (err) {
        console.debug("Endpoint centralizado /mesas-con-camaras no disponible, ejecutando sincronización fallback:", err);
      }

      if (loadedFromCentral) {
        return;
      }

      // 2. Fallback de alta resiliencia: resolver mesas y cámaras directamente desde la base de datos
      const allMesas = $masterMesasStore || [];
      const candidateMesas = allMesas.filter(m => {
        if (!selectedSalaUuid || selectedSalaUuid === "all") return true;
        return String(m.sala_uuid || "") === String(selectedSalaUuid);
      });

      const resolved = [];
      await Promise.all(
        candidateMesas.map(async (m) => {
          try {
            const camRes = await getMesaCamaras(m.uuid || m.id);
            if (camRes && camRes.success && Array.isArray(camRes.data) && camRes.data.length > 0) {
              resolved.push({
                mesa_uuid: m.uuid || m.id,
                uuid: m.uuid || m.id,
                id: m.uuid || m.id,
                nombre: m.nombre,
                mesa_nombre: m.nombre,
                sala_uuid: m.sala_uuid,
                juego_nombre: m.juego_nombre || m.juego || "Mesa de Juego",
                total_camaras: camRes.data.length,
                camaras: camRes.data
              });
            }
          } catch (e) {
            // Ignorar errores en mesas individuales
          }
        })
      );

      resolved.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
      mesasConCamaras = resolved;
    } catch (err) {
      console.error("Error cargando mesas asociadas:", err);
      mesasConCamaras = [];
    } finally {
      isLoadingMesas = false;
    }
  }

  async function onSalaChange() {
    selectedMesaUuid = "all";
    currentPage = 1;
    await loadMesasConCamaras();
    await loadEvents();
  }

  function filterByBadgeMesa(mesaUuid) {
    if (selectedMesaUuid === mesaUuid) {
      selectedMesaUuid = "all";
      triggerToast("Filtro de mesa desactivado", "info");
    } else {
      selectedMesaUuid = mesaUuid;
      const m = mesasConCamaras.find(x => String(x.mesa_uuid || x.uuid || x.id) === String(mesaUuid));
      triggerToast(`Filtrando por mesa: ${m?.mesa_nombre || m?.nombre || 'Mesa'}`, "info");
    }
    currentPage = 1;
    loadEvents();
  }

  async function handleClearEvents() {
    if (!confirm("¿Deseas vaciar todos los registros de prueba y eventos de IA?")) return;
    try {
      await clearCecomIaEventos({ sala_uuid: selectedSalaUuid });
      eventsList = [];
      triggerToast("Registros vaciados correctamente", "success");
    } catch (err) {
      console.error("Error al vaciar eventos:", err);
      triggerToast(`Error al vaciar eventos: ${err.message}`, "error");
    }
  }

  // Filtrar para mostrar ÚNICAMENTE eventos de mesas asociadas a cámaras
  $: mesasConCamarasIds = new Set(mesasConCamaras.map(m => String(m.mesa_uuid || m.uuid || m.id)));

  $: jugadasValidasCount = eventsList.filter(ev => {
    const mId = String(ev.mesa_uuid || ev.mesa_id || "");
    return mesasConCamarasIds.has(mId) && ev.tipo_evento === 'JUGADA' && !ev.es_novedad;
  }).length;

  $: erroresMesaCount = eventsList.filter(ev => {
    const mId = String(ev.mesa_uuid || ev.mesa_id || "");
    return mesasConCamarasIds.has(mId) && (ev.tipo_evento === 'ERROR_MESA' || ev.es_novedad || ev.nivel_alerta === 'WARN' || ev.nivel_alerta === 'CRITICAL');
  }).length;

  $: filteredEvents = eventsList.filter(ev => {
    const mId = String(ev.mesa_uuid || ev.mesa_id || "");
    if (!mesasConCamarasIds.has(mId)) return false;

    if (selectedTipoRegistro === 'JUGADA') {
      return ev.tipo_evento === 'JUGADA' && !ev.es_novedad;
    }
    if (selectedTipoRegistro === 'ERROR_MESA') {
      return ev.tipo_evento === 'ERROR_MESA' || ev.es_novedad || ev.nivel_alerta === 'WARN' || ev.nivel_alerta === 'CRITICAL';
    }
    return true;
  });
  $: totalPages = Math.ceil(filteredEvents.length / pageSize) || 1;
  $: paginatedEvents = filteredEvents.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function openDetailModal(ev) {
    selectedEventDetail = ev;
  }

  function closeDetailModal() {
    selectedEventDetail = null;
  }
</script>

<div class="ia-tr-container">
  <!-- SECCIÓN 1: Badges en Tiempo Real de las Mesas -->
  <div class="badges-section">
    <div class="badges-header">
      <h2 class="section-title">
        🟢 Mesas Asociadas a Cámaras ({liveMesasBadges.length})
      </h2>
      <span class="badges-hint">Solo se auditan mesas que tengan cámaras vinculadas en CECOM</span>
    </div>

    {#if isLoadingMesas}
      <div class="empty-badges">
        ⏳ Cargando mesas asociadas...
      </div>
    {:else if liveMesasBadges.length === 0}
      <div class="empty-badges">
        ℹ️ No hay mesas asociadas a cámaras en esta sala. Para auditar jugadas en vivo, primero vincula las cámaras a las mesas en <strong>Administración &gt; Mesas y Cámaras</strong>.
      </div>
    {:else}
      <div class="badges-grid">
        {#each liveMesasBadges as badge (badge.uuid)}
          <div
            class="mesa-badge-card"
            class:is-active-playing={badge.has_cards && badge.is_moving}
            class:has-alert={badge.nivel_alerta === 'WARN' || badge.nivel_alerta === 'CRITICAL'}
          >
            <!-- CABECERA: TÍTULO, VERIFICACIÓN Y JUEGO ASIGNADO -->
            <div class="badge-top">
              <div class="mesa-title-wrap">
                <div class="mesa-title-row">
                  <span class="mesa-title">{badge.nombre}</span>
                  {#if badge.verificado_ia}
                    <span class="dv-status-pill ok" title="Configuración de juego coincide al 100% con la visión de la IA">
                      ✅ Verificado
                    </span>
                  {:else if badge.tiene_discrepancia}
                    <span class="dv-status-pill warn" title="Discrepancia entre la configuración de mesa y lo detectado por IA">
                      ⚠️ Doble Verificación
                    </span>
                  {/if}
                </div>
                <div class="mesa-game-row">
                  <button
                    type="button"
                    class="badge-game-btn"
                    class:is-general={badge.juego.toUpperCase() === 'GENERAL'}
                    class:pk={badge.juego_tipo === 'POKER_CARIBENO'}
                    class:bj={badge.juego_tipo === 'BLACKJACK'}
                    class:pb={badge.juego_tipo === 'BACCARAT'}
                    on:click|stopPropagation={() => openChangeGameModal(badge)}
                    title="Clic para cambiar manualmente el juego asignado a esta mesa"
                  >
                    Juego: <strong>{badge.juego}</strong> ✏️
                  </button>
                </div>
              </div>
              <span
                class="status-indicator-dot"
                class:pulse={badge.has_cards && badge.is_moving}
                class:idle={!badge.has_cards || !badge.is_moving}
                title={badge.has_cards ? "Jugada activa en paño" : "Sin jugada (en espera)"}
              ></span>
            </div>

            <!-- BANNER DE DOBLE VERIFICACIÓN (CROSS-CHECK) -->
            {#if badge.tiene_discrepancia}
              <div class="dv-alert-banner">
                <div class="dv-alert-header">
                  <span class="dv-warn-icon">⚠️</span>
                  <span class="dv-warn-title">Doble Verificación</span>
                </div>
                <div class="dv-alert-msg">
                  {#if badge.motivo_discrepancia === 'CONFIG_GENERAL'}
                    Mesa en <strong>"General"</strong> • La IA detecta <strong>{badge.juego_detectado_ia}</strong>
                  {:else}
                    Configurada como <strong>"{badge.juego}"</strong> • IA detecta <strong>{badge.juego_detectado_ia}</strong>
                  {/if}
                </div>
                <div class="dv-alert-actions">
                  <button
                    type="button"
                    class="btn-dv-fix"
                    disabled={isSavingJuego}
                    on:click|stopPropagation={() => autoFixMesaJuego(badge)}
                    title="Actualizar base de datos y modelo IA a {badge.juego_detectado_ia}"
                  >
                    ⚡ Corregir a {badge.juego_detectado_ia}
                  </button>
                </div>
              </div>
            {:else if badge.verificado_ia}
              <div class="dv-verified-banner">
                <span class="dv-ok-icon">✅</span>
                <span class="dv-ok-msg">Mesa verificada por IA: <strong>{badge.juego}</strong></span>
              </div>
            {/if}

            <!-- CAMARITA EN VIVO DIRECTA ("LA CAMARITA CHIQUITICA" CON IA YOLO) -->
            <div class="card-cctv-container">
              {#if badge.image_b64}
                <img
                  src="data:image/jpeg;base64,{badge.image_b64}"
                  alt="Feed CCTV {badge.nombre}"
                  class="card-cctv-img"
                  loading="eager"
                />
                <span class="cctv-live-tag">
                  {#if badge.has_cards && !badge.is_presentando_cartas && !badge.is_barajo_cartas}
                    <span class="live-dot-red"></span> 🔴 JUGADA EN CURSO
                  {:else if badge.is_presentando_cartas || badge.estado_mesa === 'PRESENTANDO_CARTAS'}
                    <span class="live-dot-blue"></span> 🔵 PRESENTANDO CARTAS
                  {:else if badge.is_barajo_cartas || badge.estado_mesa === 'BARAJO_CARTAS'}
                    <span class="live-dot-purple"></span> 🟣 BARAJO DE CARTAS
                  {:else if badge.is_presentando_banca || badge.estado_mesa === 'PRESENTANDO_BANCA' || badge.ultimo_evento?.includes('BANCA')}
                    <span class="live-dot-amber"></span> 🟡 PRESENTANDO BANCA
                  {:else}
                    <span class="live-dot-green"></span> 🟢 MESA DESPEJADA
                  {/if}
                </span>
              {:else}
                <div class="card-cctv-placeholder">
                  <span class="cctv-placeholder-spin">📹</span>
                  <span>Conectando feed de mesa...</span>
                </div>
              {/if}
            </div>

            <!-- SECTOR DEL JUEGO / DE LA MANO (REGLAS CASINO) -->
            {#if badge.juego_tipo === 'RULETA'}
              <!-- TABLERO RULETA AMERICANA -->
              <div class="ia-ruleta-card">
                <div class="ruleta-card-top">
                  <span class="ruleta-title-lbl">🎡 RULETA AMERICANA</span>
                  <span class="ruleta-status-badge">🟢 MESA ACTIVA</span>
                </div>
                <div class="ruleta-body-info">
                  <span class="ruleta-wheel-icon">🎰</span>
                  <div class="ruleta-text-wrap">
                    <span class="ruleta-main-txt">Doble Cero (0, 00) • 36 Números</span>
                    <span class="ruleta-sub-txt">Monitoreo activo de cilindro y apuestas en paño</span>
                  </div>
                </div>
              </div>
            {:else if badge.has_cards}
              {#if badge.juego_tipo === 'TEXAS_BONUS'}
                <!-- TABLERO TEXAS BONUS (COMUNITARIAS FLOP/TURN/RIVER + REGLA CROUPIER ≥ 1 PAR) -->
                <div class="ia-live-pokerboard texas">
                  <div class="poker-dealer-card texas" class:califica-ok={badge.califica === true} class:no-califica-ok={badge.califica === false}>
                    <div class="poker-card-top">
                      <span class="poker-title-lbl">TEXAS BONUS • CARTAS EN PAÑO</span>
                      <span class="poker-qual-badge" class:is-califica={badge.califica === true} class:is-no-califica={badge.califica === false}>
                        {#if badge.califica === true}
                          🟢 CROUPIER CALIFICA (≥ 1 PAR)
                        {:else if badge.califica === false}
                          ⚠️ ANTE EMPUJA (&lt; 1 PAR)
                        {:else}
                          ⏳ REPARTIENDO
                        {/if}
                      </span>
                    </div>

                    <div class="cards-strip poker-cards-strip">
                      {#if badge.dealer_cards && badge.dealer_cards.length > 0}
                        {#each badge.dealer_cards.slice(0, 7) as c}
                          <span class="card-chip poker texas" class:back-chip={c.val.includes('BACK')} title="{c.val}">
                            {c.val}
                          </span>
                        {/each}
                      {:else}
                        <span class="no-cards">Repartiendo mano de Texas Bonus...</span>
                      {/if}
                    </div>

                    <div class="poker-hand-desc">
                      {#if badge.dealer_jugada}
                        🃏 {badge.dealer_jugada}
                      {:else}
                        <span class="text-muted">{badge.detalle || 'Evaluando paño...'}</span>
                      {/if}
                    </div>
                  </div>
                </div>

                <!-- BANNER DE ESTADO TEXAS BONUS -->
                <div class="ia-winner-banner" class:poker-califica={badge.califica === true} class:poker-no-califica={badge.califica === false}>
                  {#if badge.califica === true}
                    🏆 {badge.dealer_jugada || 'Mano válida'} • Croupier Califica
                  {:else if badge.califica === false}
                    ⚠️ ANTE EMPUJA • Croupier Menor a un Par
                  {:else}
                    🃏 REPARTIENDO CARTAS...
                  {/if}
                </div>
              {:else if badge.juego_tipo === 'POKER_CARIBENO'}
                <!-- TABLERO POKER CARIBEÑO (DEALER 5 CARTAS + REGLAS CALIFICA/NO CALIFICA) -->
                <div class="ia-live-pokerboard">
                  <div class="poker-dealer-card" class:califica-ok={badge.califica === true} class:no-califica-ok={badge.califica === false}>
                    <div class="poker-card-top">
                      <span class="poker-title-lbl">CASA / DEALER (5 CARTAS)</span>
                      <span class="poker-qual-badge" class:is-califica={badge.califica === true} class:is-no-califica={badge.califica === false}>
                        {#if badge.califica === true}
                          🟢 CALIFICA
                        {:else if badge.califica === false}
                          🔴 NO CALIFICA
                        {:else}
                          ⏳ REPARTIENDO
                        {/if}
                      </span>
                    </div>

                    <div class="cards-strip poker-cards-strip">
                      {#if badge.dealer_cards && badge.dealer_cards.length > 0}
                        {#each badge.dealer_cards.slice(0, 5) as c}
                          <span class="card-chip poker" class:back-chip={c.val.includes('BACK')} title="{c.val}">
                            {c.val}
                          </span>
                        {/each}
                      {:else}
                        <span class="no-cards">Repartiendo mano de la Casa...</span>
                      {/if}
                    </div>

                    <div class="poker-hand-desc">
                      {#if badge.dealer_jugada}
                        🃏 {badge.dealer_jugada}
                      {:else}
                        <span class="text-muted">{badge.detalle || 'Evaluando 5 cartas...'}</span>
                      {/if}
                    </div>
                  </div>
                </div>

                <!-- BANNER DE ESTADO POKER -->
                <div class="ia-winner-banner" class:poker-califica={badge.califica === true} class:poker-no-califica={badge.califica === false}>
                  {#if badge.califica === true}
                    🏆 CASA CALIFICA: {badge.dealer_jugada || 'Mano válida'}
                  {:else if badge.califica === false}
                    ⚠️ CASA NO CALIFICA (Menor a As-Rey) • Ante Paga 1:1
                  {:else}
                    🃏 REPARTIENDO CARTAS...
                  {/if}
                </div>
              {:else}
                <!-- TABLERO BACCARAT (MÁXIMO 3 CARTAS POR LADO SEGÚN REGLAMENTO) -->
                <div class="ia-live-scoreboard">
                  <!-- Lado Banca (Máximo 3 cartas) -->
                  <div class="score-side banca" class:winner={badge.ganador === 'BANCA'}>
                    <div class="side-header">
                      <span class="side-lbl">BANCA ({Math.min(badge.banca?.length || 0, 3)}/3)</span>
                      <span class="side-score">{badge.scoreB}</span>
                    </div>
                    <div class="cards-strip">
                      {#if badge.banca && badge.banca.length > 0}
                        {#each badge.banca.slice(0, 3) as c}
                          <span class="card-chip banca" title="{c.val}">{c.val}</span>
                        {/each}
                      {:else}
                        <span class="no-cards">-</span>
                      {/if}
                    </div>
                  </div>

                  <!-- Separador VS -->
                  <div class="score-vs">
                    <span class="vs-text">VS</span>
                    {#if badge.resultado?.natural}
                      <span class="natural-tag">NATURAL</span>
                    {/if}
                  </div>

                  <!-- Lado Punto (Máximo 3 cartas) -->
                  <div class="score-side punto" class:winner={badge.ganador === 'PUNTO'}>
                    <div class="side-header">
                      <span class="side-lbl">PUNTO ({Math.min(badge.punto?.length || 0, 3)}/3)</span>
                      <span class="side-score">{badge.scoreP}</span>
                    </div>
                    <div class="cards-strip">
                      {#if badge.punto && badge.punto.length > 0}
                        {#each badge.punto.slice(0, 3) as c}
                          <span class="card-chip punto" title="{c.val}">{c.val}</span>
                        {/each}
                      {:else}
                        <span class="no-cards">-</span>
                      {/if}
                    </div>
                  </div>
                </div>

                <!-- BANNER DE GANADOR BACCARAT -->
                <div class="ia-winner-banner" class:banca-win={badge.ganador === 'BANCA'} class:punto-win={badge.ganador === 'PUNTO'} class:tie-win={badge.ganador === 'EMPATE (TIE)'}>
                  {#if badge.ganador && badge.ganador !== 'SIN JUGADA' && badge.ganador !== 'ESPERANDO'}
                    🏆 {badge.ganador} GANA
                  {:else}
                    🃏 REPARTIENDO CARTAS...
                  {/if}
                </div>

                <!-- Puestos de la Mesa (1 al 7) -->
                <div class="ia-puestos-strip">
                  {#each [1, 2, 3, 5, 6, 7] as p}
                    <span
                      class="ia-puesto-tag"
                      class:p-banca={badge.ganador === 'BANCA'}
                      class:p-punto={badge.ganador === 'PUNTO'}
                      class:p-tie={badge.ganador === 'EMPATE (TIE)'}
                      title="Puesto {p}"
                    >
                      P{p}
                    </span>
                  {/each}
                </div>
              {/if}
            {:else if badge.is_presentando_cartas || badge.estado_mesa === 'PRESENTANDO_CARTAS'}
              <!-- PRESENTANDO CARTAS -->
              <div class="presentando-cartas-box">
                <span class="presentando-cartas-badge">🔵 PRESENTANDO CARTAS</span>
                <span class="presentando-cartas-hint">
                  {badge.descripcion || badge.detalle || 'Inicio de presentación de cartas • Mazo completo boca arriba'}
                </span>
              </div>
            {:else if badge.is_barajo_cartas || badge.estado_mesa === 'BARAJO_CARTAS'}
              <!-- BARAJO DE CARTAS -->
              <div class="barajo-cartas-box">
                <span class="barajo-cartas-badge">🟣 BARAJO DE CARTAS</span>
                <span class="barajo-cartas-hint">
                  {badge.descripcion || badge.detalle || 'Mezcla y lavado de naipes boca abajo'}
                </span>
              </div>
            {:else if badge.is_presentando_banca || badge.estado_mesa === 'PRESENTANDO_BANCA' || badge.ultimo_evento?.includes('BANCA')}
              <!-- PRESENTANDO BANCA -->
              <div class="presentando-banca-box">
                <span class="presentando-banca-badge">🟡 PRESENTANDO BANCA</span>
                <span class="presentando-banca-hint">
                  {badge.descripcion || badge.detalle || 'Inicio de presentación de banca • Conteo e inventario de fichas'}
                </span>
              </div>
            {:else}
              <!-- SIN JUGADA (EN ESPERA) -->
              <div class="sin-jugada-box">
                <span class="sin-jugada-badge">⏸️ SIN JUGADA (EN ESPERA)</span>
                <span class="sin-jugada-hint">Mesa despejada • Esperando inicio de mano</span>
              </div>
            {/if}

            <!-- FOOTER LIMPIO (SIN MODAL, SIN BOTONES EXTRA) -->
            <div class="badge-card-footer clean">
              <span class="badge-cam-info">📷 {badge.camara_nombre || `Canal ${badge.canal || 1}`}</span>
              <span class="badge-time-info">🕒 {badge.hora || 'En vivo'}</span>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- SECCIÓN 2: Barra de Filtros -->
  <div class="filter-card">
    <div class="filter-row">
      <div class="filter-group">
        <label for="sala-filter">Sala:</label>
        <select id="sala-filter" bind:value={selectedSalaUuid} on:change={onSalaChange}>
          <option value="all">Todas las Salas</option>
          {#each salas as s}
            <option value={s.uuid || s.id}>{s.nombre}</option>
          {/each}
        </select>
      </div>

      <div class="filter-group">
        <label for="mesa-filter">Mesa Asociada:</label>
        <select id="mesa-filter" bind:value={selectedMesaUuid} on:change={() => { currentPage = 1; loadEvents(); }}>
          <option value="all">Todas ({mesasConCamaras.length})</option>
          {#each mesasConCamaras as m}
            <option value={m.mesa_uuid || m.uuid || m.id}>{m.mesa_nombre || m.nombre}</option>
          {/each}
        </select>
      </div>

      <div class="filter-group">
        <label for="juego-filter">Grupo / Juego:</label>
        <select id="juego-filter" bind:value={selectedJuego} on:change={() => { currentPage = 1; loadEvents(); }}>
          <option value="all">Todos los Juegos</option>
          <option value="BACCARAT">Baccarat (Punto y Banca)</option>
          <option value="BLACKJACK">Blackjack</option>
          <option value="RULETA">Ruleta Americana</option>
          <option value="POKER_CARIBENO">Poker Caribeño</option>
          <option value="TEXAS_BONUS">Texas Bonus</option>
        </select>
      </div>

      <div class="filter-group">
        <label for="tipo-filter">Tipo de Registro:</label>
        <select id="tipo-filter" bind:value={selectedTipoRegistro} on:change={() => { currentPage = 1; }}>
          <option value="all">Todos los Registros</option>
          <option value="JUGADA">✅ Solo Jugadas Válidas</option>
          <option value="ERROR_MESA">⚠️ Solo Errores de Mesa</option>
        </select>
      </div>

      <div class="filter-group">
        <label for="fecha-desde">Fecha Desde:</label>
        <input id="fecha-desde" type="date" bind:value={fechaDesde} on:change={() => { currentPage = 1; loadEvents(); }} />
      </div>

      <div class="filter-group">
        <label for="fecha-hasta">Fecha Hasta:</label>
        <input id="fecha-hasta" type="date" bind:value={fechaHasta} on:change={() => { currentPage = 1; loadEvents(); }} />
      </div>

      <div class="filter-group flex-1">
        <label for="search-input">Buscar en Registro:</label>
        <input id="search-input" type="text" placeholder="Buscar por mesa, jugada, ganador..." bind:value={searchQuery} on:input={() => { currentPage = 1; loadEvents(false); }} />
      </div>

      <div class="filter-group-btn">
        <button type="button" class="btn-refresh" on:click={() => loadEvents(true)}>
          🔄 Actualizar
        </button>
      </div>
    </div>
  </div>

  <!-- SECCIÓN 3: DataTable Histórico de Tiempo Real -->
  <div class="datatable-card">
    <div class="table-header-bar">
      <div class="th-title-wrap">
        <div class="th-title">
          📊 Registro Unificado de Mesas en Vivo ({filteredEvents.length} registros)
        </div>
        <div class="table-tabs">
          <button
            type="button"
            class="tab-btn"
            class:active={selectedTipoRegistro === 'all'}
            on:click={() => { selectedTipoRegistro = 'all'; currentPage = 1; }}
          >
            📋 Todos ({eventsList.filter(ev => mesasConCamarasIds.has(String(ev.mesa_uuid || ev.mesa_id || ''))).length})
          </button>
          <button
            type="button"
            class="tab-btn ok"
            class:active={selectedTipoRegistro === 'JUGADA'}
            on:click={() => { selectedTipoRegistro = 'JUGADA'; currentPage = 1; }}
          >
            ✅ Jugadas Válidas ({jugadasValidasCount})
          </button>
          <button
            type="button"
            class="tab-btn err"
            class:active={selectedTipoRegistro === 'ERROR_MESA'}
            on:click={() => { selectedTipoRegistro = 'ERROR_MESA'; currentPage = 1; }}
          >
            ⚠️ Errores de Mesa ({erroresMesaCount})
          </button>
        </div>
      </div>
      <div class="header-right-actions">
        {#if filteredEvents.length > 0}
          <button type="button" class="btn-clear-test" on:click={handleClearEvents} title="Vaciar registros">
            🗑️ Limpiar Registros
          </button>
        {/if}
        {#if selectedMesaUuid !== 'all'}
          <button type="button" class="btn-reset-filter" on:click={() => { selectedMesaUuid = 'all'; loadEvents(); }}>
            ✕ Quitar filtro de mesa
          </button>
        {/if}
      </div>
    </div>

    {#if isLoading && eventsList.length === 0}
      <div class="loading-box">
        <div class="spin">⏳</div>
        <span>Cargando eventos de IA en tiempo real...</span>
      </div>
    {:else if paginatedEvents.length === 0}
      <div class="empty-table">
        <span class="empty-icon">📭</span>
        <p>No se encontraron eventos para los filtros seleccionados.</p>
      </div>
    {:else}
      <div class="table-wrap">
        <table class="live-table">
          <thead>
            <tr>
              <th>Fecha y Hora</th>
              <th>Sala</th>
              <th>Mesa</th>
              <th>Juego</th>
              <th>Tipo de Registro</th>
              <th>Descripción de la Jugada / Incidencia</th>
              <th>Auditoría IA</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {#each paginatedEvents as ev (ev.uuid || ev.id)}
              <tr class:is-error-row={ev.tipo_evento === 'ERROR_MESA' || ev.es_novedad}>
                <td class="font-mono text-muted">
                  {new Date(ev.created_at).toLocaleDateString()} {new Date(ev.created_at).toLocaleTimeString()}
                </td>
                <td>{ev.sala_nombre || "Sala"}</td>
                <td><strong class="mesa-name">{ev.mesa_nombre || "Mesa"}</strong></td>
                <td>
                  <span class="game-tag" class:tag-poker={ev.juego_nombre?.includes('Poker')} class:tag-bj={ev.juego_nombre?.includes('Blackjack')}>
                    {ev.juego_nombre || "Mesa"}
                  </span>
                </td>
                <td>
                  {#if ev.tipo_evento === 'ERROR_MESA' || ev.es_novedad || ev.nivel_alerta === 'WARN' || ev.nivel_alerta === 'CRITICAL'}
                    <span class="event-type-badge error font-mono">⚠️ Error de Mesa</span>
                  {:else}
                    <span class="event-type-badge ok font-mono">✅ Jugada Válida</span>
                  {/if}
                </td>
                <td class="event-desc">{ev.descripcion}</td>
                <td>
                  <span class="status-pill" class:pill-warn={ev.es_novedad || ev.tipo_evento === 'ERROR_MESA'} class:info={!ev.es_novedad && ev.tipo_evento !== 'ERROR_MESA'}>
                    {ev.es_novedad ? '⚠️ Revisar' : '✅ Correcto'}
                  </span>
                </td>
                <td>
                  <button type="button" class="btn-view" on:click={() => openDetailModal(ev)}>
                    👁️ Ver
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- Paginador -->
      <div class="pagination-bar">
        <span class="page-info">
          Página {currentPage} de {totalPages} (Mostrando {paginatedEvents.length} de {filteredEvents.length})
        </span>
        <div class="pagination-buttons">
          <button type="button" class="btn-page" disabled={currentPage <= 1} on:click={() => currentPage--}>
            ◀ Anterior
          </button>
          <button type="button" class="btn-page" disabled={currentPage >= totalPages} on:click={() => currentPage++}>
            Siguiente ▶
          </button>
        </div>
      </div>
    {/if}
  </div>

  <!-- MODAL: Configurar Juego de Mesa Oficial -->
  {#if editingMesaJuego}
    <div class="modal-backdrop" on:click={closeChangeGameModal}>
      <div class="modal-card modal-change-game" on:click|stopPropagation>
        <div class="modal-header">
          <div class="modal-title-wrap">
            <span class="game-icon-tag">🎲</span>
            <h3 class="modal-title">Configurar Juego para {editingMesaJuego.nombre}</h3>
          </div>
          <button type="button" class="btn-close" on:click={closeChangeGameModal}>✕</button>
        </div>
        <div class="modal-body">
          <!-- Banner de Doble Verificación en el Modal -->
          <div class="dv-modal-hint-box" class:alert-box={editingMesaJuego.tiene_discrepancia} class:ok-box={editingMesaJuego.verificado_ia}>
            {#if editingMesaJuego.tiene_discrepancia}
              <div class="dv-modal-header">
                <span class="dv-modal-icon">⚠️</span>
                <strong>Doble Verificación CECOM / IA:</strong>
              </div>
              <p class="dv-modal-text">
                Actualmente la mesa está configurada como <em>"{editingMesaJuego.juego}"</em>, pero la IA detecta que el paño corresponde a <strong>{editingMesaJuego.juego_detectado_ia}</strong>.
              </p>
              <button
                type="button"
                class="btn-dv-preselect"
                on:click={() => {
                  const target = ($masterJuegosStore || []).find(j => matchJuegos(j.nombre, editingMesaJuego.juego_detectado_ia));
                  if (target) selectedNewJuegoUuid = target.uuid || target.id;
                }}
              >
                ⚡ Pre-seleccionar detección IA: {editingMesaJuego.juego_detectado_ia}
              </button>
            {:else}
              <div class="dv-modal-header">
                <span class="dv-modal-icon">✅</span>
                <strong>Doble Verificación Conforme:</strong>
              </div>
              <p class="dv-modal-text">
                El juego configurado (<em>{editingMesaJuego.juego}</em>) coincide con la detección visual de las cámaras en vivo.
              </p>
            {/if}
          </div>

          <div class="form-group mt-4">
            <label for="select-juego-mesa">Juego Oficial de Casino:</label>
            <select id="select-juego-mesa" class="game-select" bind:value={selectedNewJuegoUuid}>
              <option value="" disabled>-- Selecciona el juego --</option>
              {#each ($masterJuegosStore || []) as j}
                <option value={j.uuid || j.id}>
                  {j.nombre} {matchJuegos(j.nombre, editingMesaJuego.juego_detectado_ia) ? '⭐ (Detectado por IA)' : ''}
                </option>
              {/each}
            </select>
          </div>

          <div class="modal-actions-bar mt-6">
            <button type="button" class="btn-secondary" on:click={closeChangeGameModal} disabled={isSavingJuego}>
              Cancelar
            </button>
            <button type="button" class="btn-primary" on:click={handleSaveMesaJuego} disabled={isSavingJuego || !selectedNewJuegoUuid}>
              {isSavingJuego ? 'Guardando...' : '💾 Guardar y Aplicar Reglas'}
            </button>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- MODAL: Detalle del Evento -->
  {#if selectedEventDetail}
    <div class="modal-backdrop" on:click={closeDetailModal}>
      <div class="modal-card" on:click|stopPropagation>
        <div class="modal-header">
          <h3 class="modal-title">Detalle Técnico del Evento IA</h3>
          <button type="button" class="btn-close" on:click={closeDetailModal}>✕</button>
        </div>
        <div class="modal-body">
          <div class="detail-row">
            <span class="dt-lbl">Mesa:</span>
            <span class="dt-val font-bold">{selectedEventDetail.mesa_nombre} ({selectedEventDetail.juego_nombre})</span>
          </div>
          <div class="detail-row">
            <span class="dt-lbl">Sala:</span>
            <span class="dt-val">{selectedEventDetail.sala_nombre}</span>
          </div>
          <div class="detail-row">
            <span class="dt-lbl">Fecha y Hora:</span>
            <span class="dt-val font-mono">{new Date(selectedEventDetail.created_at).toLocaleString()}</span>
          </div>
          <div class="detail-row">
            <span class="dt-lbl">Tipo de Evento:</span>
            <span class="dt-val font-mono">{selectedEventDetail.tipo_evento}</span>
          </div>
          <div class="detail-row">
            <span class="dt-lbl">Descripción:</span>
            <span class="dt-val">{selectedEventDetail.descripcion}</span>
          </div>

          <!-- CAPTURA / EVIDENCIA VISUAL EN EL MOMENTO DEL REGISTRO -->
          {#if getEvidenceUrl(selectedEventDetail)}
            <div class="evidence-snapshot-card">
              <div class="evidence-header">
                <span class="evidence-badge">📸 CAPTURA VISUAL DE LA JUGADA (IA EN VIVO)</span>
                <span class="evidence-sub">Momento exacto con detección y auditoría</span>
              </div>
              <div class="evidence-img-wrap">
                <img
                  src={getEvidenceUrl(selectedEventDetail)}
                  alt="Captura IA {selectedEventDetail.mesa_nombre}"
                  class="evidence-img"
                  loading="lazy"
                />
              </div>
            </div>
          {/if}

          <div class="metadata-box">
            <span class="meta-title">Metadatos de Detección (Cartas / Puntuación / Casilla):</span>
            <pre class="meta-json font-mono">{JSON.stringify(selectedEventDetail.metadata || {}, null, 2)}</pre>
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- MODAL: Visor de Visión Artificial en Vivo (YOLO + Baccarat Rules) -->
  {#if viewingAiMesa}
    <div class="modal-backdrop" on:click={closeAiVisionModal}>
      <div class="modal-card yolo-vision-modal" on:click|stopPropagation>
        <div class="modal-header">
          <div class="modal-title-wrap">
            <span class="badge-pulse-online">● LIVE IA</span>
            <h3 class="modal-title">Visor IA en Vivo: {viewingAiMesa.nombre} ({viewingAiMesa.juego})</h3>
          </div>
          <button type="button" class="btn-close" on:click={closeAiVisionModal}>✕</button>
        </div>

        <div class="modal-body yolo-modal-body">
          <!-- STREAM EN VIVO ANOTADO POR YOLO (VIDEO CONTINUO EN TIEMPO REAL POR RTSP 554) -->
          <div class="yolo-stream-container">
            {#if !streamFailed}
              <img
                src="http://127.0.0.1:5005/stream/{viewingAiMesa.uuid}"
                alt="Flujo de Video IA en Tiempo Real {viewingAiMesa.nombre}"
                class="yolo-live-img"
                on:error={() => { streamFailed = true; }}
              />
            {:else if viewingAiMesa.image_b64}
              <img
                src="data:image/jpeg;base64,{viewingAiMesa.image_b64}"
                alt="Flujo de Video IA {viewingAiMesa.nombre}"
                class="yolo-live-img"
              />
            {:else}
              <div class="no-stream-box">
                <span>Conectando con flujo RTSP en red local...</span>
              </div>
            {/if}
            <div class="stream-overlay-badge">
              <span>● EN VIVO (RTSP Puerto 554) • YOLO best.pt • Fluido 25 FPS</span>
            </div>
          </div>

          <!-- PANEL LATERAL DE RESULTADOS Y REGLAS EN TIEMPO REAL -->
          <div class="yolo-details-side">
            {#if viewingAiMesa.juego_tipo === 'POKER_CARIBENO'}
              <!-- MARCADOR POKER CARIBEÑO (CASA / DEALER 5 CARTAS) -->
              <div class="vision-poker-box">
                <div class="v-poker-top">
                  <span class="v-poker-title">CASA / DEALER (5 CARTAS)</span>
                  <span class="v-poker-badge" class:v-califica={viewingAiMesa.califica === true} class:v-no-califica={viewingAiMesa.califica === false}>
                    {#if viewingAiMesa.califica === true}
                      🟢 CALIFICA
                    {:else if viewingAiMesa.califica === false}
                      🔴 NO CALIFICA
                    {:else}
                      ⏳ {viewingAiMesa.ganador || 'EN EVALUACIÓN'}
                    {/if}
                  </span>
                </div>

                <div class="v-cards v-poker-cards">
                  {#if viewingAiMesa.dealer_cards && viewingAiMesa.dealer_cards.length > 0}
                    {#each viewingAiMesa.dealer_cards as c}
                      <span class="chip-detail poker" class:is-back={c.val.includes('BACK')}>
                        {c.val}
                      </span>
                    {/each}
                  {:else}
                    <span class="empty-detail">Repartiendo mano de la Casa...</span>
                  {/if}
                </div>

                <div class="v-poker-jugada">
                  <span class="v-poker-jugada-lbl">Mano Reconocida:</span>
                  <span class="v-poker-jugada-val font-mono">{viewingAiMesa.dealer_jugada || viewingAiMesa.detalle || 'Evaluando 5 cartas...'}</span>
                </div>
              </div>

              <!-- Banner de Estado Poker -->
              <div class="vision-status-banner" class:banca={viewingAiMesa.califica === true} class:punto={viewingAiMesa.califica === false}>
                {#if viewingAiMesa.califica === true}
                  🏆 CASA CALIFICA: {viewingAiMesa.dealer_jugada || 'Mano válida'} • Se comparan apuestas de jugadores
                {:else if viewingAiMesa.califica === false}
                  ⚠️ CASA NO CALIFICA (Menor a As-Rey) • El Ante paga 1 a 1, la apuesta se empata (Push)
                {:else}
                  🔄 Estado: {viewingAiMesa.ganador || viewingAiMesa.estado_mesa || 'ESPERANDO'}
                {/if}
              </div>

              <!-- Desglose Técnico de Reglas de Juego Poker -->
              <div class="vision-rules-box">
                <span class="box-title">📋 Reglas de Poker Caribeño Evaluadas</span>
                <p class="rules-desc">
                  {#if viewingAiMesa.resultado?.descripcion}
                    {viewingAiMesa.resultado.descripcion}
                  {:else}
                    La Casa califica únicamente con <strong>As y Rey (A-K)</strong> o combinación superior. Si la casa no califica, los jugadores ganan el Ante 1:1 automáticamente.
                  {/if}
                </p>
                <div class="rules-meta">
                  <span>Cartas Casa: {viewingAiMesa.dealer_cards?.length || 0} de 5</span>
                  <span>Calificación: {viewingAiMesa.califica === true ? 'SÍ (VÁLIDA)' : (viewingAiMesa.califica === false ? 'NO CALIFICA' : 'EN EVALUACIÓN')}</span>
                </div>
              </div>
            {:else}
              <!-- Marcador Principal Baccarat (BANCA A LA IZQUIERDA Y PUNTO A LA DERECHA COMO EN CÁMARA) -->
              <div class="vision-score-box">
                <!-- Lado BANCA (Izquierda según vista física de la cámara) -->
                <div class="v-side banca" class:winner={viewingAiMesa.ganador === 'BANCA'}>
                  <span class="v-lbl">BANCA</span>
                  <span class="v-val">{viewingAiMesa.scoreB ?? 0}</span>
                  <div class="v-cards">
                    {#if viewingAiMesa.banca && viewingAiMesa.banca.length > 0}
                      {#each viewingAiMesa.banca as c}
                        <span class="chip-detail banca">{c.val}</span>
                      {/each}
                    {:else}
                      <span class="empty-detail">Sin cartas</span>
                    {/if}
                  </div>
                </div>

                <div class="v-divider">
                  <span>VS</span>
                  {#if viewingAiMesa.resultado?.natural}
                    <span class="v-natural">NATURAL</span>
                  {/if}
                </div>

                <!-- Lado PUNTO (Derecha según vista física de la cámara) -->
                <div class="v-side punto" class:winner={viewingAiMesa.ganador === 'PUNTO'}>
                  <span class="v-lbl">PUNTO</span>
                  <span class="v-val">{viewingAiMesa.scoreP ?? 0}</span>
                  <div class="v-cards">
                    {#if viewingAiMesa.punto && viewingAiMesa.punto.length > 0}
                      {#each viewingAiMesa.punto as c}
                        <span class="chip-detail punto">{c.val}</span>
                      {/each}
                    {:else}
                      <span class="empty-detail">Sin cartas</span>
                    {/if}
                  </div>
                </div>
              </div>

              <!-- Ganador / Estado Baccarat -->
              <div class="vision-status-banner" class:banca={viewingAiMesa.ganador === 'BANCA'} class:punto={viewingAiMesa.ganador === 'PUNTO'}>
                {#if viewingAiMesa.ganador && viewingAiMesa.ganador !== 'ESPERANDO'}
                  🏆 GANADOR: {viewingAiMesa.ganador} (Banca {viewingAiMesa.scoreB} - Punto {viewingAiMesa.scoreP})
                {:else}
                  🔄 Estado: {viewingAiMesa.estado_mesa || 'ESPERANDO'}
                {/if}
              </div>

              <!-- Auditoría de Puestos de la Mesa (1 al 7) -->
              <div class="vision-puestos-box">
                <div class="puestos-header">
                  <span class="box-title">🪑 Auditoría de Puestos en Mesa (1 - 7)</span>
                  <span class="puestos-legend">
                    {#if viewingAiMesa.ganador === 'BANCA'}
                      🔴 Apuestas a BANCA cobran 1:1 (-5% comisión) | PUNTO pierde
                    {:else if viewingAiMesa.ganador === 'PUNTO'}
                      🔵 Apuestas a PUNTO cobran 1:1 | BANCA pierde
                    {:else if viewingAiMesa.ganador === 'EMPATE (TIE)'}
                      🟢 Apuestas a TIE pagan 8:1 | Punto y Banca devueltos (Push)
                    {:else}
                      ⏳ Ronda viva | Evaluando puestos
                    {/if}
                  </span>
                </div>
                <div class="puestos-grid">
                  {#each [1, 2, 3, 5, 6, 7] as p}
                    <div
                      class="puesto-seat-card"
                      class:seat-banca={viewingAiMesa.ganador === 'BANCA'}
                      class:seat-punto={viewingAiMesa.ganador === 'PUNTO'}
                      class:seat-tie={viewingAiMesa.ganador === 'EMPATE (TIE)'}
                    >
                      <span class="seat-num">PUESTO {p}</span>
                      <div class="seat-outcome">
                        {#if viewingAiMesa.ganador === 'BANCA'}
                          <span class="seat-badge banca">GANA BANCA</span>
                          <span class="seat-sub">1:1 (-5%)</span>
                        {:else if viewingAiMesa.ganador === 'PUNTO'}
                          <span class="seat-badge punto">GANA PUNTO</span>
                          <span class="seat-sub">1:1</span>
                        {:else if viewingAiMesa.ganador === 'EMPATE (TIE)'}
                          <span class="seat-badge tie">EMPATE</span>
                          <span class="seat-sub">8:1 / Push</span>
                        {:else}
                          <span class="seat-badge wait">EN JUEGO</span>
                          <span class="seat-sub">Apuesta</span>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </div>

              <!-- Desglose Técnico de Reglas de Juego Baccarat -->
              <div class="vision-rules-box">
                <span class="box-title">📋 Reglas de Baccarat Evaluadas</span>
                <p class="rules-desc">
                  {#if viewingAiMesa.resultado?.descripcion}
                    {viewingAiMesa.resultado.descripcion}
                  {:else}
                    Auditoría en curso según reglas oficiales de Baccarat (Tercera carta, Natural 8/9).
                  {/if}
                </p>
                <div class="rules-meta">
                  <span>Cartas en mesa: {(viewingAiMesa.punto?.length || 0) + (viewingAiMesa.banca?.length || 0)}</span>
                  <span>Mano terminada: {viewingAiMesa.resultado?.listo ? 'SÍ' : 'EN PROCESO'}</span>
                </div>
              </div>
            {/if}

            <!-- Botón de Aprendizaje Activo -->
            <div class="feedback-box">
              <span class="feedback-title">🧠 Aprendizaje Continuo (Active Learning)</span>
              <p class="feedback-desc">
                Si alguna carta tiene baja visibilidad o requiere reentrenamiento, guarda este fotograma en el dataset del modelo:
              </p>
              <button
                type="button"
                class="btn-feedback"
                disabled={isSavingFeedback}
                on:click={() => handleOperatorFeedback(viewingAiMesa.uuid)}
              >
                {isSavingFeedback ? '⏳ Guardando...' : '🎓 Guardar Muestra para Reentrenamiento'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .ia-tr-container {
    padding: 24px;
    max-width: 1440px;
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
    background: #eff6ff;
    padding: 10px;
    border-radius: 12px;
    border: 1px solid #bfdbfe;
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

  .header-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .pulse-live {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #ecfdf5;
    color: #047857;
    border: 1px solid #a7f3d0;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 700;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #10b981;
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0% { transform: scale(0.95); opacity: 0.8; }
    50% { transform: scale(1.3); opacity: 1; }
    100% { transform: scale(0.95); opacity: 0.8; }
  }

  .btn-refresh {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    color: #334155;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-refresh:hover {
    background: #2563eb;
    color: #ffffff;
    border-color: #2563eb;
  }

  /* Badges Section */
  .badges-section {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    padding: 20px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.03);
  }

  .badges-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .section-title {
    margin: 0;
    font-size: 15px;
    font-weight: 800;
    color: #1e293b;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .badges-hint {
    font-size: 12px;
    color: #64748b;
  }

  .empty-badges {
    padding: 24px;
    text-align: center;
    color: #94a3b8;
    font-size: 13px;
  }

  .badges-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
    gap: 16px;
  }

  .mesa-badge-card {
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 12px;
    padding: 14px;
    text-align: left;
    transition: all 0.2s ease;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.03);
  }

  .mesa-badge-card:hover {
    border-color: #93c5fd;
    box-shadow: 0 4px 12px rgba(0,0,0,0.06);
  }

  .mesa-badge-card.selected {
    border-color: #2563eb;
    background: #eff6ff;
    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.4);
  }

  .badge-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }

  .mesa-title-wrap {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mesa-title {
    font-size: 14.5px;
    font-weight: 800;
    color: #0f172a;
  }

  .mesa-badge-card.is-active-playing {
    border-color: #10b981;
    background: #f0fdf4;
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.12);
  }

  .status-indicator-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #10b981;
    transition: all 0.3s ease;
  }

  .status-indicator-dot.pulse {
    background: #10b981;
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
    animation: pulse-green-dot 1.5s infinite;
  }

  .status-indicator-dot.idle {
    background: #94a3b8;
  }

  @keyframes pulse-green-dot {
    0% {
      transform: scale(0.95);
      box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
    }
    70% {
      transform: scale(1.15);
      box-shadow: 0 0 0 6px rgba(16, 185, 129, 0);
    }
    100% {
      transform: scale(0.95);
      box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
    }
  }

  .badge-game {
    font-size: 11px;
    color: #64748b;
    font-weight: 700;
  }

  /* Scoreboard IA */
  .ia-live-scoreboard {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 8px;
    background: #0f172a;
    border-radius: 8px;
    padding: 8px 10px;
    margin: 4px 0;
  }

  .score-side {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 6px;
    border-radius: 6px;
  }

  .score-side.punto {
    color: #93c5fd;
  }

  .score-side.banca {
    color: #fca5a5;
  }

  .score-side.winner {
    background: rgba(255, 255, 255, 0.12);
    box-shadow: 0 0 8px rgba(255, 255, 255, 0.2);
  }

  .side-header {
    display: flex;
    justify-content: space-between;
    width: 100%;
    align-items: baseline;
  }

  .side-lbl {
    font-size: 9.5px;
    font-weight: 900;
    letter-spacing: 0.5px;
    opacity: 0.85;
  }

  .side-score {
    font-size: 19px;
    font-weight: 900;
    font-family: monospace;
    line-height: 1;
  }

  .cards-strip {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    justify-content: center;
    margin-top: 5px;
    min-height: 24px;
    align-items: center;
  }

  .card-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 24px;
    padding: 0 5px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 900;
    font-family: monospace;
    background: #ffffff;
    color: #0f172a;
    box-shadow: 0 1px 3px rgba(0,0,0,0.4);
  }

  .card-chip.punto {
    border-top: 3px solid #2563eb;
  }

  .card-chip.banca {
    border-top: 3px solid #dc2626;
  }

  .no-cards {
    font-size: 11px;
    color: #475569;
  }

  .score-vs {
    display: flex;
    flex-direction: column;
    align-items: center;
    color: #94a3b8;
  }

  .vs-text {
    font-size: 10px;
    font-weight: 900;
    opacity: 0.6;
  }

  .natural-tag {
    font-size: 8px;
    font-weight: 900;
    background: #f59e0b;
    color: #78350f;
    padding: 1px 4px;
    border-radius: 3px;
    margin-top: 2px;
  }

  /* Tablero Poker Caribeño */
  .ia-live-pokerboard {
    margin: 4px 0;
  }

  .poker-dealer-card {
    background: #0f172a;
    border-radius: 8px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-top: 3px solid #eab308;
  }

  .poker-dealer-card.texas {
    border-top-color: #f97316;
  }

  .card-chip.poker.texas {
    border-top: 3px solid #f97316;
  }

  /* Tarjeta Ruleta Americana */
  .ia-ruleta-card {
    background: #0f172a;
    border-radius: 8px;
    padding: 10px 12px;
    margin: 4px 0;
    border-top: 3px solid #10b981;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ruleta-card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .ruleta-title-lbl {
    font-size: 11px;
    font-weight: 900;
    color: #6ee7b7;
    letter-spacing: 0.5px;
  }

  .ruleta-status-badge {
    font-size: 9px;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(16, 185, 129, 0.2);
    color: #34d399;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .ruleta-body-info {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(255, 255, 255, 0.04);
    padding: 6px 8px;
    border-radius: 6px;
  }

  .ruleta-wheel-icon {
    font-size: 22px;
  }

  .ruleta-text-wrap {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ruleta-main-txt {
    font-size: 11.5px;
    font-weight: 800;
    color: #ffffff;
  }

  .ruleta-sub-txt {
    font-size: 9.5px;
    color: #94a3b8;
  }

  .poker-dealer-card.califica-ok {
    border-top-color: #10b981;
    box-shadow: 0 0 10px rgba(16, 185, 129, 0.15);
  }

  .poker-dealer-card.no-califica-ok {
    border-top-color: #ef4444;
  }

  .poker-card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .poker-title-lbl {
    font-size: 10px;
    font-weight: 900;
    color: #fef08a;
    letter-spacing: 0.5px;
  }

  .poker-qual-badge {
    font-size: 9px;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.1);
    color: #94a3b8;
  }

  .poker-qual-badge.is-califica {
    background: #10b981;
    color: #ffffff;
  }

  .poker-qual-badge.is-no-califica {
    background: #ef4444;
    color: #ffffff;
  }

  .poker-cards-strip {
    justify-content: center;
  }

  .card-chip.poker {
    border-top: 3px solid #eab308;
  }

  .card-chip.back-chip {
    background: #334155;
    color: #94a3b8;
    border-top-color: #64748b;
  }

  .poker-hand-desc {
    font-size: 11px;
    font-weight: 800;
    color: #38bdf8;
    text-align: center;
    background: rgba(0, 0, 0, 0.25);
    padding: 3px 6px;
    border-radius: 4px;
  }

  .ia-winner-banner.poker-califica {
    background: #dcfce7;
    color: #166534;
    border: 1px solid #bbf7d0;
  }

  .ia-winner-banner.poker-no-califica {
    background: #fee2e2;
    color: #991b1b;
    border: 1px solid #fecaca;
  }

  /* Modal Poker Caribeño */
  .vision-poker-box {
    background: #0f172a;
    border-radius: 10px;
    padding: 14px;
    color: #ffffff;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-left: 4px solid #eab308;
  }

  .v-poker-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .v-poker-title {
    font-size: 11.5px;
    font-weight: 800;
    color: #fef08a;
  }

  .v-poker-badge {
    font-size: 10px;
    font-weight: 800;
    padding: 3px 8px;
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.1);
    color: #cbd5e1;
  }

  .v-poker-badge.v-califica {
    background: #10b981;
    color: #ffffff;
  }

  .v-poker-badge.v-no-califica {
    background: #ef4444;
    color: #ffffff;
  }

  .v-poker-cards {
    display: flex;
    gap: 6px;
    justify-content: center;
    flex-wrap: wrap;
  }

  .chip-detail.poker {
    border-left: 3px solid #eab308;
  }

  .v-poker-jugada {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(255, 255, 255, 0.06);
    padding: 6px 10px;
    border-radius: 6px;
  }

  .v-poker-jugada-lbl {
    font-size: 11px;
    color: #94a3b8;
    font-weight: 700;
  }

  .v-poker-jugada-val {
    font-size: 13px;
    font-weight: 800;
    color: #38bdf8;
  }

  /* Banner de Ganador */
  .ia-winner-banner {
    font-size: 11px;
    font-weight: 900;
    text-align: center;
    padding: 5px 8px;
    border-radius: 6px;
    background: #f1f5f9;
    color: #334155;
    margin: 2px 0;
  }

  .ia-winner-banner.punto-win {
    background: #dbeafe;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
  }

  .ia-winner-banner.banca-win {
    background: #fee2e2;
    color: #b91c1c;
    border: 1px solid #fecaca;
  }

  .ia-winner-banner.tie-win {
    background: #dcfce7;
    color: #15803d;
    border: 1px solid #bbf7d0;
  }

  /* Cámara CCTV Embebida Directa en Cada Cuadro */
  .card-cctv-container {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background: #020617;
    border-radius: 8px;
    overflow: hidden;
    margin: 4px 0 6px 0;
    border: 1px solid #1e293b;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.6);
  }

  .card-cctv-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .cctv-live-tag {
    position: absolute;
    top: 6px;
    left: 6px;
    background: rgba(15, 23, 42, 0.82);
    color: #38bdf8;
    font-size: 9.5px;
    font-weight: 800;
    font-family: monospace;
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid rgba(56, 189, 248, 0.35);
    display: flex;
    align-items: center;
    gap: 5px;
    backdrop-filter: blur(2px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
  }

  .live-dot-red {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #ef4444;
    animation: blink-dot-red 1.2s infinite ease-in-out;
  }

  .live-dot-amber {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #eab308;
    animation: blink-dot-amber 1.2s infinite ease-in-out;
  }

  .live-dot-blue {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #3b82f6;
    animation: blink-dot-blue 1.2s infinite ease-in-out;
  }

  .live-dot-purple {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #a855f7;
    animation: blink-dot-purple 1.2s infinite ease-in-out;
  }

  .live-dot-green {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #22c55e;
  }

  @keyframes blink-dot-red {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.3; transform: scale(0.85); }
  }

  @keyframes blink-dot-amber {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.3; transform: scale(0.85); }
  }

  @keyframes blink-dot-blue {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.3; transform: scale(0.85); }
  }

  @keyframes blink-dot-purple {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.3; transform: scale(0.85); }
  }

  .card-cctv-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    color: #94a3b8;
    font-size: 11.5px;
    font-weight: 600;
  }

  .cctv-placeholder-spin {
    font-size: 20px;
    opacity: 0.8;
  }

  /* Estado Sin Jugada (En Espera) */
  .sin-jugada-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 12px 10px;
    background: #f8fafc;
    border: 1px dashed #cbd5e1;
    border-radius: 8px;
    margin: 4px 0;
    text-align: center;
    gap: 3px;
  }

  .sin-jugada-badge {
    font-size: 11px;
    font-weight: 800;
    color: #475569;
    letter-spacing: 0.3px;
  }

  .sin-jugada-hint {
    font-size: 10px;
    color: #94a3b8;
    font-weight: 500;
  }

  /* Estado Presentando Banca */
  .presentando-banca-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 12px 10px;
    background: #fefce8;
    border: 1px solid #fef08a;
    border-radius: 8px;
    margin: 4px 0;
    text-align: center;
    gap: 3px;
    box-shadow: 0 2px 4px rgba(234, 179, 8, 0.08);
  }

  .presentando-banca-badge {
    font-size: 11.5px;
    font-weight: 800;
    color: #a16207;
    letter-spacing: 0.3px;
  }

  .presentando-banca-hint {
    font-size: 10px;
    color: #ca8a04;
    font-weight: 600;
  }

  /* Estado Presentando Cartas (Mazo Completo) */
  .presentando-cartas-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 12px 10px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 8px;
    margin: 4px 0;
    text-align: center;
    gap: 3px;
    box-shadow: 0 2px 4px rgba(59, 130, 246, 0.08);
  }

  .presentando-cartas-badge {
    font-size: 11.5px;
    font-weight: 800;
    color: #1d4ed8;
    letter-spacing: 0.3px;
  }

  .presentando-cartas-hint {
    font-size: 10px;
    color: #2563eb;
    font-weight: 600;
  }

  /* Estado Barajo de Cartas */
  .barajo-cartas-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 12px 10px;
    background: #faf5ff;
    border: 1px solid #e9d5ff;
    border-radius: 8px;
    margin: 4px 0;
    text-align: center;
    gap: 3px;
    box-shadow: 0 2px 4px rgba(168, 85, 247, 0.08);
  }

  .barajo-cartas-badge {
    font-size: 11.5px;
    font-weight: 800;
    color: #7e22ce;
    letter-spacing: 0.3px;
  }

  .barajo-cartas-hint {
    font-size: 10px;
    color: #9333ea;
    font-weight: 600;
  }

  /* Footer Limpio y Elegante */
  .badge-card-footer.clean {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 4px;
    padding-top: 6px;
    border-top: 1px solid #e2e8f0;
    font-size: 11px;
    font-weight: 600;
  }

  .badge-cam-info {
    color: #475569;
  }

  .badge-time-info {
    color: #94a3b8;
    font-family: monospace;
  }

  .badge-event {
    font-size: 11px;
    font-weight: 800;
    color: #1e40af;
    background: #e0f2fe;
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-block;
    margin: 4px 0 2px 0;
    transition: all 0.2s ease;
  }

  .badge-event.is-playing {
    color: #15803d;
    background: #dcfce7;
    border: 1px solid #bbf7d0;
    font-weight: 900;
  }

  .badge-desc {
    font-size: 11.5px;
    color: #334155;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .badge-time {
    font-size: 10px;
    color: #94a3b8;
  }

  /* Modal de Visor de Visión Artificial */
  .yolo-vision-modal {
    max-width: 1120px;
    width: 95vw;
  }

  .badge-pulse-online {
    color: #10b981;
    font-weight: 800;
    font-size: 11px;
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    padding: 2px 8px;
    border-radius: 12px;
  }

  .modal-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .yolo-modal-body {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 20px;
    align-items: start;
  }

  @media (max-width: 900px) {
    .yolo-modal-body {
      grid-template-columns: 1fr;
    }
  }

  .yolo-stream-container {
    position: relative;
    background: #020617;
    border-radius: 10px;
    overflow: hidden;
    min-height: 420px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #1e293b;
  }

  .yolo-live-img {
    width: 100%;
    height: auto;
    max-height: 520px;
    display: block;
    object-fit: contain;
  }

  .no-stream-box {
    color: #94a3b8;
    font-size: 13px;
  }

  .stream-overlay-badge {
    position: absolute;
    top: 10px;
    left: 10px;
    background: rgba(15, 23, 42, 0.85);
    color: #38bdf8;
    font-size: 10.5px;
    font-weight: 700;
    font-family: monospace;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid rgba(56, 189, 248, 0.3);
  }

  .yolo-details-side {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .vision-score-box {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 12px;
    background: #0f172a;
    border-radius: 10px;
    padding: 14px;
    color: #ffffff;
  }

  .v-side {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px;
    border-radius: 8px;
  }

  .v-side.punto { color: #93c5fa; }
  .v-side.banca { color: #fca5a5; }

  .v-side.winner {
    background: rgba(255, 255, 255, 0.1);
    box-shadow: 0 0 10px rgba(255, 255, 255, 0.15);
  }

  .v-lbl {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.5px;
  }

  .v-val {
    font-size: 26px;
    font-weight: 900;
    font-family: monospace;
    line-height: 1.1;
  }

  .v-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
    justify-content: center;
  }

  .chip-detail {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 12px;
    font-weight: 900;
    padding: 2px 6px;
    border-radius: 4px;
    background: #ffffff;
    color: #0f172a;
  }

  .chip-detail small {
    font-size: 9px;
    opacity: 0.7;
    font-weight: 600;
  }

  .chip-detail.punto { border-left: 3px solid #2563eb; }
  .chip-detail.banca { border-left: 3px solid #dc2626; }

  .empty-detail {
    font-size: 11px;
    color: #64748b;
  }

  .v-divider {
    display: flex;
    flex-direction: column;
    align-items: center;
    color: #94a3b8;
    font-weight: 900;
    font-size: 12px;
  }

  .v-natural {
    font-size: 8px;
    background: #f59e0b;
    color: #78350f;
    padding: 1px 4px;
    border-radius: 3px;
    margin-top: 3px;
  }

  .vision-status-banner {
    font-size: 13.5px;
    font-weight: 800;
    text-align: center;
    padding: 10px;
    border-radius: 8px;
    background: #f1f5f9;
    color: #0f172a;
    border: 1px solid #cbd5e1;
  }

  .vision-status-banner.punto {
    background: #dbeafe;
    color: #1e40af;
    border-color: #93c5fd;
  }

  .vision-status-banner.banca {
    background: #fee2e2;
    color: #991b1b;
    border-color: #fca5a5;
  }

  .vision-rules-box {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 12px;
  }

  .box-title {
    display: block;
    font-size: 12px;
    font-weight: 800;
    color: #1e293b;
    margin-bottom: 4px;
  }

  .rules-desc {
    margin: 0;
    font-size: 12.5px;
    color: #334155;
    line-height: 1.4;
  }

  .rules-meta {
    display: flex;
    gap: 14px;
    margin-top: 8px;
    font-size: 11px;
    color: #64748b;
    font-weight: 600;
  }

  .feedback-box {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 8px;
    padding: 12px;
  }

  /* Puestos Strip en Badge Card */
  .ia-puestos-strip {
    display: flex;
    justify-content: space-between;
    gap: 3px;
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px dashed rgba(255, 255, 255, 0.15);
  }

  .ia-puesto-tag {
    font-size: 8.5px;
    font-weight: 800;
    padding: 2px 3px;
    border-radius: 3px;
    background: #1e293b;
    color: #94a3b8;
    text-align: center;
    flex: 1;
    transition: all 0.2s ease;
  }

  .ia-puesto-tag.p-banca {
    background: #fee2e2;
    color: #b91c1c;
    border: 1px solid #fecaca;
    font-weight: 900;
  }

  .ia-puesto-tag.p-punto {
    background: #dbeafe;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
    font-weight: 900;
  }

  .ia-puesto-tag.p-tie {
    background: #dcfce7;
    color: #15803d;
    border: 1px solid #bbf7d0;
    font-weight: 900;
  }

  /* Puestos Box en Modal */
  .vision-puestos-box {
    background: #0f172a;
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px solid #334155;
  }

  .puestos-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .puestos-header .box-title {
    color: #f8fafc;
    margin-bottom: 0;
  }

  .puestos-legend {
    font-size: 11px;
    font-weight: 700;
    color: #cbd5e1;
  }

  .puestos-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 6px;
  }

  .puesto-seat-card {
    background: #1e293b;
    border-radius: 6px;
    padding: 6px 4px;
    text-align: center;
    border: 1px solid #334155;
    display: flex;
    flex-direction: column;
    gap: 3px;
    transition: all 0.2s ease;
  }

  .seat-num {
    font-size: 9.5px;
    font-weight: 900;
    color: #94a3b8;
    letter-spacing: 0.5px;
  }

  .seat-outcome {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .seat-badge {
    font-size: 8.5px;
    font-weight: 800;
    padding: 2px 4px;
    border-radius: 3px;
    display: inline-block;
  }

  .seat-badge.banca {
    background: #dc2626;
    color: #ffffff;
  }

  .seat-badge.punto {
    background: #2563eb;
    color: #ffffff;
  }

  .seat-badge.tie {
    background: #16a34a;
    color: #ffffff;
  }

  .seat-badge.wait {
    background: rgba(255, 255, 255, 0.1);
    color: #94a3b8;
  }

  .seat-sub {
    font-size: 8px;
    color: #64748b;
    display: block;
    margin-top: 1px;
    font-weight: 600;
  }

  .puesto-seat-card.seat-banca {
    border-color: #dc2626;
    background: rgba(220, 38, 38, 0.12);
  }

  .puesto-seat-card.seat-punto {
    border-color: #2563eb;
    background: rgba(37, 99, 235, 0.12);
  }

  .puesto-seat-card.seat-tie {
    border-color: #16a34a;
    background: rgba(22, 163, 74, 0.12);
  }

  .feedback-title {
    display: block;
    font-size: 12px;
    font-weight: 800;
    color: #166534;
    margin-bottom: 4px;
  }

  .feedback-desc {
    margin: 0 0 10px 0;
    font-size: 11.5px;
    color: #334155;
    line-height: 1.35;
  }

  .btn-feedback {
    background: #059669;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
    padding: 8px 12px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    width: 100%;
    transition: all 0.15s ease;
  }

  .btn-feedback:hover {
    background: #047857;
  }

  .btn-feedback:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Filters */
  .filter-card {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    padding: 16px 20px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.03);
  }

  .filter-row {
    display: flex;
    align-items: flex-end;
    gap: 14px;
    flex-wrap: wrap;
  }

  .filter-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .flex-1 {
    flex: 1;
    min-width: 220px;
  }

  .filter-group label {
    font-size: 11px;
    font-weight: 800;
    color: #475569;
    text-transform: uppercase;
  }

  .filter-group select, .filter-group input {
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    font-size: 13px;
    outline: none;
  }

  .btn-refresh {
    padding: 8px 14px;
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-weight: 700;
    font-size: 12.5px;
    cursor: pointer;
  }

  /* DataTable */
  .datatable-card {
    background: #ffffff;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.04);
    overflow: hidden;
  }

  .table-header-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 18px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }

  .th-title {
    font-size: 14px;
    font-weight: 800;
    color: #1e293b;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .header-right-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-clear-test {
    background: #fee2e2;
    border: 1px solid #fca5a5;
    padding: 5px 12px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 700;
    color: #b91c1c;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-clear-test:hover {
    background: #fecaca;
    border-color: #ef4444;
  }

  .btn-reset-filter {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 700;
    color: #64748b;
    cursor: pointer;
  }

  .loading-box, .empty-table {
    padding: 40px;
    text-align: center;
    color: #64748b;
  }

  .empty-icon {
    font-size: 36px;
    display: block;
    margin-bottom: 6px;
  }

  .table-wrap {
    overflow-x: auto;
  }

  .live-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }

  .live-table th {
    background: #f8fafc;
    padding: 10px 14px;
    text-align: left;
    font-weight: 800;
    color: #475569;
    border-bottom: 2px solid #e2e8f0;
    white-space: nowrap;
  }

  .live-table td {
    padding: 10px 14px;
    border-bottom: 1px solid #e2e8f0;
  }

  .mesa-name {
    color: #0f172a;
  }

  .game-tag {
    background: #f1f5f9;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 700;
    font-size: 11px;
    color: #334155;
  }

  .event-type-badge {
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10.5px;
    font-weight: 800;
    background: #e2e8f0;
    color: #334155;
  }

  .event-type-badge.jugada {
    background: #dbeafe;
    color: #1e40af;
  }

  .event-desc {
    max-width: 420px;
    color: #1e293b;
  }

  .status-pill.info {
    background: #ecfdf5;
    color: #047857;
    font-weight: 800;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
  }

  .btn-view {
    padding: 4px 8px;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }

  .pagination-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 18px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
  }

  .page-info {
    font-size: 12px;
    color: #64748b;
  }

  .pagination-buttons {
    display: flex;
    gap: 8px;
  }

  .btn-page {
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }

  .btn-page:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }

  .modal-card {
    background: #ffffff;
    border-radius: 12px;
    max-width: 600px;
    width: 100%;
    overflow: hidden;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
  }

  .modal-title {
    margin: 0;
    font-size: 16px;
    font-weight: 800;
  }

  .btn-close {
    background: none;
    border: none;
    font-size: 16px;
    cursor: pointer;
    color: #64748b;
  }

  .modal-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .detail-row {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    border-bottom: 1px solid #f1f5f9;
    padding-bottom: 6px;
  }

  .dt-lbl {
    color: #64748b;
    font-weight: 700;
  }

  .metadata-box {
    margin-top: 10px;
    background: #0f172a;
    padding: 12px;
    border-radius: 8px;
    color: #38bdf8;
  }

  .meta-title {
    font-size: 11px;
    font-weight: 700;
    color: #94a3b8;
    display: block;
    margin-bottom: 6px;
  }

  .meta-json {
    margin: 0;
    font-size: 11px;
    max-height: 180px;
    overflow-y: auto;
  }

  .font-mono {
    font-family: ui-monospace, SFMono-Regular, monospace;
  }

  /* BOTÓN INTERACTIVO DE JUEGO EN TARJETA DE MESA */
  .badge-game-btn {
    background: rgba(30, 41, 59, 0.08);
    border: 1px solid rgba(148, 163, 184, 0.3);
    color: #475569;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s ease;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: 2px;
  }
  .badge-game-btn:hover {
    background: #3b82f6;
    color: #ffffff;
    border-color: #2563eb;
    transform: translateY(-1px);
    box-shadow: 0 2px 6px rgba(59, 130, 246, 0.3);
  }
  .badge-game-btn.pk {
    background: rgba(168, 85, 247, 0.12);
    color: #9333ea;
    border-color: rgba(168, 85, 247, 0.3);
  }
  .badge-game-btn.pk:hover {
    background: #9333ea;
    color: #ffffff;
  }
  .badge-game-btn.pb {
    background: rgba(59, 130, 246, 0.12);
    color: #2563eb;
    border-color: rgba(59, 130, 246, 0.3);
  }
  .badge-game-btn.pb:hover {
    background: #2563eb;
    color: #ffffff;
  }
  .badge-game-btn.bj {
    background: rgba(16, 185, 129, 0.12);
    color: #059669;
    border-color: rgba(16, 185, 129, 0.3);
  }
  .badge-game-btn.bj:hover {
    background: #059669;
    color: #ffffff;
  }

  /* PESTAÑAS DE REGISTRO EN LA TABLA */
  .th-title-wrap {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .table-tabs {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
  }
  .tab-btn {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    color: #475569;
    padding: 5px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .tab-btn:hover {
    background: #e2e8f0;
  }
  .tab-btn.active {
    background: #1e293b;
    color: #ffffff;
    border-color: #1e293b;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  }
  .tab-btn.ok.active {
    background: #10b981;
    border-color: #059669;
  }
  .tab-btn.err.active {
    background: #f59e0b;
    border-color: #d97706;
  }

  /* ESTILOS DE FILAS Y BADGES DE TABLA */
  .event-type-badge.ok {
    background: rgba(16, 185, 129, 0.15);
    color: #059669;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }
  .event-type-badge.error {
    background: rgba(239, 68, 68, 0.15);
    color: #dc2626;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }
  .is-error-row {
    background-color: rgba(254, 242, 242, 0.6) !important;
  }
  .is-error-row:hover {
    background-color: rgba(254, 226, 226, 0.8) !important;
  }
  .status-pill.pill-warn {
    background: #fef3c7;
    color: #b45309;
    border: 1px solid #fde68a;
  }

  .game-tag.tag-poker {
    background: #f3e8ff;
    color: #7e22ce;
    border: 1px solid #d8b4fe;
  }
  .game-tag.tag-bj {
    background: #ecfdf5;
    color: #047857;
    border: 1px solid #a7f3d0;
  }

  /* MODAL CAMBIO DE JUEGO */
  .modal-change-game {
    max-width: 460px;
    width: 90%;
  }
  .modal-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .game-icon-tag {
    font-size: 20px;
  }
  .modal-hint {
    font-size: 13px;
    color: #64748b;
    line-height: 1.5;
    margin: 0;
  }
  .game-select {
    width: 100%;
    padding: 10px 12px;
    font-size: 14px;
    font-weight: 600;
    border-radius: 8px;
    border: 1.5px solid #cbd5e1;
    background: #ffffff;
    color: #1e293b;
    outline: none;
    margin-top: 6px;
  }
  .game-select:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }
  .modal-actions-bar {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }
  .btn-primary {
    background: #3b82f6;
    color: #ffffff;
    border: none;
    padding: 9px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.2s ease;
  }
  .btn-primary:hover:not(:disabled) {
    background: #2563eb;
  }
  .btn-primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .btn-secondary {
    background: #f1f5f9;
    color: #475569;
    border: 1px solid #cbd5e1;
    padding: 9px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-secondary:hover {
    background: #e2e8f0;
  }

  /* Doble Verificación Styles */
  .mesa-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .dv-status-pill {
    font-size: 10.5px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 999px;
    letter-spacing: 0.3px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .dv-status-pill.ok {
    background: #dcfce7;
    color: #15803d;
    border: 1px solid #86efac;
  }

  .dv-status-pill.warn {
    background: #fef3c7;
    color: #b45309;
    border: 1px solid #fcd34d;
    animation: dv-pulse 2s infinite ease-in-out;
  }

  @keyframes dv-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.85; transform: scale(0.98); }
  }

  .mesa-game-row {
    display: flex;
    align-items: center;
    margin-top: 3px;
  }

  .badge-game-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 700;
    color: #3b82f6;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 6px;
    padding: 3px 8px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .badge-game-btn:hover {
    background: #dbeafe;
    border-color: #3b82f6;
  }

  .badge-game-btn.is-general {
    color: #b45309;
    background: #fffbeb;
    border-color: #fde68a;
  }

  .badge-game-btn.pk {
    color: #7c3aed;
    background: #f5f3ff;
    border-color: #ddd6fe;
  }

  .badge-game-btn.bj {
    color: #0d9488;
    background: #f0fdfa;
    border-color: #99f6e4;
  }

  .badge-game-btn.pb {
    color: #2563eb;
    background: #eff6ff;
    border-color: #bfdbfe;
  }

  .mesa-badge-card.has-discrepancy {
    border-color: #f59e0b;
    background: #fffdfa;
  }

  .mesa-badge-card.is-verified {
    border-color: #cbd5e1;
  }

  .dv-alert-banner {
    background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
    border: 1px solid #fde68a;
    border-radius: 8px;
    padding: 8px 10px;
    margin: 4px 0 2px 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .dv-alert-header {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11.5px;
    font-weight: 800;
    color: #92400e;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .dv-alert-msg {
    font-size: 11.5px;
    color: #78350f;
    line-height: 1.35;
  }

  .dv-alert-msg strong {
    color: #b45309;
  }

  .dv-alert-actions {
    display: flex;
    gap: 6px;
    margin-top: 2px;
  }

  .btn-dv-fix {
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    background: #d97706;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 11.5px;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(217, 119, 6, 0.3);
    transition: all 0.15s ease;
  }

  .btn-dv-fix:hover:not(:disabled) {
    background: #b45309;
    transform: translateY(-1px);
    box-shadow: 0 3px 6px rgba(217, 119, 6, 0.4);
  }

  .btn-dv-fix:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .dv-verified-banner {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 6px;
    padding: 5px 8px;
    margin: 3px 0 1px 0;
    font-size: 11px;
    color: #166534;
  }

  .dv-ok-msg strong {
    color: #15803d;
  }

  /* Modal Doble Verificación Box */
  .dv-modal-hint-box {
    padding: 12px 14px;
    border-radius: 8px;
    font-size: 12.5px;
    line-height: 1.4;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .dv-modal-hint-box.alert-box {
    background: #fffbeb;
    border: 1px solid #fde68a;
    color: #92400e;
  }

  .dv-modal-hint-box.ok-box {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    color: #166534;
  }

  .dv-modal-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 800;
    font-size: 13px;
  }

  .dv-modal-text {
    margin: 0;
  }

  .btn-dv-preselect {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: #d97706;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    padding: 5px 10px;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-dv-preselect:hover {
    background: #b45309;
  }

  /* Captura y Evidencia Visual IA en Modal */
  .evidence-snapshot-card {
    margin: 16px 0;
    background: #0f172a;
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid #1e293b;
    box-shadow: 0 4px 14px rgba(0,0,0,0.18);
  }

  .evidence-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: #1e293b;
    border-bottom: 1px solid #334155;
    flex-wrap: wrap;
    gap: 6px;
  }

  .evidence-badge {
    font-size: 11.5px;
    font-weight: 800;
    color: #38bdf8;
    letter-spacing: 0.5px;
  }

  .evidence-sub {
    font-size: 10.5px;
    color: #94a3b8;
  }

  .evidence-img-wrap {
    display: flex;
    justify-content: center;
    align-items: center;
    background: #020617;
    padding: 8px;
    max-height: 480px;
  }

  .evidence-img {
    max-width: 100%;
    max-height: 460px;
    object-fit: contain;
    border-radius: 6px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.4);
  }
</style>
