<script>
  import { onMount, onDestroy } from "svelte";
  import {
    photoModalStore,
    closePhotoModal,
    photoModalNext,
    photoModalPrev
  } from "../../controllers/globalModal.store.js";
  import { getCloudBaseUrl } from "../../config/api.config.js";
  import html2canvas from "html2canvas";

  const backendUrl = getCloudBaseUrl();

  let modalCardElement = null;
  let imgElement = null;
  let isCapturingScreenshot = false;

  $: isOpen = $photoModalStore.isOpen;
  $: item = $photoModalStore.activeItem;
  $: items = $photoModalStore.items || [];
  $: currentIndex = $photoModalStore.currentIndex;
  $: currentPage = $photoModalStore.currentPage;
  $: totalPages = $photoModalStore.totalPages;
  $: totalCount = $photoModalStore.totalCount;
  $: mode = $photoModalStore.mode;
  $: stInfo = getStatusBadge(item?.attendancestatus);

  $: isFirstPage = currentPage <= 0;
  $: isLastPage = totalPages <= 1 || (currentPage >= totalPages - 1);
  $: isPrevDisabled = currentIndex <= 0 && isFirstPage;
  $: isNextDisabled = currentIndex >= items.length - 1 && isLastPage;

  // Atajos de teclado: Escape para cerrar, Flechas para navegar
  function handleKeyDown(e) {
    if (!isOpen) return;
    if (e.key === "Escape") {
      closePhotoModal();
    } else if (e.key === "ArrowLeft" && !isPrevDisabled) {
      photoModalPrev();
    } else if (e.key === "ArrowRight" && !isNextDisabled) {
      photoModalNext();
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeyDown);
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

  function formatDate(raw) {
    if (!raw) return "—";
    try {
      const d = new Date(raw);
      if (isNaN(d.getTime())) return String(raw).split("T")[0] || "—";
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
      const b = new Date(fechaNac);
      if (isNaN(b.getTime())) return "";
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
      const d = new Date(fechaIngreso);
      if (isNaN(d.getTime())) return "";
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
    if (mode === 'empleado' || mode === 'desincorporado' || !record.event_time) {
      if (record.foto && typeof record.foto === 'string' && record.foto.trim().length > 0) {
        const clean = record.foto.trim();
        if (clean.startsWith('http')) return clean;
        return clean.startsWith('/') ? clean : `/${clean}`;
      }
      const empId = record.empleado_id || record.id;
      if (empId) return `/empleados/${empId}.jpg`;
      return "";
    }

    // Si es un marcaje y tiene foto guardada (has_photo = true)
    if (record.has_photo === true && record.id) {
      return `/attlogs/${record.id}.jpg`;
    }

    // Si el marcaje no tiene foto guardada en disco, usar directamente la foto de perfil del empleado (por ID o ruta foto)
    if (record.empleado_foto && typeof record.empleado_foto === 'string' && record.empleado_foto.trim().length > 0) {
      const clean = record.empleado_foto.trim();
      if (clean.startsWith('http')) return clean;
      return clean.startsWith('/') ? clean : `/${clean}`;
    }
    if (record.empleado_id) {
      return `/empleados/${record.empleado_id}.jpg`;
    }

    return `/attlogs/${record.id}.jpg`;
  }

  $: photoSrc = getPhotoUrl(item);

  $: if (photoSrc && imgElement) {
    imgElement.dataset.triedEmpFoto = "";
    imgElement.dataset.triedId = "";
    imgElement.style.display = "block";
    if (imgElement.nextElementSibling) {
      imgElement.nextElementSibling.style.display = "none";
    }
  }

  // Precargar TODAS las fotos del lote actual (los 10 o 20 registros) para que al navegar la respuesta sea inmediata (0ms)
  $: if (isOpen && items && items.length > 0 && typeof window !== 'undefined') {
    items.forEach((it) => {
      const u = getPhotoUrl(it);
      if (u) {
        const preImg = new Image();
        preImg.src = u;
      }
    });
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
    return { label: "INDEFINIDO", color: "#b91c1c", dotColor: "#ef4444" };
  }

  async function captureModalScreenshot() {
    if (isCapturingScreenshot || !modalCardElement) return;
    isCapturingScreenshot = true;

    try {
      const sourceCanvas = await html2canvas(modalCardElement, {
        useCORS: true,
        allowTaint: false,
        backgroundColor: null,
        scale: Math.max(2, window.devicePixelRatio || 2),
        logging: false,
        imageTimeout: 10000,
        ignoreElements: (el) => el.getAttribute("data-html2canvas-ignore") === "true",
      });

      const roundedCanvas = document.createElement("canvas");
      roundedCanvas.width = sourceCanvas.width;
      roundedCanvas.height = sourceCanvas.height;
      const ctx = roundedCanvas.getContext("2d");

      const radius = 16 * (Math.max(2, window.devicePixelRatio || 2));
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

      ctx.drawImage(sourceCanvas, 0, 0);

      const cedula = (item?.cedula || item?.employee_no || "empleado").toString().replace(/^#/, "").trim();
      const rawTime = item?.event_time || "ficha";
      const cleanTime = String(rawTime).replace(/[\s:]+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
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

  async function downloadPhoto() {
    if (!item) return;
    try {
      const url = getPhotoUrl(item);
      const res = await fetch(url);
      if (!res.ok) throw new Error("No se pudo obtener la imagen");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);

      const cedula = (item.cedula || item.employee_no || "empleado").toString().replace(/^#/, "").trim();
      const rawTime = item.event_time || "foto";
      const cleanTime = String(rawTime).replace(/[\s:]+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
      const fileName = `Foto_${cedula}_${cleanTime}.jpg`;

      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      console.error("Error al descargar foto:", err);
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
      <button
        type="button"
        class="nav-btn-float prev-btn"
        disabled={isPrevDisabled}
        on:click={photoModalPrev}
        title={isPrevDisabled ? "Primer registro" : "Ver anterior (Flecha Izquierda ‹)"}
      >
        ‹
      </button>

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
              <div class="header-right-meta">
                <span class="pagination-badge">
                  Página {currentPage + 1} de {totalPages || 1} ({totalCount} {mode === 'empleado' || mode === 'desincorporado' ? 'empleados' : 'marcajes'})
                </span>
                <span class="index-badge">
                  {currentIndex + 1} / {items.length}
                </span>
              </div>
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
            <img
              bind:this={imgElement}
              crossorigin="anonymous"
              src={photoSrc}
              alt="Fotografía Ampliada"
              class="modal-main-img"
              on:load={(e) => {
                const img = e.currentTarget;
                img.style.display = "block";
                if (img.nextElementSibling) img.nextElementSibling.style.display = "none";
              }}
              on:error={(e) => {
                const img = e.currentTarget;
                const empFoto = item?.empleado_foto || item?.foto;
                const empId = item?.empleado_id || (mode === 'empleado' || mode === 'desincorporado' ? item?.id : null);

                if (!img.dataset.triedEmpFoto && empFoto) {
                  img.dataset.triedEmpFoto = "true";
                  img.src = empFoto.startsWith("http") ? empFoto : (empFoto.startsWith("/") ? empFoto : `/${empFoto}`);
                } else if (!img.dataset.triedId && empId && !img.src.endsWith(`/empleados/${empId}.jpg`)) {
                  img.dataset.triedId = "true";
                  img.src = `/empleados/${empId}.jpg`;
                } else {
                  img.style.display = "none";
                  const fb = img.nextElementSibling;
                  if (fb) fb.style.display = "flex";
                }
              }}
            />
            <div class="modal-photo-fallback">
              {getInitials(toTitleCase(item?.nombre), item?.cedula || item?.employee_no)}
            </div>
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
                  title="Descargar fotografía en alta resolución"
                >
                  <span>Descargar</span>
                  <span>Foto</span>
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
      <button
        type="button"
        class="nav-btn-float next-btn"
        disabled={isNextDisabled}
        on:click={photoModalNext}
        title={isNextDisabled ? "Último registro" : "Ver siguiente (Flecha Derecha ›)"}
      >
        ›
      </button>
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
    overflow: hidden;
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

  .modal-main-img {
    max-width: 100%;
    max-height: 420px;
    border-radius: 12px;
    object-fit: contain;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
    border: 3px solid #334155;
  }

  .modal-photo-fallback {
    display: none;
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
</style>
