<script>
  import { onMount, onDestroy } from "svelte";
  import {
    photoModalStore,
    closePhotoModal,
    photoModalNext,
    photoModalPrev
  } from "../../controllers/globalModal.store.js";
  import { getCloudBaseUrl, toBackendUrl } from "../../config/api.config.js";
  import html2canvas from "html2canvas";
  import { saveOrShareFile } from "../../utils/fileSaver.js";
  import { triggerToast } from "../../controllers/ui.store.js";
  import {
    preloadPhoto,
    isPhotoLoaded,
    preloadPhotosBatch,
    getCachedBlobUrl
  } from "../../utils/photoPreloader.js";

  const backendUrl = getCloudBaseUrl();

  let modalCardElement = null;
  let imgElement = null;
  let isCapturingScreenshot = false;
  let isDownloadingPhoto = false;
  let isNavigating = false;
  let navCooldownTimer = null;
  let isWaitingForPagePhoto = false;
  let pagePhotoSafetyTimer = null;

  $: isOpen = $photoModalStore.isOpen;
  $: item = $photoModalStore.activeItem;
  $: items = $photoModalStore.items || [];
  $: currentIndex = $photoModalStore.currentIndex;
  $: currentPage = $photoModalStore.currentPage;
  $: totalPages = $photoModalStore.totalPages;
  $: totalCount = $photoModalStore.totalCount;
  $: mode = $photoModalStore.mode;
  $: isPageTransitioning = $photoModalStore.isPageTransitioning;
  $: pageTransitionDirection = $photoModalStore.pageTransitionDirection;

  // Foto activa en proceso de carga inicial
  $: isCurrentPhotoLoading = Boolean(activePhotoUrl && !isCurrentPhotoLoaded && !isCurrentPhotoError);

  // Mantener el spinner de cambio de página hasta que la foto del registro entrante cargue o falle
  $: if (isPageTransitioning) {
    isWaitingForPagePhoto = true;
    if (pagePhotoSafetyTimer) clearTimeout(pagePhotoSafetyTimer);
    pagePhotoSafetyTimer = setTimeout(() => {
      isWaitingForPagePhoto = false;
    }, 5000);
  }

  $: if (isWaitingForPagePhoto && !isPageTransitioning) {
    if (isCurrentPhotoLoaded || isCurrentPhotoError || !activePhotoUrl) {
      if (pagePhotoSafetyTimer) {
        clearTimeout(pagePhotoSafetyTimer);
        pagePhotoSafetyTimer = null;
      }
      isWaitingForPagePhoto = false;
    }
  }

  $: showPageSpinner = isPageTransitioning || isWaitingForPagePhoto;
  $: stInfo = getStatusBadge(item?.attendancestatus);

  $: isFirstPage = currentPage <= 0;
  $: isLastPage = totalPages <= 1 || (currentPage >= totalPages - 1);
  $: isPrevDisabled = (currentIndex <= 0 && isFirstPage) || showPageSpinner || isCurrentPhotoLoading || isNavigating;
  $: isNextDisabled = (currentIndex >= items.length - 1 && isLastPage) || showPageSpinner || isCurrentPhotoLoading || isNavigating;
  $: isSingleRecordMode = mode === 'ultimo_registro' || mode === 'alerta' || (totalPages <= 1 && items.length <= 1);

  function safeNavigateNext() {
    if (isNextDisabled || isCurrentPhotoLoading || isNavigating || showPageSpinner) return;
    isNavigating = true;
    photoModalNext();
    if (navCooldownTimer) clearTimeout(navCooldownTimer);
    navCooldownTimer = setTimeout(() => {
      isNavigating = false;
    }, 200);
  }

  function safeNavigatePrev() {
    if (isPrevDisabled || isCurrentPhotoLoading || isNavigating || showPageSpinner) return;
    isNavigating = true;
    photoModalPrev();
    if (navCooldownTimer) clearTimeout(navCooldownTimer);
    navCooldownTimer = setTimeout(() => {
      isNavigating = false;
    }, 200);
  }

  // Atajos de teclado: Escape para cerrar, Flechas para navegar con control de repetición y carga
  function handleKeyDown(e) {
    if (!isOpen) return;
    if (e.key === "Escape") {
      closePhotoModal();
      return;
    }
    if (showPageSpinner || isCurrentPhotoLoading || isNavigating) return;
    if (e.repeat) {
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowLeft" && !isPrevDisabled && !isSingleRecordMode) {
      e.preventDefault();
      safeNavigatePrev();
    } else if (e.key === "ArrowRight" && !isNextDisabled && !isSingleRecordMode) {
      e.preventDefault();
      safeNavigateNext();
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeyDown);
    if (navCooldownTimer) clearTimeout(navCooldownTimer);
    if (pagePhotoSafetyTimer) clearTimeout(pagePhotoSafetyTimer);
  });

  function cleanUtf8(str) {
    if (!str) return "";
    return String(str)
      .replace(/Ã¡/g, "á").replace(/Ã©/g, "é").replace(/Ã­/g, "í").replace(/Ã³/g, "ó").replace(/Ãº/g, "ú")
      .replace(/Ã/g, "Á").replace(/Ã/g, "É").replace(/Ã/g, "Í").replace(/Ã/g, "Ó").replace(/Ã/g, "Ú")
      .replace(/Ã±/g, "ñ").replace(/Ã/g, "Ñ")
      .trim();
  }

  function toTitleCase(str) {
    if (!str) return "";
    return cleanUtf8(str)
      .toLowerCase()
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  function formatCedulaDisplay(val) {
    if (!val || val === "—") return "—";
    let str = String(val).replace(/^#/, "").trim();
    if (!str) return "—";
    if (/^\d+$/.test(str)) {
      return `V${str}`;
    }
    return str.toUpperCase();
  }

  function parseLocalDate(raw) {
    if (!raw) return null;
    let str = "";
    if (raw instanceof Date) {
      str = raw.toISOString().split("T")[0];
    } else {
      str = String(raw).trim();
    }
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      return new Date(year, month, day, 12, 0, 0);
    }
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDate(raw) {
    if (!raw) return "—";
    try {
      const str = raw instanceof Date ? raw.toISOString().split("T")[0] : String(raw).trim();
      const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        return `${match[3]}/${match[2]}/${match[1]}`;
      }
      const d = parseLocalDate(raw);
      if (!d || isNaN(d.getTime())) return "—";
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    } catch {
      return "—";
    }
  }

  function formatEventTime(timeStr) {
    if (!timeStr) return "—";
    const clean = String(timeStr).replace("T", " ");
    return clean.split(".")[0];
  }

  function getEdad(fechaNac) {
    if (!fechaNac) return "";
    try {
      const b = parseLocalDate(fechaNac);
      if (!b || isNaN(b.getTime())) return "";
      const now = new Date();
      let age = now.getFullYear() - b.getFullYear();
      const m = now.getMonth() - b.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
      return age > 0 ? `(${age} años)` : "";
    } catch {
      return "";
    }
  }

  function getAntiguedad(fechaIngreso) {
    if (!fechaIngreso) return "";
    try {
      const d = parseLocalDate(fechaIngreso);
      if (!d || isNaN(d.getTime())) return "";
      const now = new Date();
      let years = now.getFullYear() - d.getFullYear();
      let months = now.getMonth() - d.getMonth();
      if (now.getDate() < d.getDate()) months--;
      if (months < 0) {
        years--;
        months += 12;
      }
      if (years > 0) {
        return months > 0 ? `(${years} año${years > 1 ? "s" : ""}, ${months} m)` : `(${years} año${years > 1 ? "s" : ""})`;
      }
      if (months > 0) return `(${months} mes${months > 1 ? "es" : ""})`;
      const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
      return `(${Math.max(0, diffDays)} días)`;
    } catch {
      return "";
    }
  }

  function getPhotoUrl(record) {
    if (!record) return "";
    
    // Si es un empleado o desincorporado (sin evento de marcaje), usa su foto de empleado
    if (mode === 'empleado' || mode === 'desincorporado') {
      if (record.foto && typeof record.foto === 'string' && record.foto.trim().length > 0) {
        return toBackendUrl(record.foto);
      }
      const empId = record.empleado_id || record.id;
      if (empId) return toBackendUrl(`/empleados/${empId}.jpg`);
      return "";
    }

    // Para cualquier registro de marcaje (último registro, alerta, marcajes_table, live_records, etc.)
    // LA FOTO DEL MARCAJE / EVENTO TIENE PRIORIDAD ABSOLUTA
    const attId = record.id || record.attlog_id;
    if (attId) {
      return toBackendUrl(`/attlogs/${attId}.jpg`);
    }

    // Solo si el registro no tiene ID de marcaje pasa a la de personal
    if (record.empleado_foto && typeof record.empleado_foto === 'string' && record.empleado_foto.trim().length > 0) {
      return toBackendUrl(record.empleado_foto);
    }
    if (record.foto && typeof record.foto === 'string' && record.foto.trim().length > 0) {
      return toBackendUrl(record.foto);
    }
    if (record.empleado_id) {
      return toBackendUrl(`/empleados/${record.empleado_id}.jpg`);
    }

    return "";
  }

  // Caché de URLs resueltas por cada registro para garantizar retroceso instantáneo (0ms)
  const resolvedPhotoUrlCache = new Map();

  let activePhotoUrl = "";
  let isCurrentPhotoLoaded = false;
  let isCurrentPhotoError = false;
  let currentActivePhotoRequestId = 0;

  function resolveItemPhoto(record) {
    if (!record) return "";
    const key = record.id ? `rec_${record.id}` : `ced_${record.cedula || record.employee_no}`;
    if (resolvedPhotoUrlCache.has(key)) {
      const cached = resolvedPhotoUrlCache.get(key);
      if (cached) return cached;
    }
    const rawUrl = getPhotoUrl(record);
    if (!rawUrl) return "";
    // Si ya fue descargada y convertida en Blob ObjectURL en memoria RAM, usarla de inmediato (0ms, 0 red)
    const blobUrl = getCachedBlobUrl(rawUrl);
    if (blobUrl && blobUrl.startsWith('blob:')) {
      resolvedPhotoUrlCache.set(key, blobUrl);
      return blobUrl;
    }
    return rawUrl;
  }

  // Precargar en paralelo ÚNICAMENTE la foto principal del lote a Blob ObjectURLs en RAM
  let lastBatchPage = null;
  $: if (isOpen && items && items.length > 0 && typeof window !== 'undefined') {
    if (currentPage !== lastBatchPage) {
      lastBatchPage = currentPage;

      const urlsToPreload = [];
      items.forEach((it) => {
        const u = getPhotoUrl(it);
        if (u) urlsToPreload.push(u);
      });
      if (urlsToPreload.length > 0) {
        preloadPhotosBatch(urlsToPreload).then(() => {
          // Si el item activo ya obtuvo su BlobURL en RAM, asignarlo directamente sin tocar la red
          if (item) {
            const raw = getPhotoUrl(item);
            const b = getCachedBlobUrl(raw);
            if (b && b.startsWith('blob:') && activePhotoUrl !== b) {
              activePhotoUrl = b;
              isCurrentPhotoLoaded = true;
              isCurrentPhotoError = false;
              const key = item.id ? `rec_${item.id}` : `ced_${item.cedula || item.employee_no}`;
              resolvedPhotoUrlCache.set(key, b);
            }
          }
        });
      }
    }
  }

  // Sincronización de la foto activa actual al navegar adelante o atrás
  $: if (item) {
    const reqId = ++currentActivePhotoRequestId;
    const url = resolveItemPhoto(item);
    activePhotoUrl = url;

    if (!url) {
      isCurrentPhotoLoaded = false;
      isCurrentPhotoError = true;
    } else if (url.startsWith('blob:') || isPhotoLoaded(url)) {
      isCurrentPhotoLoaded = true;
      isCurrentPhotoError = false;
      const key = item.id ? `rec_${item.id}` : `ced_${item.cedula || item.employee_no}`;
      resolvedPhotoUrlCache.set(key, url);
    } else {
      isCurrentPhotoLoaded = false;
      isCurrentPhotoError = false;
      preloadPhoto(url).then((entry) => {
        if (reqId !== currentActivePhotoRequestId) return;
        if (entry && !entry.hasError) {
          const finalUrl = entry.blobUrl || url;
          activePhotoUrl = finalUrl;
          isCurrentPhotoLoaded = true;
          isCurrentPhotoError = false;
          const key = item.id ? `rec_${item.id}` : `ced_${item.cedula || item.employee_no}`;
          resolvedPhotoUrlCache.set(key, finalUrl);
        } else {
          handlePhotoErrorFallback(item, url, reqId);
        }
      }).catch(() => {
        if (reqId !== currentActivePhotoRequestId) return;
        handlePhotoErrorFallback(item, url, reqId);
      });
    }
  }

  function handlePhotoErrorFallback(record, failedUrl, reqId = currentActivePhotoRequestId) {
    if (!record) return;
    const key = record.id ? `rec_${record.id}` : `ced_${record.cedula || record.employee_no}`;

    // Buscar si existe una foto de perfil de empleado alternativa que no sea la que falló
    const empFoto = record.empleado_foto || record.foto;
    const empFotoUrl = empFoto && typeof empFoto === 'string' && empFoto.trim().length > 0 ? toBackendUrl(empFoto) : null;
    const empId = record.empleado_id || (mode === 'empleado' || mode === 'desincorporado' ? record.id : null);
    const idUrl = empId ? toBackendUrl(`/empleados/${empId}.jpg`) : null;

    const fallbackUrl = (empFotoUrl && empFotoUrl !== failedUrl) ? empFotoUrl : (idUrl && idUrl !== failedUrl ? idUrl : null);

    if (fallbackUrl && fallbackUrl !== failedUrl) {
      preloadPhoto(fallbackUrl).then((entry) => {
        if (reqId !== currentActivePhotoRequestId) return;
        if (entry && !entry.hasError) {
          const finalUrl = entry.blobUrl || fallbackUrl;
          resolvedPhotoUrlCache.set(key, finalUrl);
          activePhotoUrl = finalUrl;
          isCurrentPhotoLoaded = true;
          isCurrentPhotoError = false;
        } else {
          if (reqId === currentActivePhotoRequestId) {
            activePhotoUrl = "";
            isCurrentPhotoLoaded = false;
            isCurrentPhotoError = true;
          }
        }
      }).catch(() => {
        if (reqId !== currentActivePhotoRequestId) return;
        activePhotoUrl = "";
        isCurrentPhotoLoaded = false;
        isCurrentPhotoError = true;
      });
    } else {
      if (reqId === currentActivePhotoRequestId) {
        activePhotoUrl = "";
        isCurrentPhotoLoaded = false;
        isCurrentPhotoError = true;
      }
    }
  }

  function getInitials(name, cedula) {
    if (name && typeof name === "string") {
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      if (parts.length === 1 && parts[0]) return parts[0].slice(0, 2).toUpperCase();
    }
    if (cedula) return String(cedula).replace(/^#/, "").slice(-2);
    return "EM";
  }

  function getStatusBadge(rawStatus) {
    const s = String(rawStatus || "").toLowerCase().trim();
    if (s === "checkin" || s === "entrada") {
      return { label: "ENTRADA", color: "#15803d", dotColor: "#22c55e" };
    }
    if (s === "checkout" || s === "salida") {
      return { label: "SALIDA", color: "#b91c1c", dotColor: "#c94145" };
    }
    return { label: "PUERTA / OTROS", color: "#c2410c", dotColor: "#f97316" };
  }

  async function captureModalScreenshot() {
    if (isCapturingScreenshot || !modalCardElement) return;
    isCapturingScreenshot = true;

    try {
      const scaleFactor = Math.max(2, window.devicePixelRatio || 2);
      const sourceCanvas = await html2canvas(modalCardElement, {
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#ffffff",
        scale: scaleFactor,
        logging: false,
        imageTimeout: 15000,
        ignoreElements: (el) => el.getAttribute("data-html2canvas-ignore") === "true",
        onclone: (clonedDoc, clonedElement) => {
          // Desactivar cualquier animación (como zoomIn / fadeIn) para que no se capture a mitad de opacidad
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

      const radius = 16 * scaleFactor;
      ctx.beginPath();
      ctx.moveTo(radius, 0);
      ctx.lineTo(roundedCanvas.width - radius, 0);
      ctx.quadraticCurveTo(roundedCanvas.width, 0, roundedCanvas.width, radius);
      ctx.lineTo(roundedCanvas.width, roundedCanvas.height - radius);
      ctx.quadraticCurveTo(roundedCanvas.width, roundedCanvas.height, roundedCanvas.width - radius, roundedCanvas.height);
      ctx.lineTo(radius, roundedCanvas.height);
      ctx.quadraticCurveTo(0, roundedCanvas.height, 0, roundedCanvas.height - radius);
      ctx.lineTo(0, radius);
      ctx.quadraticCurveTo(0, 0, radius, 0);
      ctx.closePath();
      ctx.clip();

      // Rellenar fondo con blanco 100% sólido para evitar cualquier transparencia o tonalidad lechosa
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, roundedCanvas.width, roundedCanvas.height);

      ctx.drawImage(sourceCanvas, 0, 0);

      const blob = await new Promise((resolve, reject) => {
        roundedCanvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error("No se pudo generar el archivo PNG de la ficha"));
        }, "image/png", 1.0);
      });

      const cedula = (item?.cedula || item?.employee_no || "empleado").toString().replace(/^#/, "").trim();
      const rawTime = item?.event_time || "ficha";
      const cleanTime = String(rawTime).replace(/[\s:]+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
      const fileName = `Ficha_${cedula}_${cleanTime}.png`;

      await saveOrShareFile({
        blob,
        fileName,
        dialogTitle: `Guardar Ficha de ${cedula}`,
        mimeType: "image/png"
      });
      triggerToast(`Ficha guardada: ${fileName}`, "success");
    } catch (err) {
      console.error("Error al capturar screenshot de la ficha:", err);
      triggerToast("Error al capturar ficha: " + (err.message || err), "error");
    } finally {
      isCapturingScreenshot = false;
    }
  }

  async function downloadPhoto() {
    if (!item || isDownloadingPhoto) return;
    isDownloadingPhoto = true;
    try {
      const url = activePhotoUrl || getPhotoUrl(item);
      if (!url) throw new Error("URL de fotografía no disponible");

      const res = await fetch(url);
      if (!res.ok) throw new Error("No se pudo obtener la imagen del servidor");
      const blob = await res.blob();

      const cedula = (item.cedula || item.employee_no || "empleado").toString().replace(/^#/, "").trim();
      const rawTime = item.event_time || "foto";
      const cleanTime = String(rawTime).replace(/[\s:]+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
      const ext = blob.type.includes("png") ? "png" : "jpg";
      const fileName = `Foto_${cedula}_${cleanTime}.${ext}`;

      await saveOrShareFile({
        blob,
        fileName,
        dialogTitle: `Guardar Fotografía de ${cedula}`,
        mimeType: blob.type || "image/jpeg"
      });
      triggerToast(`Fotografía guardada: ${fileName}`, "success");
    } catch (err) {
      console.error("Error al descargar foto:", err);
      triggerToast("Error al descargar foto: " + (err.message || err), "error");
    } finally {
      isDownloadingPhoto = false;
    }
  }
</script>

{#if isOpen && item}
  <div
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    class="global-modal-overlay"
  >
    <div class="global-modal-container">
      <!-- Botón Lateral Anterior (‹) -->
      {#if !isSingleRecordMode}
        <button
          type="button"
          class="nav-btn-float prev-btn"
          disabled={isPrevDisabled}
          on:click={(e) => { e.currentTarget.blur(); safeNavigatePrev(); }}
          title={isPrevDisabled ? (showPageSpinner ? "Cargando página..." : (isCurrentPhotoLoading ? "Cargando imagen..." : "Primer registro")) : "Ver anterior (Flecha Izquierda ‹)"}
        >
          ‹
        </button>
      {/if}

      <div bind:this={modalCardElement} class="global-modal-card">
        <!-- Header -->
          <div class="modal-header">
            <div class="header-left">
              <div class="header-title-row">
                <span class="employee-name" title={toTitleCase(item.nombre) || "Empleado"}>
                  {toTitleCase(item.nombre) || `Empleado ${(item.employee_no || "").replace(/^#/, "")}`}
                </span>
              </div>
              <div class="employee-cedula">
                Cédula: {formatCedulaDisplay(item.cedula || item.employee_no)}
              </div>
            </div>

            <div data-html2canvas-ignore="true" class="header-right">
              {#if !isSingleRecordMode}
                <div class="header-right-meta">
                  <span class="pagination-badge" class:pagination-badge-loading={showPageSpinner}>
                    {#if showPageSpinner}
                      ⏳ Cargando página...
                    {:else}
                      Página {currentPage + 1} de {totalPages || 1} ({totalCount} {mode === 'empleado' || mode === 'desincorporado' ? 'empleados' : 'registros'})
                    {/if}
                  </span>
                  <div class="index-badge-group">
                    {#if item && (item.id || item.attlog_id)}
                      <span class="attlog-id-badge" title="ID del registro de marcaje">
                        ID: #{item.id || item.attlog_id}
                      </span>
                    {:else if item && item.empleado_id}
                      <span class="attlog-id-badge" title="ID del empleado">
                        ID: #{item.empleado_id}
                      </span>
                    {/if}
                    <span class="index-badge">
                      {#if showPageSpinner}
                        Sincronizando...
                      {:else}
                        {currentIndex + 1} / {items.length}
                      {/if}
                    </span>
                  </div>
                </div>
              {:else if item && (item.id || item.attlog_id)}
                <div class="header-right-meta">
                  <span class="attlog-id-badge" title="ID del registro de marcaje">
                    ID: #{item.id || item.attlog_id}
                  </span>
                </div>
              {/if}
              <button
                type="button"
                class="btn-close-modal"
                on:click={closePhotoModal}
                title="Cerrar modal (ESC)"
              >
                ✕
              </button>
            </div>
          </div>

          <!-- Photo Container -->
          <div class="modal-photo-area">
            {#if showPageSpinner}
              <div class="page-transition-overlay" data-html2canvas-ignore="true">
                <div class="page-transition-spinner"></div>
                <div class="page-transition-text">
                  {#if pageTransitionDirection === 'next'}
                    Cargando página siguiente...
                  {:else}
                    Cargando página anterior...
                  {/if}
                </div>
                <div class="page-transition-sub">Preparando registros e imágenes</div>
              </div>
            {/if}

            {#if !isCurrentPhotoLoaded && !isCurrentPhotoError && activePhotoUrl && !showPageSpinner}
              <div class="photo-loading-skeleton" data-html2canvas-ignore="true">
                <div class="skeleton-spinner"></div>
              </div>
            {/if}

            {#if activePhotoUrl && !isCurrentPhotoError}
              <img
                bind:this={imgElement}
                src={activePhotoUrl}
                crossorigin="anonymous"
                decoding="async"
                loading="eager"
                alt="Fotografía Ampliada"
                class="modal-main-img"
                style="opacity: {isCurrentPhotoLoaded ? '1' : '0'}; transition: opacity 0.15s ease;"
                on:load={() => {
                  isCurrentPhotoLoaded = true;
                  isCurrentPhotoError = false;
                }}
                on:error={() => {
                  handlePhotoErrorFallback(item, activePhotoUrl, currentActivePhotoRequestId);
                }}
              />
            {/if}

            {#if isCurrentPhotoError || (!activePhotoUrl && !showPageSpinner)}
              <div class="modal-photo-fallback">
                {getInitials(toTitleCase(item?.nombre), item?.cedula || item?.employee_no)}
              </div>
            {/if}
          </div>

          <!-- Info Details Grid -->
          <div class="modal-info-grid">
            <!-- Fila 1 - Col 1: SEXO -->
            <div class="grid-cell">
              <span class="cell-label">SEXO</span>
              <span class="cell-value" title={cleanUtf8(item.sexo) || "Masculino"}>
                {cleanUtf8(item.sexo) || "Masculino"}
              </span>
            </div>

            <!-- Fila 1 - Col 2: FECHA DE NACIMIENTO -->
            <div class="grid-cell">
              <span class="cell-label">FECHA DE NACIMIENTO</span>
              <span class="cell-value" title="{formatDate(item.fecha_nacimiento)} {getEdad(item.fecha_nacimiento)}">
                {formatDate(item.fecha_nacimiento)}
                <span class="cell-tag-age">{getEdad(item.fecha_nacimiento)}</span>
              </span>
            </div>

            <!-- Fila 1 - Col 3: FECHA DE INGRESO -->
            <div class="grid-cell">
              <span class="cell-label">FECHA DE INGRESO</span>
              <span class="cell-value" title="{formatDate(item.fecha_ingreso)} {getAntiguedad(item.fecha_ingreso)}">
                {formatDate(item.fecha_ingreso)}
                <span class="cell-tag-antig">{getAntiguedad(item.fecha_ingreso)}</span>
              </span>
            </div>

            <!-- Fila 2 - Col 1: SALA -->
            <div class="grid-cell">
              <span class="cell-label">SALA</span>
              <span class="cell-value" title={cleanUtf8(item.sala_nombre) || "—"}>
                📍 {cleanUtf8(item.sala_nombre) || "—"}
              </span>
            </div>

            <!-- Fila 2 - Col 2: DEPARTAMENTO -->
            <div class="grid-cell">
              <span class="cell-label">DEPARTAMENTO</span>
              <span class="cell-value" title={cleanUtf8(item.departamento_nombre) || "—"}>
                {cleanUtf8(item.departamento_nombre) || "—"}
              </span>
            </div>

            <!-- Fila 2 - Col 3: ÁREA -->
            <div class="grid-cell">
              <span class="cell-label">ÁREA</span>
              <span class="cell-value" title={cleanUtf8(item.area_nombre) || "—"}>
                {cleanUtf8(item.area_nombre) || "—"}
              </span>
            </div>

            <!-- Fila 3: CARGO (+ Biométrico y Estado si es Marcaje) -->
            {#if mode === 'empleado' || mode === 'desincorporado' || !item.event_time}
              <!-- Fila 3 completa para Cargo en Empleados -->
              <div class="grid-cell cell-span-3">
                <span class="cell-label">CARGO</span>
                <span class="cell-value cell-value-cargo" title={cleanUtf8(item.cargo_nombre) || "—"}>
                  {cleanUtf8(item.cargo_nombre) || "—"}
                </span>
              </div>
            {:else}
              <!-- Fila 3 para Marcajes: Cargo, Biométrico, Estado -->
              <div class="grid-cell">
                <span class="cell-label">CARGO</span>
                <span class="cell-value" title={cleanUtf8(item.cargo_nombre) || "—"}>
                  {cleanUtf8(item.cargo_nombre) || "—"}
                </span>
              </div>

              <div class="grid-cell">
                <span class="cell-label">BIOMÉTRICO</span>
                <span class="cell-value" title={cleanUtf8(item.dispositivo_nombre) || "—"}>
                  📟 {cleanUtf8(item.dispositivo_nombre) || "—"}
                </span>
              </div>

              <div class="grid-cell">
                <span class="cell-label">ESTADO</span>
                <span class="cell-value-status" style="color: {stInfo.color};">
                  <span class="status-dot" style="background: {stInfo.dotColor};"></span>
                  {stInfo.label}
                </span>
              </div>
            {/if}

            <!-- Bottom Row: Meta & Action Buttons -->
            <div class="bottom-action-row">
              <div class="bottom-meta-text">
                {#if item.event_time}
                  🕒 Marcaje: <span class="meta-highlight-blue">{formatEventTime(item.event_time)}</span>
                  &nbsp;|&nbsp; 📊 Total: <span class="meta-highlight-green">{item.total_employee_attlogs || 1} marcajes</span>
                {/if}
              </div>

              <div data-html2canvas-ignore="true" class="bottom-buttons">
                <!-- Botón Tomar Capture -->
                <button
                  type="button"
                  class="btn-action btn-capture"
                  on:click={captureModalScreenshot}
                  disabled={isCapturingScreenshot}
                  title="Capturar ficha completa (Screenshot)"
                >
                  {#if isCapturingScreenshot}
                    <span class="spin-icon">⏳</span>
                  {:else}
                    <span>Tomar</span>
                    <span>Capture</span>
                  {/if}
                </button>

                <!-- Botón Descargar Foto -->
                <button
                  type="button"
                  class="btn-action btn-download"
                  on:click={downloadPhoto}
                  disabled={isDownloadingPhoto}
                  title="Descargar fotografía en alta resolución"
                >
                  {#if isDownloadingPhoto}
                    <span class="spin-icon">⏳</span>
                  {:else}
                    <span>Descargar</span>
                    <span>Foto</span>
                  {/if}
                </button>
              </div>
            </div>
          </div>

          <!-- Banner Rojo ÚNICAMENTE para la vista de Desincorporados -->
          {#if mode === 'desincorporado'}
            <div class="banner-desincorporado">
              <div class="banner-desincorporado-title">
                ⚠️ MOTIVO DE LA DESINCORPORACIÓN
              </div>
              <div class="banner-desincorporado-text">
                {item.motivo_desincorporacion && item.motivo_desincorporacion.trim() ? item.motivo_desincorporacion : 'Sin información de desincorporación registrada'}
              </div>
            </div>
          {/if}
        </div>

      <!-- Botón Lateral Siguiente (›) -->
      {#if !isSingleRecordMode}
        <button
          type="button"
          class="nav-btn-float next-btn"
          disabled={isNextDisabled}
          on:click={(e) => { e.currentTarget.blur(); safeNavigateNext(); }}
          title={isNextDisabled ? (showPageSpinner ? "Cargando página..." : (isCurrentPhotoLoading ? "Cargando imagen..." : "Último registro")) : "Ver siguiente (Flecha Derecha ›)"}
        >
          ›
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .global-modal-overlay {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(15, 23, 42, 0.88);
    backdrop-filter: blur(8px);
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    animation: fadeIn 0.15s ease-out;
  }

  .global-modal-container {
    position: relative;
    max-width: 580px;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .global-modal-card {
    background: #ffffff;
    border-radius: 16px;
    width: 100%;
    max-height: 92vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.2);
    position: relative;
    color: #0f172a;
    animation: zoomIn 0.15s ease-out;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    background: #ffffff;
    border-bottom: 1px solid #e2e8f0;
    gap: 12px;
    text-align: left;
  }

  .header-left {
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    gap: 2px;
  }

  .header-title-row {
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
    display: flex;
    align-items: center;
    gap: 8px;
    text-align: left;
  }

  .employee-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 280px;
    display: inline-block;
    color: #0f172a;
    text-align: left;
  }

  .employee-cedula {
    font-size: 12.5px;
    font-weight: 700;
    color: #2563eb;
    letter-spacing: -0.01em;
    text-align: left;
    align-self: flex-start;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .header-right-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
  }

  .pagination-badge {
    font-size: 12px;
    font-weight: 700;
    color: #1e40af;
    background: #eff6ff;
    padding: 5px 12px;
    border-radius: 8px;
    border: 1px solid #bfdbfe;
    white-space: nowrap;
    transition: all 0.2s ease;
  }

  .pagination-badge-loading {
    color: #b45309;
    background: #fef3c7;
    border-color: #fde68a;
    animation: pulseBadge 1.2s ease-in-out infinite;
  }

  @keyframes pulseBadge {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.65; }
  }

  .index-badge-group {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    width: 100%;
  }

  .attlog-id-badge {
    font-size: 11px;
    font-weight: 800;
    color: #1e40af;
    background: #eff6ff;
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid #bfdbfe;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  .index-badge {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    text-align: right;
    white-space: nowrap;
    padding-right: 2px;
  }

  .btn-close-modal {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #334155;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .btn-close-modal:hover {
    background: #f1f5f9;
    color: #0f172a;
    border-color: #94a3b8;
  }

  .modal-photo-area {
    padding: 20px;
    background: #0f172a;
    text-align: center;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 320px;
    position: relative;
  }

  .page-transition-overlay {
    position: absolute;
    inset: 0;
    background: rgba(15, 23, 42, 0.86);
    backdrop-filter: blur(8px);
    z-index: 60;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    border-radius: 12px;
    animation: fadeIn 0.15s ease-out;
  }

  .page-transition-spinner {
    width: 46px;
    height: 46px;
    border: 4px solid rgba(59, 130, 246, 0.25);
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spinPage 0.65s linear infinite;
  }

  @keyframes spinPage {
    to {
      transform: rotate(360deg);
    }
  }

  .page-transition-text {
    color: #ffffff;
    font-size: 14.5px;
    font-weight: 800;
    letter-spacing: -0.01em;
  }

  .page-transition-sub {
    color: #94a3b8;
    font-size: 11.5px;
    font-weight: 500;
  }

  .photo-loading-skeleton {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 5;
  }

  .skeleton-spinner {
    width: 34px;
    height: 34px;
    border: 3px solid rgba(255, 255, 255, 0.15);
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spinPage 0.65s linear infinite;
  }

  .modal-main-img {
    max-width: 100%;
    max-height: 420px;
    min-height: 240px;
    border-radius: 12px;
    object-fit: contain;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
    border: 3px solid #334155;
  }

  .modal-photo-fallback {
    display: flex;
    width: 140px;
    height: 140px;
    border-radius: 50%;
    background: #2563eb;
    color: #ffffff;
    font-weight: 800;
    font-size: 48px;
    align-items: center;
    justify-content: center;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
  }

  .modal-info-grid {
    padding: 16px 20px;
    background: #ffffff;
    border-top: 1px solid #e2e8f0;
    font-size: 12.5px;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 11px 16px;
    align-items: flex-start;
  }

  .grid-cell {
    min-width: 0;
  }

  .cell-span-3 {
    grid-column: span 3;
  }

  .cell-label {
    font-size: 10.5px;
    font-weight: 800;
    color: #64748b;
    text-transform: uppercase;
    display: block;
    margin-bottom: 2px;
  }

  .cell-value {
    font-weight: 700;
    color: #0f172a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
  }

  .cell-value-cargo {
    font-size: 13.5px;
  }

  .cell-tag-age {
    font-size: 11px;
    color: #7c3aed;
    font-weight: 800;
  }

  .cell-tag-antig {
    font-size: 11px;
    color: #2563eb;
    font-weight: 800;
  }

  .cell-value-status {
    font-size: 11.5px;
    font-weight: 800;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-top: 2px;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }

  .bottom-action-row {
    grid-column: span 3;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 4px;
    padding-top: 10px;
    border-top: 1px dashed #e2e8f0;
  }

  .bottom-meta-text {
    font-size: 11.5px;
    color: #475569;
    font-weight: 700;
  }

  .meta-highlight-blue {
    color: #2563eb;
  }

  .meta-highlight-green {
    color: #10b981;
  }

  .bottom-buttons {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-action {
    padding: 5px 12px;
    border-radius: 9px;
    border: none;
    color: #ffffff;
    font-size: 10.5px;
    font-weight: 800;
    line-height: 1.15;
    text-align: center;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .btn-capture {
    min-width: 68px;
    background: linear-gradient(135deg, #10b981, #059669);
    box-shadow: 0 3px 8px rgba(16, 185, 129, 0.35);
  }

  .btn-capture:hover:not(:disabled) {
    background: linear-gradient(135deg, #059669, #047857);
  }

  .btn-download {
    min-width: 72px;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    box-shadow: 0 3px 8px rgba(37, 99, 235, 0.35);
  }

  .btn-download:hover {
    background: linear-gradient(135deg, #1d4ed8, #1e40af);
  }

  .banner-desincorporado {
    background: linear-gradient(135deg, #e11d48 0%, #be123c 100%);
    color: #ffffff;
    padding: 14px 20px;
    border-top: 1px solid #9f1239;
  }

  .banner-desincorporado-title {
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #fecdd3;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .banner-desincorporado-text {
    font-size: 13.5px;
    font-weight: 700;
    color: #ffffff;
    line-height: 1.4;
  }

  .nav-btn-float {
    position: absolute;
    z-index: 10;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.2);
    background: rgba(15, 23, 42, 0.9);
    color: #ffffff;
    font-size: 22px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
    transition: all 0.15s ease;
  }

  .prev-btn {
    left: -22px;
  }

  .next-btn {
    right: -22px;
  }

  .nav-btn-float:hover:not(:disabled) {
    background: #2563eb;
    border-color: #60a5fa;
    transform: scale(1.08);
  }

  .nav-btn-float:disabled {
    opacity: 0.2;
    cursor: not-allowed;
    pointer-events: none;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes zoomIn {
    from { transform: scale(0.96); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }

  .spin-icon {
    display: inline-block;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 640px) {
    .global-modal-overlay {
      padding: 10px;
    }
    .prev-btn {
      left: 6px;
      top: 50%;
    }
    .next-btn {
      right: 6px;
      top: 50%;
    }
    .modal-photo-area {
      min-height: 220px;
      padding: 10px;
    }
    .modal-main-img {
      max-height: 260px;
    }
    .modal-info-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      padding: 12px 14px;
      gap: 8px 12px;
    }
  }
</style>
