<script>
  import { createEventDispatcher } from 'svelte';

  export let isOpen = false;
  export let blockedData = null;

  const dispatch = createEventDispatcher();

  $: entityType = blockedData?.entityType || 'registro';
  $: entityName = blockedData?.entityName || '';
  $: entityId = blockedData?.entityId || '';
  $: dependencies = blockedData?.dependencies || [];

  function handleClose() {
    dispatch('close');
  }

  function capitalize(str) {
    if (!str) return 'Registro';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function getArticle(typeStr) {
    const lower = (typeStr || '').toLowerCase();
    if (lower.endsWith('a') || lower === 'página' || lower === 'área' || lower === 'sala') {
      return 'la';
    }
    return 'el';
  }

  function getDemonstrative(typeStr) {
    const lower = (typeStr || '').toLowerCase();
    if (lower.endsWith('a') || lower === 'página' || lower === 'área' || lower === 'sala') {
      return 'esta';
    }
    return 'este';
  }
</script>

{#if isOpen}
  <div class="modal-backdrop">
    <div class="modal-container">
      <!-- Modal Header -->
      <div class="modal-header">
        <div class="modal-title">
          <span>⚠️</span> No se puede eliminar {getArticle(entityType)} {entityType.toLowerCase()}
        </div>
        <button type="button" class="close-btn" on:click={handleClose}>✕</button>
      </div>

      <!-- Modal Body -->
      <div class="modal-body">
        <h4 class="main-warning-text">
          No se puede eliminar {getArticle(entityType)} {entityType.toLowerCase()} porque tiene elementos asociados.
        </h4>

        <!-- Highlight Box (Red Left Border) -->
        <div class="highlight-box">
          <span class="entity-label">{capitalize(entityType)}:</span>
          <span class="entity-value">{entityName} (ID: {entityId})</span>
        </div>

        <!-- Section Label -->
        <div class="section-label">
          Elementos asociados que impiden la eliminación:
        </div>

        <!-- Yellow Cards List -->
        <div class="dependencies-list">
          {#each dependencies as dep}
            <div class="dependency-card">
              <span class="dep-label">{dep.label}</span>
              <span class="dep-badge">{dep.count} elemento(s)</span>
            </div>
          {/each}
        </div>

        <!-- Light Blue Info Box -->
        <div class="info-box">
          Para eliminar {getDemonstrative(entityType)} {entityType.toLowerCase()}, primero debe eliminar todos los elementos asociados listados arriba.
        </div>
      </div>

      <!-- Modal Footer -->
      <div class="modal-footer">
        <button type="button" class="btn-understand" on:click={handleClose}>
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
    background: rgba(15, 23, 42, 0.6);
    backdrop-filter: blur(4px);
    z-index: 9999999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .modal-container {
    background: #ffffff;
    border-radius: 12px;
    width: 100%;
    max-width: 480px;
    overflow: hidden;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    border: 1px solid #e2e8f0;
    color: #0f172a;
    font-family: system-ui, -apple-system, sans-serif;
  }

  .modal-header {
    padding: 14px 20px;
    background: #fde8e8;
    border-bottom: 1px solid #fbd5d5;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-title {
    font-size: 15px;
    font-weight: 800;
    color: #9b1c1c;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 16px;
    cursor: pointer;
    color: #9b1c1c;
    padding: 4px;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: #fbd5d5;
  }

  .modal-body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .main-warning-text {
    margin: 0;
    font-size: 14.5px;
    font-weight: 800;
    color: #771d1d;
    line-height: 1.35;
  }

  .highlight-box {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-left: 4px solid #e02424;
    border-radius: 8px;
    padding: 12px 14px;
    font-size: 13.5px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .entity-label {
    font-weight: 800;
    color: #0f172a;
  }

  .entity-value {
    color: #334155;
    font-weight: 600;
  }

  .section-label {
    font-size: 13px;
    color: #4b5563;
    font-weight: 600;
    margin-top: 2px;
  }

  .dependencies-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .dependency-card {
    background: #fef08a;
    border: 1px solid #fde047;
    border-radius: 8px;
    padding: 10px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .dep-label {
    font-size: 13.5px;
    font-weight: 800;
    color: #713f12;
  }

  .dep-badge {
    background: #e02424;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
    padding: 3px 10px;
    border-radius: 12px;
    letter-spacing: 0.2px;
  }

  .info-box {
    background: #e0f2fe;
    border: 1px solid #bae6fd;
    color: #0369a1;
    border-radius: 8px;
    padding: 12px 14px;
    font-size: 12.5px;
    line-height: 1.4;
  }

  .modal-footer {
    padding: 12px 20px;
    background: #ffffff;
    border-top: 1px solid #f1f5f9;
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  .btn-understand {
    padding: 8px 24px;
    background: #e02424;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    font-size: 13.5px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.15s ease;
    box-shadow: 0 2px 4px rgba(224, 36, 36, 0.2);
  }

  .btn-understand:hover {
    background: #c81e1e;
  }
</style>
