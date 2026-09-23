<script>
  import { createEventDispatcher } from 'svelte';
  import { masterSalasStore, masterDispositivosStore, loadMasterStoresFromBackend } from '../../controllers/master.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { toEmployeePhotoUrl } from '../../config/api.config.js';
  import {
    isTauriWindows,
    localGetDeviceUsers,
    localAddUser,
    localSetupCard,
    localUploadFace,
    localDeleteUser,
    generarCardNoDesdeCedula,
    getCedulaVariants,
    localPingDevice,
    localInjectHttpListener
  } from '../../services/tauriIsapi.service.js';

  export let isOpen = false;
  export let assignedSalaUuids = [];
  export let assignedSalaIds = assignedSalaUuids;

  const dispatch = createEventDispatcher();
  const isWindows = isTauriWindows();

  // Asegurar carga de dispositivos al abrir si están vacíos
  $: if (isOpen && (!$masterDispositivosStore || $masterDispositivosStore.length === 0)) {
    loadMasterStoresFromBackend();
  }

  // Filtrar solo salas Tipo 1 (grupo_id === 1) asignadas al usuario
  $: salasTipo1 = ($masterSalasStore || []).filter(s => {
    const isTipo1 = Number(s.grupo_id) === 1 || !s.grupo_id;
    if (!isTipo1) return false;
    const allowed = assignedSalaUuids && assignedSalaUuids.length > 0 ? assignedSalaUuids : assignedSalaIds;
    if (!allowed || allowed.length === 0) return true;
    return allowed.includes(s.uuid) || allowed.includes(s.id);
  });

  // Lista de biométricos disponibles: "[Nombre Biométrico] ( [Nombre Sala] )" (sin nombre comercial)
  $: biometricosDisponibles = ($masterDispositivosStore || []).map(dev => {
    const salaId = dev.sala_uuid || dev.sala_id;
    const sala = ($masterSalasStore || []).find(s => String(s.uuid || s.id) === String(salaId));

    const rawDevName = (dev.nombre || 'Biométrico').trim();
    // Limpiar paréntesis redundantes si el nombre ya traía algo como " ( Monagas )"
    const cleanDevName = rawDevName.replace(/\s*\([^)]*\)\s*$/, '').trim() || rawDevName;
    const salaNombre = sala ? sala.nombre : ''; // ESTRICTAMENTE sala.nombre, NUNCA nombre_comercial
    const selectLabel = salaNombre ? `${cleanDevName} ( ${salaNombre} )` : cleanDevName;

    return {
      ...dev,
      uuid: dev.uuid || dev.id,
      id: dev.uuid || dev.id,
      cleanNombre: cleanDevName,
      salaObj: sala,
      salaNombre,
      selectLabel
    };
  }).filter(dev => {
    if (!dev.salaObj) return false;
    const isTipo1 = Number(dev.salaObj.grupo_id) === 1 || !dev.salaObj.grupo_id;
    if (!isTipo1) return false;
    const allowed = assignedSalaUuids && assignedSalaUuids.length > 0 ? assignedSalaUuids : assignedSalaIds;
    if (!allowed || allowed.length === 0) return true;
    return allowed.includes(dev.salaObj.uuid) || allowed.includes(dev.salaObj.id) || allowed.includes(String(dev.salaObj.uuid)) || allowed.includes(String(dev.salaObj.id));
  });

  let selectedDispositivoId = null;
  let selectedSalaId = null;

  // Mapa de alcance en red local: { [devId]: true | false }
  let reachabilityMap = {};
  let isCheckingReachability = false;
  let hasCheckedReachability = false;

  async function checkReachabilityAllDevices(force = false) {
    if (!isWindows || !biometricosDisponibles || biometricosDisponibles.length === 0) return;
    if (isCheckingReachability && !force) return;

    isCheckingReachability = true;
    try {
      const pingPromises = biometricosDisponibles.map(async (dev) => {
        const devId = dev.uuid || dev.id;
        const ip = (dev.ip_local || '').trim();
        if (!ip || ip === '—') {
          reachabilityMap[devId] = false;
          reachabilityMap = { ...reachabilityMap };
          return;
        }
        try {
          const ok = await localPingDevice(ip, 1200);
          reachabilityMap[devId] = Boolean(ok);
        } catch (e) {
          reachabilityMap[devId] = false;
        }
        reachabilityMap = { ...reachabilityMap };
      });

      await Promise.allSettled(pingPromises);
      reachabilityMap = { ...reachabilityMap };
      hasCheckedReachability = true;

      // Auto-seleccionar el primer equipo Hikvision alcanzable si el actual no lo es
      const isCurrentOk = selectedDispositivoId && reachabilityMap[selectedDispositivoId] === true;
      if (!isCurrentOk) {
        const firstReachable = biometricosDisponibles.find(d => reachabilityMap[d.uuid || d.id] === true);
        if (firstReachable) {
          selectedDispositivoId = firstReachable.uuid || firstReachable.id;
          selectedSalaId = firstReachable.sala_uuid || firstReachable.sala_id;
        }
      }
    } finally {
      isCheckingReachability = false;
    }
  }

  // Verificar alcance de biométricos al abrir el modal
  $: if (isOpen && isWindows && biometricosDisponibles.length > 0 && !hasCheckedReachability && !isCheckingReachability) {
    checkReachabilityAllDevices();
  }

  $: if (!isOpen) {
    hasCheckedReachability = false;
  }

  $: if (biometricosDisponibles.length > 0 && (!selectedDispositivoId || !biometricosDisponibles.some(d => (d.uuid || d.id) === selectedDispositivoId))) {
    const firstReachable = biometricosDisponibles.find(d => reachabilityMap[d.uuid || d.id] === true);
    selectedDispositivoId = firstReachable ? (firstReachable.uuid || firstReachable.id) : (biometricosDisponibles[0].uuid || biometricosDisponibles[0].id);
  }

  $: {
    const selDev = biometricosDisponibles.find(d => (d.uuid || d.id) === selectedDispositivoId);
    if (selDev) {
      selectedSalaId = selDev.sala_uuid || selDev.sala_id;
    }
  }

  function handleSelectDispositivoChange(newDevId) {
    if (reachabilityMap[newDevId] === false) {
      triggerToast('Este biométrico no es alcanzable en la red local actual.', 'warning');
      return;
    }
    selectedDispositivoId = newDevId;
    const selDev = biometricosDisponibles.find(d => (d.uuid || d.id) === newDevId);
    if (selDev) {
      const devSalaId = selDev.sala_uuid || selDev.sala_id;
      // Si la sala ya fue auditada, pasamos a enfocar el dispositivo en su pestaña
      if (auditResult && String(auditResult.sala?.id || auditResult.sala?.uuid) === String(devSalaId)) {
        const foundIdx = (auditResult.devices || []).findIndex(d => (d.uuid || d.id) === newDevId);
        if (foundIdx !== -1) {
          selectedDeviceIndex = foundIdx;
          return;
        }
      }
      // Si es de otra sala, reseteamos la auditoría
      auditResult = null;
    }
  }

  // Inyección DIRECTA de HTTP Listener por ISAPI Local (Tauri en Windows)
  let isInjectingListener = false;

  async function handleDirectInjectListener() {
    if (!currentDevice || isInjectingListener) return;
    if (!isWindows) {
      triggerToast('La inyección directa por IP local solo está disponible en la app de escritorio en Windows.', 'warning');
      return;
    }

    const host = (currentDevice.ip_local || '').trim();
    if (!host || host === '—') {
      triggerToast('El dispositivo seleccionado no tiene una IP local configurada.', 'error');
      return;
    }

    isInjectingListener = true;
    triggerToast(`⏳ Inyectando HTTP Listener directamente en '${currentDevice.nombre}' (${host})...`, 'info');

    try {
      let configOptions = {
        ip_domain: 'wisi.space',
        url: '/api/attlogs/sync',
        port: 443,
        protocol: 'HTTPS'
      };

      try {
        const resConf = await fetch('/api/master/configuracion');
        const jsonConf = await resConf.json();
        if (jsonConf?.success && jsonConf?.data) {
          const d = jsonConf.data;
          configOptions = {
            ip_domain: d.isapi_ip_domain || 'wisi.space',
            url: d.isapi_url || '/api/attlogs/sync',
            port: Number(d.isapi_port) || 443,
            protocol: d.isapi_protocol || 'HTTPS'
          };
        }
      } catch (e) {
        console.warn('Usando valores por defecto para inyección ISAPI:', e);
      }

      // Inyectar directamente a la IP Local del biométrico vía Tauri ISAPI
      const res = await localInjectHttpListener(
        host,
        currentDevice.usuario || 'admin',
        currentDevice.clave || currentDevice.password || '',
        configOptions
      );

      if (res && (res.ok || res.status === 200)) {
        triggerToast(`⚡ ¡HTTP Listener inyectado exitosamente en ${currentDevice.nombre} (${host})!`, 'success');
      } else {
        const detail = res?.data?.subStatusCode || res?.data?.statusString || res?.statusText || 'Error en respuesta ISAPI';
        triggerToast(`❌ Error al inyectar HTTP Listener en ${host}: ${detail}`, 'error');
      }
    } catch (err) {
      console.error('Error inyectando HTTP Listener:', err);
      triggerToast(`❌ Error al conectar con el biométrico en ${host}: ${err.message}`, 'error');
    } finally {
      isInjectingListener = false;
    }
  }

  let isAuditing = false;
  let auditResult = null;
  let selectedDeviceIndex = 0;
  let activeTab = 'sincronizados'; // 'sincronizados' | 'faltan' | 'sobran'

  // Contexto de empleados obtenidos del servidor
  let contextActiveEmployees = [];
  let contextAllSystemEmployees = [];

  // Búsquedas por pestaña
  let searchSync = '';
  let searchFaltan = '';
  let searchSobran = '';

  // Selecciones masivas
  // Selecciones masivas y tracking de acciones individuales
  let selectedSyncIds = new Set();
  let selectedFaltanIds = new Set();
  let selectedSobranNos = new Set();
  let actionTarget = 'both'; // 'both' | 'bio' | 'panel'
  let isExecutingAction = false;
  let updatingEmpIds = new Set();
  let addingEmpIds = new Set();
  let deletingEmpNos = new Set();
  let updateProgress = { current: 0, total: 0 };

  $: currentDevice = auditResult?.devices?.[selectedDeviceIndex] || null;

  // Listas filtradas reactivas
  $: filteredSincronizados = (currentDevice?.sincronizados || []).filter(emp => {
    if (!searchSync.trim()) return true;
    const q = searchSync.trim().toLowerCase();
    return (
      (emp.nombre && emp.nombre.toLowerCase().includes(q)) ||
      (emp.cedula && emp.cedula.toLowerCase().includes(q)) ||
      (emp.cargo_nombre && emp.cargo_nombre.toLowerCase().includes(q)) ||
      (emp.departamento_nombre && emp.departamento_nombre.toLowerCase().includes(q))
    );
  });

  $: filteredFaltan = (currentDevice?.faltan || []).filter(emp => {
    if (!searchFaltan.trim()) return true;
    const q = searchFaltan.trim().toLowerCase();
    return (
      (emp.nombre && emp.nombre.toLowerCase().includes(q)) ||
      (emp.cedula && emp.cedula.toLowerCase().includes(q)) ||
      (emp.cargo_nombre && emp.cargo_nombre.toLowerCase().includes(q)) ||
      (emp.departamento_nombre && emp.departamento_nombre.toLowerCase().includes(q))
    );
  });

  $: filteredSobran = (currentDevice?.sobran || []).filter(u => {
    if (!searchSobran.trim()) return true;
    const q = searchSobran.trim().toLowerCase();
    return (
      (u.employeeNo && u.employeeNo.toLowerCase().includes(q)) ||
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.systemStatus && u.systemStatus.toLowerCase().includes(q)) ||
      (u.systemEmployeeName && u.systemEmployeeName.toLowerCase().includes(q))
    );
  });

  // Resetear selecciones y búsquedas al cambiar de dispositivo
  $: if (selectedDeviceIndex !== undefined) {
    selectedSyncIds = new Set();
    selectedFaltanIds = new Set();
    selectedSobranNos = new Set();
    searchSync = '';
    searchFaltan = '';
    searchSobran = '';
  }

  // Normaliza nombres ignorando acentos y espacios múltiples para cotejo limpio
  function normalizeName(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  // Compara usuarios físicos del biométrico contra empleados del sistema usando la cédula EXACTA
  function reconcileUsers(bioUsers, activeEmployees, allSystemEmployees, currentSala = null) {
    const sincronizados = [];
    const faltan = [];
    const matchedBioIndices = new Set();

    for (const emp of activeEmployees) {
      const exactCedula = String(emp.cedula || '').trim().toUpperCase();

      // Cotejo EXACTO de cédula contra el biométrico (si en sistema está con V y en equipo sin V, son 2 registros totalmente distintos)
      const matchIdx = bioUsers.findIndex((u, idx) => {
        if (matchedBioIndices.has(idx)) return false;
        return String(u.employeeNo || '').trim().toUpperCase() === exactCedula;
      });

      if (matchIdx !== -1) {
        matchedBioIndices.add(matchIdx);
        const bioUser = bioUsers[matchIdx];

        const nameInDev = String(bioUser.name || '').trim();
        const nameInSys = String(emp.nombre || '').trim();
        const nameDiffers = Boolean(nameInDev && nameInSys && normalizeName(nameInDev) !== normalizeName(nameInSys));
        const hasFaceOnDevice = Number(bioUser.numOfFace || bioUser.numOfFaces || 0) > 0 || (bioUser.userVerifyMode === 'face') || !!emp.hasFaceOnDevice;
        const hasCardOnDevice = Number(bioUser.numOfCard || bioUser.numOfCards || 0) > 0 || !!emp.hasCardOnDevice;

        sincronizados.push({
          ...emp,
          bioUser,
          deviceUser: {
            employeeNo: bioUser.employeeNo,
            name: bioUser.name,
            numOfCard: bioUser.numOfCard || 0,
            numOfFace: bioUser.numOfFace || 0
          },
          nameDiffers,
          hasFaceOnDevice,
          hasCardOnDevice
        });
      } else {
        faltan.push(emp);
      }
    }

    const sobran = [];
    bioUsers.forEach((u, idx) => {
      if (!matchedBioIndices.has(idx)) {
        const uNo = String(u.employeeNo || '').trim().toUpperCase();

        // Buscar coincidencia EXACTA en todos los empleados del sistema
        const sysEmp = (allSystemEmployees || []).find(e => {
          return String(e.cedula || '').trim().toUpperCase() === uNo;
        });

        // 🛡️ REGLA FUNDAMENTAL: Si el empleado está ACTIVO y pertenece a esta misma sala,
        // ¡NUNCA DEBE SER CLASIFICADO COMO "SOBRANTE"! Pertenece a este biométrico y se incorpora a Sincronizados.
        const currentSalaUuid = String(currentSala?.uuid || currentSala?.id || '').trim().toLowerCase();
        const currentSalaNombre = String(currentSala?.nombre || '').trim().toLowerCase();
        const empSalaUuid = String(sysEmp?.sala_uuid || sysEmp?.sala_id || '').trim().toLowerCase();
        const empSalaNombre = String(sysEmp?.sala_nombre || '').trim().toLowerCase();

        const isMismaSala = Boolean(
          sysEmp?.activo && (
            (currentSalaUuid && empSalaUuid && currentSalaUuid === empSalaUuid) ||
            (currentSalaNombre && empSalaNombre && currentSalaNombre === empSalaNombre)
          )
        );

        if (isMismaSala) {
          const nameInDev = String(u.name || '').trim();
          const nameInSys = String(sysEmp.nombre || '').trim();
          const nameDiffers = Boolean(nameInDev && nameInSys && normalizeName(nameInDev) !== normalizeName(nameInSys));
          const hasFaceOnDevice = Number(u.numOfFace || u.numOfFaces || 0) > 0 || (u.userVerifyMode === 'face') || !!sysEmp.hasFaceOnDevice;
          const hasCardOnDevice = Number(u.numOfCard || u.numOfCards || 0) > 0 || !!sysEmp.hasCardOnDevice;

          sincronizados.push({
            ...sysEmp,
            bioUser: u,
            deviceUser: {
              employeeNo: u.employeeNo,
              name: u.name,
              numOfCard: u.numOfCard || 0,
              numOfFace: u.numOfFace || 0
            },
            nameDiffers,
            hasFaceOnDevice,
            hasCardOnDevice
          });

          // Si por alguna razón estaba registrado en faltan, removerlo para evitar duplicidad
          const faltanIdx = faltan.findIndex(f => String(f.cedula || '').trim().toUpperCase() === uNo);
          if (faltanIdx !== -1) {
            faltan.splice(faltanIdx, 1);
          }
          return;
        }

        sobran.push({
          employeeNo: u.employeeNo,
          name: u.name || 'Sin nombre',
          numOfFace: Number(u.numOfFace || u.numOfFaces || 0),
          numOfCard: Number(u.numOfCard || u.numOfCards || 0),
          systemStatus: sysEmp ? (sysEmp.activo ? `Activo en ${sysEmp.sala_nombre || 'otra sala'}` : `Desincorporado (${sysEmp.motivo_desincorporacion || 'Inactivo'})`) : 'No existe en el sistema',
          systemEmployeeName: sysEmp ? sysEmp.nombre : 'Desconocido'
        });
      }
    });

    return { sincronizados, faltan, sobran };
  }

  async function handleAudit() {
    const targetDev = biometricosDisponibles.find(d => (d.uuid || d.id) === selectedDispositivoId);
    const targetSalaId = targetDev ? (targetDev.sala_uuid || targetDev.sala_id) : selectedSalaId;

    if (!targetSalaId) {
      triggerToast('Por favor selecciona un biométrico para auditar', 'error');
      return;
    }

    if (!isWindows) {
      triggerToast('La sincronización de biométricos requiere la aplicación de escritorio en Windows conectada a la red local.', 'warning');
      return;
    }

    isAuditing = true;
    auditResult = null;
    selectedDeviceIndex = 0;
    activeTab = 'sincronizados';
    selectedSyncIds = new Set();
    selectedFaltanIds = new Set();
    selectedSobranNos = new Set();

    try {
      // 1. Obtener contexto de la sala (dispositivos y empleados activos) desde el backend
      const res = await fetch(`/api/biometricos/sala-contexto/${targetSalaId}`);
      const json = await res.json();
      if (!json || !json.success) {
        throw new Error(json?.error || 'Error al obtener contexto de la sala');
      }

      contextActiveEmployees = json.activeEmployees || [];
      contextAllSystemEmployees = json.allSystemEmployees || [];
      const devices = json.devices || [];

      if (devices.length === 0) {
        triggerToast('No se encontraron dispositivos en la sala seleccionada', 'warning');
        auditResult = { success: true, sala: json.sala, devices: [] };
        return;
      }

      // 2. Auditar cada dispositivo directamente en la LAN desde Windows (Tauri Nativo)
      const auditedDevices = [];
      for (const dev of devices) {
        const devRes = {
          uuid: dev.uuid,
          id: dev.uuid,
          nombre: dev.nombre,
          ip_local: dev.ip_local || '',
          ip_panel: dev.ip_panel || '',
          usuario: dev.usuario || 'admin',
          clave: dev.clave || '',
          status: 'offline',
          panelStatus: dev.ip_panel ? 'offline' : null,
          error: null,
          panelError: null,
          totalEnDispositivo: 0,
          totalEnPanel: 0,
          sincronizados: [],
          faltan: [],
          sobran: []
        };

        if (!dev.ip_local || dev.ip_local === '—') {
          devRes.error = 'Sin IP local configurada';
          auditedDevices.push(devRes);
          continue;
        }

        // Consultar usuarios físicos del biométrico en la LAN
        let bioUsers = [];
        try {
          bioUsers = await localGetDeviceUsers(dev.ip_local, dev.usuario || 'admin', dev.clave || '');
          devRes.status = 'online';
          devRes.totalEnDispositivo = bioUsers.length;
        } catch (err) {
          devRes.status = 'error';
          devRes.error = err.message;
        }

        // Consultar usuarios físicos del panel en la LAN si tiene ip_panel
        let panelUsers = [];
        if (dev.ip_panel && dev.ip_panel.trim() && dev.ip_panel !== '—') {
          try {
            panelUsers = await localGetDeviceUsers(dev.ip_panel, dev.usuario || 'admin', dev.clave || '');
            devRes.panelStatus = 'online';
            devRes.totalEnPanel = panelUsers.length;
          } catch (err) {
            devRes.panelStatus = 'error';
            devRes.panelError = err.message;
          }
        }

        // Cruzar y clasificar datos
        const recon = reconcileUsers(bioUsers, contextActiveEmployees, contextAllSystemEmployees, json.sala || targetDev?.salaObj);
        devRes.sincronizados = recon.sincronizados;
        devRes.faltan = recon.faltan;
        devRes.sobran = recon.sobran;

        auditedDevices.push(devRes);
      }

      auditResult = {
        success: true,
        sala: json.sala,
        devices: auditedDevices
      };

      // Posicionar en el dispositivo seleccionado
      const foundIdx = auditedDevices.findIndex(d => (d.uuid || d.id) === selectedDispositivoId);
      selectedDeviceIndex = foundIdx !== -1 ? foundIdx : 0;

      triggerToast(`Auditoría local completada para ${auditedDevices.length} dispositivo(s)`, 'success');
    } catch (err) {
      console.error(err);
      triggerToast(`Error de auditoría local: ${err.message}`, 'error');
    } finally {
      isAuditing = false;
    }
  }

  // Manejo de selecciones "Sincronizados"
  function toggleSelectSync(id) {
    if (selectedSyncIds.has(id)) {
      selectedSyncIds.delete(id);
    } else {
      selectedSyncIds.add(id);
    }
    selectedSyncIds = new Set(selectedSyncIds);
  }

  function toggleSelectAllSync() {
    if (!currentDevice) return;
    const list = filteredSincronizados;
    if (selectedSyncIds.size === list.length && list.length > 0) {
      selectedSyncIds = new Set();
    } else {
      selectedSyncIds = new Set(list.map(e => e.uuid || e.id));
    }
  }

  // Manejo de selecciones "Faltan"
  function toggleSelectFaltan(id) {
    if (selectedFaltanIds.has(id)) {
      selectedFaltanIds.delete(id);
    } else {
      selectedFaltanIds.add(id);
    }
    selectedFaltanIds = new Set(selectedFaltanIds);
  }

  function toggleSelectAllFaltan() {
    if (!currentDevice) return;
    const list = filteredFaltan;
    if (selectedFaltanIds.size === list.length && list.length > 0) {
      selectedFaltanIds = new Set();
    } else {
      selectedFaltanIds = new Set(list.map(e => e.uuid || e.id));
    }
  }

  // Manejo de selecciones "Sobran"
  function toggleSelectSobran(no) {
    if (selectedSobranNos.has(no)) {
      selectedSobranNos.delete(no);
    } else {
      selectedSobranNos.add(no);
    }
    selectedSobranNos = new Set(selectedSobranNos);
  }

  function toggleSelectAllSobran() {
    if (!currentDevice) return;
    const list = filteredSobran;
    if (selectedSobranNos.size === list.length && list.length > 0) {
      selectedSobranNos = new Set();
    } else {
      selectedSobranNos = new Set(list.map(u => u.employeeNo));
    }
  }

  // Refresco silencioso de auditoría local sin reiniciar la pantalla ni perder búsquedas o filtros
  async function silentAuditRefresh() {
    if (!currentDevice || !currentDevice.ip_local) return;
    try {
      let bioUsers = [];
      try {
        bioUsers = await localGetDeviceUsers(currentDevice.ip_local, currentDevice.usuario || 'admin', currentDevice.clave || '');
      } catch (e) {
        console.warn('Error en silent refresh de biométrico:', e);
        return;
      }

      let panelUsers = [];
      if (currentDevice.ip_panel && currentDevice.ip_panel.trim() && currentDevice.ip_panel !== '—') {
        try {
          panelUsers = await localGetDeviceUsers(currentDevice.ip_panel, currentDevice.usuario || 'admin', currentDevice.clave || '');
        } catch (e) {
          console.warn('Error en silent refresh de panel:', e);
        }
      }

      const currentSala = auditResult?.sala || biometricosDisponibles.find(d => (d.uuid || d.id) === selectedDispositivoId)?.salaObj;
      const recon = reconcileUsers(bioUsers, contextActiveEmployees, contextAllSystemEmployees, currentSala);

      if (auditResult && auditResult.devices && auditResult.devices[selectedDeviceIndex]) {
        const d = auditResult.devices[selectedDeviceIndex];
        d.sincronizados = recon.sincronizados;
        d.faltan = recon.faltan;
        d.sobran = recon.sobran;
        d.totalEnDispositivo = bioUsers.length;
        if (panelUsers.length > 0) {
          d.totalEnPanel = panelUsers.length;
        }
        auditResult = { ...auditResult };
      }
    } catch (err) {
      console.warn('Error en silentAuditRefresh:', err);
    }
  }

  // Actualizar empleados en biométrico / panel localmente
  async function handleUpdateEmployees(empleadoIds) {
    if (!currentDevice || !empleadoIds || empleadoIds.length === 0) return;

    for (const id of empleadoIds) {
      updatingEmpIds.add(id);
    }
    updatingEmpIds = new Set(updatingEmpIds);

    isExecutingAction = true;
    updateProgress = { current: 0, total: empleadoIds.length };
    let successCount = 0;

    try {
      for (const empId of empleadoIds) {
        updateProgress.current++;
        updateProgress = { ...updateProgress };

        const emp = contextActiveEmployees.find(e => (e.uuid || e.id) === empId);
        if (!emp) continue;

        // Construir URL pública garantizada de foto (usando wisi.space)
        const photoUrl = emp.photoUrl || (emp.foto ? (emp.foto.startsWith('http') ? emp.foto : `https://wisi.space${emp.foto.startsWith('/') ? '' : '/'}${emp.foto}`) : '');

        // 1. Biométrico local
        if (currentDevice.ip_local && (actionTarget === 'both' || actionTarget === 'bio')) {
          try {
            await localAddUser(currentDevice.ip_local, currentDevice.usuario, currentDevice.clave, emp, false);
            const cardNo = generarCardNoDesdeCedula(emp.cedula);
            if (cardNo) {
              await localSetupCard(currentDevice.ip_local, currentDevice.usuario, currentDevice.clave, emp.cedula, cardNo);
            }
            if (photoUrl) {
              await localUploadFace(currentDevice.ip_local, currentDevice.usuario, currentDevice.clave, emp.cedula, emp.nombre, emp.sexo, photoUrl);
            }
            successCount++;
          } catch (e) {
            console.warn(`Error actualizando ${emp.nombre} en biométrico:`, e.message);
          }
        }

        // 2. Panel local si aplica
        if (currentDevice.ip_panel && currentDevice.ip_panel.trim() && currentDevice.ip_panel !== '—' && (actionTarget === 'both' || actionTarget === 'panel')) {
          try {
            await localAddUser(currentDevice.ip_panel, currentDevice.usuario, currentDevice.clave, emp, true);
            const panelId = generarCardNoDesdeCedula(emp.cedula) || emp.cedula.replace(/\D/g, '');
            if (panelId) {
              await localSetupCard(currentDevice.ip_panel, currentDevice.usuario, currentDevice.clave, panelId, panelId);
            }
          } catch (e) {
            console.warn(`Error actualizando ${emp.nombre} en panel:`, e.message);
          }
        }

        // Reflejar cambio inmediato en el objeto local en memoria
        const matchEmp = (currentDevice.sincronizados || []).find(e => (e.uuid || e.id) === empId);
        if (matchEmp) {
          matchEmp.hasFaceOnDevice = !!photoUrl;
          matchEmp.nameDiffers = false;
          if (matchEmp.deviceUser) {
            matchEmp.deviceUser.name = emp.nombre;
            matchEmp.deviceUser.employeeNo = emp.cedula;
            matchEmp.deviceUser.numOfFace = photoUrl ? 1 : 0;
          }
        }
        if (auditResult) {
          auditResult = { ...auditResult };
        }
      }

      if (successCount > 0) {
        if (empleadoIds.length === 1) {
          const emp = contextActiveEmployees.find(e => (e.uuid || e.id) === empleadoIds[0]);
          triggerToast(`✅ ${emp ? emp.nombre : 'Empleado'} actualizado exitosamente`, 'success');
        } else {
          triggerToast(`🔄 ${successCount} empleado(s) actualizados con nombre y foto`, 'success');
        }
      } else {
        triggerToast('⚠️ No se pudo completar la actualización local en el equipo', 'error');
      }

      // Refresco silencioso de fondo sin reiniciar la vista
      await silentAuditRefresh();
    } catch (err) {
      console.error(err);
      triggerToast(`Error al actualizar: ${err.message}`, 'error');
    } finally {
      for (const id of empleadoIds) {
        updatingEmpIds.delete(id);
      }
      updatingEmpIds = new Set(updatingEmpIds);
      isExecutingAction = false;
    }
  }

  // Agregar empleados al biométrico / panel localmente
  async function handleAddEmployees(empleadoIds) {
    if (!currentDevice || !empleadoIds || empleadoIds.length === 0) return;

    for (const id of empleadoIds) {
      addingEmpIds.add(id);
    }
    addingEmpIds = new Set(addingEmpIds);

    isExecutingAction = true;
    let successCount = 0;
    const addedUuids = [];

    try {
      for (const empId of empleadoIds) {
        const emp = contextActiveEmployees.find(e => (e.uuid || e.id) === empId);
        if (!emp) continue;

        let addedOk = false;
        const photoUrl = emp.photoUrl || (emp.foto ? (emp.foto.startsWith('http') ? emp.foto : `https://wisi.space${emp.foto.startsWith('/') ? '' : '/'}${emp.foto}`) : '');

        // 1. Biométrico local
        if (currentDevice.ip_local && (actionTarget === 'both' || actionTarget === 'bio')) {
          try {
            await localAddUser(currentDevice.ip_local, currentDevice.usuario, currentDevice.clave, emp, false);
            const cardNo = generarCardNoDesdeCedula(emp.cedula);
            if (cardNo) {
              await localSetupCard(currentDevice.ip_local, currentDevice.usuario, currentDevice.clave, emp.cedula, cardNo);
            }
            if (photoUrl) {
              await localUploadFace(currentDevice.ip_local, currentDevice.usuario, currentDevice.clave, emp.cedula, emp.nombre, emp.sexo, photoUrl);
            }
            addedOk = true;
          } catch (e) {
            console.warn(`Error agregando ${emp.nombre} a biométrico:`, e.message);
          }
        }

        // 2. Panel local si aplica
        if (currentDevice.ip_panel && currentDevice.ip_panel.trim() && currentDevice.ip_panel !== '—' && (actionTarget === 'both' || actionTarget === 'panel')) {
          try {
            await localAddUser(currentDevice.ip_panel, currentDevice.usuario, currentDevice.clave, emp, true);
            const panelId = generarCardNoDesdeCedula(emp.cedula) || emp.cedula.replace(/\D/g, '');
            if (panelId) {
              await localSetupCard(currentDevice.ip_panel, currentDevice.usuario, currentDevice.clave, panelId, panelId);
            }
            addedOk = true;
          } catch (e) {
            console.warn(`Error agregando ${emp.nombre} a panel:`, e.message);
          }
        }

        if (addedOk) {
          successCount++;
          addedUuids.push(emp.uuid || emp.id);
        }
      }

      // 3. Reportar asignaciones agregadas a Postgres
      if (addedUuids.length > 0) {
        try {
          await fetch('/api/biometricos/reportar-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dispositivoId: currentDevice.id,
              agregados: addedUuids
            })
          });
        } catch (e) {}
      }

      if (successCount > 0) {
        triggerToast(`✅ ${successCount} empleado(s) agregados al equipo exitosamente`, 'success');
      } else {
        triggerToast('⚠️ El dispositivo local no aceptó agregar a los empleados', 'error');
      }

      // Refresco silencioso sin reiniciar la vista
      await silentAuditRefresh();
    } catch (err) {
      console.error(err);
      triggerToast(`Error al agregar: ${err.message}`, 'error');
    } finally {
      for (const id of empleadoIds) {
        addingEmpIds.delete(id);
      }
      addingEmpIds = new Set(addingEmpIds);
      isExecutingAction = false;
    }
  }

  // Eliminar usuarios del biométrico / panel localmente
  async function handleDeleteUsers(employeeNos) {
    if (!currentDevice || !employeeNos || employeeNos.length === 0) return;

    if (!confirm(`¿Estás seguro de que deseas eliminar ${employeeNos.length} usuario(s) de este dispositivo biométrico local?`)) {
      return;
    }

    for (const no of employeeNos) {
      deletingEmpNos.add(no);
    }
    deletingEmpNos = new Set(deletingEmpNos);

    isExecutingAction = true;
    let deletedCount = 0;

    try {
      for (const empNo of employeeNos) {
        let delOk = false;

        // 1. Eliminar de Biométrico local
        if (currentDevice.ip_local && (actionTarget === 'both' || actionTarget === 'bio')) {
          try {
            await localDeleteUser(currentDevice.ip_local, currentDevice.usuario, currentDevice.clave, empNo, false);
            delOk = true;
          } catch (e) {
            console.warn(`Error eliminando ${empNo} de biométrico:`, e.message);
          }
        }

        // 2. Eliminar de Panel local si aplica
        if (currentDevice.ip_panel && currentDevice.ip_panel.trim() && currentDevice.ip_panel !== '—' && (actionTarget === 'both' || actionTarget === 'panel')) {
          try {
            await localDeleteUser(currentDevice.ip_panel, currentDevice.usuario, currentDevice.clave, empNo, true);
            delOk = true;
          } catch (e) {
            console.warn(`Error eliminando ${empNo} de panel:`, e.message);
          }
        }

        if (delOk) deletedCount++;
      }

      // 3. Reportar eliminaciones a Postgres
      try {
        await fetch('/api/biometricos/reportar-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dispositivoId: currentDevice.id,
            eliminados: employeeNos
          })
        });
      } catch (e) {}

      triggerToast(`🗑️ ${deletedCount} usuario(s) eliminados del equipo local`, 'success');
      // Refresco silencioso sin reiniciar la vista
      await silentAuditRefresh();
    } catch (err) {
      console.error(err);
      triggerToast(`Error al eliminar: ${err.message}`, 'error');
    } finally {
      for (const no of employeeNos) {
        deletingEmpNos.delete(no);
      }
      deletingEmpNos = new Set(deletingEmpNos);
      isExecutingAction = false;
    }
  }

  function handleClose() {
    isOpen = false;
    dispatch('close');
  }
