<script context="module">
  import { writable } from "svelte/store";

  // Persistent Filter State across view navigations
  export const persistentMarcajesFilters = writable({
    selectedSalas: [],
    selectedDispositivos: [],
    selectedVerifyModes: [],
    selectedEstados: [],
    selectedFotos: [],
    selectedEstatusEmpleados: [],
    selectedDepartamentos: [],
    selectedAreas: [],
    selectedCargos: [],
    selectedSexo: [],
    searchQuery: "",
    pageSize: 10,
    currentPage: 1,
    sortBy: "event_time",
    sortDir: "desc"
  });
</script>

<script>
  function toTitleCase(str) {
    if (!str || typeof str !== "string") return str;
    return str
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
      .join(" ");
  }

  import { onMount, onDestroy } from "svelte";
  import html2canvas from "html2canvas";
  import { latestAttlogEventStore } from "../../controllers/websocket.store.js";
  import { getCloudBaseUrl, toBackendUrl } from "../../config/api.config.js";
  import { userSalasStore as masterUserSalasStore } from "../../controllers/master.store.js";
  import {
    currentUserStore,
    userSalasStore as authUserSalasStore,
  } from "../../controllers/auth.store.js";
  import SmartMultiSelect from "../../components/common/SmartMultiSelect.svelte";
  import { 
    photoModalStore, 
    openPhotoModal as triggerGlobalPhotoModal, 
    updatePhotoModalItems 
  } from "../../controllers/globalModal.store.js";

  let attlogs = [];
  let totalCount = 0;
  let isLoading = false;
  let isInitialLoad = true;

  // Initialize from persistent store so filters survive page and route transitions
  let initial = {};
  const unsubInit = persistentMarcajesFilters.subscribe((val) => {
    initial = val || {};
  });
  unsubInit();

  // Smart Multiselect Filters State
  let selectedSalas = initial.selectedSalas || [];
  let selectedDispositivos = initial.selectedDispositivos || [];
  let selectedVerifyModes = initial.selectedVerifyModes || [];
  let selectedEstados = initial.selectedEstados || [];
  let selectedFotos = initial.selectedFotos || [];
  let selectedEstatusEmpleados = initial.selectedEstatusEmpleados || [];
  let selectedDepartamentos = initial.selectedDepartamentos || [];
  let selectedAreas = initial.selectedAreas || [];
  let selectedCargos = initial.selectedCargos || [];
  let selectedSexo = initial.selectedSexo || [];

  // Pagination & Filters State
  let currentPage = initial.currentPage || 1;
  let pageSize = initial.pageSize || 10;
  let searchQuery = initial.searchQuery || "";
  let debouncedSearch = searchQuery.trim();
  let sortBy = initial.sortBy || "event_time";
  let sortDir = initial.sortDir || "desc";

  // Sync back to persistent store whenever any parameter changes
  $: {
    persistentMarcajesFilters.set({
      selectedSalas,
      selectedDispositivos,
      selectedVerifyModes,
      selectedEstados,
      selectedFotos,
      selectedEstatusEmpleados,
      selectedDepartamentos,
      selectedAreas,
      selectedCargos,
      selectedSexo,
      searchQuery,
      pageSize,
      currentPage,
      sortBy,
      sortDir
    });
  }

  // Cascading Facet Options from Backend
  let filterOptions = {
    salas: [],
    dispositivos: [],
    estados: [],
    verifyModes: [],
    fotos: [],
    estatusEmpleados: [],
    departamentos: [],
    areas: [],
    cargos: [],
    sexo: []
  };

  $: preparedCargos = (filterOptions.cargos || []).map((c) => ({
    ...c,
    subgroup_label:
      c.departamento_nombre && c.area_nombre
        ? `${c.departamento_nombre} › ${c.area_nombre}`
        : c.area_nombre || c.departamento_nombre || "Sin Área",
  }));

  // Search Debounce Timer
  let searchTimeout = null;

  // Lightbox Modal State
  let selectedModalIndex = null;

  const backendUrl = getCloudBaseUrl();
  function getFallbackProfilePhoto(record) {
    if (!record) return null;
    const empFoto =
      record.empleado_foto ||
      record.foto ||
      (record.empleado_id ? `/empleados/${record.empleado_id}.jpg` : null);
    if (!empFoto) return null;
    return toBackendUrl(empFoto);
  }

  // Extract assigned sala IDs strictly for the logged in user
  $: assignedSalaIds = (function () {
    const user = $currentUserStore;
    const userId = user?.id || 1;

    // 1. If user object has specific salas assigned directly from backend API session:
    if (user && Array.isArray(user.salas) && user.salas.length > 0) {
      return user.salas
        .map((s) => (typeof s === "object" ? s.id : Number(s)))
        .filter(Boolean);
    }

    // 2. Check masterUserSalasStore dictionary (userId -> array of sala IDs):
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

    // 3. Fallback to authUserSalasStore array if present
    const authSalas = $authUserSalasStore;
    if (Array.isArray(authSalas) && authSalas.length > 0) {
      return authSalas
        .map((s) => (typeof s === "object" ? s.id : Number(s)))
        .filter(Boolean);
    }

    return [];
  })();

  $: selectedPhotoModal =
    selectedModalIndex !== null && attlogs[selectedModalIndex]
      ? attlogs[selectedModalIndex]
      : null;

  function getPhotoUrl(id) {
    if (!id) return "";
    return toBackendUrl(`/attlogs/${id}.jpg`);
  }

  // Precarga automática en segundo plano de las fotos de los 10 marcajes visibles en pantalla
  $: if (attlogs && attlogs.length > 0 && typeof window !== "undefined") {
    attlogs.forEach((att) => {
      const url = (att?.id || att?.attlog_id) ? getPhotoUrl(att?.id || att?.attlog_id) : getFallbackProfilePhoto(att);
      if (url) {
        const img = new Image();
        img.src = url;
      }
    });
  }

  // Debounce search input (300ms)
  $: {
    if (searchQuery !== undefined) {
      if (searchTimeout) clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        if (debouncedSearch !== searchQuery.trim()) {
          debouncedSearch = searchQuery.trim();
          currentPage = 1;
        }
      }, 300);
    }
  }

  // Caché en memoria para páginas ya cargadas (para que volver atrás sea inmediato a 0ms)
  const attlogsPageCache = new Map();
  let lastFilterCacheKey = "";
  $: currentFilterCacheKey = `${pageSize}_${debouncedSearch}_${sortBy}_${sortDir}_${(assignedSalaIds || []).join(",")}_${selectedSalas.join(",")}_${selectedDispositivos.join(",")}_${selectedVerifyModes.join(",")}_${selectedEstados.join(",")}_${selectedFotos.join(",")}_${selectedEstatusEmpleados.join(",")}_${selectedDepartamentos.join(",")}_${selectedAreas.join(",")}_${selectedCargos.join(",")}_${selectedSexo.join(",")}`;

  $: if (currentFilterCacheKey !== lastFilterCacheKey) {
    lastFilterCacheKey = currentFilterCacheKey;
    attlogsPageCache.clear();
  }

  // Controlled reactive fetch for data when any parameter changes
  let lastFetchKey = "";
  $: fetchKey = `${currentPage}_${pageSize}_${debouncedSearch}_${sortBy}_${sortDir}_${(assignedSalaIds || []).join(",")}_${selectedSalas.join(",")}_${selectedDispositivos.join(",")}_${selectedVerifyModes.join(",")}_${selectedEstados.join(",")}_${selectedFotos.join(",")}_${selectedEstatusEmpleados.join(",")}_${selectedDepartamentos.join(",")}_${selectedAreas.join(",")}_${selectedCargos.join(",")}_${selectedSexo.join(",")}`;
  $: if (fetchKey !== lastFetchKey) {
    lastFetchKey = fetchKey;
    fetchAttlogs(
      currentPage,
      pageSize,
      debouncedSearch,
      sortBy,
      sortDir,
      assignedSalaIds,
    );
  }

  // Fetch filter options ONLY when the active filters or search change (not on every page flip)
  let lastFilterKey = "";
  $: filterKey = `${(assignedSalaIds || []).join(",")}_${selectedSalas.join(",")}_${selectedDispositivos.join(",")}_${selectedVerifyModes.join(",")}_${selectedEstados.join(",")}_${selectedFotos.join(",")}_${selectedEstatusEmpleados.join(",")}_${selectedDepartamentos.join(",")}_${selectedAreas.join(",")}_${selectedCargos.join(",")}_${selectedSexo.join(",")}_${debouncedSearch}`;
  $: if (filterKey !== lastFilterKey) {
    lastFilterKey = filterKey;
    fetchFilterOptions();
  }

  async function fetchFilterOptions() {
    try {
      const base = backendUrl.endsWith("/api") ? backendUrl : `${backendUrl}/api`;
      const q = new URLSearchParams();
      q.set("user_sala_ids", assignedSalaIds.join(","));
      if (selectedSalas.length > 0) q.set("sala_ids", selectedSalas.join(","));
      if (selectedDispositivos.length > 0) q.set("dispositivo_ids", selectedDispositivos.join(","));
      if (selectedEstados.length > 0) q.set("estados", selectedEstados.join(","));
      if (selectedVerifyModes.length > 0) q.set("verify_modes", selectedVerifyModes.join(","));
      if (selectedFotos.length > 0) q.set("has_photo", selectedFotos.join(","));
      if (selectedEstatusEmpleados.length > 0) q.set("estatus_empleados", selectedEstatusEmpleados.join(","));
      if (selectedDepartamentos.length > 0) q.set("departamento_ids", selectedDepartamentos.join(","));
      if (selectedAreas.length > 0) q.set("area_ids", selectedAreas.join(","));
      if (selectedCargos.length > 0) q.set("cargo_ids", selectedCargos.join(","));
      if (selectedSexo.length > 0) q.set("sexo", selectedSexo.join(","));
      if (debouncedSearch) q.set("search", debouncedSearch);

      const res = await fetch(`${base}/attlogs/filter-options?${q.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          filterOptions = json.data;
        }
      }
    } catch (e) {
      console.warn("Error fetching filter options from backend:", e);
    }
  }

  async function fetchAttlogs(
    page = 1,
    limit = 10,
    search = "",
    col = "event_time",
    dir = "desc",
    salas = [],
    silent = false,
    force = false,
  ) {
    const pageCacheKey = `pg_${page}_${currentFilterCacheKey}`;
    // Si la página ya fue traída antes y NO es recarga forzada, entregarla a 0ms sin ir a la red
    if (!force && attlogsPageCache.has(pageCacheKey)) {
      const cached = attlogsPageCache.get(pageCacheKey);
      attlogs = [...cached.data];
      totalCount = cached.total;
      isLoading = false;
      isInitialLoad = false;
      if (pendingModalPageDirection && $photoModalStore.isOpen) {
        const dir = pendingModalPageDirection;
        pendingModalPageDirection = null;
        updatePhotoModalItems({
          items: attlogs,
          currentPage: page - 1,
          totalPages: Math.ceil((cached.total || 0) / limit) || 1,
          totalCount: cached.total || 0,
          position: dir === 'next' ? 'first' : 'last'
        });
      }
      return;
    }

    if (!silent) isLoading = true;
    try {
      const base = backendUrl.endsWith("/api")
        ? backendUrl
        : `${backendUrl}/api`;
      const offset = (page - 1) * limit;

      const q = new URLSearchParams();
      q.set("limit", limit);
      q.set("offset", offset);
      q.set("search", search);
      q.set("sortBy", col);
      q.set("sortDir", dir);

      if (salas && Array.isArray(salas) && salas.length > 0) {
        q.set("user_sala_ids", salas.join(","));
      } else {
        q.set("user_sala_ids", "-1");
      }

      if (selectedSalas.length > 0) q.set("sala_ids", selectedSalas.join(","));
      if (selectedDispositivos.length > 0) q.set("dispositivo_ids", selectedDispositivos.join(","));
      if (selectedEstados.length > 0) q.set("estados", selectedEstados.join(","));
      if (selectedVerifyModes.length > 0) q.set("verify_modes", selectedVerifyModes.join(","));
      if (selectedFotos.length > 0) q.set("has_photo", selectedFotos.join(","));
      if (selectedEstatusEmpleados.length > 0) q.set("estatus_empleados", selectedEstatusEmpleados.join(","));
      if (selectedDepartamentos.length > 0) q.set("departamento_ids", selectedDepartamentos.join(","));
      if (selectedAreas.length > 0) q.set("area_ids", selectedAreas.join(","));
      if (selectedCargos.length > 0) q.set("cargo_ids", selectedCargos.join(","));
      if (selectedSexo.length > 0) q.set("sexo", selectedSexo.join(","));

      const res = await fetch(`${base}/attlogs/latest?${q.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          const seen = new Set();
          attlogs = json.data.filter(item => {
            if (!item || item.id === undefined || item.id === null) return false;
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
          });
          totalCount = json.total || 0;
          attlogsPageCache.set(pageCacheKey, { data: attlogs, total: totalCount });
        }
      }
    } catch (e) {
      console.warn("Error fetching attlogs from backend:", e);
    } finally {
      isLoading = false;
      isInitialLoad = false;
      if ($photoModalStore.isOpen && $photoModalStore.mode === 'marcajes_table') {
        if (pendingModalPageDirection) {
          const dir = pendingModalPageDirection;
          pendingModalPageDirection = null;
          updatePhotoModalItems({
            items: attlogs,
            currentPage: page - 1,
            totalPages: Math.ceil((totalCount || 0) / limit) || 1,
            totalCount,
            position: dir === 'next' ? 'first' : 'last'
          });
        } else if (page === 1) {
          updatePhotoModalItems({
            items: attlogs,
            currentPage: 0,
            totalPages: Math.ceil((totalCount || 0) / limit) || 1,
            totalCount,
            position: 'keep'
          });
        }
      }
    }
  }

  function toggleSort(column) {
    if (sortBy === column) {
      sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      sortBy = column;
      sortDir = "desc";
    }
    currentPage = 1;
  }

  function handlePageSizeChange(e) {
    pageSize = Number(e.target.value);
    currentPage = 1;
  }

  function goToPage(page) {
    if (page >= 1 && page <= totalPages) {
      currentPage = page;
    }
  }

  $: totalPages = Math.ceil(totalCount / pageSize) || 1;
  $: startRecord = totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  $: endRecord = Math.min(currentPage * pageSize, totalCount);

  $: hasActiveFilters = Boolean(
    debouncedSearch.trim() ||
    selectedSalas.length > 0 ||
    selectedDispositivos.length > 0 ||
    selectedVerifyModes.length > 0 ||
    selectedEstados.length > 0 ||
    selectedFotos.length > 0 ||
    selectedEstatusEmpleados.length > 0 ||
    selectedDepartamentos.length > 0 ||
    selectedAreas.length > 0 ||
    selectedCargos.length > 0 ||
    selectedSexo.length > 0
  );

  $: totalFilters = (debouncedSearch.trim() ? 1 : 0) +
    selectedSalas.length +
    selectedDispositivos.length +
    selectedVerifyModes.length +
    selectedEstados.length +
    selectedFotos.length +
    selectedEstatusEmpleados.length +
    selectedDepartamentos.length +
    selectedAreas.length +
    selectedCargos.length +
    selectedSexo.length;

  $: activeFilterName = (function () {
    if (!hasActiveFilters) return "Ninguno";
    const parts = [];
    if (debouncedSearch.trim()) parts.push(`"${debouncedSearch.trim()}"`);
    if (selectedSalas.length > 0) parts.push(`${selectedSalas.length} sala(s)`);
    if (selectedEstatusEmpleados.length > 0) parts.push(`${selectedEstatusEmpleados.length} estatus emp.`);
    if (selectedDepartamentos.length > 0) parts.push(`${selectedDepartamentos.length} depto(s)`);
    if (selectedAreas.length > 0) parts.push(`${selectedAreas.length} área(s)`);
    if (selectedCargos.length > 0) parts.push(`${selectedCargos.length} cargo(s)`);
    if (selectedSexo.length > 0) parts.push(`${selectedSexo.length} sexo`);
    if (selectedDispositivos.length > 0) parts.push(`${selectedDispositivos.length} biométrico(s)`);
    if (selectedVerifyModes.length > 0) parts.push(`${selectedVerifyModes.length} tipo(s)`);
    if (selectedEstados.length > 0) parts.push(`${selectedEstados.length} estado(s)`);
    if (selectedFotos.length > 0) parts.push(selectedFotos.includes("con_foto") ? "Con Foto" : "Sin Foto");
    return parts.join(" | ");
  })();

  function clearAllFilters() {
    searchQuery = "";
    debouncedSearch = "";
    selectedSalas = [];
    selectedDispositivos = [];
    selectedVerifyModes = [];
    selectedEstados = [];
    selectedFotos = [];
    selectedEstatusEmpleados = [];
    selectedDepartamentos = [];
    selectedAreas = [];
    selectedCargos = [];
    selectedSexo = [];
    currentPage = 1;
    persistentMarcajesFilters.set({
      selectedSalas: [],
      selectedDispositivos: [],
      selectedVerifyModes: [],
      selectedEstados: [],
      selectedFotos: [],
      selectedEstatusEmpleados: [],
      selectedDepartamentos: [],
      selectedAreas: [],
      selectedCargos: [],
      selectedSexo: [],
      searchQuery: "",
      pageSize,
      currentPage: 1,
      sortBy,
      sortDir
    });
  }

  // Photo Lightbox Methods
  let lastKnownAttlogs = attlogs;
  let pendingModalPageDirection = null;

  $: if (attlogs !== lastKnownAttlogs) {
    lastKnownAttlogs = attlogs;
    if ($photoModalStore.isOpen && $photoModalStore.mode === 'marcajes_table') {
      if (pendingModalPageDirection && attlogs.length > 0) {
        const dir = pendingModalPageDirection;
        pendingModalPageDirection = null;
        updatePhotoModalItems({
          items: attlogs,
          currentPage: currentPage - 1,
          totalPages: totalPages || 1,
          totalCount,
          position: dir === 'next' ? 'first' : 'last'
        });
      }
    }
  }

  function changePageWithModal(targetPage, direction) {
    if (targetPage < 1 || targetPage > totalPages) {
      updatePhotoModalItems();
      return;
    }
    pendingModalPageDirection = direction;
    currentPage = targetPage;
    lastFetchKey = `${targetPage}_${pageSize}_${debouncedSearch}_${sortBy}_${sortDir}_${(assignedSalaIds || []).join(",")}_${selectedSalas.join(",")}_${selectedDispositivos.join(",")}_${selectedVerifyModes.join(",")}_${selectedEstados.join(",")}_${selectedFotos.join(",")}_${selectedEstatusEmpleados.join(",")}_${selectedDepartamentos.join(",")}_${selectedAreas.join(",")}_${selectedCargos.join(",")}_${selectedSexo.join(",")}`;

    const pageCacheKey = `pg_${targetPage}_${currentFilterCacheKey}`;
    if (attlogsPageCache.has(pageCacheKey)) {
      const cached = attlogsPageCache.get(pageCacheKey);
      attlogs = [...cached.data];
      totalCount = cached.total;
      pendingModalPageDirection = null;
      updatePhotoModalItems({
        items: attlogs,
        currentPage: targetPage - 1,
        totalPages: Math.ceil((cached.total || 0) / pageSize) || 1,
        totalCount: cached.total || 0,
        position: direction === 'next' ? 'first' : 'last'
      });
      return;
    }

    fetchAttlogs(targetPage, pageSize, debouncedSearch, sortBy, sortDir, assignedSalaIds);
  }

  function openPhotoModal(index) {
    const item = attlogs[index] || null;
    if (!item) return;
    triggerGlobalPhotoModal({
      item,
      items: attlogs,
      currentIndex: index,
      currentPage: currentPage - 1,
      totalPages: totalPages || 1,
      totalCount: totalCount || attlogs.length,
      mode: 'marcajes_table',
      onPageNext: () => {
        if (currentPage < totalPages) {
          changePageWithModal(currentPage + 1, 'next');
        } else {
          updatePhotoModalItems();
        }
      },
      onPagePrev: () => {
        if (currentPage > 1) {
          changePageWithModal(currentPage - 1, 'prev');
        } else {
          updatePhotoModalItems();
        }
      }
    });
  }

  async function downloadPhoto(record) {
    if (!record || !record.id) return;
    try {
      const url = getPhotoUrl(record.id);
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);

      const cedula = (record.employee_no || "empleado")
        .toString()
        .replace(/^#/, "")
        .trim();
      const rawTime = record.event_time || "foto";
      const cleanTime = rawTime
        .replace(/[\s:]+/g, "_")
        .replace(/[^a-zA-Z0-9_-]/g, "");
      const fileName = `${cedula}_${cleanTime}.jpg`;

      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.warn("Error downloading photo:", e);
      window.open(getPhotoUrl(record.id), "_blank");
    }
  }

  let modalCardElement;
  let isCapturingScreenshot = false;

  async function captureModalScreenshot() {
    if (!modalCardElement || isCapturingScreenshot) return;
    isCapturingScreenshot = true;
    try {
      const sourceCanvas = await html2canvas(modalCardElement, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
        logging: false,
        onclone: (clonedDoc, clonedElement) => {
          clonedElement.style.animation = "none";
          clonedElement.style.transition = "none";
          clonedElement.style.transform = "none";
          clonedElement.style.opacity = "1";
          const allAnim = clonedElement.querySelectorAll("*");
          allAnim.forEach((el) => {
            el.style.animation = "none";
            el.style.transition = "none";
          });
        }
      });

      const roundedCanvas = document.createElement("canvas");
      roundedCanvas.width = sourceCanvas.width;
      roundedCanvas.height = sourceCanvas.height;
      const ctx = roundedCanvas.getContext("2d");

      const w = sourceCanvas.width;
      const h = sourceCanvas.height;
      const r = 32;

      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(w - r, 0);
      ctx.quadraticCurveTo(w, 0, w, r);
      ctx.lineTo(w, h - r);
      ctx.quadraticCurveTo(w, h, w - r, h);
      ctx.lineTo(r, h);
      ctx.quadraticCurveTo(0, h, 0, h - r);
      ctx.lineTo(0, r);
      ctx.quadraticCurveTo(0, 0, r, 0);
      ctx.closePath();
      ctx.clip();

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);

      ctx.drawImage(sourceCanvas, 0, 0);

      const cedula = (
        selectedPhotoModal?.cedula ||
        selectedPhotoModal?.employee_no ||
        "empleado"
      )
        .toString()
        .replace(/^#/, "")
        .trim();
      const rawTime = selectedPhotoModal?.event_time || "ficha";
      const cleanTime = rawTime
        .replace(/[\s:]+/g, "_")
        .replace(/[^a-zA-Z0-9_-]/g, "");
      const fileName = `Ficha_${cedula}_${cleanTime}.png`;

      const link = document.createElement("a");
      link.href = roundedCanvas.toDataURL("image/png");
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Error al capturar screenshot de la ficha:", err);
    } finally {
      isCapturingScreenshot = false;
    }
  }

  function getAntiguedad(val) {
    if (!val || val === "—") return "";
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return "";
      const now = new Date();

      let years = now.getFullYear() - d.getFullYear();
      let months = now.getMonth() - d.getMonth();
      let days = now.getDate() - d.getDate();

      if (days < 0) {
        months--;
      }
      if (months < 0) {
        years--;
        months += 12;
      }

      if (years < 0) return "(0 días)";
      if (years === 0 && months === 0) {
        const diffMs = Math.max(0, now - d);
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        return `(${diffDays} ${diffDays === 1 ? "día" : "días"})`;
      }
      if (years === 0) {
        return `(${months} ${months === 1 ? "mes" : "meses"})`;
      }
      if (months === 0) {
        return `(${years} ${years === 1 ? "año" : "años"})`;
      }
      return `(${years} ${years === 1 ? "año" : "años"}, ${months} ${months === 1 ? "mes" : "m"})`;
    } catch (e) {
      return "";
    }
  }

  function getEdad(val) {
    if (!val || val === "—") return "";
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return "";
      const now = new Date();

      let years = now.getFullYear() - d.getFullYear();
      const m = now.getMonth() - d.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < d.getDate())) {
        years--;
      }
      if (years < 0) return "";
      return `(${years} ${years === 1 ? "año" : "años"})`;
    } catch (e) {
      return "";
    }
  }

  function cleanUtf8(str) {
    if (!str || str === "—") return "—";
    const s = String(str).trim();
    if (!/[ÃÂ]/.test(s)) return s;
    try {
      return decodeURIComponent(escape(s));
    } catch (e) {
      return s
        .replace(/Ã¡/g, "á")
        .replace(/Ã©/g, "é")
        .replace(/Ã­/g, "í")
        .replace(/Ã³/g, "ó")
        .replace(/Ãº/g, "ú")
        .replace(/Ã±/g, "ñ")
        .replace(/Ã /g, "Á")
        .replace(/Ã‰/g, "É")
        .replace(/Ã /g, "Í")
        .replace(/Ã“/g, "Ó")
        .replace(/Ãš/g, "Ú")
        .replace(/Ã‘/g, "Ñ")
        .replace(/Â/g, "");
    }
  }

  function formatDate(val) {
    if (!val || val === "—") return "—";
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return String(val).split("T")[0];
      const day = String(d.getUTCDate()).padStart(2, "0");
      const month = String(d.getUTCMonth() + 1).padStart(2, "0");
      const year = d.getUTCFullYear();
      return `${day}/${month}/${year}`;
    } catch (e) {
      return String(val).split("T")[0];
    }
  }

  function formatEventTime(val) {
    if (!val) return "—";
    let str = String(val).trim().replace("T", " ");
    if (str.includes("+")) str = str.split("+")[0];
    if (str.endsWith("Z")) str = str.substring(0, str.length - 1);
    if (str.includes(".")) str = str.split(".")[0];
    return str;
  }

  function formatVerifyMode(mode) {
    if (!mode && mode !== 0) {
      return { icon: "—", label: "Otro", color: "#64748b", bg: "#f1f5f9", border: "#e2e8f0" };
    }
    const raw = String(mode).trim();
    const str = raw.toLowerCase();
    if (str === "face" || str === "facial") {
      return { icon: "👤", label: "Facial", color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" };
    }
    if (str === "card" || str === "tarjeta" || str === "carnet") {
      return { icon: "💳", label: "Carnet", color: "#059669", bg: "#ecfdf5", border: "#a7f3d0" };
    }
    if (str === "faceorcard" || str === "cardorface") {
      return { icon: "👤💳", label: "Facial / Carnet", color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" };
    }
    if (str.includes("finger") || str.includes("huella")) {
      return { icon: "👆", label: "Huella", color: "#d97706", bg: "#fffbeb", border: "#fde68a" };
    }
    if (str.includes("pw") || str.includes("pass")) {
      return { icon: "🔢", label: "Contraseña", color: "#db2777", bg: "#fdf2f8", border: "#fbcfe8" };
    }
    return { icon: "🏷️", label: raw, color: "#475569", bg: "#f8fafc", border: "#e2e8f0" };
  }

  function getAvatarColor(empNo) {
    const colors = [
      "linear-gradient(135deg, #2563eb, #1d4ed8)",
      "linear-gradient(135deg, #059669, #047857)",
      "linear-gradient(135deg, #d97706, #b45309)",
      "linear-gradient(135deg, #7c3aed, #6d28d9)",
      "linear-gradient(135deg, #db2777, #be185d)",
    ];
    const num = parseInt(String(empNo).replace(/\D/g, "")) || 0;
    return colors[num % colors.length];
  }

  function getInitials(name, empNo) {
    if (name && name.trim().length > 0) {
      const parts = name.trim().split(" ");
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return name.trim().substring(0, 2).toUpperCase();
    }
    return String(empNo).substring(0, 2).toUpperCase();
  }

  function handleKeyDown(e) {
    if (selectedModalIndex !== null) {
      if (e.key === "Escape") closePhotoModal();
      if (e.key === "ArrowRight") modalNext();
      if (e.key === "ArrowLeft") modalPrev();
    }
  }

  let eventSource = null;
  let unsubscribeLatestAttlog = null;

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);

    // Live Socket / WebSocket Store para actualización instantánea en tiempo real
    unsubscribeLatestAttlog = latestAttlogEventStore.subscribe((newAtt) => {
      if (!newAtt || !newAtt.id) return;
      const attSalaId =
        newAtt.sala_id || (newAtt.dispositivo && newAtt.dispositivo.sala_id);
      if (
        assignedSalaIds.length > 0 &&
        attSalaId &&
        !assignedSalaIds.includes(Number(attSalaId))
      ) {
        return;
      }

      // 1. Limpiar caché en memoria para que los nuevos offsets y datos frescos se reflejen
      attlogsPageCache.clear();
      totalCount = totalCount + 1;

      // 2. Si estamos en la primera página y sin búsqueda activa, recargar inmediatamente con force=true
      if (currentPage === 1 && !debouncedSearch) {
        fetchAttlogs(
          currentPage,
          pageSize,
          debouncedSearch,
          sortBy,
          sortDir,
          assignedSalaIds,
          true, // silent
          true  // force (omite caché)
        );
      }
    });

    // SSE fallback
    try {
      const base = backendUrl.endsWith("/api")
        ? backendUrl
        : `${backendUrl}/api`;
      eventSource = new EventSource(`${base}/attlogs/stream`);
      eventSource.addEventListener("new_attlog", () => {
        attlogsPageCache.clear();
        totalCount = totalCount + 1;
        if (
          currentPage === 1 &&
          !debouncedSearch &&
          selectedModalIndex === null
        ) {
          fetchAttlogs(
            currentPage,
            pageSize,
            debouncedSearch,
            sortBy,
            sortDir,
            assignedSalaIds,
            true, // silent
            true  // force
          );
        }
      });
    } catch (err) {
      console.warn("SSE EventSource warning:", err);
    }
  });

  $: preparedCargos = (filterOptions.cargos || []).map(c => ({
    ...c,
    subgroup_label: c.departamento_nombre && c.area_nombre
      ? `${c.departamento_nombre} › ${c.area_nombre}`
      : (c.area_nombre || c.departamento_nombre || 'Sin Área')
  }));

  onDestroy(() => {
    if (searchTimeout) clearTimeout(searchTimeout);
    if (eventSource) eventSource.close();
    if (unsubscribeLatestAttlog) unsubscribeLatestAttlog();
    window.removeEventListener("keydown", handleKeyDown);
  });
