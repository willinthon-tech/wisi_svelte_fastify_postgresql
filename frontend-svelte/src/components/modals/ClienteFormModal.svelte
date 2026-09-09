<script>
  import { createEventDispatcher, tick } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { masterTipoClientesStore, masterSalasStore } from '../../controllers/master.store.js';
  import { toBackendUrl } from '../../config/api.config.js';

  export let isOpen = false;
  export let item = null; // null for Create, cliente object for Edit
  export let assignedSalaIds = [];

  const dispatch = createEventDispatcher();

  $: isEdit = Boolean(item && item.id);
  $: modalTitle = isEdit ? 'Editar Cliente' : 'Crear Nuevo Cliente';
  $: submitBtnLabel = isEdit ? 'Actualizar Cliente' : 'Guardar Cliente';

  // Form fields
  let id = null;
  let nombre = '';
  let tipoClienteId = '';
  let salaId = '';
  let fotoUrl = '';
  let fotoBase64 = '';
  let removeFoto = false;
  let isSubmitting = false;

  // Photo Cropper States
  let isCropperOpen = false;
  let cropperCanvas;
  let cropperImg = null;
  let cropperZoom = 1.0;
  let cropperOffsetX = 0;
  let cropperOffsetY = 0;
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let initialOffsetX = 0;
  let initialOffsetY = 0;
  let fileInput;

  const CROP_SIZE = 220;
  const CANVAS_SIZE = 340;
  const CROP_X = (CANVAS_SIZE - CROP_SIZE) / 2;
  const CROP_Y = (CANVAS_SIZE - CROP_SIZE) / 2;

  // Reactivity: Filtered Salas strictly restricted to user's assigned salas
  $: availableSalas = (function() {
    const all = $masterSalasStore || [];
    let filtered = all.filter(s => !(s.grupo_id && Number(s.grupo_id) === 2));
    if (assignedSalaIds && assignedSalaIds.length > 0) {
      filtered = filtered.filter(s => assignedSalaIds.map(Number).includes(Number(s.id)));
    }
    // Si estamos editando y la sala del cliente no está en la lista filtrada, mantenerla para no mostrar blanco
    if (item && item.sala_id && !filtered.some(s => Number(s.id) === Number(item.sala_id))) {
      const currentSala = all.find(s => Number(s.id) === Number(item.sala_id));
      if (currentSala) {
        filtered = [currentSala, ...filtered];
      } else if (item.sala_nombre) {
        filtered = [{ id: Number(item.sala_id), nombre: item.sala_nombre }, ...filtered];
      }
    }
    return filtered;
  })();

  // Available Tipos de Cliente
  $: tipoClientesOptions = ($masterTipoClientesStore || []).map(t => ({
    id: Number(t.id),
    nombre: t.nombre
  }));

  // Watch item changes to reset or populate form
  $: if (isOpen) {
    initForm();
  }

  function initForm() {
    isCropperOpen = false;
    fotoBase64 = '';
    removeFoto = false;

    if (item && item.id) {
      id = item.id;
      nombre = item.nombre || '';
      tipoClienteId = item.tipo_cliente_id ? Number(item.tipo_cliente_id) : '';
      salaId = item.sala_id ? Number(item.sala_id) : '';
      if (item.foto) {
        fotoUrl = toBackendUrl(item.foto, { preview: true });
      } else {
        fotoUrl = toBackendUrl(`/clientes/${item.id}.jpg`, { preview: true });
      }
    } else {
      id = null;
      nombre = '';
      tipoClienteId = '';
      salaId = availableSalas.length === 1 ? availableSalas[0].id : '';
      fotoUrl = '';
    }
  }

  // --- Photo Cropper Management ---
  function triggerFileInput() {
    if (fileInput) fileInput.click();
  }

  function handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      triggerToast('Por favor selecciona un archivo de imagen válido', 'warning');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = async () => {
        cropperImg = img;
        cropperZoom = 1.0;
        cropperOffsetX = 0;
        cropperOffsetY = 0;
        isCropperOpen = true;
        await tick();
        drawCropper();
        requestAnimationFrame(drawCropper);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // Reset input
  }

  function drawCropper() {
    if (!cropperCanvas || !cropperImg) return;
    const ctx = cropperCanvas.getContext('2d');
    const cw = cropperCanvas.width;
    const ch = cropperCanvas.height;

    ctx.clearRect(0, 0, cw, ch);

    // Fondo oscuro detrás
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, cw, ch);

    // Escalar la imagen manteniendo proporción
    const baseScale = Math.max(CROP_SIZE / cropperImg.width, CROP_SIZE / cropperImg.height);
    const scale = baseScale * cropperZoom;
    const drawW = cropperImg.width * scale;
    const drawH = cropperImg.height * scale;

    const drawX = (cw - drawW) / 2 + cropperOffsetX;
    const drawY = (ch - drawH) / 2 + cropperOffsetY;

    ctx.drawImage(cropperImg, drawX, drawY, drawW, drawH);

    // Sombra oscura alrededor del recuadro de recorte
    ctx.fillStyle = 'rgba(15, 23, 42, 0.65)';
    // Arriba
    ctx.fillRect(0, 0, cw, CROP_Y);
    // Abajo
    ctx.fillRect(0, CROP_Y + CROP_SIZE, cw, ch - (CROP_Y + CROP_SIZE));
    // Izquierda
    ctx.fillRect(0, CROP_Y, CROP_X, CROP_SIZE);
    // Derecha
    ctx.fillRect(CROP_X + CROP_SIZE, CROP_Y, cw - (CROP_X + CROP_SIZE), CROP_SIZE);

    // Borde azul del recuadro
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(CROP_X, CROP_Y, CROP_SIZE, CROP_SIZE);

    // 4 Esquinas
    ctx.fillStyle = '#3b82f6';
    const hs = 10;
    ctx.fillRect(CROP_X - 2, CROP_Y - 2, hs, hs);
    ctx.fillRect(CROP_X + CROP_SIZE - hs + 2, CROP_Y - 2, hs, hs);
    ctx.fillRect(CROP_X - 2, CROP_Y + CROP_SIZE - hs + 2, hs, hs);
    ctx.fillRect(CROP_X + CROP_SIZE - hs + 2, CROP_Y + CROP_SIZE - hs + 2, hs, hs);
  }

  function handleMouseDown(e) {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    initialOffsetX = cropperOffsetX;
    initialOffsetY = cropperOffsetY;
  }

  function handleMouseMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    cropperOffsetX = initialOffsetX + dx;
    cropperOffsetY = initialOffsetY + dy;
    drawCropper();
  }

  function handleMouseUp() {
    isDragging = false;
  }

  function handleTouchStart(e) {
    if (e.touches && e.touches.length === 1) {
      e.preventDefault();
      isDragging = true;
      dragStartX = e.touches[0].clientX;
      dragStartY = e.touches[0].clientY;
      initialOffsetX = cropperOffsetX;
      initialOffsetY = cropperOffsetY;
    }
  }

  function handleTouchMove(e) {
    if (!isDragging || !e.touches || e.touches.length === 0) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - dragStartX;
    const dy = e.touches[0].clientY - dragStartY;
    cropperOffsetX = initialOffsetX + dx;
    cropperOffsetY = initialOffsetY + dy;
    drawCropper();
  }

  function handleTouchEnd() {
    isDragging = false;
  }

  function handleWheel(e) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.08 : -0.08;
    cropperZoom = Math.min(3.5, Math.max(1.0, +(cropperZoom + delta).toFixed(2)));
    drawCropper();
  }

  function handleZoomSlider(e) {
    cropperZoom = parseFloat(e.target.value);
    drawCropper();
  }

  function stepZoom(delta) {
    cropperZoom = Math.min(3.5, Math.max(1.0, +(cropperZoom + delta).toFixed(2)));
    drawCropper();
  }

  function cancelCropping() {
    isCropperOpen = false;
    cropperImg = null;
  }

  function processCroppedImage() {
    if (!cropperImg) return;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = 400;
    outCanvas.height = 400;
    const outCtx = outCanvas.getContext('2d');

    const cw = CANVAS_SIZE;
    const ch = CANVAS_SIZE;
    const baseScale = Math.max(CROP_SIZE / cropperImg.width, CROP_SIZE / cropperImg.height);
    const scale = baseScale * cropperZoom;
    const drawW = cropperImg.width * scale;
    const drawH = cropperImg.height * scale;
    const drawX = (cw - drawW) / 2 + cropperOffsetX;
    const drawY = (ch - drawH) / 2 + cropperOffsetY;

    // Mapeo exacto de las coordenadas del recuadro hacia la imagen original
    const sx = (CROP_X - drawX) / scale;
    const sy = (CROP_Y - drawY) / scale;
    const sSize = CROP_SIZE / scale;

    outCtx.fillStyle = '#ffffff';
    outCtx.fillRect(0, 0, 400, 400);
    outCtx.drawImage(cropperImg, sx, sy, sSize, sSize, 0, 0, 400, 400);

    const compressed = outCanvas.toDataURL('image/jpeg', 0.85);
    fotoBase64 = compressed;
    fotoUrl = compressed;
    removeFoto = false;
    isCropperOpen = false;
    cropperImg = null;
    triggerToast('Fotografía de cliente procesada con éxito', 'success');
  }

  function handleRemovePhoto() {
    fotoUrl = '';
    fotoBase64 = '';
    removeFoto = true;
    triggerToast('Foto eliminada (se aplicará al guardar)', 'info');
  }

  function close() {
    isOpen = false;
    dispatch('close');
  }

  async function handleSubmit() {
    if (!nombre.trim()) {
      triggerToast('Debe ingresar el nombre del cliente', 'warning');
      return;
    }
    if (!tipoClienteId) {
      triggerToast('Debe seleccionar el tipo de cliente', 'warning');
      return;
    }
    if (!salaId) {
      triggerToast('Debe seleccionar la sala asignada', 'warning');
      return;
    }

    isSubmitting = true;
    const payload = {
      nombre: nombre.trim().toUpperCase(),
      tipo_cliente_id: Number(tipoClienteId),
      sala_id: Number(salaId)
    };

    if (fotoBase64) {
      payload.fotoBase64 = fotoBase64;
    } else if (removeFoto) {
      payload.removeFoto = true;
    }

    try {
      if (isEdit) {
        dispatch('update', { id, draft: payload });
      } else {
        dispatch('create', payload);
      }
      isOpen = false;
    } catch (e) {
      console.error(e);
      triggerToast('Error al procesar la solicitud', 'error');
    } finally {
      isSubmitting = false;
    }
  }
