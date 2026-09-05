<script>
  import { onMount } from 'svelte';
  import { currentUserStore, userSalasStore, navMenuStore } from '../controllers/auth.store.js';
  import { 
    masterSalasStore, 
    masterDepartamentosStore, 
    masterDispositivosStore,
    loadMasterStoresFromBackend 
  } from '../controllers/master.store.js';
  import { navigateToRoute } from '../controllers/router.store.js';
  import { triggerToast } from '../controllers/ui.store.js';

  export let healthStatus = {};

  let activeTab = 'info';
  let isDownloading = false;
  let showDownloadModal = false;

  onMount(async () => {
    try {
      await loadMasterStoresFromBackend();
    } catch (e) {
      console.warn('Error loading master stores in profile:', e);
    }
  });

  // Current user helper
  $: user = $currentUserStore || {};
  $: userId = user?.id || null;

  // Extract assigned salas
  $: assignedSalas = (function () {
    // 1. Direct from user.salas (from backend session)
    if (user && Array.isArray(user.salas) && user.salas.length > 0) {
      return user.salas;
    }
    // 2. Direct from auth userSalasStore
    if ($userSalasStore && Array.isArray($userSalasStore) && $userSalasStore.length > 0) {
      return $userSalasStore;
    }
    return [];
  })();

  $: assignedSalaIds = assignedSalas.map((s) => (typeof s === 'object' ? Number(s.id) : Number(s))).filter(Boolean);

  // Match full details of assigned salas against masterSalasStore
  $: detailedSalas = (function () {
    const allSalas = $masterSalasStore || [];
    if (assignedSalaIds.length === 0) return assignedSalas;
    return assignedSalaIds.map((id) => {
      const found = allSalas.find((s) => Number(s.id) === id);
      const fallback = assignedSalas.find((s) => typeof s === 'object' && Number(s.id) === id);
      return found || fallback || { id, nombre: `Sala #${id}` };
    });
  })();

  // Filter departamentos to assigned salas
  $: assignedDepartamentos = (function () {
    const allDeps = $masterDepartamentosStore || [];
    if (assignedSalaIds.length === 0) return [];
    return allDeps.filter((d) => assignedSalaIds.includes(Number(d.sala_id)));
  })();

  // Filter dispositivos biometricos to assigned salas
  $: assignedDispositivos = (function () {
    const allDevs = $masterDispositivosStore || [];
    if (assignedSalaIds.length === 0) return [];
    return allDevs.filter((dev) => assignedSalaIds.includes(Number(dev.sala_id)));
  })();

  // Modules and permissions from navMenuStore
  $: userPages = $navMenuStore || [];
  $: totalModulosCount = userPages.reduce((acc, p) => acc + (p.modulos?.length || 0), 0);

  // User initials for avatar
  $: userInitials = (function () {
    const name = (user.nombre_apellido || user.usuario || 'U').trim();
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  })();

  function handleDownloadFicha() {
    isDownloading = true;
    try {
      const dataToExport = {
        titulo: 'Ficha Técnica de Usuario y Accesos - Sistema WISI Space',
        fecha_emision: new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' }),
        usuario: {
          id: user.id || 'N/A',
          nombre_apellido: user.nombre_apellido || 'N/A',
          usuario: user.usuario || 'N/A',
          rol: user.id === 1 ? 'Superadministrador Global' : 'Operador Autorizado de Sala',
          estatus: 'Activo'
        },
        salas_asignadas: detailedSalas.map((s) => ({
          id: s.id,
          nombre: s.nombre,
          nombre_comercial: s.nombre_comercial || 'N/A',
          rif: s.rif || 'N/A',
          ubicacion: s.ubicacion || 'N/A',
          telefono: s.telefono || 'N/A',
          correo: s.correo || 'N/A'
        })),
        departamentos_autorizados: assignedDepartamentos.map((d) => ({
          id: d.id,
          nombre: d.nombre,
          sala_id: d.sala_id
        })),
        dispositivos_biometricos: assignedDispositivos.map((dev) => ({
          id: dev.id,
          nombre: dev.nombre,
          sala_id: dev.sala_id,
          ip_remota: dev.ip_remota || 'N/A',
          ip_local: dev.ip_local || 'N/A'
        })),
        modulos_y_permisos: userPages.map((p) => ({
          categoria: p.nombre,
          modulos: (p.modulos || []).map((m) => ({
            id: m.id,
            nombre: m.nombre,
            ruta: m.ruta,
            permisos: m.permisos || []
          }))
        }))
      };

      const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ficha_usuario_${user.usuario || 'perfil'}_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      triggerToast('Ficha técnica de usuario descargada exitosamente', 'success');
    } catch (e) {
      console.error(e);
      triggerToast('Error al generar la descarga', 'error');
    } finally {
      isDownloading = false;
    }
  }

  function goToAdminPanel() {
    navigateToRoute('willinthontech');
  }
