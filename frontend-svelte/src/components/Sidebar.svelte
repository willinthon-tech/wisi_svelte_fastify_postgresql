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
  $: activeUserId = $currentUserStore?.uuid || $currentUserStore?.id || null;
  $: activeUserPermsMap = (activeUserId && $userModulePermissionsStore)
    ? ($userModulePermissionsStore[activeUserId] || $userModulePermissionsStore[String(activeUserId)] || ($currentUserStore?.id ? $userModulePermissionsStore[$currentUserStore.id] : null) || {})
    : {};

  $: filteredNavPages = (() => {
    // Agrupar páginas por nombre normalizado para consolidar secciones duplicadas (ej: CONF.M: CECOM)
    const pageMap = new Map();
    for (const page of $masterPaginasStore) {
      const normName = (page.nombre || '').trim().toUpperCase();
      const pId = String(page.uuid || page.id);
      if (!pageMap.has(normName)) {
        pageMap.set(normName, {
          id: pId,
          uuid: page.uuid || page.id,
          nombre: page.nombre,
          pageIds: [pId, String(page.id || '')].filter(Boolean)
        });
      } else {
        pageMap.get(normName).pageIds.push(pId);
        if (page.id) pageMap.get(normName).pageIds.push(String(page.id));
      }
    }

    const pages = [];
    for (const group of pageMap.values()) {
      const pageModulos = $masterModulosStore
        .filter(m => group.pageIds.includes(String(m.page_uuid || m.page_id)))
        .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0) || String(a.uuid || a.id || '').localeCompare(String(b.uuid || b.id || '')));

      const visibleModulos = pageModulos.filter(m => {
        const mKey = m.uuid || m.id;
        const perms = activeUserPermsMap[mKey] || (m.id ? activeUserPermsMap[m.id] : null) || [];
        return perms.includes('VER');
      });

      // Deduplicar estrictamente por ruta única dentro de la sección
      const seenRoutes = new Set();
      const uniqueModulos = [];
      for (const m of visibleModulos) {
        const cleanRoute = (m.ruta || '').trim();
        if (cleanRoute && !seenRoutes.has(cleanRoute)) {
          seenRoutes.add(cleanRoute);
          uniqueModulos.push(m);
        }
      }

      if (uniqueModulos.length > 0) {
        pages.push({
          id: group.id,
          uuid: group.uuid,
          nombre: group.nombre,
          modulos: uniqueModulos
        });
      }
    }

    return pages;
  })();
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
    {#each filteredNavPages as page (page.nombre)}
      {@const isConfM = String(page.nombre || '').toUpperCase().includes('CONF.M:') || String(page.nombre || '').toUpperCase().includes('CONF.M')}
      <div 
        class="sidebar-section-title {isConfM ? 'title-conf-m' : ''}"
        style="{isConfM ? 'color: #ef4444 !important; font-weight: 900;' : ''}">
        {page.nombre}
      </div>
      {#each page.modulos as modulo (modulo.ruta)}
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
