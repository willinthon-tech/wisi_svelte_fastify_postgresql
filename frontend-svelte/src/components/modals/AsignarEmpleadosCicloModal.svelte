<script>
  import { createEventDispatcher } from 'svelte';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { toEmployeePhotoUrl } from '../../config/api.config.js';

  export let show = false;
  export let department = null;

  const dispatch = createEventDispatcher();

  let loading = false;
  let deptInfo = null;
  let plantillasSala = [];
  let empleados = [];
  let search = '';
  let activePickerEmpId = null;
  let initialAssignmentsSnapshot = null;
  let isSaving = false;

  function fixEncoding(str) {
    if (!str || typeof str !== 'string') return '';
    try {
      if (/[\u00C0-\u00FF]/.test(str) && /[\u0080-\u00BF]/.test(str)) {
        return decodeURIComponent(escape(str));
      }
    } catch (e) {}
    return str
      .replace(/Ã³/g, 'ó')
      .replace(/Ã¡/g, 'á')
      .replace(/Ã©/g, 'é')
      .replace(/Ã­/g, 'í')
      .replace(/Ãº/g, 'ú')
      .replace(/Ã±/g, 'ñ')
      .replace(/Ã/g, 'í');
  }

  // Detect if a color is light/pastel to apply dark text and dark border for high contrast
  function isLightColor(colorStr) {
    if (!colorStr) return false;
    let r = 0, g = 0, b = 0;
    const str = String(colorStr).trim().toLowerCase();

    const namedLight = ['white', 'yellow', 'lightyellow', 'lightcyan', 'lightpink', 'pink', 'peachpuff', 'lavender', 'beige', 'wheat'];
    if (namedLight.includes(str)) return true;

    if (str.startsWith('#')) {
      let hex = str.slice(1);
      if (hex.length === 3) {
        hex = hex.split('').map(c => c + c).join('');
      }
      if (hex.length >= 6) {
        r = parseInt(hex.substring(0, 2), 16) || 0;
        g = parseInt(hex.substring(2, 4), 16) || 0;
        b = parseInt(hex.substring(4, 6), 16) || 0;
      }
    } else if (str.startsWith('rgb')) {
      const matches = str.match(/\d+/g);
      if (matches && matches.length >= 3) {
        r = parseInt(matches[0], 10) || 0;
        g = parseInt(matches[1], 10) || 0;
        b = parseInt(matches[2], 10) || 0;
      }
    } else {
      return false;
    }

    // Formula ITU-R BT.601 for perceived brightness
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness >= 155;
  }

  function getBadgeStyleProps(colorStr, isAssigned = false) {
    const light = isLightColor(colorStr);
    const bg = colorStr || '#3b82f6';
    
    if (light) {
      return {
        bg,
        textColor: '#0f172a', // Oscurito para contraste
        borderColor: isAssigned ? '#16a34a' : 'rgba(15, 23, 42, 0.45)', // Borde oscurito
        boxShadow: '0 2px 4px rgba(15, 23, 42, 0.16)',
        textShadow: 'none'
      };
    } else {
      return {
        bg,
        textColor: '#ffffff',
        borderColor: isAssigned ? '#16a34a' : 'rgba(255, 255, 255, 0.9)',
        boxShadow: '0 2px 5px rgba(0, 0, 0, 0.22)',
        textShadow: '0 1px 2px rgba(0, 0, 0, 0.45)'
      };
    }
  }

  // Helper to create a deterministic snapshot string of all employees' assignments
  function computeAssignmentsSnapshot(list) {
    if (!Array.isArray(list)) return '';
    return list
      .map(e => {
        const eId = String(e.empleado_uuid || e.empleado_id || e.id || '');
        const hIds = (e.horarios || [])
          .map(h => String(h.uuid || h.id || ''))
          .filter(Boolean)
          .sort();
        return `${eId}:${hIds.join(',')}`;
      })
      .sort()
      .join('|');
  }

  // Reactive change detection: true ONLY if assignments differ from initial snapshot
  $: currentSnapshot = computeAssignmentsSnapshot(empleados);
  $: hasUnsavedChanges = initialAssignmentsSnapshot !== null && currentSnapshot !== initialAssignmentsSnapshot;

  $: if (show && department && (department.uuid || department.id)) {
    loadDepartmentData(department.uuid || department.id);
  }

  async function loadDepartmentData(deptId) {
    loading = true;
    activePickerEmpId = null;
    initialAssignmentsSnapshot = null;
    try {
      const q = new URLSearchParams({ search: search.trim() });
      const res = await fetch(`/api/master/departamentos-ciclos/${deptId}/empleados?${q.toString()}`);
      const json = await res.json();
      if (json && json.success) {
        deptInfo = json.departamento || department;
        plantillasSala = json.plantillas_sala || [];
        empleados = json.empleados || [];
        initialAssignmentsSnapshot = computeAssignmentsSnapshot(empleados);
      } else {
        triggerToast(json.error || 'Error al cargar empleados del departamento', 'error');
      }
    } catch (err) {
      console.error(err);
      triggerToast('Error al conectar con el servidor', 'error');
    } finally {
      loading = false;
    }
  }

  // Bulk assign plantilla to ALL active employees in this department (EN MEMORIA)
  function handleBulkAssign(plantillaId) {
    if (!plantillaId) return;
    const pObj = plantillasSala.find(p => String(p.uuid || p.id) === String(plantillaId));
    if (!pObj) return;

    empleados = empleados.map(e => {
      const current = Array.isArray(e.horarios) ? e.horarios : [];
      const exists = current.some(h => String(h.uuid || h.id) === String(plantillaId));
      return {
        ...e,
        horarios: exists ? current : [...current, pObj]
      };
    });
  }

  // Bulk remove ALL horario-type plantillas from ALL employees in this department (EN MEMORIA)
  function handleBulkRemoveAll() {
    empleados = empleados.map(e => ({ ...e, horarios: [] }));
  }

  // Toggle single plantilla for specific employee (EN MEMORIA)
  function handleTogglePlantilla(empId, plantillaId) {
    if (!empId || !plantillaId) return;
    const targetEmp = empleados.find(e => String(e.empleado_uuid || e.empleado_id || e.id) === String(empId));
    if (!targetEmp) return;

    const current = Array.isArray(targetEmp.horarios) ? targetEmp.horarios : [];
    const hasIt = current.some(h => String(h.uuid || h.id) === String(plantillaId));
    if (hasIt) {
      targetEmp.horarios = current.filter(h => String(h.uuid || h.id) !== String(plantillaId));
    } else {
      const pObj = plantillasSala.find(p => String(p.uuid || p.id) === String(plantillaId));
      if (pObj) {
        targetEmp.horarios = [...current, pObj];
      }
    }
    empleados = [...empleados];
  }

  // Guardar todos los cambios acumulados en la base de datos
  async function handleSave() {
    const deptId = department?.uuid || department?.id;
    if (!deptId) return;
    isSaving = true;
    try {
      const assignments = empleados.map(e => ({
        empleado_id: String(e.empleado_uuid || e.empleado_id || e.id),
        empleado_uuid: String(e.empleado_uuid || e.empleado_id || e.id),
        plantilla_ids: (e.horarios || []).map(h => String(h.uuid || h.id)),
        plantilla_uuids: (e.horarios || []).map(h => String(h.uuid || h.id))
      }));

      const res = await fetch(`/api/master/departamentos-ciclos/${deptId}/empleados`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments })
      });
      const json = await res.json();
      if (json && json.success) {
        triggerToast('Horarios guardados exitosamente en la base de datos', 'success');
        initialAssignmentsSnapshot = computeAssignmentsSnapshot(empleados);
        dispatch('saved');
        dispatch('close');
      } else {
        throw new Error(json.error || 'Error al guardar horarios');
      }
    } catch (err) {
      console.error(err);
      triggerToast(`Error: ${err.message}`, 'error');
    } finally {
      isSaving = false;
    }
  }

  function closeModal() {
    activePickerEmpId = null;
    initialAssignmentsSnapshot = null;
    dispatch('close');
  }

  $: horariosUnicamente = (plantillasSala || []).filter(p => {
    return p.hora_entrada && p.hora_salida;
  });

  $: filteredEmpleados = empleados.filter(e => {
    if (!search.trim()) return true;
    const term = search.trim().toLowerCase();
    return (
      (e.empleado_nombre || '').toLowerCase().includes(term) ||
      (e.cedula || '').toLowerCase().includes(term) ||
      (e.cargo_nombre || '').toLowerCase().includes(term)
    );
  });
