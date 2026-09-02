<script>
  import { onMount } from "svelte";

  let deferredPrompt = null;
  let showInstallBanner = false;
  let isInstalled = false;

  onMount(() => {
    // Detectar si ya está corriendo en modo standalone (instalada)
    if (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    ) {
      isInstalled = true;
      return;
    }

    // Capturar evento oficial del navegador para instalar la PWA
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      deferredPrompt = e;
      // Comprobar si el usuario no cerró recientemente el banner
      const dismissed = sessionStorage.getItem("wisi_pwa_dismissed");
      if (!dismissed) {
        showInstallBanner = true;
      }
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    window.addEventListener("appinstalled", () => {
      deferredPrompt = null;
      showInstallBanner = false;
      isInstalled = true;
      console.log("¡Wisi Space PWA instalada exitosamente!");
    });

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  });

  async function handleInstallClick() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      showInstallBanner = false;
    }
    deferredPrompt = null;
  }

  function handleDismiss() {
    showInstallBanner = false;
    sessionStorage.setItem("wisi_pwa_dismissed", "true");
  }
</script>

{#if showInstallBanner && !isInstalled}
  <aside 
    class="pwa-install-banner" 
    aria-label="Instalar Wisi Space en tu dispositivo"
    tabindex="-1"
  >
    <div class="pwa-banner-left">
      <img
        src="/pwa-192x192.png"
        alt="Wisi Space Logo"
        class="pwa-banner-icon"
      />
      <div class="pwa-banner-text">
        <span class="pwa-banner-title">Instalar Wisi Space</span>
        <span class="pwa-banner-sub">Acceso rápido a pantalla completa como App nativa</span>
      </div>
    </div>
    <div class="pwa-banner-actions">
      <button
        type="button"
        class="btn-pwa-install"
        on:click={handleInstallClick}
      >
        <span class="material-icons" style="font-size: 16px;">get_app</span>
        Instalar
      </button>
      <button
        type="button"
        class="btn-pwa-close"
        on:click={handleDismiss}
        title="Cerrar aviso"
        aria-label="Cerrar aviso"
      >
        ✕
      </button>
    </div>
  </aside>
{/if}

<style>
  .pwa-install-banner {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 99999;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    background: #0f172a;
    border: 1px solid rgba(56, 189, 248, 0.4);
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.45), 0 0 20px rgba(56, 189, 248, 0.2);
    border-radius: 16px;
    padding: 12px 18px;
    max-width: 420px;
    width: calc(100% - 40px);
    backdrop-filter: blur(12px);
    animation: pwaSlideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes pwaSlideUp {
    from {
      opacity: 0;
      transform: translateY(24px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .pwa-banner-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .pwa-banner-icon {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    object-fit: cover;
    flex-shrink: 0;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
  }

  .pwa-banner-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .pwa-banner-title {
    font-size: 14px;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: -0.2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pwa-banner-sub {
    font-size: 11px;
    color: #94a3b8;
    line-height: 1.25;
    margin-top: 2px;
  }

  .pwa-banner-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .btn-pwa-install {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: linear-gradient(135deg, #0284c7, #0369a1);
    color: #ffffff;
    font-size: 12.5px;
    font-weight: 700;
    border: none;
    border-radius: 10px;
    padding: 8px 14px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35);
    transition: all 0.2s ease;
  }

  .btn-pwa-install:hover {
    background: linear-gradient(135deg, #0369a1, #075985);
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(2, 132, 199, 0.45);
  }

  .btn-pwa-close {
    background: transparent;
    color: #64748b;
    border: none;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.15s ease;
  }

  .btn-pwa-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
  }

  @media (max-width: 640px) {
    .pwa-install-banner {
      bottom: 12px;
      right: 12px;
      left: 12px;
      width: auto;
      max-width: none;
      padding: 10px 14px;
    }
    .pwa-banner-icon {
      width: 38px;
      height: 38px;
    }
    .pwa-banner-title {
      font-size: 13px;
    }
    .pwa-banner-sub {
      font-size: 10px;
    }
    .btn-pwa-install {
      padding: 6px 10px;
      font-size: 11.5px;
    }
  }
</style>
