<script>
  import { 
    currentUserStore, 
    userSalasStore, 
    selectedSalaStore, 
    isAuthenticatedStore,
    loginUserStore,
    logoutUserStore
  } from '../controllers/auth.store.js';

  import { triggerToast } from '../controllers/ui.store.js';
  import { navigateToRoute } from '../controllers/router.store.js';
  import { getCloudBaseUrl } from '../config/api.config.js';

  let usuario = '';
  let password = '';
  let loading = false;

  $: currentServerHost = (function() {
    try {
      return new URL(getCloudBaseUrl()).host;
    } catch {
      return (typeof window !== 'undefined' && window.location.host) ? window.location.host : 'localhost';
    }
  })();

  async function handleLogin() {
    if (!usuario.trim() || !password.trim()) {
      triggerToast('Ingresa usuario y contraseña', 'error');
      return;
    }
    loading = true;
    try {
      await loginUserStore(usuario.trim(), password.trim());
      triggerToast(`Bienvenido ${$currentUserStore?.nombre_apellido || usuario}`, 'success');
      password = '';
      navigateToRoute('dashboard');
    } catch (err) {
      triggerToast(err.message || 'Credenciales inválidas', 'error');
    } finally {
      loading = false;
    }
  }

  function handleLogout() {
    logoutUserStore();
    triggerToast('Sesión cerrada correctamente', 'info');
  }
</script>

<div style="width: 100%; max-width: 440px; margin: 0 auto;">
  <!-- Autenticador & Login Card Único y Limpio -->
  <div class="flow-card" style="box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3); border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);">
    <div style="text-align: center; margin-bottom: 24px;">
      <h2 style="font-size: 24px; font-weight: 800; color: #0f172a; margin-bottom: 6px; letter-spacing: -0.5px;">
        Wisi <span style="color: #3b82f6;">Space</span>
      </h2>
      <p style="font-size: 13px; color: #64748b; margin: 0;">
        Ingresa tus credenciales para acceder al sistema
      </p>
    </div>

    {#if $isAuthenticatedStore}
      <div style="padding: 16px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; margin-bottom: 20px; text-align: center;">
        <h4 style="font-size: 14px; font-weight: 700; color: #065f46; margin-bottom: 4px;">
          👤 Sesión Activa: {$currentUserStore?.nombre_apellido || 'Usuario'}
        </h4>
        <p style="font-size: 12px; color: #047857; margin: 0;">
          @{$currentUserStore?.usuario || ''}
        </p>
      </div>

      <div style="margin-bottom: 20px;">
        <label for="active-sala-select" class="form-label">Sala Seleccionada</label>
        <select id="active-sala-select" bind:value={$selectedSalaStore} class="form-input">
          {#each $userSalasStore as sala}
            <option value={sala.id}>{sala.nombre} ({sala.nombre_comercial || 'C.A.'})</option>
          {/each}
        </select>
      </div>

      <button on:click={handleLogout} type="button" class="btn-flow" style="background: #ef4444; width: 100%; justify-content: center; font-weight: 700;">
        Cerrar Sesión
      </button>
    {:else}
      <form on:submit|preventDefault={handleLogin}>
        <div class="form-group" style="margin-bottom: 16px;">
          <label for="auth-user" class="form-label" style="font-weight: 600;">Usuario</label>
          <input 
            id="auth-user"
            type="text"
            bind:value={usuario}
            placeholder="Usuario"
            class="form-input"
            required
          />
        </div>

        <div class="form-group" style="margin-bottom: 24px;">
          <label for="auth-pass" class="form-label" style="font-weight: 600;">Contraseña</label>
          <input 
            id="auth-pass"
            type="password"
            bind:value={password}
            placeholder="••••••••"
            class="form-input"
            required
          />
        </div>

        <button type="submit" class="btn-flow" style="width: 100%; justify-content: center; font-weight: 700; padding: 12px;" disabled={loading}>
          {loading ? 'Autenticando...' : 'Iniciar Sesión'}
        </button>
      </form>
    {/if}

    <div style="margin-top: 20px; padding-top: 14px; border-top: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 11.5px; color: #64748b;">
      <span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 6px rgba(16, 185, 129, 0.4); display: inline-block;"></span>
      <span>Cloud API: <strong style="color: #334155;">{currentServerHost}</strong></span>
    </div>

    <!-- Sección de Versión Anterior & Soporte WhatsApp -->
    <div style="margin-top: 16px; padding-top: 14px; border-top: 1px dashed #e2e8f0; display: flex; flex-direction: column; gap: 10px; font-size: 12px; text-align: center;">
      <!-- Nota sitio anterior -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; color: #475569; font-size: 12px; line-height: 1.4;">
        <span style="font-weight: 600; color: #1e293b; display: block; margin-bottom: 2px;">
          🌐 Versión anterior aún en línea
        </span>
        Si requieres ingresar a la plataforma previa: 
        <a 
          href="https://before.wisi.space" 
          target="_blank" 
          rel="noopener noreferrer"
          style="color: #2563eb; font-weight: 700; text-decoration: underline; word-break: break-all;"
        >
          before.wisi.space &nearr;
        </a>
      </div>

      <!-- Contacto Soporte WhatsApp -->
      <a 
        href="https://wa.me/584121482348?text=Hola%2C%20necesito%20soporte%20con%20Wisi%20Space" 
        target="_blank" 
        rel="noopener noreferrer"
        class="whatsapp-support-btn"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
        </svg>
        Soporte WhatsApp: +58 412 1482348
      </a>
    </div>
  </div>
</div>

<style>
  .whatsapp-support-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: #25D366;
    color: #ffffff;
    text-decoration: none;
    font-weight: 700;
    font-size: 12.5px;
    padding: 10px 14px;
    border-radius: 8px;
    transition: all 0.2s ease;
    box-shadow: 0 2px 5px rgba(37, 211, 102, 0.25);
  }
  .whatsapp-support-btn:hover {
    background: #22bf5b;
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(37, 211, 102, 0.35);
  }
</style>