</script>

<div style="display: flex; flex-direction: column; gap: 20px; max-width: 1400px; margin: 0 auto; width: 100%;">
  <!-- Cover Banner & Profile Header -->
  <div class="flow-card" style="padding: 0; overflow: hidden; position: relative; border-radius: 14px; box-shadow: 0 4px 20px rgba(15, 23, 42, 0.08);">
    <!-- Vibrant Deep Slate & Blue Gradient Banner -->
    <div style="height: 140px; background: linear-gradient(135deg, #0f172a 0%, #1e293b 40%, #1d4ed8 100%); position: relative;">
    </div>
    
    <div style="padding: 16px 24px 20px; display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px; background: #ffffff;">
      <!-- Avatar with WISI Logo & User Title -->
      <div style="display: flex; align-items: flex-end; gap: 18px; margin-top: -55px;">
        <div style="width: 90px; height: 90px; border-radius: 50%; background: #ffffff; display: flex; align-items: center; justify-content: center; border: 4px solid #ffffff; box-shadow: 0 6px 16px rgba(0,0,0,0.18); z-index: 10; padding: 8px; overflow: hidden;">
          <img 
            src="/logo.png" 
            alt="WISI Logo" 
            style="width: 100%; height: 100%; object-fit: contain;" 
            on:error={(e) => { e.currentTarget.src = '/pwa-192x192.png'; }}
          />
        </div>
        <div>
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <h2 style="font-size: 22px; font-weight: 800; color: #0f172a; margin: 0; line-height: 1.2;">
              {user.nombre_apellido || user.usuario || 'Usuario'}
            </h2>
          </div>
          <p style="font-size: 13px; color: #64748b; margin: 4px 0 0; display: flex; align-items: center; gap: 6px;">
            <strong style="color: #059669;">@{user.usuario || 'usuario'}</strong>
            <span>•</span>
            <span>ID: #{user.id || '1'}</span>
          </p>
        </div>
      </div>

      <!-- Exactly the 3 Buttons Requested by User -->
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <!-- 1. Botón Info (Principal y Activo por defecto) -->
        <button 
          type="button"
          on:click={() => (activeTab = 'info')} 
          class="btn-flow-sec {activeTab === 'info' ? 'btn-flow' : ''}"
          style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; font-size: 13px; font-weight: 700; border-radius: 8px; cursor: pointer; transition: all 0.15s ease;"
          title="Ver Información detallada del perfil y accesos">
          <span class="material-icons" style="font-size: 18px;">info</span>
          <span>Información</span>
        </button>

        <!-- 2. Botón de Descarga (Abre modal de descarga Android / Windows) -->
        <button 
          type="button"
          on:click={() => (showDownloadModal = true)} 
          class="btn-flow-sec"
          style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; font-size: 13px; font-weight: 700; border-radius: 8px; cursor: pointer; background: #f8fafc; color: #334155; border: 1px solid #cbd5e1; transition: all 0.15s ease;"
          title="Descargar instalador para Android o Windows">
          <span class="material-icons" style="font-size: 18px; color: #2563eb;">download</span>
          <span>Descarga</span>
        </button>

        <!-- 3. Botón de Administración (Redirige a 'willinthontech') -->
        <button 
          type="button"
          on:click={goToAdminPanel} 
          class="btn-flow"
          style="display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; font-size: 13px; font-weight: 700; border-radius: 8px; cursor: pointer; background: #0f172a; color: #ffffff; border: 1px solid #0f172a; box-shadow: 0 2px 6px rgba(15,23,42,0.2); transition: all 0.15s ease;"
          title="Ir al Panel de Administración Master (willinthontech)">
          <span class="material-icons" style="font-size: 18px; color: #38bdf8;">admin_panel_settings</span>
          <span>Administración</span>
        </button>
      </div>
    </div>
  </div>

  <!-- Quick KPI Counters -->
  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px;">
    <!-- Salas -->
    <div class="flow-card" style="padding: 14px 18px; display: flex; align-items: center; gap: 14px; border-left: 4px solid #2563eb; background: #ffffff;">
      <div style="width: 44px; height: 44px; border-radius: 10px; background: #eff6ff; display: flex; align-items: center; justify-content: center; color: #2563eb; flex-shrink: 0;">
        <span class="material-icons" style="font-size: 24px;">location_city</span>
      </div>
      <div>
        <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Salas Asignadas</div>
        <div style="font-size: 20px; font-weight: 800; color: #0f172a;">{detailedSalas.length}</div>
      </div>
    </div>

    <!-- Departamentos -->
    <div class="flow-card" style="padding: 14px 18px; display: flex; align-items: center; gap: 14px; border-left: 4px solid #10b981; background: #ffffff;">
      <div style="width: 44px; height: 44px; border-radius: 10px; background: #ecfdf5; display: flex; align-items: center; justify-content: center; color: #10b981; flex-shrink: 0;">
        <span class="material-icons" style="font-size: 24px;">business</span>
      </div>
      <div>
        <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Departamentos</div>
        <div style="font-size: 20px; font-weight: 800; color: #0f172a;">{assignedDepartamentos.length}</div>
      </div>
    </div>

    <!-- Dispositivos Biométricos -->
    <div class="flow-card" style="padding: 14px 18px; display: flex; align-items: center; gap: 14px; border-left: 4px solid #f59e0b; background: #ffffff;">
      <div style="width: 44px; height: 44px; border-radius: 10px; background: #fffbeb; display: flex; align-items: center; justify-content: center; color: #f59e0b; flex-shrink: 0;">
        <span class="material-icons" style="font-size: 24px;">fingerprint</span>
      </div>
      <div>
        <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Biométricos en Sala</div>
        <div style="font-size: 20px; font-weight: 800; color: #0f172a;">{assignedDispositivos.length}</div>
      </div>
    </div>

    <!-- Módulos con Acceso -->
    <div class="flow-card" style="padding: 14px 18px; display: flex; align-items: center; gap: 14px; border-left: 4px solid #8b5cf6; background: #ffffff;">
      <div style="width: 44px; height: 44px; border-radius: 10px; background: #f5f3ff; display: flex; align-items: center; justify-content: center; color: #8b5cf6; flex-shrink: 0;">
        <span class="material-icons" style="font-size: 24px;">verified_user</span>
      </div>
      <div>
        <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Módulos Autorizados</div>
        <div style="font-size: 20px; font-weight: 800; color: #0f172a;">{totalModulosCount}</div>
      </div>
    </div>
  </div>

  <!-- 2-Column Main Profile Layout -->
  <div style="display: grid; grid-template-columns: 310px 1fr; gap: 20px; align-items: start;">
    <!-- Left Column: User Account Card & Infrastructure -->
    <div style="display: flex; flex-direction: column; gap: 16px;">
      <!-- Account Info Card -->
      <div class="flow-card" style="padding: 20px; background: #ffffff;">
        <h3 style="font-size: 14px; font-weight: 800; color: #0f172a; margin: 0 0 14px; display: flex; align-items: center; gap: 8px;">
          <span class="material-icons" style="font-size: 18px; color: #2563eb;">badge</span>
          <span>Cuenta de Usuario</span>
        </h3>

        <div style="display: flex; flex-direction: column; gap: 12px; font-size: 12.5px;">
          <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">
            <span style="color: #64748b; font-weight: 600;">ID de Usuario:</span>
            <span style="font-weight: 800; color: #0f172a;">#{user.id || '1'}</span>
          </div>

          <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">
            <span style="color: #64748b; font-weight: 600;">Nombre:</span>
            <span style="font-weight: 700; color: #0f172a; text-align: right;">{user.nombre_apellido || 'N/A'}</span>
          </div>

          <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">
            <span style="color: #64748b; font-weight: 600;">Usuario:</span>
            <span style="font-weight: 700; color: #059669;">@{user.usuario || 'N/A'}</span>
          </div>

          <div style="display: flex; justify-content: space-between; padding-bottom: 4px;">
            <span style="color: #64748b; font-weight: 600;">Estatus:</span>
            <span style="font-weight: 700; color: #10b981; display: inline-flex; align-items: center; gap: 4px;">
              <span style="width: 7px; height: 7px; border-radius: 50%; background: #10b981;"></span>
              <span>Activo</span>
            </span>
          </div>
        </div>
      </div>

      <!-- Infrastructure / Backend Connection Card -->
      <div class="flow-card" style="padding: 20px; background: #ffffff;">
        <h3 style="font-size: 14px; font-weight: 800; color: #0f172a; margin: 0 0 14px; display: flex; align-items: center; gap: 8px;">
          <span class="material-icons" style="font-size: 18px; color: #10b981;">dns</span>
          <span>Infraestructura Conectada</span>
        </h3>

        <div style="display: flex; flex-direction: column; gap: 12px; font-size: 12.5px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="color: #64748b; font-weight: 600;">Base de Datos:</span>
            <span style="background: #ecfdf5; color: #059669; font-weight: 700; padding: 2px 8px; border-radius: 6px; font-size: 11px;">PostgreSQL 16</span>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="color: #64748b; font-weight: 600;">Servidor API:</span>
            <span style="background: #eff6ff; color: #2563eb; font-weight: 700; padding: 2px 8px; border-radius: 6px; font-size: 11px;">Fastify REST</span>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="color: #64748b; font-weight: 600;">WebSockets:</span>
            <span style="background: #f0fdf4; color: #16a34a; font-weight: 700; padding: 2px 8px; border-radius: 6px; font-size: 11px;">🟢 En Tiempo Real</span>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="color: #64748b; font-weight: 600;">Estatus Salud:</span>
            <span style="font-weight: 700; color: #10b981;">{healthStatus.status || 'OK Online'}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Right Column: Assigned Resources Detailed View -->
    <div style="display: flex; flex-direction: column; gap: 18px;">
      
      <!-- Section 1: Salas Asignadas (en Base de Datos) -->
      <div class="flow-card" style="padding: 20px; background: #ffffff;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
          <h3 style="font-size: 15px; font-weight: 800; color: #0f172a; margin: 0; display: flex; align-items: center; gap: 8px;">
            <span class="material-icons" style="font-size: 20px; color: #2563eb;">location_on</span>
            <span>Salas Asignadas ({detailedSalas.length})</span>
          </h3>
          <span style="font-size: 11.5px; color: #64748b; font-weight: 600;">Origen: PostgreSQL `user_salas`</span>
        </div>

        {#if detailedSalas.length === 0}
          <div style="padding: 20px; background: #f8fafc; border-radius: 8px; text-align: center; color: #94a3b8; font-size: 13px;">
            Este usuario no tiene salas asignadas actualmente en la base de datos.
          </div>
        {:else}
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px;">
            {#each detailedSalas as sala}
              <div style="border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; background: #f8fafc; display: flex; flex-direction: column; gap: 8px; transition: all 0.15s ease;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <span style="font-size: 14px; font-weight: 800; color: #0f172a;">{sala.nombre}</span>
                  <span style="background: #2563eb; color: #ffffff; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 800;">
                    ID: #{sala.id}
                  </span>
                </div>

                {#if sala.nombre_comercial}
                  <div style="font-size: 12px; color: #475569; font-weight: 600;">
                    🏢 {sala.nombre_comercial}
                  </div>
                {/if}

                {#if sala.rif}
                  <div style="font-size: 11.5px; color: #64748b;">
                    📋 RIF: <strong style="color: #0f172a;">{sala.rif}</strong>
                  </div>
                {/if}

                {#if sala.ubicacion}
                  <div style="font-size: 11.5px; color: #64748b; display: flex; gap: 4px; line-height: 1.3;">
                    <span>📍</span>
                    <span>{sala.ubicacion}</span>
                  </div>
                {/if}

                {#if sala.telefono || sala.correo}
                  <div style="font-size: 11px; color: #64748b; margin-top: 4px; display: flex; flex-direction: column; gap: 2px;">
                    {#if sala.telefono}<span>📞 {sala.telefono}</span>{/if}
                    {#if sala.correo}<span>✉️ {sala.correo}</span>{/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Section 2: Departamentos Autorizados -->
      <div class="flow-card" style="padding: 20px; background: #ffffff;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
          <h3 style="font-size: 15px; font-weight: 800; color: #0f172a; margin: 0; display: flex; align-items: center; gap: 8px;">
            <span class="material-icons" style="font-size: 20px; color: #10b981;">business</span>
            <span>Departamentos Autorizados ({assignedDepartamentos.length})</span>
          </h3>
          <span style="font-size: 11.5px; color: #64748b; font-weight: 600;">Pertenecientes a sus salas</span>
        </div>

        {#if assignedDepartamentos.length === 0}
          <div style="padding: 16px; background: #f8fafc; border-radius: 8px; text-align: center; color: #94a3b8; font-size: 13px;">
            No se encontraron departamentos registrados en las salas asignadas.
          </div>
        {:else}
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            {#each assignedDepartamentos as dep}
              <div style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; font-weight: 700; color: #1e293b;">
                <span style="color: #10b981;">🏢</span>
                <span>{dep.nombre}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Section 3: Dispositivos Biométricos en Sala -->
      <div class="flow-card" style="padding: 20px; background: #ffffff;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
          <h3 style="font-size: 15px; font-weight: 800; color: #0f172a; margin: 0; display: flex; align-items: center; gap: 8px;">
            <span class="material-icons" style="font-size: 20px; color: #f59e0b;">fingerprint</span>
            <span>Dispositivos Biométricos Autorizados ({assignedDispositivos.length})</span>
          </h3>
          <span style="font-size: 11.5px; color: #64748b; font-weight: 600;">ZKTeco ADMS & Hikvision</span>
        </div>

        {#if assignedDispositivos.length === 0}
          <div style="padding: 16px; background: #f8fafc; border-radius: 8px; text-align: center; color: #94a3b8; font-size: 13px;">
            No hay relojes biométricos configurados en las salas asignadas.
          </div>
        {:else}
          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 12.5px; text-align: left;">
              <thead>
                <tr style="border-bottom: 2px solid #e2e8f0; color: #475569;">
                  <th style="padding: 8px 12px;">Equipo / Reloj</th>
                  <th style="padding: 8px 12px;">Sala</th>
                  <th style="padding: 8px 12px;">IP Remota / Local</th>
                  <th style="padding: 8px 12px; text-align: center;">Estatus</th>
                </tr>
              </thead>
              <tbody>
                {#each assignedDispositivos as dev}
                  <tr style="border-bottom: 1px solid #f1f5f9;">
                    <td style="padding: 10px 12px; font-weight: 700; color: #0f172a;">
                      📟 {dev.nombre}
                    </td>
                    <td style="padding: 10px 12px; color: #475569;">
                      {detailedSalas.find(s => Number(s.id) === Number(dev.sala_id))?.nombre || `Sala #${dev.sala_id}`}
                    </td>
                    <td style="padding: 10px 12px; font-family: monospace; font-size: 12px; color: #2563eb;">
                      {dev.ip_remota || dev.ip_local || 'Automático (Push)'}
                    </td>
                    <td style="padding: 10px 12px; text-align: center;">
                      <span style="background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700;">
                        🟢 Activo
                      </span>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>

      <!-- Section 4: Módulos del Sistema y Permisos de Acceso -->
      <div class="flow-card" style="padding: 20px; background: #ffffff;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
          <h3 style="font-size: 15px; font-weight: 800; color: #0f172a; margin: 0; display: flex; align-items: center; gap: 8px;">
            <span class="material-icons" style="font-size: 20px; color: #8b5cf6;">verified_user</span>
            <span>Módulos y Permisos de Acceso ({totalModulosCount})</span>
          </h3>
          <span style="font-size: 11.5px; color: #64748b; font-weight: 600;">Control por Módulo</span>
        </div>

        {#if userPages.length === 0}
          <div style="padding: 16px; background: #f8fafc; border-radius: 8px; text-align: center; color: #94a3b8; font-size: 13px;">
            No hay permisos configurados para este usuario.
          </div>
        {:else}
          <div style="display: flex; flex-direction: column; gap: 16px;">
            {#each userPages as page}
              <div style="border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; background: #f8fafc;">
                <div style="font-size: 13px; font-weight: 800; color: #1e293b; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
                  <span style="color: #8b5cf6;">📂</span>
                  <span>{page.nombre}</span>
                  <span style="font-size: 11px; color: #94a3b8; font-weight: 600;">({(page.modulos || []).length} módulos)</span>
                </div>

                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px;">
                  {#each page.modulos || [] as mod}
                    <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;">
                      <div style="display: flex; align-items: center; justify-content: space-between;">
                        <span style="font-size: 13px; font-weight: 700; color: #0f172a;">{mod.nombre}</span>
                        <button 
                          type="button" 
                          on:click={() => navigateToRoute(mod.ruta ? mod.ruta.replace(/^\//, '') : '')}
                          style="background: none; border: none; font-size: 11px; color: #2563eb; font-weight: 700; cursor: pointer; text-decoration: underline; padding: 0;">
                          Ir »
                        </button>
                      </div>

                      <div style="font-size: 11px; color: #64748b; font-family: monospace;">
                        {mod.ruta || 'N/A'}
                      </div>

                      <!-- Permisos Badges -->
                      <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;">
                        {#each (mod.permisos || []) as perm}
                          <span style="
                            padding: 1px 6px; 
                            border-radius: 4px; 
                            font-size: 9.5px; 
                            font-weight: 800; 
                            letter-spacing: 0.3px;
                            {perm === 'VER' ? 'background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe;' : ''}
                            {perm === 'AGREGAR' ? 'background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0;' : ''}
                            {perm === 'EDITAR' ? 'background: #fffbeb; color: #d97706; border: 1px solid #fde68a;' : ''}
                            {perm === 'BORRAR' ? 'background: #fef2f2; color: #dc2626; border: 1px solid #fecaca;' : ''}
                            {perm === 'REPORTE' ? 'background: #faf5ff; color: #7c3aed; border: 1px solid #e9d5ff;' : ''}
                          ">
                            {perm}
                          </span>
                        {/each}
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

    </div>
  </div>
</div>

<!-- Modal de Descargas: Android / Windows -->
{#if showDownloadModal}
  <div 
    class="modal-backdrop"
    on:click={() => (showDownloadModal = false)}
    role="presentation"
    style="position: fixed; inset: 0; background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(5px); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 20px;"
  >
    <div 
      class="modal-card"
      on:click|stopPropagation
      role="dialog"
      aria-modal="true"
      style="background: #ffffff; width: 100%; max-width: 520px; border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35); overflow: hidden; display: flex; flex-direction: column; border: 1px solid rgba(226, 232, 240, 0.8);"
    >
      <!-- Modal Header -->
      <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #ffffff; padding: 20px 24px; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 14px;">
          <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15); display: flex; align-items: center; justify-content: center;">
            <span class="material-icons" style="font-size: 24px; color: #38bdf8;">cloud_download</span>
          </div>
          <div>
            <h3 style="margin: 0; font-size: 16px; font-weight: 800; color: #ffffff; line-height: 1.2;">Centro de Descargas WISI Space</h3>
            <p style="margin: 3px 0 0; font-size: 12px; color: #94a3b8;">Instaladores oficiales de la aplicación</p>
          </div>
        </div>
        <button 
          type="button" 
          on:click={() => (showDownloadModal = false)}
          style="background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 6px; border-radius: 8px; display: flex; align-items: center; justify-content: center;"
          title="Cerrar modal">
          <span class="material-icons" style="font-size: 20px;">close</span>
        </button>
      </div>

      <!-- Modal Body -->
      <div style="padding: 24px; display: flex; flex-direction: column; gap: 16px;">
        <!-- Android Option -->
        <div style="border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 16px; display: flex; align-items: center; justify-content: space-between; gap: 14px; background: #f8fafc;">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div style="width: 48px; height: 48px; border-radius: 12px; background: #ecfdf5; border: 1px solid #a7f3d0; display: flex; align-items: center; justify-content: center; color: #059669; flex-shrink: 0;">
              <span class="material-icons" style="font-size: 28px;">android</span>
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 800; font-size: 15px; color: #0f172a;">Versión Android</span>
                <span style="font-size: 10px; font-weight: 700; background: #dcfce7; color: #166534; padding: 2px 7px; border-radius: 6px;">APK • 6.5 MB</span>
              </div>
              <p style="margin: 4px 0 0; font-size: 12px; color: #64748b; line-height: 1.3;">Para smartphones y tablets Android (v7.0+)</p>
            </div>
          </div>
          <a 
            href="/downloads/app-wisi.apk" 
            download="app-wisi.apk"
            on:click={() => triggerToast('Iniciando descarga de APK para Android...', 'info')}
            style="display: inline-flex; align-items: center; gap: 6px; background: #10b981; color: #ffffff; padding: 9px 15px; border-radius: 8px; font-weight: 700; font-size: 12.5px; text-decoration: none; box-shadow: 0 2px 6px rgba(16,185,129,0.3); transition: all 0.15s ease; white-space: nowrap;">
            <span class="material-icons" style="font-size: 18px;">download</span>
            <span>Descargar</span>
          </a>
        </div>

        <!-- Windows Option -->
        <div style="border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 16px; display: flex; align-items: center; justify-content: space-between; gap: 14px; background: #f8fafc;">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div style="width: 48px; height: 48px; border-radius: 12px; background: #eff6ff; border: 1px solid #bfdbfe; display: flex; align-items: center; justify-content: center; color: #2563eb; flex-shrink: 0;">
              <span class="material-icons" style="font-size: 28px;">desktop_windows</span>
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 800; font-size: 15px; color: #0f172a;">Versión Windows</span>
                <span style="font-size: 10px; font-weight: 700; background: #dbeafe; color: #1e40af; padding: 2px 7px; border-radius: 6px;">EXE • 2.3 MB</span>
              </div>
              <p style="margin: 4px 0 0; font-size: 12px; color: #64748b; line-height: 1.3;">Para computadoras Windows 10 y 11 (64-bit)</p>
            </div>
          </div>
          <a 
            href="/downloads/app-wisi.exe" 
            download="app-wisi.exe"
            on:click={() => triggerToast('Iniciando descarga de instalador para Windows...', 'info')}
            style="display: inline-flex; align-items: center; gap: 6px; background: #2563eb; color: #ffffff; padding: 9px 15px; border-radius: 8px; font-weight: 700; font-size: 12.5px; text-decoration: none; box-shadow: 0 2px 6px rgba(37,99,235,0.3); transition: all 0.15s ease; white-space: nowrap;">
            <span class="material-icons" style="font-size: 18px;">download</span>
            <span>Descargar</span>
          </a>
        </div>
      </div>

      <!-- Modal Footer -->
      <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 12px 24px; display: flex; justify-content: flex-end; align-items: center;">
        <button 
          type="button" 
          on:click={() => (showDownloadModal = false)}
          style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; padding: 8px 18px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer;">
          Cerrar
        </button>
      </div>
    </div>
  </div>
{/if}
