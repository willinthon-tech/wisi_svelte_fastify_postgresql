<script>
  import { createEventDispatcher } from 'svelte';
  import { masterSalasStore } from '../../controllers/master.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { toEmployeePhotoUrl } from '../../config/api.config.js';

  export let isOpen = false;
  export let assignedSalaIds = [];

  const dispatch = createEventDispatcher();

  // Filtrar solo salas Tipo 1 (grupo_id === 1) asignadas al usuario
  $: salasTipo1 = ($masterSalasStore || []).filter(s => {
    const isTipo1 = Number(s.grupo_id) === 1 || !s.grupo_id;
    if (!isTipo1) return false;
    if (!assignedSalaIds || assignedSalaIds.length === 0) return true;
    return assignedSalaIds.includes(s.id);
  });

  let selectedSalaId = null;
  $: if (salasTipo1.length > 0 && (!selectedSalaId || !salasTipo1.some(s => s.id === selectedSalaId))) {
    selectedSalaId = salasTipo1[0].id;
  }

  let isAuditing = false;
  let auditResult = null;
  let selectedDeviceIndex = 0;
  let activeTab = 'sincronizados'; // 'sincronizados' | 'faltan' | 'sobran'

  // Selecciones masivas
  let selectedFaltanIds = new Set();
  let selectedSobranNos = new Set();
  let actionTarget = 'both'; // 'both' | 'bio' | 'panel'
  let isExecutingAction = false;

  $: currentDevice = auditResult?.devices?.[selectedDeviceIndex] || null;

  // Resetear selecciones al cambiar de dispositivo o pestaña
  $: if (selectedDeviceIndex !== undefined) {
    selectedFaltanIds = new Set();
    selectedSobranNos = new Set();
  }

  async function handleAudit() {
    if (!selectedSalaId) {
      triggerToast('Por favor selecciona una sala para auditar', 'error');
      return;
    }

    isAuditing = true;
    auditResult = null;
    selectedDeviceIndex = 0;
    activeTab = 'sincronizados';
    selectedFaltanIds = new Set();
    selectedSobranNos = new Set();

    try {
      const res = await fetch(`/api/biometricos/auditar-sala/${selectedSalaId}`);
      const json = await res.json();
      if (json && json.success) {
        auditResult = json;
        if (!json.devices || json.devices.length === 0) {
          triggerToast('No se encontraron dispositivos en la sala seleccionada', 'warning');
        } else {
          triggerToast(`Auditoría completada para ${json.devices.length} dispositivo(s)`, 'success');
        }
      } else {
        throw new Error(json.error || 'Error al auditar biométricos');
      }
    } catch (err) {
      console.error(err);
      triggerToast(`Error de auditoría: ${err.message}`, 'error');
    } finally {
      isAuditing = false;
    }
  }

  // Manejo de selecciones "Faltan"
  function toggleSelectFaltan(id) {
    if (selectedFaltanIds.has(id)) {
      selectedFaltanIds.delete(id);
    } else {
      selectedFaltanIds.add(id);
    }
    selectedFaltanIds = new Set(selectedFaltanIds);
  }

  function toggleSelectAllFaltan() {
    if (!currentDevice) return;
    const faltanList = currentDevice.faltan || [];
    if (selectedFaltanIds.size === faltanList.length) {
      selectedFaltanIds = new Set();
    } else {
      selectedFaltanIds = new Set(faltanList.map(e => e.id));
    }
  }

  // Manejo de selecciones "Sobran"
  function toggleSelectSobran(no) {
    if (selectedSobranNos.has(no)) {
      selectedSobranNos.delete(no);
    } else {
      selectedSobranNos.add(no);
    }
    selectedSobranNos = new Set(selectedSobranNos);
  }

  function toggleSelectAllSobran() {
    if (!currentDevice) return;
    const sobranList = currentDevice.sobran || [];
    if (selectedSobranNos.size === sobranList.length) {
      selectedSobranNos = new Set();
    } else {
      selectedSobranNos = new Set(sobranList.map(u => u.employeeNo));
    }
  }

  // Agregar empleados al biométrico / panel
  async function handleAddEmployees(empleadoIds) {
    if (!currentDevice || !empleadoIds || empleadoIds.length === 0) return;

    isExecutingAction = true;
    try {
      const res = await fetch('/api/biometricos/agregar-empleados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dispositivo_id: currentDevice.id,
          empleado_ids: empleadoIds,
          target: actionTarget
        })
      });
      const json = await res.json();
      if (json && json.success) {
        triggerToast(`✅ ${json.successCount || empleadoIds.length} empleado(s) agregados al equipo exitosamente`, 'success');
        await handleAudit();
      } else {
        throw new Error(json.error || 'Error al agregar empleados al equipo');
      }
    } catch (err) {
      console.error(err);
      triggerToast(`Error al agregar: ${err.message}`, 'error');
    } finally {
      isExecutingAction = false;
    }
  }

  // Eliminar usuarios del biométrico / panel
  async function handleDeleteUsers(employeeNos) {
    if (!currentDevice || !employeeNos || employeeNos.length === 0) return;

    if (!confirm(`¿Estás seguro de que deseas eliminar ${employeeNos.length} usuario(s) de este dispositivo biométrico?`)) {
      return;
    }

    isExecutingAction = true;
    try {
      const res = await fetch('/api/biometricos/eliminar-usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dispositivo_id: currentDevice.id,
          employee_nos: employeeNos,
          target: actionTarget
        })
      });
      const json = await res.json();
      if (json && json.success) {
        triggerToast(`🗑️ ${json.successCount || employeeNos.length} usuario(s) eliminados del equipo`, 'success');
        await handleAudit();
      } else {
        throw new Error(json.error || 'Error al eliminar usuarios del equipo');
      }
    } catch (err) {
      console.error(err);
      triggerToast(`Error al eliminar: ${err.message}`, 'error');
    } finally {
      isExecutingAction = false;
    }
  }

  function handleClose() {
    isOpen = false;
    dispatch('close');
  }
