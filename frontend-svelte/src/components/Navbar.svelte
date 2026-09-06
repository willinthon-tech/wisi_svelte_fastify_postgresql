<script>
  import { createEventDispatcher } from 'svelte';
  import { currentUserStore } from '../controllers/auth.store.js';
  import { triggerToast } from '../controllers/ui.store.js';
  import { navigateToRoute } from '../controllers/router.store.js';
  import { isKioskModeStore, toggleKioskMode } from '../controllers/kiosk.store.js';

  const dispatch = createEventDispatcher();

  function goToProfile() {
    navigateToRoute('profile');
  }

  let isRefreshing = false;
  let refreshCount = 0;
  let refreshTimeout = null;

  async function handleHardRefresh(e) {
    e.stopPropagation();
    refreshCount++;
    isRefreshing = true;

    triggerToast(
      refreshCount > 1 
        ? `Refrescando aplicación (${refreshCount}x)...` 
        : 'Recargando aplicación y limpiando caché...', 
      'info'
    );

    try {
      if (typeof window !== 'undefined') {
        // Limpiar todas las cachés locales de assets / service worker
        if ('caches' in window) {
          const cacheKeys = await caches.keys();
          await Promise.all(cacheKeys.map(key => caches.delete(key)));
        }
        // Desregistrar service workers si existen para forzar bundle fresco
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const reg of registrations) {
            await reg.unregister();
          }
        }
      }
    } catch (err) {
      console.warn('Error al limpiar caché:', err);
    }

    if (refreshTimeout) clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(() => {
      // Recarga completa idéntica a Ctrl + F5
      window.location.reload();
    }, 280);
  }
</script>

<header class="top-navbar">
  <div class="header-left">
    <button 
      on:click={() => dispatch('toggleSidebar')}
      class="menu-toggle"
      title="Toggle Navigation"
      type="button">
      <span class="material-icons">menu</span>
    </button>
  </div>

  <div class="header-right" style="display: flex; align-items: center; gap: 12px;">
    <!-- Botón Modo Kiosco 100% -->
    <button 
      type="button" 
      class="btn-kiosk-mode {$isKioskModeStore ? 'is-active' : ''}" 
      on:click={toggleKioskMode} 
      title={$isKioskModeStore ? 'Salir del Modo Kiosco' : 'Activar Modo Kiosco 100% (Pantalla Completa)'}
      aria-label="Modo Kiosco">
      <span class="material-icons" style="font-size: 20px;">{$isKioskModeStore ? 'fullscreen_exit' : 'fullscreen'}</span>
    </button>

    <!-- Botón Recargar / Hard Refresh (Ctrl + F5) -->
    <button 
      type="button" 
      class="btn-hard-refresh {isRefreshing ? 'is-spinning' : ''}" 
      on:click={handleHardRefresh} 
      title="Recargar y limpiar caché (Ctrl + F5)"
      aria-label="Refrescar aplicación">
      <span class="material-icons refresh-icon">refresh</span>
    </button>

    <div 
      on:click={goToProfile}
      on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && goToProfile()}
      role="button"
      tabindex="0"
      class="user-profile"
      title="Ver Perfil de Usuario"
      style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 4px 10px; border-radius: 10px; background: rgba(241, 245, 249, 0.7); border: 1px solid #e2e8f0; transition: all 0.15s ease;">
      
      <!-- Logo Wisi Space al lado del usuario -->
      <img 
        src="/logo.png" 
        alt="Wisi Space Logo" 
        style="width: 34px; height: 34px; border-radius: 8px; object-fit: contain; flex-shrink: 0; box-shadow: 0 2px 5px rgba(0,0,0,0.12);"
        on:error={(e) => { e.currentTarget.src = '/pwa-192x192.png'; }}
      />

      
      <div style="display: flex; flex-direction: column; text-align: left; line-height: 1.2;">
        <span class="user-name" style="font-size: 13px; font-weight: 700; color: #0f172a;">
          {$currentUserStore?.nombre_apellido || 'Wilinthon Carriedo'}
        </span>
        <span style="font-size: 11px; color: #10b981; font-weight: 600;">
          @{$currentUserStore?.usuario || 'wilinthon'}
        </span>
      </div>
    </div>
  </div>
</header>

<style>
  .btn-kiosk-mode {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #f1f5f9;
    color: #475569;
    border: 1px solid #cbd5e1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.18s ease;
    padding: 0;
    margin: 0;
    outline: none;
    flex-shrink: 0;
  }

  .btn-kiosk-mode:hover {
    transform: scale(1.08);
    background: #e2e8f0;
    color: #0f172a;
  }

  .btn-kiosk-mode.is-active {
    background: linear-gradient(135deg, #059669, #10b981);
    color: #ffffff;
    border: none;
    box-shadow: 0 2px 6px rgba(16, 185, 129, 0.35);
  }

  .btn-hard-refresh {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: linear-gradient(135deg, #3b76ef, #6366f1);
    color: #ffffff;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 6px rgba(59, 118, 239, 0.28);
    transition: transform 0.18s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.18s ease, filter 0.18s ease;
    padding: 0;
    margin: 0;
    outline: none;
    flex-shrink: 0;
  }

  .btn-hard-refresh:hover {
    transform: scale(1.08);
    box-shadow: 0 4px 12px rgba(59, 118, 239, 0.42);
    filter: brightness(1.08);
  }

  .btn-hard-refresh:active {
    transform: scale(0.92);
  }

  .refresh-icon {
    font-size: 20px;
    transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .btn-hard-refresh.is-spinning .refresh-icon {
    animation: spinRefresh 0.6s linear infinite;
  }

  @keyframes spinRefresh {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
