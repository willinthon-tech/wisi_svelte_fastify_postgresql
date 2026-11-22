<script>
  import { onMount, onDestroy } from "svelte";
  import { triggerToast } from "../../controllers/ui.store.js";
  import { toBackendUrl } from "../../config/api.config.js";

  export let salas = [];

  let status = {
    status: "disconnected", // 'disconnected' | 'connecting' | 'waiting_qr' | 'connected'
    qr: null,
    user: null,
    error: null
  };

  let mappings = [];
  let availableGroups = [];
  let logs = [];
  
  let isLoadingStatus = false;
  let isConnecting = false;
  let isDisconnecting = false;
  let isLoadingGroups = false;
  let isLoadingMappings = false;
  let isLoadingLogs = false;
  let isSavingMapping = false;

  // Filtrar para que solo aparezcan salas válidas (excluir galpones y depósitos)
  function isTipo1Sala(sala) {
    if (!sala) return false;

    // Grupo UUID check (Galpones / Depósitos):
    const galponGrupoUuids = [
      '51a3d9bc-76d3-4f08-8dd9-97c7f79ea0e3',
      '55d65e8b-09b2-4164-8491-efbdd50433b6'
    ];
    const gUuid = sala.grupo_uuid ? String(sala.grupo_uuid).toLowerCase().trim() : '';
    if (gUuid && galponGrupoUuids.includes(gUuid)) return false;

    // Grupo Nombre check:
    if (sala.grupo_nombre) {
      const gn = String(sala.grupo_nombre).toLowerCase().trim();
      if (gn.includes('galpon') || gn.includes('galpón') || gn.includes('deposito') || gn.includes('depósito')) {
        return false;
      }
    }

    // Name check:
    const nom = String(sala.nombre || sala.name || sala.nombre_comercial || '').toLowerCase().trim();
    if (
      nom.includes('galpon') || 
      nom.includes('galpón') || 
      nom.includes('deposito') || 
      nom.includes('depósito') || 
      nom.includes('sótano') || 
      nom.includes('sotano') || 
      nom.includes('almacen') || 
      nom.includes('almacén') || 
      nom === 'gainer' || 
      nom.startsWith('darien')
    ) {
      return false;
    }

    // Legacy fields check (if present)
    if (sala.grupo_id !== undefined && sala.grupo_id !== null && !isNaN(Number(sala.grupo_id))) {
      if (Number(sala.grupo_id) === 2) return false;
    }
    if (sala.tipo_id !== undefined && sala.tipo_id !== null && !isNaN(Number(sala.tipo_id))) {
      if (Number(sala.tipo_id) === 2) return false;
    }
    if (sala.tipo !== undefined && sala.tipo !== null && !isNaN(Number(sala.tipo))) {
      if (Number(sala.tipo) === 2) return false;
    }

    return true;
  }

  // Lista reactiva de salas válidas (solo salas de juego, sin galpones)
  $: availableSalas = (salas || []).filter(isTipo1Sala);

  // Helper para extraer lista de subsalas / salas hijas si es multisala
  function getSubsalasList(multisalas) {
    if (!multisalas) return [];
    let list = [];
    if (Array.isArray(multisalas)) {
      list = multisalas;
    } else if (typeof multisalas === 'string') {
      try {
        const parsed = JSON.parse(multisalas);
        list = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        list = [];
      }
    }
    return list.map(item => {
      if (typeof item === 'string') {
        return { uuid: item, nombre: item, active: 1 };
      }
      return {
        uuid: item.uuid || item.id,
        nombre: item.nombre || item.name || 'Sub-sala',
        active: item.active !== 0 && item.active !== false
      };
    }).filter(sub => sub.active !== false && sub.active !== 0 && Boolean(sub.uuid));
  }

  // Modal para asociar/editar mapeo de grupo
  let isModalOpen = false;
  let isEditingMapping = false;
  let mappingForm = {
    group_jid: "",
    group_name: "",
    sala_uuid: "",
    multisala_uuid: "",
    tipo_operaciones: "todo",
    auto_reply: true,
    is_active: true
  };

  // Sala seleccionada y sus subsalas
  $: selectedSalaObj = availableSalas.find(s => (s.uuid === mappingForm.sala_uuid || s.id === mappingForm.sala_uuid)) || null;
  $: currentSubsalas = selectedSalaObj ? getSubsalasList(selectedSalaObj.multisalas) : [];

  function handleSalaChange(e) {
    mappingForm.sala_uuid = e.target.value;
    mappingForm.multisala_uuid = "";
  }

  // Probador interactivo de sintaxis
  let testInput = "Compra 200$ USDT Máquinas Abel Gonzáles";
  let testResult = null;
  let isTesting = false;

  let pollInterval = null;
  let lastStatusCheck = Date.now();

  onMount(async () => {
    await Promise.all([
      fetchStatus(),
      fetchMappings(),
      fetchLogs()
    ]);
    runTestParse();

    // Polling prudente: cada 3s al conectar o esperar QR, y cada 10s si está conectado o desconectado
    pollInterval = setInterval(() => {
      const now = Date.now();
      const isFastPoll = (status.status === "connecting" || status.status === "waiting_qr");
      const intervalLimit = isFastPoll ? 3000 : 10000;
      if (now - lastStatusCheck >= intervalLimit) {
        lastStatusCheck = now;
        fetchStatus(true);
      }
    }, 1500);
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
  });

  async function fetchStatus(silent = false) {
    if (!silent) isLoadingStatus = true;
    try {
      const res = await fetch(toBackendUrl("/api/whatsapp/status"));
      const json = await res.json();
      if (json && json.success) {
        status = json.data || status;
        if (status.status === "connected" && availableGroups.length === 0) {
          fetchGroups();
        }
      }
    } catch (e) {
      if (!silent) console.warn("Error consultando estado de WhatsApp:", e.message);
    } finally {
      if (!silent) isLoadingStatus = false;
    }
  }

  async function handleConnect(force = false) {
    isConnecting = true;
    try {
      const res = await fetch(toBackendUrl("/api/whatsapp/connect"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force })
      });
      const json = await res.json();
      if (json && json.success) {
        status = json.data || status;
        if (status.status === 'connected') {
          triggerToast("WhatsApp conectado exitosamente", "success");
          fetchGroups();
        } else if (status.status === 'waiting_qr') {
          triggerToast("Código QR generado. Escanéalo desde tu teléfono.", "success");
        } else {
          triggerToast(status.hasSavedSession ? "Reconectando sesión de WhatsApp..." : "Iniciando motor de WhatsApp...", "info");
          setTimeout(() => fetchStatus(true), 1500);
        }
      } else {
        triggerToast(json?.error || "Error al conectar WhatsApp", "error");
      }
    } catch (e) {
      triggerToast(`Error de conexión: ${e.message}`, "error");
    } finally {
      isConnecting = false;
    }
  }

  async function handleDisconnect() {
    if (!confirm("¿Está seguro de cerrar sesión y desvincular el número de WhatsApp actual?")) {
      return;
    }
    isDisconnecting = true;
    try {
      const res = await fetch(toBackendUrl("/api/whatsapp/disconnect"), { method: "POST" });
      const json = await res.json();
      if (json && json.success) {
        status = json.data;
        availableGroups = [];
        triggerToast("Sesión de WhatsApp cerrada exitosamente", "success");
      }
    } catch (e) {
      triggerToast(`Error al desvincular: ${e.message}`, "error");
    } finally {
      isDisconnecting = false;
    }
  }

  async function fetchGroups() {
    isLoadingGroups = true;
    try {
      const res = await fetch(toBackendUrl("/api/whatsapp/groups"));
      const json = await res.json();
      if (json && json.success) {
        availableGroups = json.data || [];
      }
    } catch (e) {
      console.warn("Error cargando grupos de WhatsApp:", e.message);
    } finally {
      isLoadingGroups = false;
    }
  }

  async function fetchMappings() {
    isLoadingMappings = true;
    try {
      const res = await fetch(toBackendUrl("/api/whatsapp/mappings"));
      const json = await res.json();
      if (json && json.success) {
        mappings = json.data || [];
      }
    } catch (e) {
      console.warn("Error cargando mapeos:", e.message);
    } finally {
      isLoadingMappings = false;
    }
  }

  async function fetchLogs() {
    isLoadingLogs = true;
    try {
      const res = await fetch(toBackendUrl("/api/whatsapp/logs?limit=50"));
      const json = await res.json();
      if (json && json.success) {
        logs = json.data || [];
      }
    } catch (e) {
      console.warn("Error cargando logs:", e.message);
    } finally {
      isLoadingLogs = false;
    }
  }

  function openCreateMappingModal() {
    isEditingMapping = false;
    const defaultSala = availableSalas.length > 0 ? (availableSalas[0].uuid || availableSalas[0].id) : "";
    mappingForm = {
      group_jid: "",
      group_name: "",
      sala_uuid: defaultSala,
      multisala_uuid: "",
      tipo_operaciones: "todo",
      auto_reply: true,
      is_active: true
    };
    isModalOpen = true;
  }

  function openEditMappingModal(m) {
    isEditingMapping = true;
    mappingForm = {
      group_jid: m.group_jid,
      group_name: m.group_name || "",
      sala_uuid: m.sala_uuid || "",
      multisala_uuid: m.multisala_uuid || "",
      tipo_operaciones: m.tipo_operaciones || "todo",
      auto_reply: m.auto_reply !== false,
      is_active: m.is_active !== false
    };
    isModalOpen = true;
  }

  async function handleSaveMapping() {
    if (!mappingForm.group_jid) {
      triggerToast("Seleccione o ingrese el ID/JID del grupo de WhatsApp", "warning");
      return;
    }
    if (!mappingForm.sala_uuid) {
      triggerToast("Seleccione la Sala asignada a este grupo", "warning");
      return;
    }

    // Si seleccionó un grupo de la lista y no tenía nombre, rellenarlo
    const foundGroup = availableGroups.find(g => g.id === mappingForm.group_jid);
    if (foundGroup && !mappingForm.group_name) {
      mappingForm.group_name = foundGroup.name;
    }

    isSavingMapping = true;
    try {
      const res = await fetch(toBackendUrl("/api/whatsapp/mappings"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mappingForm)
      });
      const json = await res.json();
      if (json && json.success) {
        triggerToast("Grupo asociado correctamente a la sala", "success");
        isModalOpen = false;
        await fetchMappings();
      } else {
        triggerToast(json?.error || "Error guardando mapeo", "error");
      }
    } catch (e) {
      triggerToast(`Error: ${e.message}`, "error");
    } finally {
      isSavingMapping = false;
    }
  }

  async function handleDeleteMapping(m) {
    if (!confirm(`¿Eliminar la asociación del grupo "${m.group_name || m.group_jid}"?`)) {
      return;
    }
    try {
      const res = await fetch(toBackendUrl(`/api/whatsapp/mappings/${m.id || m.uuid}`), {
        method: "DELETE"
      });
      const json = await res.json();
      if (json && json.success) {
        triggerToast("Mapeo eliminado", "success");
        await fetchMappings();
      }
    } catch (e) {
      triggerToast(`Error al eliminar: ${e.message}`, "error");
    }
  }

  async function toggleMappingActive(m) {
    try {
      const updated = {
        ...m,
        is_active: !m.is_active
      };
      await fetch(toBackendUrl("/api/whatsapp/mappings"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated)
      });
      m.is_active = !m.is_active;
      triggerToast(m.is_active ? "Grupo activado" : "Grupo pausado", "info");
    } catch (e) {
      triggerToast(`Error: ${e.message}`, "error");
    }
  }

  async function runTestParse() {
    if (!testInput.trim()) {
      testResult = null;
      return;
    }
    isTesting = true;
    try {
      const res = await fetch(toBackendUrl("/api/whatsapp/test-parse"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: testInput })
      });
      const json = await res.json();
      if (json && json.success) {
        testResult = json.data;
      } else {
        testResult = null;
      }
    } catch (e) {
      testResult = null;
    } finally {
      isTesting = false;
    }
  }
