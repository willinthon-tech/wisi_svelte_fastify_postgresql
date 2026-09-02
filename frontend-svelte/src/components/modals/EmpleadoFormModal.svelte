<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { masterCargosStore, masterSalasStore, masterDispositivosStore } from '../../controllers/master.store.js';

  export let isOpen = false;
  export let item = null; // null for Create, employee object for Edit
  export let assignedSalaIds = [];

  const dispatch = createEventDispatcher();

  $: isEdit = Boolean(item && item.id);
  $: modalTitle = isEdit ? 'Editar Empleado' : 'Crear Nuevo Empleado';
  $: submitBtnLabel = isEdit ? 'Actualizar Empleado' : 'Guardar Empleado';

  // Form fields
  let id = null;
  let fotoUrl = '';
  let fotoBase64 = '';
  let cedulaPrefix = 'V';
  let isPrefixDropdownOpen = false;
  let cedulaNumber = '';
  let nombre = '';
  let fechaIngreso = new Date().toISOString().split('T')[0];
  let fechaNacimiento = '';
  let sexo = 'Masculino';
  let cargoId = '';
  let selectedDispositivoIds = new Set();

  // Validation & Loading States
  let checkingCedula = false;
  let cedulaError = null;
  let checkTimeout = null;
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

  // Reactivity: Filtered Cargos according to assigned salas
  $: availableCargos = ($masterCargosStore || []).filter(c => {
    if (!assignedSalaIds || assignedSalaIds.length === 0) return true;
    return !c.sala_id || assignedSalaIds.map(Number).includes(Number(c.sala_id));
  });

  // Find sala_id of the selected cargo
  $: selectedCargoObj = ($masterCargosStore || []).find(c => Number(c.id) === Number(cargoId));
  $: targetSalaId = selectedCargoObj ? Number(selectedCargoObj.sala_id) : null;

  // Devices belonging to that sala
  $: availableDispositivos = ($masterDispositivosStore || []).filter(d => {
    if (!targetSalaId) return false;
    return Number(d.sala_id) === Number(targetSalaId);
  });

  // Watch item changes to reset or populate form
  $: if (isOpen) {
    initForm();
  }

  async function initForm() {
    checkingCedula = false;
    cedulaError = null;
    isPrefixDropdownOpen = false;
    isCropperOpen = false;
    fotoBase64 = '';

    if (item && item.id) {
      id = item.id;
      fotoUrl = item.foto || `/empleados/${item.id}.jpg`;
      nombre = item.nombre || '';
      
      const rawCed = String(item.cedula || '').trim().toUpperCase();
      if (rawCed.startsWith('E')) {
        cedulaPrefix = 'E';
        cedulaNumber = rawCed.substring(1);
      } else if (rawCed.startsWith('V')) {
        cedulaPrefix = 'V';
        cedulaNumber = rawCed.substring(1);
      } else {
        cedulaPrefix = 'V';
        cedulaNumber = rawCed;
      }

      fechaIngreso = formatDateForInput(item.fecha_ingreso) || new Date().toISOString().split('T')[0];
      fechaNacimiento = formatDateForInput(item.fecha_nacimiento) || '';
      sexo = item.sexo || 'Masculino';
      cargoId = item.cargo_id ? String(item.cargo_id) : '';

      // Load assigned devices from backend
      try {
        const res = await fetch(`/api/master/empleados/${item.id}/dispositivos`);
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data)) {
            selectedDispositivoIds = new Set(json.data.map(Number));
          } else {
            selectedDispositivoIds = new Set();
          }
        }
      } catch (e) {
        console.warn('Error fetching employee devices:', e);
        selectedDispositivoIds = new Set();
      }
    } else {
      // New employee defaults
      id = null;
      fotoUrl = '';
      cedulaPrefix = 'V';
      cedulaNumber = '';
      nombre = '';
      fechaIngreso = new Date().toISOString().split('T')[0];
      fechaNacimiento = '';
      sexo = 'Masculino';
      cargoId = '';
      selectedDispositivoIds = new Set();
    }
  }

  function formatDateForInput(val) {
    if (!val) return '';
    if (val instanceof Date) return val.toISOString().split('T')[0];
    const str = String(val).trim();
    const m = str.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
  }

  function handleCedulaInput(e) {
    // Only allow numbers
    cedulaNumber = e.target.value.replace(/\D/g, '');
    cedulaError = null;

    if (isEdit) return; // In edit mode, cédula is fixed

    if (!cedulaNumber) {
      checkingCedula = false;
      return;
    }

    if (checkTimeout) clearTimeout(checkTimeout);
    checkingCedula = true;

    checkTimeout = setTimeout(async () => {
      try {
        const fullCedula = `${cedulaPrefix}${cedulaNumber}`;
        const q = new URLSearchParams({ cedula: fullCedula });
        if (id) q.set('excludeId', id);

        const res = await fetch(`/api/master/empleados/check-cedula?${q.toString()}`);
        if (res.ok) {
          const json = await res.json();
          if (json.exists && json.empleado) {
            const emp = json.empleado;
            cedulaError = `Este empleado cédula ${fullCedula} ya está agregado, se llama ${emp.nombre} y está en la sala ${emp.sala_nombre} (Empleado ${emp.activo ? 'Activo' : 'Desincorporado'})`;
          } else {
            cedulaError = null;
          }
        }
      } catch (err) {
        console.warn('Error checking cédula:', err);
      } finally {
        checkingCedula = false;
      }
    }, 350);
  }

  function selectPrefix(p) {
    cedulaPrefix = p;
    isPrefixDropdownOpen = false;
    if (cedulaNumber) {
      handleCedulaInput({ target: { value: cedulaNumber } });
    }
  }

  function toggleDispositivo(devId) {
    const num = Number(devId);
    if (selectedDispositivoIds.has(num)) {
      selectedDispositivoIds.delete(num);
    } else {
      selectedDispositivoIds.add(num);
    }
    selectedDispositivoIds = new Set(selectedDispositivoIds);
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
      img.onload = () => {
        cropperImg = img;
        cropperZoom = 1.0;
        cropperOffsetX = 0;
        cropperOffsetY = 0;
        isCropperOpen = true;
        setTimeout(drawCropper, 60);
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

    // Borde verde del recuadro
    ctx.strokeStyle = '#16a34a';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(CROP_X, CROP_Y, CROP_SIZE, CROP_SIZE);

    // 4 Esquinas verdes
    ctx.fillStyle = '#16a34a';
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
    if (e.touches && e.touches.length > 0) {
      isDragging = true;
      dragStartX = e.touches[0].clientX;
      dragStartY = e.touches[0].clientY;
      initialOffsetX = cropperOffsetX;
      initialOffsetY = cropperOffsetY;
    }
  }

  function handleTouchMove(e) {
    if (!isDragging || !e.touches || e.touches.length === 0) return;
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
    cropperZoom = Math.min(3.5, Math.max(1.0, cropperZoom + delta));
    drawCropper();
  }

  function handleZoomSlider(e) {
    cropperZoom = parseFloat(e.target.value);
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
    isCropperOpen = false;
    cropperImg = null;
    triggerToast('Fotografía procesada y optimizada con éxito', 'success');
  }

  function close() {
    isOpen = false;
    dispatch('close');
  }

  async function handleSubmit() {
    if (cedulaError) {
      triggerToast('No se puede guardar: la cédula ya pertenece a otro empleado', 'warning');
      return;
    }
    if (!cedulaNumber.trim()) {
      triggerToast('Debe ingresar el número de cédula', 'warning');
      return;
    }
    if (!nombre.trim()) {
      triggerToast('Debe ingresar el nombre del empleado', 'warning');
      return;
    }
    if (!cargoId) {
      triggerToast('Debe seleccionar el cargo del empleado', 'warning');
      return;
    }

    isSubmitting = true;
    const fullCedula = `${cedulaPrefix}${cedulaNumber.trim()}`;

    const payload = {
      nombre: nombre.trim().toUpperCase(),
      cedula: fullCedula,
      fecha_ingreso: fechaIngreso || null,
      fecha_nacimiento: fechaNacimiento || null,
      sexo,
      cargo_id: Number(cargoId),
      dispositivo_ids: Array.from(selectedDispositivoIds)
    };

    if (fotoBase64) {
      payload.fotoBase64 = fotoBase64;
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
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div 
    class="modal-backdrop"
    on:click={close}
    role="dialog"
    aria-modal="true">
    
    <!-- Modal Card Container -->
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

        <!-- Photo Section (Dashed Circle or Avatar Thumbnail) -->
        <div class="avatar-container">
          <button 
            type="button" 
            class="avatar-circle-btn" 
            on:click={triggerFileInput}
            title="Haz clic para seleccionar o cambiar foto">
            {#if fotoUrl}
              <img 
                src={fotoUrl} 
                alt="Foto de {nombre || 'Empleado'}" 
                class="avatar-img" 
                on:error={(e) => {
                  e.target.style.display = 'none';
                  if (e.target.nextElementSibling) e.target.nextElementSibling.style.display = 'flex';
                }}
              />
              <div class="avatar-fallback-cam" style="display: none;">
                <span class="cam-icon">📷</span>
                <span class="avatar-text">Haz clic para cambiar foto</span>
              </div>
            {:else}
              <div class="avatar-placeholder">
                <span class="cam-icon">📷</span>
                <span class="avatar-text">Haz clic para seleccionar foto</span>
              </div>
            {/if}
          </button>
        </div>

        <!-- Cédula Field -->
        <div class="form-group">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="form-label">Cédula:</label>
          
          {#if isEdit}
            <!-- Disabled Read-Only in Edit Mode -->
            <input 
              type="text" 
              value={`${cedulaPrefix}${cedulaNumber}`} 
              disabled 
              class="form-input disabled-input" 
            />
          {:else}
            <!-- Prefix Dropdown + Numeric Input in Create Mode -->
            <div class="cedula-input-wrapper {cedulaError ? 'has-error' : (cedulaNumber && !checkingCedula ? 'is-valid' : '')}">
              
              <!-- Prefix Trigger Dropdown Button -->
              <div class="prefix-dropdown-container">
                <button 
                  type="button" 
                  class="prefix-btn" 
                  on:click={() => isPrefixDropdownOpen = !isPrefixDropdownOpen}>
                  <span>{cedulaPrefix}</span>
                  <span class="arrow-down">▼</span>
                </button>

                {#if isPrefixDropdownOpen}
                  <div class="prefix-menu">
                    <button 
                      type="button" 
                      class="prefix-item {cedulaPrefix === 'V' ? 'active' : ''}" 
                      on:click={() => selectPrefix('V')}>
                      V
                    </button>
                    <button 
                      type="button" 
                      class="prefix-item {cedulaPrefix === 'E' ? 'active' : ''}" 
                      on:click={() => selectPrefix('E')}>
                      E
                    </button>
                  </div>
                {/if}
              </div>

              <!-- Numeric Input -->
              <input 
                type="text" 
                inputmode="numeric" 
                value={cedulaNumber} 
                on:input={handleCedulaInput}
                placeholder="Ingrese el número de cédula" 
                class="cedula-inner-input" 
                required 
              />

              <!-- Exclamation Error Icon -->
              {#if cedulaError}
                <div class="error-badge-icon" title={cedulaError}>
                  <span>!</span>
                </div>
              {/if}
            </div>

            <!-- Loading Spinner -->
            {#if checkingCedula}
              <div class="verifying-box">
                <div class="spinner-icon"></div>
                <span>Verificando cédula...</span>
              </div>
            {/if}

            <!-- Duplication Error Text -->
            {#if cedulaError}
              <div class="cedula-error-message">
                {cedulaError}
              </div>
            {/if}
          {/if}
        </div>

        <!-- Nombre Field -->
        <div class="form-group">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="form-label">Nombre:</label>
          <input 
            type="text" 
            bind:value={nombre} 
            placeholder="Ingrese el nombre del empleado" 
            class="form-input" 
            required 
          />
        </div>

        <!-- 2 Columns: Fecha de Ingreso & Fecha de Cumpleaños -->
        <div class="grid-2-cols">
          <div class="form-group">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="form-label">Fecha de Ingreso:</label>
            <input 
              type="date" 
              bind:value={fechaIngreso} 
              class="form-input date-input" 
              required 
            />
          </div>

          <div class="form-group">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="form-label">Fecha de Cumpleaños:</label>
            <input 
              type="date" 
              bind:value={fechaNacimiento} 
              class="form-input date-input" 
            />
          </div>
        </div>

        <!-- Sexo Field -->
        <div class="form-group">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="form-label">Sexo:</label>
          <select bind:value={sexo} class="form-select" required>
            <option value="Masculino">Masculino</option>
            <option value="Femenino">Femenino</option>
          </select>
        </div>

        <!-- Cargo Field -->
        <div class="form-group">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="form-label">Cargo:</label>
          <select bind:value={cargoId} class="form-select" required>
            <option value="">Seleccione un cargo...</option>
            {#each availableCargos as c}
              <option value={c.id}>
                {c.nombre} {c.sala_nombre ? `(${c.sala_nombre})` : ''}
              </option>
            {/each}
          </select>
        </div>

        <!-- Dispositivos Field -->
        <div class="form-group">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="form-label">Dispositivos:</label>
          
          <div class="devices-box">
            {#if !cargoId}
              <div class="devices-empty-placeholder">
                Primero selecciona un cargo para ver los dispositivos disponibles
              </div>
            {:else if availableDispositivos.length === 0}
              <div class="devices-empty-placeholder">
                No hay dispositivos registrados en esta sala
              </div>
            {:else}
              <div class="devices-list">
                {#each availableDispositivos as dev}
                  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                  <div 
                    class="device-item" 
                    on:click={() => toggleDispositivo(dev.id)}>
                    <input 
                      type="checkbox" 
                      checked={selectedDispositivoIds.has(Number(dev.id))} 
                      on:change={() => toggleDispositivo(dev.id)}
                      class="device-checkbox" 
                    />
                    <span class="device-name">
                      {dev.nombre} {dev.sala_nombre ? `- ${dev.sala_nombre}` : ''}
                    </span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
          
          <span class="help-text">
            {#if !cargoId}
              Selecciona un cargo primero
            {:else}
              Opcional: Selecciona uno o varios dispositivos de la sala
            {/if}
          </span>
        </div>

        <!-- Modal Footer Actions -->
        <div class="modal-footer">
          <button type="button" class="btn-cancel" on:click={close}>
            Cancelar
          </button>
          <button 
            type="submit" 
            class="btn-submit" 
            disabled={isSubmitting || checkingCedula || !!cedulaError}>
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
            on:touchstart|passive={handleTouchStart}
            on:touchmove|passive={handleTouchMove}
            on:touchend={handleTouchEnd}
            on:wheel|preventDefault={handleWheel}
          ></canvas>

          <!-- Vertical Zoom Slider with Green Thumb -->
          <div class="zoom-slider-container">
            <input 
              type="range" 
              min="1.0" 
              max="3.5" 
              step="0.05" 
              value={cropperZoom} 
              on:input={handleZoomSlider}
              class="vertical-zoom-range" 
              title="Ajustar zoom de la foto" 
            />
          </div>
        </div>

        <!-- Cropper Footer Buttons -->
        <div class="cropper-footer">
          <button type="button" class="btn-cropper-cancel" on:click={cancelCropping}>
            Cancelar Edición
          </button>
          <button type="button" class="btn-cropper-confirm" on:click={processCroppedImage}>
            Procesar Imagen
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
    max-width: 490px;
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
    font-size: 19px;
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
  .avatar-container {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 4px;
  }

  .avatar-circle-btn {
    width: 135px;
    height: 135px;
    border-radius: 50%;
    border: 2px dashed #cbd5e1;
    background: #fafafa;
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
    gap: 6px;
    padding: 10px;
    text-align: center;
  }

  .cam-icon {
    font-size: 24px;
  }

  .avatar-text {
    font-size: 10.5px;
    color: #64748b;
    font-weight: 600;
    line-height: 1.2;
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
    transition: border-color 0.15s;
  }

  .form-input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
  }

  .disabled-input {
    background: #f1f5f9 !important;
    color: #334155 !important;
    cursor: not-allowed;
    border-color: #e2e8f0 !important;
    font-weight: 700;
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
  }

  .grid-2-cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  /* Cédula Compound Input */
  .cedula-input-wrapper {
    display: flex;
    align-items: center;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    background: #ffffff;
    position: relative;
    transition: border-color 0.15s;
  }

  .cedula-input-wrapper.is-valid {
    border-color: #16a34a;
  }

  .cedula-input-wrapper.has-error {
    border-color: #ef4444;
  }

  .prefix-dropdown-container {
    position: relative;
    border-right: 1px solid #e2e8f0;
  }

  .prefix-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 14px;
    border: none;
    background: transparent;
    font-size: 14px;
    font-weight: 800;
    color: #0f172a;
    cursor: pointer;
  }

  .arrow-down {
    font-size: 9px;
    color: #0f172a;
  }

  .prefix-menu {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 50;
    overflow: hidden;
    min-width: 55px;
  }

  .prefix-item {
    display: block;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: transparent;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    text-align: center;
  }

  .prefix-item:hover {
    background: #f1f5f9;
  }

  .prefix-item.active {
    background: #2563eb;
    color: #ffffff;
  }

  .cedula-inner-input {
    flex: 1;
    border: none;
    padding: 10px 12px;
    font-size: 13.5px;
    font-weight: 600;
    color: #0f172a;
    outline: none;
  }

  .error-badge-icon {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1.5px solid #ef4444;
    color: #ef4444;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 900;
    font-size: 12px;
    margin-right: 12px;
  }

  .verifying-box {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #64748b;
    font-weight: 600;
    margin-top: 2px;
  }

  .spinner-icon {
    width: 14px;
    height: 14px;
    border: 2px solid #cbd5e1;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .cedula-error-message {
    font-size: 11.5px;
    font-weight: 700;
    color: #dc2626;
    background: #fef2f2;
    border: 1px solid #fecaca;
    padding: 8px 12px;
    border-radius: 6px;
    line-height: 1.35;
  }

  /* Devices Box */
  .devices-box {
    border: 1px solid #e2e8f0;
    background: #f8fafc;
    border-radius: 10px;
    padding: 14px 16px;
    min-height: 75px;
    display: flex;
    align-items: center;
  }

  .devices-empty-placeholder {
    width: 100%;
    text-align: center;
    font-size: 12.5px;
    font-weight: 600;
    font-style: italic;
    color: #94a3b8;
  }

  .devices-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
  }

  .device-item {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }

  .device-checkbox {
    width: 16px;
    height: 16px;
    accent-color: #2563eb;
    cursor: pointer;
  }

  .device-name {
    font-size: 13px;
    font-weight: 700;
    color: #1e293b;
  }

  .help-text {
    font-size: 11px;
    color: #64748b;
    font-weight: 600;
  }

  /* Modal Footer */
  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    padding-top: 14px;
    border-top: 1px solid #f1f5f9;
  }

  .btn-cancel {
    padding: 9px 20px;
    border-radius: 8px;
    border: none;
    background: #64748b;
    color: #ffffff;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-cancel:hover {
    background: #475569;
  }

  .btn-submit {
    padding: 9px 22px;
    border-radius: 8px;
    border: none;
    background: #22c55e;
    color: #ffffff;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-submit:hover:not(:disabled) {
    background: #16a34a;
  }

  .btn-submit:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  /* Cropper Sub-Modal Overlay */
  .cropper-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(15, 23, 42, 0.85);
    z-index: 99995;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    box-sizing: border-box;
  }

  .cropper-card {
    background: #ffffff;
    border-radius: 14px;
    max-width: 440px;
    width: 100%;
    overflow: hidden;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
  }

  .cropper-viewport {
    position: relative;
    width: 100%;
    height: 330px;
    background: #1e293b;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .cropper-canvas {
    display: block;
    cursor: grab;
    user-select: none;
    touch-action: none;
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .cropper-canvas.is-dragging {
    cursor: grabbing;
  }

  .zoom-slider-container {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    height: 180px;
    width: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .vertical-zoom-range {
    -webkit-appearance: none;
    appearance: none;
    width: 140px;
    height: 6px;
    background: #475569;
    border-radius: 4px;
    outline: none;
    transform: rotate(-90deg);
    cursor: pointer;
  }

  .vertical-zoom-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #16a34a;
    cursor: pointer;
    border: 2px solid #ffffff;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
  }

  .vertical-zoom-range::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #16a34a;
    cursor: pointer;
    border: 2px solid #ffffff;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
  }

  .cropper-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 20px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
  }

  .btn-cropper-cancel {
    padding: 8px 18px;
    border-radius: 8px;
    border: none;
    background: #64748b;
    color: #ffffff;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }

  .btn-cropper-confirm {
    padding: 8px 20px;
    border-radius: 8px;
    border: none;
    background: #16a34a;
    color: #ffffff;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }
</style>
