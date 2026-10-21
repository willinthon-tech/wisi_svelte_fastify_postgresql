<script>
  import { onMount, onDestroy } from 'svelte';
  import { 
    selectedSalaStore, 
    currentUserStore, 
    userSalasStore as authUserSalasStore 
  } from '../controllers/auth.store.js';
  import { 
    masterSalasStore, 
    userSalasStore as masterUserSalasStore, 
    currentRoutePermissionsStore, 
    getUserModuleActions 
  } from '../controllers/master.store.js';
  import { currentRouteStore } from '../controllers/router.store.js';
  import { toBackendUrl } from '../config/api.config.js';
  import { triggerToast } from '../controllers/ui.store.js';
  import { latestBaccaratUpdateStore, sendWebSocketMessage } from '../controllers/websocket.store.js';
  import { 
    upsertLocalItem, 
    deleteLocalItem, 
    getLocalItems, 
    saveLocalItems, 
    generateSafeUuid 
  } from '../services/localDb.service.js';

  // Modal State
  let isModalOpen = false;
  let isLoading = false;
  let isCreating = false;
  let isDeleting = false;
  let isConfirmingDelete = false;

  // Sessions State
  let sessions = [];
  let latestSessionDate = '';
  let suggestedNextDate = '';
  let inputSessionDate = '';

  // 1. Resolve Available Salas for current user (strictly tipo 1 SALAS, strictly user assigned)
  function isTipo1Sala(sala) {
    if (!sala) return false;

    // Grupo UUID check:
    // 51a3d9bc-76d3-4f08-8dd9-97c7f79ea0e3 and 55d65e8b-09b2-4164-8491-efbdd50433b6 are Galpones / Depósitos
    const galponGrupoUuids = [
      '51a3d9bc-76d3-4f08-8dd9-97c7f79ea0e3',
      '55d65e8b-09b2-4164-8491-efbdd50433b6'
    ];
    const gUuid = sala.grupo_uuid ? String(sala.grupo_uuid).toLowerCase().trim() : '';
    if (gUuid && galponGrupoUuids.includes(gUuid)) return false;

    // Grupo Nombre check:
    if (sala.grupo_nombre) {
      const gn = String(sala.grupo_nombre).toLowerCase().trim();
      if (gn.includes('galpon') || gn.includes('galpón') || gn.includes('deposito') || gn.includes('depósito')) {
        return false;
      }
    }

    // Name check:
    const nom = String(sala.nombre || sala.name || '').toLowerCase().trim();
    if (
      nom.includes('galpon') || 
      nom.includes('galpón') || 
      nom.includes('deposito') || 
      nom.includes('depósito') || 
      nom.includes('sótano') || 
      nom.includes('sotano') || 
      nom.includes('almacen') || 
      nom.includes('almacén') || 
      nom === 'gainer' || 
      nom.startsWith('darien')
    ) {
      return false;
    }

    // Legacy fields check (if present)
    if (sala.grupo_id !== undefined && sala.grupo_id !== null && !isNaN(Number(sala.grupo_id))) {
      if (Number(sala.grupo_id) === 2) return false;
    }
    if (sala.tipo_id !== undefined && sala.tipo_id !== null && !isNaN(Number(sala.tipo_id))) {
      if (Number(sala.tipo_id) === 2) return false;
    }
    if (sala.tipo !== undefined && sala.tipo !== null && !isNaN(Number(sala.tipo))) {
      if (Number(sala.tipo) === 2) return false;
    }

    return true;
  }

  // Get assigned sala UUIDs for current user strictly using UUID
  function getAssignedSalaUuids(user, authSalas, salasMap) {
    if (!user) return [];
    // Priority 1: user.salas on the currentUser object
    if (Array.isArray(user.salas) && user.salas.length > 0) {
      return user.salas.map(s => typeof s === 'object' ? s.uuid : s).filter(Boolean).map(String);
    }
    // Priority 2: user_salas dictionary in master store (keyed by user.uuid)
    const uUuid = user.uuid ? String(user.uuid) : null;
    if (uUuid && salasMap && Array.isArray(salasMap[uUuid]) && salasMap[uUuid].length > 0) {
      return salasMap[uUuid].map(s => typeof s === 'object' ? s.uuid : s).filter(Boolean).map(String);
    }
    // Priority 3: authUserSalasStore
    if (Array.isArray(authSalas) && authSalas.length > 0) {
      return authSalas.map(s => typeof s === 'object' ? s.uuid : s).filter(Boolean).map(String);
    }
    return [];
  }

  $: assignedSalaUuids = getAssignedSalaUuids($currentUserStore, $authUserSalasStore, $masterUserSalasStore);

  $: availableSalas = (function () {
    const allSalas = $masterSalasStore || [];
    const rawUserSalas = ($currentUserStore && Array.isArray($currentUserStore.salas)) ? $currentUserStore.salas : [];

    if (assignedSalaUuids.length === 0) {
      return [];
    }

    const candidateSalas = assignedSalaUuids.map(uuid => {
      const fromMaster = allSalas.find(s => String(s.uuid) === String(uuid));
      if (fromMaster) return fromMaster;
      const fromUser = rawUserSalas.find(s => typeof s === 'object' && String(s.uuid) === String(uuid));
      return fromUser || null;
    }).filter(Boolean);

    return candidateSalas.filter(isTipo1Sala);
  })();

  // 2. Active Sala Resolution
  $: effectiveSalaUuid = (function() {
    const route = String($currentRouteStore || '').replace(/^#\/?/, '').replace(/^\//, '').split('?')[0];
    const parts = route.split('/').filter(Boolean);
    if (parts[0] === 'herramientas' && parts[1] === 'scoreboard-baccarat' && parts[2]) {
      const routeSala = parts[2];
      const match = availableSalas.find(s => String(s.uuid) === String(routeSala));
      if (match) return String(match.uuid);
    }
    if ($selectedSalaStore) {
      const match = availableSalas.find(s => String(s.uuid) === String($selectedSalaStore));
      if (match) return String(match.uuid);
    }
    if (availableSalas.length > 0) {
      return String(availableSalas[0].uuid);
    }
    return '';
  })();

  $: activeSalaObj = availableSalas.find(s => String(s.uuid) === String(effectiveSalaUuid)) || availableSalas[0] || null;
  $: activeSalaNombre = activeSalaObj?.nombre || activeSalaObj?.name || 'Sala Principal';

  // 3. Permisos de Gestión
  $: permissions = (function() {
    const routePerms = $currentRoutePermissionsStore || getUserModuleActions('herramientas') || getUserModuleActions('mod-otros-herramientas');
    if (routePerms) return routePerms;
    const user = $currentUserStore;
    const username = (user?.usuario || '').trim().toLowerCase();
    const isAdmin = username === 'admin' || username === 'willinthon' || user?.is_admin === true || user?.rol === 'admin';
    if (isAdmin) return { canView: true, canEdit: true, canAdd: true, canDelete: true };
    return { canView: false, canEdit: false, canAdd: false, canDelete: false };
  })();

  $: isAdmin = Boolean(
    $currentUserStore?.is_admin === true || 
    $currentUserStore?.rol === 'admin' ||
    ['admin', 'willinthon'].includes(($currentUserStore?.usuario || '').toLowerCase())
  );

  $: canViewPerm = Boolean(isAdmin || permissions?.canView);
  $: canAddSession = Boolean(isAdmin || permissions?.canAdd);
  $: canDeleteSession = Boolean(isAdmin || permissions?.canDelete);
  $: canManageSessions = Boolean(canAddSession || canDeleteSession);

  function getTodayStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getNextDateStr(dateStr) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return getTodayStr();
    }
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + 1));
    const ny = date.getUTCFullYear();
    const nm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const nd = String(date.getUTCDate()).padStart(2, '0');
    return `${ny}-${nm}-${nd}`;
  }

  // 4. Cargar sesiones para la sala activa (Local-First con reconciliación de backend)
  async function loadSessions(sUuid) {
    if (!sUuid) return;
    try {
      isLoading = true;
      const targetSala = String(sUuid);

      // 4.1 Cargar primero de base de datos local interna (IndexedDB)
      try {
        const localItems = await getLocalItems('record_libro_score_baccarat', item => 
          String(item.sala_uuid || item.sala_id) === targetSala
        );
        if (localItems && localItems.length > 0) {
          sessions = [...localItems].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
        } else {
          sessions = [];
        }
        recalculateDates();
      } catch (err) {
        console.warn('Error leyendo sesiones locales:', err);
        sessions = [];
        recalculateDates();
      }

      // 4.2 Sincronizar con backend Fastify / PostgreSQL
      try {
        const res = await fetch(toBackendUrl(`/api/baccarat/sessions?sala_uuid=${encodeURIComponent(targetSala)}&sala_id=${encodeURIComponent(targetSala)}`));
        if (res.ok) {
          const json = await res.json();
          if (json && json.success && Array.isArray(json.data)) {
            sessions = [...json.data].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
            if (json.data.length > 0) {
              await saveLocalItems('record_libro_score_baccarat', json.data);
            }
            recalculateDates();
          }
        }
      } catch (err) {
        // Silently keep local-first data
      }

      recalculateDates();
    } catch (e) {
      console.error('Error general cargando sesiones:', e);
    } finally {
      isLoading = false;
    }
  }

  function recalculateDates() {
    if (sessions.length > 0) {
      // El último registro ordenado cronológicamente siempre es la sesión actual de la sala
      const latest = sessions[sessions.length - 1];
      latestSessionDate = latest?.fecha || '';
      suggestedNextDate = getNextDateStr(latestSessionDate);
    } else {
      // Si esa sala no tiene sesión creada, la sugerencia es la del día en curso
      latestSessionDate = '';
      suggestedNextDate = getTodayStr();
    }
    inputSessionDate = suggestedNextDate;
  }

  // Reactive load whenever active sala changes
  let prevSala = null;
  $: if (effectiveSalaUuid && effectiveSalaUuid !== prevSala) {
    prevSala = effectiveSalaUuid;
    loadSessions(effectiveSalaUuid);
  }

  // 5. Manejo de WebSocket Updates y Eventos Locales
  let unsubWs = null;
  onMount(() => {
    loadSessions(effectiveSalaUuid);

    // Escuchar WebSocket
    unsubWs = latestBaccaratUpdateStore.subscribe(update => {
      if (!update) return;
      if (update.isSessionUpdate || update.type === 'BACCARAT_SESSION_UPDATE') {
        const upSala = String(update.salaUuid || update.sala_uuid || update.sala_id || '');
        if (!upSala || upSala === String(effectiveSalaUuid)) {
          loadSessions(effectiveSalaUuid);
        }
      }
    });

    const handleSessionChange = (e) => {
      const detail = e?.detail;
      const upSala = String(detail?.salaUuid || '');
      if (!upSala || upSala === String(effectiveSalaUuid)) {
        loadSessions(effectiveSalaUuid);
      }
    };
    window.addEventListener('wisi-baccarat-session-changed', handleSessionChange);

    return () => {
      if (unsubWs) unsubWs();
      window.removeEventListener('wisi-baccarat-session-changed', handleSessionChange);
    };
  });

  // 6. Acciones del Modal: Crear y Borrar
  function openModal() {
    isConfirmingDelete = false;
    isModalOpen = true;
  }

  function closeModal() {
    isModalOpen = false;
    isConfirmingDelete = false;
  }

  function handleSalaSelectChange(newUuid) {
    if (!newUuid) return;
    selectedSalaStore.set(newUuid);
    loadSessions(newUuid);
  }

  async function handleCreateNewSession() {
    if (!canAddSession) {
      triggerToast('Requiere permiso de AGREGAR para crear sesiones', 'warning');
      return;
    }
    if (isCreating || isLoading) return;
    const targetFecha = (inputSessionDate || suggestedNextDate || getTodayStr()).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetFecha)) {
      triggerToast('La fecha debe tener formato AAAA-MM-DD válido', 'warning');
      return;
    }
    const targetSala = String(effectiveSalaUuid);
    if (!targetSala) {
      triggerToast('Debe seleccionar una sala válida', 'warning');
      return;
    }

    const alreadyExists = sessions.some(s => s.fecha === targetFecha);
    if (alreadyExists) {
      triggerToast(`Ya existe una sesión registrada para el ${targetFecha} en esta sala`, 'warning');
      return;
    }

    const clientUuid = generateSafeUuid();

    try {
      isCreating = true;
      let newSession = null;

      try {
        const res = await fetch(toBackendUrl('/api/baccarat/sessions'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sala_uuid: targetSala,
            sala_id: targetSala,
            fecha: targetFecha,
            uuid: clientUuid
          })
        });
        if (res.ok) {
          const json = await res.json();
          if (json && json.success && json.data) {
            newSession = json.data;
          }
        }
      } catch (e) {
        console.warn('Error al llamar backend para nueva sesión, procediendo localmente:', e);
      }

      if (!newSession) {
        newSession = {
          uuid: clientUuid,
          sala_uuid: targetSala,
          sala_id: targetSala,
          fecha: targetFecha,
          estado: 'abierta',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      }

      // Guardar en base de datos local IndexedDB
      await upsertLocalItem('record_libro_score_baccarat', newSession);

      // Notificar por WebSocket
      sendWebSocketMessage({
        type: 'BACCARAT_SESSION_UPDATE',
        salaUuid: targetSala,
        action: 'CREATE',
        session: newSession
      });

      // Disparar evento local
      window.dispatchEvent(new CustomEvent('wisi-baccarat-session-changed', {
        detail: { action: 'CREATE', session: newSession, salaUuid: targetSala }
      }));

      sessions = [...sessions, newSession].sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));
      recalculateDates();
      triggerToast(`¡Sesión creada para la fecha ${targetFecha}! Ahora es la sesión actual.`, 'success');
      closeModal();
    } catch (err) {
      console.error('Error creando nueva sesión:', err);
      triggerToast('Error al crear nueva sesión', 'error');
    } finally {
      isCreating = false;
    }
  }

  function handleRequestDeleteSession() {
    if (!canDeleteSession) {
      triggerToast('Requiere permiso de ELIMINAR para borrar sesiones', 'warning');
      return;
    }
    if (isDeleting || isLoading) return;
    if (sessions.length === 0) {
      triggerToast('No hay sesiones registradas para eliminar en esta sala.', 'warning');
      return;
    }
    isConfirmingDelete = true;
  }

  async function executeDeleteSession() {
    if (!canDeleteSession) {
      triggerToast('Requiere permiso de ELIMINAR para borrar sesiones', 'warning');
      return;
    }
    if (sessions.length === 0 || isDeleting) return;
    const target = sessions[sessions.length - 1];
    const targetSala = String(effectiveSalaUuid);

    try {
      isDeleting = true;

      // 1. Eliminar en IndexedDB
      if (target.uuid) await deleteLocalItem('record_libro_score_baccarat', target.uuid);
      if (target.id) await deleteLocalItem('record_libro_score_baccarat', target.id);

      // 2. Eliminar en backend
      try {
        await fetch(toBackendUrl('/api/baccarat/sessions/delete-last'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sala_uuid: targetSala, sala_id: targetSala, session_uuid: target.uuid })
        });
      } catch (e) {
        console.warn('Error eliminando en backend, eliminado localmente:', e);
      }

      // 3. Notificar WebSocket
      sendWebSocketMessage({
        type: 'BACCARAT_SESSION_UPDATE',
        salaUuid: targetSala,
        action: 'DELETE',
        deletedSession: target
      });

      // 4. Disparar evento local
      window.dispatchEvent(new CustomEvent('wisi-baccarat-session-changed', {
        detail: { action: 'DELETE', session: target, salaUuid: targetSala }
      }));

      sessions = sessions.slice(0, -1);
      recalculateDates();
      triggerToast(
        sessions.length > 0 
          ? `Última sesión eliminada. Nueva sesión activa: ${latestSessionDate}` 
          : 'Última sesión eliminada. La sala quedó sin sesiones registradas.', 
        'info'
      );
      isConfirmingDelete = false;
      closeModal();
    } catch (err) {
      console.error('Error al borrar sesión:', err);
      triggerToast('Error al borrar sesión', 'error');
    } finally {
      isDeleting = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Escape' && isModalOpen) {
      closeModal();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<!-- BOTÓN EN EL HEADER PRINCIPAL (Ruta Herramientas / Scoreboard) -->
{#if canViewPerm}
  <button
    type="button"
    class="btn-flow btn-session-actual-trigger"
    on:click={openModal}
    title="Gestión de sesión - {activeSalaNombre}"
  >
    <span class="actual-tag">Gestión de Sesión</span>
  </button>
{/if}

<!-- MODAL DE GESTIÓN DE SESIÓN -->
{#if isModalOpen}
  <div 
    class="session-modal-backdrop" 
    on:click|self={closeModal} 
    role="dialog" 
    aria-modal="true" 
    aria-labelledby="modal-session-title"
  >
    <div class="session-modal-card">
      <!-- HEADER DEL MODAL -->
      <div class="session-modal-header">
        <div>
          <h2 id="modal-session-title" class="session-modal-title">
            Gestión de Sesión
          </h2>
          <span class="session-modal-subtitle">
            Baccarat • {activeSalaNombre}
          </span>
        </div>
        <button 
          type="button" 
          class="session-modal-close" 
          on:click={closeModal} 
          aria-label="Cerrar modal"
        >
          ✕
        </button>
      </div>

      <!-- CUERPO DEL MODAL -->
      <div class="session-modal-body">
        <!-- Selector de Sala si hay múltiples disponibles -->
        {#if availableSalas.length > 1}
          <div class="session-field-group">
            <label for="session-sala-select" class="session-field-label">
              Sala:
            </label>
            <select
              id="session-sala-select"
              value={effectiveSalaUuid}
              on:change={(e) => handleSalaSelectChange(e.target.value)}
              class="session-sala-select"
            >
              {#each availableSalas as s}
                <option value={s.uuid}>{s.nombre || s.name}</option>
              {/each}
            </select>
          </div>
        {/if}

        <!-- Resumen de Sesión Actual -->
        <div class="session-status-badge">
          <div class="status-item">
            <span class="status-label">Sesión Actual</span>
            {#if latestSessionDate}
              <span class="status-value highlight">{latestSessionDate}</span>
            {:else}
              <span class="status-value empty">Sin sesiones</span>
            {/if}
          </div>
          <div class="status-sep"></div>
          <div class="status-item">
            <span class="status-label">{sessions.length === 0 ? 'Fecha Inicial' : 'Próxima Sesión'}</span>
            <span class="status-value next">{suggestedNextDate || '—'}</span>
          </div>
          <div class="status-sep"></div>
          <div class="status-item">
            <span class="status-label">Total Sesiones</span>
            <span class="status-value">{sessions.length}</span>
          </div>
        </div>

        <!-- Campo de Fecha Editable (tipo Libro CECOM) -->
        <div class="session-field-group">
          <div class="session-field-header-row">
            <label for="session-date-input" class="session-field-label">
              {sessions.length === 0 ? 'Fecha para Primera Sesión:' : 'Fecha de la Sesión a Crear:'}
            </label>
            {#if inputSessionDate && inputSessionDate !== suggestedNextDate}
              <button 
                type="button" 
                class="btn-reset-suggested" 
                on:click={() => (inputSessionDate = suggestedNextDate)}
                title="Restablecer a la fecha sugerida"
              >
                ↺ Sugerida: {suggestedNextDate}
              </button>
            {/if}
          </div>
          <div class="session-date-input-wrap">
            <input
              id="session-date-input"
              type="date"
              bind:value={inputSessionDate}
              class="session-date-input"
              disabled={!canAddSession || isLoading || isCreating || isDeleting}
            />
          </div>
          <span class="session-date-hint">
            {#if sessions.length === 0}
              Esta sala no tiene sesiones creadas. Se sugiere la fecha de hoy ({suggestedNextDate}), pero puedes cambiarla.
            {:else}
              Fecha sugerida correlativa ({suggestedNextDate}). Puedes escribir o seleccionar cualquier fecha.
            {/if}
          </span>
        </div>

        <!-- Confirmación de Borrado Inline -->
        {#if isConfirmingDelete}
          <div class="confirm-delete-alert">
            <div class="alert-icon">⚠️</div>
            <div class="alert-content">
              <strong>¿Eliminar la última sesión ({latestSessionDate})?</strong>
              <p>
                {sessions.length > 1 
                  ? 'Esta acción eliminará el último registro y la sesión anterior pasará a ser la actual.' 
                  : 'Esta acción eliminará la única sesión registrada y la sala quedará sin sesiones creadas.'}
              </p>
              <div class="alert-actions">
                <button 
                  type="button" 
                  class="btn-alert-cancel" 
                  on:click={() => (isConfirmingDelete = false)}
                  disabled={isDeleting}
                >
                  Cancelar
                </button>
                <button 
                  type="button" 
                  class="btn-alert-confirm" 
                  on:click={executeDeleteSession}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'Borrando...' : 'Confirmar Borrado'}
                </button>
              </div>
            </div>
          </div>
        {/if}

        <!-- LOS 2 BOTONES PRINCIPALES (Crear Nueva Sesión y Borrar Última Sesión) -->
        <div class="session-actions-grid">
          <!-- BOTÓN COL-6: Crear Nueva / Primera Sesión -->
          <button
            type="button"
            class="btn-opt btn-opt-new-session"
            on:click={handleCreateNewSession}
            disabled={!canAddSession || !inputSessionDate || isLoading || isCreating || isDeleting || isConfirmingDelete}
            title={!canAddSession ? 'Requiere permiso de AGREGAR para crear sesiones' : `Crear sesión para fecha ${inputSessionDate}`}
          >
            <span>{isCreating ? 'Creando Sesión...' : (sessions.length === 0 ? 'Crear Primera Sesión' : 'Crear Nueva Sesión')}</span>
            <span class="btn-opt-date-badge">Fecha: {inputSessionDate || '—'}</span>
          </button>

          <!-- BOTÓN COL-6: Borrar Última Sesión -->
          <button
            type="button"
            class="btn-opt btn-opt-delete-session"
            on:click={handleRequestDeleteSession}
            disabled={!canDeleteSession || sessions.length === 0 || isLoading || isDeleting || isCreating || isConfirmingDelete}
            title={!canDeleteSession ? 'Requiere permiso de ELIMINAR para borrar sesiones' : sessions.length === 0 ? 'No hay sesiones registradas' : `Borrar última sesión registrada (${latestSessionDate})`}
          >
            <span>{isDeleting ? 'Borrando...' : 'Borrar Última Sesión'}</span>
            <span class="btn-opt-date-badge">Fecha: {latestSessionDate || 'Ninguna'}</span>
          </button>
        </div>
      </div>

      <!-- FOOTER DEL MODAL -->
      <div class="session-modal-footer">
        <button 
          type="button" 
          class="btn-modal-cancel" 
          on:click={closeModal}
        >
          Cancelar
        </button>
      </div>
    </div>
  </div>
{/if}


<style>
  /* BOTÓN EN EL HEADER PRINCIPAL (Fiel a Imagen 1, 2 y 3) */
  .btn-session-actual-trigger {
    padding: 7px 16px;
    font-size: 13.5px;
    border-radius: 8px;
    background: #ffffff;
    border: 1.5px solid #0284c7;
    box-shadow: 0 2px 5px rgba(2, 132, 199, 0.15);
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
  }
  .btn-session-actual-trigger:hover {
    background: #f0f9ff;
    border-color: #0369a1;
    box-shadow: 0 4px 10px rgba(2, 132, 199, 0.25);
    transform: translateY(-1px);
  }
  .btn-session-actual-trigger .actual-tag {
    font-weight: 800;
    color: #0284c7;
    letter-spacing: 0.3px;
  }
  .btn-session-actual-trigger .actual-date {
    font-weight: 700;
    color: #0f172a;
    letter-spacing: 0.2px;
  }

  /* MODAL OVERLAY BACKDROP */
  .session-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(4px);
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  /* MODAL CARD */
  .session-modal-card {
    max-width: 490px;
    width: 100%;
    background: #ffffff;
    border-radius: 16px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.3);
    border: 1px solid #e2e8f0;
    overflow: hidden;
    animation: modalPop 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes modalPop {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(6px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  /* HEADER */
  .session-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
  }
  .session-modal-title {
    margin: 0;
    font-size: 16px;
    font-weight: 800;
    color: #0f172a;
  }
  .session-modal-subtitle {
    font-size: 12px;
    color: #64748b;
    font-weight: 600;
    display: block;
    margin-top: 2px;
  }
  .session-modal-close {
    background: transparent;
    border: none;
    font-size: 16px;
    color: #94a3b8;
    cursor: pointer;
    padding: 6px;
    border-radius: 6px;
    line-height: 1;
    transition: all 0.15s ease;
  }
  .session-modal-close:hover {
    background: #e2e8f0;
    color: #0f172a;
  }

  /* BODY */
  .session-modal-body {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .session-field-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .session-field-label {
    font-size: 11px;
    font-weight: 800;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .session-sala-select {
    width: 100%;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1.5px solid #cbd5e1;
    font-size: 13.5px;
    font-weight: 700;
    color: #0f172a;
    background: #f8fafc;
    outline: none;
    cursor: pointer;
    transition: border 0.15s ease;
  }
  .session-sala-select:focus {
    border-color: #0284c7;
    background: #ffffff;
  }

  /* STATUS BADGE SUMMARY */
  .session-status-badge {
    display: flex;
    align-items: center;
    justify-content: space-around;
    background: #f1f5f9;
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
  }
  .status-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .status-label {
    font-size: 10.5px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .status-value {
    font-size: 13.5px;
    font-weight: 800;
    color: #0f172a;
  }
  .status-value.highlight {
    color: #0284c7;
  }
  .status-value.next {
    color: #059669;
  }
  .status-value.empty {
    color: #94a3b8;
    font-style: italic;
    font-size: 12px;
  }
  .status-sep {
    width: 1px;
    height: 24px;
    background: #cbd5e1;
  }

  .session-field-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .btn-reset-suggested {
    background: none;
    border: none;
    color: #0284c7;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    text-decoration: underline;
    padding: 2px 6px;
    border-radius: 4px;
    transition: all 0.15s ease;
  }
  .btn-reset-suggested:hover {
    background: #e0f2fe;
    color: #0369a1;
  }
  .session-date-input-wrap {
    position: relative;
    width: 100%;
  }
  .session-date-input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1.5px solid #cbd5e1;
    font-size: 13.5px;
    font-weight: 700;
    color: #0f172a;
    background: #f8fafc;
    outline: none;
    cursor: pointer;
    transition: all 0.15s ease;
    font-family: inherit;
  }
  .session-date-input:focus {
    border-color: #0284c7;
    background: #ffffff;
    box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.15);
  }
  .session-date-hint {
    font-size: 11.5px;
    color: #64748b;
    font-weight: 500;
    line-height: 1.35;
  }

  /* CONFIRM DELETE INLINE ALERT */
  .confirm-delete-alert {
    background: #fef2f2;
    border: 1.5px solid #fecaca;
    border-radius: 10px;
    padding: 12px 14px;
    display: flex;
    gap: 10px;
    animation: fadeIn 0.15s ease-out;
  }
  .alert-icon {
    font-size: 20px;
  }
  .alert-content {
    flex: 1;
  }
  .alert-content strong {
    display: block;
    font-size: 13px;
    color: #991b1b;
    margin-bottom: 4px;
  }
  .alert-content p {
    margin: 0 0 10px 0;
    font-size: 12px;
    color: #7f1d1d;
    line-height: 1.4;
  }
  .alert-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .btn-alert-cancel {
    padding: 5px 12px;
    font-size: 12px;
    font-weight: 700;
    border-radius: 6px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    color: #475569;
    cursor: pointer;
  }
  .btn-alert-confirm {
    padding: 5px 14px;
    font-size: 12px;
    font-weight: 800;
    border-radius: 6px;
    background: #dc2626;
    border: none;
    color: #ffffff;
    cursor: pointer;
  }
  .btn-alert-confirm:hover {
    background: #b91c1c;
  }

  /* GRID DE ACCIONES CON LOS 2 BOTONES (EXACTO IMAGEN 4) */
  .session-actions-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    width: 100%;
    margin-top: 4px;
  }

  .btn-opt {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 13.5px;
    font-weight: 800;
    border-radius: 9px;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
    text-align: center;
    line-height: 1.2;
  }

  /* BOTÓN 1: Crear Nueva Sesión (Azul - Idéntico a Imagen 4) */
  .btn-opt-new-session {
    background: #0369a1;
    color: #e0f2fe;
    border: 1.5px solid #0284c7;
    flex-direction: column;
    gap: 5px;
    padding: 12px 10px;
    box-shadow: 0 2px 6px rgba(3, 105, 161, 0.25);
  }
  .btn-opt-new-session:hover:not(:disabled) {
    background: #0284c7;
    color: #ffffff;
    box-shadow: 0 4px 12px rgba(2, 132, 199, 0.4);
    transform: translateY(-1px);
  }
  .btn-opt-new-session .btn-opt-date-badge {
    font-size: 11px;
    font-weight: 800;
    color: #bae6fd;
    background: rgba(14, 116, 144, 0.45);
    padding: 2.5px 8px;
    border-radius: 6px;
    border: 1px solid rgba(56, 189, 248, 0.3);
    letter-spacing: 0.3px;
  }

  /* BOTÓN 2: Borrar Última Sesión (Maroon / Vinotinto - Idéntico a Imagen 4) */
  .btn-opt-delete-session {
    background: #881337;
    color: #ffe4e6;
    border: 1.5px solid #be123c;
    flex-direction: column;
    gap: 5px;
    padding: 12px 10px;
    box-shadow: 0 2px 6px rgba(136, 19, 55, 0.25);
  }
  .btn-opt-delete-session:hover:not(:disabled) {
    background: #be123c;
    color: #ffffff;
    box-shadow: 0 4px 12px rgba(190, 18, 60, 0.4);
    transform: translateY(-1px);
  }
  .btn-opt-delete-session .btn-opt-date-badge {
    font-size: 11px;
    font-weight: 800;
    color: #fecdd3;
    background: rgba(159, 18, 57, 0.45);
    padding: 2.5px 8px;
    border-radius: 6px;
    border: 1px solid rgba(244, 63, 94, 0.3);
    letter-spacing: 0.3px;
  }

  .btn-opt:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    filter: grayscale(0.5);
    box-shadow: none;
    transform: none;
  }

  /* FOOTER */
  .session-modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 12px 18px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
  }
  .btn-modal-cancel {
    padding: 7px 16px;
    font-size: 13px;
    font-weight: 700;
    color: #475569;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 7px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn-modal-cancel:hover {
    background: #f1f5f9;
    color: #0f172a;
    border-color: #94a3b8;
  }
</style>