</script>

<div class="wa-container">
  <!-- 1. HEADER & STATUS OVERVIEW -->
  <div class="wa-card wa-header-card">
    <div class="wa-header-info">
      <div class="wa-icon-badge">
        <span style="font-size: 28px;">💬</span>
      </div>
      <div>
        <h2 class="wa-title">Automatización de Operaciones vía WhatsApp</h2>
        <p class="wa-subtitle">
          Captura inteligente en tiempo real desde grupos de WhatsApp directo a <strong>Control de Clientes</strong> y <strong>Aportes / Devoluciones</strong>.
        </p>
      </div>
    </div>

    <!-- Status Pill -->
    <div class="wa-status-box">
      {#if status.status === 'connected'}
        <div class="status-pill connected">
          <span class="status-dot green"></span>
          <div>
            <strong>CONECTADO</strong>
            <span class="phone-label">{status.user?.phone || ''} {status.user?.name ? `(${status.user.name})` : ''}</span>
          </div>
        </div>
        <button class="btn-disconnect" on:click={handleDisconnect} disabled={isDisconnecting}>
          {isDisconnecting ? "Desvinculando..." : "🔌 Desvincular Número"}
        </button>
      {:else if status.status === 'waiting_qr'}
        <div class="status-pill waiting">
          <span class="status-dot yellow"></span>
          <div>
            <strong>ESPERANDO ESCANEO DE QR</strong>
            <span class="sub-label">Abre WhatsApp en tu teléfono y escanea</span>
          </div>
        </div>
      {:else if status.status === 'connecting'}
        <div class="status-pill connecting">
          <span class="status-dot blue"></span>
          <div>
            <strong>{status.hasSavedSession ? "RECONECTANDO SESIÓN..." : "INICIANDO MOTOR WHATSAPP..."}</strong>
            <span class="sub-label">{status.hasSavedSession ? "Reanudando conexión guardada" : "Generando credenciales de sesión"}</span>
          </div>
        </div>
        <button class="btn-secondary" on:click={() => handleConnect(true)} disabled={isConnecting} style="margin-left: 6px; font-size: 12px; padding: 6px 12px;">
          ⚡ Forzar
        </button>
      {:else}
        {#if status.isPaused}
          <div class="status-pill waiting" style="border-color: #f59e0b;">
            <span class="status-dot yellow"></span>
            <div>
              <strong>PAUSA PREVENTIVA ACTIVA</strong>
              <span class="sub-label">Enfriamiento de seguridad: reintento en {status.pauseRemainingSec || 60}s</span>
            </div>
          </div>
          <button class="btn-secondary" on:click={() => handleConnect(true)} disabled={isConnecting} style="margin-left: 6px; font-size: 12px; padding: 6px 12px;">
            ⚡ Forzar Reconexión
          </button>
        {:else}
          <div class="status-pill disconnected">
            <span class="status-dot gray"></span>
            <div>
              <strong>{status.hasSavedSession ? "SESIÓN GUARDADA" : "DESCONECTADO"}</strong>
              <span class="sub-label">{status.hasSavedSession ? "Lista para reconectar automáticamente" : "Sin número de WhatsApp asociado"}</span>
            </div>
          </div>
          <button class="btn-connect" on:click={() => handleConnect(false)} disabled={isConnecting}>
            {isConnecting ? "Conectando..." : (status.hasSavedSession ? "⚡ Reconectar Sesión" : "📲 Generar QR / Vincular")}
          </button>
        {/if}
      {/if}
    </div>
  </div>

  <!-- 2. ESTADO CONECTANDO / GENERANDO QR -->
  {#if status.status === 'connecting'}
    <div class="wa-card wa-connecting-banner">
      <div class="spinner-circle"></div>
      <div style="flex: 1;">
        <h4 style="margin: 0; color: #1e40af; font-size: 15px; font-weight: 800;">
          {status.hasSavedSession ? "🔄 Reconectando sesión guardada de WhatsApp..." : "⏳ Generando código QR de WhatsApp en pantalla..."}
        </h4>
        <p style="margin: 4px 0 0 0; color: #475569; font-size: 13px;">
          {status.hasSavedSession 
            ? "El sistema está reactivando tu sesión guardada con WhatsApp. Espera un momento, no necesitas escanear el código QR."
            : "Por favor espera unos segundos. El código QR aparecerá automáticamente aquí abajo. Luego debes escanearlo con la cámara de tu teléfono desde WhatsApp > Dispositivos vinculados."}
        </p>
        {#if status.hasSavedSession}
          <p style="margin: 6px 0 0 0; font-size: 12px; color: #64748b;">
            ¿Deseas desvincular o escanear un nuevo código QR? 
            <button class="btn-link" on:click={handleDisconnect} style="background: none; border: none; color: #ef4444; font-weight: 700; text-decoration: underline; cursor: pointer; padding: 0 4px;">
              Cerrar sesión actual y generar nuevo QR
            </button>
          </p>
        {/if}
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <button class="btn-primary" on:click={() => handleConnect(true)} disabled={isConnecting} style="font-size: 13px;">
          ⚡ Forzar Reconexión
        </button>
        <button class="btn-secondary" on:click={() => fetchStatus()} style="font-size: 13px;">
          🔄 Comprobar Estado
        </button>
      </div>
    </div>
  {/if}

  <!-- 3. QR CODE CARD (SI ESTÁ ESPERANDO QR) -->
  {#if status.status === 'waiting_qr' && status.qr}
    <div class="wa-card wa-qr-card">
      <div class="qr-info">
        <div class="qr-alert-box">
          <span style="font-size: 24px;">📱</span>
          <div>
            <strong style="color: #1e3a8a; font-size: 14px;">Escanear desde tu teléfono móvil:</strong>
            <p style="margin: 3px 0 0 0; font-size: 12.5px; color: #334155; line-height: 1.5;">
              En el teléfono <strong>no</strong> saldrá ningún aviso automático. Debes abrir WhatsApp en tu celular y apuntar con la cámara a este código QR.
            </p>
          </div>
        </div>
        <ol class="qr-steps">
          <li>Abre <strong>WhatsApp</strong> en el teléfono que estará en los grupos del casino.</li>
          <li>Toca el menú de los tres puntos <strong>(⋮) o Ajustes</strong>.</li>
          <li>Selecciona <strong>Dispositivos vinculados</strong>.</li>
          <li>Toca el botón verde <strong>Vincular un dispositivo</strong>.</li>
          <li>Apunta la cámara de tu teléfono móvil a este código QR.</li>
        </ol>
        <div style="display: flex; gap: 10px; align-items: center; margin-top: 14px; flex-wrap: wrap;">
          <button class="btn-primary" on:click={() => fetchStatus()} style="font-size: 13px;">
            🔄 Ya escaneé / Comprobar conexión
          </button>
          <button class="btn-secondary" on:click={() => handleConnect()} style="font-size: 13px;">
            ⚡ Regenerar Nuevo Código QR
          </button>
        </div>
      </div>
      <div class="qr-image-wrapper">
        <img src={status.qr} alt="Código QR WhatsApp" class="qr-img" />
        <span class="qr-caption">Apunta aquí la cámara de WhatsApp de tu celular</span>
      </div>
    </div>
  {/if}

  <!-- 3. PROBADOR INTERACTIVO DE SINTAXIS -->
  <div class="wa-card">
    <div class="section-header">
      <div>
        <h3 class="section-title">🧪 Probador Interactivo de Sintaxis</h3>
        <p class="section-desc">Escribe cualquier mensaje de prueba tal como lo escribirían en el grupo de WhatsApp para ver cómo el sistema lo desglosa.</p>
      </div>
      <span class="syntax-badge">Regex & NLP Engine v1.0</span>
    </div>

    <div class="tester-input-row">
      <input 
        type="text" 
        class="test-input" 
        bind:value={testInput} 
        on:input={runTestParse}
        placeholder="Ej: Compra 200$ USDT Máquinas Abel Gonzáles  |  Aporte 500$ Rango 1 Manuel Barrientos" 
      />
      <button class="btn-test" on:click={runTestParse} disabled={isTesting}>
        Probar Análisis
      </button>
    </div>

    <!-- Píldoras con ejemplos de prueba del diccionario inteligente -->
    <div class="test-examples-row">
      <span class="examples-label">💡 Ejemplos de prueba:</span>
      <button class="pill-btn" type="button" on:click={() => { testInput = "c 100 pdv maquina Willinthon"; runTestParse(); }}>
        c 100 pdv maquina Willinthon
      </button>
      <button class="pill-btn" type="button" on:click={() => { testInput = "Compra 200$ USDT Máquinas Abel"; runTestParse(); }}>
        Compra 200$ USDT Máquinas Abel
      </button>
      <button class="pill-btn" type="button" on:click={() => { testInput = "pago 50 pm mesas Pedro"; runTestParse(); }}>
        pago 50 pm mesas Pedro
      </button>
      <button class="pill-btn" type="button" on:click={() => { testInput = "pago mobil 50 mesas Juan"; runTestParse(); }}>
        pago mobil 50 mesas Juan
      </button>
      <button class="pill-btn" type="button" on:click={() => { testInput = "aporte 200 r1 Carlos"; runTestParse(); }}>
        aporte 200 r1 Carlos
      </button>
      <button class="pill-btn" type="button" on:click={() => { testInput = "aporte 500$ Rango 1 Manuel Barrientos"; runTestParse(); }}>
        aporte 500$ Rango 1 Manuel Barrientos
      </button>
      <button class="pill-btn" type="button" on:click={() => { testInput = "dev 100 ruleta Cesar"; runTestParse(); }}>
        dev 100 ruleta Cesar
      </button>
      <button class="pill-btn" type="button" on:click={() => { testInput = "Aporte 300 fuma Juan"; runTestParse(); }}>
        Aporte 300 fuma Juan
      </button>
    </div>

    {#if testResult && testResult.success}
      <div class="test-preview-grid">
        <div class="preview-item">
          <span class="lbl">TIPO DE OPERACIÓN</span>
          <span class="val bold {testResult.tipo === 'Compra' ? 'text-green' : (testResult.tipo === 'Pago' ? 'text-red' : 'text-blue')}">
            {testResult.tipo}
          </span>
        </div>
        <div class="preview-item">
          <span class="lbl">MONTO</span>
          <span class="val bold">${testResult.monto}</span>
        </div>
        <div class="preview-item">
          <span class="lbl">MÉTODO DE PAGO</span>
          <span class="val">{testResult.metodo}</span>
        </div>
        {#if testResult.modulo === 'aportes_maquinas'}
          <div class="preview-item">
            <span class="lbl">DESTINO</span>
            <span class="val badge-box">Máquinas</span>
          </div>
        {/if}
        {#if testResult.modulo === 'aportes_maquinas'}
          <div class="preview-item">
            <span class="lbl">OPERADOR (EMPLEADO)</span>
            <span class="val highlight">{testResult.operador || 'General'}</span>
          </div>
        {:else}
          <div class="preview-item">
            <span class="lbl">CLIENTE / JUGADOR</span>
            <span class="val highlight">{testResult.cliente}</span>
          </div>
        {/if}
        <div class="preview-item">
          <span class="lbl">MÓDULO DESTINO</span>
          <span class="val text-indigo">
            {testResult.modulo === 'control_clientes' ? 'Control de Clientes' : 'Aportes / Devoluciones'}
          </span>
        </div>
        {#if testResult.rango}
          <div class="preview-item">
            <span class="lbl">RANGO DETECTADO</span>
            <span class="val text-purple">{testResult.rango}</span>
          </div>
        {/if}
        {#if testResult.nota}
          <div class="preview-item">
            <span class="lbl">NOTA / REF</span>
            <span class="val">{testResult.nota}</span>
          </div>
        {/if}
        <div class="preview-item" style="grid-column: 1 / -1; background: #ffffff; padding: 8px 12px; border-radius: 8px; border: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between;">
          <span class="lbl" style="font-size: 11px;">REACCIÓN AL GRUPO:</span>
          <span class="val bold {testResult.check_emoji === '✅' ? 'text-green' : 'text-blue'}" style="font-size: 13.5px;">
            {testResult.check_emoji || '✅'} {testResult.check_label || 'Coincidencia Completa'}
          </span>
        </div>
      </div>
    {:else if testInput.trim()}
      <div class="test-no-match">
        ⚠️ El mensaje no coincide con el formato de transacción (debe incluir: tipo de operación, monto numérico y nombre o método).
      </div>
    {/if}
  </div>

  <!-- 4. MAPEO DE GRUPOS A SALAS -->
  <div class="wa-card">
    <div class="section-header">
      <div>
        <h3 class="section-title">📋 Grupos de WhatsApp Mapeados a Salas</h3>
        <p class="section-desc">
          Asocia los grupos de WhatsApp donde opera cada sala. Cuando un cajero o supervisor escriba en ese grupo, el sistema sabrá a qué sala y libro imputar la transacción.
        </p>
      </div>
      <div style="display: flex; gap: 8px;">
        {#if status.status === 'connected'}
          <button class="btn-secondary" on:click={fetchGroups} disabled={isLoadingGroups}>
            {isLoadingGroups ? "Cargando..." : "🔄 Cargar Grupos de WhatsApp"}
          </button>
        {/if}
        <button class="btn-primary" on:click={openCreateMappingModal}>
          ➕ Mapear Nuevo Grupo
        </button>
      </div>
    </div>

    <!-- Tabla de Mapeos -->
    {#if isLoadingMappings}
      <div class="empty-state">Cargando mapeos de grupos...</div>
    {:else if mappings.length === 0}
      <div class="empty-state">
        <span style="font-size: 32px; display: block; margin-bottom: 8px;">📭</span>
        No hay grupos de WhatsApp asociados todavía. Haz clic en <strong>"Mapear Nuevo Grupo"</strong> para comenzar.
      </div>
    {:else}
      <div class="table-container">
        <table class="wa-table">
          <thead>
            <tr>
              <th>ESTADO</th>
              <th>GRUPO DE WHATSAPP</th>
              <th>SALA ASIGNADA</th>
              <th>OPERACIONES</th>
              <th>CONFIRMACIÓN (CHECK)</th>
              <th style="text-align: right;">ACCIONES</th>
            </tr>
          </thead>
          <tbody>
            {#each mappings as m}
              <tr>
                <td>
                  <button 
                    type="button" 
                    class="toggle-switch {m.is_active ? 'active' : ''}" 
                    on:click={() => toggleMappingActive(m)}
                    title={m.is_active ? 'Pausar este grupo' : 'Activar este grupo'}
                  >
                    <span class="toggle-slider"></span>
                  </button>
                </td>
                <td>
                  <div class="group-cell">
                    <span class="group-name">{m.group_name || 'Grupo Sin Nombre'}</span>
                    <span class="group-jid">{m.group_jid}</span>
                  </div>
                </td>
                <td>
                  <div class="sala-cell-info">
                    <span class="sala-badge">🏛️ {m.sala_nombre || 'Sala no especificada'}</span>
                    {#if m.sub_sala_nombre}
                      <span class="subsala-pill">📍 Sub-sala: {m.sub_sala_nombre}</span>
                    {/if}
                  </div>
                </td>
                <td>
                  {#if m.tipo_operaciones === 'control_clientes'}
                    <span class="op-badge op-clientes" title="Solo procesa Compras y Pagos">💳 Solo Compras y Pagos</span>
                  {:else if m.tipo_operaciones === 'aportes_maquinas'}
                    <span class="op-badge op-aportes" title="Solo procesa Aportes y Devoluciones">🎰 Solo Aportes y Devoluciones</span>
                  {:else}
                    <span class="op-badge op-todo" title="Procesa todas las operaciones">🔄 Todo</span>
                  {/if}
                </td>
                <td>
                  {#if m.auto_reply !== false}
                    <span class="reply-badge enabled">✅ Reacción Check</span>
                  {:else}
                    <span class="reply-badge disabled">Silencioso</span>
                  {/if}
                </td>
                <td style="text-align: right;">
                  <button class="btn-action-edit" on:click={() => openEditMappingModal(m)} title="Editar mapeo">
                    ✏️
                  </button>
                  <button class="btn-action-delete" on:click={() => handleDeleteMapping(m)} title="Eliminar mapeo">
                    🗑️
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <!-- 5. HISTORIAL DE MENSAJES RECIBIDOS (LOGS) -->
  <div class="wa-card">
    <div class="section-header">
      <div>
        <h3 class="section-title">📜 Registro de Mensajes Procesados en Vivo</h3>
        <p class="section-desc">Últimos mensajes capturados desde los grupos de WhatsApp y su resultado en la base de datos.</p>
      </div>
      <button class="btn-secondary" on:click={fetchLogs} disabled={isLoadingLogs}>
        {isLoadingLogs ? "Cargando..." : "🔄 Actualizar Historial"}
      </button>
    </div>

    {#if isLoadingLogs}
      <div class="empty-state">Cargando registros...</div>
    {:else if logs.length === 0}
      <div class="empty-state">
        Aún no se han recibido mensajes en los grupos monitoreados.
      </div>
    {:else}
      <div class="table-container">
        <table class="wa-table logs-table">
          <thead>
            <tr>
              <th>HORA / FECHA</th>
              <th>GRUPO</th>
              <th>REMITENTE</th>
              <th>MENSAJE ORIGINAL</th>
              <th>ESTADO</th>
              <th>DETALLES EXTRAÍDOS</th>
            </tr>
          </thead>
          <tbody>
            {#each logs as log}
              <tr>
                <td class="time-cell">
                  {new Date(log.created_at).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  <span class="sub-date">{new Date(log.created_at).toLocaleDateString('es-VE')}</span>
                </td>
                <td>
                  <strong>{log.group_name || 'Grupo'}</strong>
                </td>
                <td>
                  <span class="sender-cell">{log.sender_name || 'Usuario'}</span>
                </td>
                <td class="raw-message-cell">
                  <code>"{log.raw_message}"</code>
                </td>
                <td>
                  {#if log.status === 'procesado'}
                    <span class="status-chip success">✅ Registrado</span>
                  {:else if log.status === 'procesado_por_verificar'}
                    <span class="status-chip info" title={log.error_message || 'Verificar datos'}>☑️ Por Verificar</span>
                    {#if log.error_message}
                      <span class="sub-obs">{log.error_message}</span>
                    {/if}
                  {:else if log.status === 'sin_libro_activo'}
                    <span class="status-chip warning">⚠️ Sin Libro Abierto</span>
                  {:else}
                    <span class="status-chip error">❌ Error: {log.error_message || 'Fallo'}</span>
                  {/if}
                </td>
                <td class="parsed-cell">
                  {#if log.parsed_data}
                    <span class="parsed-pill">
                      {#if log.parsed_data.modulo === 'aportes_maquinas'}
                        {log.parsed_data.tipo} ${log.parsed_data.monto} | {log.parsed_data.rango || 'Sin rango'} | Operador: {log.parsed_data.operador || 'General'}
                      {:else}
                        {log.parsed_data.tipo} ${log.parsed_data.monto} | {log.parsed_data.metodo || 'General'} | Cliente: {log.parsed_data.cliente || 'General'}
                      {/if}
                    </span>
                  {:else}
                    <span class="text-muted">-</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

<!-- MODAL MAPEAR / EDITAR GRUPO -->
{#if isModalOpen}
  <div class="modal-overlay" on:click={() => (isModalOpen = false)}>
    <div class="modal-box" on:click|stopPropagation>
      <div class="modal-header">
        <h3 class="modal-title">
          {isEditingMapping ? "✏️ Editar Mapeo de Grupo" : "➕ Mapear Grupo de WhatsApp a Sala"}
        </h3>
        <button class="modal-close" on:click={() => (isModalOpen = false)}>✕</button>
      </div>

      <div class="modal-body">
        <!-- Selector de Grupo -->
        <div class="form-group">
          <label class="form-label">Seleccionar Grupo de WhatsApp *</label>
          {#if availableGroups.length > 0}
            <select 
              class="form-select" 
              bind:value={mappingForm.group_jid}
              on:change={(e) => {
                const found = availableGroups.find(g => g.id === e.target.value);
                if (found) mappingForm.group_name = found.name;
              }}
            >
              <option value="">-- Seleccionar Grupo Detectado en WhatsApp --</option>
              {#each availableGroups as g}
                <option value={g.id}>{g.name} ({g.participantsCount} miembros)</option>
              {/each}
            </select>
          {:else}
            <input 
              type="text" 
              class="form-input" 
              bind:value={mappingForm.group_jid} 
              placeholder="Ej: 12036302482939@g.us (JID de WhatsApp)" 
            />
            <span class="field-hint">
              {status.status === 'connected' ? 'Cargando grupos participantes...' : 'Vincula WhatsApp arriba para listar tus grupos automáticamente, o ingresa el JID manual.'}
            </span>
          {/if}
        </div>

        <!-- Nombre amigable del Grupo -->
        <div class="form-group">
          <label class="form-label">Nombre Identificador del Grupo</label>
          <input 
            type="text" 
            class="form-input" 
            bind:value={mappingForm.group_name} 
            placeholder="Ej: Caja Central Sala Principal" 
          />
        </div>

        <!-- Sala Asignada (Solo salas operativas, sin galpones) -->
        <div class="form-group">
          <label class="form-label">Sala a la que pertenece este Grupo *</label>
          <select class="form-select" value={mappingForm.sala_uuid} on:change={handleSalaChange}>
            <option value="">-- Seleccionar Sala --</option>
            {#each availableSalas as s}
              <option value={s.uuid || s.id}>{s.nombre || s.nombre_comercial}</option>
            {/each}
          </select>
          <span class="field-hint">Las transacciones escritas en este grupo se registrarán en el Libro Diario activo de esta sala.</span>
        </div>

        <!-- Sub-sala / Sucursal (Multisala) -->
        {#if currentSubsalas && currentSubsalas.length > 0}
          <div class="form-group subsala-field-box">
            <label class="form-label">
              <span class="multisala-badge-tag">Multisala Activo</span> Sub-sala / Sucursal Específica (Opcional)
            </label>
            <select class="form-select" bind:value={mappingForm.multisala_uuid}>
              <option value="">-- Toda la Sala (Sin sub-sala específica) --</option>
              {#each currentSubsalas as sub}
                <option value={sub.uuid}>📍 {sub.nombre}</option>
              {/each}
            </select>
            <span class="field-hint">Esta sala cuenta con sucursales o salas hijas configuradas. Selecciona si este grupo corresponde a una en particular.</span>
          </div>
        {/if}

        <!-- Tipo de Operaciones -->
        <div class="form-group">
          <label class="form-label">Operaciones a Procesar en este Grupo *</label>
          <select class="form-select" bind:value={mappingForm.tipo_operaciones}>
            <option value="todo">🔄 Todo (Compras, Pagos, Aportes y Devoluciones)</option>
            <option value="control_clientes">💳 Solo Compras y Pagos (Control de Clientes)</option>
            <option value="aportes_maquinas">🎰 Solo Aportes y Devoluciones (Máquinas)</option>
          </select>
          <span class="field-hint">Permite definir el propósito del grupo: si este grupo de WhatsApp es solo para clientes o solo para aportes/devoluciones de máquinas, el bot solo interpretará lo que corresponda.</span>
        </div>

        <!-- Opciones adicionales -->
        <div class="form-row">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={mappingForm.auto_reply} />
            <span>Reaccionar con check (✅ chulito) al mensaje del usuario al procesar cada operación</span>
          </label>
        </div>

        <div class="form-row">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={mappingForm.is_active} />
            <span>Monitoreo Activo (procesar mensajes inmediatamente)</span>
          </label>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" on:click={() => (isModalOpen = false)}>
          Cancelar
        </button>
        <button class="btn-primary" on:click={handleSaveMapping} disabled={isSavingMapping}>
          {isSavingMapping ? "Guardando..." : (isEditingMapping ? "Actualizar Mapeo" : "Guardar Mapeo")}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .wa-container {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 4px 0 30px 0;
  }

  .wa-card {
    background: #ffffff;
    border-radius: 14px;
    border: 1px solid #e2e8f0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
    padding: 24px;
  }

  .wa-header-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 20px;
    background: linear-gradient(135deg, #ffffff, #f8fafc);
  }

  .wa-header-info {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .wa-icon-badge {
    width: 54px;
    height: 54px;
    border-radius: 12px;
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .wa-title {
    margin: 0;
    font-size: 20px;
    font-weight: 800;
    color: #0f172a;
  }

  .wa-subtitle {
    margin: 4px 0 0 0;
    font-size: 13.5px;
    color: #64748b;
  }

  .wa-status-box {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .status-pill {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    border-radius: 10px;
    font-size: 13px;
  }

  .status-pill.connected {
    background: #ecfdf5;
    border: 1px solid #10b981;
    color: #065f46;
  }

  .status-pill.waiting {
    background: #fffbeb;
    border: 1px solid #f59e0b;
    color: #92400e;
  }

  .status-pill.connecting {
    background: #eff6ff;
    border: 1px solid #3b82f6;
    color: #1e40af;
  }

  .status-pill.disconnected {
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    color: #475569;
  }

  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .status-dot.green { background: #10b981; box-shadow: 0 0 8px #10b981; }
  .status-dot.yellow { background: #f59e0b; animation: pulse 1.5s infinite; }
  .status-dot.blue { background: #3b82f6; animation: pulse 1s infinite; }
  .status-dot.gray { background: #94a3b8; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .phone-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    opacity: 0.9;
  }

  .sub-label {
    display: block;
    font-size: 11px;
    opacity: 0.8;
  }

  /* BOTONES */
  .btn-connect {
    padding: 10px 18px;
    background: #10b981;
    color: #ffffff;
    font-size: 13.5px;
    font-weight: 700;
    border: none;
    border-radius: 9px;
    cursor: pointer;
    box-shadow: 0 4px 10px rgba(16, 185, 129, 0.3);
    transition: all 0.15s ease;
  }
  .btn-connect:hover { background: #059669; }

  .btn-disconnect {
    padding: 9px 15px;
    background: #fef2f2;
    color: #dc2626;
    border: 1px solid #fecaca;
    font-size: 12.5px;
    font-weight: 700;
    border-radius: 8px;
    cursor: pointer;
  }
  .btn-disconnect:hover { background: #fee2e2; }

  .btn-primary {
    padding: 10px 18px;
    background: #2563eb;
    color: #ffffff;
    font-size: 13.5px;
    font-weight: 700;
    border: none;
    border-radius: 9px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn-primary:hover { background: #1d4ed8; }

  .btn-secondary {
    padding: 10px 16px;
    background: #f1f5f9;
    color: #334155;
    border: 1px solid #cbd5e1;
    font-size: 13px;
    font-weight: 600;
    border-radius: 9px;
    cursor: pointer;
  }
  .btn-secondary:hover { background: #e2e8f0; }

  .wa-connecting-banner {
    display: flex;
    align-items: center;
    gap: 16px;
    background: #eff6ff;
    border: 1.5px dashed #60a5fa;
    padding: 18px 24px;
    border-radius: 12px;
  }

  .spinner-circle {
    width: 28px;
    height: 28px;
    border: 3px solid #bfdbfe;
    border-top-color: #2563eb;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .qr-alert-box {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 16px;
  }

  /* QR CARD */
  .wa-qr-card {
    display: flex;
    align-items: center;
    justify-content: space-around;
    gap: 30px;
    flex-wrap: wrap;
    background: #f8fafc;
    border: 2px dashed #93c5fd;
  }

  .qr-info {
    max-width: 480px;
  }

  .qr-info h3 {
    margin: 0 0 12px 0;
    color: #1e3a8a;
    font-size: 18px;
  }

  .qr-steps {
    margin: 0 0 16px 0;
    padding-left: 20px;
    color: #334155;
    line-height: 1.7;
    font-size: 13.5px;
  }

  .qr-note {
    font-size: 12px;
    color: #64748b;
    margin-bottom: 16px;
  }

  .qr-image-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 16px;
    background: #ffffff;
    border-radius: 16px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  }

  .qr-img {
    width: 240px;
    height: 240px;
    display: block;
    border-radius: 8px;
  }

  .qr-caption {
    margin-top: 10px;
    font-size: 11.5px;
    font-weight: 600;
    color: #64748b;
  }

  /* SECTION HEADER */
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 18px;
    flex-wrap: wrap;
    gap: 12px;
  }

  .section-title {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: #0f172a;
  }

  .section-desc {
    margin: 4px 0 0 0;
    font-size: 13px;
    color: #64748b;
  }

  .syntax-badge {
    background: #f1f5f9;
    color: #475569;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
  }

  /* TESTER */
  .tester-input-row {
    display: flex;
    gap: 10px;
    margin-bottom: 16px;
  }

  .test-input {
    flex: 1;
    padding: 11px 14px;
    border-radius: 9px;
    border: 1px solid #cbd5e1;
    font-size: 14px;
    color: #0f172a;
    background: #f8fafc;
  }
  .test-input:focus {
    background: #ffffff;
    border-color: #3b82f6;
    outline: none;
  }

  .btn-test {
    padding: 11px 20px;
    background: #0f172a;
    color: #ffffff;
    border: none;
    border-radius: 9px;
    font-size: 13.5px;
    font-weight: 700;
    cursor: pointer;
  }

  .test-examples-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: -6px;
    margin-bottom: 14px;
  }

  .examples-label {
    font-size: 11.5px;
    font-weight: 700;
    color: #64748b;
  }

  .pill-btn {
    background: #f1f5f9;
    color: #334155;
    border: 1px solid #cbd5e1;
    border-radius: 9999px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .pill-btn:hover {
    background: #e2e8f0;
    color: #0f172a;
    border-color: #94a3b8;
  }

  .test-preview-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
    background: #f8fafc;
    padding: 16px;
    border-radius: 10px;
    border: 1px solid #e2e8f0;
  }

  .preview-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .preview-item .lbl {
    font-size: 10.5px;
    font-weight: 700;
    color: #64748b;
  }

  .preview-item .val {
    font-size: 13.5px;
    color: #1e293b;
  }

  .preview-item .bold { font-weight: 800; }
  .preview-item .highlight { font-weight: 800; color: #0284c7; }
  .badge-box { background: #e0e7ff; color: #3730a3; padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 12px; display: inline-block; width: fit-content; }
  .text-green { color: #16a34a; }
  .text-red { color: #dc2626; }
  .text-blue { color: #2563eb; }
  .text-indigo { color: #4338ca; font-weight: 700; }
  .text-purple { color: #7c3aed; font-weight: 700; }

  .test-no-match {
    padding: 12px 16px;
    background: #fffbeb;
    border: 1px solid #fde68a;
    color: #92400e;
    border-radius: 8px;
    font-size: 13px;
  }

  /* TABLAS */
  .table-container {
    overflow-x: auto;
  }

  .wa-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  .wa-table th {
    background: #f8fafc;
    padding: 10px 14px;
    text-align: left;
    font-weight: 700;
    color: #475569;
    border-bottom: 2px solid #e2e8f0;
    font-size: 11.5px;
  }

  .wa-table td {
    padding: 12px 14px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: middle;
  }

  .group-cell {
    display: flex;
    flex-direction: column;
  }

  .group-name {
    font-weight: 700;
    color: #0f172a;
  }

  .group-jid {
    font-size: 11px;
    color: #94a3b8;
  }

  .sala-cell-info {
    display: flex;
    flex-direction: column;
    gap: 5px;
    align-items: flex-start;
  }

  .sala-badge {
    background: #f0fdf4;
    color: #166534;
    padding: 4px 10px;
    border-radius: 6px;
    font-weight: 700;
    font-size: 12px;
    border: 1px solid #bbf7d0;
    display: inline-block;
  }

  .subsala-pill {
    background: #eff6ff;
    color: #1d4ed8;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
    border: 1px solid #bfdbfe;
    display: inline-block;
  }

  .subsala-field-box {
    background: #f8fafc;
    border: 1.5px dashed #cbd5e1;
    border-radius: 10px;
    padding: 12px 14px;
  }

  .multisala-badge-tag {
    background: #e0e7ff;
    color: #4338ca;
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 10.5px;
    font-weight: 800;
    margin-right: 6px;
  }

  .modulo-badge {
    padding: 4px 8px;
    border-radius: 6px;
    font-weight: 600;
    font-size: 12px;
  }
  .modulo-badge.control_clientes { background: #e0f2fe; color: #0369a1; }
  .modulo-badge.aportes_maquinas { background: #f3e8ff; color: #6b21a8; }

  .op-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 700;
    white-space: nowrap;
  }
  .op-badge.op-todo {
    background: #f1f5f9;
    color: #334155;
    border: 1px solid #cbd5e1;
  }
  .op-badge.op-clientes {
    background: #e0f2fe;
    color: #0369a1;
    border: 1px solid #bae6fd;
  }
  .op-badge.op-aportes {
    background: #f3e8ff;
    color: #7e22ce;
    border: 1px solid #e9d5ff;
  }

  .caja-badge {
    padding: 3px 8px;
    border-radius: 5px;
    font-weight: 700;
    font-size: 11.5px;
  }
  .caja-badge.Mesas { background: #fef3c7; color: #92400e; }
  .caja-badge.Máquinas { background: #e2e8f0; color: #334155; }

  .reply-badge {
    font-size: 11.5px;
    font-weight: 600;
  }
  .reply-badge.enabled { color: #16a34a; }
  .reply-badge.disabled { color: #94a3b8; }

  .toggle-switch {
    width: 36px;
    height: 20px;
    background: #cbd5e1;
    border-radius: 20px;
    border: none;
    cursor: pointer;
    position: relative;
    padding: 0;
    transition: background 0.2s ease;
  }
  .toggle-switch.active { background: #10b981; }

  .toggle-slider {
    width: 16px;
    height: 16px;
    background: #ffffff;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform 0.2s ease;
  }
  .toggle-switch.active .toggle-slider { transform: translateX(16px); }

  .btn-action-edit, .btn-action-delete {
    padding: 6px 10px;
    border: 1px solid #e2e8f0;
    background: #f8fafc;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.15s ease;
  }
  .btn-action-edit:hover { background: #e0f2fe; border-color: #7dd3fc; }
  .btn-action-delete:hover { background: #fee2e2; border-color: #fca5a5; }

  /* LOGS */
  .logs-table td { font-size: 12.5px; }
  .time-cell { font-weight: 700; color: #334155; white-space: nowrap; }
  .sub-date { display: block; font-size: 10.5px; font-weight: 400; color: #94a3b8; }
  .sender-cell { font-weight: 600; color: #475569; }
  .raw-message-cell code { background: #f1f5f9; padding: 3px 6px; border-radius: 4px; font-size: 12px; color: #0f172a; }
  
  .status-chip {
    padding: 3px 8px;
    border-radius: 5px;
    font-weight: 700;
    font-size: 11.5px;
    white-space: nowrap;
  }
  .status-chip.success { background: #ecfdf5; color: #065f46; }
  .status-chip.info { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
  .status-chip.warning { background: #fffbeb; color: #92400e; }
  .status-chip.error { background: #fef2f2; color: #991b1b; }
  .sub-obs { display: block; font-size: 10.5px; color: #64748b; font-weight: 500; margin-top: 2px; max-width: 180px; white-space: normal; }

  .parsed-pill {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11.5px;
    color: #334155;
    font-weight: 600;
  }

  .empty-state {
    padding: 30px;
    text-align: center;
    color: #64748b;
    font-size: 13.5px;
  }

  /* MODAL */
  .modal-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(15, 23, 42, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 20px;
  }

  .modal-box {
    background: #ffffff;
    border-radius: 16px;
    width: 100%;
    max-width: 540px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 18px 24px;
    border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
  }

  .modal-title {
    margin: 0;
    font-size: 17px;
    font-weight: 800;
    color: #0f172a;
  }

  .modal-close {
    background: transparent;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: #94a3b8;
  }

  .modal-body {
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-label {
    font-size: 12.5px;
    font-weight: 700;
    color: #334155;
  }

  .form-input, .form-select {
    padding: 10px 14px;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    font-size: 13.5px;
    color: #0f172a;
    background: #ffffff;
  }

  .field-hint {
    font-size: 11.5px;
    color: #64748b;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: #334155;
    cursor: pointer;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 16px 24px;
    border-top: 1px solid #e2e8f0;
    background: #f8fafc;
  }
</style>