</script>

{#if isOpen}
  <!-- Backdrop estático (NO se cierra al hacer clic afuera) -->
  <div class="sync-modal-backdrop" on:click|stopPropagation>
    <div class="sync-modal-card" on:click|stopPropagation>
      
      <!-- Modal Header -->
      <div class="sync-modal-header">
        <div class="sync-header-left">
          <div class="sync-header-icon-box">
            🔄
          </div>
          <div>
            <h2 class="sync-header-title">Auditoría y Sincronización de Biométricos y Paneles</h2>
            <p class="sync-header-subtitle">Compara y sincroniza en tiempo real los empleados del sistema contra los equipos físicos y paneles por red local (LAN)</p>
          </div>
        </div>

        <button 
          type="button" 
          class="sync-close-btn" 
          on:click={handleClose} 
          title="Cerrar modal (No se cierra al hacer clic afuera)"
        >
          ✕
        </button>
      </div>

      {#if !isWindows}
        <div style="background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 10px 18px; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 8px; margin: 10px 24px 0 24px; border-radius: 8px;">
          <span>⚠️ <strong>Aviso de plataforma:</strong> La sincronización directa por IP local solo puede ejecutarse desde la aplicación de escritorio en Windows conectada a la red de la sala.</span>
        </div>
      {/if}

      <!-- Controls Bar: Device Selector & Audit Button -->
      <div class="sync-controls-bar">
        <div class="sync-select-group">
          <select 
            id="sync-device-select" 
            class="sync-select" 
            aria-label="Seleccionar Biométrico"
            value={selectedDispositivoId}
            on:change={(e) => handleSelectDispositivoChange(e.target.value)}
            disabled={isCheckingReachability || isAuditing || isExecutingAction || !isWindows}
          >
            {#if biometricosDisponibles.length === 0}
              <option value="" disabled>No hay biométricos disponibles</option>
            {:else}
              {#each biometricosDisponibles as d}
                {@const devId = d.uuid || d.id}
                {@const isReachable = reachabilityMap[devId]}
                <option 
                  value={devId} 
                  disabled={isCheckingReachability || isReachable === false}
                >
                  {d.selectLabel}{#if isReachable === true} — 🟢 (En línea){:else if isReachable === false} — ⛔ (Inalcanzable){:else if isCheckingReachability} — ⏳ (Verificando...){/if}
                </option>
              {/each}
            {/if}
          </select>

          <button 
            type="button" 
            class="sync-ping-refresh-btn {isCheckingReachability ? 'is-scanning' : ''}" 
            on:click={() => checkReachabilityAllDevices(true)}
            title={isCheckingReachability ? "Escaneando y verificando equipos Hikvision en red..." : "Escanear y verificar alcance de equipos Hikvision en red"}
            disabled={isCheckingReachability || isAuditing}
          >
            {#if isCheckingReachability}
              <span class="sync-ping-spinner"></span>
            {:else}
              <span>🔄</span>
            {/if}
          </button>

          {#if isCheckingReachability}
            <div class="sync-scanning-pill">
              <span class="sync-scanning-spinner"></span>
              <span>Verificando equipos Hikvision...</span>
            </div>
          {/if}
        </div>

        <button 
          type="button" 
          class="sync-audit-btn" 
          on:click={handleAudit}
          disabled={isCheckingReachability || isAuditing || isExecutingAction || !selectedDispositivoId || !isWindows || reachabilityMap[selectedDispositivoId] === false}
        >
          {#if isAuditing}
            <span class="sync-spinner"></span> Conectando...
          {:else if isCheckingReachability}
            <span class="sync-spinner"></span> Verificando red...
          {:else}
            <span>Chequear</span>
          {/if}
        </button>
      </div>

      <!-- Modal Body -->
      <div class="sync-modal-body">
        {#if isAuditing}
          <div class="sync-loading-container">
            <div class="sync-loading-spinner-large"></div>
            <h3 style="font-size: 16px; font-weight: 800; color: #0f172a; margin: 16px 0 6px 0;">Consultando biométricos y paneles vía ISAPI Local...</h3>
            <p style="font-size: 13px; color: #64748b; margin: 0; max-width: 480px; text-align: center;">
              Estableciendo conexión por IP local a cada dispositivo de la sala, descargando listas completas de usuarios registrados y contrastando contra los empleados activos.
            </p>
          </div>
        {:else if !auditResult}
          <div class="sync-placeholder-container">
            <div style="font-size: 48px; margin-bottom: 12px;">📡</div>
            <h3 style="font-size: 16px; font-weight: 800; color: #0f172a; margin: 0 0 6px 0;">Auditoría no iniciada</h3>
            <p style="font-size: 13px; color: #64748b; margin: 0; max-width: 420px; text-align: center;">
              Selecciona el biométrico que deseas checar arriba y presiona <strong>"Chequear"</strong> para consultar el estado en vivo de los equipos en la red local.
            </p>
          </div>
        {:else if auditResult.devices.length === 0}
          <div class="sync-placeholder-container">
            <div style="font-size: 48px; margin-bottom: 12px;">⚠️</div>
            <h3 style="font-size: 16px; font-weight: 800; color: #b91c1c; margin: 0 0 6px 0;">No hay dispositivos registrados</h3>
            <p style="font-size: 13px; color: #64748b; margin: 0;">Esta sala no tiene equipos biométricos configurados en la base de datos.</p>
          </div>
        {:else}
          <!-- Device Selection Pills -->
          <div class="sync-devices-pills-container">
            {#each auditResult.devices as dev, idx}
              {@const isSelected = selectedDeviceIndex === idx}
              <button
                type="button"
                class="sync-device-pill {isSelected ? 'active' : ''}"
                on:click={() => {
                  selectedDeviceIndex = idx;
                  selectedDispositivoId = dev.uuid || dev.id;
                }}
              >
                <div class="sync-pill-top">
                  <span class="sync-pill-name">{dev.nombre}</span>
                  <span class="sync-status-dot {dev.status === 'online' ? 'dot-online' : 'dot-offline'}" title={dev.status === 'online' ? 'En línea' : 'Desconectado / Error'}></span>
                </div>
                <div class="sync-pill-meta">
                  <span>IP: {dev.ip_local || 'Sin IP'}</span>
                  {#if dev.ip_panel}
                    <span class="sync-panel-chip" title="Panel asociado">📡 Panel</span>
                  {/if}
                </div>
                <div class="sync-pill-counts">
                  <span class="pill-badge badge-sync" title="Sincronizados">🟢 {dev.sincronizados.length}</span>
                  <span class="pill-badge badge-faltan" title="Faltan en equipo">⚠️ {dev.faltan.length}</span>
                  <span class="pill-badge badge-sobran" title="Sobran en equipo">🚫 {dev.sobran.length}</span>
                </div>
              </button>
            {/each}
          </div>

          <!-- Current Device Content Card -->
          {#if currentDevice}
            <div class="sync-device-details-card">
              <!-- Device Sub-header -->
              <div class="sync-device-info-bar">
                <div class="sync-device-info-text">
                  <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <h3 style="margin: 0; font-size: 17px; font-weight: 800; color: #0f172a;">
                      {currentDevice.nombre}
                    </h3>
                    <span class="sync-device-badge {currentDevice.status === 'online' ? 'status-online' : 'status-offline'}">
                      {currentDevice.status === 'online' ? '🟢 Biométrico Conectado' : '🔴 Biométrico Desconectado'}
                    </span>
                    {#if currentDevice.ip_panel}
                      <span class="sync-device-badge {currentDevice.panelStatus === 'online' ? 'status-panel-online' : 'status-offline'}">
                        📡 Panel: {currentDevice.ip_panel} ({currentDevice.panelStatus === 'online' ? 'En línea' : 'Desconectado'})
                      </span>
                    {/if}
                  </div>
                  <div style="font-size: 12.5px; color: #64748b; margin-top: 4px; display: flex; gap: 16px; flex-wrap: wrap;">
                    <span>📍 IP Local Biométrico: <strong>{currentDevice.ip_local}</strong></span>
                    <span>👥 Total en Biométrico: <strong>{currentDevice.totalEnDispositivo}</strong></span>
                    {#if currentDevice.ip_panel}
                      <span>🚪 Total en Panel: <strong>{currentDevice.totalEnPanel}</strong></span>
                    {/if}
                  </div>
                </div>

                <div class="sync-device-info-actions">
                  {#if currentDevice.ip_panel}
                    <div class="sync-target-box">
                      <span style="font-size: 11px; font-weight: 700; color: #475569;">Aplicar a:</span>
                      <select bind:value={actionTarget} class="sync-target-select">
                        <option value="both">Biométrico y Panel</option>
                        <option value="bio">Solo Biométrico</option>
                        <option value="panel">Solo Panel</option>
                      </select>
                    </div>
                  {/if}

                  <!-- Botón Inyectar Listener (Inyección DIRECTA) -->
                  <button 
                    type="button" 
                    class="sync-inject-listener-btn" 
                    on:click={handleDirectInjectListener}
                    disabled={isAuditing || isExecutingAction || isInjectingListener || currentDevice.status !== 'online' || !isWindows}
                    title="Inyectar configuración de HTTP Listener directamente en el biométrico usando su IP local"
                  >
                    {#if isInjectingListener}
                      <span class="sync-spinner-red"></span> Inyectando...
                    {:else}
                      ⚡ Inyectar Listener
                    {/if}
                  </button>
                </div>
              </div>

              <!-- 3 Main Tabs -->
              <div class="sync-tabs-header">
                <button 
                  type="button" 
                  class="sync-tab-btn {activeTab === 'sincronizados' ? 'active-tab-sync' : ''}"
                  on:click={() => activeTab = 'sincronizados'}
                >
                  🟢 Sincronizados ({currentDevice.sincronizados.length})
                </button>

                <button 
                  type="button" 
                  class="sync-tab-btn {activeTab === 'faltan' ? 'active-tab-faltan' : ''}"
                  on:click={() => activeTab = 'faltan'}
                >
                  ⚠️ Faltan en Biométrico ({currentDevice.faltan.length})
                </button>

                <button 
                  type="button" 
                  class="sync-tab-btn {activeTab === 'sobran' ? 'active-tab-sobran' : ''}"
                  on:click={() => activeTab = 'sobran'}
                >
                  🚫 Sobran en Biométrico ({currentDevice.sobran.length})
                </button>
              </div>

              <!-- Tab 1: Sincronizados -->
              {#if activeTab === 'sincronizados'}
                <div class="sync-tab-content">
                  <div class="sync-tab-intro">
                    <span>🟢 Empleados activos de la sala que están en el sistema y <strong>SÍ</strong> se encuentran registrados en el dispositivo físico. Si actualizaste foto o nombre, puedes usar el botón de actualizar.</span>
                  </div>

                  <!-- Toolbar Sincronizados -->
                  {#if currentDevice.sincronizados.length > 0}
                    <div class="sync-action-toolbar" style="background: #f0fdf4; border-color: #bbf7d0;">
                      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                        <label class="sync-select-all-label">
                          <input 
                            type="checkbox" 
                            checked={selectedSyncIds.size === filteredSincronizados.length && filteredSincronizados.length > 0}
                            on:change={toggleSelectAllSync}
                            disabled={isExecutingAction}
                          />
                          <span>Seleccionar ({selectedSyncIds.size})</span>
                        </label>

                        <div class="sync-search-wrapper">
                          <input 
                            type="text" 
                            bind:value={searchSync}
                            placeholder="🔍 Buscar empleado, cédula o cargo..."
                            class="sync-search-input"
                          />
                          {#if searchSync}
                            <button 
                              type="button" 
                              class="sync-search-clear-btn" 
                              on:click={() => searchSync = ''}
                              title="Limpiar filtro"
                            >✕</button>
                          {/if}
                        </div>
                      </div>

                      <div style="display: flex; gap: 8px;">
                        {#if selectedSyncIds.size > 0}
                          <button 
                            type="button" 
                            class="sync-btn-update-bulk"
                            on:click={() => handleUpdateEmployees(Array.from(selectedSyncIds))}
                            disabled={isExecutingAction}
                            title="Actualiza nombre, foto y tarjeta de los seleccionados"
                          >
                            🔄 Actualizar Seleccionados ({selectedSyncIds.size})
                          </button>
                        {/if}

                        <button 
                          type="button" 
                          class="sync-btn-update-all"
                          on:click={() => handleUpdateEmployees(currentDevice.sincronizados.map(e => e.uuid || e.id))}
                          disabled={isExecutingAction || currentDevice.sincronizados.length === 0}
                          title="Actualiza en lote a todos con el nombre y foto más reciente"
                        >
                          {#if isExecutingAction && updateProgress.total > 1}
                            <span class="sync-spinner"></span> Actualizando ({updateProgress.current}/{updateProgress.total})...
                          {:else}
                            🔄 Actualizar Todos (Nombre y Foto)
                          {/if}
                        </button>
                      </div>
                    </div>
                  {/if}

                  {#if currentDevice.sincronizados.length === 0}
                    <div class="sync-empty-tab">
                      No hay ningún empleado sincronizado en este dispositivo actualmente.
                    </div>
                  {:else}
                    <div class="sync-table-wrapper">
                      <table class="sync-table">
                        <thead>
                          <tr>
                            <th style="width: 40px; text-align: center;">
                              <input 
                                type="checkbox" 
                                checked={selectedSyncIds.size === filteredSincronizados.length && filteredSincronizados.length > 0}
                                on:change={toggleSelectAllSync}
                                disabled={isExecutingAction}
                              />
                            </th>
                            <th style="width: 50px; text-align: center;">Foto</th>
                            <th style="width: 120px;">Cédula</th>
                            <th>Empleado</th>
                            <th>Cargo</th>
                            <th>Departamento</th>
                            <th style="width: 160px; text-align: center;">Estado en Equipo</th>
                            <th style="width: 140px; text-align: center;">Acción</th>
                          </tr>
                        </thead>
                        <tbody>
                          {#if filteredSincronizados.length === 0}
                            <tr>
                              <td colspan="8" style="text-align: center; padding: 36px 16px; color: #64748b; font-weight: 600;">
                                No se encontraron empleados sincronizados que coincidan con la búsqueda "{searchSync}".
                              </td>
                            </tr>
                          {:else}
                            {#each filteredSincronizados as emp}
                              {@const empKey = emp.uuid || emp.id}
                              {@const isSelected = selectedSyncIds.has(empKey)}
                              <tr class={isSelected ? 'row-selected-sync' : ''}>
                                <td style="text-align: center;">
                                  <input 
                                    type="checkbox" 
                                    checked={isSelected}
                                    on:change={() => toggleSelectSync(empKey)}
                                    disabled={isExecutingAction}
                                  />
                                </td>
                                <td style="text-align: center;">
                                  <img 
                                    src={toEmployeePhotoUrl(emp.foto || `/empleados/${empKey}.jpg`, empKey)} 
                                    alt={emp.nombre}
                                    class="sync-emp-avatar" 
                                    on:error={(e) => { e.currentTarget.src = '/favicon.png'; }}
                                  />
                                </td>
                                <td class="font-mono font-bold">{emp.cedula}</td>
                                <td>
                                  <div class="font-bold">{emp.nombre}</div>
                                  {#if emp.nameDiffers}
                                    <div class="sync-diff-badge" title="El nombre registrado en el equipo difiere del sistema">
                                      ⚠️ En equipo: "{emp.deviceUser.name}"
                                    </div>
                                  {/if}
                                </td>
                                <td>{emp.cargo_nombre}</td>
                                <td>{emp.departamento_nombre}</td>
                                <td style="text-align: center;">
                                  <div style="display: flex; flex-direction: column; gap: 3px; align-items: center;">
                                    <span class="sync-chip-badge-ok">✓ Sincronizado</span>
                                    {#if !emp.hasFaceOnDevice}
                                      <span class="sync-diff-badge-warn">Sin rostro en equipo</span>
                                    {/if}
                                  </div>
                                </td>
                                <td style="text-align: center;">
                                  <button
                                    type="button"
                                    class="sync-btn-update-single"
                                    on:click={() => handleUpdateEmployees([empKey])}
                                    disabled={updatingEmpIds.has(empKey) || isExecutingAction}
                                    title="Actualizar nombre, foto y tarjeta en el biométrico y panel"
                                  >
                                    {#if updatingEmpIds.has(empKey)}
                                      <span class="sync-spinner"></span> Actualizando...
                                    {:else}
                                      🔄 Actualizar
                                    {/if}
                                  </button>
                                </td>
                              </tr>
                            {/each}
                          {/if}
                        </tbody>
                      </table>
                    </div>
                    <div class="sync-table-counter">
                      <span>Mostrando <strong>{filteredSincronizados.length}</strong> de <strong>{currentDevice.sincronizados.length}</strong> empleados sincronizados</span>
                      {#if searchSync.trim()}
                        <span class="sync-filter-active-pill">
                          Filtrado por: "<strong>{searchSync}</strong>"
                          <button type="button" class="sync-btn-clear-inline" on:click={() => searchSync = ''}>
                            ✕ Quitar filtro
                          </button>
                        </span>
                      {/if}
                    </div>
                  {/if}
                </div>

              <!-- Tab 2: Faltan en Biométrico -->
              {:else if activeTab === 'faltan'}
                <div class="sync-tab-content">
                  <div class="sync-tab-intro" style="background: #fffbeb; border-color: #fde68a; color: #92400e;">
                    <span>⚠️ Empleados activos de la sala que están en el sistema pero <strong>NO</strong> se encuentran registrados en el dispositivo físico.</span>
                  </div>

                  <!-- Toolbar de acciones por lote -->
                  {#if currentDevice.faltan.length > 0}
                    <div class="sync-action-toolbar">
                      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                        <label class="sync-select-all-label">
                          <input 
                            type="checkbox" 
                            checked={selectedFaltanIds.size === filteredFaltan.length && filteredFaltan.length > 0}
                            on:change={toggleSelectAllFaltan}
                            disabled={isExecutingAction}
                          />
                          <span>Seleccionar ({selectedFaltanIds.size})</span>
                        </label>

                        <div class="sync-search-wrapper">
                          <input 
                            type="text" 
                            bind:value={searchFaltan}
                            placeholder="🔍 Buscar empleado, cédula o cargo..."
                            class="sync-search-input"
                          />
                          {#if searchFaltan}
                            <button 
                              type="button" 
                              class="sync-search-clear-btn" 
                              on:click={() => searchFaltan = ''}
                              title="Limpiar filtro"
                            >✕</button>
                          {/if}
                        </div>
                      </div>

                      <div style="display: flex; gap: 8px;">
                        {#if selectedFaltanIds.size > 0}
                          <button 
                            type="button" 
                            class="sync-btn-add-bulk"
                            on:click={() => handleAddEmployees(Array.from(selectedFaltanIds))}
                            disabled={isExecutingAction}
                          >
                            ➕ Agregar Seleccionados ({selectedFaltanIds.size})
                          </button>
                        {/if}

                        <button 
                          type="button" 
                          class="sync-btn-add-all"
                          on:click={() => handleAddEmployees(currentDevice.faltan.map(e => e.uuid || e.id))}
                          disabled={isExecutingAction || currentDevice.faltan.length === 0}
                        >
                          {#if isExecutingAction && addingEmpIds.size > 1}
                            <span class="sync-spinner"></span> Agregando...
                          {:else}
                            ➕ Agregar Todos ({currentDevice.faltan.length})
                          {/if}
                        </button>
                      </div>
                    </div>
                  {/if}

                  {#if currentDevice.faltan.length === 0}
                    <div class="sync-empty-tab" style="color: #15803d; background: #f0fdf4; border-color: #bbf7d0;">
                      🎉 ¡Excelente! No falta ningún empleado activo en este biométrico.
                    </div>
                  {:else}
                    <div class="sync-table-wrapper">
                      <table class="sync-table">
                        <thead>
                          <tr>
                            <th style="width: 40px; text-align: center;">
                              <input 
                                type="checkbox" 
                                checked={selectedFaltanIds.size === filteredFaltan.length && filteredFaltan.length > 0}
                                on:change={toggleSelectAllFaltan}
                                disabled={isExecutingAction}
                              />
                            </th>
                            <th style="width: 50px; text-align: center;">Foto</th>
                            <th style="width: 120px;">Cédula</th>
                            <th>Empleado</th>
                            <th>Cargo</th>
                            <th>Departamento</th>
                            <th style="width: 140px; text-align: center;">Acción</th>
                          </tr>
                        </thead>
                        <tbody>
                          {#if filteredFaltan.length === 0}
                            <tr>
                              <td colspan="7" style="text-align: center; padding: 36px 16px; color: #64748b; font-weight: 600;">
                                No se encontraron empleados pendientes que coincidan con la búsqueda "{searchFaltan}".
                              </td>
                            </tr>
                          {:else}
                            {#each filteredFaltan as emp}
                              {@const empKey = emp.uuid || emp.id}
                              {@const isSelected = selectedFaltanIds.has(empKey)}
                              <tr class={isSelected ? 'row-selected-add' : ''}>
                                <td style="text-align: center;">
                                  <input 
                                    type="checkbox" 
                                    checked={isSelected}
                                    on:change={() => toggleSelectFaltan(empKey)}
                                    disabled={isExecutingAction}
                                  />
                                </td>
                                <td style="text-align: center;">
                                  <img 
                                    src={toEmployeePhotoUrl(emp.foto || `/empleados/${empKey}.jpg`, empKey)} 
                                    alt={emp.nombre}
                                    class="sync-emp-avatar" 
                                    on:error={(e) => { e.currentTarget.src = '/favicon.png'; }}
                                  />
                                </td>
                                <td class="font-mono font-bold" style="color: #d97706;">{emp.cedula}</td>
                                <td class="font-bold">{emp.nombre}</td>
                                <td>{emp.cargo_nombre}</td>
                                <td>{emp.departamento_nombre}</td>
                                <td style="text-align: center;">
                                  <button 
                                    type="button" 
                                    class="sync-btn-add-single"
                                    on:click={() => handleAddEmployees([empKey])}
                                    disabled={addingEmpIds.has(empKey) || isExecutingAction}
                                  >
                                    {#if addingEmpIds.has(empKey)}
                                      <span class="sync-spinner"></span> Agregando...
                                    {:else}
                                      ➕ Agregar
                                    {/if}
                                  </button>
                                </td>
                              </tr>
                            {/each}
                          {/if}
                        </tbody>
                      </table>
                    </div>
                    <div class="sync-table-counter">
                      <span>Mostrando <strong>{filteredFaltan.length}</strong> de <strong>{currentDevice.faltan.length}</strong> empleados pendientes</span>
                      {#if searchFaltan.trim()}
                        <span class="sync-filter-active-pill">
                          Filtrado por: "<strong>{searchFaltan}</strong>"
                          <button type="button" class="sync-btn-clear-inline" on:click={() => searchFaltan = ''}>
                            ✕ Quitar filtro
                          </button>
                        </span>
                      {/if}
                    </div>
                  {/if}
                </div>

              <!-- Tab 3: Sobran en Biométrico -->
              {:else if activeTab === 'sobran'}
                <div class="sync-tab-content">
                  <div class="sync-tab-intro" style="background: #fef2f2; border-color: #fecaca; color: #991b1b;">
                    <span>🚫 Usuarios que están registrados en el dispositivo físico pero <strong>NO</strong> corresponden a empleados activos autorizados de esta sala (personal desincorporado, retirado o códigos ajenos).</span>
                  </div>

                  <!-- Toolbar de acciones por lote -->
                  {#if currentDevice.sobran.length > 0}
                    <div class="sync-action-toolbar" style="background: #fef2f2; border-color: #fecaca;">
                      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                        <label class="sync-select-all-label">
                          <input 
                            type="checkbox" 
                            checked={selectedSobranNos.size === filteredSobran.length && filteredSobran.length > 0}
                            on:change={toggleSelectAllSobran}
                            disabled={isExecutingAction}
                          />
                          <span>Seleccionar ({selectedSobranNos.size})</span>
                        </label>

                        <div class="sync-search-wrapper">
                          <input 
                            type="text" 
                            bind:value={searchSobran}
                            placeholder="🔍 Buscar usuario, cédula o estado..."
                            class="sync-search-input"
                          />
                          {#if searchSobran}
                            <button 
                              type="button" 
                              class="sync-search-clear-btn" 
                              on:click={() => searchSobran = ''}
                              title="Limpiar filtro"
                            >✕</button>
                          {/if}
                        </div>
                      </div>

                      <div style="display: flex; gap: 8px;">
                        {#if selectedSobranNos.size > 0}
                          <button 
                            type="button" 
                            class="sync-btn-del-bulk"
                            on:click={() => handleDeleteUsers(Array.from(selectedSobranNos))}
                            disabled={isExecutingAction}
                          >
                            🗑️ Eliminar Seleccionados ({selectedSobranNos.size})
                          </button>
                        {/if}

                        <button 
                          type="button" 
                          class="sync-btn-del-all"
                          on:click={() => handleDeleteUsers(currentDevice.sobran.map(u => u.employeeNo))}
                          disabled={isExecutingAction || currentDevice.sobran.length === 0}
                        >
                          {#if isExecutingAction && deletingEmpNos.size > 1}
                            <span class="sync-spinner"></span> Eliminando...
                          {:else}
                            🗑️ Eliminar Todos ({currentDevice.sobran.length})
                          {/if}
                        </button>
                      </div>
                    </div>
                  {/if}

                  {#if currentDevice.sobran.length === 0}
                    <div class="sync-empty-tab" style="color: #15803d; background: #f0fdf4; border-color: #bbf7d0;">
                      🎉 ¡El equipo está limpio! No hay usuarios no autorizados ni sobrantes en este biométrico.
                    </div>
                  {:else}
                    <div class="sync-table-wrapper">
                      <table class="sync-table">
                        <thead>
                          <tr>
                            <th style="width: 40px; text-align: center;">
                              <input 
                                type="checkbox" 
                                checked={selectedSobranNos.size === filteredSobran.length && filteredSobran.length > 0}
                                on:change={toggleSelectAllSobran}
                                disabled={isExecutingAction}
                              />
                            </th>
                            <th style="width: 140px;">Cédula en Equipo</th>
                            <th>Nombre en Equipo</th>
                            <th>Estado en Base de Datos</th>
                            <th style="width: 140px; text-align: center;">Acción</th>
                          </tr>
                        </thead>
                        <tbody>
                          {#if filteredSobran.length === 0}
                            <tr>
                              <td colspan="5" style="text-align: center; padding: 36px 16px; color: #64748b; font-weight: 600;">
                                No se encontraron usuarios sobrantes que coincidan con la búsqueda "{searchSobran}".
                              </td>
                            </tr>
                          {:else}
                            {#each filteredSobran as u}
                              {@const isSelected = selectedSobranNos.has(u.employeeNo)}
                              <tr class={isSelected ? 'row-selected-del' : ''}>
                                <td style="text-align: center;">
                                  <input 
                                    type="checkbox" 
                                    checked={isSelected}
                                    on:change={() => toggleSelectSobran(u.employeeNo)}
                                    disabled={isExecutingAction}
                                  />
                                </td>
                                <td class="font-mono font-bold" style="color: #b91c1c;">{u.employeeNo}</td>
                                <td class="font-bold">{u.name}</td>
                                <td>
                                  <span class="sync-chip-system-status {u.systemStatus.includes('Desincorporado') ? 'chip-desinc' : u.systemStatus.includes('Activo') ? 'chip-other-sala' : u.systemStatus.includes('Coincide') ? 'chip-name-match' : 'chip-unknown'}">
                                    {u.systemStatus}
                                  </span>
                                </td>
                                <td style="text-align: center;">
                                  <button 
                                    type="button" 
                                    class="sync-btn-del-single"
                                    on:click={() => handleDeleteUsers([u.employeeNo])}
                                    disabled={deletingEmpNos.has(u.employeeNo) || isExecutingAction}
                                  >
                                    {#if deletingEmpNos.has(u.employeeNo)}
                                      <span class="sync-spinner"></span> Eliminando...
                                    {:else}
                                      🗑️ Eliminar
                                    {/if}
                                  </button>
                                </td>
                              </tr>
                            {/each}
                          {/if}
                        </tbody>
                      </table>
                    </div>
                    <div class="sync-table-counter">
                      <span>Mostrando <strong>{filteredSobran.length}</strong> de <strong>{currentDevice.sobran.length}</strong> usuarios sobrantes</span>
                      {#if searchSobran.trim()}
                        <span class="sync-filter-active-pill">
                          Filtrado por: "<strong>{searchSobran}</strong>"
                          <button type="button" class="sync-btn-clear-inline" on:click={() => searchSobran = ''}>
                            ✕ Quitar filtro
                          </button>
                        </span>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        {/if}
      </div>

      <!-- Modal Footer -->
      <div class="sync-modal-footer">
        <div style="font-size: 12px; color: #64748b; font-weight: 600;">
          * Las operaciones de alta, actualización y baja se ejecutan vía IP pública mediante el protocolo Hikvision ISAPI.
        </div>
        <button 
          type="button" 
          class="sync-close-footer-btn" 
          on:click={handleClose}
        >
          Cerrar
        </button>
      </div>

    </div>
  </div>
{/if}

<style>
  .sync-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99999;
    background: rgba(15, 23, 42, 0.75);
    backdrop-filter: blur(5px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    box-sizing: border-box;
    pointer-events: auto;
  }

  .sync-modal-card {
    background: #ffffff;
    border-radius: 18px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4);
    border: 1px solid #cbd5e1;
    width: 95vw;
    max-width: 1400px;
    height: 92vh;
    max-height: 920px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #0f172a;
    animation: syncModalPop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes syncModalPop {
    from { opacity: 0; transform: scale(0.96) translateY(10px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  .sync-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    flex-shrink: 0;
  }

  .sync-header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .sync-header-icon-box {
    width: 42px;
    height: 42px;
    border-radius: 12px;
    background: #eff6ff;
    border: 1.5px solid #bfdbfe;
    color: #2563eb;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
  }

  .sync-header-title {
    margin: 0;
    font-size: 18px;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.3px;
  }

  .sync-header-subtitle {
    margin: 2px 0 0 0;
    font-size: 12px;
    color: #64748b;
    font-weight: 600;
  }

  .sync-close-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #64748b;
    font-size: 16px;
    font-weight: 800;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .sync-close-btn:hover {
    background: #fee2e2;
    color: #ef4444;
    border-color: #fca5a5;
  }

  .sync-controls-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 24px;
    background: #ffffff;
    border-bottom: 1px solid #e2e8f0;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .sync-select-group {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .sync-label {
    font-size: 13px;
    font-weight: 700;
    color: #334155;
  }

  .sync-select {
    padding: 8px 14px;
    border-radius: 8px;
    border: 1.5px solid #cbd5e1;
    font-size: 13.5px;
    font-weight: 700;
    color: #0f172a;
    background: #f8fafc;
    outline: none;
    min-width: 280px;
    cursor: pointer;
  }

  .sync-select:focus {
    border-color: #3b82f6;
    background: #ffffff;
  }

  .sync-audit-btn {
    padding: 9px 20px;
    border-radius: 9px;
    border: none;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: #ffffff;
    font-size: 13.5px;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 4px 10px rgba(37, 99, 235, 0.25);
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transition: all 0.15s ease;
  }

  .sync-audit-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 14px rgba(37, 99, 235, 0.35);
  }

  .sync-audit-btn:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .sync-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid #ffffff;
    border-top-color: transparent;
    border-radius: 50%;
    animation: syncSpin 0.7s linear infinite;
    display: inline-block;
  }

  @keyframes syncSpin {
    to { transform: rotate(360deg); }
  }

  .sync-modal-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 16px 22px;
    background: #f8fafc;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .sync-loading-container, .sync-placeholder-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 60px 20px;
    margin: auto 0;
  }

  .sync-loading-spinner-large {
    width: 44px;
    height: 44px;
    border: 4px solid #e2e8f0;
    border-top-color: #2563eb;
    border-radius: 50%;
    animation: syncSpin 0.8s linear infinite;
  }

  .sync-devices-pills-container {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding-bottom: 4px;
    flex-shrink: 0;
  }

  .sync-device-pill {
    padding: 10px 14px;
    border-radius: 12px;
    border: 1.5px solid #cbd5e1;
    background: #ffffff;
    text-align: left;
    cursor: pointer;
    min-width: 220px;
    max-width: 260px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    transition: all 0.15s ease;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }

  .sync-device-pill:hover {
    border-color: #94a3b8;
    transform: translateY(-1px);
  }

  .sync-device-pill.active {
    border-color: #2563eb;
    background: #eff6ff;
    box-shadow: 0 4px 10px rgba(37, 99, 235, 0.15);
  }

  .sync-pill-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .sync-pill-name {
    font-size: 13px;
    font-weight: 800;
    color: #0f172a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sync-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot-online { background: #22c55e; box-shadow: 0 0 6px rgba(34, 197, 94, 0.6); }
  .dot-offline { background: #ef4444; }

  .sync-pill-meta {
    font-size: 11px;
    color: #64748b;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .sync-panel-chip {
    padding: 1px 6px;
    border-radius: 4px;
    background: #e0e7ff;
    color: #3730a3;
    font-size: 10px;
    font-weight: 800;
  }

  .sync-pill-counts {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }

  .pill-badge {
    padding: 2px 6px;
    border-radius: 5px;
    font-size: 10.5px;
    font-weight: 800;
  }

  .badge-sync { background: #dcfce7; color: #166534; }
  .badge-faltan { background: #fef3c7; color: #92400e; }
  .badge-sobran { background: #fee2e2; color: #991b1b; }

  .sync-device-details-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.03);
    flex-shrink: 0;
  }

  .sync-device-info-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    padding-bottom: 8px;
    border-bottom: 1px solid #f1f5f9;
    flex-shrink: 0;
  }

  .sync-device-badge {
    padding: 3px 10px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 800;
  }

  .status-online { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
  .status-offline { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }
  .status-panel-online { background: #ede9fe; color: #6d28d9; border: 1px solid #ddd6fe; }

  .sync-target-box {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #f8fafc;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
  }

  .sync-target-select {
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid #cbd5e1;
    font-size: 12px;
    font-weight: 700;
    color: #0f172a;
    outline: none;
    cursor: pointer;
  }

  .sync-tabs-header {
    display: flex;
    gap: 8px;
    border-bottom: 1.5px solid #e2e8f0;
    padding-bottom: 2px;
    flex-shrink: 0;
  }

  .sync-tab-btn {
    padding: 8px 16px;
    border-radius: 8px 8px 0 0;
    border: none;
    background: transparent;
    font-size: 13px;
    font-weight: 800;
    color: #64748b;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .sync-tab-btn:hover {
    color: #0f172a;
    background: #f1f5f9;
  }

  .active-tab-sync {
    color: #166534 !important;
    background: #dcfce7 !important;
    box-shadow: inset 0 -2px 0 #16a34a;
  }

  .active-tab-faltan {
    color: #92400e !important;
    background: #fef3c7 !important;
    box-shadow: inset 0 -2px 0 #d97706;
  }

  .active-tab-sobran {
    color: #991b1b !important;
    background: #fee2e2 !important;
    box-shadow: inset 0 -2px 0 #dc2626;
  }

  .sync-tab-content {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .sync-tab-intro {
    padding: 8px 12px;
    border-radius: 8px;
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    font-size: 12px;
    font-weight: 600;
    color: #166534;
    flex-shrink: 0;
  }

  .sync-action-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    border-radius: 8px;
    background: #fffbeb;
    border: 1px solid #fef3c7;
    flex-wrap: wrap;
    flex-shrink: 0;
  }

  .sync-select-all-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 700;
    color: #475569;
    cursor: pointer;
  }

  .sync-search-wrapper {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .sync-search-input {
    padding: 5px 28px 5px 12px;
    border-radius: 7px;
    border: 1px solid #cbd5e1;
    font-size: 12px;
    color: #0f172a;
    background: #ffffff;
    outline: none;
    width: 250px;
    transition: all 0.15s ease;
  }

  .sync-search-input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
  }

  .sync-search-clear-btn {
    position: absolute;
    right: 6px;
    background: none;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    font-size: 12px;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 4px;
    line-height: 1;
    transition: all 0.15s ease;
  }

  .sync-search-clear-btn:hover {
    color: #ef4444;
    background: #fee2e2;
  }

  .sync-btn-update-bulk {
    padding: 6px 12px;
    border-radius: 7px;
    border: 1px solid #3b82f6;
    background: #2563eb;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
  }

  .sync-btn-update-all {
    padding: 6px 12px;
    border-radius: 7px;
    border: 1px solid #60a5fa;
    background: #3b82f6;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
  }

  .sync-btn-update-single {
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px solid #93c5fd;
    background: #eff6ff;
    color: #1d4ed8;
    font-size: 11.5px;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .sync-btn-update-single:hover {
    background: #2563eb;
    color: #ffffff;
    border-color: #2563eb;
  }

  .sync-btn-add-bulk {
    padding: 6px 12px;
    border-radius: 7px;
    border: 1px solid #22c55e;
    background: #16a34a;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
  }

  .sync-btn-add-all {
    padding: 6px 12px;
    border-radius: 7px;
    border: 1px solid #3b82f6;
    background: #2563eb;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
  }

  .sync-btn-del-bulk {
    padding: 6px 12px;
    border-radius: 7px;
    border: 1px solid #ef4444;
    background: #dc2626;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
  }

  .sync-btn-del-all {
    padding: 6px 12px;
    border-radius: 7px;
    border: 1px solid #f87171;
    background: #b91c1c;
    color: #ffffff;
    font-size: 12px;
    font-weight: 800;
    cursor: pointer;
  }

  .sync-table-wrapper {
    height: clamp(340px, 44vh, 500px);
    min-height: 320px;
    max-height: 520px;
    overflow-y: auto !important;
    overflow-x: auto !important;
    border: 1.5px solid #cbd5e1;
    border-radius: 12px;
    background: #ffffff;
    position: relative;
    scrollbar-width: thin !important;
    scrollbar-color: #94a3b8 #f1f5f9 !important;
  }

  .sync-table-wrapper::-webkit-scrollbar {
    display: block !important;
    width: 9px !important;
    height: 9px !important;
  }

  .sync-table-wrapper::-webkit-scrollbar-track {
    background: #f1f5f9 !important;
    border-radius: 6px !important;
  }

  .sync-table-wrapper::-webkit-scrollbar-thumb {
    background: #94a3b8 !important;
    border-radius: 6px !important;
    border: 2px solid #f1f5f9 !important;
  }

  .sync-table-wrapper::-webkit-scrollbar-thumb:hover {
    background: #64748b !important;
  }

  .sync-table {
    width: 100%;
    min-width: 860px;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 13px;
    text-align: left;
  }

  .sync-table th {
    background: #f8fafc;
    color: #475569;
    padding: 12px 14px;
    font-size: 11.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    position: sticky;
    top: 0;
    z-index: 10;
    border-bottom: 2px solid #cbd5e1;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .sync-table td {
    padding: 10px 14px;
    border-bottom: 1px solid #f1f5f9;
    color: #0f172a;
    vertical-align: middle;
    background: #ffffff;
  }

  .sync-table tbody tr:hover td {
    background: #f8fafc;
  }

  .row-selected-sync td {
    background: #f0fdf4 !important;
  }

  .row-selected-add td {
    background: #fefce8 !important;
  }

  .row-selected-del td {
    background: #fef2f2 !important;
  }

  .sync-emp-avatar {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    object-fit: cover;
    border: 1.5px solid #cbd5e1;
    display: inline-block;
  }

  .sync-chip-badge-ok {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 6px;
    background: #dcfce7;
    color: #15803d;
    font-size: 11px;
    font-weight: 800;
    border: 1px solid #bbf7d0;
  }

  .sync-diff-badge {
    display: inline-block;
    margin-top: 3px;
    padding: 2px 6px;
    border-radius: 4px;
    background: #fef3c7;
    color: #b45309;
    font-size: 10.5px;
    font-weight: 700;
    border: 1px solid #fde68a;
  }

  .sync-diff-badge-warn {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    background: #fee2e2;
    color: #b91c1c;
    font-size: 10px;
    font-weight: 700;
    border: 1px solid #fca5a5;
  }

  .sync-chip-system-status {
    display: inline-block;
    padding: 4px 9px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 700;
  }

  .chip-desinc { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }
  .chip-other-sala { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
  .chip-name-match { background: #f3e8ff; color: #7e22ce; border: 1px solid #d8b4fe; }
  .chip-unknown { background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0; }

  .sync-btn-add-single {
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid #86efac;
    background: #f0fdf4;
    color: #15803d;
    font-size: 11.5px;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .sync-btn-add-single:hover {
    background: #16a34a;
    color: #ffffff;
    border-color: #16a34a;
  }

  .sync-btn-del-single {
    padding: 5px 12px;
    border-radius: 6px;
    border: 1px solid #fca5a5;
    background: #fef2f2;
    color: #b91c1c;
    font-size: 11.5px;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .sync-btn-del-single:hover {
    background: #dc2626;
    color: #ffffff;
    border-color: #dc2626;
  }

  .sync-table-counter {
    font-size: 11.5px;
    font-weight: 700;
    color: #64748b;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 3px 6px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .sync-filter-active-pill {
    padding: 2px 8px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 6px;
    color: #1d4ed8;
    font-weight: 600;
    font-size: 11px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .sync-btn-clear-inline {
    background: none;
    border: none;
    color: #dc2626;
    cursor: pointer;
    font-weight: 800;
    font-size: 11px;
    padding: 1px 4px;
    border-radius: 3px;
    transition: all 0.15s ease;
  }

  .sync-btn-clear-inline:hover {
    background: #fee2e2;
    color: #991b1b;
  }

  .sync-empty-tab {
    padding: 30px;
    text-align: center;
    border-radius: 10px;
    border: 1.5px dashed #cbd5e1;
    color: #64748b;
    font-size: 13.5px;
    font-weight: 700;
  }

  .sync-modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 24px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
    flex-shrink: 0;
  }

  .sync-close-footer-btn {
    padding: 8px 18px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #334155;
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .sync-ping-refresh-btn {
    padding: 7px 11px;
    border-radius: 8px;
    border: 1.5px solid #cbd5e1;
    background: #f8fafc;
    color: #475569;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 34px;
    min-height: 34px;
  }

  .sync-ping-refresh-btn:hover:not(:disabled) {
    background: #e2e8f0;
    border-color: #94a3b8;
    color: #0f172a;
  }

  .sync-ping-refresh-btn.is-scanning {
    background: #eff6ff;
    border-color: #3b82f6;
    cursor: wait;
  }

  .sync-ping-refresh-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .sync-ping-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid #2563eb;
    border-top-color: transparent;
    border-radius: 50%;
    animation: syncSpin 0.7s linear infinite;
    display: inline-block;
  }

  .sync-scanning-pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 4px 12px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 700;
    color: #1d4ed8;
  }

  .sync-scanning-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid #2563eb;
    border-top-color: transparent;
    border-radius: 50%;
    animation: syncSpin 0.7s linear infinite;
    display: inline-block;
  }

  .sync-device-info-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-left: auto;
  }

  .sync-inject-listener-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 15px;
    font-size: 12.5px;
    font-weight: 700;
    border-radius: 8px;
    border: 1px solid #fca5a5;
    background: #fff5f5;
    color: #dc2626;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
    box-shadow: 0 1px 3px rgba(239, 68, 68, 0.1);
  }

  .sync-inject-listener-btn:hover:not(:disabled) {
    background: #fee2e2;
    border-color: #ef4444;
    transform: translateY(-1px);
    box-shadow: 0 3px 8px rgba(239, 68, 68, 0.2);
  }

  .sync-inject-listener-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    border-color: #e2e8f0;
    background: #f1f5f9;
    color: #94a3b8;
    box-shadow: none;
  }

  .sync-spinner-red {
    width: 13px;
    height: 13px;
    border: 2px solid #dc2626;
    border-top-color: transparent;
    border-radius: 50%;
    animation: syncSpin 0.7s linear infinite;
    display: inline-block;
  }

</style>
