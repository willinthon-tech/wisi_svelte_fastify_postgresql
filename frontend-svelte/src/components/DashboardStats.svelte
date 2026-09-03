<script>
  function toTitleCase(str) {
    if (!str || typeof str !== "string") return str;
    return str.trim().toLowerCase().split(/\s+/).map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : "")).join(" ");
  }

  import { onMount, onDestroy } from "svelte";
  import AttlogCarousel from "./AttlogCarousel.svelte";
  import { getCloudBaseUrl } from "../config/api.config.js";
  import { userSalasStore as masterUserSalasStore } from "../controllers/master.store.js";
  import { currentUserStore, userSalasStore as authUserSalasStore } from "../controllers/auth.store.js";
  import { latestAttlogEventStore } from "../controllers/websocket.store.js";
  import { openPhotoModal, updatePhotoModalItems } from "../controllers/globalModal.store.js";

  export let items = [];

  $: total = items.length;
  $: completed = items.filter((i) => i.completed).length;
  $: pending = total - completed;
  $: percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  $: formattedSales = total > 0 ? (total * 27.6).toFixed(2) : "82.99";

  // Assigned sala IDs for the logged-in user
  $: assignedSalaIds = (function () {
    const user = $currentUserStore;
    const userId = user?.id || 1;
    if (user && Array.isArray(user.salas) && user.salas.length > 0)
      return user.salas.map((s) => (typeof s === "object" ? s.id : Number(s))).filter(Boolean);
    const masterMap = $masterUserSalasStore;
    if (masterMap && typeof masterMap === "object" && !Array.isArray(masterMap)) {
      const userList = masterMap[userId] || masterMap[String(userId)];
      if (Array.isArray(userList))
        return userList.map((s) => (typeof s === "object" ? s.id : Number(s))).filter(Boolean);
    }
    const authSalas = $authUserSalasStore;
    if (Array.isArray(authSalas) && authSalas.length > 0)
      return authSalas.map((s) => (typeof s === "object" ? s.id : Number(s))).filter(Boolean);
    return [];
  })();

  // Unified state for absolute latest record (entrada, salida, or puerta/otros)
  let latestRecord = null;
  let lastSeenRecordId = null;
  let isFlashingRecord = false;
  let flashRecordTimer = null;

  // State for today's birthdays (Card 2)
  let todayBirthdays = [];
  let isFetchingBirthdays = false;
  let activeBirthdayIdx = 0;
  let pollTimer = null;
  let carouselRef = null;

  $: statusInfo = getRecordStatus(latestRecord);

  const backendUrl = getCloudBaseUrl();

  function getPhotoUrl(id) {
    if (!id) return "";
    return `/attlogs/${id}.jpg`;
  }

  function getFallbackProfilePhoto(record) {
    if (!record) return null;
    const empFoto =
      record.empleado_foto ||
      record.foto ||
      (record.empleado_id ? `/empleados/${record.empleado_id}.jpg` : null);
    if (!empFoto) return null;
    if (empFoto.startsWith("http")) return empFoto;
    return empFoto.startsWith("/") ? empFoto : `/${empFoto}`;
  }

  function getRecordPhoto(record) {
    if (!record) return "";
    if (record.has_photo && record.id) {
      return `/attlogs/${record.id}.jpg`;
    }
    const fallback = getFallbackProfilePhoto(record);
    if (fallback) return fallback;
    if (record.id) return `/attlogs/${record.id}.jpg`;
    return "";
  }

  function formatEventTime(val) {
    if (!val) return "";
    let str = String(val).trim().replace("T", " ");
    if (str.includes("+")) str = str.split("+")[0];
    if (str.endsWith("Z")) str = str.substring(0, str.length - 1);
    if (str.includes(".")) str = str.split(".")[0];
    return str;
  }

  function getInitials(nombre, empNo) {
    if (nombre && typeof nombre === "string") {
      const parts = nombre.trim().split(/\s+/);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      if (parts.length === 1 && parts[0].length > 0) return parts[0].substring(0, 2).toUpperCase();
    }
    return String(empNo || "US").substring(0, 2).toUpperCase();
  }

  function getAvatarColor(empNo) {
    const colors = [
      "linear-gradient(135deg, #2563eb, #1d4ed8)",
      "linear-gradient(135deg, #059669, #047857)",
      "linear-gradient(135deg, #d97706, #b45309)",
      "linear-gradient(135deg, #7c3aed, #6d28d9)",
      "linear-gradient(135deg, #db2777, #be185d)",
    ];
    let num = 0;
    const str = String(empNo || "");
    for (let i = 0; i < str.length; i++) num += str.charCodeAt(i);
    return colors[num % colors.length];
  }

  function triggerFlashRecord() {
    isFlashingRecord = true;
    if (flashRecordTimer) clearTimeout(flashRecordTimer);
    flashRecordTimer = setTimeout(() => { isFlashingRecord = false; }, 1500);
  }

  function getRecordStatus(record) {
    if (!record) return { label: "SIN REGISTRO", color: "#64748b", bg: "#f1f5f9", border: "#cbd5e1", dot: "#94a3b8", headerBg: "linear-gradient(90deg, #f1f5f9, #f8fafc)", headerColor: "#64748b", headerBorder: "#cbd5e1", headerTag: "⚡ ÚLTIMO REGISTRO" };
    const st = String(record.status ?? record.attendance_status ?? record.attendancestatus ?? "").toLowerCase().trim();
    if (st === "1" || st === "checkin" || st === "entrada") {
      return { label: "ENTRADA", color: "#15803d", bg: "#f0fdf4", border: "#86efac", dot: "#22c55e", headerBg: "linear-gradient(90deg, #dcfce7, #f0fdf4)", headerColor: "#15803d", headerBorder: "#86efac", headerTag: "🟢 ÚLTIMO DE ENTRADA" };
    }
    if (st === "2" || st === "checkout" || st === "salida") {
      return { label: "SALIDA", color: "#b91c1c", bg: "#fff1f2", border: "#fca5a5", dot: "#ef4444", headerBg: "linear-gradient(90deg, #fee2e2, #fff1f2)", headerColor: "#b91c1c", headerBorder: "#fca5a5", headerTag: "🔴 ÚLTIMO DE SALIDA" };
    }
    return { label: "PUERTA / OTROS", color: "#c2410c", bg: "#fff7ed", border: "#fdba74", dot: "#f97316", headerBg: "linear-gradient(90deg, #ffedd5, #fff7ed)", headerColor: "#c2410c", headerBorder: "#fdba74", headerTag: "🟠 ÚLTIMO REGISTRO" };
  }

  async function fetchTodayBirthdays() {
    try {
      isFetchingBirthdays = true;
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentDay = now.getDate();
      const currentYear = now.getFullYear();

      const q = new URLSearchParams({ mes: String(currentMonth) });
      if (assignedSalaIds.length > 0) q.set("user_sala_ids", assignedSalaIds.join(","));

      const res = await fetch(`/api/master/cumpleanos?${q.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && Array.isArray(json.data)) {
          let list = json.data.filter(c => Number(c.dia) === currentDay);
          if (assignedSalaIds.length > 0) {
            const allowed = new Set(assignedSalaIds.map(Number));
            list = list.filter(c => allowed.has(Number(c.sala_id)));
          }
          todayBirthdays = list.map(c => ({
            ...c,
            age: c.anio_nacimiento ? (currentYear - Number(c.anio_nacimiento)) : null
          }));
          if (activeBirthdayIdx >= todayBirthdays.length) activeBirthdayIdx = 0;
        }
      }
    } catch (e) {
      console.warn("Error cargando cumpleañeros de hoy:", e);
    } finally {
      isFetchingBirthdays = false;
    }
  }

  function nextBirthday() {
    if (todayBirthdays.length > 1) {
      activeBirthdayIdx = (activeBirthdayIdx + 1) % todayBirthdays.length;
    }
  }

  function prevBirthday() {
    if (todayBirthdays.length > 1) {
      activeBirthdayIdx = (activeBirthdayIdx - 1 + todayBirthdays.length) % todayBirthdays.length;
    }
  }

  // Fetch the real absolute latest record directly from DB (without filtering by status)
  async function fetchLatestRecords() {
    try {
      const base = backendUrl.endsWith("/api") ? backendUrl : `${backendUrl}/api`;
      const qLatest = new URLSearchParams({ limit: "1" });
      if (assignedSalaIds.length > 0) {
        qLatest.set("user_sala_ids", assignedSalaIds.join(","));
      }

      const res = await fetch(`${base}/attlogs/latest?${qLatest.toString()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data) && json.data.length > 0) {
          latestRecord = json.data[0];
          lastSeenRecordId = latestRecord.id;
        } else {
          latestRecord = null;
        }
      }
    } catch (e) {
      console.warn("Error fetching latest record:", e);
    }
  }

  // Reactively refetch when assignedSalaIds changes
  let lastSalaKey = null;
  $: {
    const salaKey = (assignedSalaIds || []).join(",");
    if (lastSalaKey !== null && lastSalaKey !== salaKey) {
      lastSalaKey = salaKey;
      fetchLatestRecords();
      fetchTodayBirthdays();
    } else if (lastSalaKey === null && salaKey) {
      lastSalaKey = salaKey;
    }
  }

  const default3HourBlocks = [
    { index: 0, startHour: 0, endHour: 3, label: "00:00 - 03:00", shortLabel: "00-03h", count: 0, slots10: [], peak10Slot: null },
    { index: 1, startHour: 3, endHour: 6, label: "03:00 - 06:00", shortLabel: "03-06h", count: 0, slots10: [], peak10Slot: null },
    { index: 2, startHour: 6, endHour: 9, label: "06:00 - 09:00", shortLabel: "06-09h", count: 0, slots10: [], peak10Slot: null },
    { index: 3, startHour: 9, endHour: 12, label: "09:00 - 12:00", shortLabel: "09-12h", count: 0, slots10: [], peak10Slot: null },
    { index: 4, startHour: 12, endHour: 15, label: "12:00 - 15:00", shortLabel: "12-15h", count: 0, slots10: [], peak10Slot: null },
    { index: 5, startHour: 15, endHour: 18, label: "15:00 - 18:00", shortLabel: "15-18h", count: 0, slots10: [], peak10Slot: null },
    { index: 6, startHour: 18, endHour: 21, label: "18:00 - 21:00", shortLabel: "18-21h", count: 0, slots10: [], peak10Slot: null },
    { index: 7, startHour: 21, endHour: 24, label: "21:00 - 24:00", shortLabel: "21-24h", count: 0, slots10: [], peak10Slot: null },
  ];

  let statsData = {
    total: 0,
    blocks: default3HourBlocks,
    peakBlockIdx: 5,
    peakBlock: default3HourBlocks[5],
    peakSlot: { time: "00:00", range: "00:00 - 00:10", count: 0 },
  };

  let selectedBlockIndex = null;
  $: activeBlockIndex = selectedBlockIndex !== null ? selectedBlockIndex : (statsData.peakBlockIdx ?? 5);
  $: selectedBlock = statsData.blocks.find((b) => b.index === activeBlockIndex) || statsData.blocks[5] || statsData.blocks[0];

  let selectedHourInBlock = null;
  $: maxBlockCount = statsData.blocks?.length ? Math.max(1, ...statsData.blocks.map((b) => b.count)) : 1;
  $: minBlockCount = statsData.blocks?.length ? Math.min(...statsData.blocks.map((b) => b.count)) : 0;

  // Desempate jerárquico para el bloque de menor afluencia:
  // 1) Total del bloque (menor)
  // 2) Hora con menor conteo dentro del bloque (menor)
  // 3) Slot de 10 min con menor conteo dentro del bloque (menor)
  $: minBlockIdx = (function () {
    if (!statsData.blocks || statsData.blocks.length === 0) return 0;
    let bestIdx = 0;
    let bestBlock = statsData.blocks[0];

    function getMinHour(b) {
      if (!b.hours || b.hours.length === 0) return Infinity;
      return Math.min(...b.hours.map((h) => h.count));
    }
    function getMinSlot(b) {
      if (!b.hours || b.hours.length === 0) return Infinity;
      const allSlots = b.hours.flatMap((h) => h.slots10 || []);
      if (allSlots.length === 0) return Infinity;
      return Math.min(...allSlots.map((s) => s.count));
    }

    for (let i = 1; i < statsData.blocks.length; i++) {
      const b = statsData.blocks[i];
      if (b.count < bestBlock.count) {
        bestBlock = b;
        bestIdx = i;
      } else if (b.count === bestBlock.count) {
        const bMinH = getMinHour(b);
        const bestMinH = getMinHour(bestBlock);
        if (bMinH < bestMinH) {
          bestBlock = b;
          bestIdx = i;
        } else if (bMinH === bestMinH) {
          const bMinS = getMinSlot(b);
          const bestMinS = getMinSlot(bestBlock);
          if (bMinS < bestMinS) {
            bestBlock = b;
            bestIdx = i;
          }
        }
      }
    }
    return bestIdx;
  })();

  // Desempate jerárquico para el bloque de mayor afluencia
  $: effectivePeakBlockIdx = (function () {
    if (!statsData.blocks || statsData.blocks.length === 0) return statsData.peakBlockIdx ?? 0;
    let bestIdx = 0;
    let bestBlock = statsData.blocks[0];

    function getMaxHour(b) {
      if (!b.hours || b.hours.length === 0) return -1;
      return Math.max(...b.hours.map((h) => h.count));
    }
    function getMaxSlot(b) {
      if (!b.hours || b.hours.length === 0) return -1;
      const allSlots = b.hours.flatMap((h) => h.slots10 || []);
      if (allSlots.length === 0) return -1;
      return Math.max(...allSlots.map((s) => s.count));
    }

    for (let i = 1; i < statsData.blocks.length; i++) {
      const b = statsData.blocks[i];
      if (b.count > bestBlock.count) {
        bestBlock = b;
        bestIdx = i;
      } else if (b.count === bestBlock.count) {
        const bMaxH = getMaxHour(b);
        const bestMaxH = getMaxHour(bestBlock);
        if (bMaxH > bestMaxH) {
          bestBlock = b;
          bestIdx = i;
        } else if (bMaxH === bestMaxH) {
          const bMaxS = getMaxSlot(b);
          const bestMaxS = getMaxSlot(bestBlock);
          if (bMaxS > bestMaxS) {
            bestBlock = b;
            bestIdx = i;
          }
        }
      }
    }
    return bestIdx;
  })();

  // Aplanar todos los 144 slots de 10 min del día con su contexto
  $: allDaySlots10 = (function () {
    if (!statsData.blocks || statsData.blocks.length === 0) return [];
    const list = [];
    for (const b of statsData.blocks) {
      if (!b.hours) continue;
      for (const h of b.hours) {
        if (!h.slots10) continue;
        for (const s of h.slots10) {
          list.push({
            ...s,
            blockIndex: b.index,
            blockCount: b.count,
            hour: h.hour,
            hourCount: h.count,
          });
        }
      }
    }
    return list;
  })();

  // Slot global de 10 min de mayor afluencia en todo el día
  $: globalMax10Slot = (function () {
    if (allDaySlots10.length === 0) return null;
    let best = allDaySlots10[0];
    for (const s of allDaySlots10) {
      if (s.count > best.count) {
        best = s;
      } else if (s.count === best.count) {
        if (s.hourCount > best.hourCount) {
          best = s;
        } else if (s.hourCount === best.hourCount && s.blockCount > best.blockCount) {
          best = s;
        }
      }
    }
    return best;
  })();

  // Slot global de 10 min de menor afluencia en todo el día
  $: globalMin10Slot = (function () {
    if (allDaySlots10.length === 0) return null;
    let best = allDaySlots10[0];
    for (const s of allDaySlots10) {
      if (s.count < best.count) {
        best = s;
      } else if (s.count === best.count) {
        if (s.hourCount < best.hourCount) {
          best = s;
        } else if (s.hourCount === best.hourCount && s.blockCount < best.blockCount) {
          best = s;
        }
      }
    }
    return best;
  })();

  function getBest10SlotInBlock(blk, mode) {
    if (!blk || !blk.hours || blk.hours.length === 0) return null;
    const slots = [];
    for (const h of blk.hours) {
      if (!h.slots10) continue;
      for (const s of h.slots10) {
        slots.push({ ...s, blockIndex: blk.index, hour: h.hour, hourCount: h.count });
      }
    }
    if (slots.length === 0) return null;
    let best = slots[0];
    for (const s of slots) {
      if (mode === 'min') {
        if (s.count < best.count) {
          best = s;
        } else if (s.count === best.count && s.hourCount < best.hourCount) {
          best = s;
        }
      } else {
        if (s.count > best.count) {
          best = s;
        } else if (s.count === best.count && s.hourCount > best.hourCount) {
          best = s;
        }
      }
    }
    return best;
  }

  function getBest10SlotInHour(hrObj, mode) {
    if (!hrObj || !hrObj.slots10 || hrObj.slots10.length === 0) return null;
    let best = hrObj.slots10[0];
    for (const s of hrObj.slots10) {
      if (mode === 'min') {
        if (s.count < best.count) best = s;
      } else {
        if (s.count > best.count) best = s;
      }
    }
    return best;
  }

  $: targetSlotInSelectedBlock = getBest10SlotInBlock(selectedBlock, afluenciaMode);

  $: activeHourObj = (function () {
    if (!selectedBlock || !selectedBlock.hours || selectedBlock.hours.length === 0) return null;
    if (selectedHourInBlock !== null) {
      const found = selectedBlock.hours.find((h) => h.hour === selectedHourInBlock);
      if (found) return found;
    }
    const targetH = targetSlotInSelectedBlock?.hour;
    return selectedBlock.hours.find((h) => h.hour === targetH) || selectedBlock.hours[0];
  })();

  $: targetSlotInActiveHour = getBest10SlotInHour(activeHourObj, afluenciaMode);

  let selected10Slot = null;
  $: active10Slot = selected10Slot || targetSlotInActiveHour || { time: "--:--", range: "--:--", count: 0 };

  let afluenciaMode = 'max'; // 'max' | 'min'

  function selectBlock(index) {
    selectedBlockIndex = index;
    const blk = statsData.blocks.find((b) => b.index === index);
    const targetSlot = getBest10SlotInBlock(blk, afluenciaMode);
    if (targetSlot) {
      selectedHourInBlock = targetSlot.hour;
      selected10Slot = targetSlot;
    } else {
      selectedHourInBlock = blk?.hours?.[0]?.hour ?? null;
      selected10Slot = null;
    }
  }

  function selectHourButton(hr) {
    selectedHourInBlock = hr.hour;
    const targetSlot = getBest10SlotInHour(hr, afluenciaMode);
    selected10Slot = targetSlot || null;
  }

  function computeGlobalSlots(blocks) {
    if (!blocks || blocks.length === 0) return { max: null, min: null };
    const list = [];
    for (const b of blocks) {
      if (!b.hours) continue;
      for (const h of b.hours) {
        if (!h.slots10) continue;
        for (const s of h.slots10) {
          list.push({
            ...s,
            blockIndex: b.index,
            blockCount: b.count,
            hour: h.hour,
            hourCount: h.count,
          });
        }
      }
    }
    if (list.length === 0) return { max: null, min: null };

    let maxSlot = list[0];
    let minSlot = list[0];

    for (const s of list) {
      if (s.count > maxSlot.count) {
        maxSlot = s;
      } else if (s.count === maxSlot.count) {
        if (s.hourCount > maxSlot.hourCount) maxSlot = s;
        else if (s.hourCount === maxSlot.hourCount && s.blockCount > maxSlot.blockCount) maxSlot = s;
      }

      if (s.count < minSlot.count) {
        minSlot = s;
      } else if (s.count === minSlot.count) {
        if (s.hourCount < minSlot.hourCount) minSlot = s;
        else if (s.hourCount === minSlot.hourCount && s.blockCount < minSlot.blockCount) minSlot = s;
      }
    }

    return { max: maxSlot, min: minSlot };
  }

  function setAfluenciaMode(mode) {
    afluenciaMode = mode;
    const { max, min } = computeGlobalSlots(statsData.blocks);
    const targetSlot = mode === 'min' ? min : max;
    if (targetSlot) {
      selectedBlockIndex = targetSlot.blockIndex;
      selectedHourInBlock = targetSlot.hour;
      selected10Slot = targetSlot;
    }
  }

  function toggleAfluenciaMode() {
    setAfluenciaMode(afluenciaMode === 'max' ? 'min' : 'max');
  }

  function formatLocalDate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  let currentDate = new Date();
  let isTraerTodo = true; // Por defecto arranca en traer todo
  let isFetchingStats = false;

  $: selectedDateStr = formatLocalDate(currentDate);
  $: todayDateStr = formatLocalDate(new Date());
  $: formattedSelectedDateText = isTraerTodo
    ? 'TODO'
    : selectedDateStr === todayDateStr
    ? `${selectedDateStr} (Hoy)`
    : selectedDateStr;

  function prevDay() {
    if (isTraerTodo) {
      isTraerTodo = false;
      currentDate = new Date();
    } else {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 1);
      currentDate = d;
    }
    fetchAttlogsStats();
  }

  function nextDay() {
    if (isTraerTodo) {
      isTraerTodo = false;
      currentDate = new Date();
    } else {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 1);
      currentDate = d;
    }
    fetchAttlogsStats();
  }

  function traerTodo() {
    isTraerTodo = true;
    currentDate = new Date();
    fetchAttlogsStats();
  }

  async function fetchAttlogsStats() {
    try {
      isFetchingStats = true;
      const base = backendUrl.endsWith("/api") ? backendUrl : `${backendUrl}/api`;
      const salaParam = assignedSalaIds.length > 0 ? assignedSalaIds.join(",") : "-1";
      let url = `${base}/attlogs/stats?sala_ids=${salaParam}`;

      if (!isTraerTodo) {
        const dateStr = formatLocalDate(currentDate);
        url += `&start_date=${encodeURIComponent(dateStr + 'T00:00:00')}&end_date=${encodeURIComponent(dateStr + 'T23:59:59')}`;
      }

      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          statsData = json.data;
          const { max, min } = computeGlobalSlots(json.data.blocks);
          const targetSlot = afluenciaMode === 'min' ? min : max;
          if (targetSlot) {
            selectedBlockIndex = targetSlot.blockIndex;
            selectedHourInBlock = targetSlot.hour;
            selected10Slot = targetSlot;
          }
        }
      }
    } catch (e) {
      console.warn("Error fetching attlog stats:", e);
    } finally {
      isFetchingStats = false;
    }
  }

  let unsubscribeAttlog = null;

  onMount(() => {
    fetchLatestRecords();
    fetchTodayBirthdays();
    fetchAttlogsStats();

    // Suscripción al WebSocket para cualquier nuevo marcaje en vivo
    unsubscribeAttlog = latestAttlogEventStore.subscribe((rec) => {
      if (!rec) return;
      const recSalaId = Number(rec.sala_id || rec.dispositivo_sala_id);
      if (recSalaId && assignedSalaIds.length > 0 && !assignedSalaIds.includes(recSalaId)) return;
      const timeRec = new Date(rec.event_time).getTime() || 0;
      const timeCur = latestRecord ? (new Date(latestRecord.event_time).getTime() || 0) : 0;
      if (!latestRecord || timeRec > timeCur || (timeRec === timeCur && Number(rec.id || 0) >= Number(latestRecord.id || 0))) {
        if (lastSeenRecordId !== null && Number(lastSeenRecordId) !== Number(rec.id)) {
          triggerFlashRecord();
          fetchAttlogsStats();
        }
        lastSeenRecordId = rec.id;
        latestRecord = rec;
      }
    });
  });

  onDestroy(() => {
    if (unsubscribeAttlog) unsubscribeAttlog();
    if (pollTimer) clearInterval(pollTimer);
    if (flashRecordTimer) clearTimeout(flashRecordTimer);
  });

  function openAttlogModal(record) {
    if (!record) return;
    window.dispatchEvent(
      new CustomEvent("wisi:open-attlog-modal", { detail: record }),
    );
  }
