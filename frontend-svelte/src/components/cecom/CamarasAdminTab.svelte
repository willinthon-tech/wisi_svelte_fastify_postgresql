<script>
  import { onMount } from "svelte";
  import { triggerToast } from "../../controllers/ui.store.js";
  import {
    getDispositivosCamaras,
    createDispositivoCamara,
    updateDispositivoCamara,
    deleteDispositivoCamara,
    syncCanalesDispositivo,
    getCamaras,
    localScanGrabadorChannels,
    diagnosticarPuertosGrabadorIsapi
  } from "../../services/cecomVideo.service.js";
  import { isTauriWindows } from "../../services/tauriIsapi.service.js";

  export let salas = [];

  let dispositivos = [];
  let isLoading = false;
  let selectedSalaUuid = "all";
  let searchQuery = "";

  // Modal Crear / Editar Dispositivo
  let isModalOpen = false;
  let isEditing = false;
  let currentUuid = null;
  let isSubmitting = false;

  // Diagnóstico ISAPI de puertos físicos
  let isVerifyingPorts = false;
  let verifiedPortsResult = null;

  let form = {
    nombre: "",
    sala_uuid: "",
    tipo: "NVR", // NVR, DVR, CAMARA_IP
    ip_local: "",
    usuario: "admin",
    clave: "",
    puerto_sdk: 8000,
    puerto_http: 80,
    puerto_rtsp: 554,
    canales_totales: 16
  };

  // Despliegue de canales por grabador
  let expandedDeviceUuid = null;
  let deviceChannelsMap = {};
  let loadingChannels = false;

  // Estado escaneo local ISAPI
  let scanningDeviceUuid = null;

  onMount(async () => {
    await loadDispositivos();
  });

  async function loadDispositivos() {
    isLoading = true;
    try {
      const params = {};
      if (selectedSalaUuid && selectedSalaUuid !== "all") {
        params.sala_uuid = selectedSalaUuid;
      }
      if (searchQuery.trim()) {
        params.search = searchQuery.trim();
      }
      const res = await getDispositivosCamaras(params);
      if (res && res.success) {
        dispositivos = res.data || [];
      }
    } catch (err) {
      console.error("Error cargando dispositivos de cámaras:", err);
      triggerToast(`Error al cargar grabadores: ${err.message}`, "error");
    } finally {
      isLoading = false;
    }
  }

  function openCreateModal() {
    isEditing = false;
    currentUuid = null;
    verifiedPortsResult = null;
    isVerifyingPorts = false;
    form = {
      nombre: "",
      sala_uuid: salas.length > 0 ? (salas[0].uuid || salas[0].id) : "",
      tipo: "NVR",
      ip_local: "",
      usuario: "admin",
      clave: "",
      puerto_sdk: 8000,
      puerto_http: 80,
      puerto_rtsp: 554,
      canales_totales: 16
    };
    isModalOpen = true;
  }

  function openEditModal(dev) {
    isEditing = true;
    currentUuid = dev.uuid || dev.id;
    verifiedPortsResult = null;
    isVerifyingPorts = false;
    form = {
      nombre: dev.nombre || "",
      sala_uuid: dev.sala_uuid || "",
      tipo: dev.tipo || "NVR",
      ip_local: dev.ip_local || "",
      usuario: dev.usuario || "admin",
      clave: dev.clave || "",
      puerto_sdk: dev.puerto_sdk || 8000,
      puerto_http: dev.puerto_http || 80,
      puerto_rtsp: dev.puerto_rtsp || 554,
      canales_totales: dev.canales_totales || (dev.tipo === "CAMARA_IP" ? 1 : 16)
    };
    isModalOpen = true;
  }

  function closeModal() {
    isModalOpen = false;
    isEditing = false;
    currentUuid = null;
    verifiedPortsResult = null;
    isVerifyingPorts = false;
  }

  async function verificarPuertosFormulario() {
    if (!form.ip_local.trim()) {
      triggerToast("Ingrese la IP local del dispositivo para verificar sus puertos", "warning");
      return;
    }
    if (!isTauriWindows()) {
      triggerToast("La verificación directa ISAPI solo funciona desde la app de Windows en la sala", "info");
      return;
    }

    isVerifyingPorts = true;
    try {
      triggerToast(`🔍 Conectando por ISAPI a ${form.ip_local} para verificar canales y video...`, "info");
      const diag = await diagnosticarPuertosGrabadorIsapi(form.ip_local, form.usuario, form.clave);
      if (diag && diag.total_puertos > 0) {
        verifiedPortsResult = diag;
        form.canales_totales = diag.total_puertos;
        triggerToast(`✅ ${diag.puertos_activos} canales con señal activa detectados (${diag.puertos_deshabilitados} sin señal/desconectados)`, "success");
      } else {
        triggerToast(`No se detectaron canales activos en ${form.ip_local}. Verifique IP, credenciales y que el grabador esté encendido.`, "warning");
      }
    } catch (err) {
      console.error("Error al verificar puertos ISAPI:", err);
      triggerToast(`Error al verificar puertos en ${form.ip_local}: ${err.message}`, "error");
    } finally {
      isVerifyingPorts = false;
    }
  }

  async function handleSubmit() {
    if (!form.nombre.trim()) {
      triggerToast("El nombre del dispositivo es obligatorio", "warning");
      return;
    }
    if (!form.sala_uuid) {
      triggerToast("Seleccione una sala para el dispositivo", "warning");
      return;
    }
    if (!form.ip_local.trim()) {
      triggerToast("La IP local del dispositivo es obligatoria", "warning");
      return;
    }

    isSubmitting = true;
    try {
      let savedDevUuid = currentUuid;
      if (isEditing) {
        await updateDispositivoCamara(currentUuid, form);
        triggerToast("Grabador / Cámara actualizado exitosamente", "success");
      } else {
        const created = await createDispositivoCamara(form);
        savedDevUuid = created?.data?.uuid;
        triggerToast("Grabador / Cámara registrado exitosamente", "success");
      }

      // Si se verificaron puertos físicos en el modal, sincronizarlos inmediatamente
      if (savedDevUuid && verifiedPortsResult?.canales?.length > 0) {
        await syncCanalesDispositivo(savedDevUuid, verifiedPortsResult.canales);
      } else if (isTauriWindows() && form.tipo !== "CAMARA_IP" && savedDevUuid) {
        await scanChannels({ uuid: savedDevUuid, ...form }, true);
      }

      closeModal();
      await loadDispositivos();
    } catch (err) {
      console.error("Error al guardar dispositivo:", err);
      triggerToast(`Error al guardar: ${err.message}`, "error");
    } finally {
      isSubmitting = false;
    }
  }

  async function handleDelete(dev) {
    const devUuid = dev.uuid || dev.id;
    if (!confirm(`¿Está seguro de eliminar '${dev.nombre}' (${dev.ip_local})? Las cámaras asociadas también se desactivarán.`)) {
      return;
    }

    try {
      await deleteDispositivoCamara(devUuid);
      triggerToast(`Dispositivo '${dev.nombre}' eliminado`, "info");
      await loadDispositivos();
    } catch (err) {
      console.error("Error eliminando dispositivo:", err);
      triggerToast(`Error al eliminar: ${err.message}`, "error");
    }
  }

  async function toggleExpandChannels(dev) {
    const devUuid = dev.uuid || dev.id;
    if (expandedDeviceUuid === devUuid) {
      expandedDeviceUuid = null;
      return;
    }

    expandedDeviceUuid = devUuid;
    if (!deviceChannelsMap[devUuid]) {
      await loadChannelsForDevice(devUuid);
    }
  }

  async function loadChannelsForDevice(devUuid) {
    loadingChannels = true;
    try {
      const res = await getCamaras({ dispositivo_camara_uuid: devUuid });
      if (res && res.success) {
        deviceChannelsMap = {
          ...deviceChannelsMap,
          [devUuid]: res.data || []
        };
      }
    } catch (err) {
      console.error("Error cargando canales:", err);
      triggerToast(`Error al cargar canales: ${err.message}`, "error");
    } finally {
      loadingChannels = false;
    }
  }

  async function scanChannels(dev, silent = false) {
    const devUuid = dev.uuid || dev.id;
    if (!isTauriWindows()) {
      triggerToast("El escaneo ISAPI directo a la IP local solo funciona desde la app de Windows en la sala", "info");
      return;
    }

    scanningDeviceUuid = devUuid;
    if (!silent) {
      triggerToast(`🔍 Conectando por ISAPI a ${dev.nombre} (${dev.ip_local})...`, "info");
    }

    try {
      const canales = await localScanGrabadorChannels(dev.ip_local, dev.usuario, dev.clave);
      if (canales.length === 0) {
        if (!silent) {
          triggerToast(`No se detectaron canales abiertos en ${dev.ip_local}. Verifique IP, usuario y contraseña.`, "warning");
        }
        return;
      }

      // Sincronizar los canales descubiertos con PostgreSQL
      await syncCanalesDispositivo(devUuid, canales);
      if (!silent) {
        triggerToast(`✅ ¡${canales.length} cámaras/canales detectados y guardados en ${dev.nombre}!`, "success");
      }
      
      // Recargar la lista de canales y dispositivos
      await loadChannelsForDevice(devUuid);
      await loadDispositivos();
      expandedDeviceUuid = devUuid;
    } catch (err) {
      console.error("Error escaneando canales:", err);
      if (!silent) {
        triggerToast(`Error al escanear canales en ${dev.ip_local}: ${err.message}`, "error");
      }
    } finally {
      scanningDeviceUuid = null;
    }
  }

  function getTipoBadgeStyle(tipo) {
    switch ((tipo || '').toUpperCase()) {
      case 'NVR':
        return 'background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe;';
      case 'DVR':
        return 'background: #fef3c7; color: #b45309; border: 1px solid #fde68a;';
      case 'CAMARA_IP':
        return 'background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;';
      default:
        return 'background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1;';
    }
  }

  function getTipoIcon(tipo) {
    switch ((tipo || '').toUpperCase()) {
      case 'NVR': return 'dns';
      case 'DVR': return 'videocam';
      case 'CAMARA_IP': return 'camera_indoor';
      default: return 'videocam';
    }
  }
