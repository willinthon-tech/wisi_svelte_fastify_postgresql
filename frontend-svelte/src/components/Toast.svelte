<script>
  export let message = '';
  export let type = 'info'; // info, success, error
  export let visible = false;
</script>

{#if visible}
  <div class="toast-floating-container">
    <div class="toast-card toast-{type}">
      <span class="toast-icon">
        {#if type === 'success'}✅{/if}
        {#if type === 'error'}⚠️{/if}
        {#if type === 'info'}ℹ️{/if}
      </span>
      <span class="toast-message">{message}</span>
    </div>
  </div>
{/if}

<style>
  .toast-floating-container {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 100001;
    pointer-events: none;
    animation: toastSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .toast-card {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 12px 18px;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
    pointer-events: auto;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  .toast-success {
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    color: #065f46;
  }

  .toast-error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #991b1b;
  }

  .toast-info {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    color: #1e40af;
  }

  .toast-icon {
    font-size: 15px;
  }

  .toast-message {
    font-size: 13px;
    font-weight: 600;
  }

  @keyframes toastSlideUp {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>
