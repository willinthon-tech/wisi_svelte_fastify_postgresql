<script>
  import { onMount } from "svelte";
  import { triggerToast } from "../../controllers/ui.store.js";
  import { masterMesasStore } from "../../controllers/master.store.js";
  import {
    getCamaras,
    getMesaCamaras,
    setMesaCamaras
  } from "../../services/cecomVideo.service.js";

  export let salas = [];

  let selectedSalaUuid = "";
  let selectedMesaUuid = "";
  let availableCameras = [];
  let assignedCameras = [];
  let isLoading = false;
  let isSaving = false;

  // La IA captura integralmente los eventos de la mesa (cartas, jugadas, paño/dolly, drop y reglas)
  // sin forzar selección manual de rol por cámara.

  onMount(async () => {
    if (salas.length > 0) {
      selectedSalaUuid = salas[0].uuid || salas[0].id;
      await onSalaChange();
    }
  });

  // Mesas filtradas por la sala seleccionada
  $: filteredMesas = ($masterMesasStore || []).filter(
    (m) => String(m.sala_uuid || m.sala_id) === String(selectedSalaUuid) && (m.active ?? 1) === 1
  );

  async function onSalaChange() {
    selectedMesaUuid = "";
    assignedCameras = [];
    await loadAvailableCameras();

    // Auto-seleccionar primera mesa si hay
    if (filteredMesas.length > 0) {
      selectedMesaUuid = filteredMesas[0].uuid || filteredMesas[0].id;
      await loadMesaAssignments();
    }
  }

  async function loadAvailableCameras() {
    if (!selectedSalaUuid) {
      availableCameras = [];
      return;
    }

    try {
      const res = await getCamaras({ sala_uuid: selectedSalaUuid });
      if (res && res.success) {
        availableCameras = res.data || [];
      }
    } catch (err) {
      console.error("Error cargando cámaras disponibles:", err);
      triggerToast(`Error cargando cámaras: ${err.message}`, "error");
    }
  }

  async function onMesaChange() {
    await loadMesaAssignments();
  }

  async function loadMesaAssignments() {
    if (!selectedMesaUuid) {
      assignedCameras = [];
      return;
    }

    isLoading = true;
    try {
      const res = await getMesaCamaras(selectedMesaUuid);
      if (res && res.success) {
        assignedCameras = (res.data || []).map((item) => ({
          camara_uuid: item.camara_uuid,
          rol: item.rol || "CENITAL_CARTAS",
          nombre: item.camara_nombre,
          dispositivo_nombre: item.dispositivo_nombre,
          numero_canal: item.numero_canal
        }));
      }
    } catch (err) {
      console.error("Error cargando asignaciones de mesa:", err);
      triggerToast(`Error al cargar asignación: ${err.message}`, "error");
    } finally {
      isLoading = false;
    }
  }

  function getCamSignature(c) {
    if (!c) return "";
    const dev = String(c.dispositivo_nombre || "").trim().toLowerCase();
    const ch = Number(c.numero_canal);
    return dev && !isNaN(ch) ? `${dev}::${ch}` : "";
  }

  function getCamUuid(c) {
    if (!c) return "";
    return String(c.camara_uuid || c.uuid || c.id || "").trim();
  }

  // Set reactivo de UUIDs y firmas de canal para reactividad inmediata garantizada en Svelte
  $: assignedKeysSet = new Set(
    assignedCameras.flatMap((c) => {
      const keys = [];
      const u = getCamUuid(c);
      if (u) keys.push(u);
      const sig = getCamSignature(c);
      if (sig) keys.push(sig);
      return keys;
    })
  );

  function isCamAssigned(cam, keysSet) {
    if (!cam || !keysSet) return false;
    const u = getCamUuid(cam);
    if (u && keysSet.has(u)) return true;
    const sig = getCamSignature(cam);
    if (sig && keysSet.has(sig)) return true;
    return false;
  }

  function toggleCamera(cam) {
    const camUuid = getCamUuid(cam);
    const sig = getCamSignature(cam);
    const exists = isCamAssigned(cam, assignedKeysSet);

    if (exists) {
      assignedCameras = assignedCameras.filter((c) => {
        const cUid = getCamUuid(c);
        const cSig = getCamSignature(c);
        if (camUuid && cUid && cUid === camUuid) return false;
        if (sig && cSig && cSig === sig) return false;
        return true;
      });
    } else {
      assignedCameras = [
        ...assignedCameras,
        {
          camara_uuid: camUuid || cam.uuid || cam.id,
          rol: "AUDITORIA_COMPLETA",
          nombre: cam.nombre || `Canal ${cam.numero_canal}`,
          dispositivo_nombre: cam.dispositivo_nombre || "Grabador",
          numero_canal: Number(cam.numero_canal)
        }
      ];
    }
  }

  async function handleSave() {
    if (!selectedMesaUuid) {
      triggerToast("Seleccione una mesa primero", "warning");
      return;
    }

    isSaving = true;
    try {
      const payload = assignedCameras.map((c) => ({
        camara_uuid: c.camara_uuid,
        rol: c.rol
      }));

      await setMesaCamaras(selectedMesaUuid, payload);
      triggerToast("✅ ¡Asignación de cámaras guardada exitosamente!", "success");
      await loadMesaAssignments();
    } catch (err) {
      console.error("Error al guardar asignación de cámaras:", err);
      triggerToast(`Error al guardar: ${err.message}`, "error");
    } finally {
      isSaving = false;
    }
  }

  $: currentMesa = ($masterMesasStore || []).find((m) => String(m.uuid || m.id) === String(selectedMesaUuid));