</script>

{#if isOpen}
  <!-- Backdrop estático (NO se cierra al hacer clic afuera) -->
  <div class="sync-modal-backdrop">
    <div class="sync-modal-card">
      
      <!-- Modal Header -->
      <div class="sync-modal-header">
        <div class="sync-header-left">
          <div class="sync-header-icon-box">
            🔄
          </div>
          <div>
            <h2 class="sync-header-title">Auditoría y Sincronización de Biométricos</h2>
            <p class="sync-header-subtitle">Compara y sincroniza en tiempo real los empleados del sistema contra los equipos físicos y paneles</p>
          </div>
        </div>

        <button 
          type="button" 
          class="sync-close-btn" 
          on:click={handleClose} 
          title="Cerrar modal (No se cierra al hacer clic afuera)"
        >
          ✕
        </button>
      </div>

      <!-- Controls Bar: Room Selector & Audit Button -->
      <div class="sync-controls-bar">
        <div class="sync-select-group">
          <label for="sync-sala-select" class="sync-label">Sala a Auditar (Tipo 1):</label>
          <select 
            id="sync-sala-select" 
            class="sync-select" 
            bind:value={selectedSalaId}
            disabled={isAuditing || isExecutingAction}
          >
            {#each salasTipo1 as s}
              <option value={s.id}>{s.nombre} {s.nombre_comercial ? `(${s.nombre_comercial})` : ''}</option>
            {/each}
          </select>
        </div>

        <button 
          type="button" 
          class="sync-audit-btn" 
          on:click={handleAudit}
          disabled={isAuditing || isExecutingAction || !selectedSalaId}
        >
          {#if isAuditing}
            <span class="sync-spinner"></span> Conectando y auditando...
          {:else}
            <span>🔍 Checar / Auditar Biométricos</span>
          {/if}
        </button>
      </div>

      <!-- Modal Body -->
      <div class="sync-modal-body">
        {#if isAuditing}
          <div class="sync-loading-container">
            <div class="sync-loading-spinner-large"></div>
            <h3 style="font-size: 16px; font-weight: 800; color: #0f172a; margin: 16px 0 6px 0;">Consultando biométricos y paneles vía ISAPI...</h3>
            <p style="font-size: 13px; color: #64748b; margin: 0; max-width: 480px; text-align: center;">
              Estableciendo conexión por IP pública a cada dispositivo de la sala, descargando listas completas de usuarios registrados y contrastando contra los empleados activos.
            </p>
          </div>
        {:else if !auditResult}
          <div class="sync-placeholder-container">
            <div style="font-size: 48px; margin-bottom: 12px;">📡</div>
            <h3 style="font-size: 16px; font-weight: 800; color: #0f172a; margin: 0 0 6px 0;">Auditoría no iniciada</h3>
            <p style="font-size: 13px; color: #64748b; margin: 0; max-width: 420px; text-align: center;">
              Selecciona la sala que deseas checar arriba y presiona <strong>"Checar / Auditar Biométricos"</strong> para consultar el estado en vivo de los equipos.
            </p>
          </div>
        {:else if auditResult.devices.length === 0}
          <div class="sync-placeholder-container">
            <div style="font-size: 48px; margin-bottom: 12px;">⚠️</div>
            <h3 style="font-size: 16px; font-weight: 800; color: #b91c1c; margin: 0 0 6px 0;">No hay dispositivos registrados</h3>
            <p style="font-size: 13px; color: #64748b; margin: 0;">Esta sala no tiene equipos biométricos configurados en la base de datos.</p>
          </div>
        {:else}
          <!-- Device Selection Pills -->
          <div class="sync-devices-pills-container">
            {#each auditResult.devices as dev, idx}
              {@const isSelected = selectedDeviceIndex === idx}
              <button
                type="button"
                class="sync-device-pill {isSelected ? 'active' : ''}"
                on:click={() => selectedDeviceIndex = idx}
              >
                <div class="sync-pill-top">
                  <span class="sync-pill-name">{dev.nombre}</span>
                  <span class="sync-status-dot {dev.status === 'online' ? 'dot-online' : 'dot-offline'}" title={dev.status === 'online' ? 'En línea' : 'Desconectado / Error'}></span>
                </div>
                <div class="sync-pill-meta">
                  <span>IP: {dev.ip_remota || 'Sin IP'}</span>
                  {#if dev.ip_panel}
                    <span class="sync-panel-chip" title="Panel asociado">📡 Panel</span>
                  {/if}
                </div>
                <div class="sync-pill-counts">
                  <span class="pill-badge badge-sync" title="Sincronizados">🟢 {dev.sincronizados.length}</span>
                  <span class="pill-badge badge-faltan" title="Faltan en equipo">⚠️ {dev.faltan.length}</span>
                  <span class="pill-badge badge-sobran" title="Sobran en equipo">🚫 {dev.sobran.length}</span>
                </div>
              </button>
            {/each}
          </div>

          <!-- Current Device Content Card -->
          {#if currentDevice}
            <div class="sync-device-details-card">
              <!-- Device Sub-header -->
              <div class="sync-device-info-bar">
                <div>
                  <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <h3 style="margin: 0; font-size: 17px; font-weight: 800; color: #0f172a;">
                      {currentDevice.nombre}
                    </h3>
                    <span class="sync-device-badge {currentDevice.status === 'online' ? 'status-online' : 'status-offline'}">
                      {currentDevice.status === 'online' ? '🟢 Biométrico Conectado' : '🔴 Biométrico Desconectado'}
                    </span>
                    {#if currentDevice.ip_panel}
                      <span class="sync-device-badge {currentDevice.panelStatus === 'online' ? 'status-panel-online' : 'status-offline'}">
                        📡 Panel: {currentDevice.ip_panel} ({currentDevice.panelStatus === 'online' ? 'En línea' : 'Desconectado'})
                      </span>
                    {/if}
                  </div>
                  <div style="font-size: 12.5px; color: #64748b; margin-top: 4px; display: flex; gap: 16px; flex-wrap: wrap;">
                    <span>📍 IP Pública Biométrico: <strong>{currentDevice.ip_remota}</strong></span>
                    <span>👥 Total en Biométrico: <strong>{currentDevice.totalEnDispositivo}</strong></span>
                    {#if currentDevice.ip_panel}
                      <span>🚪 Total en Panel: <strong>{currentDevice.totalEnPanel}</strong></span>
                    {/if}
                  </div>
                </div>

                {#if currentDevice.ip_panel}
                  <div class="sync-target-box">
                    <span style="font-size: 11px; font-weight: 700; color: #475569;">Aplicar a:</span>
                    <select bind:value={actionTarget} class="sync-target-select">
                      <option value="both">Biométrico y Panel</option>
                      <option value="bio">Solo Biométrico</option>
                      <option value="panel">Solo Panel</option>
                    </select>
                  </div>
                {/if}
              </div>

              <!-- 3 Main Tabs -->
              <div class="sync-tabs-header">
                <button 
                  type="button" 
                  class="sync-tab-btn {activeTab === 'sincronizados' ? 'active-tab-sync' : ''}"
                  on:click={() => activeTab = 'sincronizados'}
                >
                  🟢 Sincronizados ({currentDevice.sincronizados.length})
                </button>

                <button 
                  type="button" 
                  class="sync-tab-btn {activeTab === 'faltan' ? 'active-tab-faltan' : ''}"
                  on:click={() => activeTab = 'faltan'}
                >
                  ⚠️ Faltan en Biométrico ({currentDevice.faltan.length})
                </button>

                <button 
                  type="button" 
                  class="sync-tab-btn {activeTab === 'sobran' ? 'active-tab-sobran' : ''}"
                  on:click={() => activeTab = 'sobran'}
                >
                  🚫 Sobran en Biométrico ({currentDevice.sobran.length})
                </button>
              </div>

              <!-- Tab 1: Sincronizados -->
              {#if activeTab === 'sincronizados'}
                <div class="sync-tab-content">
                  <div class="sync-tab-intro">
                    <span>✅ Empleados activos que tienen asignado este equipo en el sistema y se encuentran debidamente registrados en el biométrico.</span>
                  </div>

                  {#if currentDevice.sincronizados.length === 0}
                    <div class="sync-empty-tab">No hay empleados coincidentes sincronizados en este momento.</div>
                  {:else}
                    <div class="sync-table-wrapper">
                      <table class="sync-table">
                        <thead>
                          <tr>
                            <th style="width: 50px;">Foto</th>
                            <th style="width: 120px;">Cédula</th>
                            <th>Empleado</th>
                            <th>Cargo</th>
                            <th>Departamento</th>
                            <th style="width: 140px; text-align: center;">Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {#each currentDevice.sincronizados as emp}
                            <tr>
                              <td>
                                <img 
                                  src={toEmployeePhotoUrl(emp.foto || `/empleados/${emp.id}.jpg`, emp.id)} 
                                  alt={emp.nombre}
                                  class="sync-emp-avatar" 
                                  on:error={(e) => { e.currentTarget.src = '/favicon.png'; }}
                                />
                              </td>
                              <td class="font-mono font-bold">{emp.cedula}</td>
                              <td class="font-bold">{emp.nombre}</td>
                              <td>{emp.cargo_nombre}</td>
                              <td>{emp.departamento_nombre}</td>
                              <td style="text-align: center;">
                                <span class="sync-chip-badge-ok">
                                  ✓ Sincronizado
                                </span>
                              </td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  {/if}
                </div>

              <!-- Tab 2: Faltan en Biométrico -->
              {:else if activeTab === 'faltan'}
                <div class="sync-tab-content">
                  <div class="sync-tab-intro" style="background: #fffbeb; border-color: #fde68a; color: #92400e;">
                    <span>⚠️ Empleados activos de la sala que están en el sistema pero <strong>NO</strong> se encuentran registrados en el dispositivo físico.</span>
                  </div>

                  <!-- Toolbar de acciones por lote -->
                  {#if currentDevice.faltan.length > 0}
                    <div class="sync-action-toolbar">
                      <label class="sync-select-all-label">
                        <input 
                          type="checkbox" 
                          checked={selectedFaltanIds.size === currentDevice.faltan.length && currentDevice.faltan.length > 0}
                          on:change={toggleSelectAllFaltan}
                          disabled={isExecutingAction}
                        />
                        <span>Seleccionar todos ({currentDevice.faltan.length})</span>
                      </label>

                      <div style="display: flex; gap: 8px;">
                        {#if selectedFaltanIds.size > 0}
                          <button 
                            type="button" 
                            class="sync-btn-add-bulk"
                            on:click={() => handleAddEmployees(Array.from(selectedFaltanIds))}
                            disabled={isExecutingAction}
                          >
                            ➕ Agregar Seleccionados ({selectedFaltanIds.size})
                          </button>
                        {/if}

                        <button 
                          type="button" 
                          class="sync-btn-add-all"
                          on:click={() => handleAddEmployees(currentDevice.faltan.map(e => e.id))}
                          disabled={isExecutingAction}
                        >
                          ➕ Agregar Todos ({currentDevice.faltan.length})
                        </button>
                      </div>
                    </div>
                  {/if}

                  {#if currentDevice.faltan.length === 0}
                    <div class="sync-empty-tab" style="color: #15803d; background: #f0fdf4; border-color: #bbf7d0;">
                      🎉 ¡Excelente! No falta ningún empleado activo en este biométrico.
                    </div>
                  {:else}
                    <div class="sync-table-wrapper">
                      <table class="sync-table">
                        <thead>
                          <tr>
                            <th style="width: 40px; text-align: center;">
                              <input 
                                type="checkbox" 
                                checked={selectedFaltanIds.size === currentDevice.faltan.length}
                                on:change={toggleSelectAllFaltan}
                                disabled={isExecutingAction}
                              />
                            </th>
                            <th style="width: 50px;">Foto</th>
                            <th style="width: 120px;">Cédula</th>
                            <th>Empleado</th>
                            <th>Cargo</th>
                            <th>Departamento</th>
                            <th style="width: 140px; text-align: center;">Acción</th>
                          </tr>
                        </thead>
                        <tbody>
                          {#each currentDevice.faltan as emp}
                            {@const isSelected = selectedFaltanIds.has(emp.id)}
                            <tr class={isSelected ? 'row-selected' : ''}>
                              <td style="text-align: center;">
                                <input 
                                  type="checkbox" 
                                  checked={isSelected}
                                  on:change={() => toggleSelectFaltan(emp.id)}
                                  disabled={isExecutingAction}
                                />
                              </td>
                              <td>
                                <img 
                                  src={toEmployeePhotoUrl(emp.foto || `/empleados/${emp.id}.jpg`, emp.id)} 
                                  alt={emp.nombre}
                                  class="sync-emp-avatar" 
                                  on:error={(e) => { e.currentTarget.src = '/favicon.png'; }}
                                />
                              </td>
                              <td class="font-mono font-bold">{emp.cedula}</td>
                              <td class="font-bold">{emp.nombre}</td>
                              <td>{emp.cargo_nombre}</td>
                              <td>{emp.departamento_nombre}</td>
                              <td style="text-align: center;">
                                <button 
                                  type="button" 
                                  class="sync-btn-add-single"
                                  on:click={() => handleAddEmployees([emp.id])}
                                  disabled={isExecutingAction}
                                >
                                  ➕ Agregar
                                </button>
                              </td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  {/if}
                </div>

              <!-- Tab 3: Sobran en Biométrico -->
              {:else if activeTab === 'sobran'}
                <div class="sync-tab-content">
                  <div class="sync-tab-intro" style="background: #fef2f2; border-color: #fecaca; color: #991b1b;">
                    <span>🚫 Usuarios que están registrados en el dispositivo físico pero <strong>NO</strong> corresponden a empleados activos autorizados (personal desincorporado, retirado o códigos ajenos).</span>
                  </div>

                  <!-- Toolbar de acciones por lote -->
                  {#if currentDevice.sobran.length > 0}
                    <div class="sync-action-toolbar" style="background: #fff1f2; border-color: #fecdd3;">
                      <label class="sync-select-all-label">
                        <input 
                          type="checkbox" 
                          checked={selectedSobranNos.size === currentDevice.sobran.length && currentDevice.sobran.length > 0}
                          on:change={toggleSelectAllSobran}
                          disabled={isExecutingAction}
                        />
                        <span>Seleccionar todos ({currentDevice.sobran.length})</span>
                      </label>

                      <div style="display: flex; gap: 8px;">
                        {#if selectedSobranNos.size > 0}
                          <button 
                            type="button" 
                            class="sync-btn-del-bulk"
                            on:click={() => handleDeleteUsers(Array.from(selectedSobranNos))}
                            disabled={isExecutingAction}
                          >
                            🗑️ Eliminar Seleccionados ({selectedSobranNos.size})
                          </button>
                        {/if}

                        <button 
                          type="button" 
                          class="sync-btn-del-all"
                          on:click={() => handleDeleteUsers(currentDevice.sobran.map(u => u.employeeNo))}
                          disabled={isExecutingAction}
                        >
                          🗑️ Eliminar Todos ({currentDevice.sobran.length})
                        </button>
                      </div>
                    </div>
                  {/if}

                  {#if currentDevice.sobran.length === 0}
                    <div class="sync-empty-tab" style="color: #15803d; background: #f0fdf4; border-color: #bbf7d0;">
                      🎉 ¡El equipo está limpio! No hay usuarios no autorizados ni sobrantes en este biométrico.
                    </div>
                  {:else}
                    <div class="sync-table-wrapper">
                      <table class="sync-table">
                        <thead>
                          <tr>
                            <th style="width: 40px; text-align: center;">
                              <input 
                                type="checkbox" 
                                checked={selectedSobranNos.size === currentDevice.sobran.length}
                                on:change={toggleSelectAllSobran}
                                disabled={isExecutingAction}
                              />
                            </th>
                            <th style="width: 140px;">Cédula en Equipo</th>
                            <th>Nombre en Equipo</th>
                            <th>Estado en Base de Datos</th>
                            <th style="width: 90px; text-align: center;">Rostro</th>
                            <th style="width: 90px; text-align: center;">Tarjeta</th>
                            <th style="width: 140px; text-align: center;">Acción</th>
                          </tr>
                        </thead>
                        <tbody>
                          {#each currentDevice.sobran as u}
                            {@const isSelected = selectedSobranNos.has(u.employeeNo)}
                            <tr class={isSelected ? 'row-selected-del' : ''}>
                              <td style="text-align: center;">
                                <input 
                                  type="checkbox" 
                                  checked={isSelected}
                                  on:change={() => toggleSelectSobran(u.employeeNo)}
                                  disabled={isExecutingAction}
                                />
                              </td>
                              <td class="font-mono font-bold" style="color: #b91c1c;">{u.employeeNo}</td>
                              <td class="font-bold">{u.name}</td>
                              <td>
                                <span class="sync-chip-system-status {u.systemStatus.includes('Desincorporado') ? 'chip-desinc' : 'chip-unknown'}">
                                  {u.systemStatus}
                                </span>
                              </td>
                              <td style="text-align: center;">
                                {u.numOfFace > 0 ? '👤 Sí' : '—'}
                              </td>
                              <td style="text-align: center;">
                                {u.numOfCard > 0 ? '💳 Sí' : '—'}
                              </td>
                              <td style="text-align: center;">
                                <button 
                                  type="button" 
                                  class="sync-btn-del-single"
                                  on:click={() => handleDeleteUsers([u.employeeNo])}
                                  disabled={isExecutingAction}
                                >
                                  🗑️ Eliminar
                                </button>
                              </td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        {/if}
      </div>

      <!-- Modal Footer -->
      <div class="sync-modal-footer">
        <div style="font-size: 12px; color: #64748b; font-weight: 600;">
          * Las operaciones de alta y baja se ejecutan vía IP pública mediante el protocolo Hikvision ISAPI.
        </div>
        <button 
          type="button" 
          class="sync-close-footer-btn" 
          on:click={handleClose}
        >
          Cerrar
        </button>
      </div>

    </div>
  </div>
{/if}

<style>
  .sync-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: rgba(15, 23, 42, 0.75);
    backdrop-filter: blur(5px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    box-sizing: border-box;
    pointer-events: auto;
  }

  .sync-modal-card {
    background: #ffffff;
    border-radius: 18px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4);
    border: 1px solid #cbd5e1;
    width: 100%;
    max-width: 1280px;
    height: min(92vh, 880px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #0f172a;
    animation: syncModalPop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes syncModalPop {
    from { opacity: 0; transform: scale(0.96) translateY(10px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  .sync-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    flex-shrink: 0;
  }

  .sync-header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .sync-header-icon-box {
    width: 42px;
    height: 42px;
    border-radius: 12px;
    background: #eff6ff;
    border: 1.5px solid #bfdbfe;
    color: #2563eb;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
  }

  .sync-header-title {
    margin: 0;
    font-size: 18px;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.3px;
  }

  .sync-header-subtitle {
    margin: 2px 0 0 0;
    font-size: 12px;
    color: #64748b;
    font-weight: 600;
  }

  .sync-close-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #64748b;
    font-size: 16px;
    font-weight: 800;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .sync-close-btn:hover {
    background: #fee2e2;
    color: #ef4444;
    border-color: #fca5a5;
  }

  .sync-controls-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 24px;
    background: #ffffff;
    border-bottom: 1px solid #e2e8f0;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .sync-select-group {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .sync-label {
    font-size: 13px;
    font-weight: 700;
    color: #334155;
  }

  .sync-select {
    padding: 8px 14px;
    border-radius: 8px;
    border: 1.5px solid #cbd5e1;
    font-size: 13.5px;
    font-weight: 700;
    color: #0f172a;
    background: #f8fafc;
    outline: none;
    min-width: 280px;
    cursor: pointer;
  }

  .sync-select:focus {
    border-color: #3b82f6;
    background: #ffffff;
  }

  .sync-audit-btn {
    padding: 9px 20px;
    border-radius: 9px;
    border: none;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: #ffffff;
    font-size: 13.5px;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 4px 10px rgba(37, 99, 235, 0.25);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transition: all 0.15s ease;
  }

  .sync-audit-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 14px rgba(37, 99, 235, 0.35);
  }

  .sync-audit-btn:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .sync-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid #ffffff;
    border-top-color: transparent;
    border-radius: 50%;
    animation: syncSpin 0.7s linear infinite;
    display: inline-block;
  }

  @keyframes syncSpin {
    to { transform: rotate(360deg); }
  }

  .sync-modal-body {
    flex: 1 1 0%;
    min-height: 0;
    overflow-y: auto;
    padding: 20px 24px;
    background: #f8fafc;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .sync-loading-container, .sync-placeholder-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    margin: auto 0;
  }

  .sync-loading-spinner-large {
    width: 44px;
    height: 44px;
    border: 4px solid #e2e8f0;
    border-top-color: #2563eb;
    border-radius: 50%;
    animation: syncSpin 0.8s linear infinite;
  }

  .sync-devices-pills-container {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding-bottom: 6px;
    flex-shrink: 0;
  }

  .sync-device-pill {
    padding: 10px 14px;
    border-radius: 12px;
    border: 1.5px solid #cbd5e1;
    background: #ffffff;
    text-align: left;
    cursor: pointer;
    min-width: 220px;
    max-width: 260px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    transition: all 0.15s ease;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }

  .sync-device-pill:hover {
    border-color: #94a3b8;
    transform: translateY(-1px);
  }

  .sync-device-pill.active {
    border-color: #2563eb;
    background: #eff6ff;
    box-shadow: 0 4px 10px rgba(37, 99, 235, 0.15);
  }

  .sync-pill-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .sync-pill-name {
    font-size: 13px;
    font-weight: 800;
    color: #0f172a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sync-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot-online { background: #22c55e; box-shadow: 0 0 6px rgba(34, 197, 94, 0.6); }
  .dot-offline { background: #ef4444; }

  .sync-pill-meta {
    font-size: 11px;
    color: #64748b;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .sync-panel-chip {
    padding: 1px 6px;
    border-radius: 4px;
    background: #e0e7ff;
    color: #3730a3;
    font-size: 10px;
    font-weight: 800;
  }

  .sync-pill-counts {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }

  .pill-badge {
    padding: 2px 6px;
    border-radius: 5px;
    font-size: 10.5px;
    font-weight: 800;
  }

  .badge-sync { background: #dcfce7; color: #166534; }
  .badge-faltan { background: #fef3c7; color: #92400e; }
  .badge-sobran { background: #fee2e2; color: #991b1b; }

  .sync-device-details-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.03);
    flex: 1;
    min-height: 0;
  }

  .sync-device-info-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    padding-bottom: 12px;
    border-bottom: 1px solid #f1f5f9;
  }

  .sync-device-badge {
    padding: 3px 10px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 800;
  }

  .status-online { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
  .status-offline { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }
  .status-panel-online { background: #ede9fe; color: #6d28d9; border: 1px solid #ddd6fe; }

  .sync-target-box {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #f8fafc;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
  }

  .sync-target-select {
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid #cbd5e1;
    font-size: 12px;
    font-weight: 700;
    color: #0f172a;
    outline: none;
    cursor: pointer;
  }

  .sync-tabs-header {
    display: flex;
    gap: 8px;
    border-bottom: 1.5px solid #e2e8f0;
    padding-bottom: 2px;
  }

  .sync-tab-btn {
    padding: 8px 16px;
    border-radius: 8px 8px 0 0;
    border: none;
    background: transparent;
    font-size: 13px;
    font-weight: 800;
    color: #64748b;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .sync-tab-btn:hover {
    color: #0f172a;
    background: #f1f5f9;
  }

  .active-tab-sync {
    color: #166534 !important;
    background: #dcfce7 !important;
    box-shadow: inset 0 -2px 0 #16a34a;
  }

  .active-tab-faltan {
    color: #92400e !important;
    background: #fef3c7 !important;
    box-shadow: inset 0 -2px 0 #d97706;
  }

  .active-tab-sobran {
    color: #991b1b !important;
    background: #fee2e2 !important;
    box-shadow: inset 0 -2px 0 #dc2626;
  }

  .sync-tab-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
    flex: 1;
    min-height: 0;
  }

  .sync-tab-intro {
    padding: 8px 12px;
    border-radius: 8px;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    font-size: 12.5px;
    font-weight: 600;
    color: #166534;
  }

  .sync-action-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    border-radius: 8px;
    background: #fffbeb;
    border: 1px solid #fef3c7;
    flex-wrap: wrap;
  }

  .sync-select-all-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 700;
    color: #475569;
    cursor: pointer;
  }

  .sync-btn-add-bulk {
    padding: 6px 12px;
    border-radius: 7px;
    border: 1px solid #22c55e;
    background: #16a34a;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
  }

  .sync-btn-add-all {
    padding: 6px 12px;
    border-radius: 7px;
    border: 1px solid #3b82f6;
    background: #2563eb;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
  }

  .sync-btn-del-bulk {
    padding: 6px 12px;
    border-radius: 7px;
    border: 1px solid #ef4444;
    background: #dc2626;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
  }

  .sync-btn-del-all {
    padding: 6px 12px;
    border-radius: 7px;
    border: 1px solid #f87171;
    background: #b91c1c;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
  }

  .sync-table-wrapper {
    flex: 1;
    min-height: 180px;
    max-height: 420px;
    overflow-y: auto;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
  }

  .sync-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    text-align: left;
  }

  .sync-table th {
    background: #f1f5f9;
    color: #475569;
    padding: 10px 12px;
    font-size: 11.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    position: sticky;
    top: 0;
    z-index: 2;
    border-bottom: 1.5px solid #cbd5e1;
  }

  .sync-table td {
    padding: 8px 12px;
    border-bottom: 1px solid #f1f5f9;
    color: #0f172a;
    vertical-align: middle;
  }

  .sync-emp-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    border: 1.5px solid #cbd5e1;
  }

  .sync-chip-badge-ok {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 6px;
    background: #dcfce7;
    color: #15803d;
    font-size: 11.5px;
    font-weight: 800;
  }

  .sync-chip-system-status {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
  }

  .chip-desinc { background: #fee2e2; color: #b91c1c; }
  .chip-unknown { background: #f1f5f9; color: #64748b; }

  .sync-btn-add-single {
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid #86efac;
    background: #f0fdf4;
    color: #15803d;
    font-size: 11.5px;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .sync-btn-add-single:hover {
    background: #16a34a;
    color: #ffffff;
    border-color: #16a34a;
  }

  .sync-btn-del-single {
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid #fca5a5;
    background: #fef2f2;
    color: #b91c1c;
    font-size: 11.5px;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .sync-btn-del-single:hover {
    background: #dc2626;
    color: #ffffff;
    border-color: #dc2626;
  }

  .sync-empty-tab {
    padding: 30px;
    text-align: center;
    border-radius: 10px;
    background: #f8fafc;
    border: 1px dashed #cbd5e1;
    color: #64748b;
    font-size: 13.5px;
    font-weight: 600;
  }

  .row-selected {
    background: #fefce8 !important;
  }

  .row-selected-del {
    background: #fff1f2 !important;
  }

  .sync-modal-footer {
    padding: 12px 24px;
    background: #ffffff;
    border-top: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .sync-close-footer-btn {
    padding: 8px 18px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    color: #334155;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .sync-close-footer-btn:hover {
    background: #e2e8f0;
  }
</style>
