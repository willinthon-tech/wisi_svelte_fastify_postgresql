<script>
  import { createEventDispatcher } from "svelte";
  import {
    currentUserStore,
    userSalasStore,
    selectedSalaStore,
  } from "../controllers/auth.store.js";
  import {
    masterPaginasStore,
    masterModulosStore,
    userModulePermissionsStore
  } from "../controllers/master.store.js";
  import { navigateToRoute } from "../controllers/router.store.js";

  export let activeTab = "dashboard";
  export let isOpen = true;

  const dispatch = createEventDispatcher();

  function selectTab(tab) {
    const cleanRoute = tab.replace(/^\//, '');
    navigateToRoute(cleanRoute);
    dispatch("changeTab", cleanRoute);
    if (window.innerWidth < 1024) {
      dispatch("closeMobile");
    }
  }

  function closeBackdrop() {
    dispatch("closeMobile");
  }

  // Permisología dinámica en tiempo real según el usuario activo y permiso 'VER'
  $: activeUserId = $currentUserStore?.id || 1;
  $: activeUserPermsMap = $userModulePermissionsStore[activeUserId] || {};

  $: filteredNavPages = $masterPaginasStore.map(page => {
    const pageModulos = $masterModulosStore
      .filter(m => m.page_id === page.id)
      .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0) || a.id - b.id);
    const visibleModulos = pageModulos.filter(m => {
      const perms = activeUserPermsMap[m.id] || [];
      return perms.includes('VER');
    });

    // Deduplicar estrictamente por ruta única dentro de la sección
    const seenRoutes = new Set();
    const uniqueModulos = visibleModulos.filter(m => {
      const key = (m.ruta || m.nombre || '').toLowerCase().trim();
      if (seenRoutes.has(key)) return false;
      seenRoutes.add(key);
      return true;
    });

    return { ...page, modulos: uniqueModulos };
  }).filter(page => page.modulos.length > 0);
</script>

<!-- Mobile Backdrop -->
<div
  on:click={closeBackdrop}
  on:keydown={(e) => e.key === "Escape" && closeBackdrop()}
  role="presentation"
  class="sidebar-backdrop {isOpen ? 'active' : ''}"
></div>

<aside class="sidebar {isOpen ? 'open' : 'closed'}">
  <!-- Brand Logo Header -->
  <div class="sidebar-logo">
    <span class="sidebar-logo-text">
      Wisi <span style="background: linear-gradient(135deg, #60a5fa, #c084fc); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Space</span>
    </span>
  </div>

  <!-- Navigation Menu -->
  <nav class="sidebar-nav">
    <div class="sidebar-section-title">MENÚ PRINCIPAL</div>
    <button
      on:click={() => selectTab("dashboard")}
      class="sidebar-link {activeTab === 'dashboard' ? 'active' : ''}"
    >
      <span class="material-icons" style="font-size: 18px;">dvr</span>
      <span>Dashboard</span>
    </button>

    <!-- Dynamic DB Pages & Modules Navigation Filtered by 'VER' Permission -->
    {#each filteredNavPages as page (page.id)}
      <div class="sidebar-section-title">
        {page.nombre}
      </div>
      {#each page.modulos as modulo (modulo.id)}
        {@const routeKey = modulo.ruta.replace(/^\//, '')}
        <button
          on:click={() => selectTab(modulo.ruta)}
          class="sidebar-link {activeTab === routeKey ? 'active' : ''}"
        >
          <span>{modulo.nombre}</span>
        </button>
      {/each}
    {/each}
  </nav>
</aside>
