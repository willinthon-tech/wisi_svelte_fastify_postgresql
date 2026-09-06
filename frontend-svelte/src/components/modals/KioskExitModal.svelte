<script>
  import { isKioskPasswordModalOpenStore, exitKioskMode } from '../../controllers/kiosk.store.js';
  import { currentUserStore } from '../../controllers/auth.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { toBackendUrl } from '../../config/api.config.js';

  let password = '';
  let errorMsg = '';
  let isSubmitting = false;
  let showPassword = false;

  function closeModal() {
    isKioskPasswordModalOpenStore.set(false);
    password = '';
    errorMsg = '';
    isSubmitting = false;
  }

  async function handleConfirmExit() {
    if (!password.trim()) {
      errorMsg = 'Por favor ingresa tu contraseña';
      return;
    }

    isSubmitting = true;
    errorMsg = '';

    try {
      const username = $currentUserStore?.usuario || '';
      const response = await fetch(toBackendUrl('/api/auth/verify-password'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          usuario: username,
          password: password.trim()
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        exitKioskMode();
        closeModal();
        triggerToast('🔓 Modo Kiosco desactivado con éxito', 'info');
      } else {
        errorMsg = data.error || 'Contraseña incorrecta';
      }
    } catch (e) {
      errorMsg = 'Error al conectar con el servidor';
    } finally {
      isSubmitting = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') {
      handleConfirmExit();
    } else if (e.key === 'Escape') {
      closeModal();
    }
  }
</script>

{#if $isKioskPasswordModalOpenStore}
  <div 
    class="kiosk-modal-backdrop" 
    on:click|self={closeModal}
    on:keydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div class="kiosk-modal-card">
      <div class="kiosk-modal-header">
        <div class="kiosk-modal-icon-wrap">
          <span class="material-icons" style="font-size: 26px; color: #dc2626;">lock</span>
        </div>
        <div>
          <h3 class="kiosk-modal-title">Salir del Modo Kiosco</h3>
          <p class="kiosk-modal-subtitle">
            Ingresa la contraseña del usuario actual (<strong>{$currentUserStore?.nombre_apellido || $currentUserStore?.usuario || 'usuario'}</strong>) para desbloquear y salir:
          </p>
        </div>
      </div>

      <div class="kiosk-modal-body">
        {#if errorMsg}
          <div class="kiosk-modal-error">
            <span class="material-icons" style="font-size: 16px;">error_outline</span>
            <span>{errorMsg}</span>
          </div>
        {/if}

        <div class="kiosk-input-group">
          <label for="kiosk-pwd-input">Contraseña de acceso:</label>
          <div class="kiosk-input-wrapper">
            <span class="material-icons input-icon">key</span>
            <input
              id="kiosk-pwd-input"
              type={showPassword ? 'text' : 'password'}
              bind:value={password}
              placeholder="Ingresa tu contraseña"
              disabled={isSubmitting}
              autofocus
            />
            <button
              type="button"
              class="btn-toggle-eye"
              on:click={() => (showPassword = !showPassword)}
              title={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
            >
              <span class="material-icons" style="font-size: 18px;">
                {showPassword ? 'visibility_off' : 'visibility'}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div class="kiosk-modal-footer">
        <button 
          type="button" 
          class="btn-cancel" 
          on:click={closeModal}
          disabled={isSubmitting}
        >
          Cancelar
        </button>
        <button 
          type="button" 
          class="btn-unlock" 
          on:click={handleConfirmExit}
          disabled={isSubmitting || !password.trim()}
        >
          {#if isSubmitting}
            <span class="material-icons spinner" style="font-size: 18px;">sync</span>
            <span>Verificando...</span>
          {:else}
            <span class="material-icons" style="font-size: 18px;">lock_open</span>
            <span>Desactivar Kiosco</span>
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .kiosk-modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(15, 23, 42, 0.7);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999999;
    padding: 16px;
    box-sizing: border-box;
  }

  .kiosk-modal-card {
    background: #ffffff;
    border-radius: 16px;
    width: 100%;
    max-width: 440px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.25), 0 10px 10px -5px rgba(0, 0, 0, 0.1);
    overflow: hidden;
    animation: modalIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    border: 1px solid #e2e8f0;
  }

  @keyframes modalIn {
    from {
      opacity: 0;
      transform: scale(0.95) translateY(10px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .kiosk-modal-header {
    padding: 22px 24px 16px;
    display: flex;
    align-items: flex-start;
    gap: 16px;
    border-bottom: 1px solid #f1f5f9;
  }

  .kiosk-modal-icon-wrap {
    width: 46px;
    height: 46px;
    border-radius: 12px;
    background: #fee2e2;
    border: 1px solid #fecaca;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .kiosk-modal-title {
    margin: 0;
    font-size: 17px;
    font-weight: 800;
    color: #0f172a;
    line-height: 1.2;
  }

  .kiosk-modal-subtitle {
    margin: 6px 0 0;
    font-size: 13px;
    color: #64748b;
    line-height: 1.4;
  }

  .kiosk-modal-body {
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .kiosk-modal-error {
    background: #fef2f2;
    border: 1px solid #fca5a5;
    color: #b91c1c;
    padding: 9px 12px;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .kiosk-input-group label {
    display: block;
    font-size: 12px;
    font-weight: 700;
    color: #334155;
    margin-bottom: 6px;
  }

  .kiosk-input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .input-icon {
    position: absolute;
    left: 12px;
    color: #94a3b8;
    font-size: 18px;
    pointer-events: none;
  }

  .kiosk-input-wrapper input {
    width: 100%;
    padding: 10px 40px 10px 38px;
    border-radius: 9px;
    border: 1.5px solid #cbd5e1;
    font-size: 14px;
    color: #0f172a;
    outline: none;
    transition: all 0.15s ease;
    box-sizing: border-box;
  }

  .kiosk-input-wrapper input:focus {
    border-color: #dc2626;
    box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.12);
  }

  .btn-toggle-eye {
    position: absolute;
    right: 8px;
    background: none;
    border: none;
    color: #64748b;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .btn-toggle-eye:hover {
    color: #0f172a;
  }

  .kiosk-modal-footer {
    padding: 14px 24px 18px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 10px;
  }

  .btn-cancel {
    padding: 9px 18px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    background: #ffffff;
    color: #475569;
    border: 1px solid #cbd5e1;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-cancel:hover:not(:disabled) {
    background: #f1f5f9;
  }

  .btn-unlock {
    padding: 9px 18px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    background: #dc2626;
    color: #ffffff;
    border: 1px solid #dc2626;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 2px 6px rgba(220, 38, 38, 0.25);
    transition: all 0.15s ease;
  }

  .btn-unlock:hover:not(:disabled) {
    background: #b91c1c;
  }

  .btn-unlock:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .spinner {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
