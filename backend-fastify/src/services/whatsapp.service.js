import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { sql, isPgConnected } from '../config/db.js';
import { parseWhatsAppMessage, normalizeText, isSystemStatusOrInformationalMessage, cleanPersonName, calculateSimilarity } from './whatsapp-parser.js';
import { whatsappDictionaryService } from './whatsapp-dictionary.service.js';
import { broadcastLibroUpdate } from '../config/websocket.js';

// Helpers seguros para clasificar JIDs sin depender de exportaciones específicas de Baileys
const isJidBroadcast = (jid) => typeof jid === 'string' && jid.endsWith('@broadcast');
const isJidNewsletter = (jid) => typeof jid === 'string' && jid.endsWith('@newsletter');
const isJidStatusBroadcast = (jid) => jid === 'status@broadcast';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Función para resolver el directorio de credenciales de WhatsApp
function resolveAuthDir() {
  const candidates = [
    path.resolve(__dirname, '../../auth_whatsapp'),
    path.resolve(__dirname, '../../../auth_whatsapp'),
    path.join(process.cwd(), 'auth_whatsapp'),
    path.join(process.cwd(), 'backend-fastify', 'auth_whatsapp'),
    '/var/www/wisi/backend-fastify/auth_whatsapp',
    '/var/www/wisi/auth_whatsapp'
  ];

  // 1. Priorizar el directorio que contenga creds.json con credenciales guardadas
  for (const dir of candidates) {
    try {
      const credsFile = path.join(dir, 'creds.json');
      if (fs.existsSync(credsFile)) {
        const stat = fs.statSync(credsFile);
        if (stat.size > 150) {
          const raw = fs.readFileSync(credsFile, 'utf8');
          const data = JSON.parse(raw);
          if (data && (data.registered === true || data.me || data.signedIdentityKey || data.account)) {
            return dir;
          }
        }
      }
    } catch (e) {}
  }

  // 2. Si ninguno tiene sesión activa válida, usar el directorio permanente en backend-fastify
  const defaultDir = path.resolve(__dirname, '../../auth_whatsapp');
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }
  return defaultDir;
}

/**
 * Formatea la hora en zona horaria de Caracas garantizando ciclo de 24 horas estándar (00:00 a 23:59).
 * Previene el bug de ICU/locale donde las 12:xx de la madrugada se formatean erróneamente como "24:xx".
 */
