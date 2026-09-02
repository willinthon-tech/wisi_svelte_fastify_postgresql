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

  let usuario = 'wilinthon';
  let password = '';
  let loading = false;

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
          @{$currentUserStore?.usuario || 'wilinthon'}
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
            placeholder="wilinthon"
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
  </div>
</div>
