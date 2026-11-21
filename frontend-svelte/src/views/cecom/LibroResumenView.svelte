<script>
  import { onMount } from "svelte";
  import html2canvas from "html2canvas";
  import { jsPDF } from "jspdf";
  import { saveOrShareFile } from "../../utils/fileSaver.js";
  import { triggerToast } from "../../controllers/ui.store.js";
  import { getPublicWebUrl, toBackendUrl } from "../../config/api.config.js";
  import { navigateToRoute } from "../../controllers/router.store.js";
  import {
    masterSalasStore,
    masterTipoIncidenciasStore,
    masterMetodosPagoStore,
    masterMaquinasStore,
    loadMasterStoresFromBackend,
  } from "../../controllers/master.store.js";
  import {
    getLocalItems,
    upsertLocalItem
  } from "../../services/localDb.service.js";

  export let isPublic = false;
  export let libro = null;
  export let libroId = null;
  export let onSelectSubvista = null;

  let sheetContainerElement = null;
  let isLoading = true;
  let isSyncing = false;
  let isGeneratingPdf = false;
  let loadError = null;
  let reporteExists = false;
  let updatedAt = null;

  // Conteos en vivo para las tarjetas de cada subvista
  let liveCounts = {
    datos: 0,
    drop_mesas: 0,
    arqueo_fichas: 0,
    conteo_maquinas: 0,
    novedades_mesas: 0,
    aportes: 0,
    control_llaves: 0,
    control_clientes: 0,
    incidencias_generales: 0,
  };

  // Datos consolidados del reporte (consumidos de la tabla libro_reporte)
  let resumenData = {
    libro: null,
    datos: null,
    all_datos: [],
    drop_mesas: [],
    arqueo_fichas: [],
    conteo_maquinas: [],
    novedades_mesas: [],
    aportes: [],
    control_llaves: [],
    control_clientes: [],
    incidencias_generales: [],
    maquinas: []
  };

  // Selector de visualización en pantalla
  let viewMode = "documento"; // 'documento' (completo ordenado) | 'drop' | 'resumen' | 'llaves' | 'clientes' | 'incidencias'

  // Pestañas activas por sección
  let tabResumenProd = 'total'; // 'total' | 'mesas' | 'maquinas' | 'clientes'
  let tabMesa = 'drop';        // 'drop' | 'faltantes'
  let tabBilletero = 'rangos'; // 'rangos' | 'detallado'
  let tabAporte = 'rangos';    // 'rangos' | 'empleado' | 'detallado'
  let tabCliente = 'jugador';  // 'jugador' | 'metodo' | 'detallado'

  onMount(async () => {
    // Si no viene libroId, extraerlo de la URL (/reportes/cecom/libro/:id o /reportes/cecom/ibro/:id)
    if (!libroId && typeof window !== "undefined") {
      const hash = window.location.hash || "";
      const matchHash = hash.match(/reportes\/cecom\/(?:libro|ibro)\/([a-f0-9-]+|\d+)/i);
      if (matchHash) libroId = matchHash[1];

      if (!libroId) {
        const path = window.location.pathname || "";
        const matchPath = path.match(/reportes\/cecom\/(?:libro|ibro)\/([a-f0-9-]+|\d+)/i);
        if (matchPath) libroId = matchPath[1];
      }
    }

    await loadMasterStoresFromBackend();

    const targetId = libroId || libro?.uuid || libro?.id;
    if (targetId) {
      if (String(targetId) !== String(lastLoadedId)) {
        await loadFullResumen(targetId);
      }
    } else {
      isLoading = false;
      loadError = "No se especificó ningún libro para generar el reporte";
    }
  });

  let lastLoadedId = null;

  $: currentTargetId = libroId || libro?.uuid || libro?.id;
  $: if (currentTargetId && String(currentTargetId) !== String(lastLoadedId)) {
    loadFullResumen(currentTargetId);
  }

  async function loadFullResumen(id) {
    if (!id) return;
    lastLoadedId = String(id);
    isLoading = true;
    loadError = null;

    // Recuperar cualquier conteo de máquinas guardado localmente en IndexedDB para asegurar visualización inmediata
    let localConteos = [];
    try {
      localConteos = await getLocalItems('libro_conteo_maquinas', r => 
        (r.libro_uuid && (String(r.libro_uuid) === String(id) || String(r.libro_uuid) === String(libro?.uuid))) ||
        (r.libro_id && (String(r.libro_id) === String(id) || String(r.libro_id) === String(libro?.id)))
      );
    } catch (e) {}

    let localArqueos = [];
    try {
      localArqueos = await getLocalItems('libro_arqueo_fichas', r => 
        (r.libro_uuid && (String(r.libro_uuid) === String(id) || String(r.libro_uuid) === String(libro?.uuid))) ||
        (r.libro_id && (String(r.libro_id) === String(id) || String(r.libro_id) === String(libro?.id)))
      );
    } catch (e) {}

    let localMaquinas = [];
    try {
      localMaquinas = await getLocalItems('maquinas');
    } catch (e) {}

    const mergeConteoMaquinas = (baseList = []) => {
      const list = Array.isArray(baseList) ? [...baseList] : [];
      if (Array.isArray(localConteos) && localConteos.length > 0) {
        for (const lc of localConteos) {
          const lcUuid = String(lc.uuid || lc.id || '');
          const lcMaq = String(lc.maquina_uuid || lc.maquina_id || '');
          const exists = list.some(c => 
            (lcUuid && String(c.uuid || c.id) === lcUuid) ||
            (lcMaq && String(c.maquina_uuid || c.maquina_id) === lcMaq)
          );
          if (!exists) {
            list.push(lc);
          }
        }
      }
      return list;
    };

    const mergeArqueoFichas = (baseList = []) => {
      const list = Array.isArray(baseList) ? [...baseList] : [];
      if (Array.isArray(localArqueos) && localArqueos.length > 0) {
        for (const la of localArqueos) {
          const laUuid = String(la.uuid || la.id || '');
          const exists = list.some(a => laUuid && String(a.uuid || a.id) === laUuid);
          if (!exists) {
            list.push(la);
          }
        }
      }
      return list;
    };

    // 1. Carga previa inmediata desde base de datos local IndexedDB (0ms)
    try {
      const local = await getLocalItems('libro_reporte', r => 
        (r.libro_uuid && (String(r.libro_uuid) === String(id) || String(r.libro_uuid) === String(libro?.uuid))) ||
        (r.libro_id && (String(r.libro_id) === String(id) || String(r.libro_id) === String(libro?.id))) ||
        (String(r.id) === String(id) || String(r.uuid) === String(id))
      );
      if (Array.isArray(local) && local.length > 0) {
        const item = local[0];
        const payload = item.data || item;
        reporteExists = true;
        resumenData = {
          libro: payload.libro || libro,
          datos: payload.datos || null,
          all_datos: payload.all_datos || (payload.datos ? (Array.isArray(payload.datos) ? payload.datos : [payload.datos]) : []),
          drop_mesas: payload.drop_mesas || [],
          arqueo_fichas: mergeArqueoFichas(payload.arqueo_fichas),
          conteo_maquinas: mergeConteoMaquinas(payload.conteo_maquinas),
          novedades_mesas: payload.novedades_mesas || [],
          aportes: payload.aportes_maquinas || payload.aportes || [],
          control_llaves: payload.control_llaves || [],
          control_clientes: payload.control_clientes || [],
          incidencias_generales: payload.incidencias_generales || [],
          maquinas: payload.maquinas || (localMaquinas && localMaquinas.length > 0 ? localMaquinas : ($masterMaquinasStore || []))
        };
        if (!libro && resumenData.libro) {
          libro = resumenData.libro;
        }
        isLoading = false;
      }
    } catch (e) {}

    try {
      // Consume directamente del endpoint de la tabla libro_reporte
      const res = await fetch(toBackendUrl(`/api/master/libros/${id}/reporte`));
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && json.data) {
          reporteExists = Boolean(json.exists);
          if (json.liveCounts) {
            liveCounts = { ...liveCounts, ...json.liveCounts };
          }
          updatedAt = json.data.updated_at || json.data.created_at || null;
          const payload = json.data.data || json.data;

          const loadedLibro =
            payload.libro && (String(payload.libro.uuid) === String(id) || String(payload.libro.id) === String(id))
              ? payload.libro
              : libro && (String(libro.uuid) === String(id) || String(libro.id) === String(id))
                ? libro
                : payload.libro || libro;

          const finalConteoMaquinas = mergeConteoMaquinas(payload.conteo_maquinas);
          if (liveCounts && finalConteoMaquinas.length > (liveCounts.conteo_maquinas || 0)) {
            liveCounts.conteo_maquinas = finalConteoMaquinas.length;
          }

          const finalArqueoFichas = mergeArqueoFichas(payload.arqueo_fichas);
          if (liveCounts && finalArqueoFichas.length > (liveCounts.arqueo_fichas || 0)) {
            liveCounts.arqueo_fichas = finalArqueoFichas.length;
          }

          resumenData = {
            libro: loadedLibro,
            datos: payload.datos || null,
            all_datos: payload.all_datos || (payload.datos ? (Array.isArray(payload.datos) ? payload.datos : [payload.datos]) : []),
            drop_mesas: payload.drop_mesas || [],
            arqueo_fichas: finalArqueoFichas,
            conteo_maquinas: finalConteoMaquinas,
            novedades_mesas: payload.novedades_mesas || [],
            aportes: payload.aportes_maquinas || payload.aportes || [],
            control_llaves: payload.control_llaves || [],
            control_clientes: payload.control_clientes || [],
            incidencias_generales: payload.incidencias_generales || [],
            maquinas: payload.maquinas || (localMaquinas && localMaquinas.length > 0 ? localMaquinas : ($masterMaquinasStore || []))
          };
          if (!libro && resumenData.libro) {
            libro = resumenData.libro;
          }
          upsertLocalItem('libro_reporte', json.data).catch(() => {});
          isLoading = false;
          return;
        }
      }

      if (!reporteExists) {
        loadError = "No se pudo cargar la información del libro";
      }
    } catch (err) {
      console.warn("[LocalDb] Error o sin conexión al cargar reporte consolidado (usando local si existe):", err);
      if (!reporteExists) {
        loadError = "Error de conexión al cargar la información del libro";
      }
    } finally {
      isLoading = false;
    }
  }

  // Generar o actualizar instantánea en la tabla libro_reporte (Botón principal solicitado)
  async function handleGenerarOActualizarReporte() {
    const id = libroId || libro?.uuid || libro?.id || activeLibro?.uuid || activeLibro?.id || resumenData.libro?.uuid || resumenData.libro?.id;
    if (!id) return;
    isSyncing = true;
    try {
      const res = await fetch(toBackendUrl(`/api/master/libros/${id}/reporte`), {
        method: "POST",
      });
      const json = await res.json();
      if (json && json.success) {
        const wasExisting = reporteExists;
        reporteExists = true;
        if (json.liveCounts) {
          liveCounts = { ...liveCounts, ...json.liveCounts };
        }
        updatedAt =
          json.data?.updated_at ||
          json.data?.created_at ||
          new Date().toISOString();
        const payload = json.data?.data || json.data;
        if (payload) {
          const loadedLibro =
            payload.libro && (String(payload.libro.uuid) === String(id) || String(payload.libro.id) === String(id))
              ? payload.libro
              : libro && (String(libro.uuid) === String(id) || String(libro.id) === String(id))
                ? libro
                : payload.libro || libro;

          resumenData = {
            libro: loadedLibro,
            datos: payload.datos || null,
            all_datos: payload.all_datos || (payload.datos ? (Array.isArray(payload.datos) ? payload.datos : [payload.datos]) : []),
            drop_mesas: payload.drop_mesas || [],
            arqueo_fichas: payload.arqueo_fichas || [],
            conteo_maquinas: payload.conteo_maquinas || [],
            novedades_mesas: payload.novedades_mesas || [],
            aportes: payload.aportes_maquinas || payload.aportes || [],
            control_llaves: payload.control_llaves || [],
            control_clientes: payload.control_clientes || [],
            incidencias_generales: payload.incidencias_generales || [],
            maquinas: payload.maquinas || ($masterMaquinasStore || [])
          };
          if (!libro && resumenData.libro) {
            libro = resumenData.libro;
          }
          upsertLocalItem('libro_reporte', json.data).catch(() => {});
        }
        triggerToast(
          wasExisting
            ? "Reporte consolidado actualizado exitosamente en libro_reporte"
            : "Reporte consolidado generado y guardado exitosamente en libro_reporte",
          "success",
        );
      } else {
        triggerToast(
          json?.error || "Error al procesar reporte consolidado",
          "error",
        );
      }
    } catch (err) {
      triggerToast(`Error: ${err.message}`, "error");
    } finally {
      isSyncing = false;
    }
  }

  // Navegar directamente a la subvista seleccionada
  function handleGoToSubvista(subId) {
    if (typeof onSelectSubvista === "function") {
      onSelectSubvista(subId);
    } else {
      const id = libroId || libro?.uuid || libro?.id || activeLibro?.uuid || activeLibro?.id || resumenData.libro?.uuid || resumenData.libro?.id;
      if (id) {
        navigateToRoute(`cecom/libro/${id}/${subId}`);
      }
    }
  }

  // Formato amigable de fecha y hora
  function formatDateTimeDisplay(dateStr) {
    if (!dateStr) return "—";
    try {
      const d = new Date(dateStr);
      return (
        d.toLocaleDateString("es-VE") +
        " " +
        d.toLocaleTimeString("es-VE", { hour: "2-digit", minute: "2-digit" })
      );
    } catch (e) {
      return dateStr;
    }
  }

  // Libro representativo activo (garantizando concordancia de sala y fecha con el libro actual)
  $: activeLibro = (() => {
    const target = libroId || libro?.uuid || libro?.id;
    if (libro && (!target || String(libro.uuid) === String(target) || String(libro.id) === String(target))) {
      return { ...(resumenData.libro || {}), ...libro };
    }
    if (resumenData.libro && (!target || String(resumenData.libro.uuid) === String(target) || String(resumenData.libro.id) === String(target))) {
      return resumenData.libro;
    }
    return libro || resumenData.libro;
  })();

  // Nombre de la sala asignada al libro
  $: salaNombre = (() => {
    const l = activeLibro;
    if (l?.sala_nombre) return l.sala_nombre;
    if (l?.sala_nombre_comercial) return l.sala_nombre_comercial;
    if (l?.sala_uuid || l?.sala_id) {
      const s = ($masterSalasStore || []).find(
        (sala) => (l.sala_uuid && (sala.uuid === l.sala_uuid || sala.id === l.sala_uuid)) || (l.sala_id && String(sala.uuid || sala.id) === String(l.sala_id)),
      );
      if (s) return s.nombre_comercial || s.nombre;
    }
    return "Sala de Casino";
  })();

  // Detección de multisalas para la sala del libro
  $: currentSalaMultisalas = (() => {
    let raw = activeLibro?.sala_multisalas;
    if (!raw && (activeLibro?.sala_uuid || activeLibro?.sala_id)) {
      const foundSala = ($masterSalasStore || []).find(
        (s) =>
          (activeLibro.sala_uuid && (s.uuid === activeLibro.sala_uuid || s.id === activeLibro.sala_uuid)) ||
          (activeLibro.sala_id && String(s.uuid || s.id) === String(activeLibro.sala_id))
      );
      if (foundSala) raw = foundSala.multisalas;
    }
    if (!raw) return [];
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch (e) {
        return [];
      }
    }
    if (!Array.isArray(raw)) return [];
    return raw;
  })();

  $: subsalasList = currentSalaMultisalas.filter(
    (s) => s && (s.active === undefined || s.active === null || Number(s.active) === 1 || s.active === true)
  );

  $: isMultisala = subsalasList.length > 0;

  // Desglose de fecha [ D | M | A ]
  $: dateParts = (() => {
    const dStr = activeLibro?.descripcion || "";
    if (!dStr) return { day: "—", month: "—", year: "—", formatted: "—" };

    // Si viene YYYY-MM-DD
    const mYMD = String(dStr).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (mYMD) {
      return {
        day: mYMD[3].padStart(2, "0"),
        month: mYMD[2].padStart(2, "0"),
        year: mYMD[1].slice(-2),
        formatted: `${mYMD[3].padStart(2, "0")}/${mYMD[2].padStart(2, "0")}/${mYMD[1]}`,
      };
    }
    // Si viene DD/MM/YYYY
    const mDMY = String(dStr).match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (mDMY) {
      return {
        day: mDMY[1].padStart(2, "0"),
        month: mDMY[2].padStart(2, "0"),
        year: mDMY[3].slice(-2),
        formatted: `${mDMY[1].padStart(2, "0")}/${mDMY[2].padStart(2, "0")}/${mDMY[3]}`,
      };
    }
    return { day: "—", month: "—", year: "—", formatted: dStr };
  })();

  // Parser para formatear la mercancía e incidencias tipo Word (Título con hora en negrita e items en sangría)
  function parseIncidenciaContent(desc, hora) {
    if (!desc) return { title: "", items: [] };
    const rawLines = String(desc).split("\n");
    const lines = rawLines
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { title: "", items: [] };

    let titleLine = lines[0].trim();
    const horaRegex = /^\d{1,2}:\d{2}/;
    if (hora && !horaRegex.test(titleLine)) {
      titleLine = `${hora} ${titleLine}`;
    }

    const items = lines
      .slice(1)
      .map((l) => {
        return l.replace(/^[\s•\-\*]+/, "").trim();
      })
      .filter(Boolean);

    return {
      title: titleLine,
      items,
    };
  }

  // Ordenar por fecha / ID de la tabla (el más reciente/último registrado primero)
  function sortByMasReciente(list) {
    return [...(list || [])].sort((a, b) => {
      const timeA = new Date(a.created_at || a.fecha || 0).getTime();
      const timeB = new Date(b.created_at || b.fecha || 0).getTime();
      if (timeB !== timeA) return timeB - timeA;
      return String(b.uuid || b.id || "").localeCompare(String(a.uuid || a.id || ""));
    });
  }

  $: availableTiposIncidencia = $masterTipoIncidenciasStore || [];

  function normalizeText(val) {
    return String(val || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function getPillIcon(name) {
    return "";
  }

  function getContrastColor(hexColor) {
    if (!hexColor || typeof hexColor !== "string") return "#ffffff";
    let hex = hexColor.replace("#", "");
    if (hex.length === 3) {
      hex = hex.split("").map((c) => c + c).join("");
    }
    if (hex.length !== 6) return "#ffffff";
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 140 ? "#0f172a" : "#ffffff";
  }

  function getMetodoColor(metodoName, recordColor) {
    if (recordColor) return recordColor;
    if (!metodoName) return "#64748B";
    const n = metodoName.toLowerCase().trim();
    const metodos = $masterMetodosPagoStore || [];
    const found = metodos.find((m) => (m.nombre || "").toLowerCase().trim() === n);
    if (found && found.color) return found.color;
    return "#64748B";
  }

  function getMetodoBadgeStyle(metodoName, recordColor) {
    const color = getMetodoColor(metodoName, recordColor);
    const textCol = getContrastColor(color);
    return `background-color: ${color} !important; color: ${textCol} !important; border: 1px solid rgba(0, 0, 0, 0.15) !important; box-shadow: 0 1px 2px rgba(0,0,0,0.06);`;
  }

  // Filtra y retorna solo los horarios operativos que tienen al menos una hora registrada
  function getActiveHorarios(datos) {
    if (!datos) return [];
    const list = [
      {
        label: "Apertura de la sala",
        inicio: datos.apertura_sala_inicio,
        fin: datos.apertura_sala_fin,
      },
      {
        label: "Apertura de maquinas",
        inicio: datos.apertura_maquinas_inicio,
        fin: datos.apertura_maquinas_fin,
      },
      {
        label: "Apertura de bingo",
        inicio: datos.apertura_bingo_inicio,
        fin: datos.apertura_bingo_fin,
      },
      {
        label: "Retiro de dropbox general",
        inicio: datos.retiros_dropbox_inicio,
        fin: datos.retiros_dropbox_fin,
      },
      {
        label: "Conteo DROP",
        inicio: datos.conteo_dropbox_inicio,
        fin: datos.conteo_dropbox_fin,
      },
    ];
    return list.filter((item) => {
      const ini = (item.inicio || "").toString().trim();
      const fn = (item.fin || "").toString().trim();
      const hasIni = ini !== "" && ini !== "—" && ini !== "-";
      const hasFn = fn !== "" && fn !== "—" && fn !== "-";
      return hasIni || hasFn;
    });
  }

  // Obtener cantidad de fichas de un registro para una denominación dada
  function getChipCount(record, valor) {
    if (!record) return null;
    const fList = Array.isArray(record.fichas)
      ? record.fichas
      : (typeof record.fichas === 'string' ? JSON.parse(record.fichas || '[]') : []);

    const found = fList.find(f => Number(f.valor ?? f.denominacion) === Number(valor));
    return found ? (Number(found.cantidad) || 0) : 0;
  }

  // Helper que procesa y calcula las subvistas operativas para una sala (única o hija)
  function computeSubsalaReport(subsalaUuid, rawData) {
    const isMultisalaTarget = Boolean(subsalaUuid);
    const isFirstActiveSubsala = Boolean(
      subsalaUuid && subsalasList.length > 0 && String(subsalasList[0].uuid) === String(subsalaUuid)
    );

    const matchesSub = (recUuid) => {
      if (!isMultisalaTarget) return true;
      if (recUuid && String(recUuid) === String(subsalaUuid)) return true;
      if (!recUuid && isFirstActiveSubsala) return true;
      return false;
    };

    // 1. Datos operativos (horarios)
    const allD = rawData.all_datos || (rawData.datos ? (Array.isArray(rawData.datos) ? rawData.datos : [rawData.datos]) : []);
    let datos = null;
    if (isMultisalaTarget) {
      datos = allD.find(d => d.multisala_uuid && String(d.multisala_uuid) === String(subsalaUuid)) ||
              (isFirstActiveSubsala ? allD.find(d => !d.multisala_uuid) : null) ||
              null;
    } else {
      datos = rawData.datos || allD.find(d => !d.multisala_uuid) || allD[0] || null;
    }

    // 2. Drop de mesas
    const drop_mesas = (rawData.drop_mesas || []).filter(d => matchesSub(d.multisala_uuid));
    const sum100 = drop_mesas.reduce((acc, r) => acc + (Number(r.denominacion_100 ?? r.b100 ?? 0) || 0), 0);
    const sum50 = drop_mesas.reduce((acc, r) => acc + (Number(r.denominacion_50 ?? r.b50 ?? 0) || 0), 0);
    const sum20 = drop_mesas.reduce((acc, r) => acc + (Number(r.denominacion_20 ?? r.b20 ?? 0) || 0), 0);
    const sum10 = drop_mesas.reduce((acc, r) => acc + (Number(r.denominacion_10 ?? r.b10 ?? 0) || 0), 0);
    const sum5 = drop_mesas.reduce((acc, r) => acc + (Number(r.denominacion_5 ?? r.b5 ?? 0) || 0), 0);
    const sum1 = drop_mesas.reduce((acc, r) => acc + (Number(r.denominacion_1 ?? r.b1 ?? 0) || 0), 0);
    const grandTotal = drop_mesas.reduce((acc, r) => acc + (Number(r.total) || 0), 0);
    const dropTotales = { sum100, sum50, sum20, sum10, sum5, sum1, grandTotal };

    // 2.1 Arqueo de Fichas
    const rawArqueo = (rawData.arqueo_fichas || []).filter(a => matchesSub(a.multisala_uuid));

    let rawFichas = activeLibro?.sala_fichas;
    if (!rawFichas && (activeLibro?.sala_uuid || activeLibro?.sala_id)) {
      const s = ($masterSalasStore || []).find(
        (sala) => (activeLibro.sala_uuid && (sala.uuid === activeLibro.sala_uuid || sala.id === activeLibro.sala_uuid)) || 
                  (activeLibro.sala_id && String(sala.uuid || sala.id) === String(activeLibro.sala_id))
      );
      if (s) rawFichas = s.fichas || s.sala_fichas;
    }
    if (typeof rawFichas === 'string') {
      try { rawFichas = JSON.parse(rawFichas); } catch (e) { rawFichas = null; }
    }
    let arqueoSalaFichas = [1000, 500, 100, 25, 5, 1];
    if (Array.isArray(rawFichas) && rawFichas.length > 0) {
      const nums = rawFichas.map(v => parseInt(v, 10)).filter(n => !isNaN(n) && n > 0);
      if (nums.length > 0) {
        arqueoSalaFichas = Array.from(new Set(nums)).sort((a, b) => b - a);
      }
    }

    const arqueoGroupsMap = new Map();
    for (const r of rawArqueo) {
      if (r.is_deleted) continue;
      const mId = String(r.mesa_uuid || r.mesa_id || r.id);
      if (!arqueoGroupsMap.has(mId)) {
        arqueoGroupsMap.set(mId, {
          mesaId: mId,
          mesaNombre: r.mesa_nombre || `Mesa #${mId.slice(0, 8)}`,
          juegoNombre: r.juego_nombre || '',
          apertura: null,
          cierre: null
        });
      }
      const g = arqueoGroupsMap.get(mId);
      if (r.tipo === 'apertura') {
        g.apertura = r;
      } else if (r.tipo === 'cierre') {
        g.cierre = r;
      }
    }

    const arqueoMesaGroups = Array.from(arqueoGroupsMap.values()).sort((a, b) => 
      (a.mesaNombre || '').localeCompare(b.mesaNombre || '', undefined, { numeric: true, sensitivity: 'base' })
    );

    let totalArqueoFaltantes = 0;
    let totalArqueoSobrantes = 0;
    for (const g of arqueoMesaGroups) {
      if (g.cierre) {
        const ap = Number(g.apertura?.total) || 0;
        const ci = Number(g.cierre?.total) || 0;
        const dif = ci - ap;
        if (dif < 0) {
          totalArqueoFaltantes += Math.abs(dif);
        } else if (dif > 0) {
          totalArqueoSobrantes += dif;
        }
      }
    }

    const totalArqueoApertura = arqueoMesaGroups.reduce((acc, g) => acc + (Number(g.apertura?.total) || 0), 0);
    const totalArqueoCierre = arqueoMesaGroups.reduce((acc, g) => acc + (Number(g.cierre?.total) || 0), 0);
    const totalArqueoDiferencia = totalArqueoSobrantes - totalArqueoFaltantes;

    // 3. Novedades de mesas
    const novedades_mesas = (rawData.novedades_mesas || []).filter(n => matchesSub(n.multisala_uuid));

    // 4. Incidencias generales
    const rawIncidencias = (rawData.incidencias_generales || []).filter(i => matchesSub(i.multisala_uuid));
    const sortedIncidencias = sortByMasReciente(rawIncidencias);

    const categories = availableTiposIncidencia.map(t => ({
      uuid: t.uuid || t.id,
      id: t.uuid || t.id,
      nombre: t.nombre,
      items: []
    }));

    for (const inc of sortedIncidencias) {
      const incUuid = (inc.tipo_incidencia_uuid || inc.tipo_incidencia_id) != null ? String(inc.tipo_incidencia_uuid || inc.tipo_incidencia_id) : null;
      const incTipoNorm = normalizeText(inc.tipo || inc.tipo_incidencia_nombre);
      const descNorm = (inc.descripcion || "").toLowerCase();

      let matchedCat = categories.find(c => 
        (incUuid && String(c.uuid || c.id) === incUuid) ||
        (normalizeText(c.nombre) === incTipoNorm)
      );

      if (!matchedCat) {
        if (incTipoNorm.includes("mercanc") || descNorm.includes("mercanc") || descNorm.includes("proveedor")) {
          matchedCat = categories.find(c => normalizeText(c.nombre).includes("mercanc"));
        } else if (incTipoNorm.includes("emplead") || incTipoNorm.includes("personal") || descNorm.includes("emplead") || descNorm.includes("croupier")) {
          matchedCat = categories.find(c => normalizeText(c.nombre).includes("emplead") || normalizeText(c.nombre).includes("personal"));
        } else if (incTipoNorm.includes("maquin") || descNorm.includes("maquin")) {
          matchedCat = categories.find(c => normalizeText(c.nombre).includes("maquin"));
        }
      }

      if (matchedCat) {
        matchedCat.items.push(inc);
      } else {
        const customName = (inc.tipo || inc.tipo_incidencia_nombre || "General").trim();
        let customCat = categories.find(c => normalizeText(c.nombre) === normalizeText(customName));
        if (!customCat) {
          customCat = { id: `custom-${customName}`, nombre: customName, items: [] };
          categories.push(customCat);
        }
        customCat.items.push(inc);
      }
    }
    const incidenciasPorTipo = categories;

    // 5. Control de llaves
    const rawLlaves = (rawData.control_llaves || []).filter(k => matchesSub(k.multisala_uuid));
    const sortedControlLlaves = sortByMasReciente(rawLlaves);
    let enCustodia = 0;
    let devueltas = 0;
    for (const k of sortedControlLlaves) {
      if (k.hora_recepcion && k.hora_recepcion.trim()) {
        devueltas++;
      } else {
        enCustodia++;
      }
    }
    const llavesTotales = { total: sortedControlLlaves.length, enCustodia, devueltas };

    // 6. Control de clientes
    const rawClientes = (rawData.control_clientes || []).filter(c => matchesSub(c.multisala_uuid));
    const sortedControlClientes = sortByMasReciente(rawClientes);

    function procesarControlClientes(records) {
      let totalCompras = 0;
      let totalPagos = 0;
      for (const c of records) {
        const m = parseFloat(c.monto) || 0;
        const t = (c.tipo || "compra").toLowerCase();
        if (t === "pago") {
          totalPagos += m;
        } else {
          totalCompras += m;
        }
      }
      const balanceNeto = totalCompras - totalPagos;
      const totales = { totalCompras, totalPagos, balanceNeto, totalOps: records.length };

      const mapMetodo = {};
      for (const c of records) {
        const metodo = (c.metodo || "No especificado").trim();
        const color = c.metodo_color || null;
        if (!mapMetodo[metodo]) {
          mapMetodo[metodo] = { metodo, color, ops: 0, compras: 0, pagos: 0, balance: 0 };
        }
        if (!mapMetodo[metodo].color && color) {
          mapMetodo[metodo].color = color;
        }
        const m = parseFloat(c.monto) || 0;
        const t = (c.tipo || "compra").toLowerCase();
        mapMetodo[metodo].ops += 1;
        if (t === "pago") {
          mapMetodo[metodo].pagos += m;
        } else {
          mapMetodo[metodo].compras += m;
        }
      }
      const porMetodo = Object.values(mapMetodo)
        .map((item) => ({ ...item, balance: item.compras - item.pagos }))
        .sort((a, b) => b.compras + b.pagos - (a.compras + a.pagos));

      const opsMet = porMetodo.reduce((acc, r) => acc + r.ops, 0);
      const comprasMet = porMetodo.reduce((acc, r) => acc + r.compras, 0);
      const pagosMet = porMetodo.reduce((acc, r) => acc + r.pagos, 0);
      const totalesPorMetodo = { ops: opsMet, compras: comprasMet, pagos: pagosMet, balance: comprasMet - pagosMet };

      const mapJugador = {};
      for (const c of records) {
        const cliente = (c.cliente || "Anónimo / General").trim();
        if (!mapJugador[cliente]) {
          mapJugador[cliente] = { cliente, ops: 0, compras: 0, pagos: 0, balance: 0 };
        }
        const m = parseFloat(c.monto) || 0;
        const t = (c.tipo || "compra").toLowerCase();
        mapJugador[cliente].ops += 1;
        if (t === "pago") {
          mapJugador[cliente].pagos += m;
        } else {
          mapJugador[cliente].compras += m;
        }
      }
      const porJugador = Object.values(mapJugador)
        .map((item) => ({ ...item, balance: item.compras - item.pagos }))
        .sort((a, b) => b.compras + b.pagos - (a.compras + a.pagos));

      const opsJug = porJugador.reduce((acc, r) => acc + r.ops, 0);
      const comprasJug = porJugador.reduce((acc, r) => acc + r.compras, 0);
      const pagosJug = porJugador.reduce((acc, r) => acc + r.pagos, 0);
      const totalesPorJugador = { ops: opsJug, compras: comprasJug, pagos: pagosJug, balance: comprasJug - pagosJug };

      return {
        records,
        totales,
        porMetodo,
        totalesPorMetodo,
        porJugador,
        totalesPorJugador
      };
    }

    const dataClientesGlobal = procesarControlClientes(sortedControlClientes);
    const dataClientesMesas = procesarControlClientes(
      sortedControlClientes.filter(c => {
        const cj = (c.caja || 'Mesas').toLowerCase();
        return cj !== 'máquinas' && cj !== 'maquinas';
      })
    );
    const dataClientesMaquinas = procesarControlClientes(
      sortedControlClientes.filter(c => {
        const cj = (c.caja || 'Mesas').toLowerCase();
        return cj === 'máquinas' || cj === 'maquinas';
      })
    );

    const clientesTotales = dataClientesGlobal.totales;
    const clientesPorMetodo = dataClientesGlobal.porMetodo;
    const totalesPorMetodo = dataClientesGlobal.totalesPorMetodo;
    const clientesPorJugador = dataClientesGlobal.porJugador;
    const totalesPorJugador = dataClientesGlobal.totalesPorJugador;

    // Producción de mesas: ((drop + sobrantes) - faltantes)
    const produccionMesas = (dropTotales.grandTotal + totalArqueoSobrantes) - totalArqueoFaltantes;

    // 7. Aportes máquinas
    const rawAportes = (rawData.aportes_maquinas || rawData.aportes || []).filter(a => matchesSub(a.multisala_uuid));
    const sortedAportesList = sortByMasReciente(rawAportes);

    const aportesOnly = sortedAportesList.filter(a => (a.tipo || 'Aporte') === 'Aporte');
    const devolucionesOnly = sortedAportesList.filter(a => (a.tipo || 'Aporte') === 'Devolución');

    const totalAportes = aportesOnly.reduce((acc, a) => acc + (parseFloat(a.monto) || 0), 0);
    const totalDevoluciones = devolucionesOnly.reduce((acc, a) => acc + (parseFloat(a.monto) || 0), 0);
    const netoMonto = totalAportes - totalDevoluciones;
    const totalOpsAportes = sortedAportesList.length;
    const cantAportes = aportesOnly.length;
    const cantDevoluciones = devolucionesOnly.length;
    const promedioAportes = cantAportes > 0 ? totalAportes / cantAportes : (totalOpsAportes > 0 ? netoMonto / totalOpsAportes : 0);

    const aportesTotales = {
      totalMonto: netoMonto,
      totalAportes,
      totalDevoluciones,
      netoMonto,
      totalOps: totalOpsAportes,
      cantAportes,
      cantDevoluciones,
      promedio: promedioAportes
    };

    const mapRango = {};
    for (const a of sortedAportesList) {
      const rKey = a.rango_uuid || a.rango_id || 0;
      const rNom = a.rango_nombre || (a.rango_uuid ? `Rango #${a.rango_uuid.slice(0, 8)}` : `Rango #${rKey}`);
      if (!mapRango[rKey]) {
        mapRango[rKey] = {
          rango_uuid: a.rango_uuid || rKey,
          rango_id: rKey,
          rango_nombre: rNom,
          cantidad: 0,
          cantAportes: 0,
          cantDevoluciones: 0,
          montoAportes: 0,
          montoDevoluciones: 0,
          neto: 0,
          monto: 0
        };
      }
      mapRango[rKey].cantidad++;
      const val = parseFloat(a.monto) || 0;
      if ((a.tipo || 'Aporte') === 'Devolución') {
        mapRango[rKey].cantDevoluciones++;
        mapRango[rKey].montoDevoluciones += val;
        mapRango[rKey].neto -= val;
        mapRango[rKey].monto -= val;
      } else {
        mapRango[rKey].cantAportes++;
        mapRango[rKey].montoAportes += val;
        mapRango[rKey].neto += val;
        mapRango[rKey].monto += val;
      }
    }
    const grandTotalAportes = aportesTotales.totalAportes || 1;
    const aportesPorRango = Object.values(mapRango)
      .map(item => ({
        ...item,
        porcentaje: (item.montoAportes / grandTotalAportes) * 100,
        promedio: item.cantAportes > 0 ? item.montoAportes / item.cantAportes : 0
      }))
      .sort((a, b) => (a.rango_nombre || '').localeCompare(b.rango_nombre || '', undefined, { numeric: true, sensitivity: 'base' }));

    const mapEmp = {};
    for (const a of sortedAportesList) {
      const empKey = a.empleado_uuid || a.empleado_id || 0;
      const empNom = a.empleado_nombre || (a.empleado_uuid ? `Empleado #${a.empleado_uuid.slice(0, 8)}` : 'Empleado');
      const cargoNom = a.cargo_nombre || '—';
      if (!mapEmp[empKey]) {
        mapEmp[empKey] = {
          empleado_uuid: a.empleado_uuid || empKey,
          empleado_id: empKey,
          empleado_nombre: empNom,
          cargo_nombre: cargoNom,
          cantidad: 0,
          cantAportes: 0,
          cantDevoluciones: 0,
          montoAportes: 0,
          montoDevoluciones: 0,
          neto: 0,
          monto: 0
        };
      }
      mapEmp[empKey].cantidad++;
      const val = parseFloat(a.monto) || 0;
      if ((a.tipo || 'Aporte') === 'Devolución') {
        mapEmp[empKey].cantDevoluciones++;
        mapEmp[empKey].montoDevoluciones += val;
        mapEmp[empKey].neto -= val;
        mapEmp[empKey].monto -= val;
      } else {
        mapEmp[empKey].cantAportes++;
        mapEmp[empKey].montoAportes += val;
        mapEmp[empKey].neto += val;
        mapEmp[empKey].monto += val;
      }
    }
    const aportesPorEmpleado = Object.values(mapEmp)
      .map(item => ({
        ...item,
        porcentaje: (item.montoAportes / grandTotalAportes) * 100,
        promedio: item.cantAportes > 0 ? item.montoAportes / item.cantAportes : 0
      }))
      .sort((a, b) => b.montoAportes - a.montoAportes);

    // 8. Conteo de máquinas (Billeteros)
    const rawConteo = (rawData.conteo_maquinas || []).filter(c => matchesSub(c.multisala_uuid));
    const sortedConteoList = sortByMasReciente(rawConteo);

    const sumConteo100 = sortedConteoList.reduce((acc, r) => acc + (Number(r.denominacion_100 ?? r.b100 ?? 0) || 0), 0);
    const sumConteo50 = sortedConteoList.reduce((acc, r) => acc + (Number(r.denominacion_50 ?? r.b50 ?? 0) || 0), 0);
    const sumConteo20 = sortedConteoList.reduce((acc, r) => acc + (Number(r.denominacion_20 ?? r.b20 ?? 0) || 0), 0);
    const sumConteo10 = sortedConteoList.reduce((acc, r) => acc + (Number(r.denominacion_10 ?? r.b10 ?? 0) || 0), 0);
    const sumConteo5 = sortedConteoList.reduce((acc, r) => acc + (Number(r.denominacion_5 ?? r.b5 ?? 0) || 0), 0);
    const sumConteo1 = sortedConteoList.reduce((acc, r) => acc + (Number(r.denominacion_1 ?? r.b1 ?? 0) || 0), 0);
    const grandTotalConteo = sortedConteoList.reduce((acc, r) => acc + (Number(r.total) || 0), 0);

    const conteoTotales = {
      sum100: sumConteo100,
      sum50: sumConteo50,
      sum20: sumConteo20,
      sum10: sumConteo10,
      sum5: sumConteo5,
      sum1: sumConteo1,
      totalMaquinas: sortedConteoList.length,
      grandTotal: grandTotalConteo
    };

    // Agrupación de conteo por Rango para el reporte
    const mapConteoRango = {};
    for (const c of sortedConteoList) {
      const rKey = c.rango_uuid || c.rango_id || 0;
      const rNom = c.rango_nombre || (c.rango_uuid ? `Rango #${c.rango_uuid.slice(0, 8)}` : `Rango #${rKey}`);
      if (!mapConteoRango[rKey]) {
        mapConteoRango[rKey] = {
          rango_uuid: c.rango_uuid || rKey,
          rango_id: rKey,
          rango_nombre: rNom,
          maquinasCount: 0,
          b100: 0,
          b50: 0,
          b20: 0,
          b10: 0,
          b5: 0,
          b1: 0,
          total: 0
        };
      }
      mapConteoRango[rKey].maquinasCount++;
      mapConteoRango[rKey].b100 += Number(c.denominacion_100 ?? c.b100 ?? 0) || 0;
      mapConteoRango[rKey].b50 += Number(c.denominacion_50 ?? c.b50 ?? 0) || 0;
      mapConteoRango[rKey].b20 += Number(c.denominacion_20 ?? c.b20 ?? 0) || 0;
      mapConteoRango[rKey].b10 += Number(c.denominacion_10 ?? c.b10 ?? 0) || 0;
      mapConteoRango[rKey].b5 += Number(c.denominacion_5 ?? c.b5 ?? 0) || 0;
      mapConteoRango[rKey].b1 += Number(c.denominacion_1 ?? c.b1 ?? 0) || 0;
      mapConteoRango[rKey].total += Number(c.total) || 0;
    }
    const conteoPorRango = Object.values(mapConteoRango).sort((a, b) => 
      (a.rango_nombre || '').localeCompare(b.rango_nombre || '', undefined, { numeric: true, sensitivity: 'base' })
    );

    // 9. Resumen de Producción por Rango (Conteo Billeteros - Aportes y Devoluciones Netos)
    let produccionPorRango = [];
    const hasAnyMaquinaOps = sortedConteoList.length > 0 || sortedAportesList.length > 0;

    if (hasAnyMaquinaOps) {
      const mapProduccionRango = {};

      // Obtener todas las máquinas registradas en la sala del libro
      const targetSalaUuid = activeLibro?.sala_uuid || activeLibro?.sala_id || null;
      const allMaquinasList = (rawData.maquinas && rawData.maquinas.length > 0)
        ? rawData.maquinas
        : ($masterMaquinasStore || []);

      const allMaquinasSala = allMaquinasList.filter(m => {
        if (m.is_deleted) return false;
        if (targetSalaUuid && (m.sala_uuid || m.sala_id) && String(m.sala_uuid || m.sala_id) !== String(targetSalaUuid)) return false;
        return true;
      });

      // Mapear conteo total de máquinas registradas en la sala por Rango (uuid y nombre)
      const mapTotalMaquinasPorRangoUuid = {};
      const mapTotalMaquinasPorRangoNombre = {};
      for (const m of allMaquinasSala) {
        if (m.rango_uuid) {
          mapTotalMaquinasPorRangoUuid[String(m.rango_uuid)] = (mapTotalMaquinasPorRangoUuid[String(m.rango_uuid)] || 0) + 1;
        }
        const rNom = (m.rango_nombre || '').trim();
        if (rNom) {
          mapTotalMaquinasPorRangoNombre[rNom.toLowerCase()] = (mapTotalMaquinasPorRangoNombre[rNom.toLowerCase()] || 0) + 1;
        }
      }

      // A) Inicializar con todos los rangos que tienen máquinas registradas en la sala
      for (const m of allMaquinasSala) {
        const rKey = m.rango_uuid || (m.rango_nombre ? m.rango_nombre.trim() : 'sin_rango');
        const rNom = m.rango_nombre || (m.rango_uuid ? `Rango #${m.rango_uuid.slice(0, 8)}` : 'Sin Rango');
        if (!mapProduccionRango[rKey]) {
          mapProduccionRango[rKey] = {
            rango_uuid: m.rango_uuid || rKey,
            rango_id: rKey,
            rango_nombre: rNom,
            maquinasCount: 0,
            maquinasSet: new Set(),
            billetero: 0,
            montoAportes: 0,
            montoDevoluciones: 0,
            aportesNeto: 0,
            produccion: 0
          };
        }
      }

      // B) Mapear desde conteo de máquinas
      for (const c of sortedConteoList) {
        const rKey = c.rango_uuid || c.rango_id || (c.rango_nombre ? c.rango_nombre.trim() : 0);
        const rNom = c.rango_nombre || (c.rango_uuid ? `Rango #${c.rango_uuid.slice(0, 8)}` : `Rango #${rKey}`);
        if (!mapProduccionRango[rKey]) {
          mapProduccionRango[rKey] = {
            rango_uuid: c.rango_uuid || rKey,
            rango_id: rKey,
            rango_nombre: rNom,
            maquinasCount: 0,
            maquinasSet: new Set(),
            billetero: 0,
            montoAportes: 0,
            montoDevoluciones: 0,
            aportesNeto: 0,
            produccion: 0
          };
        }
        const maqKey = c.maquina_uuid || c.maquina_id || c.id || `${rKey}_${mapProduccionRango[rKey].maquinasSet.size + 1}`;
        mapProduccionRango[rKey].maquinasSet.add(maqKey);
        mapProduccionRango[rKey].billetero += Number(c.total) || 0;
      }

      // C) Cruzar con los datos de aportes y devoluciones
      for (const a of sortedAportesList) {
        const rKey = a.rango_uuid || a.rango_id || (a.rango_nombre ? a.rango_nombre.trim() : 0);
        const rNom = a.rango_nombre || (a.rango_uuid ? `Rango #${a.rango_uuid.slice(0, 8)}` : `Rango #${rKey}`);
        if (!mapProduccionRango[rKey]) {
          mapProduccionRango[rKey] = {
            rango_uuid: a.rango_uuid || rKey,
            rango_id: rKey,
            rango_nombre: rNom,
            maquinasCount: 0,
            maquinasSet: new Set(),
            billetero: 0,
            montoAportes: 0,
            montoDevoluciones: 0,
            aportesNeto: 0,
            produccion: 0
          };
        }
        const val = parseFloat(a.monto) || 0;
        if ((a.tipo || 'Aporte') === 'Devolución') {
          mapProduccionRango[rKey].montoDevoluciones += val;
          mapProduccionRango[rKey].aportesNeto -= val;
        } else {
          mapProduccionRango[rKey].montoAportes += val;
          mapProduccionRango[rKey].aportesNeto += val;
        }
      }

      // D) Asignar conteo real de máquinas por rango
      for (const item of Object.values(mapProduccionRango)) {
        const countByUuid = item.rango_uuid ? mapTotalMaquinasPorRangoUuid[String(item.rango_uuid)] : 0;
        const countByNom = item.rango_nombre ? mapTotalMaquinasPorRangoNombre[item.rango_nombre.trim().toLowerCase()] : 0;
        item.maquinasCount = countByUuid || countByNom || (item.maquinasSet ? item.maquinasSet.size : 0) || 0;
      }

      // E) Calcular producción neta y ordenar alfabéticamente
      produccionPorRango = Object.values(mapProduccionRango)
        .filter(item => item.maquinasCount > 0 || item.billetero !== 0 || item.aportesNeto !== 0)
        .map(item => ({
          ...item,
          produccion: (item.billetero + item.montoDevoluciones) - item.montoAportes
        })).sort((a, b) => 
          (a.rango_nombre || '').localeCompare(b.rango_nombre || '', undefined, { numeric: true, sensitivity: 'base' })
        );
    }

    const produccionTotales = {
      totalMaquinas: produccionPorRango.reduce((acc, r) => acc + (r.maquinasCount || 0), 0),
      totalBilletero: produccionPorRango.reduce((acc, r) => acc + r.billetero, 0),
      totalAportesNeto: produccionPorRango.reduce((acc, r) => acc + r.aportesNeto, 0),
      totalProduccion: produccionPorRango.reduce((acc, r) => acc + r.produccion, 0)
    };

    // Producción de máquinas: ((billetero + devoluciones) - aportes)
    const produccionMaquinas = (conteoTotales.grandTotal + aportesTotales.totalDevoluciones) - aportesTotales.totalAportes;
    const produccionClientes = dataClientesGlobal.totales.balanceNeto || 0;
    const produccionFinal = produccionMesas + produccionMaquinas + produccionClientes;
    const totalIngresosBrutos = dropTotales.grandTotal + conteoTotales.grandTotal + dataClientesGlobal.totales.totalCompras;

    // Numeración dinámica de secciones (empieza desde Resumen Producción)
    const hasResumenMesas = Boolean((drop_mesas && drop_mesas.length > 0) || (arqueoMesaGroups && arqueoMesaGroups.length > 0));
    const hasResumenMaquinas = Boolean((sortedConteoList && sortedConteoList.length > 0) || (sortedAportesList && sortedAportesList.length > 0));
    const hasClientes = Boolean(sortedControlClientes && sortedControlClientes.length > 0);
    const hasResumenProduccion = Boolean(hasResumenMesas || hasResumenMaquinas || hasClientes);

    let idxSeccion = 0;
    const numResumenProduccion = hasResumenProduccion ? ++idxSeccion : 0;

    // Mesas (unifica Drop y Faltantes y Sobrantes)
    const hasDropMesas = Boolean(drop_mesas && drop_mesas.length > 0);
    const hasArqueoFichas = Boolean(arqueoMesaGroups && arqueoMesaGroups.length > 0);
    const hasMesas = Boolean(hasDropMesas || hasArqueoFichas);
    const numMesas = hasMesas ? ++idxSeccion : 0;

    // Novedades de Mesas
    const hasNovedadesMesas = Boolean(novedades_mesas && novedades_mesas.length > 0);
    const numNovedadesMesas = hasNovedadesMesas ? ++idxSeccion : 0;

    // Billetero
    const hasBilleteros = Boolean((sortedConteoList && sortedConteoList.length > 0) || (conteoPorRango && conteoPorRango.length > 0));
    const numBilleteros = hasBilleteros ? ++idxSeccion : 0;

    // Aportes y Devoluciones
    const hasAportes = Boolean((sortedAportesList && sortedAportesList.length > 0) || (aportesPorRango && aportesPorRango.length > 0) || (aportesPorEmpleado && aportesPorEmpleado.length > 0));
    const numAportes = hasAportes ? ++idxSeccion : 0;

    // Compras y Pagos (Control de Clientes)
    const numClientes = hasClientes ? ++idxSeccion : 0;

    // Incidencias
    const incidenciasActivas = incidenciasPorTipo.filter(cat => cat.items && cat.items.length > 0);
    const hasBitacoraIncidencias = Boolean(sortedIncidencias && sortedIncidencias.length > 0 && incidenciasActivas && incidenciasActivas.length > 0);
    const numBitacoraIncidencias = hasBitacoraIncidencias ? ++idxSeccion : 0;

    const hasControlLlaves = Boolean(sortedControlLlaves && sortedControlLlaves.length > 0);
    const numControlLlaves = hasControlLlaves ? ++idxSeccion : 0;

    const numeracion = {
      hasResumenMesas,
      hasResumenMaquinas,
      numResumenProduccion,
      hasMesas,
      numMesas,
      numNovedadesMesas,
      numBilleteros,
      numAportes,
      hasClientes,
      numClientes,
      numBitacoraIncidencias,
      numControlLlaves
    };

    return {
      datos,
      activeHorarios: getActiveHorarios(datos),
      hasResumenMesas,
      hasResumenMaquinas,
      numeracion,
      drop_mesas,
      dropTotales,
      arqueo_fichas: rawArqueo,
      arqueoSalaFichas,
      arqueoMesaGroups,
      totalArqueoApertura,
      totalArqueoCierre,
      totalArqueoDiferencia,
      totalArqueoFaltantes,
      totalArqueoSobrantes,
      novedades_mesas,
      incidencias_generales: sortedIncidencias,
      incidenciasPorTipo,
      incidenciasActivas: incidenciasPorTipo.filter(cat => cat.items && cat.items.length > 0),
      control_llaves: sortedControlLlaves,
      llavesTotales,
      control_clientes: sortedControlClientes,
      clientesMesas: dataClientesMesas,
      clientesMaquinas: dataClientesMaquinas,
      clientesTotales,
      clientesPorMetodo,
      totalesPorMetodo,
      clientesPorJugador,
      totalesPorJugador,
      produccionMesas,
      produccionMaquinas,
      produccionClientes,
      produccionFinal,
      totalIngresosBrutos,
      produccionTotal: produccionFinal,
      aportes: sortedAportesList,
      aportesTotales,
      aportesPorRango,
      aportesPorEmpleado,
      conteo_maquinas: sortedConteoList,
      conteoTotales,
      conteoPorRango,
      produccionPorRango,
      produccionTotales
    };
  }

  // Estructura de secciones a renderizar en el reporte
  $: renderedSections = (() => {
    if (subsalasList && subsalasList.length > 0) {
      return subsalasList.map(subsala => ({
        subsala,
        subData: computeSubsalaReport(subsala.uuid, resumenData)
      }));
    }
    return [{
      subsala: null,
      subData: computeSubsalaReport(null, resumenData)
    }];
  })();

  // Operadores de turno al pie de reporte (toma de los datos del libro o de la primera subsección)
  $: mainOperadorA = (() => {
    if (resumenData.datos?.operador_turno_a && resumenData.datos.operador_turno_a.trim()) {
      return resumenData.datos.operador_turno_a;
    }
    const allD = resumenData.all_datos || [];
    const found = allD.find(d => d.operador_turno_a && d.operador_turno_a.trim());
    return found ? found.operador_turno_a : "—";
  })();

  $: mainOperadorC = (() => {
    if (resumenData.datos?.operador_turno_c && resumenData.datos.operador_turno_c.trim()) {
      return resumenData.datos.operador_turno_c;
    }
    const allD = resumenData.all_datos || [];
    const found = allD.find(d => d.operador_turno_c && d.operador_turno_c.trim());
    return found ? found.operador_turno_c : "—";
  })();

  // Formatear montos en dólares
  function formatMoney(n) {
    if (n == null || isNaN(n)) return "$0";
    const num = Number(n);
    if (num < 0) {
      return (
        "-$" +
        Math.abs(num).toLocaleString("en-US", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        })
      );
    }
    return (
      "$" +
      num.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })
    );
  }

  // Copiar enlace al portapapeles
  async function handleCompartir() {
    const id = libroId || libro?.uuid || libro?.id || activeLibro?.uuid || activeLibro?.id || resumenData.libro?.uuid || resumenData.libro?.id;
    if (!id) return;
    const shareUrl = getPublicWebUrl(`/#/reportes/cecom/libro/${id}`);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const input = document.createElement("input");
        input.value = shareUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }
      triggerToast(
        `Enlace copiado al portapapeles: /#/reportes/cecom/libro/${id}`,
        "success",
      );
    } catch (e) {
      prompt("Copia el enlace del reporte:", shareUrl);
    }
  }

  function handleImprimir() {
    window.print();
  }

  async function handleDescargarPdf() {
    if (isGeneratingPdf) return;
    isGeneratingPdf = true;

    const id =
      libroId ||
      libro?.id ||
      activeLibro?.id ||
      resumenData.libro?.id ||
      "CECOM";
    const fechaClean = (dateParts?.formatted || "reporte")
      .replace(/[\/\s:]+/g, "-")
      .replace(/[^a-zA-Z0-9_-]/g, "");
    const fileName = `Reporte_CECOM_Libro_${id}_${fechaClean}.pdf`;

    triggerToast("Preparando descarga del PDF...", "info");

    try {
      const targetElement =
        sheetContainerElement ||
        document.querySelector(".official-sheet-container");

      if (!targetElement) {
        throw new Error("No se encontró el contenedor de la hoja oficial");
      }

      // Captura de alta resolución con html2canvas
      const canvas = await html2canvas(targetElement, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
        logging: false,
        onclone: (clonedDoc, clonedElement) => {
          clonedElement.style.animation = "none";
          clonedElement.style.transition = "none";
          clonedElement.style.transform = "none";
          clonedElement.style.boxShadow = "none";
          clonedElement.style.border = "none";
          clonedElement.style.margin = "0";
          clonedElement.style.width = "100%";
          const allAnim = clonedElement.querySelectorAll("*");
          allAnim.forEach((el) => {
            el.style.animation = "none";
            el.style.transition = "none";
          });
        },
      });

      // Dimensiones de hoja estándar A4 en milímetros
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth(); // 210 mm
      const pdfHeight = pdf.internal.pageSize.getHeight(); // 297 mm
      const margin = 8; // 8 mm de margen
      const printWidth = pdfWidth - margin * 2; // 194 mm
      const printHeight = pdfHeight - margin * 2; // 281 mm

      // Conversión de pixeles de canvas a mm
      const pxToMm = printWidth / canvas.width;
      const totalHeightMm = canvas.height * pxToMm;

      if (totalHeightMm <= printHeight) {
        // Entra perfectamente en 1 página
        const imgData = canvas.toDataURL("image/jpeg", 0.95);
        pdf.addImage(
          imgData,
          "JPEG",
          margin,
          margin,
          printWidth,
          totalHeightMm,
        );
      } else {
        // Multi-página: segmentar canvas respetando la altura imprimible por hoja
        const sliceHeightPx = Math.floor(printHeight / pxToMm);
        let yOffset = 0;
        let pageNum = 0;

        while (yOffset < canvas.height) {
          const currentSliceHeight = Math.min(
            sliceHeightPx,
            canvas.height - yOffset,
          );

          const pageCanvas = document.createElement("canvas");
          pageCanvas.width = canvas.width;
          pageCanvas.height = currentSliceHeight;
          const pageCtx = pageCanvas.getContext("2d");

          pageCtx.fillStyle = "#ffffff";
          pageCtx.fillRect(0, 0, pageCanvas.width, currentSliceHeight);

          pageCtx.drawImage(
            canvas,
            0,
            yOffset,
            canvas.width,
            currentSliceHeight,
            0,
            0,
            canvas.width,
            currentSliceHeight,
          );

          const pageImgData = pageCanvas.toDataURL("image/jpeg", 0.95);
          const currentSliceHeightMm = currentSliceHeight * pxToMm;

          if (pageNum > 0) {
            pdf.addPage();
          }

          pdf.addImage(
            pageImgData,
            "JPEG",
            margin,
            margin,
            printWidth,
            currentSliceHeightMm,
          );

          yOffset += currentSliceHeight;
          pageNum++;
        }
      }

      // Convertir a blob y descargar universalmente
      const pdfBlob = pdf.output("blob");
      await saveOrShareFile({
        blob: pdfBlob,
        fileName,
        dialogTitle: "Descargar Reporte PDF CECOM",
        mimeType: "application/pdf",
      });

      triggerToast("PDF descargado con éxito.", "success");
    } catch (err) {
      console.error("[PDF] Error al generar archivo PDF:", err);
      triggerToast(
        "No se pudo generar PDF directo. Abriendo diálogo de impresión...",
        "warning",
      );
      window.print();
    } finally {
      isGeneratingPdf = false;
    }
  }