export function formatCaracasTime(timestampOrStr) {
  if (typeof timestampOrStr === 'string' && /^\d{1,2}:\d{2}/.test(timestampOrStr.trim())) {
    const parts = timestampOrStr.trim().split(':');
    let h = parts[0].padStart(2, '0');
    let m = parts[1].padStart(2, '0');
    if (h === '24') h = '00';
    return `${h}:${m}`;
  }

  let date = new Date();
  if (timestampOrStr) {
    const num = Number(timestampOrStr);
    if (!isNaN(num) && num > 0) {
      date = new Date(num > 1e11 ? num : num * 1000);
    }
  }

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Caracas',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });

  let str = formatter.format(date);
  if (str.startsWith('24:')) {
    str = '00:' + str.slice(3);
  }
  return str;
}

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'waiting_qr' | 'connected'
    this.qrDataUrl = null;
    this.qrRaw = null;
    this.userInfo = null;
    this.lastError = null;
    this.isConnecting = false;
    this.connectingStartedAt = 0;
    this.reconnectTimeout = null;
    this.watchdogInterval = null;
    this.processedMessageIds = new Set(); // Evita procesar duplicados ante reenvíos de red

    // Gestión de Reconexión Inteligente y Circuit Breaker para proteger el VPS
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 6;
    this.circuitBreakerUntil = 0;

    // Caché en memoria para evitar saturar WhatsApp y PostgreSQL
    this.groupsCache = null;
    this.groupsCacheTime = 0;
    this.activeMappingsCache = null;
    this.activeMappingsCacheTime = 0;

    // Iniciar Watchdog pasivo no destructivo cada 60 segundos
    this.startWatchdog();
  }

  /**
   * Verifica si existe una sesión de WhatsApp genuinamente guardada
   */
  hasSavedSession() {
    try {
      const authDir = resolveAuthDir();
      const credsFile = path.join(authDir, 'creds.json');
      if (fs.existsSync(credsFile)) {
        const stat = fs.statSync(credsFile);
        if (stat.size > 150) {
          const raw = fs.readFileSync(credsFile, 'utf8');
          const data = JSON.parse(raw);
          return Boolean(data && (data.registered === true || data.me || data.signedIdentityKey || data.account));
        }
      }
    } catch (e) {}
    return false;
  }

  getStatus() {
    const isPaused = Date.now() < this.circuitBreakerUntil;
    return {
      status: this.status,
      qr: this.qrDataUrl,
      user: this.userInfo,
      error: this.lastError,
      hasSavedSession: this.hasSavedSession(),
      isConnecting: this.isConnecting,
      isPaused,
      pauseRemainingSec: isPaused ? Math.ceil((this.circuitBreakerUntil - Date.now()) / 1000) : 0,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  /**
   * Watchdog pasivo y seguro: se ejecuta cada 60 segundos (no cada 10s).
   * Nunca destruye sockets vivos de manera precipitada y respeta el Circuit Breaker.
   */
  startWatchdog() {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);

    this.watchdogInterval = setInterval(() => {
      // 1. Si no hay credenciales guardadas, no hay nada que vigilar
      if (!this.hasSavedSession()) return;

      const now = Date.now();

      // 2. Si el Circuit Breaker está en período de enfriamiento, respetar el tiempo
      if (now < this.circuitBreakerUntil) {
        return;
      }

      // 3. Si lleva más de 60 segundos en 'connecting' atascado
      if (this.status === 'connecting' && (now - this.connectingStartedAt > 60000)) {
        console.warn('🛡️ [WhatsApp Watchdog] Conexión atascada (>60s). Limpiando socket preventivamente...');
        this.destroySocket();
        this.isConnecting = false;
        this.status = 'disconnected';
        return;
      }

      // 4. Si está desconectado y sin temporizador de reconexión pendiente, reactivar supervisado
      if (this.status === 'disconnected' && !this.sock && !this.isConnecting && !this.reconnectTimeout) {
        console.log('🛡️ [WhatsApp Watchdog] Sesión desconectada. Iniciando auto-conexión supervisada...');
        this.connect(false).catch(e => {
          console.warn('Advertencia en Watchdog de WhatsApp:', e.message);
        });
      }
    }, 60000); // Chequeo prudente cada 60 segundos
  }

  scheduleReconnect(delayMs, resetCounter = false) {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (resetCounter) {
        this.reconnectAttempts = 0;
        this.circuitBreakerUntil = 0;
      }
      this.connect(false).catch(err => {
        console.warn('⚠️ [WhatsApp] Fallo en reconexión programada:', err.message);
      });
    }, delayMs);
  }

  async ensureDbSchema() {
    if (!isPgConnected || !sql) return;
    try {
      await sql`
        ALTER TABLE public.whatsapp_logs ADD COLUMN IF NOT EXISTS message_id VARCHAR(100);
      `;
      await sql`
        ALTER TABLE public.whatsapp_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS idx_wa_logs_msg_id ON public.whatsapp_logs(message_id);
      `;
    } catch (e) {
      console.warn('Advertencia asegurando esquema de whatsapp_logs:', e.message);
    }
  }

  async init() {
    console.log('📱 [WhatsApp] Inicializando servicio...');
    await this.ensureDbSchema();
    await whatsappDictionaryService.initDictionary().catch(err => {
      console.warn('⚠️ [WhatsApp] Inicialización de diccionario con advertencia:', err.message);
    });
    const hasSession = this.hasSavedSession();
    const currentDir = resolveAuthDir();
    console.log(`📁 [WhatsApp] Directorio auth: "${currentDir}" (Sesión guardada detectada: ${hasSession})`);

    if (hasSession) {
      console.log('⚡ [WhatsApp] Auto-conectando sesión guardada en segundo plano...');
      this.connect(false).catch(err => {
        console.warn('⚠️ [WhatsApp] Auto-conexión inicial falló:', err.message);
      });
    } else {
      console.log('ℹ️ [WhatsApp] No hay credenciales de sesión previas. Esperando vinculación de usuario.');
    }
  }

  destroySocket() {
    if (this.sock) {
      try {
        // 1. Remover todos los listeners antes de cerrar para evitar bucles de eventos
        this.sock.ev?.removeAllListeners();

        // 2. Cerrar websocket subyacente si existe
        if (this.sock.ws) {
          try {
            this.sock.ws.removeAllListeners?.();
            this.sock.ws.close?.();
          } catch (e) {}
        }

        // 3. Finalizar socket Baileys
        this.sock.end?.(new Error('Resetting socket'));
      } catch (e) {}
      this.sock = null;
    }
  }

  async connect(force = false) {
    // Si el Circuit Breaker está activo y no es una acción explícita forzada por el usuario
    if (!force && Date.now() < this.circuitBreakerUntil) {
      const waitSec = Math.ceil((this.circuitBreakerUntil - Date.now()) / 1000);
      console.log(`⏸️ [WhatsApp] Pausa preventiva de reconexión activa (${waitSec}s restantes).`);
      return this.getStatus();
    }

    // Si ya está conectado con socket vivo y no es forzado, retornar estado actual
    if (this.sock && this.status === 'connected' && !force) {
      return this.getStatus();
    }

    // Si ya está esperando QR y tenemos la imagen lista, retornar estado sin recrear
    if (this.sock && this.status === 'waiting_qr' && this.qrDataUrl && !force) {
      return this.getStatus();
    }

    // BLOQUEO ESTRICTO DE CONCURRENCIA:
    // Si ya está en proceso de conexión reciente (< 45s), NUNCA ejecutar otra conexión simultánea
    if (this.isConnecting) {
      const elapsed = Date.now() - this.connectingStartedAt;
      if (elapsed < 45000 && !force) {
        console.log(`⏳ [WhatsApp] Ya hay una conexión en progreso (${Math.round(elapsed / 1000)}s). Petición paralela omitida.`);
        return this.getStatus();
      }
      if (elapsed >= 45000) {
        console.warn('⚠️ [WhatsApp] Conexión previa excedió 45s sin resolver. Limpiando recursos...');
        this.destroySocket();
      }
    }

    // Cancelar cualquier temporizador de reconexión programado
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Si el usuario forzó la conexión manualmente, reiniciar Circuit Breaker
    if (force) {
      this.circuitBreakerUntil = 0;
      this.reconnectAttempts = 0;
    }

    this.isConnecting = true;
    this.connectingStartedAt = Date.now();
    this.status = 'connecting';
    this.lastError = null;

    // Destruir socket anterior de manera limpia
    this.destroySocket();

    const currentAuthDir = resolveAuthDir();

    try {
      const { state, saveCreds } = await useMultiFileAuthState(currentAuthDir);

      this.sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['WISI Casino System', 'Chrome', '1.0.0'],
        markOnlineOnConnect: false, // NO enviar paquetes de presencia continua (reduce CPU y tráfico)
        syncFullHistory: false, // NO sincronizar historial antiguo de chats
        generateHighQualityLinkPreview: false, // Desactivar previews pesadas
        shouldIgnoreJid: (jid) => isJidBroadcast(jid) || isJidNewsletter(jid) || isJidStatusBroadcast(jid) || jid.endsWith('@broadcast'),
        connectTimeoutMs: 45000,
        defaultQueryTimeoutMs: 45000,
        keepAliveIntervalMs: 30000, // Ping cada 30 segundos
        retryRequestDelayMs: 3000 // Reintentos prudentes espaciados cada 3s, no 250ms
      });

      this.sock.ev.on('creds.update', saveCreds);

      // Esperar hasta que Baileys emita el primer código QR o abra la conexión
      const waitForFirstEvent = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(), 4000);

        const checkHandler = (update) => {
          if (update.qr || update.connection === 'open' || update.connection === 'close') {
            clearTimeout(timeout);
            setTimeout(() => resolve(), 100);
          }
        };

        this.sock?.ev?.on('connection.update', checkHandler);
      });

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrRaw = qr;
          try {
            this.qrDataUrl = await qrcode.toDataURL(qr, {
              width: 300,
              margin: 2,
              color: { dark: '#0f172a', light: '#ffffff' }
            });
            this.status = 'waiting_qr';
            this.isConnecting = false;
            this.reconnectAttempts = 0; // Código QR emitido con éxito
            console.log('⚡ [WhatsApp] Nuevo código QR generado para vinculación.');
          } catch (qrErr) {
            console.error('Error generando imagen QR:', qrErr);
          }
        }

        if (connection === 'open') {
          this.status = 'connected';
          this.isConnecting = false;
          this.qrDataUrl = null;
          this.qrRaw = null;
          this.reconnectAttempts = 0; // Conexión exitosa: resetear contador
          this.circuitBreakerUntil = 0;

          const userJid = this.sock?.user?.id || '';
          const phone = userJid.split(':')[0] || userJid.split('@')[0] || '';
          this.userInfo = {
            id: userJid,
            phone: phone ? `+${phone}` : 'Desconocido',
            name: this.sock?.user?.name || 'Bot WISI'
          };

          console.log(`✅ [WhatsApp] Conectado exitosamente como: ${this.userInfo.name} (${this.userInfo.phone})`);
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;
          const isRestartRequired = statusCode === DisconnectReason.restartRequired || statusCode === 515;

          console.warn(`⚠️ [WhatsApp] Conexión cerrada. Código: ${statusCode}. LoggedOut: ${isLoggedOut}. RestartRequired: ${isRestartRequired}`);

          this.destroySocket();
          this.isConnecting = false;

          if (isLoggedOut) {
            this.status = 'disconnected';
            this.userInfo = null;
            this.qrDataUrl = null;
            this.reconnectAttempts = 0;
            this.clearAuthFiles();
            console.log('🚪 [WhatsApp] Sesión cerrada desde el teléfono celular.');
            return;
          }

          if (isRestartRequired) {
            // Código 515 es estándar en Baileys: exige reinicio ordenado de handshake
            this.status = 'connecting';
            console.log('🔄 [WhatsApp] Reinicio de handshake requerido (515). Reconectando de forma ordenada...');
            this.scheduleReconnect(1500);
            return;
          }

          // Desconexión temporal de red o servidor de WhatsApp
          this.reconnectAttempts++;

          if (this.reconnectAttempts > this.maxReconnectAttempts) {
            const pauseMinutes = 5;
            this.circuitBreakerUntil = Date.now() + (pauseMinutes * 60 * 1000);
            this.status = 'disconnected';
            this.lastError = `Pausa preventiva (${pauseMinutes} min) tras ${this.maxReconnectAttempts} intentos fallidos consecutivos de conexión.`;
            console.warn(`🛑 [WhatsApp Circuit Breaker] Límite de ${this.maxReconnectAttempts} intentos consecutivos alcanzado. Pausando auto-reconexión por ${pauseMinutes} minutos para proteger el VPS.`);
            // Programar reactivación al finalizar el enfriamiento
            this.scheduleReconnect(pauseMinutes * 60 * 1000, true);
            return;
          }

          // Backoff exponencial ordenado: 5s, 10s, 20s, 40s, 60s, 60s...
          const delayMs = Math.min(5000 * Math.pow(2, this.reconnectAttempts - 1), 60000);
          this.status = 'connecting';
          console.log(`⏳ [WhatsApp] Conexión caída. Reintento ${this.reconnectAttempts}/${this.maxReconnectAttempts} en ${Math.round(delayMs / 1000)}s...`);
          this.scheduleReconnect(delayMs);
        }
      });

      // Escuchador de mensajes entrantes concurrente y no bloqueante
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (!Array.isArray(messages)) return;
        // Procesar en paralelo sin que un mensaje bloquee a otros grupos o mensajes del lote
        await Promise.allSettled(messages.map(m => this.processSingleUpsertMessage(m)));
      });

      // Escuchador de actualizaciones de mensajes para ediciones emitidas por Baileys
      this.sock.ev.on('messages.update', async (updates) => {
        if (!Array.isArray(updates)) return;
        await Promise.allSettled(updates.map(async (u) => {
          if (!u.key || u.key.fromMe) return;
          const remoteJid = u.key.remoteJid || '';
          if (!remoteJid.endsWith('@g.us')) return;

          const editedMsg = u.update?.message?.editedMessage?.message;
          if (editedMsg) {
            await this.handleEditedMessage(u, u.key, editedMsg);
          }
        }));
      });

      await waitForFirstEvent;

    } catch (err) {
      console.error('❌ [WhatsApp] Error iniciando conexión:', err);
      this.status = 'disconnected';
      this.lastError = err.message;
      this.isConnecting = false;
      this.destroySocket();

      // Si hay sesión guardada vinculada, programar reintento con backoff
      if (this.hasSavedSession()) {
        this.reconnectAttempts++;
        if (this.reconnectAttempts <= this.maxReconnectAttempts) {
          const delayMs = Math.min(5000 * Math.pow(2, this.reconnectAttempts - 1), 60000);
          console.log(`⏳ [WhatsApp] Reintentando auto-conexión en ${Math.round(delayMs / 1000)}s...`);
          this.scheduleReconnect(delayMs);
        } else {
          this.circuitBreakerUntil = Date.now() + (5 * 60 * 1000);
          this.scheduleReconnect(5 * 60 * 1000, true);
        }
      }
    }

    return this.getStatus();
  }

  async disconnect() {
    try {
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }
      this.circuitBreakerUntil = 0;
      this.reconnectAttempts = 0;

      if (this.sock) {
        await this.sock.logout().catch(() => {});
        this.sock.end(new Error('Logout manual'));
      }
    } catch (e) {
      console.warn('Error desconectando socket:', e.message);
    } finally {
      this.destroySocket();
      this.status = 'disconnected';
      this.userInfo = null;
      this.qrDataUrl = null;
      this.qrRaw = null;
      this.isConnecting = false;
      this.clearAuthFiles();
    }
    return this.getStatus();
  }

  clearAuthFiles() {
    try {
      const authDir = resolveAuthDir();
      if (fs.existsSync(authDir)) {
        const files = fs.readdirSync(authDir);
        for (const file of files) {
          try {
            fs.unlinkSync(path.join(authDir, file));
          } catch (e) {}
        }
        console.log('🗑️ [WhatsApp] Archivos de sesión eliminados.');
      }
    } catch (e) {
      console.warn('Error limpiando auth files:', e.message);
    }
  }

  /**
   * Obtiene la lista de grupos donde participa el bot con caché de 3 minutos
   * para no saturar al socket con peticiones masivas continuas.
   */
  async getParticipatingGroups(forceRefresh = false) {
    if (!this.sock || this.status !== 'connected') {
      return this.groupsCache || [];
    }

    const now = Date.now();
    if (!forceRefresh && this.groupsCache && (now - this.groupsCacheTime < 180000)) {
      return this.groupsCache;
    }

    try {
      const groups = await this.sock.groupFetchAllParticipating();
      const list = Object.values(groups).map(g => ({
        id: g.id,
        name: g.subject || 'Grupo Sin Nombre',
        desc: g.desc ? g.desc.toString() : '',
        participantsCount: g.participants ? g.participants.length : 0,
        creation: g.creation || null
      }));

      this.groupsCache = list.sort((a, b) => a.name.localeCompare(b.name));
      this.groupsCacheTime = now;
      return this.groupsCache;
    } catch (err) {
      console.error('Error obteniendo grupos de WhatsApp:', err);
      return this.groupsCache || [];
    }
  }

  /**
   * Invalida la caché en memoria de mapeos de grupos para refresco inmediato
   */
  invalidateMappingsCache() {
    this.activeMappingsCache = null;
    this.activeMappingsCacheTime = 0;
  }

  /**
   * Obtiene el mapeo de un grupo usando caché en memoria (30s) para evitar
   * ejecutar queries SELECT en PostgreSQL por cada mensaje irrelevante en WhatsApp.
   */
  async getActiveGroupMapping(remoteJid) {
    const now = Date.now();
    if (!this.activeMappingsCache || (now - this.activeMappingsCacheTime > 30000)) {
      if (!isPgConnected || !sql) return null;
      try {
        const rows = await sql`
          SELECT * FROM whatsapp_group_mappings
          WHERE is_active = true
        `;
        const map = new Map();
        for (const r of rows) {
          map.set(r.group_jid, r);
        }
        this.activeMappingsCache = map;
        this.activeMappingsCacheTime = now;
      } catch (e) {
        console.warn('Error refrescando caché de mapeos:', e.message);
        return null;
      }
    }

    return this.activeMappingsCache.get(remoteJid) || null;
  }

  /**
   * Procesa de forma aislada y no bloqueante un mensaje recibido de un grupo
   */
  async processSingleUpsertMessage(m) {
    if (!m || !m.message || m.key?.fromMe) return;

    const remoteJid = m.key.remoteJid || '';
    if (!remoteJid.endsWith('@g.us')) return;

    // 1. Detectar mensajes ELIMINADOS ("Eliminar para todos" en WhatsApp / REVOKE)
    const protoMsg = m.message.protocolMessage;
    const isProtocolRevoke = (protoMsg?.type === 0 || protoMsg?.type === 'REVOKE');
    if (isProtocolRevoke && protoMsg?.key) {
      const targetKey = {
        remoteJid: protoMsg.key.remoteJid || remoteJid,
        id: protoMsg.key.id,
        participant: protoMsg.key.participant || m.key.participant || undefined,
        fromMe: protoMsg.key.fromMe || false
      };
      await this.handleDeletedMessage(m, targetKey);
      return;
    }

    // 2. Detectar mensajes EDITADOS en WhatsApp
    const isProtocolEdit = (protoMsg?.type === 14 || protoMsg?.type === 'MESSAGE_EDIT') &&
                           Boolean(protoMsg?.editedMessage);
    if (isProtocolEdit) {
      const targetKey = {
        ...m.key,
        id: protoMsg.key?.id || m.key.id,
        remoteJid: protoMsg.key?.remoteJid || remoteJid,
        participant: protoMsg.key?.participant || m.key.participant
      };
      await this.handleEditedMessage(m, targetKey, protoMsg.editedMessage);
      return;
    }

    if (m.message?.editedMessage?.message) {
      const innerProtocol = m.message.editedMessage.message?.protocolMessage;
      const targetKey = {
        ...m.key,
        id: innerProtocol?.key?.id || m.key.id,
        remoteJid: innerProtocol?.key?.remoteJid || remoteJid,
        participant: innerProtocol?.key?.participant || m.key.participant
      };
      const innerEdited = innerProtocol?.editedMessage || m.message.editedMessage.message;
      await this.handleEditedMessage(m, targetKey, innerEdited);
      return;
    }

    // 3. Filtrar mensajes de protocolo no transaccionales, reacciones y encuestas
    if (m.message.protocolMessage || m.message.reactionMessage || m.message.pollUpdateMessage) return;

    // 4. Evitar procesar mensajes duplicados que reenvía WhatsApp al reconectar
    const msgId = m.key.id;
    if (msgId) {
      if (this.processedMessageIds.has(msgId)) return;
      this.processedMessageIds.add(msgId);
      if (this.processedMessageIds.size > 500) {
        const it = this.processedMessageIds.values();
        for (let i = 0; i < 150; i++) this.processedMessageIds.delete(it.next().value);
      }
    }

    // 5. Si el mensaje es más viejo de 10 minutos (ej. historial antiguo en cola), omitir
    const timestamp = m.messageTimestamp ? Number(m.messageTimestamp) * 1000 : Date.now();
    if (Date.now() - timestamp > 10 * 60 * 1000) {
      return;
    }

    await this.handleIncomingMessage(m);
  }

  /**
   * Envía una reacción emoji (check verde o azul) al mensaje con reintentos automáticos
   * para garantizar que nunca se quede en espera o se pierda por latencia de red.
   */
  async sendReactionWithRetry(remoteJid, messageKey, emoji, maxRetries = 3) {
    if (!this.sock || !remoteJid || !messageKey || !emoji) return false;

    const reactionKey = {
      remoteJid: messageKey.remoteJid || remoteJid,
      id: messageKey.id,
      participant: messageKey.participant || undefined
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // En el primer intento enviar de inmediato sin delay bloqueante (0ms)
        if (attempt > 1) {
          await new Promise(r => setTimeout(r, 600 * attempt));
        }

        if (!this.sock) break;

        await this.sock.sendMessage(remoteJid, {
          react: {
            text: emoji,
            key: reactionKey
          }
        });
        console.log(`✅ [WhatsApp React] Reacción "${emoji}" enviada correctamente a ${reactionKey.id} (intento ${attempt})`);
        return true;
      } catch (err) {
        console.warn(`⚠️ [WhatsApp React] Falló envío de reacción (intento ${attempt}/${maxRetries}):`, err.message);
      }
    }
    return false;
  }

  async handleIncomingMessage(m) {
    const remoteJid = m.key.remoteJid || '';
    if (!remoteJid.endsWith('@g.us')) return; // Solo procesar mensajes de grupos

    const messageText = (
      m.message?.conversation ||
      m.message?.extendedTextMessage?.text ||
      ''
    ).trim();

    if (!messageText) return;

    // FILTRO GLOBAL: Ignorar mensajes informativos de inicio, apertura, cierre, fin de jornada, etc.
    if (isSystemStatusOrInformationalMessage(messageText)) {
      console.log(`ℹ️ [WhatsApp] Mensaje informativo de apertura/cierre ignorado globalmente: "${messageText}"`);
      return;
    }

    if (!isPgConnected || !sql) {
      console.warn('PostgreSQL no disponible para procesar mensaje de WhatsApp');
      return;
    }

    try {
      // 1. Verificar si el grupo está mapeado en la base de datos y activo (vía caché rápido)
      const mapping = await this.getActiveGroupMapping(remoteJid);
      if (!mapping) {
        return; // Grupo no monitoreado, ignorar silenciosamente sin queries pesadas
      }

      // 2. Ejecutar el parser inteligente con diccionario y NLP según la configuración del grupo
      const groupTipoOps = mapping.tipo_operaciones || 'todo';
      const parsed = parseWhatsAppMessage(messageText, {
        caja_default: 'Mesas',
        modulo_destino: groupTipoOps === 'aportes_maquinas' ? 'aportes_maquinas' : 'control_clientes',
        tipo_operaciones: groupTipoOps,
        rangoRules: whatsappDictionaryService.getRangoRules()
      });

      if (!parsed || !parsed.success) {
        return; // No es un formato de transacción reconocido para este grupo, ignorar
      }

      // Restricción estricta de grupo si está configurado para un módulo exclusivo
      if (groupTipoOps === 'control_clientes' && parsed.modulo !== 'control_clientes') return;
      if (groupTipoOps === 'aportes_maquinas' && parsed.modulo !== 'aportes_maquinas') return;

      const senderJid = m.key.participant || remoteJid;
      const senderName = m.pushName || 'Usuario WhatsApp';

      console.log(`📩 [WhatsApp Group] [${mapping.group_name}] Mensaje detectado: "${messageText}"`);

      // 3. Buscar el último libro en curso (el más reciente abierto) para la sala vinculada
      let libros = [];
      if (mapping.sala_uuid) {
        libros = await sql`
          SELECT uuid, sala_uuid, descripcion, created_at
          FROM libros
          WHERE sala_uuid = ${mapping.sala_uuid}::uuid
            AND COALESCE(is_deleted, false) = false
          ORDER BY created_at DESC
          LIMIT 1
        `;
      }

      // Si no hay libro con esa sala_uuid específica, tomar el libro operativo activo más reciente del sistema
      if (libros.length === 0) {
        libros = await sql`
          SELECT uuid, sala_uuid, descripcion, created_at
          FROM libros
          WHERE COALESCE(is_deleted, false) = false
          ORDER BY created_at DESC
          LIMIT 1
        `;
      }

      if (libros.length === 0) {
        console.warn(`⚠️ No hay libro activo para la sala ${mapping.sala_uuid}`);
        await sql`
          INSERT INTO whatsapp_logs (
            group_jid, group_name, sender_jid, sender_name, raw_message, parsed_data, status, error_message, message_id
          ) VALUES (
            ${remoteJid}, ${mapping.group_name}, ${senderJid}, ${senderName}, ${messageText}, 
            ${sql.json(parsed)}, 'sin_libro_activo', 'No hay ningún libro operativo abierto hoy para esta sala', ${m.key?.id || null}
          )
        `;

        if (mapping.auto_reply && this.sock) {
          await this.sock.sendMessage(remoteJid, {
            text: `⚠️ *Atención:* No se pudo registrar la operación porque no hay ningún Libro Diario abierto hoy para esta sala en WISI.`
          }, { quoted: m });
        }
        return;
      }

      const libro = libros[0];
      let insertedUuid = null;

      // Resolver multisala_uuid (sub-sala / sala hija) estrictamente por UUID
      let targetMultisalaUuid = mapping.multisala_uuid || null;
      if (!targetMultisalaUuid && mapping.sala_uuid) {
        try {
          const salaRows = await sql`SELECT multisalas FROM salas WHERE uuid = ${mapping.sala_uuid}::uuid LIMIT 1`;
          if (salaRows.length > 0 && salaRows[0].multisalas) {
            let subs = salaRows[0].multisalas;
            if (typeof subs === 'string') {
              try { subs = JSON.parse(subs); } catch(e) { subs = []; }
            }
            if (Array.isArray(subs) && subs.length > 0) {
              const activeSub = subs.find(s => s && (s.active === 1 || s.active === true || s.active === undefined));
              if (activeSub && activeSub.uuid) {
                targetMultisalaUuid = activeSub.uuid;
              }
            }
          }
        } catch (eSub) {
          console.warn('Error resolviendo sub-sala:', eSub.message);
        }
      }

      // 4. Inserción según módulo
      if (parsed.modulo === 'control_clientes') {
        const { clienteUuid, clienteNombre, foundClient, esCoincidenciaExacta: clientExact } = await this.resolveCliente(parsed.cliente, mapping.sala_uuid);
        const { metodoPagoUuid, metodoAsignadoNombre, metodoFallbackUsado } = await this.resolveMetodoPago(parsed.metodo);

        let esCoincidenciaExacta = Boolean(foundClient && clientExact);
        let observaciones = [];

        if (!foundClient) {
          esCoincidenciaExacta = false;
          observaciones.push(parsed.cliente === 'General' ? 'Cliente no especificado (asignado General)' : `Cliente nuevo (${parsed.cliente})`);
        } else if (!clientExact) {
          esCoincidenciaExacta = false;
          observaciones.push(`Coincidencia parcial en cliente (${clienteNombre})`);
        }

        if (!parsed.explicit?.metodo) {
          esCoincidenciaExacta = false;
          observaciones.push(`Método de pago no especificado (asignado ${metodoAsignadoNombre})`);
        } else if (metodoFallbackUsado && parsed.metodo && normalizeText(parsed.metodo) !== normalizeText(metodoAsignadoNombre)) {
          esCoincidenciaExacta = false;
          observaciones.push(`Método "${parsed.metodo}" no registrado en BD (asignado a ${metodoAsignadoNombre})`);
        }

        const logStatus = esCoincidenciaExacta ? 'procesado' : 'procesado_por_verificar';
        const checkEmoji = esCoincidenciaExacta ? '✅' : '☑️';
        const obsTexto = observaciones.length > 0 ? observaciones.join('; ') : null;

        const horaStr = formatCaracasTime(parsed.hora || m.messageTimestamp);
        const metodoExtraNota = (metodoFallbackUsado && parsed.metodo && normalizeText(parsed.metodo) !== normalizeText(metodoAsignadoNombre))
          ? ` [Método: ${parsed.metodo}]`
          : '';

        const notaStr = parsed.nota 
          ? (obsTexto ? `${parsed.nota} [Verificar: ${obsTexto}]${metodoExtraNota}` : `${parsed.nota} (vía WhatsApp)${metodoExtraNota}`)
          : (obsTexto ? `Vía WhatsApp por ${senderName} [Verificar: ${obsTexto}]${metodoExtraNota}` : `Vía WhatsApp por ${senderName}${metodoExtraNota}`);

        const insertRes = await sql`
          INSERT INTO libro_control_clientes (
            libro_uuid,
            multisala_uuid,
            cliente_uuid,
            tipo,
            monto,
            metodo_pago_uuid,
            hora,
            nota
          ) VALUES (
            ${libro.uuid}::uuid,
            ${targetMultisalaUuid ? sql`${targetMultisalaUuid}::uuid` : sql`NULL`},
            ${clienteUuid ? sql`${clienteUuid}::uuid` : sql`NULL`},
            ${parsed.tipo},
            ${parsed.monto},
            ${metodoPagoUuid ? sql`${metodoPagoUuid}::uuid` : sql`NULL`},
            ${horaStr},
            ${notaStr}
          )
          RETURNING uuid
        `;

        insertedUuid = insertRes[0]?.uuid;

        // Registrar log con message_id para asociar futuras ediciones
        await sql`
          INSERT INTO whatsapp_logs (
            group_jid, group_name, sender_jid, sender_name, raw_message, parsed_data, status, error_message, inserted_record_uuid, message_id
          ) VALUES (
            ${remoteJid}, ${mapping.group_name}, ${senderJid}, ${senderName}, ${messageText}, 
            ${sql.json(parsed)}, ${logStatus}, ${obsTexto}, ${insertedUuid}, ${m.key?.id || null}
          )
        `;

        console.log(`${checkEmoji} [WhatsApp] Operación registrada en Control de Clientes [${logStatus}]: ${parsed.tipo} $${parsed.monto} - ${parsed.cliente} ${obsTexto ? `(${obsTexto})` : ''}`);

        if (insertedUuid) {
          try {
            broadcastLibroUpdate({
              libroId: libro.uuid || libro.id,
              modulo: 'control_clientes',
              action: 'create',
              data: { uuid: insertedUuid, source: 'whatsapp', tipo: parsed.tipo, monto: parsed.monto }
            });
          } catch (wsErr) {}
        }

        // Los chulitos se colocan ÚNICAMENTE cuando la información ya se insertó con éxito en la base de datos
        if (insertedUuid && mapping.auto_reply && this.sock) {
          await this.sendReactionWithRetry(remoteJid, m.key, checkEmoji);
        }

      } else if (parsed.modulo === 'aportes_maquinas') {
        const { rangoUuid, rangoNombre, rangoFallbackUsado, foundRango } = await this.resolveRango(parsed.rango, mapping.sala_uuid);
        const { empleadoUuid, empleadoNombre, cargo, empFallbackUsado, foundEmp, score, esCoincidenciaExacta: empExact, ambiguedad, candidatos } = await this.resolveEmpleado(parsed.operador, mapping.sala_uuid);

        // Regla: si encontró al empleado con coincidencia exacta y sin ambigüedad el chulito es verde (✅).
        // Si no lo encontró del todo o hay ambigüedad/coincidencia parcial, es azul (☑️).
        const encontroEmpleado = Boolean(foundEmp && !empFallbackUsado && empExact);
        const checkEmoji = encontroEmpleado ? '✅' : '☑️';
        const logStatus = encontroEmpleado ? 'procesado' : 'procesado_por_verificar';

        let observaciones = [];
        if (!foundEmp || empFallbackUsado) {
          const rawOp = cleanPersonName(parsed.operador);
          observaciones.push(rawOp 
            ? `Empleado "${rawOp}" no coincide en sala (asignado a ${empleadoNombre})` 
            : `Empleado no especificado (asignado a ${empleadoNombre})`
          );
        } else if (ambiguedad) {
          observaciones.push(`Ambigüedad en operador "${parsed.operador || ''}" (coincide con: ${candidatos ? candidatos.slice(0, 2).join(', ') : ''})`);
        } else if (!empExact) {
          observaciones.push(`Coincidencia parcial en operador (${empleadoNombre})`);
        }

        if (!foundRango) {
          observaciones.push(`Rango "${parsed.rango || 'no especificado'}" asignado a ${rangoNombre}`);
        }

        const obsTexto = observaciones.length > 0 ? observaciones.join('; ') : null;

        const horaStr = formatCaracasTime(parsed.hora || m.messageTimestamp);

        const insertRes = await sql`
          INSERT INTO libro_aportes (
            libro_uuid,
            multisala_uuid,
            empleado_uuid,
            rango_uuid,
            tipo,
            monto,
            hora
          ) VALUES (
            ${libro.uuid}::uuid,
            ${targetMultisalaUuid ? sql`${targetMultisalaUuid}::uuid` : sql`NULL`},
            ${empleadoUuid ? sql`${empleadoUuid}::uuid` : sql`NULL`},
            ${rangoUuid ? sql`${rangoUuid}::uuid` : sql`NULL`},
            ${parsed.tipo},
            ${parsed.monto},
            ${horaStr}
          )
          RETURNING uuid
        `;

        insertedUuid = insertRes[0]?.uuid;

        await sql`
          INSERT INTO whatsapp_logs (
            group_jid, group_name, sender_jid, sender_name, raw_message, parsed_data, status, error_message, inserted_record_uuid, message_id
          ) VALUES (
            ${remoteJid}, ${mapping.group_name}, ${senderJid}, ${senderName}, ${messageText}, 
            ${sql.json(parsed)}, ${logStatus}, ${obsTexto}, ${insertedUuid}, ${m.key?.id || null}
          )
        `;

        console.log(`${checkEmoji} [WhatsApp] ${parsed.tipo} registrado en Aportes [${logStatus}]: $${parsed.monto} - Rango: ${rangoNombre} - Operador: ${empleadoNombre} ${obsTexto ? `(${obsTexto})` : ''}`);

        if (insertedUuid) {
          try {
            broadcastLibroUpdate({
              libroId: libro.uuid || libro.id,
              modulo: 'aportes',
              action: 'create',
              data: { uuid: insertedUuid, source: 'whatsapp', tipo: parsed.tipo, monto: parsed.monto }
            });
          } catch (wsErr) {}
        }

        // Los chulitos se colocan ÚNICAMENTE cuando la información ya se insertó con éxito en la base de datos
        if (insertedUuid && mapping.auto_reply && this.sock) {
          await this.sendReactionWithRetry(remoteJid, m.key, checkEmoji);
        }
      }

    } catch (err) {
      console.error('❌ Error procesando mensaje de WhatsApp:', err);
      try {
        const errSenderJid = m?.key?.participant || remoteJid;
        const errSenderName = m?.pushName || 'Usuario WhatsApp';
        await sql`
          INSERT INTO whatsapp_logs (
            group_jid, group_name, sender_jid, sender_name, raw_message, status, error_message, message_id
          ) VALUES (
            ${remoteJid}, ${mapping?.group_name || 'Grupo WhatsApp'}, ${errSenderJid}, ${errSenderName}, ${messageText}, 'error_interno', ${err.message}, ${m?.key?.id || null}
          )
        `;
      } catch (e) {}
    }
  }

  /**
   * Manejador de Mensajes ELIMINADOS ("Eliminar para todos" en WhatsApp):
   * Si un usuario elimina un mensaje que ya había sido registrado en el sistema,
   * anula/soft-delete la fila en libro_control_clientes o libro_aportes,
   * actualiza whatsapp_logs y emite un evento WebSocket al frontend para reflejar la eliminación.
   */
  async handleDeletedMessage(rawEvent, targetKey) {
    const targetMsgId = targetKey?.id;
    const remoteJid = targetKey?.remoteJid || rawEvent.key?.remoteJid || '';
    if (!targetMsgId || !remoteJid.endsWith('@g.us')) return;

    if (!isPgConnected || !sql) return;

    try {
      const mapping = await this.getActiveGroupMapping(remoteJid);
      if (!mapping) return;

      console.log(`🗑️ [WhatsApp Revoke] Solicitud de eliminación para mensaje ${targetMsgId} en [${mapping.group_name}]`);

      const prevLogs = await sql`
        SELECT * FROM whatsapp_logs
        WHERE message_id = ${targetMsgId}
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (prevLogs.length === 0 || !prevLogs[0].inserted_record_uuid) {
        console.log(`ℹ️ [WhatsApp Revoke] No se encontró registro insertado para el mensaje ${targetMsgId}.`);
        return;
      }

      const prevLog = prevLogs[0];
      const recordUuid = prevLog.inserted_record_uuid;
      let libroUuid = null;
      let modulo = 'control_clientes';

      // 1. Intentar anular en libro_control_clientes
      const clientRows = await sql`
        UPDATE libro_control_clientes
        SET is_deleted = true,
            deleted_at = CURRENT_TIMESTAMP
        WHERE uuid = ${recordUuid}::uuid
        RETURNING libro_uuid
      `;

      if (clientRows.length > 0) {
        libroUuid = clientRows[0].libro_uuid;
        modulo = 'control_clientes';
      } else {
        // 2. Si no estaba en control_clientes, anular en libro_aportes
        const aporteRows = await sql`
          UPDATE libro_aportes
          SET is_deleted = true,
              deleted_at = CURRENT_TIMESTAMP
          WHERE uuid = ${recordUuid}::uuid
          RETURNING libro_uuid
        `;
        if (aporteRows.length > 0) {
          libroUuid = aporteRows[0].libro_uuid;
          modulo = 'aportes';
        }
      }

      // 3. Actualizar log de auditoría
      await sql`
        UPDATE whatsapp_logs
        SET status = 'eliminado_por_usuario',
            error_message = 'Transacción anulada porque el usuario eliminó el mensaje en WhatsApp',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${prevLog.id}
      `;

      console.log(`🗑️ [WhatsApp Revoke] Transacción ${recordUuid} (${modulo}) anulada en base de datos.`);

      // 4. Emitir broadcast WebSocket de eliminación en tiempo real
      if (libroUuid) {
        try {
          broadcastLibroUpdate({
            libroId: libroUuid,
            modulo: modulo,
            action: 'delete',
            data: { uuid: recordUuid, source: 'whatsapp', is_deleted: true }
          });
        } catch (wsErr) {
          console.warn('Error emitiendo broadcast de eliminación:', wsErr.message);
        }
      }

      // 5. Intentar limpiar la reacción en WhatsApp
      if (mapping.auto_reply && this.sock) {
        try {
          await this.sock.sendMessage(remoteJid, {
            react: {
              text: '',
              key: {
                remoteJid: targetKey.remoteJid || remoteJid,
                id: targetMsgId,
                participant: targetKey.participant || undefined
              }
            }
          });
        } catch (e) {}
      }

    } catch (err) {
      console.error('❌ Error manejando mensaje eliminado de WhatsApp:', err);
    }
  }

  /**
   * Manejador de Mensajes EDITADOS en WhatsApp:
   * Si un cajero o usuario corrige un monto, nombre o formato en WhatsApp,
   * actualiza en tiempo real la fila correspondiente en libro_control_clientes o libro_aportes,
   * incluyendo cambios cruzados de módulo (ej: de compra a aporte o viceversa).
   */
  async handleEditedMessage(rawEvent, targetKey, editedMessageObj) {
    const targetMsgId = targetKey?.id;
    const remoteJid = targetKey?.remoteJid || rawEvent.key?.remoteJid || '';
    if (!targetMsgId || !remoteJid.endsWith('@g.us')) return;

    const messageText = (
      editedMessageObj?.conversation ||
      editedMessageObj?.extendedTextMessage?.text ||
      ''
    ).trim();

    if (!messageText) return;

    // FILTRO GLOBAL: Mensajes informativos de apertura, cierre, inicio de turno/día/caja
    if (isSystemStatusOrInformationalMessage(messageText)) {
      console.log(`ℹ️ [WhatsApp Edit] Mensaje informativo de apertura/cierre ignorado: "${messageText}"`);
      return;
    }

    if (!isPgConnected || !sql) {
      console.warn('PostgreSQL no disponible para procesar mensaje editado');
      return;
    }

    try {
      const mapping = await this.getActiveGroupMapping(remoteJid);
      if (!mapping) return;

      const senderJid = targetKey.participant || rawEvent.key?.participant || remoteJid;
      const senderName = rawEvent.pushName || 'Usuario WhatsApp';

      console.log(`✏️ [WhatsApp Edit] [${mapping.group_name}] Mensaje editado detectado (msgId=${targetMsgId}): "${messageText}"`);

      // Buscar si el mensaje original tiene log registrado
      const prevLogs = await sql`
        SELECT * FROM whatsapp_logs
        WHERE message_id = ${targetMsgId}
        ORDER BY created_at DESC
        LIMIT 1
      `;

      // Si no existe log previo para ese ID: procesar como nueva transacción
      if (prevLogs.length === 0) {
        console.log(`ℹ️ [WhatsApp Edit] No se encontró log previo para ${targetMsgId}. Procesando como transacción directa...`);
        const syntheticMsg = {
          key: targetKey,
          message: editedMessageObj,
          messageTimestamp: rawEvent.messageTimestamp || Math.floor(Date.now() / 1000),
          pushName: senderName
        };
        await this.handleIncomingMessage(syntheticMsg);
        return;
      }

      const prevLog = prevLogs[0];
      const groupTipoOps = mapping.tipo_operaciones || 'todo';
      const parsed = parseWhatsAppMessage(messageText, {
        caja_default: 'Mesas',
        modulo_destino: groupTipoOps === 'aportes_maquinas' ? 'aportes_maquinas' : 'control_clientes',
        tipo_operaciones: groupTipoOps,
        rangoRules: whatsappDictionaryService.getRangoRules()
      });

      if (!parsed || !parsed.success) {
        console.warn(`⚠️ [WhatsApp Edit] El texto editado "${messageText}" no fue reconocido como transacción válida.`);
        await sql`
          UPDATE whatsapp_logs
          SET raw_message = ${messageText},
              status = 'editado_invalido',
              error_message = 'El mensaje fue editado pero el nuevo formato no fue reconocido',
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${prevLog.id}
        `;
        if (mapping.auto_reply && this.sock) {
          await this.sendReactionWithRetry(remoteJid, targetKey, '⚠️');
        }
        return;
      }

      // Si el log previo no tenía registro insertado: reintentar registro completo
      if (!prevLog.inserted_record_uuid) {
        console.log(`ℹ️ [WhatsApp Edit] Log previo no tenía registro insertado. Reintentando registro completo...`);
        const syntheticMsg = {
          key: targetKey,
          message: editedMessageObj,
          messageTimestamp: rawEvent.messageTimestamp || Math.floor(Date.now() / 1000),
          pushName: senderName
        };
        await this.handleIncomingMessage(syntheticMsg);
        return;
      }

      // Detectar en qué tabla estaba originalmente guardado el registro
      const origClientRows = await sql`
        SELECT uuid, libro_uuid, multisala_uuid 
        FROM libro_control_clientes 
        WHERE uuid = ${prevLog.inserted_record_uuid}::uuid AND COALESCE(is_deleted, false) = false
      `;
      const origAporteRows = (origClientRows.length === 0) ? await sql`
        SELECT uuid, libro_uuid, multisala_uuid 
        FROM libro_aportes 
        WHERE uuid = ${prevLog.inserted_record_uuid}::uuid AND COALESCE(is_deleted, false) = false
      ` : [];

      const originalModulo = origClientRows.length > 0 ? 'control_clientes' : (origAporteRows.length > 0 ? 'aportes_maquinas' : (prevLog.parsed_data?.modulo || 'control_clientes'));
      let libroUuid = origClientRows[0]?.libro_uuid || origAporteRows[0]?.libro_uuid || null;
      let multisalaUuid = origClientRows[0]?.multisala_uuid || origAporteRows[0]?.multisala_uuid || mapping.multisala_uuid || null;

      // Si no pudimos rescatar el libro_uuid, buscar el más reciente de la sala
      if (!libroUuid && mapping.sala_uuid) {
        const lbRows = await sql`
          SELECT uuid FROM libros WHERE sala_uuid = ${mapping.sala_uuid}::uuid AND COALESCE(is_deleted, false) = false ORDER BY created_at DESC LIMIT 1
        `;
        if (lbRows.length > 0) libroUuid = lbRows[0].uuid;
      }

      let esCoincidenciaExacta = true;
      let observaciones = [];

      if (parsed.modulo === 'control_clientes') {
        const { clienteUuid, clienteNombre, foundClient, esCoincidenciaExacta: clientExact } = await this.resolveCliente(parsed.cliente, mapping.sala_uuid);
        const { metodoPagoUuid, metodoAsignadoNombre, metodoFallbackUsado } = await this.resolveMetodoPago(parsed.metodo);

        esCoincidenciaExacta = Boolean(foundClient && clientExact);

        if (!foundClient) {
          esCoincidenciaExacta = false;
          observaciones.push(parsed.cliente === 'General' ? 'Cliente no especificado (asignado General)' : `Cliente nuevo (${parsed.cliente})`);
        } else if (!clientExact) {
          observaciones.push(`Coincidencia parcial en cliente (${clienteNombre})`);
        }

        if (!parsed.explicit?.metodo) {
          esCoincidenciaExacta = false;
          observaciones.push(`Método no especificado (asignado ${metodoAsignadoNombre})`);
        } else if (metodoFallbackUsado && parsed.metodo && normalizeText(parsed.metodo) !== normalizeText(metodoAsignadoNombre)) {
          esCoincidenciaExacta = false;
          observaciones.push(`Método "${parsed.metodo}" no registrado (asignado ${metodoAsignadoNombre})`);
        }

        const logStatus = esCoincidenciaExacta ? 'procesado_editado' : 'procesado_por_verificar_editado';
        const obsTexto = observaciones.length > 0 ? observaciones.join('; ') : null;
        const horaStr = formatCaracasTime(parsed.hora || prevLog.created_at);

        const metodoExtraNota = (metodoFallbackUsado && parsed.metodo && normalizeText(parsed.metodo) !== normalizeText(metodoAsignadoNombre))
          ? ` [Método: ${parsed.metodo}]`
          : '';

        const notaStr = parsed.nota 
          ? (obsTexto ? `${parsed.nota} [Editado vía WhatsApp: ${obsTexto}]${metodoExtraNota}` : `${parsed.nota} (Editado vía WhatsApp)${metodoExtraNota}`)
          : (obsTexto ? `Editado vía WhatsApp por ${senderName} [Verificar: ${obsTexto}]${metodoExtraNota}` : `Editado vía WhatsApp por ${senderName}${metodoExtraNota}`);

        if (originalModulo === 'aportes_maquinas') {
          // Cambio cruzado: Era un Aporte/Devolución y ahora es Compra/Pago
          console.log(`🔄 [WhatsApp Edit] Cambio de módulo detectado: Aporte -> Control de Clientes`);
          await sql`
            UPDATE libro_aportes
            SET is_deleted = true, deleted_at = CURRENT_TIMESTAMP
            WHERE uuid = ${prevLog.inserted_record_uuid}::uuid
          `;
          if (libroUuid) {
            try {
              broadcastLibroUpdate({
                libroId: libroUuid,
                modulo: 'aportes',
                action: 'delete',
                data: { uuid: prevLog.inserted_record_uuid, source: 'whatsapp', is_deleted: true }
              });
            } catch (wsErr) {}
          }

          const insertRes = await sql`
            INSERT INTO libro_control_clientes (
              libro_uuid, multisala_uuid, cliente_uuid, tipo, monto, metodo_pago_uuid, hora, nota
            ) VALUES (
              ${libroUuid}::uuid,
              ${multisalaUuid ? sql`${multisalaUuid}::uuid` : sql`NULL`},
              ${clienteUuid ? sql`${clienteUuid}::uuid` : sql`NULL`},
              ${parsed.tipo},
              ${parsed.monto},
              ${metodoPagoUuid ? sql`${metodoPagoUuid}::uuid` : sql`NULL`},
              ${horaStr},
              ${notaStr}
            ) RETURNING uuid
          `;
          const newRecordUuid = insertRes[0]?.uuid;

          await sql`
            UPDATE whatsapp_logs
            SET raw_message = ${messageText},
                parsed_data = ${sql.json(parsed)},
                status = ${logStatus},
                error_message = ${obsTexto},
                inserted_record_uuid = ${newRecordUuid},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ${prevLog.id}
          `;

          if (newRecordUuid && libroUuid) {
            try {
              broadcastLibroUpdate({
                libroId: libroUuid,
                modulo: 'control_clientes',
                action: 'create',
                data: { uuid: newRecordUuid, source: 'whatsapp', tipo: parsed.tipo, monto: parsed.monto }
              });
            } catch (wsErr) {}
          }

        } else {
          // Mismo módulo: Actualización directa in-place
          await sql`
            UPDATE libro_control_clientes
            SET tipo = ${parsed.tipo},
                monto = ${parsed.monto},
                cliente_uuid = ${clienteUuid ? sql`${clienteUuid}::uuid` : sql`NULL`},
                metodo_pago_uuid = ${metodoPagoUuid ? sql`${metodoPagoUuid}::uuid` : sql`NULL`},
                hora = ${horaStr},
                nota = ${notaStr}
            WHERE uuid = ${prevLog.inserted_record_uuid}::uuid
          `;

          await sql`
            UPDATE whatsapp_logs
            SET raw_message = ${messageText},
                parsed_data = ${sql.json(parsed)},
                status = ${logStatus},
                error_message = ${obsTexto},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ${prevLog.id}
          `;

          if (libroUuid) {
            try {
              broadcastLibroUpdate({
                libroId: libroUuid,
                modulo: 'control_clientes',
                action: 'update',
                data: { uuid: prevLog.inserted_record_uuid, source: 'whatsapp', tipo: parsed.tipo, monto: parsed.monto }
              });
            } catch (wsErr) {}
          }
        }

        console.log(`✏️ [WhatsApp Edit] Control de Clientes guardado [${logStatus}]: ${parsed.tipo} $${parsed.monto} - ${parsed.cliente}`);
        if (mapping.auto_reply && this.sock) {
          await this.sendReactionWithRetry(remoteJid, targetKey, '✏️');
        }

      } else if (parsed.modulo === 'aportes_maquinas') {
        const { rangoUuid, rangoNombre, rangoFallbackUsado, foundRango } = await this.resolveRango(parsed.rango, mapping.sala_uuid);
        const { empleadoUuid, empleadoNombre, cargo, empFallbackUsado, foundEmp, score, esCoincidenciaExacta: empExact, ambiguedad, candidatos } = await this.resolveEmpleado(parsed.operador, mapping.sala_uuid);

        const encontroEmpleado = Boolean(foundEmp && !empFallbackUsado && empExact);
        const logStatus = encontroEmpleado ? 'procesado_editado' : 'procesado_por_verificar_editado';

        let observaciones = [];
        if (!foundEmp || empFallbackUsado) {
          const rawOp = cleanPersonName(parsed.operador);
          observaciones.push(rawOp 
            ? `Empleado "${rawOp}" no coincide en sala (asignado a ${empleadoNombre})` 
            : `Empleado no especificado (asignado a ${empleadoNombre})`
          );
        } else if (ambiguedad) {
          observaciones.push(`Ambigüedad en operador "${parsed.operador || ''}" (coincide con: ${candidatos ? candidatos.slice(0, 2).join(', ') : ''})`);
        } else if (!empExact) {
          observaciones.push(`Coincidencia parcial en operador (${empleadoNombre})`);
        }

        if (!foundRango) {
          observaciones.push(`Rango "${parsed.rango || 'no especificado'}" asignado a ${rangoNombre}`);
        }

        const obsTexto = observaciones.length > 0 ? observaciones.join('; ') : null;
        const horaStr = formatCaracasTime(parsed.hora || prevLog.created_at);

        if (originalModulo === 'control_clientes') {
          // Cambio cruzado: Era Compra/Pago y ahora es Aporte/Devolución
          console.log(`🔄 [WhatsApp Edit] Cambio de módulo detectado: Control de Clientes -> Aporte`);
          await sql`
            UPDATE libro_control_clientes
            SET is_deleted = true, deleted_at = CURRENT_TIMESTAMP
            WHERE uuid = ${prevLog.inserted_record_uuid}::uuid
          `;
          if (libroUuid) {
            try {
              broadcastLibroUpdate({
                libroId: libroUuid,
                modulo: 'control_clientes',
                action: 'delete',
                data: { uuid: prevLog.inserted_record_uuid, source: 'whatsapp', is_deleted: true }
              });
            } catch (wsErr) {}
          }

          const insertRes = await sql`
            INSERT INTO libro_aportes (
              libro_uuid, multisala_uuid, empleado_uuid, rango_uuid, tipo, monto, hora
            ) VALUES (
              ${libroUuid}::uuid,
              ${multisalaUuid ? sql`${multisalaUuid}::uuid` : sql`NULL`},
              ${empleadoUuid ? sql`${empleadoUuid}::uuid` : sql`NULL`},
              ${rangoUuid ? sql`${rangoUuid}::uuid` : sql`NULL`},
              ${parsed.tipo},
              ${parsed.monto},
              ${horaStr}
            ) RETURNING uuid
          `;
          const newRecordUuid = insertRes[0]?.uuid;

          await sql`
            UPDATE whatsapp_logs
            SET raw_message = ${messageText},
                parsed_data = ${sql.json(parsed)},
                status = ${logStatus},
                error_message = ${obsTexto},
                inserted_record_uuid = ${newRecordUuid},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ${prevLog.id}
          `;

          if (newRecordUuid && libroUuid) {
            try {
              broadcastLibroUpdate({
                libroId: libroUuid,
                modulo: 'aportes',
                action: 'create',
                data: { uuid: newRecordUuid, source: 'whatsapp', tipo: parsed.tipo, monto: parsed.monto }
              });
            } catch (wsErr) {}
          }

        } else {
          // Mismo módulo: Actualización directa in-place
          await sql`
            UPDATE libro_aportes
            SET tipo = ${parsed.tipo},
                monto = ${parsed.monto},
                empleado_uuid = ${empleadoUuid ? sql`${empleadoUuid}::uuid` : sql`NULL`},
                rango_uuid = ${rangoUuid ? sql`${rangoUuid}::uuid` : sql`NULL`},
                hora = ${horaStr}
            WHERE uuid = ${prevLog.inserted_record_uuid}::uuid
          `;

          await sql`
            UPDATE whatsapp_logs
            SET raw_message = ${messageText},
                parsed_data = ${sql.json(parsed)},
                status = ${logStatus},
                error_message = ${obsTexto},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ${prevLog.id}
          `;

          if (libroUuid) {
            try {
              broadcastLibroUpdate({
                libroId: libroUuid,
                modulo: 'aportes',
                action: 'update',
                data: { uuid: prevLog.inserted_record_uuid, source: 'whatsapp', tipo: parsed.tipo, monto: parsed.monto }
              });
            } catch (wsErr) {}
          }
        }

        console.log(`✏️ [WhatsApp Edit] Aportes guardado [${logStatus}]: ${parsed.tipo} $${parsed.monto} - Rango: ${rangoNombre} - Operador: ${empleadoNombre}`);
        if (mapping.auto_reply && this.sock) {
          await this.sendReactionWithRetry(remoteJid, targetKey, '✏️');
        }
      }

    } catch (err) {
      console.error('❌ Error procesando mensaje editado de WhatsApp:', err);
    }
  }

  async resolveCliente(parsedCliente, salaUuid) {
    return await whatsappDictionaryService.resolveCliente(parsedCliente, salaUuid);
  }

  async resolveMetodoPago(parsedMetodo) {
    return await whatsappDictionaryService.resolveMetodoPago(parsedMetodo);
  }

  async resolveRango(parsedRango, salaUuid) {
    return await whatsappDictionaryService.resolveRango(parsedRango, salaUuid);
  }

  async resolveEmpleado(parsedOperador, salaUuid) {
    return await whatsappDictionaryService.resolveEmpleado(parsedOperador, salaUuid);
  }
}

export const whatsappService = new WhatsAppService();
