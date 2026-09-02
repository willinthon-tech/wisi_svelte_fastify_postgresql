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

  <div class="header-right">
    <div 
      on:click={goToProfile}
      on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && goToProfile()}
      role="button"
      tabindex="0"
      class="user-profile"
      title="Ver Perfil de Usuario"
      style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 4px 8px; border-radius: 8px; transition: background 0.15s ease;">
      
      <div class="user-avatar" style="background: linear-gradient(135deg, #3b76ef, #6366f1); color: #ffffff; font-weight: 700; font-size: 13px; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
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
