<script>
  import { createEventDispatcher } from 'svelte';

  export let isOpen = false;
  export let count = 0;
  export let entityType = 'registro';
  export let isDeleting = false;

  const dispatch = createEventDispatcher();

  function handleConfirm() {
    dispatch('confirm');
  }

  function handleCancel() {
    if (isDeleting) return;
    dispatch('close');
  }

  function getPlural(str, cnt) {
    if (!str) return 'registros';
    const s = str.toLowerCase();
    if (s === 'área') return 'áreas';
    if (s === 'departamento') return 'departamentos';
    if (s === 'cargo') return 'cargos';
    if (s === 'horario') return 'horarios';
    if (s === 'empleado') return 'empleados';
    if (s === 'sala') return 'salas';
    if (s === 'dispositivo') return 'dispositivos';
    return s.endsWith('s') ? s : `${s}s`;
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
          <span class="warning-icon">⚠️</span>
          <span>Confirmar Eliminación en Lote</span>
        </div>
        {#if !isDeleting}
          <button type="button" class="close-btn" on:click={handleCancel}>✕</button>
        {/if}
      </div>

      <!-- Body -->
      <div class="modal-body">
        <h4 class="question-text">
          ¿Está seguro de que desea eliminar los <strong>{count}</strong> {getPlural(entityType, count)} seleccionados?
        </h4>

        <!-- Warning Alert Box -->
        <div class="alert-box">
          <div class="alert-title">
            <span>🛡️</span> Protección de Integridad de Datos
          </div>
          <div class="alert-text">
            El sistema intentará eliminar cada elemento. Si algún registro tiene referencias activas en otras tablas (como áreas, cargos o empleados asignados), <strong>no será eliminado</strong> para proteger la integridad de los datos y se le presentará un informe detallado al finalizar.
          </div>
        </div>

        <div class="action-permanent-note">
          <span>⚠️</span> Los elementos sin dependencias serán eliminados de forma permanente.
        </div>
      </div>

      <!-- Footer -->
      <div class="modal-footer">
        <button 
          type="button" 
          class="btn-cancel" 
          disabled={isDeleting}
          on:click={handleCancel}>
          Cancelar
        </button>

        <button 
          type="button" 
          class="btn-confirm" 
          disabled={isDeleting}
          on:click={handleConfirm}>
          {#if isDeleting}
            <span class="spinner"></span>
            <span>Eliminando...</span>
          {:else}
            <span>Sí, Proceder con la Eliminación</span>
          {/if}
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
    z-index: 999999;
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
    border-radius: 14px;
    width: 100%;
    max-width: 500px;
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
    padding: 16px 20px;
    background: #fffbeb;
    border-bottom: 1px solid #fef3c7;
  }

  .modal-title {
    font-size: 16px;
    font-weight: 800;
    color: #92400e;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .warning-icon {
    font-size: 18px;
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
    background: #fef3c7;
  }

  .modal-body {
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .question-text {
    margin: 0;
    font-size: 14.5px;
    font-weight: 600;
    color: #1e293b;
    line-height: 1.45;
  }

  .question-text strong {
    color: #dc2626;
    font-weight: 800;
  }

  .alert-box {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 10px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .alert-title {
    font-size: 12.5px;
    font-weight: 800;
    color: #1d4ed8;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .alert-text {
    font-size: 12px;
    color: #334155;
    line-height: 1.45;
  }

  .action-permanent-note {
    font-size: 11.5px;
    font-weight: 600;
    color: #b91c1c;
    background: #fef2f2;
    border: 1px solid #fecaca;
    padding: 8px 12px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 14px 20px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
  }

  .btn-cancel {
    padding: 9px 18px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    color: #64748b;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-cancel:hover:not(:disabled) {
    background: #f1f5f9;
    color: #0f172a;
  }

  .btn-confirm {
    padding: 9px 20px;
    background: #dc2626;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 800;
    color: #ffffff;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(220, 38, 38, 0.25);
    display: flex;
    align-items: center;
    gap: 8px;
    transition: all 0.15s;
  }

  .btn-confirm:hover:not(:disabled) {
    background: #b91c1c;
    transform: translateY(-1px);
  }

  .btn-confirm:disabled, .btn-cancel:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid #ffffff;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