</script>

<div style="margin-bottom: 24px;">
  <!-- Top Row: 3 KPI Cards (Proporción 3, 3, 6: Gráfica al 50%, Entrada al 25%, Salida al 25%) -->
  <div class="dashboard-kpi-grid" style="margin-bottom: 20px;">

    <!-- ════════════════════════════════════════════════════════
         Card 1: ÚLTIMO REGISTRO — Absolute latest punch
         ════════════════════════════════════════════════════════ -->
    <div
      class="flow-card {isFlashingRecord ? 'glow-flashing-card' : ''}"
      style="display:flex;flex-direction:column;transition:all 0.3s ease;position:relative;background:#ffffff;padding:0;overflow:hidden;"
    >
      <!-- Dynamic section header depending on status (Entrada, Salida, Puerta / Otros) -->
      <div style="padding:8px 16px;background:{statusInfo.headerBg};border-bottom:1px solid {statusInfo.headerBorder};">
        <span style="font-size:11px;font-weight:900;letter-spacing:1px;text-transform:uppercase;color:{statusInfo.headerColor};">
          {statusInfo.headerTag}
        </span>
      </div>

      <div style="padding:14px 16px;flex:1;display:flex;flex-direction:column;justify-content:space-between;">
        {#if latestRecord}
          <!-- Sub-header -->
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <span style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">ÚLTIMO REGISTRO</span>
            <span style="font-size:12px;font-weight:800;display:inline-flex;align-items:center;gap:5px;color:{statusInfo.color};">
              <span style="width:10px;height:10px;border-radius:50%;display:inline-block;background:{statusInfo.dot};"></span>
              {statusInfo.label}
            </span>
          </div>
          <!-- Photo + Name -->
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;">
            <button
              type="button"
              on:click={() => openAttlogModal(latestRecord)}
              style="position:relative;width:60px;height:60px;flex-shrink:0;padding:0;border:none;background:transparent;cursor:pointer;border-radius:50%;outline:none;"
              title="Ver marcajes en lista global"
            >
              <img
                src={getRecordPhoto(latestRecord)}
                alt="Foto marcaje"
                style="width:60px;height:60px;border-radius:50%;object-fit:cover;border:3px solid {statusInfo.dot};box-shadow:0 4px 12px rgba(0,0,0,0.12);"
                on:error={(e) => {
                  const img = e.currentTarget;
                  const fallback = getFallbackProfilePhoto(latestRecord);
                  if (!img.dataset.triedEmp && fallback && !img.src.endsWith(fallback)) {
                    img.dataset.triedEmp = 'true';
                    img.src = fallback;
                  } else {
                    img.style.display = 'none';
                    if (img.nextElementSibling) img.nextElementSibling.style.display = 'flex';
                  }
                }}
              />
              <div style="display:none;width:60px;height:60px;border-radius:50%;background:{getAvatarColor(latestRecord.employee_no)};color:#fff;font-weight:800;font-size:20px;align-items:center;justify-content:center;">
                {getInitials(toTitleCase(latestRecord.nombre), latestRecord.employee_no)}
              </div>
              <span style="position:absolute;bottom:0;right:0;width:18px;height:18px;border-radius:50%;background:#2563eb;color:#fff;font-size:9px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;">🔍</span>
            </button>
            <div style="flex:1;min-width:0;">
              <span style="font-size:15px;font-weight:800;color:#0f172a;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                title={toTitleCase(latestRecord.nombre) || `Empleado ${(latestRecord.employee_no||'').replace(/^#/,'')}`}>
                {toTitleCase(latestRecord.nombre) || `Empleado ${(latestRecord.employee_no||'').replace(/^#/,'')}`}
              </span>
              <span style="font-size:12px;font-weight:700;color:#2563eb;font-family:monospace;display:block;margin-top:2px;">
                {(latestRecord.employee_no||'').replace(/^#/,'')}
              </span>
            </div>
          </div>
          <!-- Metadata -->
          <div style="background:#f8fafc;border:1px solid #f1f5f9;border-radius:10px;padding:10px 12px;font-size:12px;">
            <div style="display:flex;align-items:center;gap:6px;font-weight:800;color:#0f172a;margin-bottom:5px;">
              <span>🕒</span><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{formatEventTime(latestRecord.event_time)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;color:#db2777;font-weight:600;min-width:0;overflow:hidden;">
              <span style="flex-shrink:0;">📍</span>
              <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                title="{latestRecord.sala_nombre||'Sala'} ({latestRecord.dispositivo_nombre||'Biométrico'})">
                {latestRecord.sala_nombre||'Sala'} ({latestRecord.dispositivo_nombre||'Marcaje Personal'})
              </span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;color:#1e3a8a;font-weight:700;margin-top:6px;border-top:1px dashed #cbd5e1;padding-top:5px;">
              <span>📊</span><span>Total acumulado: <strong>{latestRecord.total_employee_attlogs||1} marcajes</strong></span>
            </div>
          </div>
        {:else}
          <div style="padding:32px 0;text-align:center;color:#94a3b8;font-size:13px;">⏳ Sin marcajes recientes...</div>
        {/if}
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════
         Card 2: CUMPLEAÑEROS DE HOY — Today's celebrants
         ════════════════════════════════════════════════════════ -->
    <div
      class="flow-card"
      style="display:flex;flex-direction:column;transition:all 0.3s ease;position:relative;background:#ffffff;padding:0;overflow:hidden;"
    >
      <!-- Festive celebration header -->
      <div style="padding:8px 16px;background:linear-gradient(90deg,#fdf4ff,#fae8ff);border-bottom:1px solid #f0abfc;display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:11px;font-weight:900;letter-spacing:1px;text-transform:uppercase;color:#a21caf;">
          🎂 CUMPLEAÑEROS DE HOY
        </span>
        {#if todayBirthdays.length > 0}
          <span style="font-size:10px;font-weight:800;background:#a21caf;color:#fff;padding:1px 7px;border-radius:10px;box-shadow:0 1px 3px rgba(162,28,175,0.3);">
            {todayBirthdays.length} {todayBirthdays.length === 1 ? 'cumpleañero' : 'cumpleañeros'}
          </span>
        {/if}
      </div>

      <div style="padding:14px 16px;flex:1;display:flex;flex-direction:column;justify-content:space-between;">
        {#if isFetchingBirthdays}
          <div style="padding:32px 0;text-align:center;color:#a21caf;font-size:13px;font-weight:600;">
            ⏳ Cargando cumpleañeros...
          </div>
        {:else if todayBirthdays.length > 0}
          {@const currentCelebrant = todayBirthdays[activeBirthdayIdx] || todayBirthdays[0]}
          <!-- Sub-header con controles si hay varios -->
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <span style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">
              🎉 ¡HOY DE FIESTA!
            </span>
            {#if todayBirthdays.length > 1}
              <div style="display:flex;align-items:center;gap:4px;">
                <button
                  type="button"
                  on:click={prevBirthday}
                  style="width:22px;height:22px;border-radius:4px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;color:#475569;"
                  title="Anterior cumpleañero"
                >◀</button>
                <span style="font-size:11px;font-weight:800;color:#a21caf;font-family:monospace;padding:0 4px;">
                  {activeBirthdayIdx + 1}/{todayBirthdays.length}
                </span>
                <button
                  type="button"
                  on:click={nextBirthday}
                  style="width:22px;height:22px;border-radius:4px;border:1px solid #e2e8f0;background:#f8fafc;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;color:#475569;"
                  title="Siguiente cumpleañero"
                >▶</button>
              </div>
            {:else}
              <span style="font-size:11.5px;font-weight:800;display:inline-flex;align-items:center;gap:4px;color:#a21caf;">
                🎈 ¡Felicidades!
              </span>
            {/if}
          </div>

          <!-- Photo + Name -->
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;">
            <div style="position:relative;width:60px;height:60px;flex-shrink:0;">
              <img
                src={currentCelebrant.foto ? (currentCelebrant.foto.startsWith('/') ? currentCelebrant.foto : `/${currentCelebrant.foto}`) : `/empleados/${currentCelebrant.id}.jpg`}
                alt="Foto cumpleañero"
                style="width:60px;height:60px;border-radius:50%;object-fit:cover;border:3px solid #d946ef;box-shadow:0 4px 12px rgba(217,70,239,0.25);"
                on:error={(e) => {
                  e.currentTarget.style.display = 'none';
                  if (e.currentTarget.nextElementSibling) e.currentTarget.nextElementSibling.style.display = 'flex';
                }}
              />
              <div style="display:none;width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg, #d946ef, #a21caf);color:#fff;font-weight:800;font-size:20px;align-items:center;justify-content:center;">
                {getInitials(toTitleCase(currentCelebrant.nombre), currentCelebrant.cedula)}
              </div>
              <span style="position:absolute;bottom:-2px;right:-2px;font-size:16px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.2));" title="¡Feliz cumpleaños!">
                🎂
              </span>
            </div>
            <div style="flex:1;min-width:0;">
              <span style="font-size:15px;font-weight:800;color:#0f172a;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                title={toTitleCase(currentCelebrant.nombre)}>
                {toTitleCase(currentCelebrant.nombre)}
              </span>
              <div style="display:flex;align-items:center;gap:6px;margin-top:2px;flex-wrap:wrap;">
                <span style="font-size:12px;font-weight:700;color:#2563eb;font-family:monospace;">
                  {currentCelebrant.cedula || ''}
                </span>
                {#if currentCelebrant.age}
                  <span style="font-size:10.5px;font-weight:800;background:#fae8ff;color:#a21caf;padding:1px 6px;border-radius:4px;border:1px solid #f0abfc;">
                    {currentCelebrant.age} años
                  </span>
                {/if}
              </div>
            </div>
          </div>

          <!-- Metadata: Cargo y Sala -->
          <div style="background:#fdf4ff;border:1px solid #fae8ff;border-radius:10px;padding:10px 12px;font-size:12px;">
            <div style="display:flex;align-items:center;gap:6px;font-weight:800;color:#0f172a;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              <span>💼</span><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title={currentCelebrant.cargo_nombre || 'Empleado'}>{currentCelebrant.cargo_nombre || 'Empleado'}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;color:#a21caf;font-weight:700;min-width:0;overflow:hidden;">
              <span style="flex-shrink:0;">📍</span>
              <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title={currentCelebrant.sala_nombre || 'Sala'}>
                {currentCelebrant.sala_nombre || 'Sala'}
              </span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;color:#c026d3;font-weight:700;margin-top:6px;border-top:1px dashed #f5d0fe;padding-top:5px;">
              <span>🎁</span><span>{currentCelebrant.age ? `¡Celebrando sus ${currentCelebrant.age} años!` : '¡Celebrando su cumpleaños hoy!'}</span>
            </div>
          </div>
        {:else}
          <!-- Sin cumpleañeros hoy -->
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:22px 10px;text-align:center;">
            <div style="width:46px;height:46px;border-radius:50%;background:#fdf4ff;border:1px solid #f0abfc;display:flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:8px;">
              🎂
            </div>
            <span style="font-size:13px;font-weight:800;color:#475569;margin-bottom:4px;">
              No hay cumpleañeros el día de hoy
            </span>
            <span style="font-size:11px;font-weight:600;color:#94a3b8;max-width:220px;">
              ¡Revisa el Calendario RRHH para consultar las fechas del mes!
            </span>
          </div>
        {/if}
      </div>
    </div>

    <!-- ════════════════════════════════════════════════════════
         Card 3: GRAFICA DE REGISTROS — Stats + Peak block unified
         ════════════════════════════════════════════════════════ -->
    <div
      class="flow-card"
      style="display:flex;flex-direction:column;background:#ffffff;padding:0;overflow:hidden;"
    >
      <!-- Green section header con selector de rango de fecha, botones e interruptor -->
      <div style="padding: 6px 14px; background: linear-gradient(90deg, #f0fdf4, #f8fafc); border-bottom: 1px solid #86efac; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 11px; font-weight: 900; letter-spacing: 0.8px; text-transform: uppercase; color: #15803d; white-space: nowrap;">
            📈 AFLUENCIA
          </span>
          {#if isFetchingStats}
            <span style="font-size: 9px; font-weight: 700; color: #16a34a; display: inline-flex; align-items: center; gap: 3px;">
              ⏳ Actualizando...
            </span>
          {/if}
        </div>

        <!-- Controles de Fecha: [◀] [Fecha deshabilitada solo ver] [▶] | [🌐 Traer Todo] -->
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <!-- Selector de Día: 1 día atrás / Fecha / 1 día adelante -->
          <div style="display: flex; align-items: center; gap: 4px; background: #ffffff; padding: 2px 5px; border-radius: 6px; border: 1px solid #bbf7d0; box-shadow: 0 1px 2px rgba(0,0,0,0.04);">
            <button
              type="button"
              on:click={prevDay}
              disabled={isFetchingStats}
              style="display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 22px; background: #f8fafc; color: #166534; border: 1px solid #cbd5e1; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 900; transition: all 0.15s ease;"
              title="Un día atrás"
            >
              ◀
            </button>

            <input
              type="text"
              readonly
              disabled
              value="{formattedSelectedDateText}"
              style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 8px; font-size: 10px; font-weight: 800; color: #0f172a; text-align: center; width: 125px; cursor: default; user-select: none; font-family: monospace;"
              title="Fecha visualizada (Solo lectura)"
            />

            <button
              type="button"
              on:click={nextDay}
              disabled={isFetchingStats}
              style="display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 22px; background: #f8fafc; color: #166534; border: 1px solid #cbd5e1; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 900; transition: all 0.15s ease;"
              title="Un día adelante"
            >
              ▶
            </button>
          </div>

          <!-- Botón Traer Todo -->
          <button
            type="button"
            on:click={traerTodo}
            disabled={isFetchingStats}
            style="display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; font-size: 9px; font-weight: 800; border-radius: 6px; cursor: pointer; transition: all 0.15s ease;
            {isTraerTodo
              ? 'background: #16a34a; color: #ffffff; border: 1px solid #15803d; box-shadow: 0 1px 3px rgba(22, 163, 74, 0.3); font-weight: 900;'
              : 'background: #ffffff; color: #475569; border: 1px solid #cbd5e1;'}"
            title="Traer todos los registros sin filtro y reiniciar a la fecha de hoy"
          >
            🌐 Traer Todo
          </button>
        </div>
      </div>

      <div style="padding:12px 16px;flex:1;display:flex;flex-direction:column;gap:10px;">
        <!-- Row: Total Marcajes + 3 Botones de Hora debajo | Recuadro Pico 10M arriba a la derecha -->
        <div style="display: flex; justify-content: space-between; align-items: stretch; gap: 14px; flex-wrap: wrap;">
          <!-- Izquierda: Total Marcajes + Interruptor Mayor/Menor + Recuadro con 3 botones de horas -->
          <div style="flex-shrink: 0; min-width: 170px; display: flex; flex-direction: column; justify-content: space-between; gap: 6px;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
              <div>
                <span style="font-size: 10px; font-weight: 700; color: #64748b; display: block; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px;">Total Marcajes</span>
                <span style="font-size: 26px; font-weight: 900; color: #0f172a; line-height: 1;">{statsData.total}</span>
              </div>

              <!-- Interruptor Mayor / Menor afluencia -->
              <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px;">
                <span style="font-size: 7.5px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px;">Afluencia:</span>
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div
                  on:click={toggleAfluenciaMode}
                  style="display: inline-flex; align-items: center; background: #f1f5f9; padding: 2px; border-radius: 8px; border: 1px solid #cbd5e1; cursor: pointer; user-select: none;"
                  title="Click para alternar entre Mayor y Menor afluencia"
                >
                  <button
                    type="button"
                    on:click|stopPropagation={() => setAfluenciaMode('max')}
                    style="display: flex; align-items: center; gap: 2px; padding: 2.5px 5px; font-size: 8px; font-weight: 800; border-radius: 6px; border: none; cursor: pointer; transition: all 0.15s ease;
                    {afluenciaMode === 'max'
                      ? 'background: #ffffff; color: #ea580c; box-shadow: 0 1px 3px rgba(234, 88, 12, 0.25); border: 1px solid #fed7aa;'
                      : 'background: transparent; color: #64748b;'}"
                  >
                    🔥 Mayor
                  </button>
                  <button
                    type="button"
                    on:click|stopPropagation={() => setAfluenciaMode('min')}
                    style="display: flex; align-items: center; gap: 2px; padding: 2.5px 5px; font-size: 8px; font-weight: 800; border-radius: 6px; border: none; cursor: pointer; transition: all 0.15s ease;
                    {afluenciaMode === 'min'
                      ? 'background: #ffffff; color: #475569; box-shadow: 0 1px 3px rgba(71, 85, 105, 0.25); border: 1px solid #cbd5e1;'
                      : 'background: transparent; color: #64748b;'}"
                  >
                    📉 Menor
                  </button>
                </div>
              </div>
            </div>

            <!-- Recuadro de 3 botones (las 3 horas del bloque seleccionado) -->
            {#if selectedBlock?.hours && selectedBlock.hours.length > 0}
              <div style="background: #f8fafc; padding: 4px 6px; border-radius: 8px; border: 1px solid #e2e8f0; display: flex; flex-direction: column; gap: 3px;">
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 8px; font-weight: 800; color: #64748b; text-transform: uppercase;">
                  <span>Horas:</span>
                  <span style="color: #0284c7; font-weight: 900;">{selectedBlock.shortLabel}</span>
                </div>
                <div style="display: flex; gap: 3px;">
                  {#each selectedBlock.hours as hr}
                    {@const isTargetHour = hr.hour === targetSlotInSelectedBlock?.hour}
                    {@const isHourActive = activeHourObj?.hour === hr.hour}
                    <button
                      type="button"
                      on:click={() => selectHourButton(hr)}
                      style="flex: 1; padding: 3px 2px; font-size: 8.5px; font-weight: 800; border-radius: 5px; cursor: pointer; transition: all 0.15s ease; text-align: center; white-space: nowrap;
                      {isHourActive
                        ? afluenciaMode === 'min'
                          ? 'border: 1.5px solid #475569; background: linear-gradient(135deg, #64748b, #475569); color: #ffffff; box-shadow: 0 2px 5px rgba(71, 85, 105, 0.35);'
                          : 'border: 1.5px solid #ea580c; background: linear-gradient(135deg, #f97316, #ea580c); color: #ffffff; box-shadow: 0 2px 5px rgba(234, 88, 12, 0.35);'
                        : isTargetHour
                        ? afluenciaMode === 'min'
                          ? 'border: 1.5px solid #94a3b8; background: #f1f5f9; color: #475569;'
                          : 'border: 1.5px solid #f97316; background: #ffedd5; color: #c2410c;'
                        : 'border: 1px solid #cbd5e1; background: #ffffff; color: #475569;'}"
                      title="{hr.label}: {hr.count} marcajes"
                    >
                      {hr.label}{#if isTargetHour}{afluenciaMode === 'max' ? '★' : '▼'}{/if}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          </div>

          <!-- Derecha: Recuadro Pico / Mínimo 10M con sus 6 botones de 10 min -->
          <div style="flex: 1; min-width: 280px; background: #f8fafc; padding: 8px 12px; border-radius: 10px; border: 1px solid #e2e8f0; display: flex; flex-direction: column; justify-content: space-between; gap: 6px;">
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 8px; border-bottom: 1px solid #edf2f7; padding-bottom: 4px;">
              <span style="font-size: 9.5px; font-weight: 800; color: #475569; text-transform: uppercase; display: flex; align-items: center; gap: 4px;">
                <span>{afluenciaMode === 'min' ? '📉' : '🔥'}</span>
                {afluenciaMode === 'min' ? 'MÍNIMO (10M)' : 'PICO (10M)'} • <strong style="color: #0f172a;">Hora {activeHourObj?.label || ''}</strong>
              </span>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 11.5px; font-weight: 900; color: {afluenciaMode === 'min' ? '#475569' : '#ea580c'};">
                  {afluenciaMode === 'min' ? '▼' : '⚡'} {active10Slot?.range || active10Slot?.time || '--:--'}
                </span>
                <span style="font-size: 9.5px; font-weight: 700; color: #64748b;">
                  ({active10Slot?.count || 0} marcajes)
                </span>
              </div>
            </div>

            <!-- Los 6 botones de 10 min de la hora activa -->
            {#if activeHourObj?.slots10 && activeHourObj.slots10.length > 0}
              <div style="display: flex; gap: 3.5px; width: 100%;">
                {#each activeHourObj.slots10 as b10}
                  {@const isTargetSlot = b10.slot === targetSlotInActiveHour?.slot}
                  {@const isSelected = active10Slot?.slot === b10.slot}
                  <button
                    type="button"
                    on:click={() => (selected10Slot = b10)}
                    style="flex: 1; padding: 4px 2px; font-size: 8.5px; font-weight: 800; border-radius: 5px; cursor: pointer; text-align: center; transition: all 0.15s ease;
                    {isSelected
                      ? afluenciaMode === 'min'
                        ? 'border: 1.5px solid #475569; background: linear-gradient(135deg, #64748b, #475569); color: #ffffff; box-shadow: 0 2px 5px rgba(71, 85, 105, 0.35);'
                        : 'border: 1.5px solid #ea580c; background: linear-gradient(135deg, #f97316, #ea580c); color: #ffffff; box-shadow: 0 2px 5px rgba(234, 88, 12, 0.35);'
                      : isTargetSlot
                      ? afluenciaMode === 'min'
                        ? 'border: 1.5px solid #94a3b8; background: #f1f5f9; color: #475569;'
                        : 'border: 1.5px solid #f97316; background: #ffedd5; color: #c2410c;'
                      : 'border: 1px solid #cbd5e1; background: #ffffff; color: #475569;'}"
                    title="{b10.range}: {b10.count} marcajes {isTargetSlot ? (afluenciaMode === 'min' ? '📉 Menor afluencia' : '🔥 Mayor afluencia') : ''}"
                  >
                    {b10.time}{#if isTargetSlot}{afluenciaMode === 'max' ? '★' : '▼'}{/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <!-- Bloques Horarios (8 Bloques de 3 Horas con selección interactiva) -->
        <div style="margin-top: 4px;">
          <div style="display: flex; justify-content: space-between; font-size: 9.5px; font-weight: 700; color: #64748b; margin-bottom: 4px;">
            <span>Bloques Horarios (8 Bloques de 3 Horas) — <em style="font-weight: 600; color: #0284c7;">Click en barra para ver 10m</em>:</span>
            <span style="font-weight: 800; color: #2563eb;">{statsData.total} marcajes</span>
          </div>

          <div style="height: 88px; display: flex; align-items: flex-end; gap: 6px; padding: 6px 8px 2px 8px; background: #f8fafc; border-radius: 8px; border: 1px solid #f1f5f9;">
            {#each statsData.blocks as block}
              {@const isSelectedBlock = block.index === activeBlockIndex}
              <!-- svelte-ignore a11y-click-events-have-key-events -->
              <!-- svelte-ignore a11y-no-static-element-interactions -->
              <div
                on:click={() => selectBlock(block.index)}
                style="flex: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; cursor: pointer; transition: transform 0.15s ease;"
                title="{block.label}: {block.count} marcajes"
              >
                <span
                  style="font-size: 8.5px; font-weight: {isSelectedBlock ? '900' : '800'}; letter-spacing: -0.5px; margin-bottom: 2px; line-height: 1; white-space: nowrap;
                  color: {isSelectedBlock ? (afluenciaMode === 'max' ? '#ea580c' : '#475569') : '#2563eb'};"
                >
                  {block.count}
                </span>
                <div
                  style="width: 100%; height: {Math.max(6, Math.round((block.count / maxBlockCount) * 78))}%; border-radius: 4px 4px 0 0; transition: all 0.2s ease;
                  {isSelectedBlock
                    ? afluenciaMode === 'max'
                      ? 'box-shadow: 0 0 0 2px #0f172a, 0 0 8px rgba(234, 88, 12, 0.6); transform: translateY(-2px);'
                      : 'box-shadow: 0 0 0 2px #0f172a, 0 0 8px rgba(71, 85, 105, 0.6); transform: translateY(-2px);'
                    : ''}
                  background: {isSelectedBlock
                    ? afluenciaMode === 'max'
                      ? 'linear-gradient(180deg, #f97316, #ea580c)'
                      : 'linear-gradient(180deg, #94a3b8, #64748b)'
                    : 'linear-gradient(180deg, #3b82f6, #1d4ed8)'};"
                ></div>
              </div>
            {/each}
          </div>

          <!-- Milestones de los 8 bloques de 3 horas -->
          <div style="display: flex; gap: 6px; font-size: 8.5px; font-weight: 800; color: #64748b; margin-top: 4px; padding: 0 8px;">
            {#each statsData.blocks as block}
              <div
                style="flex: 1; text-align: center;
                color: {block.index === activeBlockIndex ? (afluenciaMode === 'max' ? '#ea580c' : '#475569') : '#64748b'};
                font-weight: {block.index === activeBlockIndex ? '900' : '700'};"
              >
                {block.shortLabel}
              </div>
            {/each}
          </div>
        </div>
      </div>
    </div>

  </div>

  <!-- Second Row: Real-Time Attendance Carousel -->
  <AttlogCarousel bind:this={carouselRef} />
</div>

<style>
  @keyframes borderGlowPulse {
    0% {
      box-shadow:
        0 0 0 0 rgba(37, 99, 235, 0.8),
        0 0 25px 6px rgba(59, 130, 246, 0.6);
      border-color: #3b82f6;
    }
    50% {
      box-shadow:
        0 0 0 12px rgba(37, 99, 235, 0),
        0 0 40px 12px rgba(59, 130, 246, 0.9);
      border-color: #60a5fa;
    }
    100% {
      box-shadow:
        0 0 0 0 rgba(37, 99, 235, 0),
        0 0 0 0 rgba(59, 130, 246, 0);
      border-color: #e2e8f0;
    }
  }

  .dashboard-kpi-grid {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 3fr) minmax(0, 6fr);
    gap: 20px;
  }

  @media (max-width: 1024px) {
    .dashboard-kpi-grid {
      grid-template-columns: 1fr;
    }
  }

  .glow-flashing-card {
    animation: borderGlowPulse 1.2s infinite ease-in-out !important;
    border: 2px solid #3b82f6 !important;
  }
</style>