</script>

{#if show}
  <div 
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(4px); z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 20px;">
    
    <div style="background: #ffffff; border-radius: 16px; max-width: 960px; width: 100%; height: min(90vh, 760px); display: flex; flex-direction: column; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4); border: 1px solid #e2e8f0; color: #0f172a; overflow: hidden;">
      
      <!-- Modal Header -->
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 18px 24px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; flex-shrink: 0;">
        <div>
          <h3 style="margin: 0; font-size: 16.5px; font-weight: 800; color: #0f172a;">
            Asignación Directa de Horarios por Empleado
          </h3>
          <div style="font-size: 12px; font-weight: 700; color: #475569; margin-top: 2px;">
            Departamento: <span style="color: #0f172a; font-weight: 800;">{fixEncoding(deptInfo?.departamento_nombre || department?.departamento_nombre || 'Cargando...')}</span> &nbsp;|&nbsp; Sala: <span style="color: #2563eb; font-weight: 800;">{fixEncoding(deptInfo?.sala_nombre || department?.sala_nombre || '')}</span>
          </div>
        </div>

        <button 
          type="button" 
          on:click={closeModal}
          style="width: 30px; height: 30px; border-radius: 50%; border: 1px solid #cbd5e1; background: #ffffff; color: #64748b; font-size: 15px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center;"
          title="Cerrar modal">
          ✕
        </button>
      </div>

      <!-- Modal Body -->
      <div style="padding: 20px 24px 30px 24px; flex: 1 1 0%; min-height: 0; overflow-y: auto; overflow-x: hidden; display: block;">
        
        <!-- Top Section: Horarios (Tipo Horario Únicamente - Solo Circulitos) -->
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 16px; margin-bottom: 16px;">
          <div style="font-size: 12px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span>Horarios Configurables de la Sala ({horariosUnicamente.length})</span>
              {#if empleados.some(e => e.horarios && e.horarios.length > 0)}
                <button
                  type="button"
                  on:click={handleBulkRemoveAll}
                  style="display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 6px; border: 1.5px solid #fca5a5; background: #fef2f2; color: #dc2626; font-size: 11px; font-weight: 800; cursor: pointer; transition: all 0.15s ease; white-space: nowrap; text-transform: none; letter-spacing: 0;"
                  on:mouseenter={(e) => { e.currentTarget.style.background = '#fee2e2'; e.currentTarget.style.borderColor = '#ef4444'; }}
                  on:mouseleave={(e) => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.borderColor = '#fca5a5'; }}
                  title="Quitar TODOS los horarios asignados a todos los empleados de este departamento">
                  🗑️ Quitar Todos
                </button>
              {/if}
            </div>
            <span style="font-size: 11px; font-weight: 600; color: #64748b;">
              👈 Haz clic en cualquier <strong>circulito</strong> para agregar esa pelotica a <strong>TODOS</strong> los empleados
            </span>
          </div>

          {#if horariosUnicamente.length === 0}
            <div style="font-size: 12.5px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 10px 12px;">
              No hay horarios individuales de tipo "horario" registrados para esta sala.
            </div>
          {:else}
            <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
              {#each horariosUnicamente as p}
                {@const bStyle = getBadgeStyleProps(p.color)}
                <button
                  type="button"
                  on:click={() => handleBulkAssign(p.uuid || p.id)}
                  style="width: 34px; height: 34px; border-radius: 50%; background: {bStyle.bg}; color: {bStyle.textColor}; font-weight: 900; font-size: 12.5px; display: flex; align-items: center; justify-content: center; border: 2px solid {bStyle.borderColor}; box-shadow: {bStyle.boxShadow}; text-shadow: {bStyle.textShadow}; cursor: pointer; transition: all 0.15s ease; outline: none;"
                  on:mouseenter={(e) => { e.currentTarget.style.transform = 'scale(1.2)'; e.currentTarget.style.zIndex = '10'; }}
                  on:mouseleave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.zIndex = '1'; }}
                  title="{p.nombre}&#10;{p.hora_entrada ? `${p.hora_entrada} - ${p.hora_salida}` : 'Sin horario'}&#10;👉 (Haz clic para agregar a TODOS los empleados)">
                  {p.codigo || 'H'}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Search Bar -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 12px;">
          <input
            type="text"
            placeholder="🔍 Buscar empleado por nombre, cédula o cargo..."
            bind:value={search}
            style="flex: 1; padding: 8px 14px; font-size: 12.5px; border: 1.5px solid #cbd5e1; border-radius: 8px; outline: none; background: #ffffff;"
          />
          <div style="font-size: 12px; font-weight: 700; color: #475569; white-space: nowrap;">
            Total: <strong>{filteredEmpleados.length}</strong> empleados
          </div>
        </div>

        <!-- Empleados Table Container -->
        {#if loading}
          <div style="text-align: center; padding: 40px; color: #64748b; font-size: 13px;">
            Cargando empleados del departamento...
          </div>
        {:else if filteredEmpleados.length === 0}
          <div style="text-align: center; padding: 36px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 12px; color: #64748b; font-size: 13px;">
            No se encontraron empleados activos asignados a este departamento.
          </div>
        {:else}
          <div style="border: 1px solid #cbd5e1; border-radius: 10px; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.05); overflow: visible;">
            <table style="width: 100%; border-collapse: collapse; font-size: 12.5px; text-align: left;">
              <thead>
                <tr style="background: #f8fafc; color: #475569; font-weight: 800; font-size: 11px; text-transform: uppercase; border-bottom: 1px solid #cbd5e1;">
                  <th style="padding: 10px 14px;">Empleado</th>
                  <th style="padding: 10px 14px;">Cargo / Área</th>
                  <th style="padding: 10px 14px;">Horarios Asignados (Peloticas)</th>
                  <th style="padding: 10px 14px; text-align: center;">Agregar Pelotica</th>
                </tr>
              </thead>
              <tbody>
                {#each filteredEmpleados as emp}
                  {@const empKey = emp.empleado_uuid || emp.empleado_id || emp.id}
                  <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s ease;" on:mouseenter={(e) => e.currentTarget.style.background = '#f8fafc'} on:mouseleave={(e) => e.currentTarget.style.background = '#ffffff'}>
                    
                    <!-- Empleado info -->
                    <td style="padding: 10px 14px;">
                      <div style="display: flex; align-items: center; gap: 10px;">
                        {#if toEmployeePhotoUrl(emp, empKey)}
                          <img 
                            src={toEmployeePhotoUrl(emp, empKey)} 
                            alt={emp.empleado_nombre || 'Empleado'} 
                            style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 1px solid #cbd5e1; background: #e2e8f0;" 
                            on:error={(e) => {
                              e.currentTarget.style.display = 'none';
                              const fallback = e.currentTarget.nextElementSibling;
                              if (fallback) fallback.style.display = 'flex';
                            }}
                          />
                          <div style="display: none; width: 34px; height: 34px; border-radius: 50%; background: #e2e8f0; color: #475569; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; border: 1px solid #cbd5e1;">
                            {emp.empleado_nombre ? emp.empleado_nombre[0].toUpperCase() : 'E'}
                          </div>
                        {:else}
                          <div style="width: 34px; height: 34px; border-radius: 50%; background: #e2e8f0; color: #475569; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; border: 1px solid #cbd5e1;">
                            {emp.empleado_nombre ? emp.empleado_nombre[0].toUpperCase() : 'E'}
                          </div>
                        {/if}
                        <div>
                          <div style="font-weight: 800; color: #0f172a;">{emp.empleado_nombre}</div>
                          <div style="font-size: 11px; color: #64748b; font-weight: 600;">{emp.cedula || `ID: #${empKey}`}</div>
                        </div>
                      </div>
                    </td>

                    <!-- Cargo / Area -->
                    <td style="padding: 10px 14px;">
                      <div style="font-weight: 700; color: #334155;">{emp.cargo_nombre || 'Sin cargo'}</div>
                      <div style="font-size: 11px; color: #64748b;">{emp.area_nombre || ''}</div>
                    </td>

                    <!-- Horarios Asignados (Peloticas puras - Al hacer clic se quitan) -->
                    <td style="padding: 10px 14px;">
                      <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
                        {#if !emp.horarios || emp.horarios.length === 0}
                          <span style="font-size: 11px; color: #94a3b8; font-style: italic;">Sin horarios asignados</span>
                        {:else}
                          {#each emp.horarios as h}
                            {@const bStyle = getBadgeStyleProps(h.color)}
                            <button
                              type="button"
                              on:click={() => handleTogglePlantilla(empKey, h.uuid || h.id)}
                              style="width: 30px; height: 30px; border-radius: 50%; background: {bStyle.bg}; color: {bStyle.textColor}; font-weight: 900; font-size: 11.5px; display: flex; align-items: center; justify-content: center; border: 2px solid {bStyle.borderColor}; box-shadow: {bStyle.boxShadow}; text-shadow: {bStyle.textShadow}; cursor: pointer; transition: all 0.15s ease; outline: none;"
                              on:mouseenter={(e) => { e.currentTarget.style.transform = 'scale(1.18)'; }}
                              on:mouseleave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                              title="{h.nombre}&#10;{h.hora_entrada ? `${h.hora_entrada} - ${h.hora_salida}` : 'Sin horario'}&#10;👉 (Haz clic para ELIMINAR esta pelotica)">
                              {h.codigo || 'H'}
                            </button>
                          {/each}
                        {/if}
                      </div>
                    </td>

                    <!-- Agregar Pelotica (Botón '+' Circular con Despliegue de Peloticas) -->
                    <td style="padding: 10px 14px; text-align: center; position: relative;">
                      <div style="display: flex; align-items: center; justify-content: center;">
                        <button
                          type="button"
                          on:click={() => activePickerEmpId = (activePickerEmpId === empKey ? null : empKey)}
                          style="width: 30px; height: 30px; border-radius: 50%; background: #eff6ff; border: 1.5px dashed #2563eb; color: #2563eb; font-weight: 900; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.06); transition: all 0.15s ease;"
                          on:mouseenter={(e) => { e.currentTarget.style.background = '#dbeafe'; }}
                          on:mouseleave={(e) => { e.currentTarget.style.background = '#eff6ff'; }}
                          title="➕ Agregar pelotica de horario a este empleado">
                          +
                        </button>

                        {#if activePickerEmpId === empKey}
                          <!-- Floating Circle Badge Picker -->
                          <div 
                            style="position: absolute; right: 14px; top: 40px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 10px 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); z-index: 9999; width: max-content; max-width: 300px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
                            <div style="width: 100%; font-size: 10.5px; font-weight: 800; color: #475569; text-transform: uppercase; text-align: left; margin-bottom: 4px;">
                              Selecciona pelotica para agregar:
                            </div>

                            {#each horariosUnicamente as p}
                              {@const isAssigned = emp.horarios && emp.horarios.some(h => String(h.uuid || h.id) === String(p.uuid || p.id))}
                              {@const bStyle = getBadgeStyleProps(p.color, isAssigned)}
                              <button
                                type="button"
                                on:click={() => {
                                  handleTogglePlantilla(empKey, p.uuid || p.id);
                                  activePickerEmpId = null;
                                }}
                                style="width: 30px; height: 30px; border-radius: 50%; background: {bStyle.bg}; color: {bStyle.textColor}; font-weight: 900; font-size: 11px; display: flex; align-items: center; justify-content: center; border: {isAssigned ? '2.5px solid #16a34a' : `2px solid ${bStyle.borderColor}`}; opacity: {isAssigned ? '0.4' : '1'}; cursor: pointer; box-shadow: {bStyle.boxShadow}; text-shadow: {bStyle.textShadow}; transition: all 0.15s ease;"
                                title="{p.nombre}&#10;{p.hora_entrada ? `${p.hora_entrada} - ${p.hora_salida}` : ''}&#10;{isAssigned ? '✓ (Ya asignado - Haz clic para quitar)' : '+ (Haz clic para agregar)'}">
                                {p.codigo || 'H'}
                              </button>
                            {/each}

                            <button
                              type="button"
                              on:click={() => activePickerEmpId = null}
                              style="width: 100%; margin-top: 4px; padding: 3px; font-size: 10px; font-weight: 800; color: #64748b; background: #f1f5f9; border: none; border-radius: 4px; cursor: pointer;">
                              Cerrar
                            </button>
                          </div>
                        {/if}
                      </div>
                    </td>

                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

      </div>

      <!-- Modal Footer -->
      <div style="padding: 14px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; flex-wrap: wrap; gap: 10px;">
        <div>
          {#if hasUnsavedChanges}
            <span style="font-size: 12px; font-weight: 700; color: #d97706; display: flex; align-items: center; gap: 6px;">
              <span>⚠️</span> Tienes cambios pendientes por guardar en base de datos
            </span>
          {/if}
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <button 
            type="button" 
            on:click={closeModal}
            style="padding: 8px 18px; font-size: 13px; font-weight: 700; color: #64748b; background: #ffffff; border: 1.5px solid #cbd5e1; border-radius: 8px; cursor: pointer; transition: all 0.15s;">
            Cancelar
          </button>
          <button 
            type="button" 
            disabled={isSaving || !hasUnsavedChanges}
            on:click={handleSave}
            style="padding: 8px 24px; font-size: 13px; font-weight: 800; color: #ffffff; background: {hasUnsavedChanges ? '#16a34a' : '#94a3b8'}; border: none; border-radius: 8px; cursor: {hasUnsavedChanges ? 'pointer' : 'default'}; box-shadow: {hasUnsavedChanges ? '0 2px 4px rgba(0, 0, 0, 0.15)' : 'none'}; display: flex; align-items: center; gap: 6px; transition: all 0.15s;">
            {#if isSaving}
              <span>Guardando...</span>
            {:else}
              <span>💾 Guardar Cambios</span>
            {/if}
          </button>
        </div>
      </div>

    </div>
  </div>
{/if}
