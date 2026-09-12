<script>
  import { createEventDispatcher } from 'svelte';
  import { userSalasStore as masterUserSalasStore } from '../../controllers/master.store.js';

  export let isOpen = false;
  export let corte = null;

  const dispatch = createEventDispatcher();

  let searchQuery = '';

  function handleClose() {
    dispatch('close');
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      handleClose();
    }
  }

  $: salasData = (() => {
    if (!corte) return [];
    const ids = Array.isArray(corte.salas_ids) ? corte.salas_ids : [];
    const nombres = Array.isArray(corte.salas_nombres) ? corte.salas_nombres : [];
    
    // Contar empleados por sala si la data del corte está disponible
    const empCounts = new Map();
    let rawEmps = corte?.data?.empleados;
    if (typeof corte?.data === 'string') {
      try {
        const parsed = JSON.parse(corte.data);
        rawEmps = parsed.empleados || (parsed.reportData && parsed.reportData.empleados);
      } catch (e) {}
    }
    if (Array.isArray(rawEmps)) {
      rawEmps.forEach(e => {
        const sId = Number(e.sala_id);
        if (sId) {
          empCounts.set(sId, (empCounts.get(sId) || 0) + 1);
        }
      });
    }

    return ids.map((id, idx) => {
      const numId = Number(id);
      const name = nombres[idx] || `Sala #${numId}`;
      const count = empCounts.get(numId) || 0;
      return {
        id: numId,
        nombre: name,
        empleadosCount: count
      };
    });
  })();

  $: filteredSalas = salasData.filter(s => {
    if (!searchQuery.trim()) return true;
    const term = searchQuery.toLowerCase().trim();
    return String(s.id).includes(term) || s.nombre.toLowerCase().includes(term);
  });
</script>

{#if isOpen && corte}
  <!-- Backdrop -->
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
        <div class="header-info">
          <div class="header-title-row">
            <span class="header-icon">🎰</span>
            <h2 class="modal-title">Salas del Corte #{corte.id}</h2>
            <span class="badge-count">{salasData.length} salas</span>
          </div>
          <p class="modal-subtitle">
            Período: {corte.fecha_rango || `${corte.fecha_desde} al ${corte.fecha_hasta}`} • Total Empleados: {corte.total_empleados || 0}
          </p>
        </div>
        <button type="button" class="btn-close" on:click={handleClose} title="Cerrar modal">✕</button>
      </div>

      <!-- Search Toolbar if > 3 salas -->
      {#if salasData.length > 3}
        <div class="modal-toolbar">
          <div class="search-wrap">
            <span class="search-icon">🔍</span>
            <input 
              type="text" 
              bind:value={searchQuery}
              placeholder="Buscar por nombre o ID de sala..." 
              class="search-input"
            />
            {#if searchQuery}
              <button type="button" class="clear-btn" on:click={() => { searchQuery = ''; }}>&times;</button>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Body: Grid de Salas -->
      <div class="modal-body">
        {#if filteredSalas.length === 0}
          <div class="empty-state">
            <span class="empty-icon">🔍</span>
            <p>No se encontraron salas con el criterio de búsqueda</p>
          </div>
        {:else}
          <div class="salas-grid">
            {#each filteredSalas as sala}
              <div class="sala-card">
                <div class="sala-card-header">
                  <span class="sala-id-badge">ID #{sala.id}</span>
                  {#if sala.empleadosCount > 0}
                    <span class="sala-emp-badge">👥 {sala.empleadosCount} emp.</span>
                  {/if}
                </div>
                <div class="sala-card-body">
                  <h3 class="sala-name">{sala.nombre}</h3>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <div class="modal-footer">
        <span class="footer-summary">
          Conformación de salas registrada en el corte histórico
        </span>
        <button type="button" class="btn-primary" on:click={handleClose}>
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
    padding: 16px;
    box-sizing: border-box;
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .modal-container {
    background: #ffffff;
    border-radius: 16px;
    width: 100%;
    max-width: 580px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    animation: scaleUp 0.15s ease-out;
  }

  @keyframes scaleUp {
    from { transform: scale(0.96); opacity: 0.8; }
    to { transform: scale(1); opacity: 1; }
  }

  .modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 18px 22px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    gap: 12px;
  }

  .header-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .header-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .header-icon {
    font-size: 20px;
  }

  .modal-title {
    margin: 0;
    font-size: 17px;
    font-weight: 800;
    color: #0f172a;
  }

  .badge-count {
    background: #e0e7ff;
    color: #4338ca;
    font-size: 12px;
    font-weight: 800;
    padding: 2px 8px;
    border-radius: 12px;
    border: 1px solid #c7d2fe;
  }

  .modal-subtitle {
    margin: 0;
    font-size: 12px;
    color: #64748b;
    font-weight: 600;
  }

  .btn-close {
    background: transparent;
    border: none;
    font-size: 16px;
    color: #64748b;
    cursor: pointer;
    border-radius: 6px;
    padding: 4px 8px;
    line-height: 1;
    transition: all 0.15s;
  }

  .btn-close:hover {
    background: #e2e8f0;
    color: #0f172a;
  }

  .modal-toolbar {
    padding: 10px 22px;
    background: #ffffff;
    border-bottom: 1px solid #f1f5f9;
  }

  .search-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 10px;
    font-size: 13px;
    color: #94a3b8;
  }

  .search-input {
    width: 100%;
    padding: 7px 30px 7px 30px;
    font-size: 12.5px;
    border: 1.5px solid #cbd5e1;
    border-radius: 8px;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }

  .search-input:focus {
    border-color: #6366f1;
  }

  .clear-btn {
    position: absolute;
    right: 8px;
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 16px;
    cursor: pointer;
  }

  .modal-body {
    padding: 18px 22px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .salas-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 12px;
  }

  .sala-card {
    background: #ffffff;
    border: 1.5px solid #e2e8f0;
    border-radius: 12px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: all 0.15s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  .sala-card:hover {
    border-color: #818cf8;
    box-shadow: 0 4px 8px rgba(99, 102, 241, 0.12);
    transform: translateY(-1px);
  }

  .sala-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .sala-id-badge {
    background: #eef2ff;
    color: #4f46e5;
    border: 1px solid #c7d2fe;
    padding: 2px 7px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 800;
  }

  .sala-emp-badge {
    background: #eff6ff;
    color: #2563eb;
    border: 1px solid #bfdbfe;
    padding: 2px 7px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
  }

  .sala-name {
    margin: 0;
    font-size: 14px;
    font-weight: 800;
    color: #1e293b;
    line-height: 1.25;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 30px 16px;
    color: #64748b;
    gap: 8px;
  }

  .empty-icon {
    font-size: 24px;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 22px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
  }

  .footer-summary {
    font-size: 11.5px;
    color: #64748b;
    font-weight: 600;
  }

  .btn-primary {
    background: #4f46e5;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    padding: 8px 20px;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-primary:hover {
    background: #4338ca;
  }
</style>