</script>

<div class="space-y-4">
  <!-- Table Container Card -->
  <div
    class="table-container"
    style="background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); overflow: visible; position: relative;"
  >
    <!-- Top Toolbar: Search Bar + Cascading Smart Multiselect Filters -->
    <div
      class="table-toolbar"
      style="padding: 12px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; flex-direction: column; gap: 10px; border-top-left-radius: 12px; border-top-right-radius: 12px; position: relative; z-index: 40;"
    >
      <!-- Row 1: 10 Smart Cascading Multiselect Filters in Responsive Grid -->
      <div class="smart-filters-grid">
        <SmartMultiSelect
          id="filter-salas"
          label="Salas"
          options={filterOptions.salas}
          bind:selectedValues={selectedSalas}
          on:change={(e) => {
            selectedSalas = e.detail;
            currentPage = 1;
          }}
        />

        <SmartMultiSelect
          id="filter-empleados"
          label="Empleados"
          options={filterOptions.estatusEmpleados}
          bind:selectedValues={selectedEstatusEmpleados}
          on:change={(e) => {
            selectedEstatusEmpleados = e.detail;
            currentPage = 1;
          }}
        />

        <SmartMultiSelect
          id="filter-departamentos"
          label="Departamento"
          options={filterOptions.departamentos}
          groupBy="sala_nombre"
          bind:selectedValues={selectedDepartamentos}
          on:change={(e) => {
            selectedDepartamentos = e.detail;
            currentPage = 1;
          }}
        />

        <SmartMultiSelect
          id="filter-areas"
          label="Área"
          options={filterOptions.areas}
          groupParentBy="sala_nombre"
          groupBy="departamento_nombre"
          bind:selectedValues={selectedAreas}
          on:change={(e) => {
            selectedAreas = e.detail;
            currentPage = 1;
          }}
        />

        <SmartMultiSelect
          id="filter-cargos"
          label="Cargo"
          options={preparedCargos}
          groupParentBy="sala_nombre"
          groupBy="subgroup_label"
          bind:selectedValues={selectedCargos}
          on:change={(e) => {
            selectedCargos = e.detail;
            currentPage = 1;
          }}
        />

        <SmartMultiSelect
          id="filter-sexo"
          label="Sexo"
          options={filterOptions.sexo}
          bind:selectedValues={selectedSexo}
          on:change={(e) => {
            selectedSexo = e.detail;
            currentPage = 1;
          }}
        />

        <SmartMultiSelect
          id="filter-dispositivos"
          label="Biométricos"
          options={filterOptions.dispositivos}
          groupBy="sala_nombre"
          bind:selectedValues={selectedDispositivos}
          on:change={(e) => {
            selectedDispositivos = e.detail;
            currentPage = 1;
          }}
        />

        <SmartMultiSelect
          id="filter-tipo"
          label="Tipo Marcaje"
          options={filterOptions.verifyModes}
          bind:selectedValues={selectedVerifyModes}
          on:change={(e) => {
            selectedVerifyModes = e.detail;
            currentPage = 1;
          }}
        />

        <SmartMultiSelect
          id="filter-estado"
          label="Estado"
          options={filterOptions.estados}
          bind:selectedValues={selectedEstados}
          on:change={(e) => {
            selectedEstados = e.detail;
            currentPage = 1;
          }}
        />

        <SmartMultiSelect
          id="filter-fotos"
          label="Fotos"
          options={filterOptions.fotos}
          bind:selectedValues={selectedFotos}
          on:change={(e) => {
            selectedFotos = e.detail;
            currentPage = 1;
          }}
        />
      </div>

      <!-- Row 2: Search Input & Quick Clear Button -->
      <div style="display: flex; align-items: center; gap: 10px; width: 100%;">
        <div
          style="position: relative; display: flex; align-items: center; flex: 1;"
        >
          <input
            type="text"
            bind:value={searchQuery}
            placeholder="Buscar registros por empleado, cédula, sala, biométrico o ID..."
            style="width: 100%; padding: 8px 12px 8px 34px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; font-size: 13px; outline: none; transition: all 0.15s ease;"
          />
          <span
            style="position: absolute; left: 12px; font-size: 13px; color: #94a3b8; pointer-events: none;"
            >🔍</span
          >
        </div>

        {#if hasActiveFilters}
          <div
            style="display: flex; align-items: center; gap: 6px; white-space: nowrap;"
          >
            <button
              type="button"
              on:click={clearAllFilters}
              style="padding: 7px 14px; font-size: 12px; font-weight: 700; color: #ef4444; border: 1px solid #fca5a5; border-radius: 8px; background: #fef2f2; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: all 0.15s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.04);"
              title="Restablecer búsqueda y todos los filtros"
            >
              <span>✕</span> Limpiar Filtros ({totalFilters})
            </button>
          </div>
        {/if}
      </div>
    </div>

    <!-- Scrollable Table Wrapper -->
    <div
      class="table-scroll-wrapper"
      style="overflow-x: auto; position: relative;"
    >
      {#if isLoading && !isInitialLoad}
        <div
          style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(255,255,255,0.65); backdrop-filter: blur(1px); z-index: 5; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #2563eb;"
        >
          <span
            style="background: #ffffff; padding: 6px 16px; border-radius: 20px; border: 1px solid #cbd5e1; box-shadow: 0 4px 6px rgba(0,0,0,0.05);"
          >
            ⚡ Consultando backend PostgreSQL...
          </span>
        </div>
      {/if}

      <table
        class="data-table"
        style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;"
      >
        <thead>
          <tr
            style="background: #ffffff; border-bottom: 1px solid #e2e8f0; color: #475569; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px;"
          >
            <th style="width: 44px; padding: 6px 10px; text-align: center;"
              >FOTO</th
            >
            <th style="padding: 6px 14px; user-select: none;">ID</th>
            <th style="padding: 6px 14px; user-select: none;">ESTADO</th>
            <th style="padding: 6px 14px; user-select: none;">TIPO DE MARCAJE</th>
            <th style="padding: 6px 14px; user-select: none;">EMPLEADO</th>
            <th style="padding: 6px 14px; user-select: none;">CÉDULA</th>
            <th
              style="padding: 6px 14px; user-select: none; color: #1e3a8a; background: #eff6ff; font-weight: 800;"
              title="Ordenamiento obligatorio: Más recientes primero (FECHA Y HORA ▼)"
            >
              FECHA Y HORA ▼
            </th>
            <th style="padding: 6px 14px; user-select: none;">SALA</th>
            <th style="padding: 6px 14px; user-select: none;">EQUIPO / BIOMÉTRICO</th>
          </tr>
        </thead>

        <tbody>
          {#if attlogs.length === 0}
            <tr>
              <td
                colspan="9"
                style="padding: 24px; text-align: center; color: #64748b; font-size: 13px;"
              >
                {#if searchQuery.trim()}
                  No se encontraron registros de marcajes que coincidan con la
                  búsqueda "{searchQuery}".
                {:else}
                  Sin registros de marcajes en el sistema.
                {/if}
              </td>
            </tr>
          {:else}
            {#each attlogs as item, idx (`${item.id}_${idx}`)}
              {@const vMode = formatVerifyMode(item.currentverifymode)}
              <tr
                style="border-bottom: 1px solid #f1f5f9; background: #ffffff; transition: background 0.15s ease;"
              >
                <!-- Photo Thumbnail Column (Compact 26x26px) -->
                <td style="padding: 4px 10px; text-align: center;">
                  <button
                    type="button"
                    on:click={() => openPhotoModal(idx)}
                    style="padding: 0; border: none; background: transparent; cursor: pointer; border-radius: 6px; outline: none; position: relative; display: inline-flex; align-items: center; justify-content: center;"
                    title="Ampliar fotografía"
                  >
                    <img
                      src={getPhotoUrl(item.id)}
                      alt="Miniatura marcaje"
                      style="width: 26px; height: 26px; border-radius: 6px; object-fit: cover; border: 1px solid #3b82f6; background: #f1f5f9;"
                      on:error={(e) => {
                        const img = e.currentTarget;
                        const fallback = getFallbackProfilePhoto(item);
                        if (!img.dataset.triedProfile && fallback && img.src !== fallback && !img.src.endsWith(fallback)) {
                          img.dataset.triedProfile = "true";
                          img.src = fallback;
                        } else {
                          img.style.display = "none";
                          if (img.nextElementSibling)
                            img.nextElementSibling.style.display = "flex";
                        }
                      }}
                    />
                    <div
                      style="display: none; width: 26px; height: 26px; border-radius: 6px; background: {getAvatarColor(
                        item.employee_no,
                      )}; color: #ffffff; font-weight: 800; font-size: 10px; align-items: center; justify-content: center; box-shadow: 0 1px 2px rgba(0,0,0,0.1);"
                    >
                      {getInitials(toTitleCase(item.nombre), item.employee_no)}
                    </div>
                  </button>
                </td>

                <!-- ID -->
                <td
                  style="padding: 4px 14px; font-family: monospace; color: #334155; font-weight: 700;"
                >
                  #{item.id}
                </td>
                <td
                  style="padding: 4px 14px; font-family: monospace; color: #334155; font-weight: 700;"
                >
                  <span
                    style="font-size: 11.5px; font-weight: 700;
                  {item.attendancestatus === 'checkIn'
                      ? 'color: #22c55e;'
                      : item.attendancestatus === 'checkOut'
                        ? 'color: #c94145;'
                        : 'color: #ea580c;'}
                "
                  >
                    <span
                      style="width: 10px; height: 10px; border-radius: 50%; display: inline-block;
                {item.attendancestatus === 'checkIn'
                        ? 'background: #22c55e;'
                        : item.attendancestatus === 'checkOut'
                          ? 'background: #c94145;'
                          : 'background: #f97316;'}
                "
                    ></span>
                    {item.attendancestatus === "checkIn"
                      ? "ENTRADA"
                      : item.attendancestatus === "checkOut"
                        ? "SALIDA"
                        : "PUERTA / OTROS"}
                  </span>
                </td>

                <!-- Tipo de Marcaje -->
                <td
                  style="padding: 4px 14px; font-weight: 700; white-space: nowrap;"
                >
                  <span
                    style="display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 800; background: {vMode.bg}; color: {vMode.color}; border: 1px solid {vMode.border}; box-shadow: 0 1px 2px rgba(0,0,0,0.03);"
                    title="Método de verificación: {item.currentverifymode || 'Sin tipo'}"
                  >
                    <span style="font-size: 12px; line-height: 1;">{vMode.icon}</span>
                    <span>{vMode.label}</span>
                  </span>
                </td>

                <!-- Empleado -->
                <td
                  style="padding: 4px 14px; font-weight: 600; color: #0f172a;"
                >
                  {toTitleCase(item.nombre) ||
                    `Empleado ${(item.employee_no || "").replace(/^#/, "")}`}
                </td>

                <!-- Cédula -->
                <td
                  style="padding: 4px 14px; font-family: monospace; color: #2563eb; font-weight: 700;"
                >
                  {item.cedula || (item.employee_no || "").replace(/^#/, "")}
                </td>

                <!-- Fecha y Hora -->
                <td
                  style="padding: 4px 14px; color: #334155; white-space: nowrap;"
                >
                  {formatEventTime(item.event_time)}
                </td>

                <!-- Sala -->
                <td style="padding: 4px 14px; color: #334155;">
                  {item.sala_nombre || "—"}
                </td>

                <!-- Equipo / Biométrico -->
                <td
                  style="padding: 4px 14px; color: #475569; font-size: 12.5px;"
                >
                  {item.dispositivo_nombre || "—"}
                </td>
              </tr>
            {/each}
          {/if}
        </tbody>
      </table>
    </div>

    <!-- Bottom Footer with exact requested layout & 1000 limit for "Todas" -->
    <div
      class="table-toolbar"
      style="display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; background: #f8fafc; border-top: 1px solid #e2e8f0; flex-wrap: wrap; border-bottom-left-radius: 12px; border-bottom-right-radius: 12px;"
    >
      <!-- Left: Filters Info -->
      <div style="font-size: 13px; color: #475569; font-weight: 500;">
        Total: (<strong style="color: #0f172a; font-weight: 800;"
          >{totalCount}</strong
        >) &nbsp;|&nbsp; Filtros Totales: (<strong
          style="color: #0f172a; font-weight: 800;">{totalFilters}</strong
        >) &nbsp;Filtros:
        <span
          style="color: {totalFilters > 0
            ? '#2563eb'
            : '#64748b'}; font-weight: 700;">{activeFilterName}</span
        >
      </div>

      <!-- Right Controls: [10 filas v] [1 - 10 de 1839] [< 1 / 184 >] -->
      <div
        style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;"
      >
        <!-- Dropdown Filas -->
        <select
          value={pageSize}
          on:change={handlePageSizeChange}
          style="padding: 4px 8px; border-radius: 6px; border: 1px solid #cbd5e1; background: #ffffff; font-size: 13px; font-weight: 700; color: #0f172a; outline: none; cursor: pointer;"
        >
          <option value={10}>10 filas</option>
          <option value={50}>50 filas</option>
          <option value={100}>100 filas</option>
          <option value={1000}>1000 filas</option>
        </select>

        <!-- Range indicator -->
        <span style="font-size: 13px; font-weight: 700; color: #0f172a;">
          {startRecord} - {endRecord} de {totalCount}
        </span>

        <!-- Compact Pagination Group [< 1 / 184 >] -->
        <div
          style="display: flex; align-items: center; border: 1px solid #94a3b8; border-radius: 6px; overflow: hidden; background: #94a3b8;"
        >
          <button
            on:click={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            type="button"
            style="padding: 3px 8px; border: none; background: {currentPage ===
            1
              ? '#e2e8f0'
              : '#ffffff'}; color: #334155; font-size: 13px; font-weight: 800; cursor: {currentPage ===
            1
              ? 'not-allowed'
              : 'pointer'};"
          >
            &lt;
          </button>

          <span
            style="padding: 3px 10px; background: #94a3b8; color: #ffffff; font-size: 12px; font-weight: 800;"
          >
            {currentPage} / {totalPages}
          </span>

          <button
            on:click={() => goToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
            type="button"
            style="padding: 3px 8px; border: none; background: {currentPage ===
            totalPages
              ? '#e2e8f0'
              : '#ffffff'}; color: #334155; font-size: 13px; font-weight: 800; cursor: {currentPage ===
            totalPages
              ? 'not-allowed'
              : 'pointer'};"
          >
            &gt;
          </button>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .smart-filters-grid {
    display: grid;
    grid-template-columns: repeat(10, minmax(0, 1fr));
    gap: 6px;
    width: 100%;
  }

  @media (max-width: 1400px) {
    .smart-filters-grid {
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }
  }

  @media (max-width: 992px) {
    .smart-filters-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  @media (max-width: 768px) {
    .smart-filters-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 520px) {
    .smart-filters-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 360px) {
    .smart-filters-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
