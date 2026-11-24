import { sql, isPgConnected } from '../config/db.js';
import { normalizeText, cleanPersonName, calculateSimilarity } from './whatsapp-parser.js';

class WhatsAppDictionaryService {
  constructor() {
    this.isLoaded = false;
    this.lastSyncedAt = null;
    this.stats = {
      total_empleados: 0,
      total_rangos: 0,
      total_clientes: 0,
      total_metodos: 0,
      total_maquinas: 0,
      total_modos: 0,
      por_sala: {}
    };

    // Estructuras en memoria optimizadas para búsqueda O(1) y O(N) sin queries a PostgreSQL
    this.salasCache = new Map(); // sala_uuid -> { empleados: [], clientes: [], maquinas: [] }
    this.rangosCache = [];      // Rangos globales con regex y alias
    this.metodosCache = [];     // Métodos de pago con alias
    this.modosCache = [];       // Modos de máquinas
    this.allEmpleadosCache = []; // Fallback global de empleados
    this.allClientesCache = [];  // Fallback global de clientes
    this.dynamicRangoRules = []; // Reglas regex dinámicas generadas para whatsapp-parser
  }

  /**
   * Asegura la creación de las tablas de diccionario en PostgreSQL
   */
  async ensureSchema() {
    if (!isPgConnected || !sql) return;
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS whatsapp_dictionary (
          uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          category VARCHAR(50) NOT NULL,
          sala_uuid UUID,
          entity_uuid UUID NOT NULL,
          nombre VARCHAR(255) NOT NULL,
          normalized_name VARCHAR(255) NOT NULL,
          extra JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_wa_dict_category ON whatsapp_dictionary(category);`;
      await sql`CREATE INDEX IF NOT EXISTS idx_wa_dict_sala ON whatsapp_dictionary(sala_uuid);`;
      await sql`CREATE INDEX IF NOT EXISTS idx_wa_dict_norm_name ON whatsapp_dictionary(normalized_name);`;

      await sql`
        CREATE TABLE IF NOT EXISTS whatsapp_dictionary_meta (
          id INT PRIMARY KEY DEFAULT 1,
          last_synced_at TIMESTAMPTZ,
          stats JSONB DEFAULT '{}'::jsonb,
          synced_by VARCHAR(100) DEFAULT 'system'
        );
      `;
    } catch (e) {
      console.warn('⚠️ [WhatsApp Dict] Error asegurando esquema:', e.message);
    }
  }

  /**
   * Carga el diccionario existente desde la BD o realiza una primera sincronización
   */
  async initDictionary() {
    console.log('📚 [WhatsApp Dict] Inicializando Diccionario de Entidades...');
    await this.ensureSchema();

    if (!isPgConnected || !sql) {
      console.warn('⚠️ [WhatsApp Dict] PostgreSQL no conectado; diccionario no disponible aún.');
      return;
    }

    try {
      const meta = await sql`SELECT last_synced_at, stats FROM whatsapp_dictionary_meta WHERE id = 1 LIMIT 1`;
      const countRes = await sql`SELECT count(*)::int as count FROM whatsapp_dictionary`;
      const totalCount = countRes[0]?.count || 0;

      if (totalCount > 0 && meta.length > 0 && meta[0].last_synced_at) {
        console.log(`⚡ [WhatsApp Dict] Cargando ${totalCount} entradas de diccionario desde PostgreSQL...`);
        await this.loadFromDatabase(meta[0]);
      } else {
        console.log('⚡ [WhatsApp Dict] Diccionario vacío o no sincronizado. Ejecutando sincronización inicial...');
        await this.syncDictionary();
      }
    } catch (e) {
      console.error('❌ [WhatsApp Dict] Error en initDictionary:', e.message);
    }
  }

  /**
   * Carga los registros de whatsapp_dictionary a memoria RAM
   */
  async loadFromDatabase(metaRow) {
    this.salasCache.clear();
    this.rangosCache = [];
    this.metodosCache = [];
    this.modosCache = [];
    this.allEmpleadosCache = [];
    this.allClientesCache = [];

    const rows = await sql`
      SELECT category, sala_uuid, entity_uuid, nombre, normalized_name, extra 
      FROM whatsapp_dictionary
      ORDER BY nombre ASC
    `;

    for (const r of rows) {
      const extra = r.extra || {};
      const salaKey = r.sala_uuid ? String(r.sala_uuid).toLowerCase() : null;

      if (r.category === 'empleado') {
        const item = {
          uuid: r.entity_uuid,
          nombre: r.nombre,
          normName: r.normalized_name,
          cargo: extra.cargo || '',
          cedula: extra.cedula || '',
          sala_uuid: r.sala_uuid,
          sala_nombre: extra.sala_nombre || '',
          tokens: extra.tokens || r.normalized_name.split(/\s+/).filter(Boolean)
        };
        this.allEmpleadosCache.push(item);
        if (salaKey) {
          if (!this.salasCache.has(salaKey)) {
            this.salasCache.set(salaKey, { empleados: [], clientes: [], maquinas: [] });
          }
          this.salasCache.get(salaKey).empleados.push(item);
        }

      } else if (r.category === 'cliente') {
        const item = {
          uuid: r.entity_uuid,
          nombre: r.nombre,
          normName: r.normalized_name,
          sala_uuid: r.sala_uuid,
          tokens: extra.tokens || r.normalized_name.split(/\s+/).filter(Boolean)
        };
        this.allClientesCache.push(item);
        if (salaKey) {
          if (!this.salasCache.has(salaKey)) {
            this.salasCache.set(salaKey, { empleados: [], clientes: [], maquinas: [] });
          }
          this.salasCache.get(salaKey).clientes.push(item);
        }

      } else if (r.category === 'rango') {
        this.rangosCache.push({
          uuid: r.entity_uuid,
          nombre: r.nombre,
          normName: r.normalized_name,
          aliases: extra.aliases || []
        });

      } else if (r.category === 'metodo_pago') {
        this.metodosCache.push({
          uuid: r.entity_uuid,
          nombre: r.nombre,
          normName: r.normalized_name,
          aliases: extra.aliases || []
        });

      } else if (r.category === 'modo') {
        this.modosCache.push({
          uuid: r.entity_uuid,
          nombre: r.nombre,
          normName: r.normalized_name
        });

      } else if (r.category === 'maquina') {
        const item = {
          uuid: r.entity_uuid,
          nombre: r.nombre,
          serial: extra.serial || '',
          sala_uuid: r.sala_uuid,
          rango_uuid: extra.rango_uuid,
          modo_nombre: extra.modo_nombre || ''
        };
        if (salaKey) {
          if (!this.salasCache.has(salaKey)) {
            this.salasCache.set(salaKey, { empleados: [], clientes: [], maquinas: [] });
          }
          this.salasCache.get(salaKey).maquinas.push(item);
        }
      }
    }

    this.rebuildDynamicRangoRules();
    this.lastSyncedAt = metaRow?.last_synced_at || new Date().toISOString();
    this.stats = metaRow?.stats || this.computeCurrentStats();
    this.isLoaded = true;
    console.log(`✅ [WhatsApp Dict] Diccionario cargado en memoria: ${this.allEmpleadosCache.length} empleados, ${this.rangosCache.length} rangos, ${this.allClientesCache.length} clientes, ${this.metodosCache.length} métodos.`);
  }

  /**
   * Genera alias y regex dinámicos para los rangos de máquinas
   */
  generateRangoAliases(nombre) {
    const aliases = new Set();
    const norm = normalizeText(nombre);
    aliases.add(norm);

    // Si tiene número de rango (ej. "Rango 1", "Rango 2", "Rango 10")
    const numMatch = norm.match(/\b([1-9]|1\d|20)\b/);
    if (numMatch) {
      const num = numMatch[1];
      aliases.add(`rango ${num}`);
      aliases.add(`rango${num}`);
      aliases.add(`r${num}`);
      aliases.add(`r ${num}`);
      aliases.add(`rg${num}`);
      aliases.add(`rg ${num}`);
      aliases.add(`r-${num}`);
      aliases.add(`r_${num}`);
      aliases.add(`rango-${num}`);
    }

    if (norm.includes('fuma')) {
      aliases.add('rango fumadores');
      aliases.add('fumadores');
      aliases.add('fuma');
      aliases.add('rfuma');
    }

    if (norm.includes('ruleta')) {
      aliases.add('ruleta');
      aliases.add('ruleta electronica');
      aliases.add('ruleta elec');
      aliases.add('relec');
    }

    if (norm.includes('sin rango') || norm === 'sr') {
      aliases.add('sin rango');
      aliases.add('sinrango');
      aliases.add('sr');
    }

    if (norm.includes('general')) {
      aliases.add('general');
      aliases.add('gen');
    }

    return Array.from(aliases);
  }

  /**
   * Genera alias y variantes para métodos de pago
   */
  generateMetodoAliases(nombre) {
    const aliases = new Set();
    const norm = normalizeText(nombre);
    aliases.add(norm);

    if (norm === 'usdt') {
      aliases.add('usdt');
      aliases.add('binance');
      aliases.add('crypto');
      aliases.add('cripto');
      aliases.add('tether');
      aliases.add('trc20');
      aliases.add('usdc');
    } else if (norm === 'cash' || norm.includes('efectivo') || norm.includes('dolar')) {
      aliases.add('cash');
      aliases.add('efectivo');
      aliases.add('dolares');
      aliases.add('dolar');
      aliases.add('usd');
      aliases.add('divisa');
      aliases.add('divisas');
      aliases.add('billetes');
    } else if (norm === 'pdv' || norm.includes('punto') || norm.includes('tarjeta') || norm.includes('debito')) {
      aliases.add('pdv');
      aliases.add('punto');
      aliases.add('punto de venta');
      aliases.add('pos');
      aliases.add('debito');
      aliases.add('tarjeta');
    } else if (norm.includes('pago movil') || norm.includes('pago mobil') || norm === 'pm') {
      aliases.add('pago movil');
      aliases.add('pago mobil');
      aliases.add('pagomovil');
      aliases.add('pagomobil');
      aliases.add('pm');
    } else if (norm.includes('zelle')) {
      aliases.add('zelle');
      aliases.add('zele');
    } else if (norm.includes('transferencia') || norm.includes('banco')) {
      aliases.add('transferencia');
      aliases.add('transfer');
      aliases.add('transf');
      aliases.add('banco');
    } else if (norm.includes('zinli')) {
      aliases.add('zinli');
    } else if (norm.includes('wally')) {
      aliases.add('wally');
    } else if (norm.includes('paypal')) {
      aliases.add('paypal');
    } else if (norm.includes('general') || norm.includes('otro')) {
      aliases.add('general');
      aliases.add('otros');
      aliases.add('otro');
    } else if (norm.includes('multiple') || norm.includes('múltiple')) {
      aliases.add('multiple');
      aliases.add('múltiple');
      aliases.add('multiples');
      aliases.add('múltiples');
      aliases.add('varios');
    }

    return Array.from(aliases);
  }

  /**
   * Reconstruye las reglas de rangos dinámicas para el parser de WhatsApp
   */
  rebuildDynamicRangoRules() {
    const rules = [];

    for (const r of this.rangosCache) {
      const aliases = r.aliases && r.aliases.length > 0 ? r.aliases : [r.normName];
      const patterns = aliases.map(a => a.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\s+/g, '\\s*'));
      const combinedRegex = new RegExp(`\\b(${patterns.join('|')})\\b`, 'i');
      rules.push({
        rango: r.nombre,
        regex: combinedRegex,
        uuid: r.uuid
      });
    }

    // Reglas de fallback habituales por si algún rango estándar no estuviera en BD
    const standardFallbacks = [
      { rango: 'Rango 1', regex: /\b(r(?:ango|g)?\s*[-_]?\s*1)\b/i },
      { rango: 'Rango 2', regex: /\b(r(?:ango|g)?\s*[-_]?\s*2)\b/i },
      { rango: 'Rango 3', regex: /\b(r(?:ango|g)?\s*[-_]?\s*3)\b/i },
      { rango: 'Rango 4', regex: /\b(r(?:ango|g)?\s*[-_]?\s*4)\b/i },
      { rango: 'Rango 5', regex: /\b(r(?:ango|g)?\s*[-_]?\s*5)\b/i },
      { rango: 'Rango Fumadores', regex: /\b(r(?:ango)?\s*fumadores?|fumadores?|fuma)\b/i },
      { rango: 'Ruleta Electrónica', regex: /\b(ruleta(?:\s+electr[oó]nica)?|ruleta\s*elec)\b/i },
      { rango: 'Sin Rango', regex: /\b(sin\s*rango|sinrango|sr)\b/i }
    ];

    for (const fb of standardFallbacks) {
      if (!rules.some(rule => normalizeText(rule.rango) === normalizeText(fb.rango))) {
        rules.push(fb);
      }
    }

    this.dynamicRangoRules = rules;
  }

  /**
   * Retorna las reglas dinámicas de rangos para el parser
   */
  getRangoRules() {
    if (this.dynamicRangoRules.length > 0) {
      return this.dynamicRangoRules;
    }
    this.rebuildDynamicRangoRules();
    return this.dynamicRangoRules;
  }

  computeCurrentStats() {
    const por_sala = {};
    for (const [sUuid, data] of this.salasCache.entries()) {
      por_sala[sUuid] = {
        empleados_count: data.empleados.length,
        clientes_count: data.clientes.length,
        maquinas_count: data.maquinas.length
      };
    }
    return {
      total_empleados: this.allEmpleadosCache.length,
      total_rangos: this.rangosCache.length,
      total_clientes: this.allClientesCache.length,
      total_metodos: this.metodosCache.length,
      total_maquinas: Array.from(this.salasCache.values()).reduce((acc, s) => acc + s.maquinas.length, 0),
      total_modos: this.modosCache.length,
      por_sala
    };
  }

  /**
   * SINCRONIZACIÓN COMPLETA:
   * Extrae la data más reciente de PostgreSQL, genera tokens y alias,
   * guarda en whatsapp_dictionary y refresca la caché en memoria.
   */
  async syncDictionary() {
    if (!isPgConnected || !sql) {
      throw new Error('Base de datos PostgreSQL no disponible para sincronizar diccionario');
    }

    console.log('🔄 [WhatsApp Dict] Iniciando sincronización integral de catálogos...');
    const startTime = Date.now();

    // 1. Extraer empleados activos con cargo y sala
    const emps = await sql`
      SELECT 
        e.uuid, 
        e.nombre, 
        e.cedula, 
        COALESCE(c.nombre, '') AS cargo, 
        d.sala_uuid, 
        COALESCE(s.nombre, '') AS sala_nombre
      FROM empleados e
      LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
      LEFT JOIN areas a ON c.area_uuid = a.uuid
      LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
      LEFT JOIN salas s ON d.sala_uuid = s.uuid
      WHERE COALESCE(e.activo, true) = true 
        AND COALESCE(e.is_deleted, false) = false
        AND length(trim(e.nombre)) >= 2
      ORDER BY e.nombre ASC
    `;

    // 2. Extraer rangos existentes
    const rangos = await sql`
      SELECT uuid, nombre 
      FROM rangos 
      WHERE COALESCE(is_deleted, false) = false
      ORDER BY nombre ASC
    `;

    // 3. Extraer clientes existentes
    const clientes = await sql`
      SELECT uuid, nombre, sala_uuid 
      FROM clientes 
      WHERE COALESCE(is_deleted, false) = false
        AND length(trim(nombre)) >= 2
      ORDER BY nombre ASC
    `;

    // 4. Extraer métodos de pago
    const metodos = await sql`
      SELECT uuid, nombre 
      FROM metodos_pago 
      WHERE COALESCE(is_deleted, false) = false
      ORDER BY nombre ASC
    `;

    // 5. Extraer modos
    const modos = await sql`
      SELECT uuid, nombre 
      FROM modos 
      WHERE COALESCE(is_deleted, false) = false
      ORDER BY nombre ASC
    `;

    // 6. Extraer máquinas
    const maquinas = await sql`
      SELECT m.uuid, m.nombre, m.serial, m.sala_uuid, m.rango_uuid, m.modo_uuid, mo.nombre as modo_nombre
      FROM maquinas m
      LEFT JOIN modos mo ON m.modo_uuid = mo.uuid
      WHERE COALESCE(m.is_deleted, false) = false
      ORDER BY m.nombre ASC
    `;

    // Preparar lista de inserción para whatsapp_dictionary
    const dictRows = [];

    // Empleados
    for (const e of emps) {
      const cleanNom = cleanPersonName(e.nombre);
      const normNom = normalizeText(cleanNom);
      const tokens = normNom.split(/\s+/).filter(w => w.length >= 2);
      dictRows.push({
        category: 'empleado',
        sala_uuid: e.sala_uuid || null,
        entity_uuid: e.uuid,
        nombre: cleanNom,
        normalized_name: normNom,
        extra: {
          cargo: e.cargo,
          cedula: e.cedula,
          sala_nombre: e.sala_nombre,
          tokens
        }
      });
    }

    // Rangos
    for (const r of rangos) {
      const normNom = normalizeText(r.nombre);
      const aliases = this.generateRangoAliases(r.nombre);
      dictRows.push({
        category: 'rango',
        sala_uuid: null,
        entity_uuid: r.uuid,
        nombre: r.nombre,
        normalized_name: normNom,
        extra: { aliases }
      });
    }

    // Clientes
    for (const c of clientes) {
      const cleanNom = cleanPersonName(c.nombre);
      const normNom = normalizeText(cleanNom);
      const tokens = normNom.split(/\s+/).filter(w => w.length >= 2);
      dictRows.push({
        category: 'cliente',
        sala_uuid: c.sala_uuid || null,
        entity_uuid: c.uuid,
        nombre: cleanNom,
        normalized_name: normNom,
        extra: { tokens }
      });
    }

    // Métodos de pago
    for (const m of metodos) {
      const normNom = normalizeText(m.nombre);
      const aliases = this.generateMetodoAliases(m.nombre);
      dictRows.push({
        category: 'metodo_pago',
        sala_uuid: null,
        entity_uuid: m.uuid,
        nombre: m.nombre,
        normalized_name: normNom,
        extra: { aliases }
      });
    }

    // Modos
    for (const mo of modos) {
      const normNom = normalizeText(mo.nombre);
      dictRows.push({
        category: 'modo',
        sala_uuid: null,
        entity_uuid: mo.uuid,
        nombre: mo.nombre,
        normalized_name: normNom,
        extra: {}
      });
    }

    // Máquinas
    for (const mq of maquinas) {
      const normNom = normalizeText(mq.nombre || mq.serial || '');
      dictRows.push({
        category: 'maquina',
        sala_uuid: mq.sala_uuid || null,
        entity_uuid: mq.uuid,
        nombre: mq.nombre || mq.serial || 'Máquina',
        normalized_name: normNom,
        extra: {
          serial: mq.serial,
          rango_uuid: mq.rango_uuid,
          modo_nombre: mq.modo_nombre
        }
      });
    }

    // Guardar en PostgreSQL de forma transaccional / lote
    await sql.begin(async (trx) => {
      await trx`TRUNCATE TABLE whatsapp_dictionary`;

      // Insertar por lotes de 200 filas para evitar límites de parámetros en Postgres
      const BATCH_SIZE = 200;
      for (let i = 0; i < dictRows.length; i += BATCH_SIZE) {
        const batch = dictRows.slice(i, i + BATCH_SIZE);
        await trx`
          INSERT INTO whatsapp_dictionary ${trx(
            batch,
            'category',
            'sala_uuid',
            'entity_uuid',
            'nombre',
            'normalized_name',
            'extra'
          )}
        `;
      }

      // Actualizar tabla de metadata
      const statsObj = {
        total_empleados: emps.length,
        total_rangos: rangos.length,
        total_clientes: clientes.length,
        total_metodos: metodos.length,
        total_maquinas: maquinas.length,
        total_modos: modos.length
      };

      await trx`
        INSERT INTO whatsapp_dictionary_meta (id, last_synced_at, stats, synced_by)
        VALUES (1, CURRENT_TIMESTAMP, ${trx.json(statsObj)}, 'admin_ui')
        ON CONFLICT (id) DO UPDATE SET
          last_synced_at = CURRENT_TIMESTAMP,
          stats = EXCLUDED.stats,
          synced_by = EXCLUDED.synced_by
      `;
    });

    // Cargar en la memoria RAM del servidor
    const metaRow = {
      last_synced_at: new Date().toISOString(),
      stats: {
        total_empleados: emps.length,
        total_rangos: rangos.length,
        total_clientes: clientes.length,
        total_metodos: metodos.length,
        total_maquinas: maquinas.length,
        total_modos: modos.length
      }
    };
    await this.loadFromDatabase(metaRow);

    const elapsed = Date.now() - startTime;
    console.log(`✅ [WhatsApp Dict] Sincronización exitosa en ${elapsed}ms: ${dictRows.length} entidades indexadas.`);

    return {
      success: true,
      elapsedMs: elapsed,
      lastSyncedAt: this.lastSyncedAt,
      stats: this.stats
    };
  }

  /**
   * Retorna el estado actual del diccionario
   */
  getStatus() {
    return {
      isLoaded: this.isLoaded,
      lastSyncedAt: this.lastSyncedAt,
      stats: this.stats || this.computeCurrentStats()
    };
  }

  /**
   * Vista previa de entidades por Sala
   */
  getPreviewBySala(salaUuid) {
    if (!salaUuid) {
      return {
        empleados: this.allEmpleadosCache.slice(0, 50),
        clientes: this.allClientesCache.slice(0, 50),
        rangos: this.rangosCache,
        metodos: this.metodosCache,
        maquinasCount: 0
      };
    }

    const key = String(salaUuid).toLowerCase();
    const salaData = this.salasCache.get(key) || { empleados: [], clientes: [], maquinas: [] };

    return {
      empleados: salaData.empleados,
      clientes: salaData.clientes,
      rangos: this.rangosCache,
      metodos: this.metodosCache,
      maquinasCount: salaData.maquinas.length
    };
  }

  /**
   * ALGORITMO DE SCORING DE ALTA PRECISIÓN:
   * Resuelve el error donde coincidencias parciales o apellidos comunes
   * se asignaban erróneamente al primer empleado encontrado.
   */
  scoreNameMatch(targetNorm, candidateNorm, candidateTokens, cargo = '') {
    if (!targetNorm || !candidateNorm) return 0;

    // 1. Coincidencia completa exacta (100 puntos)
    if (targetNorm === candidateNorm) return 100;

    const targetTokens = targetNorm.split(/\s+/).filter(w => w.length >= 2);
    if (targetTokens.length === 0) return 0;

    // 2. Prefijo exacto de nombre compuesto (ej. "Jackson Daniel Salazar" vs "Jackson Daniel Salazar Cumana")
    if (candidateNorm.startsWith(targetNorm + ' ')) return 95;
    if (targetNorm.startsWith(candidateNorm + ' ')) return 92;

    // 3. Evaluar solapamiento de tokens (palabras)
    let matchedTokens = 0;
    for (const t of targetTokens) {
      if (candidateTokens.includes(t)) {
        matchedTokens++;
      }
    }

    const targetRatio = matchedTokens / targetTokens.length;
    const candidateRatio = candidateTokens.length > 0 ? (matchedTokens / candidateTokens.length) : 0;

    // Si el usuario especificó 2 o más palabras (ej. "Carlos Hernandez" o "Daniel Gonzalez")
    if (targetTokens.length >= 2) {
      // Si TODAS las palabras que escribió el usuario coinciden en el empleado
      if (targetRatio === 1) {
        let base = 85 + (candidateRatio * 5); // 85 a 90
        return base;
      }
      // Si solo coincidió 1 de 2 palabras (ej. solo el apellido "Hernandez"):
      // PENALIZACIÓN SEVERA para evitar que "Jose Hernandez" gane cuando buscaban "Carlos Hernandez"
      if (targetRatio < 1) {
        return Math.floor(35 * targetRatio); // max 17 puntos
      }
    }

    // Si el usuario solo escribió 1 palabra (ej. "Carlos", "Cesar", "Manuel", "Barrientos")
    if (targetTokens.length === 1) {
      if (matchedTokens === 1) {
        let score = 55;
        // Si coincide con el PRIMER nombre del empleado:
        if (candidateTokens[0] === targetTokens[0]) {
          score = 65;
        }
        // Tie-breaker: si el cargo es operativo de sala (Cajero, Técnico, Operador, etc.)
        const normCargo = normalizeText(cargo);
        if (
          normCargo.includes('cajero') || 
          normCargo.includes('tecnico') || 
          normCargo.includes('técnico') || 
          normCargo.includes('operador') || 
          normCargo.includes('sala') || 
          normCargo.includes('supervisor')
        ) {
          score += 3;
        }
        return score;
      }
    }

    // Similaridad Dice de bigramas como último recurso para tolerar pequeños typos
    const dice = calculateSimilarity(targetNorm, candidateNorm);
    if (dice >= 0.78) {
      return Math.floor(dice * 75);
    }

    return 0;
  }

  /**
   * RESOLUCIÓN INTELIGENTE DE EMPLEADO (Aportes y Devoluciones):
   * - Filtra primero estrictamente por sala_uuid.
   * - Aplica score a todos los empleados de la sala.
   * - Detecta ambigüedad (cuando 2 o más empleados empatan en score).
   * - Si no hay coincidencia confiable, no asigna a un empleado aleatorio.
   */
  async resolveEmpleado(parsedOperador, salaUuid) {
    let cleanOperador = cleanPersonName(parsedOperador);
    if (!cleanOperador || cleanOperador.toLowerCase() === 'general') {
      cleanOperador = '';
    }

    // 1. Obtener empleados de la sala desde la caché rápida en memoria
    let candidates = [];
    if (salaUuid) {
      const key = String(salaUuid).toLowerCase();
      const sData = this.salasCache.get(key);
      if (sData && sData.empleados.length > 0) {
        candidates = sData.empleados;
      }
    }

    // Fallback a todos los empleados si la sala no tiene asignados o no se indicó sala
    if (candidates.length === 0) {
      candidates = this.allEmpleadosCache;
    }

    if (!cleanOperador || candidates.length === 0) {
      // Sin operador especificado
      const genEmp = candidates.find(e => e.normName === 'general') || candidates[0];
      return {
        empleadoUuid: genEmp?.uuid || null,
        empleadoNombre: genEmp?.nombre || 'Operador General',
        cargo: genEmp?.cargo || '',
        foundEmp: false,
        score: 0,
        empFallbackUsado: true,
        esCoincidenciaExacta: false,
        ambiguedad: false,
        candidatos: []
      };
    }

    const normTarget = normalizeText(cleanOperador);

    // Calcular score para cada candidato en la sala
    const scoredList = candidates.map(emp => {
      const score = this.scoreNameMatch(normTarget, emp.normName, emp.tokens, emp.cargo);
      return { emp, score };
    }).filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scoredList.length > 0) {
      const best = scoredList[0];
      const second = scoredList[1] || null;

      // DETECCIÓN DE AMBIGÜEDAD:
      // Si dos candidatos tienen el mismo score alto (ej. dos "Carlos" con score 65)
      const hasAmbiguity = second && second.score >= 50 && (best.score - second.score <= 3);

      if (best.score >= 80 && !hasAmbiguity) {
        // Coincidencia exacta o multi-palabra completa (alta certeza: Check Verde ✅)
        return {
          empleadoUuid: best.emp.uuid,
          empleadoNombre: best.emp.nombre,
          cargo: best.emp.cargo,
          foundEmp: true,
          score: best.score,
          empFallbackUsado: false,
          esCoincidenciaExacta: true,
          ambiguedad: false,
          candidatos: []
        };
      }

      if (best.score >= 50) {
        // Coincidencia parcial (un solo nombre o apellido) o ambigüedad (Check Azul ☑️)
        const candidateNames = scoredList.slice(0, 3).map(s => `${s.emp.nombre} (${s.emp.cargo || 'Sin cargo'})`);
        return {
          empleadoUuid: best.emp.uuid,
          empleadoNombre: best.emp.nombre,
          cargo: best.emp.cargo,
          foundEmp: true,
          score: best.score,
          empFallbackUsado: false,
          esCoincidenciaExacta: false, // Entra por verificar por ser coincidencia parcial o ambigua
          ambiguedad: Boolean(hasAmbiguity),
          candidatos: candidateNames
        };
      }
    }

    // Si el score fue menor a 50 (no se encontró al empleado en la sala)
    // Asignar primer empleado como fallback PERO con flag explícito de NO encontrado
    const fallbackEmp = candidates.find(e => e.normName === 'general') || candidates[0];
    return {
      empleadoUuid: fallbackEmp?.uuid || null,
      empleadoNombre: fallbackEmp?.nombre || 'Operador General',
      cargo: fallbackEmp?.cargo || '',
      foundEmp: false,
      score: 0,
      empFallbackUsado: true,
      esCoincidenciaExacta: false,
      ambiguedad: false,
      candidatos: []
    };
  }

  /**
   * RESOLUCIÓN INTELIGENTE DE CLIENTE (Control de Clientes):
   * - Filtra estrictamente por sala_uuid.
   * - Coincidencia exacta / multi-palabra.
   * - Si es un cliente nuevo, lo crea en PostgreSQL y lo añade al diccionario en RAM.
   */
  async resolveCliente(parsedCliente, salaUuid) {
    let cleanCliente = cleanPersonName(parsedCliente);
    if (!cleanCliente || cleanCliente.toLowerCase() === 'general' || cleanCliente.length < 2 || ['a', 'de', 'del', 'el', 'la', 'c', 'p', 'd'].includes(cleanCliente.toLowerCase())) {
      cleanCliente = 'General';
    }

    let candidates = [];
    if (salaUuid) {
      const key = String(salaUuid).toLowerCase();
      const sData = this.salasCache.get(key);
      if (sData && sData.clientes.length > 0) {
        candidates = sData.clientes;
      }
    }
    if (candidates.length === 0) {
      candidates = this.allClientesCache;
    }

    if (cleanCliente === 'General') {
      let gen = candidates.find(c => c.normName === 'general');
      if (gen) {
        return { clienteUuid: gen.uuid, clienteNombre: 'General', foundClient: gen, esCoincidenciaExacta: false };
      }
      // Buscar en BD
      const existingGen = await sql`
        SELECT uuid, nombre FROM clientes 
        WHERE lower(trim(nombre)) = 'general' 
          AND ${salaUuid ? sql`(sala_uuid = ${salaUuid}::uuid OR sala_uuid IS NULL)` : sql`true`}
        LIMIT 1
      `;
      if (existingGen.length > 0) {
        return { clienteUuid: existingGen[0].uuid, clienteNombre: existingGen[0].nombre, foundClient: existingGen[0], esCoincidenciaExacta: false };
      }
      // Crear General si no existe
      const newGen = await sql`
        INSERT INTO clientes (nombre, sala_uuid)
        VALUES ('General', ${salaUuid ? sql`${salaUuid}::uuid` : sql`NULL`})
        RETURNING uuid, nombre
      `;
      return { clienteUuid: newGen[0].uuid, clienteNombre: newGen[0].nombre, foundClient: newGen[0], esCoincidenciaExacta: false };
    }

    const normTarget = normalizeText(cleanCliente);

    // Calcular score con los clientes de la sala
    const scoredList = candidates.map(cli => {
      const score = this.scoreNameMatch(normTarget, cli.normName, cli.tokens);
      return { cli, score };
    }).filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scoredList.length > 0 && scoredList[0].score >= 60) {
      const best = scoredList[0];
      return {
        clienteUuid: best.cli.uuid,
        clienteNombre: best.cli.nombre,
        foundClient: best.cli,
        score: best.score,
        esCoincidenciaExacta: best.score >= 80
      };
    }

    // Cliente no encontrado en la sala -> Crear nuevo cliente en BD y agregar a la caché RAM
    let newClientUuid = null;
    try {
      const created = await sql`
        INSERT INTO clientes (nombre, sala_uuid)
        VALUES (${cleanCliente}, ${salaUuid ? sql`${salaUuid}::uuid` : sql`NULL`})
        RETURNING uuid, nombre
      `;
      if (created.length > 0) {
        newClientUuid = created[0].uuid;
        const newClientItem = {
          uuid: newClientUuid,
          nombre: cleanCliente,
          normName: normTarget,
          sala_uuid: salaUuid,
          tokens: normTarget.split(/\s+/).filter(Boolean)
        };
        this.allClientesCache.push(newClientItem);
        if (salaUuid) {
          const key = String(salaUuid).toLowerCase();
          if (!this.salasCache.has(key)) {
            this.salasCache.set(key, { empleados: [], clientes: [], maquinas: [] });
          }
          this.salasCache.get(key).clientes.push(newClientItem);
        }
      }
    } catch (e) {
      console.warn('Error creando nuevo cliente:', e.message);
    }

    return {
      clienteUuid: newClientUuid,
      clienteNombre: cleanCliente,
      foundClient: null,
      score: 0,
      esCoincidenciaExacta: false
    };
  }

  /**
   * RESOLUCIÓN INTELIGENTE DE RANGO (Aportes y Devoluciones):
   * Coincide contra los rangos existentes en la base de datos y sus alias.
   */
  async resolveRango(parsedRango, salaUuid = null) {
    let rangoUuid = null;
    let rangoNombre = parsedRango || 'General';
    let foundRango = null;
    let rangoFallbackUsado = false;

    if (parsedRango && this.rangosCache.length > 0) {
      const normTarget = normalizeText(parsedRango);

      // 1. Coincidencia exacta con nombre o alias
      foundRango = this.rangosCache.find(r => {
        if (r.normName === normTarget) return true;
        return r.aliases && r.aliases.includes(normTarget);
      });

      // 2. Coincidencia por número de rango
      if (!foundRango) {
        const numMatch = normTarget.match(/\b([1-9]|1\d|20)\b/);
        if (numMatch) {
          const num = numMatch[1];
          foundRango = this.rangosCache.find(r => {
            const rn = r.normName;
            return rn.endsWith(num) || rn.includes(`rango ${num}`) || rn.includes(`r${num}`) || rn.includes(`rg ${num}`);
          });
        }
      }

      // 3. Coincidencia por palabras clave
      if (!foundRango) {
        if (normTarget.includes('fuma')) {
          foundRango = this.rangosCache.find(r => r.normName.includes('fuma'));
        } else if (normTarget.includes('ruleta')) {
          foundRango = this.rangosCache.find(r => r.normName.includes('ruleta'));
        } else if (normTarget.includes('sin rango') || normTarget === 'sr') {
          foundRango = this.rangosCache.find(r => r.normName.includes('sin rango') || r.normName.includes('sinrango'));
        }
      }

      // 4. Coincidencia contenida
      if (!foundRango) {
        foundRango = this.rangosCache.find(r => r.normName.includes(normTarget) || normTarget.includes(r.normName));
      }

      if (foundRango) {
        rangoUuid = foundRango.uuid;
        rangoNombre = foundRango.nombre;
      }
    }

    // Si no se encontró rango, asignar General o Sin Rango
    if (!rangoUuid) {
      const gen = this.rangosCache.find(r => r.normName === 'general') ||
                  this.rangosCache.find(r => r.normName === 'sin rango') ||
                  this.rangosCache[0];
      if (gen) {
        rangoUuid = gen.uuid;
        rangoNombre = gen.nombre;
      }
      rangoFallbackUsado = true;
    }

    return { rangoUuid, rangoNombre, rangoFallbackUsado, foundRango };
  }

  /**
   * RESOLUCIÓN INTELIGENTE DE MÉTODO DE PAGO:
   * Coincide contra los métodos de pago registrados y sus alias.
   */
  async resolveMetodoPago(parsedMetodo) {
    let metodoPagoUuid = null;
    let metodoFallbackUsado = false;
    let metodoAsignadoNombre = 'General';
    let foundMetodo = null;

    if (parsedMetodo && this.metodosCache.length > 0) {
      const normTarget = normalizeText(parsedMetodo);

      // 1. Coincidencia exacta con nombre o alias
      foundMetodo = this.metodosCache.find(m => {
        if (m.normName === normTarget) return true;
        return m.aliases && m.aliases.includes(normTarget);
      });

      // 2. Coincidencia contenida
      if (!foundMetodo) {
        foundMetodo = this.metodosCache.find(m => {
          return m.aliases && m.aliases.some(a => normTarget.includes(a) || a.includes(normTarget));
        });
      }

      // 3. Fallback directo a BD si no está en caché (ej. Método 'Múltiple' o método recién creado)
      if (!foundMetodo && isPgConnected && sql) {
        try {
          const dbRows = await sql`
            SELECT uuid, nombre 
            FROM metodos_pago 
            WHERE (lower(trim(nombre)) = ${normTarget} 
               OR (lower(trim(nombre)) IN ('múltiple', 'multiple') AND ${normTarget} IN ('múltiple', 'multiple', 'multiples')))
              AND COALESCE(is_deleted, false) = false
            LIMIT 1
          `;
          if (dbRows.length > 0) {
            foundMetodo = {
              uuid: dbRows[0].uuid,
              nombre: dbRows[0].nombre,
              normName: normalizeText(dbRows[0].nombre),
              aliases: this.generateMetodoAliases(dbRows[0].nombre)
            };
            this.metodosCache.push(foundMetodo);
          }
        } catch (e) {}
      }
    }

    if (foundMetodo) {
      metodoPagoUuid = foundMetodo.uuid;
      metodoAsignadoNombre = foundMetodo.nombre;
    } else if (this.metodosCache.length > 0) {
      const gen = this.metodosCache.find(m => m.normName === 'general') ||
                  this.metodosCache.find(m => m.normName === 'cash' || m.normName.includes('efectivo')) ||
                  this.metodosCache[0];
      if (gen) {
        metodoPagoUuid = gen.uuid;
        metodoAsignadoNombre = gen.nombre;
      }
      metodoFallbackUsado = true;
    }

    return { metodoPagoUuid, metodoAsignadoNombre, metodoFallbackUsado, foundMetodo };
  }
}

export const whatsappDictionaryService = new WhatsAppDictionaryService();
