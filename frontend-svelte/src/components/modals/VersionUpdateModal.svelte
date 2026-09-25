<script>
  import { isVersionModalOpenStore, availableUpdateStore, executeHardRefresh } from '../../controllers/version.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { toBackendUrl } from '../../config/api.config.js';
  import { isTauriWindows } from '../../services/tauriIsapi.service.js';

  $: update = $availableUpdateStore;

  let isRefreshingData = false;

  async function handleRefreshData() {
    isRefreshingData = true;
    try {
      await executeHardRefresh('Recargando aplicación y renovando archivos estáticos...');
    } finally {
      setTimeout(() => {
        isRefreshingData = false;
      }, 2000);
    }
  }

  function handleClose() {
    isVersionModalOpenStore.set(false);
  }

  function formatVersion(val) {
    if (val === null || val === undefined || val === '') return 'v1';
    const str = String(val).trim();
    const clean = str.replace(/^v+/i, '');
    return `v${clean}`;
  }

  async function handleDownload() {
    if (!update?.downloadUrl) {
      triggerToast('No hay URL de descarga disponible para esta versión.', 'warning');
      return;
    }

    const fullUrl = toBackendUrl(update.downloadUrl);
    triggerToast(`Iniciando descarga oficial de ${formatVersion(update.remoteVersion)}...`, 'info');

    try {
      // 1. En entorno de escritorio Windows (Tauri), invocar comando nativo en Rust para abrir el navegador del sistema
      if (isTauriWindows()) {
        let invokeFn = null;
        if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function') {
          invokeFn = window.__TAURI_INTERNALS__.invoke;
        } else {
          try {
            const tauriCore = await import('@tauri-apps/api/core');
            invokeFn = tauriCore.invoke;
          } catch (_) {}
        }

        if (invokeFn) {
          await invokeFn('open_in_browser', { url: fullUrl });
          return;
        }
      }

      // 2. En Android (Capacitor) o navegador Web
      if (typeof window !== 'undefined') {
        const isCapacitor = typeof window.Capacitor !== 'undefined';
        const target = isCapacitor ? '_system' : '_blank';
        const opened = window.open(fullUrl, target);

        if (!opened) {
          const link = document.createElement('a');
          link.href = fullUrl;
          if (update.filename) link.download = update.filename;
          link.target = '_blank';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      }
    } catch (e) {
      console.error('Error al iniciar descarga:', e);
      triggerToast('Error al iniciar la descarga del instalador.', 'error');
    }
  }
</script>

