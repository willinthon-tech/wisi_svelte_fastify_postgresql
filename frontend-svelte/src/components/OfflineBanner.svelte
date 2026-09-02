<script>
  import { onMount } from 'svelte';

  let isOnline = true;

  onMount(() => {
    isOnline = navigator.onLine;

    const handleOnline = () => (isOnline = true);
    const handleOffline = () => (isOnline = false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  });
</script>

{#if !isOnline}
  <div class="offline-banner">
    <span class="offline-dot"></span>
    <span>Modo Sin Conexión (Offline PWA activo). Los datos locales están disponibles.</span>
  </div>
{/if}

<style>
  .offline-banner {
    background: #fef3c7;
    border-bottom: 1px solid #fde68a;
    color: #92400e;
    padding: 8px 16px;
    text-align: center;
    font-size: 12px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
  }

  .offline-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: #f59e0b;
    display: inline-block;
  }
</style>