</script>

{#if isOpen}
  <!-- Background Backdrop -->
  <div 
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1">
    
    <!-- Modal Card Container -->
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div 
      class="modal-card" 
      on:click|stopPropagation>
      
      <!-- Modal Header -->
      <div class="modal-header">
        <h3 class="modal-title">{modalTitle}</h3>
        <button type="button" class="btn-close" on:click={close} title="Cerrar modal">✕</button>
      </div>

      <!-- Modal Body Form -->
      <form on:submit|preventDefault={handleSubmit} class="modal-body">
        
        <!-- Hidden File Input for Avatar Upload -->
        <input 
          type="file" 
          accept="image/*" 
          bind:this={fileInput} 
          on:change={handleFileSelected} 
          style="display: none;" 
        />

        <!-- Photo Section (Circle Avatar) -->
        <div class="avatar-section">
          <div class="avatar-container">
            <button 
              type="button" 
              class="avatar-circle-btn" 
              on:click={triggerFileInput}
              title="Haz clic para seleccionar o cambiar foto">
              {#if fotoUrl}
                <img 
                  src={fotoUrl} 
                  alt="Foto de {nombre || 'Cliente'}" 
                  class="avatar-img" 
                  on:error={(e) => {
                    e.target.style.display = 'none';
                    if (e.target.nextElementSibling) e.target.nextElementSibling.style.display = 'flex';
                  }}
                />
                <div class="avatar-fallback-cam" style="display: none;">
                  <span class="cam-icon">📷</span>
                  <span class="avatar-text">Haz clic para agregar foto</span>
                </div>
              {:else}
                <div class="avatar-placeholder">
                  <span class="cam-icon">📷</span>
                  <span class="avatar-text">Haz clic para agregar foto</span>
                  <span class="avatar-subtext">(Opcional)</span>
                </div>
              {/if}
            </button>
          </div>

          {#if fotoUrl}
            <button 
              type="button" 
              class="btn-remove-photo" 
              on:click={handleRemovePhoto}
              title="Quitar foto actual">
              ✕ Quitar foto
            </button>
          {/if}
        </div>

        <!-- Nombre del Cliente Field -->
        <div class="form-group">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="form-label">Nombre del Cliente *</label>
          <input 
            type="text" 
            bind:value={nombre} 
            placeholder="Ej: JUAN PÉREZ" 
            class="form-input" 
            required 
            autocomplete="off"
          />
        </div>

        <!-- Tipo de Cliente Field -->
        <div class="form-group">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="form-label">Tipo de Cliente *</label>
          <select bind:value={tipoClienteId} class="form-select" required>
            <option value="">Seleccione un tipo de cliente...</option>
            {#each tipoClientesOptions as tipo}
              <option value={tipo.id}>{tipo.nombre}</option>
            {/each}
          </select>
        </div>

        <!-- Sala Asignada Field -->
        <div class="form-group">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="form-label">Sala *</label>
          <select bind:value={salaId} class="form-select" required>
            <option value="">Seleccione una sala...</option>
            {#each availableSalas as s}
              <option value={s.id}>{s.nombre}</option>
            {/each}
          </select>
          {#if availableSalas.length === 0}
            <span class="field-hint text-warning">
              No tienes salas asociadas para asignar clientes.
            </span>
          {/if}
        </div>

        <!-- Modal Footer Actions -->
        <div class="modal-footer">
          <button type="button" class="btn-cancel" on:click={close}>
            Cancelar
          </button>
          <button 
            type="submit" 
            class="btn-submit" 
            disabled={isSubmitting || availableSalas.length === 0}>
            {isSubmitting ? 'Guardando...' : submitBtnLabel}
          </button>
        </div>

      </form>
    </div>
  </div>

  <!-- Sub-Modal: Photo Cropper & Optimizer -->
  {#if isCropperOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div 
      class="cropper-backdrop" 
      role="dialog" 
      aria-modal="true" 
      tabindex="-1"
      on:click|stopPropagation>
      
      <div class="cropper-card">
        <div class="cropper-header">
          <span class="cropper-title">Ajustar y Recortar Foto</span>
          <button type="button" class="btn-close" on:click={cancelCropping}>✕</button>
        </div>

        <div class="cropper-viewport">
          <!-- Interactive HTML5 Canvas -->
          <canvas 
            bind:this={cropperCanvas}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            class="cropper-canvas {isDragging ? 'is-dragging' : ''}"
            on:mousedown={handleMouseDown}
            on:mousemove={handleMouseMove}
            on:mouseup={handleMouseUp}
            on:mouseleave={handleMouseUp}
            on:touchstart={handleTouchStart}
            on:touchmove={handleTouchMove}
            on:touchend={handleTouchEnd}
            on:wheel|preventDefault={handleWheel}
          ></canvas>
        </div>

        <!-- Horizontal Zoom Toolbar -->
        <div class="cropper-zoom-bar">
          <button type="button" class="btn-zoom-step" on:click={() => stepZoom(-0.1)} title="Alejar">
            －
          </button>
          <input 
            type="range" 
            min="1.0" 
            max="3.5" 
            step="0.05" 
            value={cropperZoom} 
            on:input={handleZoomSlider}
            class="cropper-zoom-range" 
            title="Ajustar zoom de la foto" 
          />
          <button type="button" class="btn-zoom-step" on:click={() => stepZoom(0.1)} title="Acercar">
            ＋
          </button>
          <span class="zoom-pct-badge">{Math.round(cropperZoom * 100)}%</span>
        </div>

        <!-- Cropper Footer Buttons -->
        <div class="cropper-footer">
          <button type="button" class="btn-cropper-cancel" on:click={cancelCropping}>
            Cancelar
          </button>
          <button type="button" class="btn-cropper-confirm" on:click={processCroppedImage}>
            Aplicar y Recortar
          </button>
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(15, 23, 42, 0.7);
    backdrop-filter: blur(4px);
    z-index: 99990;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    box-sizing: border-box;
    animation: modalFadeIn 0.2s ease-out;
  }

  @keyframes modalFadeIn {
    from { opacity: 0; transform: scale(0.98); }
    to { opacity: 1; transform: scale(1); }
  }

  .modal-card {
    background: #ffffff;
    border-radius: 16px;
    max-width: 440px;
    width: 100%;
    max-height: 92vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
    border: 1px solid #e2e8f0;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 24px;
    background: #ffffff;
    border-bottom: 1px solid #f1f5f9;
  }

  .modal-title {
    margin: 0;
    font-size: 18px;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.2px;
  }

  .btn-close {
    background: transparent;
    border: none;
    font-size: 16px;
    font-weight: 700;
    color: #94a3b8;
    cursor: pointer;
    padding: 4px;
    border-radius: 6px;
    transition: all 0.15s;
  }

  .btn-close:hover {
    color: #0f172a;
    background: #f1f5f9;
  }

  .modal-body {
    padding: 20px 24px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* Photo Section */
  .avatar-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .avatar-container {
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .avatar-circle-btn {
    width: 130px;
    height: 130px;
    border-radius: 50%;
    border: 2px dashed #cbd5e1;
    background: #f8fafc;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    overflow: hidden;
    position: relative;
    transition: all 0.2s;
  }

  .avatar-circle-btn:hover {
    border-color: #3b82f6;
    background: #eff6ff;
  }

  .avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar-placeholder, .avatar-fallback-cam {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 10px;
    text-align: center;
  }

  .cam-icon {
    font-size: 26px;
  }

  .avatar-text {
    font-size: 10.5px;
    color: #475569;
    font-weight: 700;
    line-height: 1.2;
  }

  .avatar-subtext {
    font-size: 9.5px;
    color: #94a3b8;
    font-weight: 600;
  }

  .btn-remove-photo {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #ef4444;
    font-size: 11px;
    font-weight: 700;
    padding: 4px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-remove-photo:hover {
    background: #fee2e2;
    border-color: #f87171;
  }

  /* Form Elements */
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-label {
    font-size: 13px;
    font-weight: 800;
    color: #0f172a;
  }

  .form-input {
    width: 100%;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    font-size: 13.5px;
    color: #0f172a;
    outline: none;
    box-sizing: border-box;
    background: #ffffff;
    text-transform: uppercase;
    transition: border-color 0.15s;
  }

  .form-input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
  }

  .form-select {
    width: 100%;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    font-size: 13.5px;
    color: #0f172a;
    outline: none;
    box-sizing: border-box;
    background: #ffffff;
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .form-select:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
  }

  .field-hint {
    font-size: 11.5px;
    margin-top: 2px;
  }

  .text-warning {
    color: #d97706;
  }

  /* Modal Footer */
  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 8px;
    padding-top: 14px;
    border-top: 1px solid #f1f5f9;
  }

  .btn-cancel {
    padding: 9px 18px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    font-size: 13px;
    font-weight: 700;
    color: #475569;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-cancel:hover {
    background: #f1f5f9;
    color: #0f172a;
  }

  .btn-submit {
    padding: 9px 20px;
    border-radius: 8px;
    border: none;
    background: #2563eb;
    font-size: 13px;
    font-weight: 700;
    color: #ffffff;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(37, 99, 235, 0.25);
    transition: all 0.15s;
  }

  .btn-submit:hover:not(:disabled) {
    background: #1d4ed8;
    box-shadow: 0 4px 8px rgba(37, 99, 235, 0.35);
  }

  .btn-submit:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Cropper Modal */
  .cropper-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(15, 23, 42, 0.85);
    backdrop-filter: blur(6px);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    box-sizing: border-box;
    animation: modalFadeIn 0.2s ease-out;
  }

  .cropper-card {
    background: #0f172a;
    border-radius: 16px;
    width: 380px;
    max-width: 95vw;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: hidden;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    border: 1px solid #334155;
  }

  .cropper-header {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    background: #1e293b;
    border-bottom: 1px solid #334155;
    box-sizing: border-box;
  }

  .cropper-title {
    font-size: 14.5px;
    font-weight: 700;
    color: #f8fafc;
  }

  .cropper-viewport {
    padding: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .cropper-canvas {
    border-radius: 10px;
    cursor: grab;
    box-shadow: 0 8px 16px rgba(0,0,0,0.4);
    touch-action: none;
    max-width: 100%;
    height: auto;
  }

  .cropper-canvas.is-dragging {
    cursor: grabbing;
  }

  .cropper-zoom-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 85%;
    margin-bottom: 18px;
  }

  .btn-zoom-step {
    background: #1e293b;
    border: 1px solid #475569;
    color: #f8fafc;
    width: 30px;
    height: 30px;
    border-radius: 6px;
    font-size: 15px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-zoom-step:hover {
    background: #334155;
    border-color: #64748b;
  }

  .cropper-zoom-range {
    flex: 1;
    cursor: pointer;
    accent-color: #3b82f6;
  }

  .zoom-pct-badge {
    font-size: 12px;
    font-weight: 700;
    color: #94a3b8;
    min-width: 40px;
    text-align: right;
  }

  .cropper-footer {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    padding: 14px 20px;
    background: #1e293b;
    border-top: 1px solid #334155;
    box-sizing: border-box;
  }

  .btn-cropper-cancel {
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid #475569;
    background: transparent;
    font-size: 12.5px;
    font-weight: 700;
    color: #cbd5e1;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-cropper-cancel:hover {
    background: #334155;
    color: #ffffff;
  }

  .btn-cropper-confirm {
    padding: 8px 18px;
    border-radius: 8px;
    border: none;
    background: #2563eb;
    font-size: 12.5px;
    font-weight: 700;
    color: #ffffff;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(37, 99, 235, 0.3);
    transition: all 0.15s;
  }

  .btn-cropper-confirm:hover {
    background: #1d4ed8;
  }
</style>