</script>

<div style="background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.08); padding: 24px; color: #0f172a;">
  <!-- Header de la Sección -->
  <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; padding-bottom: 18px; border-bottom: 1px solid #e2e8f0; flex-wrap: wrap;">
    <div>
      <div style="display: flex; align-items: center; gap: 8px;">
        <span class="material-icons" style="font-size: 24px; color: #16a34a;">hub</span>
        <h2 style="margin: 0; font-size: 19px; font-weight: 800; color: #0f172a;">
          Asociación Mesas de Juego ➔ Cámaras
        </h2>
      </div>
      <p style="margin: 4px 0 0 0; font-size: 13px; color: #64748b;">
        Asigna qué cámaras vigilan cada mesa física para alimentar la IA de Baccarat, Blackjack, Ruleta, Texas y Poker Caribeño.
      </p>
    </div>

    <!-- Botón Guardar -->
    <div>
      <button
        on:click={handleSave}
        disabled={isSaving || !selectedMesaUuid}
        type="button"
        style="display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px; background: linear-gradient(135deg, #16a34a, #15803d); color: #ffffff; border: none; border-radius: 8px; font-size: 13.5px; font-weight: 800; cursor: pointer; box-shadow: 0 4px 10px rgba(22, 163, 74, 0.35); transition: all 0.15s ease;"
      >
        <span class="material-icons" style="font-size: 19px;">save</span>
        <span>{isSaving ? "Guardando..." : "Guardar Asignación"}</span>
      </button>
    </div>
  </div>

  <!-- Selectores de Sala y Mesa -->
  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 24px; background: #f8fafc; padding: 18px; border-radius: 10px; border: 1px solid #e2e8f0;">
    <div>
      <label style="font-size: 11.5px; font-weight: 800; color: #475569; text-transform: uppercase; display: block; margin-bottom: 4px;">
        1. Seleccionar Sala
        <select
          bind:value={selectedSalaUuid}
          on:change={onSalaChange}
          style="width: 100%; box-sizing: border-box; padding: 9px 12px; font-size: 14px; font-weight: 700; border-radius: 8px; border: 1px solid #cbd5e1; background: #ffffff; color: #0f172a; outline: none; margin-top: 4px; display: block;"
        >
          {#each salas as s}
            <option value={s.uuid || s.id}>{s.nombre}</option>
          {/each}
        </select>
      </label>
    </div>

    <div>
      <label style="font-size: 11.5px; font-weight: 800; color: #2563eb; text-transform: uppercase; display: block; margin-bottom: 4px;">
        2. Seleccionar Mesa de Juego
        <select
          bind:value={selectedMesaUuid}
          on:change={onMesaChange}
          disabled={filteredMesas.length === 0}
          style="width: 100%; box-sizing: border-box; padding: 9px 12px; font-size: 14px; font-weight: 800; border-radius: 8px; border: 1px solid #93c5fd; background: #eff6ff; color: #1e40af; outline: none; margin-top: 4px; display: block;"
        >
          {#if filteredMesas.length === 0}
            <option value="">No hay mesas registradas en esta sala</option>
          {:else}
            {#each filteredMesas as m}
              <option value={m.uuid || m.id}>
                {m.nombre} {#if m.juego_nombre}• ({m.juego_nombre}){/if}
              </option>
            {/each}
          {/if}
        </select>
      </label>
    </div>
  </div>

  {#if !selectedMesaUuid}
    <div style="padding: 40px; text-align: center; color: #64748b; background: #f8fafc; border-radius: 10px; border: 1px dashed #cbd5e1;">
      Seleccione una sala y una mesa para gestionar sus cámaras asignadas.
    </div>
  {:else}
    <!-- Grid: Cámaras Asignadas vs Disponibles -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
      <!-- COLUMNA IZQUIERDA: Cámaras Asignadas a esta Mesa -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid #e2e8f0;">
          <h3 style="margin: 0; font-size: 14px; font-weight: 800; color: #1e293b; display: flex; align-items: center; gap: 6px;">
            <span class="material-icons" style="font-size: 18px; color: #16a34a;">check_circle</span>
            Cámaras Asignadas ({assignedCameras.length})
          </h3>
          <span style="font-size: 12px; color: #64748b;">
            {currentMesa?.nombre || "Mesa"}
          </span>
        </div>

        {#if assignedCameras.length === 0}
          <div style="padding: 30px; text-align: center; color: #94a3b8; font-size: 13px; font-style: italic;">
            No hay cámaras asignadas a esta mesa todavía.
            <div style="margin-top: 4px; font-size: 12px; color: #64748b;">
              Selecciona una o más cámaras de la lista de la derecha.
            </div>
          </div>
        {:else}
          <div style="display: flex; flex-direction: column; gap: 10px;">
            {#each assignedCameras as item (item.camara_uuid || `${item.dispositivo_nombre}_${item.numero_canal}`)}
              <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                  <div>
                    <div style="font-size: 13.5px; font-weight: 800; color: #0f172a;">
                      {item.nombre || "Cámara"}
                    </div>
                    <div style="font-size: 11.5px; color: #64748b;">
                      {item.dispositivo_nombre || "Grabador"} • CH {item.numero_canal}
                    </div>
                  </div>

                  <button
                    on:click={() => toggleCamera(item)}
                    type="button"
                    style="padding: 4px 8px; background: #fee2e2; border: 1px solid #fecaca; color: #dc2626; border-radius: 6px; font-size: 11px; font-weight: 800; cursor: pointer;"
                  >
                    Quitar
                  </button>
                </div>

                <!-- Captura Automática Integral de la Mesa -->
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px; padding-top: 8px; border-top: 1px dashed #e2e8f0;">
                  <span style="font-size: 11px; font-weight: 800; color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">
                    👁️ Captura Integral en Vivo
                  </span>
                  <span style="font-size: 11px; color: #475569;">
                    La IA audita automáticamente cartas, paño/dolly, buzón de drop y reglas de esta mesa.
                  </span>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- COLUMNA DERECHA: Todas las Cámaras Disponibles en la Sala -->
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid #e2e8f0;">
          <h3 style="margin: 0; font-size: 14px; font-weight: 800; color: #1e293b; display: flex; align-items: center; gap: 6px;">
            <span class="material-icons" style="font-size: 18px; color: #2563eb;">videocam</span>
            Cámaras de la Sala ({availableCameras.length})
          </h3>
          <span style="font-size: 12px; color: #64748b;">
            Haz clic para agregar o quitar
          </span>
        </div>

        {#if availableCameras.length === 0}
          <div style="padding: 30px; text-align: center; color: #94a3b8; font-size: 13px;">
            No hay cámaras descubiertas en esta sala.
            <div style="margin-top: 4px; font-size: 12px; color: #64748b;">
              Ve a la pestaña <strong>"Cámaras y Grabadores"</strong> y registra un equipo con escaneo ISAPI.
            </div>
          </div>
        {:else}
          <div style="display: flex; flex-direction: column; gap: 8px; max-height: 480px; overflow-y: auto; padding-right: 4px;">
            {#each availableCameras as cam (cam.uuid || cam.id || `${cam.dispositivo_nombre}_${cam.numero_canal}`)}
              {@const isAssigned = isCamAssigned(cam, assignedKeysSet)}

              <button
                type="button"
                on:click={() => toggleCamera(cam)}
                style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; background: {isAssigned ? '#eff6ff' : '#f8fafc'}; border: 1.5px solid {isAssigned ? '#2563eb' : '#cbd5e1'}; border-radius: 8px; cursor: pointer; text-align: left; transition: all 0.15s ease;"
              >
                <div style="display: flex; align-items: center; gap: 10px;">
                  <span class="material-icons" style="font-size: 22px; color: {isAssigned ? '#2563eb' : '#94a3b8'};">
                    {isAssigned ? "check_box" : "check_box_outline_blank"}
                  </span>
                  <div>
                    <div style="font-size: 13px; font-weight: {isAssigned ? '800' : '700'}; color: {isAssigned ? '#1d4ed8' : '#0f172a'};">
                      {cam.nombre || `Canal ${cam.numero_canal}`}
                    </div>
                    <div style="font-size: 11px; color: #64748b;">
                      {cam.dispositivo_nombre || "Grabador"} • CH {cam.numero_canal}
                    </div>
                  </div>
                </div>

                <span style="font-size: 10.5px; font-weight: 800; padding: 3px 8px; border-radius: 12px; text-transform: uppercase; background: {isAssigned ? '#dbeafe' : '#e2e8f0'}; color: {isAssigned ? '#1d4ed8' : '#475569'};">
                  {isAssigned ? "Asignada" : "Disponible"}
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
