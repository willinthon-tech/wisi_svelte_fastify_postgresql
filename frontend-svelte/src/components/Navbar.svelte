<script>
  import { createEventDispatcher } from 'svelte';
  import { currentUserStore, logoutUserStore } from '../controllers/auth.store.js';
  import { triggerToast } from '../controllers/ui.store.js';
  import { navigateToRoute } from '../controllers/router.store.js';

  const dispatch = createEventDispatcher();

  function goToProfile() {
    navigateToRoute('profile');
  }

  function handleLogout(e) {
    e.stopPropagation();
    logoutUserStore();
    triggerToast('Sesión cerrada correctamente', 'info');
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
      style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 4px 8px; border-radius: 8px; transition: background 0.15s ease;">
      
      <div class="user-avatar" style="background: linear-gradient(135deg, #3b76ef, #6366f1); color: #ffffff; font-weight: 700; font-size: 13px; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
        {$currentUserStore?.nombre_apellido ? $currentUserStore.nombre_apellido[0] : 'W'}
      </div>
      
      <div style="display: flex; flex-direction: column; text-align: left; line-height: 1.2;">
        <span class="user-name" style="font-size: 13px; font-weight: 700; color: #0f172a;">
          {$currentUserStore?.nombre_apellido || 'Wilinthon Carriedo'}
        </span>
        <span style="font-size: 11px; color: #10b981; font-weight: 600;">
          @{$currentUserStore?.usuario || 'wilinthon'}
        </span>
        <button 
          on:click|stopPropagation={handleLogout}
          type="button"
          style="font-size: 11px; color: #ef4444; font-weight: 700; text-decoration: underline; background: none; border: none; padding: 0; margin-top: 3px; cursor: pointer; text-align: left;">
          Cerrar Sesión
        </button>
      </div>
    </div>
  </div>
</header>

<style>
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
