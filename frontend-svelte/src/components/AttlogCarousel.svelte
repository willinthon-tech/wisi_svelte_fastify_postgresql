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

  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import { get } from "svelte/store";
  const dispatch = createEventDispatcher();
  function cleanUtf8(str) {
    if (!str || str === "—") return "—";
    return String(str).trim();
  }

  function getAttendanceStatusBadge(rawStatus) {
    const s = String(rawStatus || "").toLowerCase().trim();
    if (s === "checkin" || s === "entrada") {
      return { label: "ENTRADA", color: "#15803d", bgDot: "#22c55e", borderColor: "#22c55e" };
    }
    if (s === "checkout" || s === "salida") {
      return { label: "SALIDA", color: "#b91c1c", bgDot: "#c94145", borderColor: "#c94145" };
    }
    return { label: "INDEFINIDO", color: "#b91c1c", bgDot: "#ef4444", borderColor: "#ef4444" };
  }

  import { 
    photoModalStore, 
    openPhotoModal as triggerGlobalPhotoModal, 
    updatePhotoModalItems 
  } from "../controllers/globalModal.store.js";
  import { getCloudBaseUrl } from "../config/api.config.js";
  import {
    userSalasStore as masterUserSalasStore,
    masterDispositivosStore,
  } from "../controllers/master.store.js";
  import {
    currentUserStore,
    userSalasStore as authUserSalasStore,
  } from "../controllers/auth.store.js";

  let latestAttlogs = [];
  let pollInterval = null;
  let isLoading = true;

  // Pagination state (10 items per page: 5 columns x 2 rows)
  let currentPage = 0;
  const pageSize = 10;
  let totalCount = 0;

  // Lightbox Modal index state
  let selectedModalIndex = null;

  const backendUrl = getCloudBaseUrl();
  function getFallbackProfilePhoto(record) {
    if (!record) return null;
    const empFoto =
      record.empleado_foto ||
      record.foto ||
      (record.empleado_id ? `/empleados/${record.empleado_id}.jpg` : null);
    if (!empFoto) return null;
    if (empFoto.startsWith("http")) return empFoto;
    return empFoto.startsWith("/") ? empFoto : `/${empFoto}`;
  }

  // Extract assigned sala IDs strictly for the logged in user
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

  $: assignedDispositivos = $masterDispositivosStore.filter(
    (d) =>
      assignedSalaIds.length > 0 && assignedSalaIds.includes(Number(d.sala_id)),
  );
  $: dispositivosCount = assignedDispositivos.length;

  let activeRecord = null;

  $: selectedPhotoModal =
    activeRecord ||
    (selectedModalIndex !== null && latestAttlogs[selectedModalIndex]
      ? latestAttlogs[selectedModalIndex]
      : null);

  function getPhotoUrl(id) {
    if (!id) return "";
    return `/attlogs/${id}.jpg`;
  }

  async function fetchLatestAttlogs() {
    try {
      const base = backendUrl.endsWith("/api")
        ? backendUrl
        : `${backendUrl}/api`;
      const offset = currentPage * pageSize;

      const salaParam =
        assignedSalaIds.length > 0 ? assignedSalaIds.join(",") : "-1";
      const queryParams = `limit=${pageSize}&offset=${offset}&user_sala_ids=${salaParam}`;

      const res = await fetch(`${base}/attlogs/latest?${queryParams}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          latestAttlogs = json.data;
          totalCount = json.total || 0;
          if (currentPage === 0 && json.data.length > 0) {
            dispatch("latestRecord", json.data[0]);
          }
        }
      }
    } catch (e) {
      console.warn("Error fetching latest attlogs carousel:", e);
    } finally {
      isLoading = false;
    }
  }

  function nextPage() {
    if ((currentPage + 1) * pageSize < totalCount) {
      currentPage++;
      isLoading = true;
      fetchLatestAttlogs();
    }
  }

  function prevPage() {
    if (currentPage > 0) {
      currentPage--;
      isLoading = true;
      fetchLatestAttlogs();
    }
  }

  let lastKnownAttlogs = latestAttlogs;
  let pendingModalPageDirection = null;

  $: if (latestAttlogs !== lastKnownAttlogs) {
    lastKnownAttlogs = latestAttlogs;
    if ($photoModalStore.isOpen && ($photoModalStore.mode === 'live_records' || $photoModalStore.mode === 'checkin_checkout')) {
      if (pendingModalPageDirection && latestAttlogs.length > 0) {
        const dir = pendingModalPageDirection;
        pendingModalPageDirection = null;
        updatePhotoModalItems({
          items: latestAttlogs,
          currentPage,
          totalPages: Math.ceil(totalCount / pageSize) || 1,
          totalCount,
          position: dir === 'next' ? 'first' : 'last'
        });
      }
    }
  }

  export function openPhotoModal(index) {
    const item = latestAttlogs[index] || null;
    if (!item) return;
    triggerGlobalPhotoModal({
      item,
      items: latestAttlogs,
      currentIndex: index,
      currentPage,
      totalPages: Math.ceil(totalCount / pageSize) || 1,
      totalCount,
      mode: 'live_records',
      onPageNext: () => {
        if ((currentPage + 1) * pageSize < totalCount) {
          pendingModalPageDirection = 'next';
          nextPage();
        }
      },
      onPagePrev: () => {
        if (currentPage > 0) {
          pendingModalPageDirection = 'prev';
          prevPage();
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
        backgroundColor: null,
        logging: false
      });

      // Crear canvas con bordes redondeados suaves (border-radius 16px escalado a 32px para nitidez 2x)
      const roundedCanvas = document.createElement("canvas");
      roundedCanvas.width = sourceCanvas.width;
      roundedCanvas.height = sourceCanvas.height;
      const ctx = roundedCanvas.getContext("2d");

      const w = sourceCanvas.width;
      const h = sourceCanvas.height;
      const r = 32; // 16px * scale 2

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

      ctx.drawImage(sourceCanvas, 0, 0);

      const cedula = (selectedPhotoModal?.cedula || selectedPhotoModal?.employee_no || "empleado")
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

  export async function openModalWithRecord(record) {
    if (!record || !record.id) return;
    try {
      const base = backendUrl.endsWith("/api") ? backendUrl : `${backendUrl}/api`;
      const salaParam = assignedSalaIds.length > 0 ? assignedSalaIds.join(",") : "";

      // 1. Obtener la posición global real en el flujo sin filtrar de marcajes (idéntico a rrhh/marcajes)
      let targetPage = 0;
      let targetIndex = 0;
      try {
        const qPos = new URLSearchParams();
        if (salaParam) qPos.set("user_sala_ids", salaParam);
        const posRes = await fetch(`${base}/attlogs/${record.id}/position?${qPos.toString()}`);
        if (posRes.ok) {
          const posJson = await posRes.json();
          if (posJson.success && posJson.data) {
            const gIdx = posJson.data.globalIndex || 0;
            targetPage = Math.floor(gIdx / pageSize);
            targetIndex = gIdx % pageSize;
          }
        }
      } catch (e) {
        console.warn("No se pudo obtener posición global:", e);
      }

      // 2. Cargar los registros de la página donde se encuentra el registro solicitado
      let pageItems = latestAttlogs;
      if (targetPage !== currentPage || latestAttlogs.length === 0) {
        const offset = targetPage * pageSize;
        const q = new URLSearchParams({
          limit: String(pageSize),
          offset: String(offset),
        });
        if (salaParam) q.set("user_sala_ids", salaParam);
        const res = await fetch(`${base}/attlogs/latest?${q.toString()}`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data) && json.data.length > 0) {
            pageItems = json.data;
            totalCount = json.total || totalCount;
            currentPage = targetPage;
            latestAttlogs = json.data;
          }
        }
      }

      // Localizar el item exacto en la lista obtenida
      let activeItem = pageItems.find(p => String(p.id) === String(record.id)) || pageItems[targetIndex] || record;
      const foundIdx = pageItems.findIndex(p => String(p.id) === String(activeItem.id));
      if (foundIdx !== -1) {
        targetIndex = foundIdx;
      }

      triggerGlobalPhotoModal({
        item: activeItem,
        items: pageItems,
        currentIndex: targetIndex,
        currentPage: targetPage,
        totalPages: Math.ceil(totalCount / pageSize) || 1,
        totalCount,
        mode: "live_records",
        onPageNext: () => {
          if ((currentPage + 1) * pageSize < totalCount) {
            pendingModalPageDirection = "next";
            nextPage();
          }
        },
        onPagePrev: () => {
          if (currentPage > 0) {
            pendingModalPageDirection = "prev";
            prevPage();
          }
        }
      });
    } catch (err) {
      console.error("Error abriendo modal con posición real:", err);
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

  function formatEventTime(val) {
    if (!val) return "";
    let str = String(val).trim().replace("T", " ");
    if (str.includes("+")) str = str.split("+")[0];
    if (str.endsWith("Z")) str = str.substring(0, str.length - 1);
    if (str.includes(".")) str = str.split(".")[0];
    return str;
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
    }
  }

  $: totalPages = Math.ceil(totalCount / pageSize) || 1;

  import { latestAttlogEventStore } from "../controllers/websocket.store.js";

  let unsubscribeWs = null;
  let handleGlobalOpenModal = null;

  onMount(() => {
    fetchLatestAttlogs();
    unsubscribeWs = latestAttlogEventStore.subscribe((newRecord) => {
      if (!newRecord) return;

      const recSalaId = Number(newRecord.sala_id || newRecord.dispositivo_sala_id);
      if (
        recSalaId &&
        assignedSalaIds.length > 0 &&
        !assignedSalaIds.includes(recSalaId)
      )
        return;

      // Incrementar contador total en tiempo real
      totalCount++;

      // 1. Si el carrusel de fondo está en la página 0, insertar y ordenar estrictamente por event_time DESC
      if (currentPage === 0) {
        const combined = [
          newRecord,
          ...latestAttlogs.filter((a) => String(a.id) !== String(newRecord.id)),
        ];
        combined.sort((a, b) => {
          const tA = new Date(a.event_time).getTime() || 0;
          const tB = new Date(b.event_time).getTime() || 0;
          if (tA !== tB) return tB - tA;
          return Number(b.id || 0) - Number(a.id || 0);
        });
        latestAttlogs = combined.slice(0, pageSize);
        if (latestAttlogs.length > 0) {
          dispatch("latestRecord", latestAttlogs[0]);
        }
      }

      // 2. Si el modal global está abierto en modo de registros en vivo:
      const modalState = get(photoModalStore);
      if (
        modalState.isOpen &&
        (modalState.mode === "live_records" || modalState.mode === "checkin_checkout")
      ) {
        if (modalState.currentPage === 0) {
          const combinedModal = [
            newRecord,
            ...modalState.items.filter((a) => String(a.id) !== String(newRecord.id)),
          ];
          combinedModal.sort((a, b) => {
            const tA = new Date(a.event_time).getTime() || 0;
            const tB = new Date(b.event_time).getTime() || 0;
            if (tA !== tB) return tB - tA;
            return Number(b.id || 0) - Number(a.id || 0);
          });

          // Caso A: El usuario está parado en el último registro en vivo (página 0, índice 0)
          if (modalState.currentIndex === 0) {
            photoModalStore.update((s) => ({
              ...s,
              items: combinedModal.slice(0, pageSize),
              activeItem: newRecord,
              currentIndex: 0,
              totalCount: totalCount,
              totalPages: Math.ceil(totalCount / pageSize) || 1,
            }));
          } else {
            // Caso B: El usuario está inspeccionando un registro anterior (índice > 0)
            const currentViewingId = modalState.activeItem?.id;
            const newIdx = combinedModal.findIndex(
              (a) => String(a.id) === String(currentViewingId)
            );

            if (newIdx !== -1 && newIdx < pageSize) {
              photoModalStore.update((s) => ({
                ...s,
                items: combinedModal.slice(0, pageSize),
                currentIndex: newIdx,
                totalCount: totalCount,
                totalPages: Math.ceil(totalCount / pageSize) || 1,
              }));
            } else {
              photoModalStore.update((s) => ({
                ...s,
                totalCount: totalCount,
                totalPages: Math.ceil(totalCount / pageSize) || 1,
              }));
            }
          }
        } else {
          // Está en página >= 1: simplemente actualizamos el totalCount en el modal
          photoModalStore.update((s) => ({
            ...s,
            totalCount: totalCount,
            totalPages: Math.ceil(totalCount / pageSize) || 1,
          }));
        }
      }
    });
    handleGlobalOpenModal = (e) => {
      if (e.detail) {
        openModalWithRecord(e.detail);
      }
    };
    window.addEventListener("wisi:open-attlog-modal", handleGlobalOpenModal);
    window.addEventListener("keydown", handleKeyDown);
  });

  onDestroy(() => {
    if (unsubscribeWs) unsubscribeWs();
    if (pollInterval) clearInterval(pollInterval);
    window.removeEventListener("keydown", handleKeyDown);
    if (handleGlobalOpenModal) {
      window.removeEventListener("wisi:open-attlog-modal", handleGlobalOpenModal);
    }
  });
</script>

<div style="margin-top: 24px; position: relative;">
  <!-- Section Header -->
  <div
    style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;"
  >
    <div style="display: flex; align-items: center; gap: 8px;">
      <h3
        style="margin: 0; font-size: 16px; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px;"
      >
        <span
          style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #10b981; box-shadow: 0 0 10px #10b981;"
        ></span>
        Últimos Registros en Vivo
      </h3>
      <span
        style="font-size: 11px; font-weight: 700; padding: 2px 8px; background: #dcfce7; color: #15803d; border-radius: 12px;"
      >
        {assignedSalaIds.length > 0
          ? `${assignedSalaIds.length} Salas Asignadas`
          : "Todas las Salas"}
      </span>
      <span
        style="font-size: 11px; font-weight: 700; padding: 2px 8px; background: #e0f2fe; color: #0369a1; border-radius: 12px;"
      >
        {dispositivosCount} Biométricos Asignados
      </span>
    </div>

    <!-- Page Controls & Navigation Arrows -->
    <div style="display: flex; align-items: center; gap: 12px;">
      <span style="font-size: 12px; font-weight: 700; color: #64748b;">
        Página {currentPage + 1} de {totalPages} ({totalCount} registros)
      </span>

      <div style="display: flex; align-items: center; gap: 6px;">
        <button
          on:click={prevPage}
          disabled={currentPage === 0}
          type="button"
          style="width: 34px; height: 34px; border-radius: 8px; border: 1px solid #cbd5e1; background: {currentPage ===
          0
            ? '#f1f5f9'
            : '#ffffff'}; color: {currentPage === 0
            ? '#94a3b8'
            : '#1e293b'}; font-size: 16px; font-weight: 800; cursor: {currentPage ===
          0
            ? 'not-allowed'
            : 'pointer'}; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); transition: all 0.15s ease;"
          title="Página anterior (10 marcajes)"
        >
          ‹
        </button>
        <button
          on:click={nextPage}
          disabled={(currentPage + 1) * pageSize >= totalCount}
          type="button"
          style="width: 34px; height: 34px; border-radius: 8px; border: 1px solid #cbd5e1; background: {(currentPage +
            1) *
            pageSize >=
          totalCount
            ? '#f1f5f9'
            : '#ffffff'}; color: {(currentPage + 1) * pageSize >= totalCount
            ? '#94a3b8'
            : '#1e293b'}; font-size: 16px; font-weight: 800; cursor: {(currentPage +
            1) *
            pageSize >=
          totalCount
            ? 'not-allowed'
            : 'pointer'}; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); transition: all 0.15s ease;"
          title="Siguiente página (10 marcajes)"
        >
          ›
        </button>
      </div>
    </div>
  </div>

  <!-- Carousel Container (4 Cards Page) -->
  {#if isLoading}
    <div
      style="padding: 32px; text-align: center; color: #64748b; font-size: 13px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;"
    >
      Consultando marcajes en tiempo real desde la base de datos...
    </div>
  {:else if latestAttlogs.length === 0}
    <div
      style="padding: 32px; text-align: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; color: #64748b; font-size: 13px;"
    >
      Sin marcajes recientes registrados en tus salas asignadas. Conecta un
      biométrico para ver eventos en vivo.
    </div>
  {:else}
    <div
      style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px;"
    >
      {#each latestAttlogs as log, idx (`${log.id}_${idx}`)}
        {@const stBadge = getAttendanceStatusBadge(log.attendancestatus)}
        <div
          style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); display: flex; flex-direction: column; justify-content: space-between; transition: all 0.2s ease; position: relative; min-width: 0; overflow: hidden;"
        >
          <!-- Top Row: Photo Avatar & Employee Info -->
          <div
            style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px; min-width: 0;"
          >
            <!-- Employee Photo Button (Click to enlarge) -->
            <button
              type="button"
              on:click={() => openPhotoModal(idx)}
              style="position: relative; width: 44px; height: 44px; flex-shrink: 0; padding: 0; border: none; background: transparent; cursor: pointer; border-radius: 10px; outline: none;"
              title="Hacer clic para ampliar fotografía en grande"
            >
              <img
                src={getPhotoUrl(log.id)}
                alt="Foto marcaje"
                style="width: 44px; height: 44px; border-radius: 10px; object-fit: cover; border: 2px solid {stBadge.borderColor}; background: #f1f5f9; transition: transform 0.2s ease;"
                on:error={(e) => {
                  const img = e.currentTarget;
                  const empFoto = log.empleado_foto || log.foto;
                  const empId = log.empleado_id;
                  if (!img.dataset.triedProfile && empFoto) {
                    img.dataset.triedProfile = "true";
                    img.src = empFoto.startsWith("http") ? empFoto : `${backendUrl}${empFoto.startsWith("/") ? "" : "/"}${empFoto}`;
                  } else if (!img.dataset.triedProfile && empId) {
                    img.dataset.triedProfile = "true";
                    img.src = `${backendUrl}/empleados/${empId}.jpg`;
                  } else {
                    img.style.display = "none";
                    if (img.nextElementSibling)
                      img.nextElementSibling.style.display = "flex";
                  }
                }}
              />

              <div
                style="display: none; width: 44px; height: 44px; border-radius: 10px; background: {getAvatarColor(
                  log.employee_no,
                )}; color: #ffffff; font-weight: 800; font-size: 14px; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1);"
              >
                {getInitials(toTitleCase(log.nombre), log.employee_no)}
              </div>

              <div
                style="position: absolute; right: -2px; bottom: -2px; width: 15px; height: 15px; background: #2563eb; color: #ffffff; border-radius: 50%; font-size: 8px; display: flex; align-items: center; justify-content: center; border: 1.5px solid #ffffff;"
              >
                🔍
              </div>
            </button>

            <!-- Name & Employee No -->
            <div style="flex: 1; min-width: 0; overflow: hidden;">
              <span
                style="font-size: 11px; font-weight: 800; display: inline-flex; align-items: center; gap: 4px; color: {stBadge.color};"
              >
                <span
                  style="width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: {stBadge.bgDot};"
                ></span>
                {stBadge.label}
              </span>
              <div
                style="font-size: 12.5px; font-weight: 800; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
                title={toTitleCase(log.nombre) ||
                  `Empleado ${log.cedula || (log.employee_no || "").replace(/^#/, "")}`}
              >
                {toTitleCase(log.nombre) ||
                  `Empleado ${log.cedula || (log.employee_no || "").replace(/^#/, "")}`}
              </div>
              <div
                style="font-size: 10.5px; font-weight: 700; font-family: monospace; color: #2563eb; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
              >
                {log.cedula || (log.employee_no || "").replace(/^#/, "")}
              </div>
            </div>
          </div>

          <!-- Middle Row: DateTime & Location -->
          <div
            style="background: #f8fafc; border: 1px solid #f1f5f9; border-radius: 8px; padding: 8px 10px; font-size: 11.5px; min-width: 0; overflow: hidden;"
          >
            <div
              style="display: flex; align-items: center; gap: 6px; color: #334155; font-weight: 700; margin-bottom: 3px;"
            >
              <span style="flex-shrink: 0;">🕒</span>
              <span
                style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"
                >{formatEventTime(log.event_time)}</span
              >
            </div>
            <div
              style="display: flex; align-items: center; gap: 4px; font-size: 11px; color: #64748b; min-width: 0; overflow: hidden;"
            >
              <span style="flex-shrink: 0;">📍</span>
              <span
                style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; min-width: 0;"
                title="{log.sala_nombre || 'Sala'} - {log.dispositivo_nombre ||
                  'Biométrico'}"
              >
                {log.sala_nombre || "Sala"} ({log.dispositivo_nombre ||
                  "Biométrico"})
              </span>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