</script>

<div
  class="resumen-reporte-wrapper {isPublic
    ? 'is-public-mode'
    : 'is-internal-mode'}"
>
  {#if !isPublic}
    <!-- ============================================================
         TARJETA SUPERIOR "RESUMEN LIBRO" (Conforme a la foto compartida)
         ============================================================ -->
    <div class="resumen-overview-card no-print">
      <!-- Fila 1: Cabecera con Icono, Título y Botones -->
      <div class="overview-header-row">
        <div class="header-titles-group">
          <div class="overview-icon-container">
            <svg class="icon-svg-action" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"></line>
              <line x1="12" y1="20" x2="12" y2="4"></line>
              <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
          </div>
          <div class="overview-title-box">
            <h2 class="overview-title">Resumen Libro</h2>
            <p class="overview-subtitle">
              Consolidado general y auditoría • <span class="meta-highlight"
                >{salaNombre}</span
              >
              ({dateParts.formatted})
              {#if updatedAt}
                <span class="meta-sep">•</span>
                <span class="meta-updated"
                  >Última sinc: {formatDateTimeDisplay(updatedAt)}</span
                >
              {/if}
            </p>
          </div>
        </div>

        <div class="header-actions-group">
          <!-- 1. ACTUALIZAR REPORTE -->
          <button
            type="button"
            class="btn-action-primary {reporteExists
              ? 'btn-actualizar'
              : 'btn-generar'}"
            on:click={handleGenerarOActualizarReporte}
            disabled={isSyncing || isGeneratingPdf}
            title={reporteExists
              ? "Actualizar y sincronizar snapshot en tabla libro_reporte"
              : "Generar y consolidar reporte en tabla libro_reporte"}
          >
            {#if isSyncing}
              <span class="btn-spinner"></span>
              <span>{reporteExists ? "Actualizando..." : "Generando..."}</span>
            {:else if reporteExists}
              <span>Actualizar Reporte</span>
            {:else}
              <span>Generar Reporte</span>
            {/if}
          </button>

          <!-- 2. COMPARTIR -->
          <button
            type="button"
            class="btn-action-share"
            on:click={handleCompartir}
            disabled={isGeneratingPdf}
            title="Abrir vista de compartir y copiar enlace al portapapeles"
          >
            <span>Compartir</span>
          </button>

          <!-- 3. PDF -->
          <button
            type="button"
            class="btn-action-pdf"
            on:click={handleDescargarPdf}
            disabled={isGeneratingPdf || isSyncing}
            title="Bajar reporte consolidado a PDF"
          >
            {#if isGeneratingPdf}
              <span class="btn-spinner"></span>
              <span>Generando...</span>
            {:else}
              <span>PDF</span>
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if isLoading}
    <div class="report-state-card loading">
      <div class="report-spinner"></div>
      <p>Cargando información consolidada desde libro_reporte...</p>
    </div>
  {:else if loadError}
    <div class="report-state-card error">
      <h3>Error al generar reporte</h3>
      <p>{loadError}</p>
      <button
        type="button"
        class="btn-retry"
        on:click={() => loadFullResumen(libroId || libro?.id)}
        >Reintentar</button
      >
    </div>
  {:else}
    <div class="official-sheet-container" bind:this={sheetContainerElement}>
      <!-- ============================================================
           ENCABEZADO: SALA Y FECHA (Sin las 5 estrellas del logo)
           ============================================================ -->
      <div class="sheet-header">
        <div class="casino-logo-box">
          <span class="logo-main-text">{salaNombre.toUpperCase()}</span>
          <span class="logo-sub-text"
            >CENTRO DE CONTROL Y MONITOREO (CECOM)</span
          >
        </div>

        <div class="sheet-date-box">
          <table class="date-matrix-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>{dateParts.day}</th>
                <th>{dateParts.month}</th>
                <th>{dateParts.year}</th>
              </tr>
            </thead>
          </table>
        </div>
      </div>

      <!-- ============================================================
           PRODUCCIÓN GLOBAL (Consolidado General de Multisalas)
           ============================================================ -->
      {#if isMultisala && renderedSections.length > 0}
        <div class="multisala-header-summary">
          <div class="quick-kpi-grid">
            {#each renderedSections as sec}
              {@const prod = sec.subData?.produccionFinal || 0}
              <div class="kpi-card {prod > 0 ? 'kpi-card-positive' : (prod < 0 ? 'kpi-card-negative' : '')}">
                <span class="kpi-label">{sec.subsala ? sec.subsala.nombre.toUpperCase() : 'SALA'}</span>
                <span class="kpi-value {prod > 0 ? 'text-emerald font-bold' : (prod < 0 ? 'text-rose font-bold' : 'font-bold')}">
                  {formatMoney(Math.abs(prod))}
                </span>
              </div>
            {/each}
            {#if renderedSections.length > 1}
              {@const grandTotalMultisala = renderedSections.reduce((acc, sec) => acc + (sec.subData?.produccionFinal || 0), 0)}
              <div class="kpi-card {grandTotalMultisala > 0 ? 'kpi-card-positive' : (grandTotalMultisala < 0 ? 'kpi-card-negative' : '')}">
                <span class="kpi-label">TOTAL</span>
                <span class="kpi-value {grandTotalMultisala > 0 ? 'text-emerald font-bold' : (grandTotalMultisala < 0 ? 'text-rose font-bold' : 'font-bold')}">
                  {formatMoney(Math.abs(grandTotalMultisala))}
                </span>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- ============================================================
           SECCIONES OPERATIVAS (AGRUPADAS POR SALA HIJA SI ES MULTISALAS)
           ============================================================ -->
      {#each renderedSections as section (section.subsala?.uuid || 'root')}
        {@const secOpA = (section.subData.datos?.operador_turno_a && section.subData.datos.operador_turno_a.trim()) ? section.subData.datos.operador_turno_a : (section.subsala ? "—" : mainOperadorA)}
        {@const secOpC = (section.subData.datos?.operador_turno_c && section.subData.datos.operador_turno_c.trim()) ? section.subData.datos.operador_turno_c : (section.subsala ? "—" : mainOperadorC)}
        <div class="subsala-section-block">
          {#if section.subsala}
            <div class="subsala-report-header">
              <h2 class="subsala-report-title">{section.subsala.nombre}</h2>
            </div>
          {/if}

          <!-- ============================================================
               1. INFORMACIÓN DE SALA (Horarios Operativos Oficiales)
               ============================================================ -->
          <!-- ============================================================
               1. RESUMEN DE APERTURAS Y CIERRES (Horarios Operativos)
               ============================================================ -->
          {#if section.subData.activeHorarios.length > 0}
            <div class="sheet-section official-incidencias-block first-section">
              <div class="horarios-section">
                <div class="horarios-list">
                  {#each section.subData.activeHorarios as h, hIdx}
                    <div class="horario-item">
                      <div class="horario-label-group">
                        <span class="item-num">{hIdx + 1}.</span>
                        <span class="item-label">{h.label}</span>
                      </div>
                      <div class="item-values">
                        <span class="h-pair">
                          <span class="h-text">h inicio:</span>
                          <span class="h-val"
                            >{h.inicio && h.inicio.trim() && h.inicio.trim() !== "—" ? h.inicio : "—"}</span
                          >
                        </span>
                        <span class="h-pair">
                          <span class="h-text">h cierre:</span>
                          <span class="h-val"
                            >{h.fin && h.fin.trim() && h.fin.trim() !== "—" ? h.fin : "—"}</span
                          >
                        </span>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          {/if}

          <!-- ============================================================
               RESUMEN PRODUCCIÓN (Selector de Pestañas: Total, Mesas, Máquinas)
               ============================================================ -->
          {#if section.subData.hasResumenMesas || section.subData.hasResumenMaquinas || section.subData.hasClientes}
            <div class="sheet-section sub-module-section">
              <div class="sub-header-row">
                <div class="sub-title-group">
                  <h2 class="sub-section-title">
                    {section.subData.numeracion.numResumenProduccion}. Resumen Producción
                  </h2>
                  <div class="tab-toggle-group">
                    <button
                      type="button"
                      class="tab-toggle-btn"
                      class:active={tabResumenProd === 'total'}
                      on:click={() => (tabResumenProd = 'total')}
                    >
                      Total
                    </button>
                    {#if section.subData.hasResumenMesas}
                      <button
                        type="button"
                        class="tab-toggle-btn"
                        class:active={tabResumenProd === 'mesas'}
                        on:click={() => (tabResumenProd = 'mesas')}
                      >
                        Mesas
                      </button>
                    {/if}
                    {#if section.subData.hasResumenMaquinas}
                      <button
                        type="button"
                        class="tab-toggle-btn"
                        class:active={tabResumenProd === 'maquinas'}
                        on:click={() => (tabResumenProd = 'maquinas')}
                      >
                        Máquinas
                      </button>
                    {/if}
                    {#if section.subData.hasClientes}
                      <button
                        type="button"
                        class="tab-toggle-btn"
                        class:active={tabResumenProd === 'clientes'}
                        on:click={() => (tabResumenProd = 'clientes')}
                      >
                        Compras y Pagos
                      </button>
                    {/if}
                  </div>
                </div>

                {#if tabResumenProd === 'mesas'}
                  {#if section.subData.drop_mesas && section.subData.drop_mesas.length > 0}
                    <span class="sub-count-badge">
                      {section.subData.drop_mesas.length} {section.subData.drop_mesas.length === 1 ? 'mesa' : 'mesas'}
                    </span>
                  {:else if section.subData.arqueoMesaGroups && section.subData.arqueoMesaGroups.length > 0}
                    <span class="sub-count-badge">
                      {section.subData.arqueoMesaGroups.length} {section.subData.arqueoMesaGroups.length === 1 ? 'mesa' : 'mesas'}
                    </span>
                  {/if}
                {:else if tabResumenProd === 'maquinas'}
                  {#if section.subData.conteo_maquinas && section.subData.conteo_maquinas.length > 0}
                    <span class="sub-count-badge">
                      {section.subData.conteo_maquinas.length} {section.subData.conteo_maquinas.length === 1 ? 'máquina' : 'máquinas'}
                    </span>
                  {/if}
                {:else if tabResumenProd === 'clientes'}
                  {#if section.subData.control_clientes && section.subData.control_clientes.length > 0}
                    <span class="sub-count-badge">
                      {section.subData.control_clientes.length} {section.subData.control_clientes.length === 1 ? 'operación' : 'operaciones'}
                    </span>
                  {/if}
                {/if}
              </div>

              {#if tabResumenProd === 'mesas'}
                <!-- Indicadores de rendimiento de Mesas -->
                <div class="quick-kpi-grid">
                  <div class="kpi-card">
                    <span class="kpi-label">DROP</span>
                    <span class="kpi-value {section.subData.dropTotales.grandTotal > 0 ? 'text-emerald' : ''}"
                      >{formatMoney(section.subData.dropTotales.grandTotal)}</span
                    >
                  </div>
                  <div class="kpi-card">
                    <div class="kpi-subinfo-row">
                      <span class="subinfo-item">FALTANTES: <span class="subinfo-val text-rose font-bold">( {formatMoney(section.subData.totalArqueoFaltantes)} )</span></span>
                      <span class="subinfo-item">SOBRANTES: <span class="subinfo-val text-emerald font-bold">( {formatMoney(section.subData.totalArqueoSobrantes)} )</span></span>
                    </div>
                    <span
                      class="kpi-value {section.subData.totalArqueoDiferencia > 0
                        ? 'text-emerald'
                        : (section.subData.totalArqueoDiferencia < 0 ? 'text-rose' : '')}"
                    >
                      {formatMoney(Math.abs(section.subData.totalArqueoDiferencia))}
                    </span>
                  </div>
                  <div class="kpi-card {section.subData.produccionMesas > 0 ? 'kpi-card-positive' : (section.subData.produccionMesas < 0 ? 'kpi-card-negative' : '')}">
                    <span class="kpi-label">PRODUCCIÓN</span>
                    <span
                      class="kpi-value {section.subData.produccionMesas > 0
                        ? 'text-emerald font-bold'
                        : (section.subData.produccionMesas < 0 ? 'text-rose font-bold' : 'font-bold')}"
                    >
                      {formatMoney(Math.abs(section.subData.produccionMesas))}
                    </span>
                  </div>
                </div>
              {:else if tabResumenProd === 'maquinas'}
                <!-- Indicadores de rendimiento de Máquinas -->
                <div class="quick-kpi-grid">
                  <div class="kpi-card">
                    <span class="kpi-label">BILLETERO</span>
                    <span class="kpi-value {section.subData.conteoTotales.grandTotal > 0 ? 'text-emerald' : ''}"
                      >{formatMoney(section.subData.conteoTotales.grandTotal)}</span
                    >
                  </div>
                  <div class="kpi-card">
                    <div class="kpi-subinfo-row">
                      <span class="subinfo-item">APORTES: <span class="subinfo-val text-rose font-bold">( {formatMoney(section.subData.aportesTotales.totalAportes)} )</span></span>
                      <span class="subinfo-item">DEVOLUCIONES: <span class="subinfo-val text-emerald font-bold">( {formatMoney(section.subData.aportesTotales.totalDevoluciones)} )</span></span>
                    </div>
                    <span
                      class="kpi-value {section.subData.aportesTotales.netoMonto < 0
                        ? 'text-emerald'
                        : (section.subData.aportesTotales.netoMonto > 0 ? 'text-rose' : '')}"
                    >
                      {formatMoney(Math.abs(section.subData.aportesTotales.netoMonto))}
                    </span>
                  </div>
                  <div class="kpi-card {section.subData.produccionMaquinas > 0 ? 'kpi-card-positive' : (section.subData.produccionMaquinas < 0 ? 'kpi-card-negative' : '')}">
                    <span class="kpi-label">PRODUCCIÓN</span>
                    <span
                      class="kpi-value {section.subData.produccionMaquinas > 0
                        ? 'text-emerald font-bold'
                        : (section.subData.produccionMaquinas < 0 ? 'text-rose font-bold' : 'font-bold')}"
                    >
                      {formatMoney(Math.abs(section.subData.produccionMaquinas))}
                    </span>
                  </div>
                </div>
              {:else if tabResumenProd === 'clientes'}
                <!-- Indicadores de rendimiento de Compras y Pagos -->
                <div class="quick-kpi-grid">
                  <div class="kpi-card">
                    <span class="kpi-label">COMPRAS</span>
                    <span class="kpi-value text-emerald font-bold">
                      {formatMoney(section.subData.clientesTotales?.totalCompras || 0)}
                    </span>
                  </div>
                  <div class="kpi-card">
                    <span class="kpi-label">PAGOS</span>
                    <span class="kpi-value text-rose font-bold">
                      {formatMoney(section.subData.clientesTotales?.totalPagos || 0)}
                    </span>
                  </div>
                  <div class="kpi-card {section.subData.produccionClientes > 0 ? 'kpi-card-positive' : (section.subData.produccionClientes < 0 ? 'kpi-card-negative' : '')}">
                    <span class="kpi-label">PRODUCCIÓN</span>
                    <span
                      class="kpi-value {section.subData.produccionClientes > 0
                        ? 'text-emerald font-bold'
                        : (section.subData.produccionClientes < 0 ? 'text-rose font-bold' : 'font-bold')}"
                    >
                      {formatMoney(Math.abs(section.subData.produccionClientes))}
                    </span>
                  </div>
                </div>
              {:else}
                <!-- Indicadores consolidados de producción (Total) -->
                <div class="quick-kpi-grid">
                  {#if section.subData.hasResumenMesas}
                    <div class="kpi-card">
                      <span class="kpi-label">MESAS</span>
                      <span
                        class="kpi-value {section.subData.produccionMesas > 0
                          ? 'text-emerald font-bold'
                          : (section.subData.produccionMesas < 0 ? 'text-rose font-bold' : 'font-bold')}"
                      >
                        {formatMoney(Math.abs(section.subData.produccionMesas))}
                      </span>
                    </div>
                  {/if}
                  {#if section.subData.hasResumenMaquinas}
                    <div class="kpi-card">
                      <span class="kpi-label">MÁQUINAS</span>
                      <span
                        class="kpi-value {section.subData.produccionMaquinas > 0
                          ? 'text-emerald font-bold'
                          : (section.subData.produccionMaquinas < 0 ? 'text-rose font-bold' : 'font-bold')}"
                      >
                        {formatMoney(Math.abs(section.subData.produccionMaquinas))}
                      </span>
                    </div>
                  {/if}
                  <div class="kpi-card">
                    <div class="kpi-subinfo-row">
                      <span class="subinfo-item">PAGOS: <span class="subinfo-val text-rose font-bold">( {formatMoney(section.subData.clientesTotales?.totalPagos || 0)} )</span></span>
                      <span class="subinfo-item">COMPRAS: <span class="subinfo-val text-emerald font-bold">( {formatMoney(section.subData.clientesTotales?.totalCompras || 0)} )</span></span>
                    </div>
                    <span
                      class="kpi-value {section.subData.produccionClientes > 0
                        ? 'text-emerald font-bold'
                        : (section.subData.produccionClientes < 0 ? 'text-rose font-bold' : 'font-bold')}"
                    >
                      {formatMoney(Math.abs(section.subData.produccionClientes))}
                    </span>
                  </div>
                  <div class="kpi-card {section.subData.produccionFinal > 0 ? 'kpi-card-positive' : (section.subData.produccionFinal < 0 ? 'kpi-card-negative' : '')}">
                    <span class="kpi-label">PRODUCCIÓN</span>
                    <span
                      class="kpi-value {section.subData.produccionFinal > 0
                        ? 'text-emerald font-bold'
                        : (section.subData.produccionFinal < 0 ? 'text-rose font-bold' : 'font-bold')}"
                    >
                      {formatMoney(Math.abs(section.subData.produccionFinal))}
                    </span>
                  </div>
                </div>
              {/if}
            </div>
          {/if}

          <!-- ============================================================
               MESAS (Drop y Faltantes y Sobrantes con Selector de Pestañas)
               ============================================================ -->
          {#if (section.subData.drop_mesas && section.subData.drop_mesas.length > 0) || (section.subData.arqueoMesaGroups && section.subData.arqueoMesaGroups.length > 0)}
            <div class="sheet-section sub-module-section">
              <div class="sub-header-row">
                <div class="sub-title-group">
                  <h2 class="sub-section-title">
                    {section.subData.numeracion.numMesas}. Mesas
                  </h2>
                  <div class="tab-toggle-group">
                    <button
                      type="button"
                      class="tab-toggle-btn"
                      class:active={tabMesa === 'drop'}
                      on:click={() => (tabMesa = 'drop')}
                    >
                      Drop
                    </button>
                    <button
                      type="button"
                      class="tab-toggle-btn"
                      class:active={tabMesa === 'faltantes'}
                      on:click={() => (tabMesa = 'faltantes')}
                    >
                      Faltantes y Sobrantes
                    </button>
                  </div>
                </div>

                {#if tabMesa === 'faltantes' && section.subData.arqueoMesaGroups && section.subData.arqueoMesaGroups.length > 0}
                  <span class="sub-count-badge">
                    {section.subData.arqueoMesaGroups?.length || 0} {section.subData.arqueoMesaGroups?.length === 1 ? 'mesa registrada' : 'mesas registradas'}
                  </span>
                {:else}
                  <span class="sub-count-badge">
                    {section.subData.drop_mesas?.length || 0} {section.subData.drop_mesas?.length === 1 ? 'mesa registrada' : 'mesas registradas'}
                  </span>
                {/if}
              </div>

              {#if tabMesa === 'faltantes' && section.subData.arqueoMesaGroups && section.subData.arqueoMesaGroups.length > 0}
                <!-- Tabla: Faltantes y Sobrantes -->
                <div class="table-responsive-wrapper">
                  <table class="sheet-detail-table arqueo-table">
                    <thead>
                      <tr>
                        <th class="th-mesa">MESA</th>
                        {#each section.subData.arqueoSalaFichas as valor}
                          <th class="th-center">$ {valor}</th>
                        {/each}
                        <th class="th-center th-total">TOTAL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each section.subData.arqueoMesaGroups as group, idx (group.mesaId)}
                        {@const apTotal = Number(group.apertura?.total) || 0}
                        {@const hasCierre = Boolean(group.cierre)}
                        {@const ciTotal = hasCierre ? (Number(group.cierre.total) || 0) : null}
                        {@const difTotal = hasCierre ? (ciTotal - apTotal) : null}

                        <!-- Fila: DIFERENCIA / TOTAL (FALTANTES Y SOBRANTES) -->
                        <tr class="drop-row row-diferencia">
                          <td class="td-mesa">
                            <span class="mesa-main-name font-bold">{group.mesaNombre}</span>
                          </td>
                          {#each section.subData.arqueoSalaFichas as valor}
                            {@const apC = getChipCount(group.apertura, valor)}
                            {@const ciC = hasCierre ? getChipCount(group.cierre, valor) : null}
                            {@const difChips = (hasCierre && ciC !== null && apC !== null) ? (ciC - apC) : null}
                            <td class="td-center count-val">
                              {#if difChips !== null}
                                <span 
                                  class="dif-chips-val"
                                  class:dif-pos={difChips > 0}
                                  class:dif-neg={difChips < 0}
                                >
                                  {Math.abs(difChips)}
                                </span>
                              {:else}
                                <span class="val-pending">—</span>
                              {/if}
                            </td>
                          {/each}
                          <td class="td-center td-total-val dif-total-cell font-bold">
                            {#if difTotal !== null}
                              <span 
                                class="dif-monto-badge"
                                class:dif-pos={difTotal > 0}
                                class:dif-neg={difTotal < 0}
                                class:dif-neu={difTotal === 0}
                              >
                                $ {formatMoney(Math.abs(difTotal))}
                              </span>
                            {:else}
                              <span class="val-pending">—</span>
                            {/if}
                          </td>
                        </tr>
                      {/each}
                    </tbody>

                    <!-- Fila de Totales Generales -->
                    <tfoot>
                      <tr class="total-row footer-diferencia">
                        <td class="total-label-cell">TOTAL</td>
                        {#each section.subData.arqueoSalaFichas as valor}
                          {@const sumAp = section.subData.arqueoMesaGroups.reduce((acc, g) => acc + (g.cierre ? (getChipCount(g.apertura, valor) || 0) : 0), 0)}
                          {@const sumCi = section.subData.arqueoMesaGroups.reduce((acc, g) => acc + (g.cierre ? (getChipCount(g.cierre, valor) || 0) : 0), 0)}
                          {@const dif = sumCi - sumAp}
                          <td class="td-center total-val-cell">
                            <span class:dif-pos={dif > 0} class:dif-neg={dif < 0}>
                              {Math.abs(dif)}
                            </span>
                          </td>
                        {/each}
                        <td class="td-center grand-total-cell dif-grand-total">
                          <span class:dif-pos={section.subData.totalArqueoDiferencia > 0} class:dif-neg={section.subData.totalArqueoDiferencia < 0}>
                            $ {formatMoney(Math.abs(section.subData.totalArqueoDiferencia))}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              {:else}
                <!-- Tabla: Drop Mesas -->
                <div class="table-responsive-wrapper">
                  <table class="sheet-detail-table">
                    <thead>
                      <tr>
                        <th class="th-mesa">MESA</th>
                        <th class="th-num">$100</th>
                        <th class="th-num">$50</th>
                        <th class="th-num">$20</th>
                        <th class="th-num">$10</th>
                        <th class="th-num">$5</th>
                        <th class="th-num">$1</th>
                        <th class="th-total">TOTAL RECAUDADO</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each section.subData.drop_mesas as d}
                        <tr>
                          <td class="cell-mesa-bold"
                            >{d.mesa_nombre || (d.mesa_uuid ? `Mesa #${d.mesa_uuid.slice(0, 8)}` : `Mesa #${d.mesa_id}`)}</td
                          >
                          <td class="cell-num">{d.denominacion_100 ?? d.b100 ?? 0}</td>
                          <td class="cell-num">{d.denominacion_50 ?? d.b50 ?? 0}</td>
                          <td class="cell-num">{d.denominacion_20 ?? d.b20 ?? 0}</td>
                          <td class="cell-num">{d.denominacion_10 ?? d.b10 ?? 0}</td>
                          <td class="cell-num">{d.denominacion_5 ?? d.b5 ?? 0}</td>
                          <td class="cell-num">{d.denominacion_1 ?? d.b1 ?? 0}</td>
                          <td class="cell-total-money">{formatMoney(d.total)}</td>
                        </tr>
                      {/each}
                    </tbody>
                    <tfoot>
                      <tr class="tfoot-totals">
                        <td>TOTALES</td>
                        <td class="cell-num">{section.subData.dropTotales.sum100}</td>
                        <td class="cell-num">{section.subData.dropTotales.sum50}</td>
                        <td class="cell-num">{section.subData.dropTotales.sum20}</td>
                        <td class="cell-num">{section.subData.dropTotales.sum10}</td>
                        <td class="cell-num">{section.subData.dropTotales.sum5}</td>
                        <td class="cell-num">{section.subData.dropTotales.sum1}</td>
                        <td class="cell-grand-total"
                          >{formatMoney(section.subData.dropTotales.grandTotal)}</td
                        >
                      </tr>
                    </tfoot>
                  </table>
                </div>
              {/if}
            </div>
          {/if}

          <!-- Novedades de Mesas (Apertura y Cierre) si existen registros -->
          {#if section.subData.novedades_mesas && section.subData.novedades_mesas.length > 0}
            <div class="sheet-section sub-module-section">
              <div class="sub-header-row">
                <div class="sub-title-group">
                  <h2 class="sub-section-title">
                    {section.subData.numeracion.numNovedadesMesas}. Novedades de Mesas (Apertura y Cierre)
                  </h2>
                  <span class="sub-count-badge"
                    >{section.subData.novedades_mesas.length} {section.subData.novedades_mesas.length === 1 ? 'registro' : 'registros'}</span
                  >
                </div>
              </div>

              <div class="mesas-section">
                <div class="table-responsive-wrapper">
                  <table class="sheet-official-table">
                    <thead>
                      <tr>
                        <th class="th-hora-a">HORA<br />A</th>
                        <th class="th-mesa">MESA</th>
                        <th class="th-pitboss">PITBOSS</th>
                        <th class="th-croupier">CROUPIER<br />APERTURA</th>
                        <th class="th-croupier">CROUPIER<br />CIERRE</th>
                        <th class="th-hora-c">HORA<br />C</th>
                        <th class="th-obs">OBSERVACIÓN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each section.subData.novedades_mesas as nov}
                        <tr>
                          <td class="cell-center">{nov.hora_apertura || "—"}</td>
                          <td class="cell-mesa-name"
                            >{nov.mesa_nombre || (nov.mesa_uuid ? `Mesa #${nov.mesa_uuid.slice(0, 8)}` : `Mesa #${nov.mesa_id}`)}</td
                          >
                          <td class="cell-left">{nov.pitboss || "—"}</td>
                          <td class="cell-left">{nov.croupier_apertura || "—"}</td>
                          <td class="cell-left">{nov.croupier_cierre || "—"}</td>
                          <td class="cell-center">{nov.hora_cierre || "—"}</td>
                          <td class="cell-left cell-obs">{nov.observacion || "—"}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          {/if}





          <!-- ============================================================
               BILLETERO (Conteo de Máquinas y Resumen por Rango)
               ============================================================ -->
          {#if (section.subData.conteo_maquinas && section.subData.conteo_maquinas.length > 0) || (section.subData.conteoPorRango && section.subData.conteoPorRango.length > 0)}
            <div class="sheet-section sub-module-section">
              <div class="sub-header-row">
                <div class="sub-title-group">
                  <h2 class="sub-section-title">
                    {section.subData.numeracion.numBilleteros}. Billetero
                  </h2>
                  <div class="tab-toggle-group">
                    <button
                      type="button"
                      class="tab-toggle-btn"
                      class:active={tabBilletero === 'rangos'}
                      on:click={() => (tabBilletero = 'rangos')}
                    >
                      Rangos
                    </button>
                    <button
                      type="button"
                      class="tab-toggle-btn"
                      class:active={tabBilletero === 'detallado'}
                      on:click={() => (tabBilletero = 'detallado')}
                    >
                      Detallado
                    </button>
                  </div>
                </div>

                {#if tabBilletero === 'rangos'}
                  <span class="sub-count-badge">
                    {section.subData.conteoPorRango?.length || 0} {section.subData.conteoPorRango?.length === 1 ? 'rango' : 'rangos'}
                  </span>
                {:else}
                  <span class="sub-count-badge">
                    {section.subData.conteo_maquinas?.length || 0} {section.subData.conteo_maquinas?.length === 1 ? 'máquina contada' : 'máquinas contadas'}
                  </span>
                {/if}
              </div>

              {#if tabBilletero === 'rangos'}
                <!-- Vista: Resumen de Conteo por Rango -->
                <div class="table-responsive-wrapper">
                  <table class="sheet-detail-table">
                    <thead>
                      <tr>
                        <th class="th-num">N°</th>
                        <th class="th-mesa">RANGO</th>
                        <th class="th-num">MÁQUINAS</th>
                        <th class="th-num">$100</th>
                        <th class="th-num">$50</th>
                        <th class="th-num">$20</th>
                        <th class="th-num">$10</th>
                        <th class="th-num">$5</th>
                        <th class="th-num">$1</th>
                        <th class="th-total">TOTAL RECAUDADO</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each section.subData.conteoPorRango as rg, rIdx}
                        <tr>
                          <td class="cell-num">{rIdx + 1}</td>
                          <td class="cell-mesa-bold">{rg.rango_nombre}</td>
                          <td class="cell-num">{rg.maquinasCount}</td>
                          <td class="cell-num">{rg.b100}</td>
                          <td class="cell-num">{rg.b50}</td>
                          <td class="cell-num">{rg.b20}</td>
                          <td class="cell-num">{rg.b10}</td>
                          <td class="cell-num">{rg.b5}</td>
                          <td class="cell-num">{rg.b1}</td>
                          <td class="cell-total-money">{formatMoney(rg.total)}</td>
                        </tr>
                      {/each}
                    </tbody>
                    <tfoot>
                      <tr class="tfoot-totals">
                        <td colspan="2">TOTAL GENERAL</td>
                        <td class="cell-num">{section.subData.conteoTotales.totalMaquinas}</td>
                        <td class="cell-num">{section.subData.conteoTotales.sum100}</td>
                        <td class="cell-num">{section.subData.conteoTotales.sum50}</td>
                        <td class="cell-num">{section.subData.conteoTotales.sum20}</td>
                        <td class="cell-num">{section.subData.conteoTotales.sum10}</td>
                        <td class="cell-num">{section.subData.conteoTotales.sum5}</td>
                        <td class="cell-num">{section.subData.conteoTotales.sum1}</td>
                        <td class="cell-grand-total">{formatMoney(section.subData.conteoTotales.grandTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              {:else}
                <!-- Vista: Detallado de Billeteros por Máquina -->
                <div class="table-responsive-wrapper">
                  <table class="sheet-detail-table">
                    <thead>
                      <tr>
                        <th class="th-num">N°</th>
                        <th class="th-mesa">MÁQUINA</th>
                        <th class="th-mesa">RANGO</th>
                        <th class="th-num">$100</th>
                        <th class="th-num">$50</th>
                        <th class="th-num">$20</th>
                        <th class="th-num">$10</th>
                        <th class="th-num">$5</th>
                        <th class="th-num">$1</th>
                        <th class="th-total">TOTAL RECAUDADO</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each section.subData.conteo_maquinas as m, idx}
                        <tr>
                          <td class="cell-num">{idx + 1}</td>
                          <td class="cell-mesa-bold">{m.maquina_nombre || (m.maquina_uuid ? `Máquina #${m.maquina_uuid.slice(0, 8)}` : `Máquina #${m.maquina_id}`)}</td>
                          <td class="cell-center">
                            <span class="badge-rango-pill">{m.rango_nombre || 'Sin Rango'}</span>
                          </td>
                          <td class="cell-num">{m.denominacion_100 ?? m.b100 ?? 0}</td>
                          <td class="cell-num">{m.denominacion_50 ?? m.b50 ?? 0}</td>
                          <td class="cell-num">{m.denominacion_20 ?? m.b20 ?? 0}</td>
                          <td class="cell-num">{m.denominacion_10 ?? m.b10 ?? 0}</td>
                          <td class="cell-num">{m.denominacion_5 ?? m.b5 ?? 0}</td>
                          <td class="cell-num">{m.denominacion_1 ?? m.b1 ?? 0}</td>
                          <td class="cell-total-money">{formatMoney(m.total)}</td>
                        </tr>
                      {/each}
                    </tbody>
                    <tfoot>
                      <tr class="tfoot-totals">
                        <td colspan="3">TOTALES</td>
                        <td class="cell-num">{section.subData.conteoTotales.sum100}</td>
                        <td class="cell-num">{section.subData.conteoTotales.sum50}</td>
                        <td class="cell-num">{section.subData.conteoTotales.sum20}</td>
                        <td class="cell-num">{section.subData.conteoTotales.sum10}</td>
                        <td class="cell-num">{section.subData.conteoTotales.sum5}</td>
                        <td class="cell-num">{section.subData.conteoTotales.sum1}</td>
                        <td class="cell-grand-total">{formatMoney(section.subData.conteoTotales.grandTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              {/if}
            </div>
          {/if}

          <!-- ============================================================
               APORTES Y DEVOLUCIONES (Con Selector de Pestañas)
               ============================================================ -->
          {#if (section.subData.aportes && section.subData.aportes.length > 0) || (section.subData.aportesPorRango && section.subData.aportesPorRango.length > 0) || (section.subData.aportesPorEmpleado && section.subData.aportesPorEmpleado.length > 0)}
            <div class="sheet-section sub-module-section">
              <div class="sub-header-row">
                <div class="sub-title-group">
                  <h2 class="sub-section-title">
                    {section.subData.numeracion.numAportes}. Aportes y Devoluciones
                  </h2>
                  <div class="tab-toggle-group">
                    <button
                      type="button"
                      class="tab-toggle-btn"
                      class:active={tabAporte === 'rangos'}
                      on:click={() => (tabAporte = 'rangos')}
                    >
                      Rangos
                    </button>
                    <button
                      type="button"
                      class="tab-toggle-btn"
                      class:active={tabAporte === 'empleado'}
                      on:click={() => (tabAporte = 'empleado')}
                    >
                      Empleado
                    </button>
                    <button
                      type="button"
                      class="tab-toggle-btn"
                      class:active={tabAporte === 'detallado'}
                      on:click={() => (tabAporte = 'detallado')}
                    >
                      Detallado
                    </button>
                  </div>
                </div>

                {#if tabAporte === 'rangos'}
                  <span class="sub-count-badge">
                    {section.subData.aportesPorRango?.length || 0} {section.subData.aportesPorRango?.length === 1 ? 'rango' : 'rangos'}
                  </span>
                {:else if tabAporte === 'empleado'}
                  <span class="sub-count-badge">
                    {section.subData.aportesPorEmpleado?.length || 0} {section.subData.aportesPorEmpleado?.length === 1 ? 'empleado' : 'empleados'}
                  </span>
                {:else}
                  <span class="sub-count-badge">
                    {section.subData.aportesTotales.totalOps} {section.subData.aportesTotales.totalOps === 1 ? 'operación registrada' : 'operaciones registradas'}
                  </span>
                {/if}
              </div>

              {#if tabAporte === 'rangos'}
                <!-- Tab: Resumen por Rango -->
                <div class="table-responsive-wrapper">
                  <table class="compact-table">
                    <thead>
                      <tr>
                        <th>RANGO</th>
                        <th>OPS</th>
                        <th>APORTES</th>
                        {#if section.subData.aportesTotales.totalDevoluciones > 0}
                          <th>DEVOLUCIONES</th>
                          <th>TOTAL NETO</th>
                        {:else}
                          <th>MONTO TOTAL</th>
                        {/if}
                      </tr>
                    </thead>
                    <tbody>
                      {#each section.subData.aportesPorRango as rg}
                        <tr>
                          <td class="cell-left font-bold">{rg.rango_nombre}</td>
                          <td class="cell-center">{rg.cantidad} ops</td>
                          <td class="cell-total-money font-bold {rg.montoAportes > 0 ? 'text-rose' : ''}">{formatMoney(Math.abs(rg.montoAportes))}</td>
                          {#if section.subData.aportesTotales.totalDevoluciones > 0}
                            <td class="cell-total-money font-bold {rg.montoDevoluciones > 0 ? 'text-emerald' : ''}">{rg.montoDevoluciones > 0 ? formatMoney(Math.abs(rg.montoDevoluciones)) : '$0'}</td>
                            <td class="cell-total-money font-bold {rg.neto > 0 ? 'text-rose' : (rg.neto < 0 ? 'text-emerald' : '')}">{formatMoney(Math.abs(rg.neto))}</td>
                          {/if}
                        </tr>
                      {/each}
                    </tbody>
                    <tfoot>
                      <tr class="tfoot-totals">
                        <td>TOTAL</td>
                        <td class="cell-center">{section.subData.aportesTotales.totalOps} ops</td>
                        <td class="cell-total-money font-bold {section.subData.aportesTotales.totalAportes > 0 ? 'text-rose' : ''}">{formatMoney(Math.abs(section.subData.aportesTotales.totalAportes))}</td>
                        {#if section.subData.aportesTotales.totalDevoluciones > 0}
                          <td class="cell-total-money font-bold {section.subData.aportesTotales.totalDevoluciones > 0 ? 'text-emerald' : ''}">{formatMoney(Math.abs(section.subData.aportesTotales.totalDevoluciones))}</td>
                          <td class="cell-grand-total {section.subData.aportesTotales.netoMonto > 0 ? 'text-rose' : (section.subData.aportesTotales.netoMonto < 0 ? 'text-emerald' : '')}">{formatMoney(Math.abs(section.subData.aportesTotales.netoMonto))}</td>
                        {/if}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              {:else if tabAporte === 'empleado'}
                <!-- Tab: Resumen por Empleado -->
                <div class="table-responsive-wrapper">
                  <table class="compact-table">
                    <thead>
                      <tr>
                        <th>EMPLEADO</th>
                        <th>CARGO</th>
                        <th>OPS</th>
                        <th>APORTES</th>
                        {#if section.subData.aportesTotales.totalDevoluciones > 0}
                          <th>DEVOLUCIONES</th>
                          <th>TOTAL NETO</th>
                        {:else}
                          <th>MONTO TOTAL</th>
                        {/if}
                      </tr>
                    </thead>
                    <tbody>
                      {#each section.subData.aportesPorEmpleado as emp}
                        <tr>
                          <td class="cell-left font-bold">{emp.empleado_nombre}</td>
                          <td class="cell-center tag-metodo-text">{emp.cargo_nombre}</td>
                          <td class="cell-center">{emp.cantidad} ops</td>
                          <td class="cell-total-money font-bold {emp.montoAportes > 0 ? 'text-rose' : ''}">{formatMoney(Math.abs(emp.montoAportes))}</td>
                          {#if section.subData.aportesTotales.totalDevoluciones > 0}
                            <td class="cell-total-money font-bold {emp.montoDevoluciones > 0 ? 'text-emerald' : ''}">{emp.montoDevoluciones > 0 ? formatMoney(Math.abs(emp.montoDevoluciones)) : '$0'}</td>
                            <td class="cell-total-money font-bold {emp.neto > 0 ? 'text-rose' : (emp.neto < 0 ? 'text-emerald' : '')}">{formatMoney(Math.abs(emp.neto))}</td>
                          {/if}
                        </tr>
                      {/each}
                    </tbody>
                    <tfoot>
                      <tr class="tfoot-totals">
                        <td>TOTAL</td>
                        <td>—</td>
                        <td class="cell-center">{section.subData.aportesTotales.totalOps} ops</td>
                        <td class="cell-total-money font-bold {section.subData.aportesTotales.totalAportes > 0 ? 'text-rose' : ''}">{formatMoney(Math.abs(section.subData.aportesTotales.totalAportes))}</td>
                        {#if section.subData.aportesTotales.totalDevoluciones > 0}
                          <td class="cell-total-money font-bold {section.subData.aportesTotales.totalDevoluciones > 0 ? 'text-emerald' : ''}">{formatMoney(Math.abs(section.subData.aportesTotales.totalDevoluciones))}</td>
                          <td class="cell-grand-total {section.subData.aportesTotales.netoMonto > 0 ? 'text-rose' : (section.subData.aportesTotales.netoMonto < 0 ? 'text-emerald' : '')}">{formatMoney(Math.abs(section.subData.aportesTotales.netoMonto))}</td>
                        {/if}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              {:else}
                <!-- Tab: Detallado de Aportes y Devoluciones -->
                <div class="table-responsive-wrapper">
                  <table class="sheet-detail-table">
                    <thead>
                      <tr>
                        <th class="th-num">N°</th>
                        <th class="th-tipo">TIPO</th>
                        <th class="th-hora">HORA</th>
                        <th class="th-cliente">EMPLEADO</th>
                        <th class="th-metodo">CARGO</th>
                        <th class="th-tipo">RANGO</th>
                        <th class="th-total">MONTO</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each section.subData.aportes as a, idx}
                        {@const isAporte = (a.tipo || "Aporte") === "Aporte"}
                        <tr>
                          <td class="cell-center">{idx + 1}</td>
                          <td class="cell-center">
                            <span class="tag-tipo {isAporte ? 'tag-aporte' : 'tag-devolucion'}">
                              {isAporte ? 'Aporte' : 'Devolución'}
                            </span>
                          </td>
                          <td class="cell-center">{a.hora || (a.created_at ? new Date(a.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '—')}</td>
                          <td class="cell-client-name font-bold">{a.empleado_nombre || "—"}</td>
                          <td class="cell-center tag-metodo-text">{a.cargo_nombre || "—"}</td>
                          <td class="cell-center">
                            <span class="tag-tipo tag-rango">
                              {a.rango_nombre || (a.rango_uuid ? `Rango #${a.rango_uuid.slice(0, 8)}` : `Rango #${a.rango_id}`)}
                            </span>
                          </td>
                          <td class="cell-total-money font-bold {a.monto > 0 ? (isAporte ? 'text-rose' : 'text-emerald') : ''}">
                            {formatMoney(Math.abs(a.monto))}
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                    <tfoot>
                      <tr class="tfoot-totals">
                        <td colspan="6">TOTAL</td>
                        <td class="cell-grand-total {section.subData.aportesTotales.netoMonto > 0 ? 'text-rose' : (section.subData.aportesTotales.netoMonto < 0 ? 'text-emerald' : '')}">
                          {formatMoney(Math.abs(section.subData.aportesTotales.netoMonto))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              {/if}
            </div>
          {/if}

          <!-- ============================================================
               COMPRAS Y PAGOS (Control de Clientes con Selector de Pestañas)
               ============================================================ -->
          {#if section.subData.control_clientes && section.subData.control_clientes.length > 0}
            <div class="sheet-section sub-module-section">
              <div class="sub-header-row">
                <div class="sub-title-group">
                  <h2 class="sub-section-title">
                    {section.subData.numeracion.numClientes}. Compras y Pagos
                  </h2>
                  <div class="tab-toggle-group">
                    <button
                      type="button"
                      class="tab-toggle-btn"
                      class:active={tabCliente === 'jugador'}
                      on:click={() => (tabCliente = 'jugador')}
                    >
                      Cliente / Jugador
                    </button>
                    <button
                      type="button"
                      class="tab-toggle-btn"
                      class:active={tabCliente === 'metodo'}
                      on:click={() => (tabCliente = 'metodo')}
                    >
                      Método de Pago
                    </button>
                    <button
                      type="button"
                      class="tab-toggle-btn"
                      class:active={tabCliente === 'detallado'}
                      on:click={() => (tabCliente = 'detallado')}
                    >
                      Detallado
                    </button>
                  </div>
                </div>

                {#if tabCliente === 'jugador'}
                  <span class="sub-count-badge">
                    {section.subData.clientesPorJugador?.length || 0} {section.subData.clientesPorJugador?.length === 1 ? 'cliente' : 'clientes'}
                  </span>
                {:else if tabCliente === 'metodo'}
                  <span class="sub-count-badge">
                    {section.subData.clientesPorMetodo?.length || 0} {section.subData.clientesPorMetodo?.length === 1 ? 'método' : 'métodos'}
                  </span>
                {:else}
                  <span class="sub-count-badge">
                    {section.subData.clientesTotales.totalOps} transacciones
                  </span>
                {/if}
              </div>

              {#if tabCliente === 'jugador'}
                <!-- Tab: Resumen por Cliente / Jugador -->
                <div class="table-responsive-wrapper">
                  <table class="compact-table">
                    <thead>
                      <tr>
                        <th>CLIENTE</th>
                        <th>OPS</th>
                        <th>COMPRAS</th>
                        <th>PAGOS</th>
                        <th>BALANCE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each section.subData.clientesPorJugador as cl}
                        <tr>
                          <td class="cell-left font-bold">{cl.cliente}</td>
                          <td class="cell-center">{cl.ops}</td>
                          <td class="cell-total-money font-bold {cl.compras > 0 ? 'text-emerald' : ''}">{formatMoney(Math.abs(cl.compras))}</td>
                          <td class="cell-total-money font-bold {cl.pagos > 0 ? 'text-rose' : ''}">{formatMoney(Math.abs(cl.pagos))}</td>
                          <td
                            class="cell-total-money font-bold {cl.balance > 0
                              ? 'text-emerald'
                              : (cl.balance < 0 ? 'text-rose' : '')}"
                          >
                            {formatMoney(Math.abs(cl.balance))}
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                    <tfoot>
                      <tr class="tfoot-totals">
                        <td>TOTAL</td>
                        <td class="cell-center">{section.subData.totalesPorJugador.ops}</td>
                        <td class="cell-total-money font-bold {section.subData.totalesPorJugador.compras > 0 ? 'text-emerald' : ''}"
                          >{formatMoney(Math.abs(section.subData.totalesPorJugador.compras))}</td
                        >
                        <td class="cell-total-money font-bold {section.subData.totalesPorJugador.pagos > 0 ? 'text-rose' : ''}"
                          >{formatMoney(Math.abs(section.subData.totalesPorJugador.pagos))}</td
                        >
                        <td class="cell-grand-total {section.subData.totalesPorJugador.balance > 0 ? 'text-emerald' : (section.subData.totalesPorJugador.balance < 0 ? 'text-rose' : '')}"
                          >{formatMoney(Math.abs(section.subData.totalesPorJugador.balance))}</td
                        >
                      </tr>
                    </tfoot>
                  </table>
                </div>
              {:else if tabCliente === 'metodo'}
                <!-- Tab: Resumen por Método de Pago -->
                <div class="table-responsive-wrapper">
                  <table class="compact-table">
                    <thead>
                      <tr>
                        <th>MÉTODO</th>
                        <th>OPS</th>
                        <th>COMPRAS</th>
                        <th>PAGOS</th>
                        <th>BALANCE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each section.subData.clientesPorMetodo as m}
                        <tr>
                          <td class="cell-left font-bold">
                            <span
                              class="tag-metodo-badge"
                              style="{getMetodoBadgeStyle(m.metodo, m.color)}"
                            >
                              {m.metodo}
                            </span>
                          </td>
                          <td class="cell-center">{m.ops}</td>
                          <td class="cell-total-money font-bold {m.compras > 0 ? 'text-emerald' : ''}">{formatMoney(Math.abs(m.compras))}</td>
                          <td class="cell-total-money font-bold {m.pagos > 0 ? 'text-rose' : ''}">{formatMoney(Math.abs(m.pagos))}</td>
                          <td
                            class="cell-total-money font-bold {m.balance > 0
                              ? 'text-emerald'
                              : (m.balance < 0 ? 'text-rose' : '')}"
                          >
                            {formatMoney(Math.abs(m.balance))}
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                    <tfoot>
                      <tr class="tfoot-totals">
                        <td>TOTAL</td>
                        <td class="cell-center">{section.subData.totalesPorMetodo.ops}</td>
                        <td class="cell-total-money font-bold {section.subData.totalesPorMetodo.compras > 0 ? 'text-emerald' : ''}"
                          >{formatMoney(Math.abs(section.subData.totalesPorMetodo.compras))}</td
                        >
                        <td class="cell-total-money font-bold {section.subData.totalesPorMetodo.pagos > 0 ? 'text-rose' : ''}"
                          >{formatMoney(Math.abs(section.subData.totalesPorMetodo.pagos))}</td
                        >
                        <td class="cell-grand-total {section.subData.totalesPorMetodo.balance > 0 ? 'text-emerald' : (section.subData.totalesPorMetodo.balance < 0 ? 'text-rose' : '')}"
                          >{formatMoney(Math.abs(section.subData.totalesPorMetodo.balance))}</td
                        >
                      </tr>
                    </tfoot>
                  </table>
                </div>
              {:else}
                <!-- Tab: Detallado de Operaciones -->
                <div class="table-responsive-wrapper">
                  <table class="sheet-detail-table">
                    <thead>
                      <tr>
                        <th class="th-num">N°</th>
                        <th class="th-hora">HORA</th>
                        <th class="th-cliente">CLIENTE / JUGADOR</th>
                        <th class="th-tipo">TIPO</th>
                        <th class="th-metodo">MÉTODO</th>
                        <th class="th-nota">NOTA</th>
                        <th class="th-total">MONTO</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each section.subData.control_clientes as c, idx}
                        {@const isCompra = (c.tipo || "").toLowerCase() === "compra"}
                        <tr>
                          <td class="cell-center">{idx + 1}</td>
                          <td class="cell-center">{c.hora || "—"}</td>
                          <td class="cell-client-name">{c.cliente || "—"}</td>
                          <td class="cell-center">
                            <span
                              class="tag-tipo {isCompra ? 'tag-compra' : 'tag-pago'}"
                            >
                              {c.tipo || "Compra"}
                            </span>
                          </td>
                          <td class="cell-center">
                            <span
                              class="tag-metodo-badge"
                              style="{getMetodoBadgeStyle(c.metodo, c.metodo_color)}"
                            >
                              {c.metodo || "General"}
                            </span>
                          </td>
                          <td class="cell-nota tag-nota-text" title={c.nota || ""}>
                            {c.nota ? c.nota : "—"}
                          </td>
                          <td class="cell-total-money font-bold {c.monto > 0 ? (isCompra ? 'text-emerald' : 'text-rose') : ''}">
                            {formatMoney(Math.abs(c.monto))}
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                    <tfoot>
                      <tr class="tfoot-totals">
                        <td colspan="6">BALANCE NETO (COMPRAS - PAGOS)</td>
                        <td class="cell-grand-total {section.subData.clientesTotales.balanceNeto > 0 ? 'text-emerald' : (section.subData.clientesTotales.balanceNeto < 0 ? 'text-rose' : '')}">
                          {formatMoney(Math.abs(section.subData.clientesTotales.balanceNeto))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              {/if}
            </div>
          {/if}



          <!-- ============================================================
               BITÁCORA DE INCIDENCIAS
               ============================================================ -->
          {#if section.subData.incidencias_generales && section.subData.incidencias_generales.length > 0 && section.subData.incidenciasActivas && section.subData.incidenciasActivas.length > 0}
            <div class="sheet-section sub-module-section">
              <div class="sub-header-row">
                <div class="sub-title-group">
                  <h2 class="sub-section-title">
                    {section.subData.numeracion.numBitacoraIncidencias}. Bitácora de Incidencias
                  </h2>
                  <span class="sub-count-badge"
                    >{section.subData.incidencias_generales.length} {section.subData.incidencias_generales.length === 1 ? 'reporte en total' : 'reportes en total'}</span
                  >
                </div>
              </div>

              <div class="incidencias-bloque-tres">
                {#each section.subData.incidenciasActivas as cat (cat.uuid || cat.id)}
                  <div class="incidencia-subbloque">
                    <div class="incidencia-subbloque-header">
                      <h3 class="incidencia-subbloque-title">
                        <span>{cat.nombre}</span>
                      </h3>
                      <span class="incidencia-badge">{cat.items.length}</span>
                    </div>
                    <div class="incidencia-subbloque-content">
                      {#each cat.items as inc}
                        {@const parsed = parseIncidenciaContent(
                          inc.descripcion,
                          inc.hora,
                        )}
                        <div class="incidencia-item-card">
                          <div class="inc-item-title-bold">{parsed.title}</div>
                          {#if parsed.items && parsed.items.length > 0}
                            <ul class="inc-subitems-list">
                              {#each parsed.items as subItem}
                                <li>{subItem}</li>
                              {/each}
                            </ul>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Bitácora de Control de Llaves (si tiene registros) -->
          {#if section.subData.control_llaves && section.subData.control_llaves.length > 0}
            <div class="sheet-section sub-module-section">
              <div class="sub-header-row">
                <div class="sub-title-group">
                  <h2 class="sub-section-title">
                    {section.subData.numeracion.numControlLlaves}. Bitácora de Control de Llaves
                  </h2>
                  <span class="sub-count-badge">{section.subData.llavesTotales.total} {section.subData.llavesTotales.total === 1 ? 'registro' : 'registros'}</span>
                </div>
                <div class="badges-status-group">
                  <span class="badge-kpi-pill active"
                    >En Custodia: <b>{section.subData.llavesTotales.enCustodia}</b></span
                  >
                  <span class="badge-kpi-pill success"
                    >Devueltas: <b>{section.subData.llavesTotales.devueltas}</b></span
                  >
                </div>
              </div>

              <div class="table-responsive-wrapper">
                <table class="sheet-detail-table">
                  <thead>
                    <tr>
                      <th class="th-num">N°</th>
                      <th class="th-llave">LLAVES</th>
                      <th class="th-desc">DESCRIPCIÓN / MOTIVO</th>
                      <th class="th-hora">HORA SALIDA</th>
                      <th class="th-hora">HORA RECEPCIÓN</th>
                      <th class="th-estado">ESTADO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each section.subData.control_llaves as k, idx}
                      {@const isDevuelta = Boolean(
                        k.hora_recepcion && k.hora_recepcion.trim(),
                      )}
                      {@const llavesTexto =
                        k.llaves_detalle && k.llaves_detalle.length > 0
                          ? k.llaves_detalle.map((l) => l.nombre).join(", ")
                          : k.llave_nombre ||
                            (k.llaves_ids ? `${k.llaves_ids.length} llaves` : "—")}
                      <tr>
                        <td class="cell-center">{idx + 1}</td>
                        <td class="cell-llave-bold">{llavesTexto}</td>
                        <td class="cell-left">{k.descripcion || "General"}</td>
                        <td class="cell-center">{k.hora_salida || "—"}</td>
                        <td class="cell-center">{k.hora_recepcion || "—"}</td>
                        <td class="cell-center">
                          {#if isDevuelta}
                            <span class="tag-status tag-success">Devuelta</span>
                          {:else}
                            <span class="tag-status tag-warning">En Custodia</span>
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {/if}

          <!-- ============================================================
               9. OPERADORES CECOM (APERTURA Y CIERRE) Y AUDITORÍA
               ============================================================ -->
          <div class="sheet-section sub-module-section operadores-final-section">
            <div class="operadores-section-box">
              <span class="op-main-title">OPERADORES CECOM{#if section.subsala} ({section.subsala.nombre.toUpperCase()}){/if}:</span>
              <div class="op-line">
                <span class="op-label">TURNO A (APERTURA):</span>
                <span class="op-names"
                  >NOMBRES: {secOpA}</span
                >
              </div>
              <div class="op-line">
                <span class="op-label">TURNO C (CIERRE):</span>
                <span class="op-names"
                  >NOMBRES: {secOpC}</span
                >
              </div>
            </div>

            <!-- Firmas Oficiales de Auditoría -->
            <div class="sheet-footer-signatures">
              <div class="signature-box">
                <div class="sign-line"></div>
                <span class="sign-title">Operador CECOM (Turno A - Apertura)</span>
                <span class="sign-name"
                  >{secOpA && secOpA !== "—" && secOpA !== "-" ? secOpA : "Firma y Huella"}</span
                >
              </div>

              <div class="signature-box">
                <div class="sign-line"></div>
                <span class="sign-title">Operador CECOM (Turno C - Cierre)</span>
                <span class="sign-name"
                  >{secOpC && secOpC !== "—" && secOpC !== "-" ? secOpC : "Firma y Huella"}</span
                >
              </div>

              <div class="signature-box">
                <div class="sign-line"></div>
                <span class="sign-title">Supervisión / Auditoría de Sala</span>
                <span class="sign-name">Firma y Sello Oficial</span>
              </div>
            </div>

            <div class="sheet-bottom-note">
              Documento oficial {section.subsala ? `(${section.subsala.nombre})` : 'consolidado'} emitido por el Sistema WISI.
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* Contenedor general */
  .resumen-reporte-wrapper {
    width: 100%;
    min-height: 100vh;
    box-sizing: border-box;
    font-family: Arial, Helvetica, sans-serif;
  }

  .resumen-reporte-wrapper.is-public-mode {
    background-color: #f1f5f9;
    padding: 24px 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .resumen-reporte-wrapper.is-internal-mode {
    padding: 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
  }

  /* ============================================================
     TARJETA SUPERIOR "RESUMEN LIBRO" (Conforme a la imagen del usuario)
     ============================================================ */
  .resumen-overview-card {
    width: 100%;
    max-width: 100%;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    padding: 24px 28px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04);
    margin-bottom: 20px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }

  .overview-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
  }

  .header-titles-group {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .overview-icon-container {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    flex-shrink: 0;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.02);
  }

  .overview-title-box {
    display: flex;
    flex-direction: column;
  }

  .overview-title {
    font-size: 1.35rem;
    font-weight: 800;
    color: #0f172a;
    margin: 0;
    line-height: 1.2;
    letter-spacing: -0.2px;
  }

  .overview-subtitle {
    font-size: 0.85rem;
    color: #64748b;
    margin: 4px 0 0 0;
  }

  .header-actions-group {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  /* Botón Compartir al lado de Actualizar Reporte */
  .btn-action-share {
    background: #0284c7;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    padding: 10px 18px;
    font-size: 0.95rem;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 4px 12px rgba(2, 132, 199, 0.25);
    transition: all 0.15s ease;
  }
  .btn-action-share:hover {
    background: #0369a1;
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(2, 132, 199, 0.32);
  }

  /* Botón Principal (Generar / Actualizar Reporte) */
  .btn-action-primary {
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    padding: 10px 22px;
    font-size: 0.95rem;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.28);
    transition: all 0.15s ease;
  }
  .btn-action-primary:hover:not(:disabled) {
    background: #1d4ed8;
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);
  }
  .btn-action-primary:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  /* Botón PDF (Bajar reporte consolidado a PDF) */
  .btn-action-pdf {
    background: #dc2626;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    padding: 10px 18px;
    font-size: 0.95rem;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 4px 12px rgba(220, 38, 38, 0.25);
    transition: all 0.15s ease;
  }
  .btn-action-pdf:hover:not(:disabled) {
    background: #b91c1c;
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(220, 38, 38, 0.35);
  }
  .btn-action-pdf:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .pdf-icon {
    font-size: 1rem;
    line-height: 1;
  }

  .btn-action-secondary {
    background: #f8fafc;
    color: #334155;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 9px 14px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: all 0.15s ease;
  }
  .btn-action-secondary:hover {
    background: #f1f5f9;
    border-color: #94a3b8;
  }
  .btn-action-secondary.btn-icon-only {
    padding: 9px 11px;
  }

  .btn-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.35);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }

  /* Sub-tarjeta: Resumen Consolidado del Libro */
  .consolidado-banner-card {
    background: #f8fafc;
    border: 1px solid #f1f5f9;
    border-radius: 12px;
    padding: 14px 20px;
    margin-top: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }

  .consolidado-banner-title {
    font-size: 1.05rem;
    font-weight: 800;
    color: #0f172a;
    margin: 0;
  }

  .consolidado-banner-meta {
    font-size: 0.85rem;
    color: #64748b;
    margin: 4px 0 0 0;
  }

  .meta-highlight {
    font-weight: 700;
    color: #1e293b;
  }

  .meta-sep {
    margin: 0 6px;
    color: #cbd5e1;
  }

  .meta-updated {
    font-size: 0.8rem;
    color: #059669;
    font-weight: 600;
  }

  .badge-status {
    font-size: 0.75rem;
    font-weight: 800;
    letter-spacing: 0.5px;
    padding: 4px 12px;
    border-radius: 9999px;
    display: inline-flex;
    align-items: center;
  }

  .badge-en-curso {
    background: #dcfce7;
    color: #15803d;
  }

  .badge-sin-generar {
    background: #fef3c7;
    color: #92400e;
  }

  /* Grid de las 6 subvistas */
  .subvistas-cards-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-top: 20px;
  }

  @media (max-width: 1024px) {
    .subvistas-cards-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 600px) {
    .subvistas-cards-grid {
      grid-template-columns: 1fr;
    }
  }

  .subvista-metric-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .subvista-metric-card:hover {
    border-color: #93c5fd;
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.08);
    transform: translateY(-1px);
  }

  .metric-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .metric-icon {
    font-size: 1.1rem;
  }

  .metric-title {
    font-size: 0.95rem;
    font-weight: 800;
    color: #0f172a;
  }

  .metric-bottom {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.85rem;
  }

  .metric-count {
    color: #64748b;
    font-weight: 500;
  }

  .metric-link {
    color: #2563eb;
    font-weight: 700;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: color 0.15s ease;
  }

  .metric-link:hover {
    color: #1d4ed8;
    text-decoration: underline;
  }

  /* Barra de herramientas superior para modo público */
  .report-tools-bar {
    width: 100%;
    max-width: 100%;
    background: #1e293b;
    color: #ffffff;
    padding: 10px 18px;
    border-radius: 8px;
    margin-bottom: 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
  }

  .tools-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .report-tag {
    font-size: 13.5px;
    font-weight: 800;
    letter-spacing: 0.2px;
  }

  .public-badge {
    background: #10b981;
    color: #ffffff;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 12px;
  }

  .libro-badge {
    background: rgba(255, 255, 255, 0.15);
    color: #cbd5e1;
    font-size: 12px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .date-badge {
    background: #2563eb;
    color: #ffffff;
    font-size: 11.5px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
    font-family: monospace;
  }

  .tools-center {
    display: flex;
    align-items: center;
  }

  .view-switch-btns {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .btn-switch {
    background: rgba(255, 255, 255, 0.1);
    color: #e2e8f0;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 5px;
    padding: 5px 10px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-switch:hover,
  .btn-switch.active {
    background: #2563eb;
    color: #ffffff;
    border-color: #3b82f6;
  }

  .tools-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-tool {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    border: none;
    transition: all 0.15s ease;
  }

  .btn-sync {
    background: #4f46e5;
    color: #ffffff;
  }
  .btn-sync:hover:not(:disabled) {
    background: #4338ca;
  }
  .btn-sync:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-print {
    background: #10b981;
    color: #ffffff;
  }
  .btn-print:hover {
    background: #059669;
  }

  .btn-refresh {
    background: rgba(255, 255, 255, 0.15);
    color: #ffffff;
    padding: 6px 10px;
  }
  .btn-refresh:hover {
    background: rgba(255, 255, 255, 0.25);
  }

  /* Estados de carga y error */
  .report-state-card {
    width: 100%;
    max-width: 600px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 40px;
    text-align: center;
    margin: 40px auto;
  }

  .report-spinner {
    width: 36px;
    height: 36px;
    border: 3px solid #cbd5e1;
    border-top-color: #2563eb;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 16px;
  }

  .btn-retry {
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    font-weight: 700;
    cursor: pointer;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ─────────────────────────────────────────────────────────────
     HOJA OFICIAL DEL CASINO (Estilo documento físico de las fotos)
     ───────────────────────────────────────────────────────────── */
  .official-sheet-container {
    width: 100%;
    max-width: 100%;
    background: #ffffff;
    border: 1px solid #d1d5db;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    padding: 36px 44px;
    box-sizing: border-box;
    border-radius: 4px;
    color: #000000;
  }

  /* Encabezado del documento (Sin estrellas) */
  .sheet-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 20px;
    border-bottom: 2px solid #0f172a;
    padding-bottom: 12px;
  }

  .subsala-section-block {
    display: flex;
    flex-direction: column;
    width: 100%;
    margin-bottom: 32px;
    padding-bottom: 24px;
    border-bottom: 2px dashed #cbd5e1;
  }

  .subsala-section-block:last-child {
    margin-bottom: 12px;
    padding-bottom: 0;
    border-bottom: none;
  }

  .subsala-report-header {
    width: 100%;
    margin: 0 0 14px 0;
    padding: 12px 18px;
    background: #1c2247;
    border-radius: 6px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .subsala-report-title {
    margin: 0;
    font-size: 18px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #ffffff;
  }

  .casino-logo-box {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .logo-main-text {
    font-size: 26px;
    font-weight: 900;
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    letter-spacing: -0.3px;
    color: #0f172a;
    line-height: 1.1;
  }

  .logo-sub-text {
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 1.5px;
    color: #475569;
  }

  .sheet-date-box {
    display: flex;
  }

  .date-matrix-table {
    border-collapse: collapse;
    border: 2px solid #000000;
    font-size: 13px;
    font-weight: 800;
  }

  .date-matrix-table th {
    border: 1px solid #000000;
    padding: 5px 12px;
    text-align: center;
    background: #f8fafc;
  }

  /* Producción Global Multisala en el encabezado */
  .multisala-header-summary {
    margin: 0 0 20px 0;
  }

  /* Título principal */
  .sheet-main-title-box {
    text-align: center;
    margin: 20px 0 12px;
    border-bottom: 2.5px solid #2563eb;
    padding-bottom: 6px;
  }

  .sheet-main-title-box.first-title-box {
    margin-top: 6px;
  }

  .sheet-main-title-box + .sub-module-section {
    border-top: none !important;
    margin-top: 10px;
    padding-top: 0;
  }

  .sheet-title-text {
    font-size: 20px;
    font-weight: 900;
    color: #1e40af;
    margin: 0;
    text-decoration: underline;
    letter-spacing: 0.3px;
  }

  /* Lista de Horarios Operativos */
  .horarios-section {
    margin-bottom: 6px;
    font-size: 13.5px;
    line-height: 1.4;
  }

  .horarios-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .horario-item {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .horario-item.multi-line {
    align-items: flex-start;
  }

  .horario-label-group {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    min-width: 235px;
  }

  .item-num {
    font-weight: 900;
    width: 20px;
    color: #111827;
  }

  .item-label {
    font-weight: 800;
    color: #111827;
    min-width: 200px;
  }

  .item-values {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }

  .h-pair {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    white-space: nowrap;
  }

  .h-text {
    font-style: italic;
    color: #374151;
    font-size: 13px;
  }

  .h-val {
    font-weight: 800;
    color: #000000;
    min-width: 48px;
    border-bottom: 1px dotted #9ca3af;
  }

  .h-val-none {
    color: #64748b;
    font-style: italic;
    font-size: 12px;
  }

  .h-val.highlight-money {
    color: #15803d;
    font-size: 14px;
    font-weight: 900;
  }

  /* Desglose de mercancía en item 4 */
  .mercancia-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  .mercancia-sublist {
    padding-left: 28px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .mercancia-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mercancia-title-line {
    font-size: 13px;
  }

  .m-title-bold {
    font-weight: 800;
    color: #0f172a;
  }

  .mercancia-items-block {
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .mercancia-sub-item {
    font-size: 12.5px;
    color: #1e293b;
    line-height: 1.35;
  }

  /* Responsive wrapper genérico para tablas */
  .table-responsive-wrapper {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    margin-bottom: 8px;
  }

  /* Tabla Oficial de Mesas */
  .sheet-official-table {
    width: 100%;
    border-collapse: collapse;
    border: 1px solid #6b7280;
    font-size: 12px;
    margin-bottom: 16px;
  }

  .sheet-official-table thead tr {
    background: #e5e7eb;
    color: #111827;
  }

  .sheet-official-table th {
    border: 1px solid #9ca3af;
    padding: 6px 8px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.3px;
    text-align: center;
    line-height: 1.2;
    text-transform: uppercase;
  }

  .sheet-official-table td {
    border: 1px solid #d1d5db;
    padding: 6px 8px;
    vertical-align: middle;
    color: #111827;
  }

  .th-hora-a,
  .th-hora-c {
    width: 75px;
  }
  .th-mesa {
    width: 85px;
    text-align: center;
  }
  .th-pitboss {
    width: 140px;
  }
  .th-croupier {
    width: 160px;
  }
  .th-obs {
    min-width: 120px;
  }

  .cell-center {
    text-align: center;
    font-weight: 700;
  }
  .cell-left {
    text-align: left;
  }
  .cell-mesa-name {
    text-align: center;
    font-weight: 900;
  }
  .cell-obs {
    font-weight: 700;
    font-style: italic;
  }
  .cell-empty-text {
    text-align: center;
    padding: 18px;
    color: #4b5563;
    font-style: italic;
  }

  /* Operadores CECOM */
  .operadores-section {
    margin: 12px 0 20px;
    border-top: 1px solid #000000;
    padding-top: 10px;
  }

  .operadores-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
  }

  .op-main-title {
    font-weight: 900;
    text-decoration: underline;
  }

  .op-line {
    display: flex;
    gap: 8px;
  }

  .op-label {
    font-weight: 800;
    min-width: 90px;
  }

  .op-names {
    font-weight: 700;
  }

  /* ─────────────────────────────────────────────────────────────
     SECCIONES DETALLADAS DE SUBMÓDULOS
     ───────────────────────────────────────────────────────────── */
  .sub-module-section {
    margin-top: 24px;
    border-top: 2px dashed #9ca3af;
    padding-top: 18px;
  }

  .sub-module-section.first-section {
    border-top: none;
    margin-top: 0;
    padding-top: 0;
  }

  .official-incidencias-block {
    margin-top: 10px;
    border-top: none !important;
    padding-top: 0;
  }

  .hidden-on-screen {
    display: none !important;
  }

  .sub-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 12px;
  }

  .sub-title-group {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .tab-toggle-group {
    display: inline-flex;
    align-items: center;
    background: #f1f5f9;
    padding: 3px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    gap: 3px;
  }

  .tab-toggle-btn {
    border: none;
    background: transparent;
    color: #64748b;
    font-size: 12px;
    font-weight: 700;
    padding: 4px 11px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    line-height: 1.2;
    user-select: none;
  }

  .tab-toggle-btn:hover {
    color: #0f172a;
    background: rgba(255, 255, 255, 0.6);
  }

  .tab-toggle-btn.active {
    background: #ffffff;
    color: #1e40af;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.08);
    font-weight: 800;
  }

  .sub-section-title {
    font-size: 15.5px;
    font-weight: 900;
    color: #1e3a8a;
    margin: 0;
  }

  .sub-total-badge {
    font-size: 13px;
    background: #dcfce7;
    color: #15803d;
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid #bbf7d0;
  }
  .sub-total-badge.badge-produccion-positive {
    background: #dcfce7;
    color: #15803d;
    border-color: #86efac;
  }
  .sub-total-badge.badge-produccion-negative {
    background: #fee2e2;
    color: #b91c1c;
    border-color: #fca5a5;
  }

  .sub-count-badge {
    font-size: 12px;
    background: #f1f5f9;
    color: #475569;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 700;
  }

  .badges-status-group {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .badge-kpi-pill {
    font-size: 12px;
    padding: 3px 8px;
    border-radius: 4px;
    font-weight: 600;
  }
  .badge-kpi-pill.active {
    background: #fef3c7;
    color: #b45309;
    border: 1px solid #fde68a;
  }
  .badge-kpi-pill.success {
    background: #dcfce7;
    color: #15803d;
    border: 1px solid #bbf7d0;
  }
  .badge-kpi-pill.info {
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
  }
  .badge-kpi-pill.highlight-positive {
    background: #d1fae5;
    color: #047857;
    font-weight: 800;
    border: 1px solid #a7f3d0;
  }
  .badge-kpi-pill.highlight-negative {
    background: #fee2e2;
    color: #b91c1c;
    font-weight: 800;
    border: 1px solid #fecaca;
  }

  .badge-rango-pill {
    display: inline-block;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 700;
    color: #4338ca;
    background: #eef2ff;
    border: 1px solid #c7d2fe;
    border-radius: 9999px;
  }

  /* Quick KPI Cards */
  .quick-kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 12px;
    margin-bottom: 14px;
  }

  .kpi-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .kpi-subinfo-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 10px;
    font-weight: 700;
    color: #475569;
    letter-spacing: 0.2px;
    margin-bottom: 3px;
    border-bottom: 1px dashed #e2e8f0;
    padding-bottom: 3px;
  }

  .subinfo-item {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
  }

  .subinfo-val {
    font-weight: 800;
  }

  .kpi-card.kpi-card-positive {
    background: #f0fdf4 !important;
    border: 1.5px solid #86efac !important;
  }

  .kpi-card.kpi-card-negative {
    background: #fef2f2 !important;
    border: 1.5px solid #fca5a5 !important;
  }

  .resumen-final-box {
    border: 1.5px solid #bfdbfe !important;
    background: #f8fafc;
    border-radius: 8px;
    padding: 16px;
  }

  .kpi-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: #64748b;
    letter-spacing: 0.3px;
  }

  .kpi-value {
    font-size: 15px;
    font-weight: 900;
    color: #0f172a;
  }

  .text-emerald {
    color: #059669 !important;
  }

  .empty-sub-alert {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    padding: 14px;
    border-radius: 4px;
    font-size: 13px;
    color: #64748b;
    text-align: center;
    font-style: italic;
  }

  .sheet-detail-table {
    width: 100%;
    border-collapse: collapse;
    border: 1px solid #6b7280;
    font-size: 12px;
    margin-bottom: 16px;
  }

  .sheet-detail-table thead tr {
    background: #e5e7eb;
    color: #111827;
  }

  .sheet-detail-table th {
    border: 1px solid #9ca3af;
    padding: 6px 8px;
    font-size: 11px;
    font-weight: 800;
    text-align: center;
  }

  .sheet-detail-table td {
    border: 1px solid #d1d5db;
    padding: 6px 8px;
  }

  .th-num {
    width: 45px;
    text-align: center;
  }
  .th-hora {
    width: 80px;
    text-align: center;
  }
  .th-cliente {
    width: 180px;
  }
  .th-tipo {
    width: 100px;
    text-align: center;
  }
  .th-metodo {
    width: 110px;
    text-align: center;
  }
  .th-nota {
    min-width: 130px;
    text-align: center;
  }
  .th-total {
    width: 130px;
    text-align: right;
  }
  .th-llave {
    width: 200px;
  }
  .th-estado {
    width: 110px;
    text-align: center;
  }

  .cell-num {
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .cell-mesa-bold {
    font-weight: 800;
    color: #111827;
  }
  .cell-total-money {
    text-align: right;
    font-weight: 800;
    color: #0f172a;
    font-variant-numeric: tabular-nums;
  }

  .tfoot-totals {
    background: #f3f4f6;
    font-weight: 900;
  }
  .tfoot-totals td {
    border-top: 2px solid #000000;
  }
  .cell-grand-total {
    text-align: right;
    font-size: 13px;
    font-weight: 900;
    color: #0f172a;
  }

  .cell-llave-bold {
    font-weight: 800;
    color: #1e3a8a;
  }
  .cell-client-name {
    font-weight: 700;
    color: #111827;
  }

  .tag-caja {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-block;
  }
  .tag-caja-mesas {
    background: #e0f2fe;
    color: #0369a1;
    border: 1px solid #bae6fd;
  }
  .tag-caja-maquinas {
    background: #fef3c7;
    color: #b45309;
    border: 1px solid #fde68a;
  }

  .tag-tipo {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-block;
  }
  .tag-compra {
    background: #dcfce7;
    color: #15803d;
    border: 1px solid #bbf7d0;
  }
  .tag-pago {
    background: #fee2e2;
    color: #b91c1c;
    border: 1px solid #fecaca;
  }
  .tag-aporte {
    background: #fee2e2;
    color: #b91c1c;
    border: 1px solid #fecaca;
  }
  .tag-devolucion {
    background: #dcfce7;
    color: #15803d;
    border: 1px solid #bbf7d0;
  }
  .tag-rango {
    background: #f8fafc;
    color: #334155;
    border: 1px solid #cbd5e1;
  }
  .text-danger-money {
    color: #dc2626 !important;
  }
  .tag-inc-tipo {
    background: #f1f5f9;
    color: #475569;
  }

  .tag-metodo-text {
    font-weight: 600;
    color: #475569;
  }
  .tag-metodo-badge {
    display: inline-block;
    padding: 3px 9px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    white-space: nowrap;
  }
  .cell-nota {
    font-size: 11px;
    color: #475569;
    font-style: italic;
    max-width: 220px;
    white-space: pre-wrap;
    word-break: break-word;
    text-align: left;
  }

  .tag-status {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    display: inline-block;
  }
  .tag-success {
    background: #dcfce7;
    color: #166534;
  }
  .tag-warning {
    background: #fef3c7;
    color: #92400e;
  }

  .inc-text-wrapper {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .inc-title-bold {
    font-weight: 700;
    color: #0f172a;
  }

  .inc-items-ul {
    margin: 2px 0 0 16px;
    padding: 0;
    font-size: 11.5px;
    color: #334155;
  }

  /* ─────────────────────────────────────────────────────────────
     BLOQUE DE 3: INCIDENCIAS (Mercancía, Generales, Empleados)
     ───────────────────────────────────────────────────────────── */
  .incidencias-bloque-tres {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    align-items: stretch;
    gap: 14px;
    margin-top: 12px;
  }

  @media (max-width: 900px) {
    .incidencias-bloque-tres {
      grid-template-columns: 1fr;
    }
  }

  .incidencia-subbloque {
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .incidencia-subbloque-header {
    background: #e2e8f0;
    border-bottom: 1px solid #cbd5e1;
    padding: 8px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .incidencia-subbloque-title {
    font-size: 13px;
    font-weight: 800;
    color: #0f172a;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .incidencia-badge {
    font-size: 11px;
    font-weight: 700;
    background: #ffffff;
    color: #334155;
    border: 1px solid #cbd5e1;
    padding: 2px 7px;
    border-radius: 9999px;
  }

  .incidencia-subbloque-content {
    padding: 12px;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    height: auto;
    max-height: none;
    overflow: visible;
  }

  .incidencia-item-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    padding: 8px 10px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
  }

  .inc-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }

  .inc-item-time {
    font-weight: 800;
    font-size: 11px;
    color: #1e40af;
    background: #eff6ff;
    padding: 1px 6px;
    border-radius: 3px;
  }

  .inc-item-tag {
    font-size: 10px;
    font-weight: 700;
    color: #475569;
    background: #f1f5f9;
    padding: 1px 5px;
    border-radius: 3px;
  }

  .inc-item-title-bold {
    font-weight: 700;
    color: #0f172a;
    font-size: 12px;
    line-height: 1.3;
  }

  .inc-subitems-list {
    margin: 4px 0 0 16px;
    padding: 0;
    font-size: 11px;
    color: #334155;
    line-height: 1.35;
  }

  /* ─────────────────────────────────────────────────────────────
     CLIENTES: 2 TABLITAS AGRUPADAS (Por Método y Por Jugador)
     ───────────────────────────────────────────────────────────── */
  .client-summaries-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    align-items: stretch;
    gap: 16px;
    margin-top: 16px;
  }

  @media (max-width: 900px) {
    .client-summaries-grid {
      grid-template-columns: 1fr;
    }
  }

  .summary-subtable-box {
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    overflow: hidden;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .subtable-header {
    background: #f1f5f9;
    border-bottom: 1px solid #cbd5e1;
    padding: 8px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .subtable-title {
    font-size: 12px;
    font-weight: 800;
    color: #0f172a;
    margin: 0;
  }

  .compact-table {
    width: 100%;
    border-collapse: collapse;
    border: 1px solid #6b7280;
    font-size: 12px;
    margin-bottom: 16px;
  }

  .compact-table thead tr {
    background: #e5e7eb;
    color: #111827;
  }

  .compact-table th {
    border: 1px solid #9ca3af;
    padding: 6px 8px;
    font-size: 11px;
    font-weight: 800;
    text-align: center;
    color: #111827;
    text-transform: uppercase;
  }

  .compact-table td {
    border: 1px solid #d1d5db;
    padding: 6px 8px;
    color: #111827;
    font-size: 12px;
    vertical-align: middle;
  }

  .compact-table tfoot tr {
    background: #f8fafc;
    font-weight: 900;
  }

  .compact-table tfoot td {
    border-top: 2px solid #64748b;
    border-bottom: 1px solid #9ca3af;
    padding: 6px 8px;
    font-size: 12px;
  }

  .font-bold {
    font-weight: 700;
  }

  .text-blue {
    color: #2563eb !important;
  }

  .text-rose {
    color: #e11d48 !important;
  }

  /* ─────────────────────────────────────────────────────────────
     OPERADORES CECOM FINAL
     ───────────────────────────────────────────────────────────── */
  .operadores-final-section {
    border-top: 2px solid #0f172a;
    margin-top: 30px;
    padding-top: 20px;
  }

  .operadores-section-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: #f8fafc;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    padding: 14px 18px;
    font-size: 13px;
    margin-bottom: 16px;
  }

  /* Firmas */
  .sheet-footer-signatures {
    display: flex;
    justify-content: space-between;
    margin-top: 40px;
    padding-top: 24px;
    gap: 20px;
  }

  .signature-box {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .sign-line {
    width: 80%;
    height: 1px;
    background: #000000;
    margin-bottom: 6px;
  }

  .sign-title {
    font-size: 11.5px;
    font-weight: 800;
    color: #111827;
  }

  .sign-name {
    font-size: 11px;
    color: #4b5563;
  }

  .sheet-bottom-note {
    text-align: center;
    font-size: 10px;
    color: #9ca3af;
    margin-top: 28px;
  }

  /* ─────────────────────────────────────────────────────────────
     OPTIMIZACIÓN PARA IMPRESIÓN (window.print() / PDF)
     ───────────────────────────────────────────────────────────── */
  @page {
    size: portrait;
    margin: 14mm;
  }

  @media print {
    /* 1. Reset Global de HTML y BODY */
    :global(html),
    :global(body) {
      background: #ffffff !important;
      padding: 0 !important;
      margin: 0 !important;
      height: auto !important;
      min-height: 100% !important;
      overflow: visible !important;
      overflow-x: visible !important;
      overflow-y: visible !important;
      width: 100% !important;
      font-size: 11px !important;
    }

    /* 2. Desenlazar contenedores raíz del layout para permitir paginación fluida */
    :global(#app),
    :global(.standalone-public-report),
    :global(.app-layout),
    :global(.main-wrapper),
    :global(.content-body),
    :global(.libro-trabajo-container),
    :global(.subvista-content-area) {
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      overflow: visible !important;
      overflow-x: visible !important;
      overflow-y: visible !important;
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      box-shadow: none !important;
      position: static !important;
      transform: none !important;
      background: #ffffff !important;
    }

    /* 3. Ocultar todos los elementos de navegación y herramientas */
    :global(.no-print),
    :global(.sidebar),
    :global(.sidebar-container),
    :global(.sidebar-backdrop),
    :global(.top-navbar),
    :global(.navbar),
    :global(.page-header),
    :global(.top-nav-bar),
    :global(.subvistas-tabs-wrapper),
    :global(.resumen-overview-card),
    :global(.report-tools-bar),
    :global(.offline-banner),
    :global(footer),
    .no-print {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      width: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    /* 4. Forzar visibilidad y fidelidad cromática del documento consolidado */
    .official-sheet-container,
    .official-sheet-container * {
      visibility: visible !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    .resumen-reporte-wrapper {
      display: block !important;
      padding: 0 !important;
      margin: 0 !important;
      background: #ffffff !important;
      height: auto !important;
      min-height: 0 !important;
      overflow: visible !important;
      width: 100% !important;
    }

    .official-sheet-container {
      display: block !important;
      border: 1.5px solid #0f172a !important;
      box-shadow: none !important;
      border-radius: 0 !important;
      padding: 28px 34px !important;
      margin: 0 auto !important;
      width: 100% !important;
      max-width: 100% !important;
      height: auto !important;
      min-height: 0 !important;
      background: #ffffff !important;
      overflow: visible !important;
      box-sizing: border-box !important;
      -webkit-box-decoration-break: clone !important;
      box-decoration-break: clone !important;
    }

    /* 5. Reglas de Paginación y Saltos de Hoja */
    .subsala-section-block:not(:last-child) {
      break-after: page !important;
      page-break-after: always !important;
      border-bottom: none !important;
      margin-bottom: 0 !important;
      padding-bottom: 0 !important;
    }

    .sheet-header {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
      margin-bottom: 12px !important;
    }

    .subsala-report-header {
      background: #1c2247 !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color: #ffffff !important;
      break-after: avoid !important;
      page-break-after: avoid !important;
      margin-top: 18px !important;
      margin-bottom: 10px !important;
    }

    .subsala-report-title {
      color: #ffffff !important;
      font-size: 18px !important;
    }

    .sub-module-section,
    .official-incidencias-block {
      display: block !important;
      break-inside: auto !important;
      page-break-inside: auto !important;
      overflow: visible !important;
      margin-bottom: 14px !important;
    }

    .sheet-official-table {
      width: 100% !important;
      border-collapse: collapse !important;
      break-inside: auto !important;
      page-break-inside: auto !important;
    }

    .sheet-official-table thead {
      display: table-header-group !important;
    }

    .sheet-official-table tr {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }

    .sheet-footer-signatures {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
      display: flex !important;
      flex-direction: row !important;
      justify-content: space-between !important;
      margin-top: 24px !important;
      padding-top: 10px !important;
    }

    .incidencias-bloque-tres {
      display: grid !important;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)) !important;
      gap: 12px !important;
      break-inside: auto !important;
      page-break-inside: auto !important;
      align-items: stretch !important;
    }

    .incidencia-subbloque-content {
      max-height: none !important;
      overflow: visible !important;
    }

    .client-summaries-grid {
      display: grid !important;
      grid-template-columns: repeat(2, 1fr) !important;
      gap: 12px !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
  }

  @media (max-width: 768px) {
    .official-sheet-container {
      padding: 12px 6px;
    }

    .sheet-header {
      flex-direction: column;
      gap: 12px;
    }

    /* Horarios en UNA SOLA LÍNEA en versión móvil */
    .horarios-list {
      gap: 4px;
    }

    .horario-item {
      display: flex !important;
      flex-direction: row !important;
      align-items: baseline !important;
      justify-content: space-between !important;
      flex-wrap: nowrap !important;
      gap: 4px !important;
      padding: 3px 0 !important;
      border-bottom: 1px dotted #e2e8f0;
      width: 100% !important;
      overflow: hidden !important;
    }

    .horario-item:last-child {
      border-bottom: none;
    }

    .horario-label-group {
      display: inline-flex !important;
      align-items: baseline !important;
      gap: 3px !important;
      min-width: 0 !important;
      flex: 1 1 auto !important;
      overflow: hidden !important;
      white-space: nowrap !important;
    }

    .item-num {
      font-size: 11px !important;
      width: 14px !important;
      flex-shrink: 0 !important;
    }

    .item-label {
      font-size: 11.5px !important;
      min-width: 0 !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }

    .item-values {
      display: inline-flex !important;
      align-items: baseline !important;
      gap: 6px !important;
      flex-shrink: 0 !important;
      padding-left: 4px !important;
      white-space: nowrap !important;
      flex-wrap: nowrap !important;
    }

    .h-pair {
      display: inline-flex !important;
      align-items: baseline !important;
      gap: 2px !important;
      white-space: nowrap !important;
    }

    .h-text {
      font-size: 10px !important;
    }

    .h-val {
      font-size: 10.5px !important;
      min-width: 34px !important;
      text-align: center !important;
    }

    /* Tabla completa de Novedades de Mesas (7 columnas ajustadas para móvil con fuente reducida) */
    .sheet-official-table {
      font-size: 10px !important;
      margin-bottom: 10px !important;
      width: 100% !important;
    }

    .sheet-official-table th {
      padding: 4px 2px !important;
      font-size: 9px !important;
      line-height: 1.1 !important;
      letter-spacing: 0 !important;
    }

    .sheet-official-table td {
      padding: 3px 2px !important;
      font-size: 9.5px !important;
    }

    .sheet-official-table .th-hora-a,
    .sheet-official-table .th-hora-c {
      width: 44px !important;
      min-width: 38px !important;
    }

    .sheet-official-table .th-mesa {
      width: 65px !important;
      min-width: 50px !important;
    }

    .sheet-official-table .th-pitboss {
      width: 75px !important;
      min-width: 60px !important;
    }

    .sheet-official-table .th-croupier {
      width: 70px !important;
      min-width: 55px !important;
    }

    .sheet-official-table .th-obs {
      min-width: 60px !important;
    }

    .cell-obs {
      font-size: 9px !important;
    }

    .sheet-footer-signatures {
      flex-direction: column;
      gap: 24px;
    }

    .sign-line {
      width: 100%;
    }
  }

  /* ============================================================
     TABLA DE ARQUEO DE FICHAS EN RESUMEN DE LIBRO
     ============================================================ */
  .drop-table.arqueo-table,
  .sheet-detail-table.arqueo-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    text-align: left;
    border: 1px solid #6b7280;
    margin-bottom: 16px;
  }

  .drop-table.arqueo-table thead tr,
  .sheet-detail-table.arqueo-table thead tr {
    background: #e5e7eb;
    color: #111827;
  }

  .drop-table.arqueo-table th,
  .sheet-detail-table.arqueo-table th {
    padding: 6px 8px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.3px;
    white-space: nowrap;
    border: 1px solid #9ca3af;
    color: #111827;
    text-align: center;
    text-transform: uppercase;
  }

  .drop-table.arqueo-table td,
  .sheet-detail-table.arqueo-table td {
    padding: 6px 8px;
    color: #111827;
    font-size: 12px;
    white-space: nowrap;
    vertical-align: middle;
    border: 1px solid #d1d5db;
  }

  .drop-table.arqueo-table .th-center,
  .drop-table.arqueo-table .td-center,
  .sheet-detail-table.arqueo-table .th-center,
  .sheet-detail-table.arqueo-table .td-center {
    text-align: center;
  }

  .drop-table.arqueo-table .th-num,
  .drop-table.arqueo-table .td-num,
  .sheet-detail-table.arqueo-table .th-num,
  .sheet-detail-table.arqueo-table .td-num {
    width: 45px;
  }

  .drop-table.arqueo-table .th-mesa,
  .drop-table.arqueo-table .td-mesa,
  .sheet-detail-table.arqueo-table .th-mesa,
  .sheet-detail-table.arqueo-table .td-mesa {
    min-width: 170px;
    text-align: left;
    padding-left: 10px;
  }

  .drop-table.arqueo-table .th-movimiento,
  .drop-table.arqueo-table .td-movimiento,
  .sheet-detail-table.arqueo-table .th-movimiento,
  .sheet-detail-table.arqueo-table .td-movimiento {
    width: 45px;
  }

  .drop-table.arqueo-table .th-total,
  .sheet-detail-table.arqueo-table .th-total {
    min-width: 110px;
    text-align: center;
  }

  .mesa-title-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mesa-main-name {
    font-size: 13.5px;
    font-weight: 700;
    color: #0f172a;
  }

  .mesa-sub-juego {
    font-size: 11.5px;
    color: #64748b;
    font-weight: 500;
  }

  .index-num {
    font-weight: 700;
    color: #475569;
  }

  .row-apertura {
    background: #ffffff;
  }

  .row-cierre {
    background: #f8fafc;
  }

  .row-diferencia {
    background: #ffffff;
  }

  .mesa-last-row {
    border-bottom: 2px solid #cbd5e1 !important;
  }

  .mov-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    font-size: 11.5px;
    font-weight: 800;
  }

  .mov-apertura {
    background: #e0f2fe;
    color: #0369a1;
    border: 1px solid #bae6fd;
  }

  .mov-cierre {
    background: #ede9fe;
    color: #6d28d9;
    border: 1px solid #ddd6fe;
  }

  .mov-pendiente {
    background: #fef3c7;
    color: #b45309;
    border: 1px solid #fde68a;
  }

  .mov-diferencia {
    background: #f1f5f9;
    color: #334155;
    border: 1px solid #cbd5e1;
  }

  .count-val {
    font-weight: 600;
    color: #334155;
  }

  .val-pending {
    color: #94a3b8;
    font-weight: 400;
  }

  .ap-total-cell {
    font-weight: 700;
    color: #0369a1;
  }

  .ci-total-cell {
    font-weight: 700;
    color: #6d28d9;
  }

  .dif-total-cell {
    font-weight: 800;
  }

  .dif-chips-val {
    font-weight: 700;
    font-size: 11.5px;
  }

  .dif-chips-val.dif-pos,
  .dif-pos {
    color: #16a34a !important;
  }

  .dif-chips-val.dif-neg,
  .dif-neg {
    color: #dc2626 !important;
  }

  .dif-neu {
    color: #64748b !important;
  }

  .dif-monto-badge {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 800;
  }

  .total-row {
    background: #f8fafc;
    font-weight: 700;
  }

  .footer-apertura {
    border-top: 2px solid #94a3b8 !important;
  }

  .footer-diferencia {
    border-top: 2px solid #94a3b8 !important;
    border-bottom: 2px solid #94a3b8 !important;
    background: #f1f5f9;
  }

  .total-row td {
    padding: 8px 10px;
    font-size: 12px;
    color: #0f172a;
    border: 1px solid #cbd5e1;
  }

  .total-label-cell {
    font-weight: 800;
    letter-spacing: 0.5px;
    color: #0f172a;
    padding-left: 14px !important;
  }

  .total-val-cell {
    font-weight: 700;
    color: #0f172a;
  }

  .grand-total-cell {
    font-weight: 800;
    font-size: 13px;
  }

  .ap-grand-total {
    color: #0369a1 !important;
  }

  .ci-grand-total {
    color: #6d28d9 !important;
  }

  .dif-grand-total {
    font-weight: 800;
  }
</style>
