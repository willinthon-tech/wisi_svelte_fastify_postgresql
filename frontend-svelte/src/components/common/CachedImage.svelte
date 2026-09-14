<script>
  import { onMount, onDestroy } from 'svelte';

  export let src = '';
  export let alt = '';
  export let className = '';
  export let style = '';
  export let isImmutable = false; // Si es true (ej. attlogs), nunca expira de la caché
  export let version = '';        // Si cambia la versión (ej. updated_at), invalida la caché
  export let lazy = true;

  let displaySrc = '';
  let isLoading = true;
  let hasError = false;
  let currentObjectUrl = null;

  const CACHE_NAME = 'wisi-media-cache-v1';

  function cleanupObjectUrl() {
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
  }

  async function loadImage(targetSrc) {
    if (!targetSrc) {
      isLoading = false;
      hasError = true;
      return;
    }

    isLoading = true;
    hasError = false;

    // Si el navegador no soporta Cache Storage API, carga directo
    if (typeof window === 'undefined' || !('caches' in window)) {
      displaySrc = targetSrc;
      isLoading = false;
      return;
    }

    try {
      const cache = await caches.open(CACHE_NAME);
      
      // Armar clave de caché
      let cacheKey = targetSrc;
      if (isImmutable) {
        // En logs inmutables ignoramos query params variables
        try {
          const urlObj = new URL(targetSrc, window.location.origin);
          cacheKey = `${urlObj.pathname}?immutable=1`;
        } catch (e) {
          cacheKey = `${targetSrc}_immutable`;
        }
      } else if (version) {
        cacheKey = `${targetSrc}_v_${version}`;
      }

      // 1. Buscar en caché local (0ms)
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse && cachedResponse.ok) {
        const blob = await cachedResponse.blob();
        if (blob.size > 0) {
          cleanupObjectUrl();
          currentObjectUrl = URL.createObjectURL(blob);
          displaySrc = currentObjectUrl;
          isLoading = false;
          return;
        }
      }

      // 2. Si no está en caché, descargar de red
      const response = await fetch(targetSrc, {
        headers: {
          'Accept': 'image/webp,image/*,*/*'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      const responseClone = response.clone();
      const blob = await response.blob();

      if (blob.size > 0) {
        cleanupObjectUrl();
        currentObjectUrl = URL.createObjectURL(blob);
        displaySrc = currentObjectUrl;
        isLoading = false;

        // Guardar en la caché local en segundo plano
        try {
          await cache.put(cacheKey, responseClone);
        } catch (cacheErr) {
          // Ignorar cuota o error de guardado en caché
        }
      } else {
        hasError = true;
        isLoading = false;
      }
    } catch (err) {
      // Fallback si falla red y no había caché
      displaySrc = targetSrc;
      isLoading = false;
    }
  }

  $: if (src) {
    loadImage(src);
  }

  function handleImgError() {
    hasError = true;
    isLoading = false;
  }

  onDestroy(() => {
    cleanupObjectUrl();
  });
</script>

{#if hasError}
  <div class="cached-image-fallback {className}" {style}>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="fallback-icon">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  </div>
{:else}
  <img
    src={displaySrc || src}
    {alt}
    class="{className} {isLoading ? 'is-loading' : 'is-loaded'}"
    {style}
    loading={lazy ? 'lazy' : 'eager'}
    on:error={handleImgError}
  />
{/if}

<style>
  img {
    transition: opacity 0.2s ease-in-out;
  }
  img.is-loading {
    opacity: 0.6;
    filter: blur(2px);
  }
  img.is-loaded {
    opacity: 1;
    filter: none;
  }
  .cached-image-fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #f1f5f9;
    color: #94a3b8;
    border-radius: inherit;
    overflow: hidden;
  }
  :global(.dark) .cached-image-fallback {
    background: #1e293b;
    color: #64748b;
  }
  .fallback-icon {
    width: 55%;
    height: 55%;
  }
</style>