{#if $isVersionModalOpenStore && update}
  <div class="version-modal-backdrop" on:click|stopPropagation>
    <div class="version-modal-card" on:click|stopPropagation>
      
      <!-- Header Gradient Bar -->
      <div class="version-header-accent"></div>

      <!-- Modal Content Body -->
      <div class="version-modal-inner">
        
        <!-- Icon & Title -->
        <div class="version-top-row">
          <div class="version-icon-box">
            <span class="version-platform-icon">{update.platformIcon || '🚀'}</span>
          </div>
          <div class="version-title-group">
            <div class="version-platform-badge">
              Actualización para {update.platformName}
            </div>
            <h2 class="version-title">¡Nueva Versión Disponible!</h2>
            <p class="version-subtitle">
              Hay una versión más reciente de la aplicación lista para instalar.
            </p>
          </div>
        </div>

        <!-- Version Comparison Badge -->
        <div class="version-compare-card">
          <div class="version-box version-current">
            <span class="version-box-label">Instalada</span>
            <span class="version-box-value">{formatVersion(update.currentVersion)}</span>
          </div>
          <div class="version-arrow">➜</div>
          <div class="version-box version-new">
            <span class="version-box-label">Disponible</span>
            <span class="version-box-value">{formatVersion(update.remoteVersion)}</span>
          </div>
        </div>

        <!-- File Details Card -->
        {#if update.filename}
          <div class="version-file-card">
            <div class="version-file-name">
              📁 {update.filename}
            </div>
            {#if update.peso}
              <div class="version-file-meta">
                <span>Tamaño: {update.peso}</span>
                {#if update.fecha}
                  <span>• Fecha: {new Date(update.fecha).toLocaleDateString('es-VE')}</span>
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Actions -->
        <div class="version-actions-container">
          {#if update.downloadUrl}
            <button
              type="button"
              class="version-btn-primary"
              on:click={handleDownload}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <span>Descargar e Instalar {formatVersion(update.remoteVersion)} ({update.platform === 'android' ? '.APK' : '.EXE'})</span>
            </button>
          {/if}

          <!-- Botón para refrescar estáticos y datos (lo de la flechita circular) -->
          <button
            type="button"
            class="version-btn-secondary {isRefreshingData ? 'is-spinning' : ''}"
            on:click={handleRefreshData}
            disabled={isRefreshingData}
            title="Recargar y limpiar archivos estáticos y datos (Ctrl + F5)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="refresh-svg">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
            <span>{isRefreshingData ? 'Refrescando Estáticos...' : 'Ya actualicé (Refrescar Estáticos y Caché)'}</span>
          </button>

          <button
            type="button"
            class="version-btn-close"
            on:click={handleClose}
          >
            Continuar trabajando
          </button>
        </div>

      </div>

    </div>
  </div>
{/if}

<style>
  .version-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999999;
    background: rgba(15, 23, 42, 0.72);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    animation: fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .version-modal-card {
    background: #ffffff;
    border-radius: 18px;
    box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.35), 0 0 0 1px rgba(226, 232, 240, 0.8);
    width: 100%;
    max-width: 480px;
    overflow: hidden;
    position: relative;
    animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .version-header-accent {
    height: 6px;
    background: linear-gradient(90deg, #3b82f6 0%, #6366f1 50%, #8b5cf6 100%);
    width: 100%;
  }

  .version-modal-inner {
    padding: 26px 26px 22px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .version-top-row {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }

  .version-icon-box {
    width: 52px;
    height: 52px;
    border-radius: 14px;
    background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
    border: 1px solid #bfdbfe;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 26px;
    flex-shrink: 0;
    box-shadow: 0 4px 10px rgba(59, 130, 246, 0.15);
  }

  .version-title-group {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .version-platform-badge {
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #2563eb;
  }

  .version-title {
    margin: 0;
    font-size: 19px;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.25;
  }

  .version-subtitle {
    margin: 0;
    font-size: 13px;
    color: #64748b;
    line-height: 1.4;
  }

  /* Version Compare Card */
  .version-compare-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 12px 18px;
  }

  .version-box {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .version-box-label {
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
  }

  .version-box-value {
    font-size: 16px;
    font-weight: 800;
    font-family: ui-monospace, monospace;
  }

  .version-current .version-box-value {
    color: #475569;
  }

  .version-new .version-box-value {
    color: #16a34a;
  }

  .version-arrow {
    font-size: 16px;
    color: #94a3b8;
    font-weight: 800;
  }

  /* File Card */
  .version-file-card {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .version-file-name {
    font-size: 12.5px;
    font-family: ui-monospace, monospace;
    font-weight: 700;
    color: #0f172a;
    word-break: break-all;
  }

  .version-file-meta {
    font-size: 11px;
    color: #64748b;
    display: flex;
    gap: 8px;
  }

  /* Actions */
  .version-actions-container {
    display: flex;
    flex-direction: column;
    gap: 9px;
    margin-top: 4px;
  }

  .version-btn-primary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
    color: #ffffff;
    padding: 12px 20px;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 800;
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
    transition: all 0.15s ease;
  }

  .version-btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(37, 99, 235, 0.45);
  }

  .version-btn-secondary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: #f8fafc;
    color: #0f172a;
    border: 1px solid #cbd5e1;
    padding: 11px 18px;
    border-radius: 10px;
    font-size: 13.5px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .version-btn-secondary:hover {
    background: #f1f5f9;
    border-color: #94a3b8;
  }

  .version-btn-secondary.is-spinning .refresh-svg {
    animation: spin 0.8s linear infinite;
  }

  .version-btn-close {
    background: transparent;
    border: none;
    color: #64748b;
    font-size: 13px;
    font-weight: 600;
    padding: 8px;
    cursor: pointer;
    text-align: center;
    transition: color 0.15s;
  }

  .version-btn-close:hover {
    color: #0f172a;
    text-decoration: underline;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(16px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
