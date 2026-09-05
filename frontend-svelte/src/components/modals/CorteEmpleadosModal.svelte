<script>
  import { createEventDispatcher } from 'svelte';
  import { toBackendUrl } from '../../controllers/master.store.js';

  export let isOpen = false;
  export let corte = null;

  const dispatch = createEventDispatcher();

  let loading = false;
  let error = null;
  let empleados = [];
  let searchQuery = '';

  $: if (isOpen && corte) {
    searchQuery = '';
    loadEmpleados();
  }

  async function loadEmpleados() {
    // Si ya viene el snapshot con empleados precargado
    if (corte?.data?.empleados && Array.isArray(corte.data.empleados)) {
      empleados = corte.data.empleados;
      loading = false;
      error = null;
      return;
    }

    if (!corte?.id) {
      empleados = [];
      return;
    }

    loading = true;
    error = null;
    try {
      const res = await fetch(`/api/master/cortes/${corte.id}`);
      const json = await res.json();
      if (json && json.success && json.data) {
        let corteData = json.data.data;
        if (typeof corteData === 'string') {
          try {
            corteData = JSON.parse(corteData);
            if (typeof corteData === 'string') corteData = JSON.parse(corteData);
          } catch (e) {}
        }
        empleados = corteData?.empleados || [];
      } else {
        error = json?.error || 'No se pudieron cargar los empleados del corte';
      }
    } catch (e) {
      console.error(e);
      error = 'Error de conexión al cargar empleados del corte';
    } finally {
      loading = false;
    }
  }

  $: filteredEmpleados = (empleados || []).filter(emp => {
    if (!searchQuery.trim()) return true;
    const term = searchQuery.toLowerCase().trim();
    const nombre = (emp.nombre || '').toLowerCase();
    const cedula = (emp.cedula || '').toLowerCase();
    const cargo = (emp.cargo || '').toLowerCase();
    const sala = (emp.sala_nombre || '').toLowerCase();
    return nombre.includes(term) || cedula.includes(term) || cargo.includes(term) || sala.includes(term);
  });

  function getFotoUrl(emp) {
    if (!emp) return null;
    let foto = emp.foto;
    if (!foto && emp.id) foto = `${emp.id}.jpg`;
    if (!foto) return null;
    if (foto.startsWith('http') || foto.startsWith('data:')) return foto;
    let cleanFoto = String(foto)
      .replace(/^\/+/, '')
      .replace(/^empleados\//, '')
      .replace(/^photos\//, '')
      .trim();
    return toBackendUrl(`/empleados/${cleanFoto}`, { thumb: true });
  }

  function handleClose() {
    dispatch('close');
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      handleClose();
    }
  }
</script>

{#if isOpen}
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    on:keydown={handleKeydown}
    on:click={handleClose}
  >
    <div
      class="modal-container"
      role="document"
      tabindex="-1"
      on:click|stopPropagation
      on:keydown|stopPropagation
    >
      <!-- Header -->
      <div class="modal-header">
        <div class="header-main">
          <div class="header-icon-box">👥</div>
          <div>
            <div class="header-title-row">
              <h3 class="modal-title">
                Empleados en Corte #{corte?.id || ''}
              </h3>
              {#if corte?.sala_nombre}
                <span class="sala-pill">
                  🏢 {corte.sala_nombre}
                </span>
              {/if}
            </div>
            <p class="modal-subtitle">
              Período Evaluado: <strong>{corte?.fecha_rango || `${corte?.fecha_desde || ''} al ${corte?.fecha_hasta || ''}`}</strong>
              &nbsp;•&nbsp; Total en corte: <strong>{empleados.length || corte?.total_empleados || 0} empleados</strong>
            </p>
          </div>
        </div>

        <button type="button" class="btn-close" on:click={handleClose} title="Cerrar ventana">
          ✕
        </button>
      </div>

      <!-- Toolbar / Search Filter -->
      <div class="modal-toolbar">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input
            type="text"
            bind:value={searchQuery}
            placeholder="Buscar por nombre, cédula, cargo o sala..."
            class="search-input"
          />
          {#if searchQuery}
            <button
              type="button"
              class="clear-search-btn"
              on:click={() => searchQuery = ''}
              title="Limpiar búsqueda"
            >
              ✕
            </button>
          {/if}
        </div>

        <div class="count-badge">
          {#if loading}
            <span>Cargando...</span>
          {:else}
            <span>Mostrando <strong>{filteredEmpleados.length}</strong> de {empleados.length}</span>
          {/if}
        </div>
      </div>

      <!-- Body / Cards Grid -->
      <div class="modal-body">
        {#if loading}
          <div class="state-container">
            <div class="spinner"></div>
            <p class="state-text">Cargando nómina de empleados del corte...</p>
          </div>
        {:else if error}
          <div class="state-container">
            <span class="state-icon">⚠️</span>
            <p class="state-text error">{error}</p>
          </div>
        {:else if filteredEmpleados.length === 0}
          <div class="state-container">
            <span class="state-icon">🔍</span>
            <p class="state-text">
              {#if searchQuery}
                No se encontraron empleados que coincidan con "<strong>{searchQuery}</strong>"
              {:else}
                No hay empleados registrados en este corte histórico.
              {/if}
            </p>
          </div>
        {:else}
          <!-- 3 Columns Grid -->
          <div class="cards-grid">
            {#each filteredEmpleados as emp (emp.id || emp.cedula)}
              <div class="emp-card">
                <!-- Avatar Circular con Borde Azul -->
                <div class="avatar-wrapper">
                  {#if getFotoUrl(emp)}
                    <img
                      src={getFotoUrl(emp)}
                      alt={emp.nombre || 'Empleado'}
                      class="avatar-img"
                      on:error={(e) => {
                        e.currentTarget.style.display = 'none';
                        const fallback = e.currentTarget.parentElement.querySelector('.avatar-fallback');
                        if (fallback) fallback.style.display = 'flex';
                      }}
                    />
                  {/if}
                  <div
                    class="avatar-fallback"
                    style={getFotoUrl(emp) ? 'display: none;' : 'display: flex;'}
                  >
                    <span>{((emp.nombre || 'E').charAt(0)).toUpperCase()}</span>
                  </div>
                </div>

                <!-- Detalles del Empleado -->
                <div class="emp-details">
                  <h4 class="emp-name" title={emp.nombre}>
                    {emp.nombre}
                  </h4>
                  <div class="emp-meta-item">
                    <span class="meta-label">Sala:</span>
                    <span class="meta-value">{emp.sala_nombre || corte?.sala_nombre || 'General'}</span>
                  </div>
                  <div class="emp-meta-item">
                    <span class="meta-label">Cargo:</span>
                    <span class="meta-value" title={emp.cargo}>{emp.cargo || 'Sin Cargo'}</span>
                  </div>
                  <div class="emp-cedula-row">
                    <span class="cedula-badge" title="Cédula de Identidad">
                      🪪 {emp.cedula || 'S/C'}
                    </span>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <div class="modal-footer">
        <span class="footer-info">
          Visualizando snapshot congelado de asistencia
        </span>
        <button type="button" class="btn-primary-close" on:click={handleClose}>
          Cerrar
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
    padding: 20px;
    box-sizing: border-box;
    animation: fadeIn 0.16s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .modal-container {
    background: #f8fafc;
    border-radius: 16px;
    width: 100%;
    max-width: 1050px;
    height: 86vh;
    max-height: 900px;
    display: flex;
    flex-direction: column;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    overflow: hidden;
    animation: slideUp 0.18s ease-out;
  }

  @keyframes slideUp {
    from { transform: translateY(12px) scale(0.98); opacity: 0.8; }
    to { transform: translateY(0) scale(1); opacity: 1; }
  }

  .modal-header {
    background: #ffffff;
    padding: 16px 22px;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .header-main {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .header-icon-box {
    width: 44px;
    height: 44px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    flex-shrink: 0;
  }

  .header-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .modal-title {
    margin: 0;
    font-size: 17px;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.2px;
  }

  .sala-pill {
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
    border-radius: 6px;
    padding: 2px 8px;
    font-size: 11.5px;
    font-weight: 800;
  }

  .modal-subtitle {
    margin: 3px 0 0 0;
    font-size: 12.5px;
    color: #64748b;
  }

  .btn-close {
    background: transparent;
    border: none;
    font-size: 17px;
    color: #64748b;
    cursor: pointer;
    border-radius: 8px;
    padding: 6px 10px;
    line-height: 1;
    transition: all 0.15s;
  }

  .btn-close:hover {
    background: #f1f5f9;
    color: #0f172a;
  }

  .modal-toolbar {
    background: #ffffff;
    padding: 10px 22px;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
  }

  .search-box {
    position: relative;
    flex: 1;
    max-width: 480px;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 12px;
    font-size: 14px;
    color: #94a3b8;
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    padding: 8px 34px 8px 36px;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    font-size: 13px;
    color: #0f172a;
    background: #f8fafc;
    outline: none;
    transition: all 0.15s;
  }

  .search-input:focus {
    background: #ffffff;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
  }

  .clear-search-btn {
    position: absolute;
    right: 10px;
    background: transparent;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    font-size: 13px;
    padding: 2px 4px;
  }

  .clear-search-btn:hover {
    color: #0f172a;
  }

  .count-badge {
    font-size: 12px;
    color: #475569;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    padding: 5px 12px;
    border-radius: 8px;
    font-weight: 600;
    white-space: nowrap;
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 18px 22px;
  }

  /* Grid 3 Columnas */
  .cards-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
  }

  @media (max-width: 900px) {
    .cards-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 600px) {
    .cards-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Card Empleado */
  .emp-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 12px 14px;
    display: flex;
    align-items: center;
    gap: 14px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
    transition: all 0.15s ease;
  }

  .emp-card:hover {
    border-color: #93c5fd;
    box-shadow: 0 4px 10px rgba(59, 130, 246, 0.08);
    transform: translateY(-1px);
  }

  /* Avatar con borde azul */
  .avatar-wrapper {
    position: relative;
    width: 56px;
    height: 56px;
    flex-shrink: 0;
  }

  .avatar-img {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: 2.5px solid #3b82f6;
    object-fit: cover;
    display: block;
    background: #f1f5f9;
  }

  .avatar-fallback {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: 2.5px solid #3b82f6;
    background: #eff6ff;
    color: #1d4ed8;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 800;
    font-size: 18px;
  }

  /* Detalles */
  .emp-details {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .emp-name {
    margin: 0 0 2px 0;
    font-size: 13.5px;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.25;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .emp-meta-item {
    font-size: 11.5px;
    color: #64748b;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta-label {
    font-weight: 500;
    color: #64748b;
  }

  .meta-value {
    font-weight: 700;
    color: #334155;
  }

  .emp-cedula-row {
    margin-top: 4px;
  }

  /* Badge Cédula con borde azul */
  .cedula-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #eff6ff;
    color: #1d4ed8;
    border: 1.5px solid #3b82f6;
    border-radius: 6px;
    padding: 1px 7px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.2px;
  }

  /* Estados vacíos y loading */
  .state-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    gap: 12px;
    text-align: center;
  }

  .state-icon {
    font-size: 36px;
  }

  .state-text {
    font-size: 13.5px;
    color: #64748b;
    margin: 0;
  }

  .state-text.error {
    color: #ef4444;
    font-weight: 600;
  }

  .spinner {
    width: 28px;
    height: 28px;
    border: 3px solid #e2e8f0;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Footer */
  .modal-footer {
    background: #ffffff;
    padding: 12px 22px;
    border-top: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .footer-info {
    font-size: 12px;
    color: #94a3b8;
  }

  .btn-primary-close {
    padding: 7px 20px;
    font-size: 12.5px;
    font-weight: 700;
    color: #334155;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-primary-close:hover {
    background: #e2e8f0;
    color: #0f172a;
  }
</style>
