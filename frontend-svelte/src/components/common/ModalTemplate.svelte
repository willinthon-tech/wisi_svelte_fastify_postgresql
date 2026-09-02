<script>
  import { createEventDispatcher, onDestroy } from 'svelte';

  export let isOpen = false;
  export let title = '';
  export let maxWidth = '540px';

  const dispatch = createEventDispatcher();

  let previousOverflow = '';

  $: if (typeof document !== 'undefined') {
    if (isOpen) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = previousOverflow || '';
    }
  }

  onDestroy(() => {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = previousOverflow || '';
    }
  });

  function closeModal() {
    dispatch('close');
  }

  function handleKeydown(event) {
    if (event.key === 'Escape' && isOpen) {
      closeModal();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
  <!-- Centered Modal Backdrop (No close on click outside) -->
  <div 
    role="presentation"
    class="modal-backdrop-overlay">
    
    <!-- Centered Dialog Container -->
    <div 
      on:click|stopPropagation={() => {}}
      on:keydown|stopPropagation={() => {}}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      aria-labelledby="modal-dialog-title"
      class="modal-dialog-card"
      style="max-width: {maxWidth};">
      
      <!-- Modal Header -->
      <div class="modal-dialog-header">
        <h2 id="modal-dialog-title" class="modal-dialog-title">
          <slot name="title">{title}</slot>
        </h2>
        <button 
          on:click={closeModal}
          type="button"
          aria-label="Close Modal"
          class="modal-close-btn">
          ✕
        </button>
      </div>

      <!-- Modal Body (Internal scrolling prevents screen overflow) -->
      <div class="modal-dialog-body">
        <slot></slot>
      </div>

      {#if $$slots.footer}
        <div class="modal-dialog-footer">
          <slot name="footer"></slot>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    background: rgba(15, 23, 42, 0.6);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    box-sizing: border-box;
  }

  .modal-dialog-card {
    background: #ffffff;
    border-radius: 12px;
    width: 100%;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    border: 1px solid #e2e8f0;
    margin: auto;
    position: relative;
    z-index: 100000;
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: modalPopIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .modal-dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 24px 14px 24px;
    border-bottom: 1px solid #e2e8f0;
    flex-shrink: 0;
  }

  .modal-dialog-title {
    font-size: 16px;
    font-weight: 800;
    color: #0f172a;
    margin: 0;
    line-height: 1.3;
  }

  .modal-close-btn {
    background: transparent;
    border: none;
    font-size: 18px;
    font-weight: 700;
    color: #94a3b8;
    cursor: pointer;
    padding: 4px;
    border-radius: 6px;
    transition: color 0.15s ease, background 0.15s ease;
  }

  .modal-close-btn:hover {
    color: #0f172a;
    background: #f1f5f9;
  }

  .modal-dialog-body {
    padding: 20px 24px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .modal-dialog-footer {
    padding: 14px 24px 18px 24px;
    border-top: 1px solid #e2e8f0;
    background: #f8fafc;
    flex-shrink: 0;
  }

  @keyframes modalPopIn {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(8px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
</style>