</script>

<div style="background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.08); padding: 24px; color: #0f172a;">
  <!-- Header de la Sección -->
  <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; padding-bottom: 18px; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap;">
    <div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="material-icons" style="font-size: 24px; color: #2563eb;">videocam</span>
        <h2 style="margin: 0; font-size: 19px; font-weight: 800; color: #0f172a;">
          Grabadores y Cámaras CCTV (CECOM)
        </h2>
      </div>
      <p style="margin: 4px 0 0 0; font-size: 13px; color: #64748b;">
        Administración de NVRs, DVRs y Cámaras IP por sala. Los canales se descubren automáticamente vía ISAPI en la red local.
      </p>
    </div>

    <div style="display: flex; align-items: center; gap: 10px;">
      <button
        on:click={openCreateModal}
        type="button"
        style="display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #ffffff; border: none; border-radius: 8px; font-size: 13.5px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 10px rgba(37, 99, 235, 0.35); transition: all 0.15s ease;"
      >
        <span class="material-icons" style="font-size: 19px;">add_circle</span>
        <span>+ Nuevo Dispositivo</span>
      </button>
    </div>
  </div>

  <!-- Barra de Filtros (Sala y Búsqueda) -->
  <div style="display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 20px; flex-wrap: wrap;">
    <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
      <!-- Filtro por Sala -->
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 12.5px; font-weight: 700; color: #475569;">Sala:</span>
        <select
          bind:value={selectedSalaUuid}
          on:change={loadDispositivos}
          style="padding: 7px 12px; font-size: 13px; font-weight: 700; border-radius: 8px; border: 1px solid #cbd5e1; background: #f8fafc; color: #0f172a; outline: none; cursor: pointer;"
        >
          <option value="all">Todas las Salas ({salas.length})</option>
          {#each salas as s}
            <option value={s.uuid || s.id}>{s.nombre}</option>
          {/each}
        </select>
      </div>

      <!-- Buscador -->
      <div style="position: relative;">
        <input
          type="text"
          bind:value={searchQuery}
          on:input={loadDispositivos}
          placeholder="Buscar por nombre, IP o tipo..."
          style="padding: 7px 12px 7px 32px; font-size: 13px; border-radius: 8px; border: 1px solid #cbd5e1; background: #f8fafc; color: #0f172a; outline: none; min-width: 260px;"
        />
        <span class="material-icons" style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); font-size: 18px; color: #94a3b8; pointer-events: none;">
          search
        </span>
      </div>
    </div>

    <div>
      <span style="font-size: 12.5px; color: #64748b; font-weight: 600;">
        Total: <strong>{dispositivos.length}</strong> grabador(es)
      </span>
    </div>
  </div>

  <!-- Listado de Grabadores / Cámaras -->
  {#if isLoading}
    <div style="padding: 40px; text-align: center; color: #64748b;">
      <span class="material-icons" style="font-size: 32px; animation: spin 1s infinite linear; color: #2563eb;">sync</span>
      <div style="margin-top: 8px; font-size: 14px; font-weight: 600;">Cargando dispositivos de video...</div>
    </div>
  {:else if dispositivos.length === 0}
    <div style="padding: 48px; text-align: center; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 12px;">
      <span class="material-icons" style="font-size: 42px; color: #94a3b8;">videocam_off</span>
      <div style="margin-top: 10px; font-size: 15px; font-weight: 800; color: #334155;">No hay dispositivos de video registrados</div>
      <p style="margin: 6px 0 16px 0; font-size: 13px; color: #64748b;">
        Haz clic en el botón superior para agregar tu primer NVR, DVR o Cámara IP en esta sala.
      </p>
      <button
        on:click={openCreateModal}
        type="button"
        style="padding: 8px 16px; background: #2563eb; color: #ffffff; border: none; border-radius: 6px; font-size: 13px; font-weight: 700; cursor: pointer;"
      >
        + Agregar Dispositivo
      </button>
    </div>
  {:else}
    <div style="display: flex; flex-direction: column; gap: 14px;">
      {#each dispositivos as dev (dev.uuid || dev.id)}
        {@const isExpanded = expandedDeviceUuid === (dev.uuid || dev.id)}
        {@const isScanning = scanningDeviceUuid === (dev.uuid || dev.id)}
        {@const channels = deviceChannelsMap[dev.uuid || dev.id] || []}

        <div style="background: #ffffff; border: 1px solid {isExpanded ? '#3b82f6' : '#e2e8f0'}; border-radius: 10px; overflow: hidden; transition: all 0.15s ease; box-shadow: {isExpanded ? '0 4px 12px rgba(59, 130, 246, 0.12)' : '0 1px 3px rgba(0,0,0,0.04)'};">
          <!-- Fila Principal del Grabador -->
          <div style="padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; background: {isExpanded ? '#f8fafc' : '#ffffff'};">
            <!-- Icono y Datos Básicos -->
            <div style="display: flex; align-items: center; gap: 14px; min-width: 280px;">
              <div style="width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; {getTipoBadgeStyle(dev.tipo)}">
                <span class="material-icons" style="font-size: 22px;">{getTipoIcon(dev.tipo)}</span>
              </div>

              <div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 15px; font-weight: 800; color: #0f172a;">{dev.nombre}</span>
                  <span style="font-size: 10.5px; font-weight: 800; padding: 2px 7px; border-radius: 6px; text-transform: uppercase; {getTipoBadgeStyle(dev.tipo)}">
                    {dev.tipo}
                  </span>
                </div>
                <div style="display: flex; align-items: center; gap: 10px; margin-top: 3px; font-size: 12.5px; color: #64748b;">
                  <span>📍 Sala: <strong style="color: #1e293b;">{dev.sala_nombre || "Sin Sala"}</strong></span>
                  <span>•</span>
                  <span>IP Local: <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; color: #0284c7; font-weight: 700;">{dev.ip_local}</code></span>
                  <span>•</span>
                  <span>SDK: <code style="color: #475569;">:{dev.puerto_sdk || 8000}</code></span>
                </div>
              </div>
            </div>

            <!-- Conteo de Canales y Acciones -->
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              <!-- Badge de Canales -->
              <div style="display: flex; align-items: center; gap: 6px; padding: 6px 12px; background: #f1f5f9; border-radius: 8px; font-size: 12.5px; color: #334155; font-weight: 700;">
                <span class="material-icons" style="font-size: 17px; color: #0284c7;">videocam</span>
                <span>{dev.canales_activos_db || 0} / {dev.canales_totales || 1} canales</span>
              </div>

              <!-- Botón Escanear ISAPI -->
              <button
                on:click={() => scanChannels(dev)}
                disabled={isScanning}
                type="button"
                style="display: inline-flex; align-items: center; gap: 5px; padding: 7px 12px; border-radius: 7px; border: 1px solid #cbd5e1; background: #ffffff; color: #1e293b; font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.15s ease;"
                title="Escanear canales reales del grabador vía ISAPI en la red local"
              >
                <span class="material-icons" style="font-size: 16px; color: #2563eb; {isScanning ? 'animation: spin 1s infinite linear;' : ''}">
                  {isScanning ? 'sync' : 'search'}
                </span>
                <span>{isScanning ? 'Escaneando...' : 'Auto-Escanear ISAPI'}</span>
              </button>

              <!-- Botón Ver Canales (Expandir) -->
              <button
                on:click={() => toggleExpandChannels(dev)}
                type="button"
                style="display: inline-flex; align-items: center; gap: 4px; padding: 7px 12px; border-radius: 7px; border: 1px solid #bfdbfe; background: {isExpanded ? '#dbeafe' : '#eff6ff'}; color: #1d4ed8; font-size: 12px; font-weight: 700; cursor: pointer;"
              >
                <span>{isExpanded ? 'Ocultar Canales' : 'Ver Canales'}</span>
                <span class="material-icons" style="font-size: 17px;">{isExpanded ? 'expand_less' : 'expand_more'}</span>
              </button>

              <!-- Editar -->
              <button
                on:click={() => openEditModal(dev)}
                type="button"
                style="padding: 7px 9px; border-radius: 6px; border: 1px solid #cbd5e1; background: #ffffff; color: #475569; cursor: pointer;"
                title="Editar configuración del grabador"
              >
                <span class="material-icons" style="font-size: 16px;">edit</span>
              </button>

              <!-- Eliminar -->
              <button
                on:click={() => handleDelete(dev)}
                type="button"
                style="padding: 7px 9px; border-radius: 6px; border: 1px solid #fecaca; background: #fff5f5; color: #dc2626; cursor: pointer;"
                title="Eliminar dispositivo"
              >
                <span class="material-icons" style="font-size: 16px;">delete</span>
              </button>
            </div>
          </div>

          <!-- Acordeón Desplegable con los Canales / Cámaras -->
          {#if isExpanded}
            <div style="padding: 16px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0;">
              {#if loadingChannels}
                <div style="padding: 20px; text-align: center; color: #64748b; font-size: 13px;">
                  Cargando canales...
                </div>
              {:else if channels.length === 0}
                <div style="padding: 20px; text-align: center; color: #64748b; font-size: 13px;">
                  No hay canales descubiertos aún para este grabador.
                  <div style="margin-top: 6px;">
                    <button
                      on:click={() => scanChannels(dev)}
                      type="button"
                      style="font-size: 12px; font-weight: 700; color: #2563eb; background: none; border: none; cursor: pointer; text-decoration: underline;"
                    >
                      Haz clic aquí para auto-escanear por ISAPI
                    </button>
                  </div>
                </div>
              {:else}
                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px;">
                  {#each channels as cam (cam.uuid || cam.id)}
                    {@const isActivo = cam.active === 1 || cam.active === true || cam.active === undefined}
                    <div style="padding: 10px 14px; background: #ffffff; border: 1px solid {isActivo ? '#e2e8f0' : '#fecaca'}; border-radius: 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                      <div style="display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 12px; font-weight: 800; color: {isActivo ? '#2563eb' : '#94a3b8'}; background: {isActivo ? '#eff6ff' : '#f1f5f9'}; padding: 2px 7px; border-radius: 6px; font-family: monospace;">
                          CH {cam.numero_canal}
                        </span>
                        <div>
                          <div style="font-size: 13px; font-weight: 700; color: {isActivo ? '#0f172a' : '#64748b'};">
                            {cam.nombre}
                          </div>
                          {#if cam.ip_origen}
                            <div style="font-size: 11px; font-family: monospace; color: #64748b;">
                              IP: {cam.ip_origen}
                            </div>
                          {/if}
                        </div>
                      </div>

                      <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 9.5px; font-weight: 800; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; background: {isActivo ? '#ecfdf5' : '#fef2f2'}; color: {isActivo ? '#059669' : '#dc2626'}; border: 1px solid {isActivo ? '#a7f3d0' : '#fecaca'};">
                          {isActivo ? 'Señal Activa' : 'Deshabilitado'}
                        </span>
                        <span style="font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; background: {cam.tipo === 'IP' ? '#eff6ff' : '#f8fafc'}; color: {cam.tipo === 'IP' ? '#2563eb' : '#64748b'};">
                          {cam.tipo}
                        </span>
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Modal Crear / Editar Dispositivo -->
{#if isModalOpen}
  <div style="position: fixed; inset: 0; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(2px); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 16px;">
    <div style="background: #ffffff; width: 100%; max-width: 520px; border-radius: 14px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2); overflow: hidden; border: 1px solid #e2e8f0;">
      <!-- Modal Header -->
      <div style="padding: 18px 24px; background: #0f172a; color: #ffffff; display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="material-icons" style="font-size: 20px; color: #38bdf8;">videocam</span>
          <h3 style="margin: 0; font-size: 16px; font-weight: 800;">
            {isEditing ? "Editar Dispositivo de Video" : "Nuevo Grabador / Cámara"}
          </h3>
        </div>
        <button
          on:click={closeModal}
          type="button"
          style="background: none; border: none; color: #94a3b8; cursor: pointer; display: flex; align-items: center;"
        >
          <span class="material-icons" style="font-size: 20px;">close</span>
        </button>
      </div>

      <!-- Modal Body -->
      <form on:submit|preventDefault={handleSubmit} style="padding: 24px; display: flex; flex-direction: column; gap: 14px;">
        <!-- Nombre -->
        <div>
          <label style="font-size: 11.5px; font-weight: 800; color: #475569; text-transform: uppercase; display: block; margin-bottom: 4px;">
            Nombre del Equipo *
            <input
              type="text"
              bind:value={form.nombre}
              placeholder="Ej. NVR Mesas 01, DVR Bóveda, Cámara Ruleta"
              required
              style="width: 100%; box-sizing: border-box; padding: 9px 12px; font-size: 13.5px; font-weight: 600; border-radius: 8px; border: 1px solid #cbd5e1; outline: none; margin-top: 4px; display: block;"
            />
          </label>
        </div>

        <!-- Sala y Tipo -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label style="font-size: 11.5px; font-weight: 800; color: #475569; text-transform: uppercase; display: block; margin-bottom: 4px;">
              Sala *
              <select
                bind:value={form.sala_uuid}
                required
                style="width: 100%; box-sizing: border-box; padding: 9px 12px; font-size: 13.5px; font-weight: 700; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; outline: none; margin-top: 4px; display: block;"
              >
                {#each salas as s}
                  <option value={s.uuid || s.id}>{s.nombre}</option>
                {/each}
              </select>
            </label>
          </div>

          <div>
            <label style="font-size: 11.5px; font-weight: 800; color: #475569; text-transform: uppercase; display: block; margin-bottom: 4px;">
              Tipo de Equipo *
              <select
                bind:value={form.tipo}
                required
                style="width: 100%; box-sizing: border-box; padding: 9px 12px; font-size: 13.5px; font-weight: 700; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; outline: none; margin-top: 4px; display: block;"
              >
                <option value="NVR">NVR (Grabador IP)</option>
                <option value="DVR">DVR (Grabador Analógico / Híbrido)</option>
                <option value="CAMARA_IP">Cámara IP Individual</option>
              </select>
            </label>
          </div>
        </div>

        <!-- IP Local y Canales Totales -->
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 12px;">
          <div>
            <label style="font-size: 11.5px; font-weight: 800; color: #2563eb; text-transform: uppercase; display: block; margin-bottom: 4px;">
              IP Local en LAN *
              <input
                type="text"
                bind:value={form.ip_local}
                placeholder="Ej. 192.168.1.50"
                required
                style="width: 100%; box-sizing: border-box; padding: 9px 12px; font-size: 13.5px; font-weight: 700; font-family: monospace; border-radius: 8px; border: 1px solid #93c5fd; background: #eff6ff; color: #1e40af; outline: none; margin-top: 4px; display: block;"
              />
            </label>
          </div>

          <div>
            <label style="font-size: 11.5px; font-weight: 800; color: #475569; text-transform: uppercase; display: block; margin-bottom: 4px;">
              Canales
              <input
                type="number"
                bind:value={form.canales_totales}
                disabled={form.tipo === 'CAMARA_IP'}
                min="1"
                max="64"
                style="width: 100%; box-sizing: border-box; padding: 9px 12px; font-size: 13.5px; font-weight: 700; border-radius: 8px; border: 1px solid #cbd5e1; outline: none; margin-top: 4px; display: block;"
              />
            </label>
          </div>
        </div>

        <!-- Usuario y Contraseña -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label style="font-size: 11.5px; font-weight: 800; color: #475569; text-transform: uppercase; display: block; margin-bottom: 4px;">
              Usuario
              <input
                type="text"
                bind:value={form.usuario}
                placeholder="admin"
                style="width: 100%; box-sizing: border-box; padding: 9px 12px; font-size: 13.5px; border-radius: 8px; border: 1px solid #cbd5e1; outline: none; margin-top: 4px; display: block;"
              />
            </label>
          </div>

          <div>
            <label style="font-size: 11.5px; font-weight: 800; color: #475569; text-transform: uppercase; display: block; margin-bottom: 4px;">
              Contraseña
              <input
                type="password"
                bind:value={form.clave}
                placeholder="Clave del equipo"
                style="width: 100%; box-sizing: border-box; padding: 9px 12px; font-size: 13.5px; border-radius: 8px; border: 1px solid #cbd5e1; outline: none; margin-top: 4px; display: block;"
              />
            </label>
          </div>
        </div>

        <!-- Puertos (Avanzado colapsable o compacto) -->
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
          <div>
            <label style="font-size: 10.5px; font-weight: 800; color: #64748b; text-transform: uppercase; display: block;">
              Puerto SDK
              <input
                type="number"
                bind:value={form.puerto_sdk}
                style="width: 100%; box-sizing: border-box; padding: 6px 8px; font-size: 12.5px; font-weight: 700; border-radius: 6px; border: 1px solid #cbd5e1; margin-top: 2px;"
              />
            </label>
          </div>

          <div>
            <label style="font-size: 10.5px; font-weight: 800; color: #64748b; text-transform: uppercase; display: block;">
              Puerto HTTP
              <input
                type="number"
                bind:value={form.puerto_http}
                style="width: 100%; box-sizing: border-box; padding: 6px 8px; font-size: 12.5px; font-weight: 700; border-radius: 6px; border: 1px solid #cbd5e1; margin-top: 2px;"
              />
            </label>
          </div>

          <div>
            <label style="font-size: 10.5px; font-weight: 800; color: #64748b; text-transform: uppercase; display: block;">
              Puerto RTSP
              <input
                type="number"
                bind:value={form.puerto_rtsp}
                style="width: 100%; box-sizing: border-box; padding: 6px 8px; font-size: 12.5px; font-weight: 700; border-radius: 6px; border: 1px solid #cbd5e1; margin-top: 2px;"
              />
            </label>
          </div>
        </div>

        <!-- Diagnóstico y Verificación de Puertos Físicos ISAPI -->
        <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="material-icons" style="font-size: 18px; color: #0284c7;">videocam</span>
              <span style="font-size: 11.5px; font-weight: 800; color: #1e293b; text-transform: uppercase;">
                Diagnóstico ISAPI de Canales y Video
              </span>
            </div>
            <button
              type="button"
              on:click={verificarPuertosFormulario}
              disabled={isVerifyingPorts || !form.ip_local.trim()}
              style="padding: 5px 12px; font-size: 11.5px; font-weight: 700; border-radius: 6px; background: #0284c7; color: white; border: none; cursor: pointer; display: flex; align-items: center; gap: 5px;"
              title="Comprobar en el grabador (NVR/DVR) cuáles canales tienen señal activa vs deshabilitados"
            >
              {#if isVerifyingPorts}
                <span class="material-icons" style="font-size: 14px; animation: spin 1s infinite linear;">sync</span>
                Verificando...
              {:else}
                <span class="material-icons" style="font-size: 14px;">travel_explore</span>
                Verificar Canales en Vivo
              {/if}
            </button>
          </div>

          {#if verifiedPortsResult}
            <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; font-size: 12px;">
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
                <span style="color: #16a34a; font-weight: 800;">
                  🟢 {verifiedPortsResult.puertos_activos} con Video
                </span>
                <span style="color: #dc2626; font-weight: 800;">
                  🔴 {verifiedPortsResult.puertos_deshabilitados} Deshabilitados/Sin señal
                </span>
                <span style="color: #64748b; font-weight: 600;">
                  (Total: {verifiedPortsResult.total_puertos} canales)
                </span>
              </div>

              <!-- Vista previa rápida de puertos físicos detectados -->
              <div style="max-height: 120px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; font-size: 11px;">
                {#each verifiedPortsResult.canales as ch}
                  <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 6px; border-radius: 4px; background: {ch.activo ? '#f0fdf4' : '#fef2f2'}; border: 1px solid {ch.activo ? '#bbf7d0' : '#fecaca'};">
                    <span style="font-weight: 700; color: #1e293b;">
                      Canal {ch.numero_canal}: {ch.nombre}
                    </span>
                    <span style="font-weight: 800; font-size: 9.5px; color: {ch.activo ? '#15803d' : '#b91c1c'};">
                      {ch.activo ? (ch.resolucion || 'SEÑAL OK') : 'DESHABILITADO / SIN SEÑAL'}
                    </span>
                  </div>
                {/each}
              </div>
            </div>
          {:else}
            <div style="font-size: 11px; color: #64748b; line-height: 1.4;">
              💡 Haz clic en <strong>Verificar Puertos en Vivo</strong> para consultar por ISAPI al DVR y detectar puertos físicos desconectados o sin video antes de guardar.
            </div>
          {/if}
        </div>

        <!-- Footer Botones -->
        <div style="display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 10px; padding-top: 14px; border-top: 1px solid #e2e8f0;">
          <button
            type="button"
            on:click={closeModal}
            style="padding: 9px 18px; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; color: #475569; font-size: 13.5px; font-weight: 700; cursor: pointer;"
          >
            Cancelar
          </button>

          <button
            type="submit"
            disabled={isSubmitting}
            style="padding: 9px 22px; border-radius: 8px; border: none; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #ffffff; font-size: 13.5px; font-weight: 800; cursor: pointer; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.3);"
          >
            {isSubmitting ? "Guardando..." : isEditing ? "Actualizar Grabador" : "Registrar Grabador"}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
