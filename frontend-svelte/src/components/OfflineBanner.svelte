<script>
  import { onMount, onDestroy } from 'svelte';
  import { pendingSyncCountStore } from '../services/localDb.service.js';

  let isOnline = true;
  let wasOffline = false;
  let showReconnectedNotice = false;
  let noticeTimeout = null;

  onMount(() => {
    if (typeof window !== 'undefined') {
      isOnline = navigator.onLine;

      const handleOnline = () => {
        isOnline = true;
        if (wasOffline) {
          showReconnectedNotice = true;
          if (noticeTimeout) clearTimeout(noticeTimeout);
          noticeTimeout = setTimeout(() => {
            showReconnectedNotice = false;
            wasOffline = false;
          }, 4000);
        }
      };

      const handleOffline = () => {
        isOnline = false;
        wasOffline = true;
        showReconnectedNotice = false;
      };

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        if (noticeTimeout) clearTimeout(noticeTimeout);
      };
    }
  });
</script>

{#if !isOnline}
  <div class="offline-banner" role="status" aria-live="polite">
    <div class="offline-banner-content">
      <span class="offline-dot pulse"></span>
      <span class="offline-title">Modo Offline Activado •</span>
      <span class="offline-message">
        Puedes seguir trabajando con normalidad. Tus datos se guardan en la base de datos local y se sincronizarán con la nube automáticamente cuando regrese la conexión.
      </span>
      {#if $pendingSyncCountStore > 0}
        <span class="pending-badge">
          {$pendingSyncCountStore} {$pendingSyncCountStore === 1 ? 'cambio pendiente' : 'cambios pendientes'}
        </span>
      {/if}
    </div>
  </div>
{:else if showReconnectedNotice}
  <div class="reconnected-banner" role="status" aria-live="polite">
    <div class="offline-banner-content">
      <span class="online-dot pulse"></span>
      <span class="online-title">Conexión Restablecida:</span>
      <span class="online-message">
        Sincronizando cambios locales con la nube en segundo plano...
      </span>
    </div>
  </div>
{/if}

<style>
  .offline-banner {
    background: #fef3c7;
    border-bottom: 1px solid #fde68a;
    color: #92400e;
    padding: 10px 18px;
    font-size: 12.5px;
    font-weight: 600;
    width: 100%;
    box-sizing: border-box;
    box-shadow: 0 2px 6px rgba(180, 83, 9, 0.08);
    transition: all 0.3s ease;
    z-index: 90;
  }

  .reconnected-banner {
    background: #dcfce7;
    border-bottom: 1px solid #86efac;
    color: #166534;
    padding: 10px 18px;
    font-size: 12.5px;
    font-weight: 600;
    width: 100%;
    box-sizing: border-box;
    box-shadow: 0 2px 6px rgba(22, 101, 52, 0.08);
    transition: all 0.3s ease;
    z-index: 90;
  }

  .offline-banner-content {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 8px;
    max-width: 1300px;
    margin: 0 auto;
    text-align: center;
    line-height: 1.4;
  }

  .offline-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background-color: #d97706;
    display: inline-block;
    flex-shrink: 0;
  }

  .online-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background-color: #16a34a;
    display: inline-block;
    flex-shrink: 0;
  }

  .pulse {
    animation: pulse 1.8s infinite ease-in-out;
  }

  @keyframes pulse {
    0% {
      transform: scale(0.95);
      box-shadow: 0 0 0 0 rgba(217, 119, 6, 0.6);
    }
    70% {
      transform: scale(1.15);
      box-shadow: 0 0 0 5px rgba(217, 119, 6, 0);
    }
    100% {
      transform: scale(0.95);
      box-shadow: 0 0 0 0 rgba(217, 119, 6, 0);
    }
  }

  .offline-title {
    font-weight: 800;
    color: #78350f;
    letter-spacing: 0.2px;
  }

  .offline-message {
    color: #92400e;
    font-weight: 600;
  }

  .online-title {
    font-weight: 800;
    color: #14532d;
    letter-spacing: 0.2px;
  }

  .online-message {
    color: #166534;
    font-weight: 600;
  }

  .pending-badge {
    background: #f59e0b;
    color: #ffffff;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.3px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }
</style>
