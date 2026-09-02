<script>
  import { createEventDispatcher } from 'svelte';

  export let isOpen = false;
  export let report = null;

  const dispatch = createEventDispatcher();

  $: deleted = report?.deleted || [];
  $: blocked = report?.blocked || [];
  $: errors = report?.errors || [];
  $: total = report?.total || (deleted.length + blocked.length + errors.length);
  $: entityType = report?.entityType || 'registro';

  function handleClose() {
    dispatch('close');
  }

  function capitalize(str) {
    if (!str) return 'Registro';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
</script>

{#if isOpen}
  <!-- Backdrop -->
  <div 
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1">
    
    <div class="modal-card" on:click|stopPropagation>
      <!-- Header -->
      <div class="modal-header">
        <div class="modal-title">
          <span>📋</span>
          <span>Resultado de la Eliminación en Lote</span>
        </div>
        <button type="button" class="close-btn" on:click={handleClose}>✕</button>
      </div>

      <!-- Body -->
      <div class="modal-body">
        <!-- Summary Stats Grid -->
        <div class="stats-grid">
          <div class="stat-card stat-success">
            <div class="stat-number">{deleted.length}</div>
            <div class="stat-label">✅ Eliminados con Éxito</div>
          </div>
          <div class="stat-card stat-blocked">
            <div class="stat-number">{blocked.length + errors.length}</div>
            <div class="stat-label">⚠️ No Eliminados (Protegidos)</div>
          </div>
        </div>

        {#if blocked.length > 0 || errors.length > 0}
          <div class="section-title">
            <span>Motivo de los registros que no pudieron eliminarse:</span>
          </div>

          <!-- Scrollable Blocked Items List -->
          <div class="blocked-items-list">
            {#each blocked as item}
              <div class="blocked-item-card">
                <div class="blocked-item-header">
                  <span class="blocked-item-name">{item.name || `ID: ${item.id}`}</span>
                  <span class="blocked-badge">No eliminado</span>
                </div>
                
                <div class="blocked-item-reason">
                  <span>⚠️</span> {item.reason || 'Este registro tiene elementos o relaciones asociadas que impiden su eliminación.'}
                </div>

                {#if item.dependencies && item.dependencies.length > 0}
                  <div class="dependencies-chips">
                    <span class="chips-label">Elementos asociados:</span>
                    {#each item.dependencies as dep}
                      <span class="chip">
                        <strong>{dep.label}:</strong> {dep.count}
                      </span>
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}

            {#each errors as err}
              <div class="blocked-item-card error-card">
                <div class="blocked-item-header">
                  <span class="blocked-item-name">ID: {err.id}</span>
                  <span class="blocked-badge error-badge">Error</span>
                </div>
                <div class="blocked-item-reason">
                  <span>❌</span> {err.error || 'Error inesperado al intentar eliminar este registro.'}
                </div>
              </div>
            {/each}
          </div>

          <!-- Guidance Box -->
          <div class="guidance-box">
            <span>💡</span>
            <div class="guidance-text">
              Para poder eliminar los registros protegidos, primero debe reasignar o eliminar los elementos que dependen directamente de ellos (por ejemplo, áreas, cargos o empleados asociados).
            </div>
          </div>
        {:else}
          <div class="all-success-box">
            <span>🎉</span> Todos los registros seleccionados fueron eliminados correctamente sin inconvenientes.
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <div class="modal-footer">
        <button type="button" class="btn-primary" on:click={handleClose}>
          Entendido
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.7);
    backdrop-filter: blur(4px);
    z-index: 9999999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .modal-card {
    background: #ffffff;
    border-radius: 16px;
    width: 100%;
    max-width: 580px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4);
    border: 1px solid #e2e8f0;
    color: #0f172a;
    font-family: inherit;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 22px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    flex-shrink: 0;
  }

  .modal-title {
    font-size: 16px;
    font-weight: 800;
    color: #0f172a;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .close-btn {
    background: transparent;
    border: none;
    font-size: 18px;
    font-weight: 800;
    color: #94a3b8;
    cursor: pointer;
    line-height: 1;
    padding: 4px;
    border-radius: 6px;
    transition: all 0.15s;
  }

  .close-btn:hover {
    color: #0f172a;
    background: #e2e8f0;
  }

  .modal-body {
    padding: 20px 22px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
    flex: 1;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .stat-card {
    border-radius: 10px;
    padding: 14px 16px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }

  .stat-success {
    background: #f0fdf4;
    border: 1.5px solid #bbf7d0;
  }

  .stat-success .stat-number {
    font-size: 24px;
    font-weight: 900;
    color: #16a34a;
  }

  .stat-success .stat-label {
    font-size: 11.5px;
    font-weight: 800;
    color: #15803d;
  }

  .stat-blocked {
    background: #fff7ed;
    border: 1.5px solid #fed7aa;
  }

  .stat-blocked .stat-number {
    font-size: 24px;
    font-weight: 900;
    color: #ea580c;
  }

  .stat-blocked .stat-label {
    font-size: 11.5px;
    font-weight: 800;
    color: #c2410c;
  }

  .section-title {
    font-size: 12px;
    font-weight: 800;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .blocked-items-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 260px;
    overflow-y: auto;
    padding-right: 4px;
  }

  .blocked-item-card {
    background: #fffbeb;
    border: 1px solid #fef3c7;
    border-left: 4px solid #f59e0b;
    border-radius: 8px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .error-card {
    background: #fef2f2;
    border-color: #fecaca;
    border-left-color: #ef4444;
  }

  .blocked-item-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .blocked-item-name {
    font-size: 13.5px;
    font-weight: 800;
    color: #0f172a;
  }

  .blocked-badge {
    font-size: 10.5px;
    font-weight: 800;
    padding: 2px 7px;
    border-radius: 4px;
    background: #fef3c7;
    color: #b45309;
    border: 1px solid #fde68a;
  }

  .error-badge {
    background: #fee2e2;
    color: #b91c1c;
    border-color: #fca5a5;
  }

  .blocked-item-reason {
    font-size: 12px;
    color: #475569;
    line-height: 1.4;
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }

  .dependencies-chips {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }

  .chips-label {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
  }

  .chip {
    font-size: 11px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    padding: 2px 8px;
    border-radius: 4px;
    color: #334155;
  }

  .guidance-box {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 12px;
    color: #334155;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    line-height: 1.45;
  }

  .all-success-box {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    border-radius: 8px;
    padding: 16px;
    text-align: center;
    font-size: 13.5px;
    font-weight: 700;
    color: #15803d;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 14px 22px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    flex-shrink: 0;
  }

  .btn-primary {
    padding: 9px 24px;
    background: #2563eb;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 800;
    color: #ffffff;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(37, 99, 235, 0.2);
    transition: all 0.15s;
  }

  .btn-primary:hover {
    background: #1d4ed8;
  }
</style>
