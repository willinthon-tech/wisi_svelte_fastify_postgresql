<script>
  import { onMount } from "svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Navbar from "./components/Navbar.svelte";
  import Toast from "./components/Toast.svelte";
  import OfflineBanner from "./components/OfflineBanner.svelte";

  // Import Standard Views
  import DashboardView from "./views/DashboardView.svelte";
  import DataTableView from "./views/DataTableView.svelte";
  import AnalyticsView from "./views/AnalyticsView.svelte";
  import SettingsView from "./views/SettingsView.svelte";
  import AuthView from "./views/AuthView.svelte";
  import MasterAdminView from "./views/MasterAdminView.svelte";
  import GlobalPhotoModal from "./components/common/GlobalPhotoModal.svelte";
  import PwaInstallPrompt from "./components/common/PwaInstallPrompt.svelte";
  import { openPhotoModal, updatePhotoModalItems, handleRealtimeAttlogInPhotoModal } from "./controllers/globalModal.store.js";

  // Import Feature Views
  import ProductsView from "./components/ProductsView.svelte";
  import CompaniesView from "./components/CompaniesView.svelte";
  import InvoiceView from "./components/InvoiceView.svelte";
  import VectorMapsView from "./components/VectorMapsView.svelte";
  import DragView from "./components/DragView.svelte";
  import ProfileView from "./components/ProfileView.svelte";
  import ComponentsView from "./components/ComponentsView.svelte";

  // Import CECOM Views
  import LibroView from "./views/cecom/LibroView.svelte";
  import LlavesView from "./views/cecom/LlavesView.svelte";
  import LlavesBorradasView from "./views/cecom/LlavesBorradasView.svelte";

  // Import RRHH Views
  import MarcajesView from "./views/rrhh/MarcajesView.svelte";
  import EmpleadosView from "./views/rrhh/EmpleadosView.svelte";
  import CargosView from "./views/rrhh/CargosView.svelte";
  import CicloDeHorarioView from "./views/rrhh/CicloDeHorarioView.svelte";
  import AreasView from "./views/rrhh/AreasView.svelte";
  import DepartamentosView from "./views/rrhh/DepartamentosView.svelte";
  import ReportesView from "./views/rrhh/ReportesView.svelte";
  import DesincorporadosView from "./views/rrhh/DesincorporadosView.svelte";
  import CarnetView from "./views/rrhh/CarnetView.svelte";
  import HorariosView from "./views/rrhh/HorariosView.svelte";
  import CumpleanosView from "./views/rrhh/CumpleanosView.svelte";
  import CalendarioView from "./views/rrhh/CalendarioView.svelte";

  // Import MAQUINAS Views
  import MaquinasView from "./views/maquinas/MaquinasView.svelte";
  import EstadosView from "./views/maquinas/EstadosView.svelte";
  import SociedadesView from "./views/maquinas/SociedadesView.svelte";
  import ValoresView from "./views/maquinas/ValoresView.svelte";
  import MaquinasJuegosView from "./views/maquinas/JuegosView.svelte";
  import MarcasView from "./views/maquinas/MarcasView.svelte";
  import ModelosView from "./views/maquinas/ModelosView.svelte";
  import TiposView from "./views/maquinas/TiposView.svelte";
  import ModosView from "./views/maquinas/ModosView.svelte";
  import LegalView from "./views/maquinas/LegalView.svelte";

  // Import MESAS EN VIVO Views
  import MesasView from "./views/mesas-en-vivo/MesasView.svelte";
  import MesasJuegosView from "./views/mesas-en-vivo/JuegosView.svelte";
  import MesasBorradasView from "./views/mesas-en-vivo/MesasBorradasView.svelte";

  // Import ESTADISTICA Views
  import ContadoresView from "./views/estadistica/ContadoresView.svelte";

  // Import Modal & Model Stores / Controllers
  import ItemModal from "./components/modals/ItemModal.svelte";
  import DeleteModal from "./components/modals/DeleteModal.svelte";
  import {
    itemsStore,
    loadItemsData,
    addNewItem,
    updateExistingItem,
    toggleItemCompleted,
    removeSingleItem,
  } from "./controllers/item.store.js";

  import {
    navMenuStore,
    loadUserSession,
    isAuthenticatedStore,
  } from "./controllers/auth.store.js";
  import {
    currentRouteStore,
    initRouter,
    isPublicRoute,
    navigateToRoute,
  } from "./controllers/router.store.js";
  import {
    loadMasterStoresFromBackend,
    userSalasStore as masterUserSalasStore,
  } from "./controllers/master.store.js";
  import {
    currentUserStore,
    userSalasStore as authUserSalasStore,
  } from "./controllers/auth.store.js";
  import { getCloudBaseUrl } from "./config/api.config.js";
  import { onDestroy } from "svelte";
  import {
    initWebSocketConnection,
    closeWebSocketConnection,
  } from "./controllers/websocket.store.js";

  import {
    activeTabStore,
    isSidebarOpenStore,
    isModalOpenStore,
    editingItemStore,
    isDeleteModalOpenStore,
    itemToDeleteStore,
    toastMessageStore,
    toastTypeStore,
    toastVisibleStore,
    triggerToast,
    openCreateModalUI,
    openEditModalUI,
    closeModalUI,
    openDeleteModalUI,
    closeDeleteModalUI,
  } from "./controllers/ui.store.js";

  import { fetchHealthModel } from "./models/health.model.js";

  $: assignedSalaIds = (function () {
    const user = $currentUserStore;
    const userId = user?.id || 1;

    if (user && Array.isArray(user.salas) && user.salas.length > 0) {
      return user.salas
        .map((s) => (typeof s === "object" ? s.id : Number(s)))
        .filter(Boolean);
    }

    const masterMap = $masterUserSalasStore;
    if (
      masterMap &&
      typeof masterMap === "object" &&
      !Array.isArray(masterMap)
    ) {
      const userList = masterMap[userId] || masterMap[String(userId)];
      if (Array.isArray(userList)) {
        return userList
          .map((s) => (typeof s === "object" ? s.id : Number(s)))
          .filter(Boolean);
      }
    }

    const authSalas = $authUserSalasStore;
    if (Array.isArray(authSalas) && authSalas.length > 0) {
      return authSalas
        .map((s) => (typeof s === "object" ? s.id : Number(s)))
        .filter(Boolean);
    }

    return [];
  })();

  let globalMarcajeAlert = null;
  let globalMarcajeAlertTimer = null;

  // Second toast: for undefined / other status events
  let globalMarcajeAlertOther = null;
  let globalMarcajeAlertOtherTimer = null;

  function toTitleCase(str) {
    if (!str || typeof str !== "string") return str;
    return str
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
      .join(" ");
  }

  function formatEventTime(val) {
    if (!val) return "";
    let str = String(val).trim().replace("T", " ");
    if (str.includes("+")) str = str.split("+")[0];
    if (str.endsWith("Z")) str = str.substring(0, str.length - 1);
    if (str.includes(".")) str = str.split(".")[0];
    return str;
  }

  function getInitials(nombre, empNo) {
    if (nombre && typeof nombre === "string") {
      const parts = nombre.trim().split(/\s+/);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      if (parts.length === 1 && parts[0].length > 0)
        return parts[0].substring(0, 2).toUpperCase();
    }
    return String(empNo || "US").substring(0, 2).toUpperCase();
  }

  function formatVerifyMode(mode) {
    if (!mode && mode !== 0) return null;
    const raw = String(mode).trim();
    const str = raw.toLowerCase();
    if (str === "face") {
      return { icon: "👤", label: "Face", color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" };
    }
    if (str === "card") {
      return { icon: "💳", label: "Card", color: "#059669", bg: "#ecfdf5", border: "#a7f3d0" };
    }
    if (str === "faceorcard" || str === "cardorface") {
      return { icon: "👤💳", label: "Face / Card", color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" };
    }
    if (str.includes("finger")) {
      return { icon: "👆", label: "Fingerprint", color: "#d97706", bg: "#fffbeb", border: "#fde68a" };
    }
    if (str.includes("pw") || str.includes("pass")) {
      return { icon: "🔢", label: "Password", color: "#db2777", bg: "#fdf2f8", border: "#fbcfe8" };
    }
    return { icon: "🔑", label: raw, color: "#475569", bg: "#f8fafc", border: "#e2e8f0" };
  }

  let latestKnownRealtimeTimeMs = null;

  async function openAttlogModalFromAlert(alertData) {
    if (!alertData) return;
    const rec = alertData.rawRecord || alertData;
    const pageSize = 10;

    let targetPage = 0;
    let targetIndex = 0;

    try {
      const base = getCloudBaseUrl().endsWith("/api") ? getCloudBaseUrl() : `${getCloudBaseUrl()}/api`;
      const salaParam = assignedSalaIds && assignedSalaIds.length > 0 ? assignedSalaIds.join(",") : "";

      // 1. Obtener la posición global real en el flujo global (sin filtro de estado)
      try {
        const qPos = new URLSearchParams();
        if (salaParam) qPos.set("sala_ids", salaParam);
        const posRes = await fetch(`${base}/attlogs/${rec.id}/position?${qPos.toString()}`);
        if (posRes.ok) {
          const posJson = await posRes.json();
          if (posJson.success && posJson.data) {
            const gIdx = posJson.data.globalIndex || 0;
            targetPage = Math.floor(gIdx / pageSize);
            targetIndex = gIdx % pageSize;
          }
        }
      } catch (errPos) {
        console.warn("No se pudo obtener posición de la alerta:", errPos);
      }

      // 2. Cargar la página correspondiente de la lista global
      async function fetchAlertPage(page) {
        const offset = page * pageSize;
        const q = new URLSearchParams({
          limit: String(pageSize),
          offset: String(offset)
        });
        if (salaParam) q.set("sala_ids", salaParam);
        const res = await fetch(`${base}/attlogs/latest?${q.toString()}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data) && json.data.length > 0) {
            return {
              items: json.data,
              totalCount: json.total || json.data.length,
              totalPages: Math.ceil((json.total || json.data.length) / pageSize) || 1
            };
          }
        }
        return { items: [rec], totalCount: 1, totalPages: 1 };
      }

      const pData = await fetchAlertPage(targetPage);
      let pageItems = pData.items;
      let totalCount = pData.totalCount;
      const totalPages = pData.totalPages;
      let modalPage = targetPage;

      let activeItem = pageItems[targetIndex] || rec;

      openPhotoModal({
        item: activeItem,
        items: pageItems,
        currentIndex: targetIndex,
        currentPage: targetPage,
        totalPages,
        totalCount,
        mode: 'all',
        onPageNext: async () => {
          if (modalPage + 1 < totalPages) {
            modalPage++;
            const nextPageData = await fetchAlertPage(modalPage);
            updatePhotoModalItems({
              items: nextPageData.items,
              currentPage: modalPage,
              totalPages: nextPageData.totalPages,
              totalCount: nextPageData.totalCount,
              position: 'first'
            });
          }
        },
        onPagePrev: async () => {
          if (modalPage > 0) {
            modalPage--;
            const prevPageData = await fetchAlertPage(modalPage);
            updatePhotoModalItems({
              items: prevPageData.items,
              currentPage: modalPage,
              totalPages: prevPageData.totalPages,
              totalCount: prevPageData.totalCount,
              position: 'last'
            });
          }
        }
      });
    } catch (e) {
      console.warn("Error cargando lista global para modal desde alerta:", e);
      openPhotoModal({
        item: rec,
        items: [rec],
        currentIndex: 0,
        currentPage: 0,
        totalPages: 1,
        totalCount: 1,
        mode: 'all'
      });
    }
  }

  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx && typeof window !== "undefined") {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // Sonido de Entrada (Check-In): Tono ascendente nítido y agradable (C5 -> E5 -> G5)
  function playCheckInSound() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Nota 1 (C5 - 523.25 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(523.25, now);
      gain1.gain.setValueAtTime(0.18, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.16);

      // Nota 2 (E5 - 659.25 Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(659.25, now + 0.08);
      gain2.gain.setValueAtTime(0.18, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.26);

      // Nota 3 (G5 - 783.99 Hz)
      const osc3 = ctx.createOscillator();
      const gain3 = ctx.createGain();
      osc3.type = "sine";
      osc3.frequency.setValueAtTime(783.99, now + 0.16);
      gain3.gain.setValueAtTime(0.22, now + 0.16);
      gain3.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
      osc3.connect(gain3);
      gain3.connect(ctx.destination);
      osc3.start(now + 0.16);
      osc3.stop(now + 0.45);
    } catch (e) {
      console.warn("No se pudo reproducir sonido de checkin:", e);
    }
  }

  // Sonido de Salida (Check-Out): Tono suave descendente (G5 -> D5)
  function playCheckOutSound() {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      // Nota 1 (G5 - 783.99 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(783.99, now);
      gain1.gain.setValueAtTime(0.18, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.16);

      // Nota 2 (D5 - 587.33 Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(587.33, now + 0.09);
      gain2.gain.setValueAtTime(0.20, now + 0.09);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.40);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.09);
      osc2.stop(now + 0.40);
    } catch (e) {
      console.warn("No se pudo reproducir sonido de checkout:", e);
    }
  }

  // Alerta única global (Top-Right): Entrada, Salida o Puerta / Otros
  function triggerGlobalMarcajeToast(rec, base, isSync = false) {
    globalMarcajeAlert = {
      id: rec.id,
      nombre: toTitleCase(rec.nombre),
      cedula: rec.employee_no || rec.cedula || "",
      sala: rec.sala_nombre || "Sala",
      dispositivo: rec.dispositivo_nombre || "Dispositivo",
      time: formatEventTime(rec.event_time),
      photo: `${base}/attlogs/${rec.id}.jpg`,
      attendancestatus: rec.attendancestatus,
      currentverifymode: rec.currentverifymode || rec.currentverifymode_status || rec.currentVerifyMode,
      isSync: Boolean(isSync),
      rawRecord: rec,
    };
    if (globalMarcajeAlertTimer) clearTimeout(globalMarcajeAlertTimer);
    globalMarcajeAlertTimer = setTimeout(() => { globalMarcajeAlert = null; }, 10000);

    // Reproducir sonido SOLO en tiempo real (NO en marcajes SYNC)
    if (!isSync) {
      const status = String(rec.attendancestatus || "").toLowerCase().trim();
      if (status === "checkin" || status === "entrada") {
        playCheckInSound();
      } else if (status === "checkout" || status === "salida") {
        playCheckOutSound();
      }
    }
  }

  let healthStatus = {
    status: "loading",
    database: { connected: false, mode: "Comprobando..." },
  };

  const builtInTabs = [
    "dashboard",
    "analytics",
    "products",
    "companies",
    "invoice",
    "components",
    "vector-maps",
    "drag",
    "profile",
    "auth",
    "settings",
    "rrhh/marcajes",
    "rrhh/registros",
    "cecom/llaves-borradas",
    "mesas-en-vivo/mesas-borradas",
    "rrhh/desincorporados",
    "rrhh/asignaciones",
  ];

  $: activeTabStore.set($currentRouteStore);

  function getNewRecordButtonLabel(tab) {
    return "Nuevo Registro";
  }

  function getTabTitle(tab) {
    if (tab === "dashboard") return "RRHH";
    if (tab === "datatable") return "Tabla de Datos y Modal (Data Table)";
    if (tab === "analytics") return "Analítica y Métricas";
    if (tab === "products") return "Catálogo de Productos";
    if (tab === "companies") return "Empresas y Aliados";
    if (tab === "invoice") return "Documento de Facturación";
    if (tab === "components") return "Galería de Componentes UI";
    if (tab === "vector-maps") return "Mapas Vectoriales";
    if (tab === "drag") return "Lista Arrastrar y Soltar";
    if (tab === "profile") return "Perfil de Usuario";
    if (tab === "auth") return "Autenticación";
    if (tab === "settings") return "Diagnóstico del Sistema";
    if (tab === "rrhh/marcajes" || tab === "marcajes") return "Marcajes";

    if ($navMenuStore && Array.isArray($navMenuStore)) {
      for (const page of $navMenuStore) {
        if (page.modulos && Array.isArray(page.modulos)) {
          for (const modulo of page.modulos) {
            const $currentRouteStore = modulo.ruta
              ? modulo.ruta.replace(/^\//, "")
              : "";
            if ($currentRouteStore === tab) {
              return `${modulo.nombre}`;
            }
          }
        }
      }
    }

    return tab.split("/").pop().replace(/-/g, " ").toUpperCase();
  }

  async function refreshData() {
    try {
      healthStatus = await fetchHealthModel();
      await loadItemsData();
    } catch (err) {
      triggerToast("Error de conexión con la API Backend", "error");
    }
  }

  function handleGlobalKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
      e.preventDefault();
      openCreateModalUI();
    }
  }

  onMount(async () => {
    initRouter();
    loadMasterStoresFromBackend();
    await loadUserSession();
    await refreshData();

    // Fetch last event time from backend to detect delayed / historical SYNC marcajes
    async function initLatestEventTime() {
      try {
        const backendUrl = getCloudBaseUrl();
        const base = backendUrl.endsWith('/api') ? backendUrl : `${backendUrl}/api`;
        const res = await fetch(`${base}/attlogs/last-event-time`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.last_event_time) {
            const dt = new Date(String(json.last_event_time).replace(' ', 'T')).getTime();
            if (!isNaN(dt)) {
              latestKnownRealtimeTimeMs = dt;
            }
          }
        }
      } catch (e) {
        console.warn("No se pudo obtener último event_time:", e);
      }
    }
    initLatestEventTime();

    // Connect WebSocket for real-time live attendance notifications (NO HTTP POLLING!)
    initWebSocketConnection((rec) => {
      if (!$isAuthenticatedStore) return;
      const currentTab = String($currentRouteStore || '').toLowerCase();
      if (
        currentTab === 'willinthontech' ||
        currentTab === 'master' ||
        currentTab.includes('willinthontech')
      ) return;

      // --- Sala filter: only show if the device's sala belongs to this user ---
      const recSalaId = Number(rec.sala_id);
      if (recSalaId && assignedSalaIds.length > 0 && !assignedSalaIds.includes(recSalaId)) return;

      const backendUrl = getCloudBaseUrl();
      const base = backendUrl.endsWith('/api') ? backendUrl : `${backendUrl}/api`;

      // Detect if record is SYNC (inferior a la hora del último registro en tiempo real)
      let isSync = false;
      if (rec.event_time) {
        const recTimeMs = new Date(String(rec.event_time).replace(' ', 'T')).getTime();
        if (!isNaN(recTimeMs)) {
          if (latestKnownRealtimeTimeMs !== null && recTimeMs < latestKnownRealtimeTimeMs) {
            isSync = true;
          } else {
            latestKnownRealtimeTimeMs = Math.max(latestKnownRealtimeTimeMs || 0, recTimeMs);
          }
        }
      }

      // Alerta única superior: Entrada, Salida o Puerta / Otros
      triggerGlobalMarcajeToast(rec, base, isSync);

      // Actualizar modal si está abierto
      handleRealtimeAttlogInPhotoModal(rec);
    });

    if (window.innerWidth < 1024) {
      isSidebarOpenStore.set(false);
    }
  });

  onDestroy(() => {
    closeWebSocketConnection();
    if (globalMarcajeAlertTimer) clearTimeout(globalMarcajeAlertTimer);
    if (globalMarcajeAlertOtherTimer) clearTimeout(globalMarcajeAlertOtherTimer);
  });

  async function handleSaveItem(event) {
    const { id, title, description, category, priority } = event.detail;
    try {
      if (id) {
        await updateExistingItem(id, {
          title,
          description,
          category,
          priority,
        });
        triggerToast("Elemento actualizado", "success");
      } else {
        await addNewItem({ title, description, category, priority });
        triggerToast("Nuevo elemento creado", "success");
      }
      closeModalUI();
      await refreshData();
    } catch (err) {
      triggerToast(err.message || "Error al guardar elemento", "error");
    }
  }

  async function handleSaveInline(event) {
    const item = event.detail;
    try {
      await updateExistingItem(item.id, {
        title: item.title,
        description: item.description,
        category: item.category,
        priority: item.priority,
        completed: item.completed,
      });
      triggerToast("Cambios guardados en línea", "success");
      await refreshData();
    } catch (err) {
      triggerToast(err.message || "Error al guardar cambios", "error");
    }
  }

  async function handleToggle(event) {
    const itemId = event.detail;
    try {
      await toggleItemCompleted(itemId);
      await refreshData();
    } catch (err) {
      triggerToast("Error al cambiar estado", "error");
    }
  }

  function handleDeleteRequest(event) {
    const itemOrId = event.detail;
    const targetItem =
      typeof itemOrId === "object"
        ? itemOrId
        : $itemsStore.find((i) => i.id === itemOrId) || { id: itemOrId };
    openDeleteModalUI(targetItem);
  }

  async function handleConfirmDelete(event) {
    const itemId = event.detail;
    try {
      await removeSingleItem(itemId);
      triggerToast("Elemento eliminado correctamente", "info");
      closeDeleteModalUI();
      await refreshData();
    } catch (err) {
      triggerToast("Error al eliminar elemento", "error");
    }
  }
</script>

<svelte:window on:keydown={handleGlobalKeydown} />

{#if $currentRouteStore === "willinthontech" || isPublicRoute($currentRouteStore)}
  <!-- Standalone Secret Master Admin Panel (No Login Required) -->
  <MasterAdminView />
{:else if $isAuthenticatedStore}
  <!-- Main Application Layout when Authenticated -->
  <div
    class="app-layout {$isSidebarOpenStore
      ? 'sidebar-expanded'
      : 'sidebar-collapsed'}"
  >
    <!-- Left Navy Sidebar -->
    <Sidebar
      activeTab={$currentRouteStore}
      isOpen={$isSidebarOpenStore}
      on:closeMobile={() => isSidebarOpenStore.set(false)}
    />

    <!-- Main Wrapper -->
    <div class="main-wrapper">
      <!-- Top Header -->
      <Navbar on:toggleSidebar={() => isSidebarOpenStore.update((v) => !v)} />

      <OfflineBanner />

      <!-- Content Body -->
      <main class="content-body">
        <!-- Page Title Header without breadcrumbs -->
        <div
          class="page-header"
          style="display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;"
        >
          <div>
            <h1 class="page-title" style="margin: 0;">
              {getTabTitle($currentRouteStore)}
            </h1>
          </div>

          {#if !builtInTabs.includes($currentRouteStore)}
            <button
              on:click={openCreateModalUI}
              type="button"
              class="btn-flow"
              style="padding: 10px 18px; font-weight: 700; font-size: 13.5px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.3); white-space: nowrap;"
            >
              {getNewRecordButtonLabel($currentRouteStore)}
            </button>
          {/if}
        </div>

        <!-- Hash Router Views -->

        {#if $currentRouteStore === "dashboard"}
          <DashboardView items={$itemsStore} />
        {:else if $currentRouteStore === "analytics"}
          <AnalyticsView items={$itemsStore} />
        {:else if $currentRouteStore === "products"}
          <ProductsView />
        {:else if $currentRouteStore === "companies"}
          <CompaniesView />
        {:else if $currentRouteStore === "invoice"}
          <InvoiceView />
        {:else if $currentRouteStore === "components"}
          <ComponentsView />
        {:else if $currentRouteStore === "vector-maps"}
          <VectorMapsView />
        {:else if $currentRouteStore === "drag"}
          <DragView />
        {:else if $currentRouteStore === "profile"}
          <ProfileView {healthStatus} />
        {:else if $currentRouteStore === "auth"}
          <AuthView />
        {:else if $currentRouteStore === "settings"}
          <SettingsView {healthStatus} />

          <!-- CECOM Module Views -->
        {:else if $currentRouteStore === "cecom/libro" || $currentRouteStore === "libro" || $currentRouteStore === "libros"}
          <LibroView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "cecom/llaves" || $currentRouteStore === "llaves"}
          <LlavesView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "cecom/llaves-borradas" || $currentRouteStore === "llaves-borradas"}
          <LlavesBorradasView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />

          <!-- RRHH Module Views -->
        {:else if $currentRouteStore === "rrhh/marcajes" || $currentRouteStore === "marcajes"}
          <MarcajesView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "rrhh/empleados" || $currentRouteStore === "empleados"}
          <EmpleadosView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "rrhh/cargos" || $currentRouteStore === "cargos"}
          <CargosView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "rrhh/asignaciones" || $currentRouteStore === "asignaciones"}
          <CicloDeHorarioView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "rrhh/areas" || $currentRouteStore === "areas"}
          <AreasView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "rrhh/departamentos" || $currentRouteStore === "departamentos"}
          <DepartamentosView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "rrhh/registros" || $currentRouteStore === "registros"}
          <ReportesView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "rrhh/desincorporados" || $currentRouteStore === "desincorporados"}
          <DesincorporadosView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "rrhh/carnet" || $currentRouteStore === "carnet"}
          <CarnetView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "rrhh/plantillas" || $currentRouteStore === "plantillas"}
          <HorariosView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "rrhh/cumpleanos" || $currentRouteStore === "cumpleanos"}
          <CumpleanosView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "rrhh/calendario" || $currentRouteStore === "calendario"}
          <CalendarioView />

          <!-- MAQUINAS Module Views -->
        {:else if $currentRouteStore === "maquinas/maquinas" || $currentRouteStore === "maquinas"}
          <MaquinasView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "maquinas/estados" || $currentRouteStore === "estados"}
          <EstadosView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "maquinas/sociedades" || $currentRouteStore === "sociedades"}
          <SociedadesView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "maquinas/valores" || $currentRouteStore === "valores"}
          <ValoresView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "maquinas/juegos" || $currentRouteStore === "juegos"}
          <MaquinasJuegosView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "maquinas/marcas" || $currentRouteStore === "marcas"}
          <MarcasView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "maquinas/modelos" || $currentRouteStore === "modelos"}
          <ModelosView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "maquinas/tipos" || $currentRouteStore === "tipos"}
          <TiposView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "maquinas/modos" || $currentRouteStore === "modos"}
          <ModosView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "maquinas/legal" || $currentRouteStore === "legal"}
          <LegalView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />

          <!-- MESAS EN VIVO Module Views -->
        {:else if $currentRouteStore === "mesas-en-vivo/mesas" || $currentRouteStore === "mesas"}
          <MesasView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "mesas-en-vivo/juegos"}
          <MesasJuegosView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else if $currentRouteStore === "mesas-en-vivo/mesas-borradas"}
          <MesasBorradasView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />

          <!-- ESTADISTICA Module Views -->
        {:else if $currentRouteStore === "estadistica/contadores" || $currentRouteStore === "contadores"}
          <ContadoresView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {:else}
          <!-- Generic Fallback DataTableView -->
          <DataTableView
            items={$itemsStore}
            on:toggle={handleToggle}
            on:edit={(e) => openEditModalUI(e.detail)}
            on:delete={handleDeleteRequest}
            on:openModal={openCreateModalUI}
            on:saveInline={handleSaveInline}
          />
        {/if}
      </main>
    </div>

    <!-- Reusable Non-Overflowing Item Modal -->
    <ItemModal
      isOpen={$isModalOpenStore}
      editItem={$editingItemStore}
      on:save={handleSaveItem}
      on:close={closeModalUI}
    />

    <!-- Styled Delete Confirmation Modal -->
    <DeleteModal
      isOpen={$isDeleteModalOpenStore}
      item={$itemToDeleteStore}
      on:confirm={handleConfirmDelete}
      on:close={closeDeleteModalUI}
    />
  </div>
{:else}
  <!-- Centered Standalone Login Screen when Unauthenticated -->
  <div
    style="min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #0f172a, #1e1b4b); padding: 24px;"
  >
    <div style="width: 100%; max-width: 520px;">
      <AuthView />
    </div>
  </div>
{/if}

<!-- Toast Notification -->
<Toast
  message={$toastMessageStore}
  type={$toastTypeStore}
  visible={$toastVisibleStore}
/>

<!-- Alerta flotante superior única: Último Marcaje (Entrada, Salida o Puerta / Otros) -->
{#if globalMarcajeAlert && $isAuthenticatedStore}
  <div class="global-marcaje-alert-toast-container">
    <div
      class="global-marcaje-alert-card"
      class:global-marcaje-alert-card-checkin={(globalMarcajeAlert.attendancestatus || '').toLowerCase() === "checkin"}
      class:global-marcaje-alert-card-checkout={(globalMarcajeAlert.attendancestatus || '').toLowerCase() === "checkout"}
      class:global-marcaje-alert-card-undefined={(globalMarcajeAlert.attendancestatus || '').toLowerCase() !== "checkin" && (globalMarcajeAlert.attendancestatus || '').toLowerCase() !== "checkout"}
      on:click={() => openAttlogModalFromAlert(globalMarcajeAlert)}
      role="button"
      tabindex="0"
      style="cursor: pointer;"
    >
      <div
        class="global-marcaje-avatar-ring"
        class:global-marcaje-avatar-ring-checkin={(globalMarcajeAlert.attendancestatus || '').toLowerCase() === "checkin"}
        class:global-marcaje-avatar-ring-checkout={(globalMarcajeAlert.attendancestatus || '').toLowerCase() === "checkout"}
        class:global-marcaje-avatar-ring-undefined={(globalMarcajeAlert.attendancestatus || '').toLowerCase() !== "checkin" && (globalMarcajeAlert.attendancestatus || '').toLowerCase() !== "checkout"}
      >
        <img
          src={globalMarcajeAlert.photo}
          alt="Marcaje"
          class="global-marcaje-avatar-img"
          on:error={(e) => {
            e.target.style.display = "none";
            if (e.target.nextElementSibling) e.target.nextElementSibling.style.display = "flex";
          }}
        />
        <div class="global-marcaje-avatar-fallback">
          {getInitials(globalMarcajeAlert.nombre, globalMarcajeAlert.cedula)}
        </div>
      </div>
      <div class="global-marcaje-alert-content">
        <div class="global-marcaje-alert-header" style="display: flex; align-items: center; gap: 6px;">
          {#if globalMarcajeAlert.isSync}
            <span
              style="background: #2563eb; color: #ffffff; padding: 2px 7px; border-radius: 5px; font-size: 10px; font-weight: 900; letter-spacing: 0.8px; box-shadow: 0 2px 5px rgba(37,99,235,0.3); display: inline-flex; align-items: center; gap: 3px;"
              title="Registro sincronizado fuera de tiempo real"
            >
              SYNC
            </span>
          {/if}
          {#if (globalMarcajeAlert.attendancestatus || '').toLowerCase() === "checkin"}
            <span class="global-marcaje-pulse-dot-checkin"></span>
            <span class="global-marcaje-alert-tag-checkin">Entrada</span>
          {:else if (globalMarcajeAlert.attendancestatus || '').toLowerCase() === "checkout"}
            <span class="global-marcaje-pulse-dot-checkout"></span>
            <span class="global-marcaje-alert-tag-checkout">Salida</span>
          {:else}
            <span class="global-marcaje-pulse-dot-undefined"></span>
            <span class="global-marcaje-alert-tag-undefined">Puerta / Otros</span>
          {/if}
        </div>
        <div class="global-marcaje-alert-name">{globalMarcajeAlert.nombre}</div>
        <div class="global-marcaje-alert-meta"><span>🕒 {globalMarcajeAlert.time}</span></div>
        <div class="global-marcaje-alert-meta"><span>🫆 {globalMarcajeAlert.dispositivo}</span></div>
        <div class="global-marcaje-alert-meta"><span>📍 {globalMarcajeAlert.sala}</span></div>
        <div class="global-marcaje-alert-meta" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px;">
          <button
            type="button"
            on:click|stopPropagation={() => openAttlogModalFromAlert(globalMarcajeAlert)}
            style="background: transparent; border: none; padding: 0; margin: 0; font-family: monospace; font-size: 11.5px; font-weight: 800; color: #2563eb; text-decoration: underline; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;"
            title="Abrir modal con la lista global de marcajes"
          >
            #{globalMarcajeAlert.id}
          </button>
          {#if globalMarcajeAlert.currentverifymode}
            {@const vMode = formatVerifyMode(globalMarcajeAlert.currentverifymode)}
            {#if vMode}
              <span
                style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: 800; background: {vMode.bg}; color: {vMode.color}; border: 1px solid {vMode.border}; box-shadow: 0 1px 2px rgba(0,0,0,0.04);"
                title="Método de verificación: {globalMarcajeAlert.currentverifymode}"
              >
                <span>{vMode.icon}</span>
                <span>{vMode.label}</span>
              </span>
            {/if}
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Modal Global Unificado de Fotografías y Fichas -->
<GlobalPhotoModal />

<!-- Notificación y Botón Nativo de Instalación PWA (Android / Escritorio) -->
<PwaInstallPrompt />

<style>
  :global(*::-webkit-scrollbar) {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
  }
  :global(*) {
    -ms-overflow-style: none !important;
    scrollbar-width: none !important;
  }
  /* Toast 1 — checkIn / checkOut: slides in from the right, top-right corner */
  .global-marcaje-alert-toast-container {
    position: fixed;
    top: 75px;
    right: 24px;
    z-index: 10000000;
    pointer-events: none;
    animation: globalMarcajeSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }

  /* Toast 2 — undefined / other: slides up from the bottom-right corner */
  .global-marcaje-alert-other-toast-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 10000000;
    pointer-events: none;
    animation: globalMarcajeSlideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }
  @keyframes globalMarcajeSlideUp {
    from {
      transform: translateY(80%) scale(0.9);
      opacity: 0;
    }
    to {
      transform: translateY(0) scale(1);
      opacity: 1;
    }
  }
  @keyframes globalMarcajeSlideIn {
    from {
      transform: translateX(120%) scale(0.9);
      opacity: 0;
    }
    to {
      transform: translateX(0) scale(1);
      opacity: 1;
    }
  }
  .global-marcaje-alert-card {
    background: linear-gradient(135deg, #ffffff, #ffffff);
    border-radius: 14px;
    padding: 12px 18px;
    /*box-shadow:
      0 20px 25px -5px rgba(34, 197, 94, 0.25),
      0 8px 10px -6px rgba(0, 0, 0, 0.1);*/
    display: flex;
    align-items: center;
    gap: 14px;
    max-width: 380px;
    backdrop-filter: blur(8px);
    pointer-events: auto;
  }
  .global-marcaje-alert-card-undefined {
    border: 1.5px solid #f97316;
  }
  .global-marcaje-alert-card-checkin {
    border: 1.5px solid #22c55e;
  }
  .global-marcaje-alert-card-checkout {
    border: 1.5px solid #c94145;
  }

  .global-marcaje-avatar-ring {
    position: relative;
    width: 100px;
    height: 100px;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    /*box-shadow: 0 0 10px rgba(34, 197, 94, 0.4);*/
  }

  .global-marcaje-avatar-ring-undefined {
    border: 2px solid #f97316;
    background: #ea580c;
  }
  .global-marcaje-avatar-ring-checkin {
    border: 2px solid #22c55e;
    background: #22c55e;
  }
  .global-marcaje-avatar-ring-checkout {
    border: 2px solid #c94145;
    background: #c94145;
  }

  .global-marcaje-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .global-marcaje-avatar-fallback {
    display: none;
    width: 100%;
    height: 100%;
    background: #16a34a;
    color: #ffffff;
    font-weight: 800;
    align-items: center;
    justify-content: center;
    font-size: 14px;
  }
  .global-marcaje-alert-content {
    flex: 1;
    min-width: 0;
  }
  .global-marcaje-alert-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
  }
  @keyframes globalMarcajePulse {
    from {
      transform: scale(0.8);
      opacity: 0.7;
    }
    to {
      transform: scale(1.3);
      opacity: 1;
    }
  }
  .global-marcaje-alert-tag-undefined {
    font-size: 10.5px;
    font-weight: 800;
    color: #ea580c;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .global-marcaje-alert-tag-checkin {
    font-size: 10.5px;
    font-weight: 800;
    color: #22c55e;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .global-marcaje-alert-tag-checkout {
    font-size: 10.5px;
    font-weight: 800;
    color: #c94145;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .global-marcaje-pulse-dot-undefined {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #f97316;
    box-shadow: 0 0 8px #f97316;
    animation: globalMarcajePulse 1s infinite alternate;
  }
  .global-marcaje-pulse-dot-checkin {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 8px #22c55e;
    animation: globalMarcajePulse 1s infinite alternate;
  }
  .global-marcaje-pulse-dot-checkout {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #c94145;
    box-shadow: 0 0 8px #c94145;
    animation: globalMarcajePulse 1s infinite alternate;
  }
  .global-marcaje-alert-name {
    font-size: 14px;
    font-weight: 800;
    color: #0f172a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .global-marcaje-alert-meta {
    font-size: 11.5px;
    font-weight: 600;
    color: #475569;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 2px;
  }
  /* ───────────────────────────────────────────────────────────
     Toast 2 — Dedicated styles (brownish/gray palette)
     Completely separate from Toast 1 green/red classes
  ─────────────────────────────────────────────────────────── */
  .toast2-card {
    background: linear-gradient(135deg, #ffffff, #fdfaf7);
    border: 1.5px solid #92756b;
    border-radius: 14px;
    padding: 12px 18px;
    display: flex;
    align-items: center;
    gap: 14px;
    max-width: 380px;
    backdrop-filter: blur(8px);
    pointer-events: auto;
    box-shadow: 0 4px 16px rgba(92, 75, 60, 0.15);
  }
  .toast2-avatar-ring {
    position: relative;
    width: 100px;
    height: 100px;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid #92756b;
    background: #92756b;
  }
  .toast2-avatar-fallback {
    display: none;
    width: 100%;
    height: 100%;
    background: #92756b;
    color: #ffffff;
    font-weight: 800;
    align-items: center;
    justify-content: center;
    font-size: 14px;
  }
  .toast2-pulse-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #92756b;
    box-shadow: 0 0 8px #92756b;
    animation: globalMarcajePulse 1s infinite alternate;
  }
  .toast2-tag {
    font-size: 10.5px;
    font-weight: 800;
    color: #92756b;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
</style>
