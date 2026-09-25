<script>
  import { onMount } from 'svelte';
  import { jsPDF } from 'jspdf';
  import autoTable from 'jspdf-autotable';
  import { saveOrShareFile } from '../../utils/fileSaver.js';
  import { navigateToRoute } from '../../controllers/router.store.js';
  import { triggerToast } from '../../controllers/ui.store.js';
  import { getPublicWebUrl, toBackendUrl } from '../../config/api.config.js';

  export let isPublic = false;
  export let subtipo = 'simple';
  export let reporteUuid = null;

  let items = [];
  let isLoading = true;
  let isGeneratingPdf = false;
  let isSavingReporte = false;
  let printableAreaEl;
  let generadoEn = '';
  let activeTab = subtipo || 'simple'; // 'simple' | 'sociedad' | 'salas' | 'galpones' | 'tipo' | 'marcas'

  // Modales
  let resumenModalOpen = false;
  let resumenModalData = null; // { title, items: [{ label, count }] }

  let detalleModalOpen = false;
  let detalleModalData = null; // { title, marcasModelos: [], juegos: [], estados: [], valores: [] }

  let queryString = '';
  let currentReporteUuid = null;

  onMount(async () => {
    generadoEn = new Date().toLocaleString('es-ES', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    parseRouteAndQuery();
    await loadData();
  });

  function parseRouteAndQuery() {
    if (typeof window === 'undefined') return;

    if (!currentReporteUuid && reporteUuid) {
      currentReporteUuid = reporteUuid;
    }

    const hash = window.location.hash || '';
    const qIndex = hash.indexOf('?');
    if (qIndex !== -1) {
      queryString = hash.substring(qIndex + 1);
    } else {
      const pIndex = window.location.search.indexOf('?');
      if (pIndex !== -1) {
        queryString = window.location.search.substring(pIndex + 1);
      }
    }

    // Si viene en pathname o hash con el formato /reportes/maquinas/shared/:uuid o /reportes/maquinas/:uuid
    const pathCandidate = (window.location.pathname.replace(/^\//, '') || hash.replace(/^#\/?/, '')).split('?')[0];
    const pathParts = pathCandidate.split('/').filter(Boolean);
    if (pathParts.length >= 3 && pathParts[0] === 'reportes' && pathParts[1] === 'maquinas') {
      if (pathParts[2] === 'shared' && pathParts[3]) {
        currentReporteUuid = pathParts[3];
        if (pathParts[4]) {
          activeTab = pathParts[4];
        }
      } else if (pathParts[2] !== 'vista' && pathParts[2] !== 'shared') {
        currentReporteUuid = pathParts[2];
        if (pathParts[3]) {
          activeTab = pathParts[3];
        }
      }
    }

    const searchParams = new URLSearchParams(queryString);
    const repUuid = searchParams.get('maquinas_reportes') || searchParams.get('masquinas_reportes') || searchParams.get('reporte_uuid') || searchParams.get('reporte');
    if (repUuid) {
      currentReporteUuid = repUuid;
    }

    // Determine active tab from route
    const cleanHash = hash.replace(/^#\/?/, '').split('?')[0];
    if (cleanHash.includes('/simple')) {
      activeTab = 'simple';
    } else if (cleanHash.includes('/sociedad')) {
      activeTab = 'sociedad';
    } else if (cleanHash.includes('/salas')) {
      activeTab = 'salas';
    } else if (cleanHash.includes('/galpones')) {
      activeTab = 'galpones';
    } else if (cleanHash.includes('/tipo')) {
      activeTab = 'tipo';
    } else if (cleanHash.includes('/marcas')) {
      activeTab = 'marcas';
    } else if (subtipo) {
      activeTab = subtipo;
    }
  }

  async function loadData() {
    isLoading = true;
    try {
      const q = currentReporteUuid ? `maquinas_reportes=${encodeURIComponent(currentReporteUuid)}` : queryString;
      const url = toBackendUrl(`/api/master/maquinas?limit=all&${q}`);
      const res = await fetch(url);
      const json = await res.json();
      if (json && json.success) {
        items = json.data || [];
      } else {
        items = [];
      }
    } catch (e) {
      console.error('Error cargando data de máquinas para reporte:', e);
      triggerToast('Error cargando los datos de máquinas', 'error');
    } finally {
      isLoading = false;
    }
  }

  function handleTabChange(tab) {
    activeTab = tab;
    if (isPublic) {
      if (currentReporteUuid && window.history && window.history.replaceState) {
        window.history.replaceState({}, '', `/reportes/maquinas/shared/${currentReporteUuid}`);
      }
    } else {
      const basePrefix = 'maquinas/maquinas/vista';
      const qStr = currentReporteUuid ? `maquinas_reportes=${encodeURIComponent(currentReporteUuid)}` : queryString;
      const newRoute = `${basePrefix}/${tab}${qStr ? '?' + qStr : ''}`;
      navigateToRoute(newRoute);
    }
  }

  function handleVolver() {
    if (isPublic) {
      navigateToRoute('dashboard');
    } else {
      navigateToRoute('maquinas/maquinas');
    }
  }

  async function handleCompartir() {
    if (isSavingReporte) return;
    isSavingReporte = true;

    try {
      let reporteUuid = currentReporteUuid;

      if (!reporteUuid) {
        // Extraer los filtros del queryString actual para guardarlos de forma deduplicada
        const searchParams = new URLSearchParams(queryString);
        const filtros = {
          search_nombre: searchParams.get('search_nombre') || '',
          search_serial: searchParams.get('search_serial') || '',
          search: searchParams.get('search') || '',
          user_sala_ids: searchParams.get('user_sala_ids') || '',
          grupo_ids: searchParams.get('grupo_ids') || '',
          sala_ids: searchParams.get('sala_ids') || '',
          marca_ids: searchParams.get('marca_ids') || '',
          modelo_ids: searchParams.get('modelo_ids') || '',
          juego_ids: searchParams.get('juego_ids') || '',
          estado_ids: searchParams.get('estado_ids') || '',
          sociedad_ids: searchParams.get('sociedad_ids') || '',
          valor_ids: searchParams.get('valor_ids') || '',
          tipo_ids: searchParams.get('tipo_ids') || '',
          modo_ids: searchParams.get('modo_ids') || '',
          legal_ids: searchParams.get('legal_ids') || '',
          rango_ids: searchParams.get('rango_ids') || ''
        };

        const res = await fetch(toBackendUrl('/api/master/maquinas-reportes'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subtipo: activeTab, filtros })
        });
        const json = await res.json();
        if (json && json.success && json.data && json.data.uuid) {
          reporteUuid = json.data.uuid;
          currentReporteUuid = reporteUuid;
        }
      }

      // Generar URL compartida limpia sin '#' ni parámetros: wisi.space/reportes/maquinas/shared/:uuid
      let shareUrl = '';
      if (reporteUuid) {
        shareUrl = getPublicWebUrl(`/reportes/maquinas/shared/${reporteUuid}`);
        if (isPublic && window.history && window.history.replaceState) {
          window.history.replaceState({}, '', `/reportes/maquinas/shared/${reporteUuid}`);
        }
      } else {
        shareUrl = getPublicWebUrl(`/reportes/maquinas/vista/${activeTab}${queryString ? '?' + queryString : ''}`);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const input = document.createElement('input');
        input.value = shareUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      triggerToast('Enlace público copiado al portapapeles', 'success');
    } catch (e) {
      console.warn('Error al compartir reporte de máquinas:', e);
      const fallbackUrl = currentReporteUuid 
        ? getPublicWebUrl(`/reportes/maquinas/shared/${currentReporteUuid}`)
        : getPublicWebUrl(`/reportes/maquinas/vista/${activeTab}${queryString ? '?' + queryString : ''}`);
      prompt('Copia el enlace del reporte:', fallbackUrl);
    } finally {
      isSavingReporte = false;
    }
  }



  function getReportTitle(tab) {
    if (tab === 'simple') return 'Reporte de Máquinas (Vista Simple)';
    if (tab === 'sociedad') return 'Reporte Detallado por Sociedad';
    if (tab === 'salas') return 'Reporte Detallado por Salas';
    if (tab === 'galpones') return 'Reporte Detallado por Galpones';
    if (tab === 'tipo') return 'Reporte Detallado por Tipo';
    if (tab === 'marcas') return 'Reporte Detallado por Marcas';
    return 'Reporte de Máquinas';
  }

  async function handleDescargarPdf() {
    if (isGeneratingPdf) return;
    isGeneratingPdf = true;

    const fechaClean = new Date().toISOString().slice(0, 10);
    const fileName = `Reporte_Maquinas_${activeTab}_${fechaClean}.pdf`;

    triggerToast("Generando archivo PDF...", "info");

    try {
      // PDF en formato A4 apaisado (Landscape: 297mm x 210mm)
      const pdf = new jsPDF("l", "mm", "a4");
      const reportTitle = getReportTitle(activeTab);

      let head = [];
      let body = [];

      if (activeTab === 'simple') {
        head = [
          [
            'NOMBRE',
            'SERIAL',
            'MARCA',
            'MODELO',
            'JUEGO',
            'TIPO',
            'PUESTOS',
            'MODO',
            'SOCIEDAD',
            'VALOR',
            'ESTADO',
            'LEGAL',
            'GRUPO',
            'SALA',
            'RANGO'
          ]
        ];
        body = items.map((m) => [
          m.nombre || '—',
          m.serial || '—',
          m.marca_nombre || 'N/A',
          m.modelo_nombre || 'N/A',
          m.juego_nombre || 'N/A',
          m.tipo_nombre || 'SLOTS',
          String(m.puestos || 1),
          m.modo_nombre || 'BILL',
          m.sociedad_nombre || 'N/A',
          m.valor_nombre || '0.01',
          m.estado_nombre || 'OPERATIVA',
          m.legal_nombre || 'SI',
          m.grupo_sala_nombre || ((String(m.grupo_sala_uuid || m.grupo_sala_id) === '55d65e8b-09b2-4164-8491-efbdd50433b6' || m.grupo_sala_id === 2 || String(m.grupo_sala_nombre || '').toLowerCase().includes('galp')) ? 'GALPÓN' : 'SALA'),
          m.sala_nombre || 'N/A',
          m.rango_nombre || 'General'
        ]);
      } else if (matrixData) {
        const colHeaders = [
          matrixData.groupLabel1,
          matrixData.groupLabel2,
          ...matrixData.crossColumns.map((c) => `${c.name} (${c.count})`)
        ];
        head = [colHeaders];

        matrixData.groups.forEach((g1) => {
          g1.subgroups.forEach((g2, subIdx) => {
            const row = [];
            if (subIdx === 0) {
              row.push({
                content: `${g1.name}\n(Total: ${g1.total})`,
                rowSpan: g1.subgroups.length,
                styles: { valign: 'middle', halign: 'center', fontStyle: 'bold', fillColor: [255, 255, 255] }
              });
            }
            row.push(`${g2.name} (Total: ${g2.total})`);
            g2.cells.forEach((cell) => {
              row.push(cell.count > 0 ? String(cell.count) : '0');
            });
            body.push(row);
          });
        });
      }

      autoTable(pdf, {
        head,
        body,
        startY: 22,
        margin: { top: 22, right: 8, bottom: 12, left: 8 },
        theme: 'grid',
        styles: {
          fontSize: activeTab === 'simple' ? 6.5 : 7.5,
          cellPadding: 1.5,
          textColor: [30, 41, 59],
          lineColor: [226, 232, 240],
          lineWidth: 0.1,
          overflow: 'linebreak',
        },
        headStyles: {
          fillColor: [30, 58, 95], // #1e3a5f
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: activeTab === 'simple' ? 7 : 8,
          halign: 'center',
          valign: 'middle',
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252],
        },
        didDrawPage: (data) => {
          // Encabezado institucional en cada página
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(13);
          pdf.setTextColor(30, 58, 95);
          pdf.text(reportTitle, 8, 10);

          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(8.5);
          pdf.setTextColor(100, 116, 139);
          pdf.text(`Generado en: ${generadoEn}   |   Registros: ${items.length}`, 8, 16);
        }
      });

      // Añadir numeración de páginas precisa a todas las páginas generadas
      const totalPages = pdf.internal.getNumberOfPages();
      const pageSize = pdf.internal.pageSize;
      const pageWidth = pageSize.width || pageSize.getWidth();
      const pageHeight = pageSize.height || pageSize.getHeight();

      for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.5);
        pdf.setTextColor(148, 163, 184);
        pdf.text(`Página ${i} de ${totalPages}`, pageWidth - 28, pageHeight - 5);
      }

      const pdfBlob = pdf.output("blob");
      await saveOrShareFile({
        blob: pdfBlob,
        fileName,
        dialogTitle: "Descargar Reporte PDF Máquinas",
        mimeType: "application/pdf",
      });

      triggerToast("PDF descargado con éxito.", "success");
    } catch (err) {
      console.error("[PDF] Error al generar archivo PDF con autoTable:", err);
      triggerToast("No se pudo generar PDF directo. Abriendo diálogo de impresión...", "warning");
      window.print();
    } finally {
      isGeneratingPdf = false;
    }
  }

  // Matrix Cross-Tabulation Calculation
  $: matrixData = computeMatrix(items, activeTab);

  function computeMatrix(data, mode) {
    if (!data || data.length === 0 || mode === 'simple') return null;

    let groupKey1 = 'sociedad_nombre';
    let groupLabel1 = 'SOCIEDAD';
    let groupKey2 = 'sala_nombre';
    let groupLabel2 = 'SALA';
    let crossKey = 'tipo_nombre';

    let filteredData = data;

    if (mode === 'sociedad') {
      groupKey1 = 'sociedad_nombre';
      groupLabel1 = 'SOCIEDAD';
      groupKey2 = 'sala_nombre';
      groupLabel2 = 'SALA';
      crossKey = 'tipo_nombre';
    } else if (mode === 'salas') {
      // Filtrar sólo salas
      filteredData = data.filter(m => {
        const gName = (m.grupo_sala_nombre || '').toLowerCase();
        const isGalp = gName.includes('galp') || 
                       String(m.grupo_sala_uuid || m.grupo_sala_id) === '55d65e8b-09b2-4164-8491-efbdd50433b6' || 
                       String(m.grupo_sala_id) === '2';
        return !isGalp;
      });
      groupKey1 = 'sala_nombre';
      groupLabel1 = 'SALA';
      groupKey2 = 'sociedad_nombre';
      groupLabel2 = 'SOCIEDAD';
      crossKey = 'tipo_nombre';
    } else if (mode === 'galpones') {
      // Filtrar sólo galpones
      filteredData = data.filter(m => {
        const gName = (m.grupo_sala_nombre || '').toLowerCase();
        const isGalp = gName.includes('galp') || 
                       String(m.grupo_sala_uuid || m.grupo_sala_id) === '55d65e8b-09b2-4164-8491-efbdd50433b6' || 
                       String(m.grupo_sala_id) === '2';
        return isGalp;
      });
      groupKey1 = 'sala_nombre';
      groupLabel1 = 'GALPÓN';
      groupKey2 = 'sociedad_nombre';
      groupLabel2 = 'SOCIEDAD';
      crossKey = 'tipo_nombre';
    } else if (mode === 'tipo') {
      groupKey1 = 'tipo_nombre';
      groupLabel1 = 'TIPO';
      groupKey2 = 'sociedad_nombre';
      groupLabel2 = 'SOCIEDAD';
      crossKey = 'marca_nombre';
    } else if (mode === 'marcas') {
      groupKey1 = 'marca_nombre';
      groupLabel1 = 'MARCA';
      groupKey2 = 'sociedad_nombre';
      groupLabel2 = 'SOCIEDAD';
      crossKey = 'modelo_nombre';
    }

    // 1. Columnas cruzadas distintas con conteo global
    const crossMap = new Map();
    filteredData.forEach(m => {
      const cVal = (m[crossKey] || 'N/A').toUpperCase();
      crossMap.set(cVal, (crossMap.get(cVal) || 0) + 1);
    });

    const crossColumns = Array.from(crossMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // 2. Agrupación Jerárquica: Group 1 -> Subgroup 2 -> Machines
    const groupsMap = new Map();

    filteredData.forEach(m => {
      const g1Val = m[groupKey1] || 'Sin Especificar';
      const g2Val = m[groupKey2] || 'Sin Especificar';
      const cVal = (m[crossKey] || 'N/A').toUpperCase();

      if (!groupsMap.has(g1Val)) {
        groupsMap.set(g1Val, {
          name: g1Val,
          total: 0,
          rawMachines: [],
          subgroupsMap: new Map()
        });
      }
      const g1 = groupsMap.get(g1Val);
      g1.total++;
      g1.rawMachines.push(m);

      if (!g1.subgroupsMap.has(g2Val)) {
        g1.subgroupsMap.set(g2Val, {
          name: g2Val,
          total: 0,
          rawMachines: [],
          cellsMap: new Map()
        });
      }
      const g2 = g1.subgroupsMap.get(g2Val);
      g2.total++;
      g2.rawMachines.push(m);

      if (!g2.cellsMap.has(cVal)) {
        g2.cellsMap.set(cVal, []);
      }
      g2.cellsMap.get(cVal).push(m);
    });

    const groups = Array.from(groupsMap.values())
      .map(g1 => {
        const subgroups = Array.from(g1.subgroupsMap.values())
          .map(g2 => ({
            name: g2.name,
            total: g2.total,
            rawMachines: g2.rawMachines,
            cells: crossColumns.map(col => {
              const cellMachines = g2.cellsMap.get(col.name) || [];
              return {
                colName: col.name,
                count: cellMachines.length,
                machines: cellMachines
              };
            })
          }))
          .sort((a, b) => a.name.localeCompare(b.name));

        return {
          name: g1.name,
          total: g1.total,
          rawMachines: g1.rawMachines,
          subgroups
        };
      })
      .sort((a, b) => b.total - a.total);

    return {
      groupLabel1,
      groupLabel2,
      crossColumns,
      groups
    };
  }

  // Abrir Modal 1: Resumen de Grupo (ojo del encabezado de fila)
  function openResumenModal(group) {
    let breakdownKey = 'tipo_nombre';
    let colHeader = 'TIPO';

    if (activeTab === 'tipo') {
      breakdownKey = 'sociedad_nombre';
      colHeader = 'SOCIEDAD';
    } else if (activeTab === 'marcas') {
      breakdownKey = 'modelo_nombre';
      colHeader = 'MODELO';
    }

    const countMap = new Map();
    group.rawMachines.forEach(m => {
      const val = m[breakdownKey] || 'N/A';
      countMap.set(val, (countMap.get(val) || 0) + 1);
    });

    const breakdown = Array.from(countMap.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

    resumenModalData = {
      title: `Resumen: ${group.name}`,
      colHeader,
      items: breakdown
    };
    resumenModalOpen = true;
  }

  // Abrir Modal 2: Detalle de Celda (ojo de una cantidad > 0)
  function openDetalleModal(subgroupName, colName, cellMachines) {
    // 1. Agrupación Marca -> Modelos
    const marcaMap = new Map();
    cellMachines.forEach(m => {
      const marca = m.marca_nombre || 'N/A';
      const modelo = m.modelo_nombre || 'N/A';
      if (!marcaMap.has(marca)) {
        marcaMap.set(marca, { marca, total: 0, modelosMap: new Map() });
      }
      const entry = marcaMap.get(marca);
      entry.total++;
      entry.modelosMap.set(modelo, (entry.modelosMap.get(modelo) || 0) + 1);
    });

    const marcasModelos = Array.from(marcaMap.values())
      .map(m => ({
        marca: m.marca,
        total: m.total,
        modelos: Array.from(m.modelosMap.entries()).map(([nombre, count]) => ({ nombre, count })).sort((a, b) => b.count - a.count)
      }))
      .sort((a, b) => b.total - a.total);

    // 2. Juegos
    const juegoMap = new Map();
    cellMachines.forEach(m => {
      const j = m.juego_nombre || 'N/A';
      juegoMap.set(j, (juegoMap.get(j) || 0) + 1);
    });
    const juegos = Array.from(juegoMap.entries())
      .map(([nombre, count]) => ({ nombre, count }))
      .sort((a, b) => b.count - a.count);

    // 3. Estados
    const estadoMap = new Map();
    cellMachines.forEach(m => {
      const e = m.estado_nombre || 'N/A';
      estadoMap.set(e, (estadoMap.get(e) || 0) + 1);
    });
    const estados = Array.from(estadoMap.entries())
      .map(([nombre, count]) => ({ nombre, count }))
      .sort((a, b) => b.count - a.count);

    // 4. Valores
    const valorMap = new Map();
    cellMachines.forEach(m => {
      const v = m.valor_nombre || 'N/A';
      valorMap.set(v, (valorMap.get(v) || 0) + 1);
    });
    const valores = Array.from(valorMap.entries())
      .map(([nombre, count]) => ({ nombre, count }))
      .sort((a, b) => b.count - a.count);

    detalleModalData = {
      title: `Detalle: ${subgroupName} - ${colName}`,
      marcasModelos,
      juegos,
      estados,
      valores
    };
    detalleModalOpen = true;
  }
</script>

<div class="reporte-view-container {isPublic ? 'is-public-mode' : ''}">
  <!-- Top Navigation & Action Bar -->
  <div class="reporte-toolbar">
    <div class="toolbar-left">
      <button type="button" class="btn-tool btn-back" on:click={handleVolver} title="Volver">
        ← Volver
      </button>
      <div class="toolbar-title-group">
        <h1 class="toolbar-title">
          {#if activeTab === 'simple'}
            Reporte de Máquinas (Vista Simple)
          {:else if activeTab === 'sociedad'}
            Reporte Detallado por Sociedad
          {:else if activeTab === 'salas'}
            Reporte Detallado por Salas
          {:else if activeTab === 'galpones'}
            Reporte Detallado por Galpones
          {:else if activeTab === 'tipo'}
            Reporte Detallado por Tipo
          {:else if activeTab === 'marcas'}
            Reporte Detallado por Marcas
          {/if}
        </h1>
        <div class="toolbar-meta">
          <span>Generado en: <strong>{generadoEn}</strong></span>
          <span class="meta-sep">|</span>
          <span>Registros: <strong>{items.length}</strong></span>
        </div>
      </div>
    </div>

    <!-- Right Actions -->
    <div class="toolbar-right">
      <button type="button" class="btn-tool btn-share" on:click={handleCompartir} title="Copiar enlace para compartir">
        Compartir
      </button>
      <button 
        type="button" 
        class="btn-tool btn-pdf" 
        on:click={handleDescargarPdf} 
        disabled={isGeneratingPdf} 
        title="Bajar reporte a PDF"
      >
        {#if isGeneratingPdf}
          <span>Generando...</span>
        {:else}
          <span>PDF</span>
        {/if}
      </button>
    </div>
  </div>

  <!-- Tabs Switcher -->
  <div class="reporte-tabs-bar">
    <button 
      type="button" 
      class="tab-btn" 
      class:active={activeTab === 'simple'} 
      on:click={() => handleTabChange('simple')}
    >
      Simple
    </button>
    <button 
      type="button" 
      class="tab-btn" 
      class:active={activeTab === 'sociedad'} 
      on:click={() => handleTabChange('sociedad')}
    >
      Por Sociedad
    </button>
    <button 
      type="button" 
      class="tab-btn" 
      class:active={activeTab === 'salas'} 
      on:click={() => handleTabChange('salas')}
    >
      Por Salas
    </button>
    <button 
      type="button" 
      class="tab-btn" 
      class:active={activeTab === 'galpones'} 
      on:click={() => handleTabChange('galpones')}
    >
      Por Galpones
    </button>
    <button 
      type="button" 
      class="tab-btn" 
      class:active={activeTab === 'tipo'} 
      on:click={() => handleTabChange('tipo')}
    >
      Por Tipo
    </button>
    <button 
      type="button" 
      class="tab-btn" 
      class:active={activeTab === 'marcas'} 
      on:click={() => handleTabChange('marcas')}
    >
      Por Marcas
    </button>
  </div>

  <!-- Área Imprimible / Exportable a PDF -->
  <div class="printable-report-area" bind:this={printableAreaEl}>
    <div class="pdf-export-header">
      <div class="pdf-header-title">
        {#if activeTab === 'simple'}
          Reporte de Máquinas (Vista Simple)
        {:else if activeTab === 'sociedad'}
          Reporte Detallado por Sociedad
        {:else if activeTab === 'salas'}
          Reporte Detallado por Salas
        {:else if activeTab === 'galpones'}
          Reporte Detallado por Galpones
        {:else if activeTab === 'tipo'}
          Reporte Detallado por Tipo
        {:else if activeTab === 'marcas'}
          Reporte Detallado por Marcas
        {/if}
      </div>
      <div class="pdf-header-meta">
        Generado en: {generadoEn} | Registros: {items.length}
      </div>
    </div>

    <!-- Content Section -->
    <div class="reporte-content">
    {#if isLoading}
      <div class="reporte-loading">
        <div class="spinner"></div>
        <p>Cargando datos del reporte de máquinas...</p>
      </div>
    {:else if items.length === 0}
      <div class="reporte-empty">
        <span class="empty-icon">📂</span>
        <h3>No se encontraron máquinas con los filtros actuales</h3>
      </div>
    {:else if activeTab === 'simple'}
      <!-- TABLA VISTA SIMPLE (Screenshot 1) -->
      <div class="table-responsive-box">
        <table class="reporte-table table-simple">
          <thead>
            <tr>
              <th>NOMBRE</th>
              <th>SERIAL</th>
              <th>MARCA</th>
              <th>MODELO</th>
              <th>JUEGO</th>
              <th>TIPO</th>
              <th>PUESTOS</th>
              <th>MODO</th>
              <th>SOCIEDAD</th>
              <th>VALOR</th>
              <th>ESTADO</th>
              <th>LEGAL</th>
              <th>GRUPO</th>
              <th>SALA</th>
              <th>RANGO</th>
            </tr>
          </thead>
          <tbody>
            {#each items as m}
              <tr>
                <td class="col-bold">{m.nombre || '—'}</td>
                <td class="col-mono">{m.serial || '—'}</td>
                <td>{m.marca_nombre || 'N/A'}</td>
                <td>{m.modelo_nombre || 'N/A'}</td>
                <td>{m.juego_nombre || 'N/A'}</td>
                <td class="col-tag">{m.tipo_nombre || 'SLOTS'}</td>
                <td class="text-center">{m.puestos || 1}</td>
                <td>{m.modo_nombre || 'BILL'}</td>
                <td class="col-sociedad">{m.sociedad_nombre || 'N/A'}</td>
                <td class="col-mono">{m.valor_nombre || '0.01'}</td>
                <td>
                  <span class="badge-status {(m.estado_nombre || '').toLowerCase().includes('operativa') ? 'status-ok' : 'status-warn'}">
                    {m.estado_nombre || 'OPERATIVA'}
                  </span>
                </td>
                <td class="text-center">{m.legal_nombre || 'SI'}</td>
                <td>{m.grupo_sala_nombre || (m.grupo_sala_id === 2 ? 'GALPON' : 'SALA')}</td>
                <td>{m.sala_nombre || 'N/A'}</td>
                <td class="col-rango">{m.rango_nombre || 'General'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if matrixData}
      <!-- TABLA VISTA DETALLADA MATRICIAL (Screenshot 2) -->
      <div class="table-responsive-box">
        <table class="reporte-table table-matrix">
          <thead>
            <tr>
              <th class="matrix-th-group">{matrixData.groupLabel1}</th>
              <th class="matrix-th-subgroup">{matrixData.groupLabel2}</th>
              {#each matrixData.crossColumns as col}
                <th class="matrix-th-cross">
                  <span class="cross-col-name">{col.name}</span>
                  <span class="cross-col-count">({col.count})</span>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each matrixData.groups as g1}
              {#each g1.subgroups as g2, subIdx}
                <tr>
                  {#if subIdx === 0}
                    <!-- Celda Grupo Principal con RowSpan y Ojo (Screenshot 2 & 3) -->
                    <td rowspan={g1.subgroups.length} class="matrix-td-group">
                      <div class="group-cell-wrap">
                        <span class="group-name-text">{g1.name} <strong>(Total: {g1.total})</strong></span>
                        <button 
                          type="button" 
                          class="btn-eye btn-eye-group" 
                          on:click={() => openResumenModal(g1)}
                          title="Ver resumen por tipo de {g1.name}"
                        >
                          👁️
                        </button>
                      </div>
                    </td>
                  {/if}
                  
                  <!-- Subgrupo -->
                  <td class="matrix-td-subgroup">
                    {g2.name} <span class="subgroup-total">(Total: {g2.total})</span>
                  </td>

                  <!-- Celdas cruzadas -->
                  {#each g2.cells as cell}
                    <td class="matrix-td-cell {cell.count > 0 ? 'has-count' : 'is-zero'}">
                      {#if cell.count > 0}
                        <div class="cell-count-wrap">
                          <span class="cell-number">{cell.count}</span>
                          <button 
                            type="button" 
                            class="btn-eye btn-eye-cell"
                            on:click={() => openDetalleModal(g2.name, cell.colName, cell.machines)}
                            title="Ver detalle: {g2.name} - {cell.colName}"
                          >
                            👁️
                          </button>
                        </div>
                      {:else}
                        <span class="cell-zero">0</span>
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
  </div>
</div>

<!-- MODAL 1: RESUMEN DE GRUPO (Screenshot 3) -->
{#if resumenModalOpen && resumenModalData}
  <div class="modal-backdrop" on:click={() => resumenModalOpen = false}>
    <div class="modal-window modal-resumen" on:click|stopPropagation>
      <div class="modal-header">
        <h3 class="modal-title">{resumenModalData.title}</h3>
        <button type="button" class="modal-close" on:click={() => resumenModalOpen = false}>✕</button>
      </div>
      <div class="modal-body">
        <table class="modal-table">
          <thead>
            <tr>
              <th>{resumenModalData.colHeader || 'TIPO'}</th>
              <th class="text-right">CANTIDAD</th>
            </tr>
          </thead>
          <tbody>
            {#each resumenModalData.items as item}
              <tr>
                <td>{item.label}</td>
                <td class="text-right font-bold">{item.count}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-modal-close" on:click={() => resumenModalOpen = false}>
          Cerrar
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- MODAL 2: DETALLE DE CELDA (Screenshot 4) -->
{#if detalleModalOpen && detalleModalData}
  <div class="modal-backdrop" on:click={() => detalleModalOpen = false}>
    <div class="modal-window modal-detalle" on:click|stopPropagation>
      <div class="modal-header">
        <h3 class="modal-title">{detalleModalData.title}</h3>
        <button type="button" class="modal-close" on:click={() => detalleModalOpen = false}>✕</button>
      </div>
      <div class="modal-body">
        <!-- SECCIÓN 1: TABLA POR MARCA Y MODELO -->
        <div class="detalle-section">
          <h4 class="detalle-sec-title">TABLA POR MARCA Y MODELO</h4>
          <table class="modal-table table-bordered">
            <thead>
              <tr>
                <th style="width: 35%;">MARCA (CANT.)</th>
                <th>MODELOS (CANT.)</th>
              </tr>
            </thead>
            <tbody>
              {#each detalleModalData.marcasModelos as mm}
                <tr>
                  <td class="marca-cell">
                    <strong>{mm.marca}</strong>
                    <span class="count-blue">({mm.total})</span>
                  </td>
                  <td>
                    <div class="modelos-pill-list">
                      {#each mm.modelos as mod}
                        <span class="modelo-pill">
                          {mod.nombre} <span class="pill-blue-count">({mod.count})</span>
                        </span>
                      {/each}
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <!-- SECCIÓN 2: DESGLOSE DE CARACTERÍSTICAS -->
        <div class="detalle-section" style="margin-top: 20px;">
          <h4 class="detalle-sec-title">DESGLOSE DE CARACTERÍSTICAS</h4>
          <div class="desglose-grid">
            <!-- JUEGOS -->
            <div class="desglose-card">
              <table class="modal-table table-bordered">
                <thead>
                  <tr>
                    <th>JUEGOS</th>
                    <th class="text-right" style="width: 50px;"></th>
                  </tr>
                </thead>
                <tbody>
                  {#each detalleModalData.juegos as j}
                    <tr>
                      <td>{j.nombre}</td>
                      <td class="text-right font-bold text-blue">{j.count}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>

            <!-- ESTADOS -->
            <div class="desglose-card">
              <table class="modal-table table-bordered">
                <thead>
                  <tr>
                    <th>ESTADOS</th>
                    <th class="text-right" style="width: 50px;"></th>
                  </tr>
                </thead>
                <tbody>
                  {#each detalleModalData.estados as e}
                    <tr>
                      <td>{e.nombre}</td>
                      <td class="text-right font-bold text-blue">{e.count}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>

            <!-- VALORES -->
            <div class="desglose-card">
              <table class="modal-table table-bordered">
                <thead>
                  <tr>
                    <th>VALORES</th>
                    <th class="text-right" style="width: 50px;"></th>
                  </tr>
                </thead>
                <tbody>
                  {#each detalleModalData.valores as v}
                    <tr>
                      <td>{v.nombre}</td>
                      <td class="text-right font-bold text-blue">{v.count}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-modal-close" on:click={() => detalleModalOpen = false}>
          Cerrar
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .reporte-view-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 100vh;
    background: #f8fafc;
    padding: 16px 20px;
    box-sizing: border-box;
    font-family: inherit;
  }

  .reporte-view-container.is-public-mode {
    padding: 24px;
    background: #ffffff;
  }

  /* Top Toolbar */
  .reporte-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    margin-bottom: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid #e2e8f0;
    flex-wrap: wrap;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .toolbar-title-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .toolbar-title {
    font-size: 18px;
    font-weight: 800;
    color: #1e293b;
    margin: 0;
  }

  .toolbar-meta {
    font-size: 12px;
    color: #64748b;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .meta-sep {
    color: #cbd5e1;
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-tool {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 700;
    cursor: pointer;
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #334155;
    transition: all 0.15s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .btn-tool:hover {
    background: #f1f5f9;
    border-color: #94a3b8;
  }

  .btn-back {
    color: #475569;
  }

  .btn-share {
    background: #eff6ff;
    color: #1d4ed8;
    border-color: #bfdbfe;
  }
  .btn-share:hover {
    background: #dbeafe;
  }

  .btn-print,
  .btn-pdf {
    background: #0f172a;
    color: #ffffff;
    border-color: #0f172a;
  }
  .btn-print:hover,
  .btn-pdf:hover:not(:disabled) {
    background: #1e293b;
  }
  .btn-pdf:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* Header exclusivo para exportación a PDF */
  .pdf-export-header {
    display: none;
    padding: 12px 16px;
    background: #1e3a5f;
    color: #ffffff;
    border-radius: 8px 8px 0 0;
    margin-bottom: 8px;
  }

  .pdf-header-title {
    font-size: 15px;
    font-weight: 800;
    letter-spacing: 0.3px;
  }

  .pdf-header-meta {
    font-size: 11px;
    opacity: 0.88;
    margin-top: 3px;
  }

  /* Tabs Bar */
  .reporte-tabs-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 8px;
    margin-bottom: 12px;
  }

  .tab-btn {
    padding: 6px 14px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    background: #ffffff;
    color: #475569;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s ease;
  }

  .tab-btn:hover {
    background: #f8fafc;
    border-color: #cbd5e1;
  }

  .tab-btn.active {
    background: #1e3a5f;
    color: #ffffff;
    border-color: #1e3a5f;
    box-shadow: 0 2px 4px rgba(30, 58, 95, 0.2);
  }

  /* Content & Tables */
  .reporte-content {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
    overflow: hidden;
  }

  .table-responsive-box {
    width: 100%;
    overflow-x: auto;
  }

  .reporte-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    text-align: left;
  }

  /* Table Simple (Screenshot 1) */
  .table-simple thead tr {
    background: #1e3a5f;
    color: #ffffff;
  }

  .table-simple th {
    padding: 8px 10px;
    font-weight: 800;
    font-size: 11px;
    letter-spacing: 0.3px;
    border-right: 1px solid rgba(255, 255, 255, 0.15);
    white-space: nowrap;
  }

  .table-simple th:last-child {
    border-right: none;
  }

  .table-simple td {
    padding: 7px 10px;
    border-bottom: 1px solid #e2e8f0;
    border-right: 1px solid #f1f5f9;
    color: #1e293b;
    white-space: nowrap;
  }

  .table-simple tbody tr:nth-child(even) {
    background: #f8fafc;
  }

  .table-simple tbody tr:hover {
    background: #f1f5f9;
  }

  .col-bold {
    font-weight: 800;
  }

  .col-mono {
    font-family: monospace;
    font-size: 11.5px;
    font-weight: 600;
  }

  .col-tag {
    font-weight: 700;
    color: #2563eb;
  }

  .col-sociedad {
    font-weight: 700;
    color: #0284c7;
  }

  .col-rango {
    font-weight: 700;
    color: #059669;
  }

  .text-center {
    text-align: center;
  }

  .text-right {
    text-align: right;
  }

  .badge-status {
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
  }
  .status-ok {
    background: #ecfdf5;
    color: #047857;
  }
  .status-warn {
    background: #fef2f2;
    color: #b91c1c;
  }

  /* Table Matrix (Screenshot 2) */
  .table-matrix thead tr {
    background: #f8fafc;
    border-bottom: 2px solid #cbd5e1;
  }

  .table-matrix th {
    padding: 10px 12px;
    font-size: 11.5px;
    font-weight: 800;
    color: #334155;
    border-right: 1px solid #e2e8f0;
    text-align: center;
    white-space: nowrap;
  }

  .matrix-th-group {
    text-align: center;
    min-width: 140px;
    background: #ffffff;
  }

  .matrix-th-subgroup {
    text-align: center;
    min-width: 180px;
    background: #ffffff;
  }

  .matrix-th-cross {
    min-width: 100px;
  }

  .cross-col-name {
    color: #1d4ed8;
    font-weight: 800;
  }

  .cross-col-count {
    color: #2563eb;
    font-weight: 700;
    margin-left: 2px;
  }

  .table-matrix td {
    padding: 8px 12px;
    border-bottom: 1px solid #e2e8f0;
    border-right: 1px solid #e2e8f0;
    color: #1e293b;
  }

  .matrix-td-group {
    background: #ffffff;
    vertical-align: middle;
    text-align: center;
    font-weight: 800;
    border-right: 2px solid #cbd5e1;
  }

  .group-cell-wrap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .group-name-text {
    font-size: 12.5px;
  }

  .matrix-td-subgroup {
    font-size: 11.5px;
    font-weight: 600;
    background: #ffffff;
    white-space: nowrap;
  }

  .subgroup-total {
    color: #64748b;
    font-size: 11px;
    font-weight: 400;
  }

  .matrix-td-cell {
    text-align: center;
    font-size: 12px;
    background: #ffffff;
  }

  .matrix-td-cell.is-zero {
    color: #cbd5e1;
  }

  .cell-count-wrap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .cell-number {
    font-weight: 800;
    color: #0f172a;
  }

  .cell-zero {
    color: #cbd5e1;
    font-size: 11px;
  }

  /* Eye Button */
  .btn-eye {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 14px;
    padding: 2px;
    opacity: 0.85;
    transition: transform 0.1s ease, opacity 0.1s ease;
  }

  .btn-eye:hover {
    transform: scale(1.2);
    opacity: 1;
  }

  /* Modals */
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 16px;
  }

  .modal-window {
    background: #ffffff;
    border-radius: 10px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.25);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    max-height: 90vh;
    animation: fadeInModal 0.15s ease-out;
  }

  @keyframes fadeInModal {
    from { opacity: 0; transform: scale(0.96); }
    to { opacity: 1; transform: scale(1); }
  }

  .modal-resumen {
    width: 480px;
    max-width: 95vw;
  }

  .modal-detalle {
    width: 900px;
    max-width: 95vw;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 18px;
    background: #1e293b;
    color: #ffffff;
  }

  .modal-title {
    font-size: 14px;
    font-weight: 800;
    margin: 0;
  }

  .modal-close {
    background: transparent;
    border: none;
    color: #ffffff;
    font-size: 18px;
    cursor: pointer;
    opacity: 0.8;
  }
  .modal-close:hover {
    opacity: 1;
  }

  .modal-body {
    padding: 18px;
    overflow-y: auto;
    font-size: 12.5px;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    padding: 12px 18px;
    background: #f8fafc;
    border-top: 1px solid #e2e8f0;
  }

  .btn-modal-close {
    padding: 6px 16px;
    border-radius: 6px;
    border: 1px solid #64748b;
    background: #475569;
    color: #ffffff;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }
  .btn-modal-close:hover {
    background: #334155;
  }

  .modal-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .modal-table th {
    padding: 8px 10px;
    background: #f1f5f9;
    color: #334155;
    font-weight: 800;
    font-size: 11px;
    border-bottom: 2px solid #cbd5e1;
    text-align: left;
  }

  .modal-table td {
    padding: 8px 10px;
    border-bottom: 1px solid #e2e8f0;
    color: #1e293b;
  }

  .modal-table.table-bordered {
    border: 1px solid #e2e8f0;
  }

  .modal-table.table-bordered th,
  .modal-table.table-bordered td {
    border: 1px solid #e2e8f0;
  }

  .font-bold {
    font-weight: 800;
  }

  .count-blue {
    color: #2563eb;
    font-weight: 800;
    margin-left: 4px;
  }

  .text-blue {
    color: #2563eb;
  }

  /* Detalle sections */
  .detalle-sec-title {
    font-size: 12px;
    font-weight: 800;
    color: #2563eb;
    margin: 0 0 8px 0;
    letter-spacing: 0.3px;
  }

  .marca-cell {
    white-space: nowrap;
    background: #fafafa;
  }

  .modelos-pill-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .modelo-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 6px;
    border: 1px solid #e2e8f0;
    background: #f8fafc;
    font-size: 11px;
    font-weight: 600;
    color: #334155;
  }

  .pill-blue-count {
    color: #2563eb;
    font-weight: 800;
  }

  .desglose-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
  }

  .desglose-card {
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    overflow: hidden;
  }

  .reporte-loading,
  .reporte-empty {
    padding: 60px 20px;
    text-align: center;
    color: #64748b;
  }

  .empty-icon {
    font-size: 36px;
    display: block;
    margin-bottom: 8px;
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid #e2e8f0;
    border-top-color: #2563eb;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 12px auto;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Responsive Mobile */
  @media (max-width: 768px) {
    .reporte-view-container {
      padding: 10px;
    }
    .desglose-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Print Styles */
  @media print {
    :global(body) {
      background: #ffffff !important;
      padding: 0 !important;
      margin: 0 !important;
    }
    .reporte-view-container {
      padding: 0 !important;
      background: #ffffff !important;
    }
    .reporte-toolbar .btn-back,
    .reporte-toolbar .toolbar-right,
    .reporte-tabs-bar {
      display: none !important;
    }
    .table-responsive-box {
      overflow: visible !important;
    }
    .reporte-table {
      font-size: 10px !important;
    }
    .table-simple th, .table-simple td {
      padding: 4px 6px !important;
    }
    .btn-eye {
      display: none !important;
    }
    .modal-backdrop {
      display: none !important;
    }
    @page {
      size: landscape;
      margin: 10mm;
    }
  }
</style>
