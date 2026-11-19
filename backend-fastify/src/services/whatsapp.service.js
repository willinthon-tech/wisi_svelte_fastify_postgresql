import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { sql, isPgConnected } from '../config/db.js';
import { parseWhatsAppMessage, normalizeText } from './whatsapp-parser.js';

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

    // Iniciar Watchdog para asegurar que el servicio nunca se caiga ni se desconecte silenciosamente
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
    return {
      status: this.status,
      qr: this.qrDataUrl,
      user: this.userInfo,
      error: this.lastError,
      hasSavedSession: this.hasSavedSession(),
      isConnecting: this.isConnecting
    };
  }

  startWatchdog() {
    if (this.watchdogInterval) clearInterval(this.watchdogInterval);

    this.watchdogInterval = setInterval(() => {
      // Si hay sesión guardada vinculada, asegurar que siempre esté activa 24/7
      if (this.hasSavedSession()) {
        const now = Date.now();
        const isStuckConnecting = (this.status === 'connecting' && (now - this.connectingStartedAt > 20000));
        const isDisconnected = (this.status === 'disconnected' && !this.sock);
        // Verificar si el WebSocket subyacente cayó silenciosamente (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED)
        const isSocketDead = (this.status === 'connected' && (!this.sock || !this.sock.ws || this.sock.ws.readyState !== 1));

        if (isDisconnected || isStuckConnecting || isSocketDead) {
          console.log(`🛡️ [WhatsApp Watchdog] Alerta: estado="${this.status}" (Colgado: ${isStuckConnecting}, SocketMuerto: ${isSocketDead}). Reactivando conexión automáticamente...`);
          this.destroySocket();
          this.connect(true).catch(e => {
            console.warn('Advertencia en Watchdog de WhatsApp:', e.message);
          });
        }
      }
    }, 10000); // Chequeo constante cada 10 segundos
  }

  async init() {
    console.log('📱 [WhatsApp] Inicializando servicio...');
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
        this.sock.ev?.removeAllListeners();
        this.sock.end?.(new Error('Resetting socket'));
      } catch (e) {}
      this.sock = null;
    }
  }

  async connect(force = false) {
    // Si ya está conectado y el socket está vivo con WebSocket OPEN, no duplicar
    if (this.sock && this.status === 'connected' && this.sock.ws?.readyState === 1 && !force) {
      return this.getStatus();
    }

    // Si ya está esperando QR y tenemos la imagen lista, retornar estado
    if (this.sock && this.status === 'waiting_qr' && this.qrDataUrl && !force) {
      return this.getStatus();
    }

    // Si ya está en proceso de conexión reciente (< 15s) y no es forzado, no duplicar
    if (this.isConnecting && (Date.now() - this.connectingStartedAt < 15000) && !force) {
      return this.getStatus();
    }

    // Cancelar cualquier temporizador de reconexión pendiente
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.isConnecting = true;
    this.connectingStartedAt = Date.now();
    this.status = 'connecting';
    this.lastError = null;

    // Destruir socket anterior para limpiar estado
    this.destroySocket();

    const currentAuthDir = resolveAuthDir();

    try {
      const { state, saveCreds } = await useMultiFileAuthState(currentAuthDir);

      this.sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['WISI Casino System', 'Chrome', '1.0.0'],
        syncFullHistory: false,
        connectTimeoutMs: 30000,
        defaultQueryTimeoutMs: 30000,
        keepAliveIntervalMs: 15000, // Enviar pings cada 15 segundos para detectar caídas de internet de inmediato
        retryRequestDelayMs: 250
      });

      this.sock.ev.on('creds.update', saveCreds);

      // Esperar activamente hasta que Baileys emita el primer código QR o abra la conexión
      const waitForFirstEvent = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(), 3500);

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
            this.clearAuthFiles();
            console.log('🚪 [WhatsApp] Sesión cerrada desde el teléfono celular.');
          } else if (isRestartRequired) {
            // Código 515 es estándar en Baileys: exige reinicio inmediato del socket
            this.status = 'connecting';
            console.log('🔄 [WhatsApp] Reinicio de flujo requerido (515). Reconectando de inmediato...');
            this.connect(true).catch(() => {});
          } else {
            // Desconexión temporal de red, pérdida de wifi/datos en el teléfono o caída de servidor
            this.status = 'connecting';
            console.log('⏳ [WhatsApp] Conexión caída. Reintentando automáticamente en 3 segundos...');
            this.reconnectTimeout = setTimeout(() => {
              this.connect(true).catch(() => {});
            }, 3000);
          }
        }
      });

      // Escuchador de mensajes entrantes (soporta tanto 'notify' como mensajes retrasados 'append')
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // Procesar mensajes nuevos o en cola tras recuperar conexión a internet
        for (const m of messages) {
          if (!m.message || m.key.fromMe) continue;

          // Evitar procesar mensajes duplicados que reenvía WhatsApp al reconectar
          const msgId = m.key.id;
          if (msgId) {
            if (this.processedMessageIds.has(msgId)) continue;
            this.processedMessageIds.add(msgId);
            if (this.processedMessageIds.size > 1000) {
              const it = this.processedMessageIds.values();
              for (let i = 0; i < 200; i++) this.processedMessageIds.delete(it.next().value);
            }
          }

          // Si el mensaje es más viejo de 15 minutos (ej. historial muy antiguo), omitir
          const timestamp = m.messageTimestamp ? Number(m.messageTimestamp) * 1000 : Date.now();
          if (Date.now() - timestamp > 15 * 60 * 1000) {
            continue;
          }

          await this.handleIncomingMessage(m);
        }
      });

      await waitForFirstEvent;

    } catch (err) {
      console.error('❌ [WhatsApp] Error iniciando conexión:', err);
      this.status = 'disconnected';
      this.lastError = err.message;
      this.isConnecting = false;
      this.destroySocket();

      // Si hay sesión guardada vinculada, reintentar automáticamente en 5 segundos
      if (this.hasSavedSession()) {
        console.log('⏳ [WhatsApp] Reintentando auto-conexión en 5 segundos...');
        this.reconnectTimeout = setTimeout(() => {
          this.connect(true).catch(() => {});
        }, 5000);
      }
    }

    return this.getStatus();
  }

  async disconnect() {
    try {
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

  async getParticipatingGroups() {
    if (!this.sock || this.status !== 'connected') {
      return [];
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

      return list.sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      console.error('Error obteniendo grupos de WhatsApp:', err);
      return [];
    }
  }

  /**
   * Envía una reacción emoji (check verde o azul) al mensaje con reintentos automáticos
   * para garantizar que nunca se quede en espera o se pierda por latencia de red.
   */
  async sendReactionWithRetry(remoteJid, messageKey, emoji, maxRetries = 3) {
    if (!this.sock || !remoteJid || !messageKey || !emoji) return false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Pausa preventiva para sincronizar mensaje con el socket de Baileys
        const delayMs = attempt === 1 ? 500 : 1200 * attempt;
        await new Promise(r => setTimeout(r, delayMs));

        if (!this.sock) break;

        await this.sock.sendMessage(remoteJid, {
          react: {
            text: emoji,
            key: messageKey
          }
        });
        console.log(`✅ [WhatsApp React] Reacción "${emoji}" enviada correctamente (intento ${attempt})`);
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

    if (!isPgConnected || !sql) {
      console.warn('PostgreSQL no disponible para procesar mensaje de WhatsApp');
      return;
    }

    try {
      // 1. Verificar si el grupo está mapeado en la base de datos y activo
      const mappings = await sql`
        SELECT * FROM whatsapp_group_mappings
        WHERE group_jid = ${remoteJid} AND is_active = true
        LIMIT 1
      `;

      if (mappings.length === 0) {
        return; // Grupo no monitoreado, ignorar silenciosamente
      }

      const mapping = mappings[0];

      // 2. Ejecutar el parser inteligente con diccionario y NLP
      const parsed = parseWhatsAppMessage(messageText, {
        caja_default: 'Mesas',
        modulo_destino: 'control_clientes'
      });

      if (!parsed || !parsed.success) {
        return; // No es un formato de transacción reconocido, ignorar para no responder a chats casuales
      }

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
            group_jid, group_name, sender_jid, sender_name, raw_message, parsed_data, status, error_message
          ) VALUES (
            ${remoteJid}, ${mapping.group_name}, ${senderJid}, ${senderName}, ${messageText}, 
            ${sql.json(parsed)}, 'sin_libro_activo', 'No hay ningún libro operativo abierto hoy para esta sala'
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
        // A) Buscar o resolver Cliente asociado a la SALA del grupo de WhatsApp (con matching inteligente)
        let clienteUuid = null;
        let foundClient = null;

        const allClients = await sql`
          SELECT uuid, nombre 
          FROM clientes 
          WHERE ${mapping.sala_uuid ? sql`(sala_uuid = ${mapping.sala_uuid}::uuid OR sala_uuid IS NULL)` : sql`true`}
            AND COALESCE(is_deleted, false) = false
        `;

        if (parsed.cliente && parsed.cliente.toLowerCase() !== 'general' && allClients.length > 0) {
          const normTarget = normalizeText(parsed.cliente);

          // 1. Coincidencia exacta normalizada
          foundClient = allClients.find(c => normalizeText(c.nombre) === normTarget);

          // 2. Coincidencia si el nombre empieza con el término (ej. "Hassan" -> "Hassan Hussenin Ghazale")
          if (!foundClient) {
            foundClient = allClients.find(c => normalizeText(c.nombre).startsWith(normTarget + ' '));
          }

          // 3. Coincidencia por palabra individual (ej. apellido "Ghazale" o "Coitez")
          if (!foundClient) {
            foundClient = allClients.find(c => {
              const words = normalizeText(c.nombre).split(/\s+/);
              return words.includes(normTarget);
            });
          }

          // 4. Coincidencia substring
          if (!foundClient) {
            foundClient = allClients.find(c => normalizeText(c.nombre).includes(normTarget) || normTarget.includes(normalizeText(c.nombre)));
          }

          if (foundClient) {
            clienteUuid = foundClient.uuid;
          } else {
            // Crear nuevo cliente asignado a la sala del grupo
            const newClient = await sql`
              INSERT INTO clientes (nombre, sala_uuid)
              VALUES (${parsed.cliente.trim()}, ${mapping.sala_uuid ? sql`${mapping.sala_uuid}::uuid` : sql`NULL`})
              RETURNING uuid
            `;
            clienteUuid = newClient[0]?.uuid;
          }
        } else {
          // Cliente General
          foundClient = allClients.find(c => normalizeText(c.nombre) === 'general');
          if (foundClient) {
            clienteUuid = foundClient.uuid;
          } else {
            // Buscar o crear cliente General para esta sala
            const newGenClient = await sql`
              INSERT INTO clientes (nombre, sala_uuid)
              VALUES ('General', ${mapping.sala_uuid ? sql`${mapping.sala_uuid}::uuid` : sql`NULL`})
              RETURNING uuid
            `;
            clienteUuid = newGenClient[0]?.uuid;
          }
        }

        // B) Buscar método de pago por coincidencia inteligente (Diccionario & NLP)
        let metodoPagoUuid = null;
        let metodoFallbackUsado = false;
        let metodoAsignadoNombre = 'General';

        const allMetodos = await sql`
          SELECT uuid, nombre FROM metodos_pago 
          WHERE COALESCE(is_deleted, false) = false
        `;

        let foundMetodo = null;
        if (parsed.metodo && allMetodos.length > 0) {
          const normMetodo = normalizeText(parsed.metodo);

          // 1. Coincidencia exacta normalizada
          foundMetodo = allMetodos.find(m => normalizeText(m.nombre) === normMetodo);

          // 2. Coincidencia por alias conocidos del diccionario
          if (!foundMetodo) {
            if (normMetodo === 'pdv' || normMetodo === 'punto') {
              foundMetodo = allMetodos.find(m => {
                const n = normalizeText(m.nombre);
                return n === 'pdv' || n === 'punto' || n.includes('punto') || n === 'pos' || n.includes('debito') || n.includes('tarjeta');
              });
            } else if (normMetodo.includes('pago movil') || normMetodo.includes('pago mobil') || normMetodo === 'pm') {
              foundMetodo = allMetodos.find(m => {
                const n = normalizeText(m.nombre);
                return n.includes('movil') || n.includes('mobil') || n === 'pm';
              });
            } else if (normMetodo === 'usdt') {
              foundMetodo = allMetodos.find(m => {
                const n = normalizeText(m.nombre);
                return n === 'usdt' || n.includes('binance') || n.includes('crypto') || n.includes('tether');
              });
            } else if (normMetodo === 'cash') {
              foundMetodo = allMetodos.find(m => {
                const n = normalizeText(m.nombre);
                return n === 'cash' || n.includes('efectivo') || n.includes('dolar') || n === 'usd';
              });
            } else if (normMetodo === 'zelle') {
              foundMetodo = allMetodos.find(m => normalizeText(m.nombre).includes('zelle') || normalizeText(m.nombre).includes('zele'));
            } else if (normMetodo === 'transferencia') {
              foundMetodo = allMetodos.find(m => normalizeText(m.nombre).includes('transf') || normalizeText(m.nombre).includes('banco'));
            } else if (normMetodo === 'zinli') {
              foundMetodo = allMetodos.find(m => normalizeText(m.nombre).includes('zinli'));
            } else if (normMetodo === 'wally') {
              foundMetodo = allMetodos.find(m => normalizeText(m.nombre).includes('wally'));
            } else if (normMetodo === 'paypal') {
              foundMetodo = allMetodos.find(m => normalizeText(m.nombre).includes('paypal'));
            } else if (normMetodo === 'general' || normMetodo === 'otros') {
              foundMetodo = allMetodos.find(m => normalizeText(m.nombre).includes('general') || normalizeText(m.nombre).includes('otro'));
            }
          }
        }

        // 3. Fallback Genérico: si no existe en BD (ej. "Zinli") o no se especificó método
        if (!foundMetodo && allMetodos.length > 0) {
          // Prioridad 1: Buscar método "General"
          foundMetodo = allMetodos.find(m => normalizeText(m.nombre) === 'general');
          // Prioridad 2: Buscar método "Cash" / "Efectivo"
          if (!foundMetodo) {
            foundMetodo = allMetodos.find(m => normalizeText(m.nombre) === 'cash' || normalizeText(m.nombre).includes('efectivo'));
          }
          // Prioridad 3: Primer método de la lista
          if (!foundMetodo) {
            foundMetodo = allMetodos[0];
          }
          metodoFallbackUsado = true;
        }

        if (foundMetodo) {
          metodoPagoUuid = foundMetodo.uuid;
          metodoAsignadoNombre = foundMetodo.nombre;
        }

        // C) Evaluación de coincidencias para definir el chulito (Verde ✅ vs Azul ☑️)
        let esCoincidenciaExacta = true;
        let observaciones = [];

        // 1. Verificación de Cliente: ¿existía ya en la base de datos de esta sala?
        if (!foundClient) {
          esCoincidenciaExacta = false;
          observaciones.push(parsed.cliente === 'General' ? 'Cliente no especificado (asignado General)' : `Cliente nuevo (${parsed.cliente})`);
        }

        // 2. Verificación de Método de Pago: ¿fue explícito y coincide con la BD, o requirió genérico?
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

        // D) Hora de la transacción (Hora de Caracas, 00:00 a 23:59 garantizado)
        const horaStr = formatCaracasTime(parsed.hora || m.messageTimestamp);

        const metodoExtraNota = (metodoFallbackUsado && parsed.metodo && normalizeText(parsed.metodo) !== normalizeText(metodoAsignadoNombre))
          ? ` [Método: ${parsed.metodo}]`
          : '';

        const notaStr = parsed.nota 
          ? (obsTexto ? `${parsed.nota} [Verificar: ${obsTexto}]${metodoExtraNota}` : `${parsed.nota} (vía WhatsApp)${metodoExtraNota}`)
          : (obsTexto ? `Vía WhatsApp por ${senderName} [Verificar: ${obsTexto}]${metodoExtraNota}` : `Vía WhatsApp por ${senderName}${metodoExtraNota}`);

        // E) Insertar en libro_control_clientes
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

        // Registrar log
        await sql`
          INSERT INTO whatsapp_logs (
            group_jid, group_name, sender_jid, sender_name, raw_message, parsed_data, status, error_message, inserted_record_uuid
          ) VALUES (
            ${remoteJid}, ${mapping.group_name}, ${senderJid}, ${senderName}, ${messageText}, 
            ${sql.json(parsed)}, ${logStatus}, ${obsTexto}, ${insertedUuid}
          )
        `;

        console.log(`${checkEmoji} [WhatsApp] Operación registrada en Control de Clientes [${logStatus}]: ${parsed.tipo} $${parsed.monto} - ${parsed.cliente} ${obsTexto ? `(${obsTexto})` : ''}`);

        // F) Confirmación en WhatsApp: Reaccionar con el check (Verde ✅ si todo coincide, Azul ☑️ si requiere verificación) con reintentos
        if (mapping.auto_reply && this.sock) {
          await this.sendReactionWithRetry(remoteJid, m.key, checkEmoji);
        }

      } else if (parsed.modulo === 'aportes_maquinas') {
        // Módulo de aportes y devoluciones en máquinas
        // A) Buscar o resolver Rango con matching inteligente (Diccionario & NLP)
        let rangoUuid = null;
        let rangoNombre = parsed.rango || 'General';

        const allRangos = await sql`
          SELECT uuid, nombre FROM rangos 
          WHERE COALESCE(is_deleted, false) = false
        `;

        let foundRango = null;
        if (parsed.rango && allRangos.length > 0) {
          const normTarget = normalizeText(parsed.rango);

          // 1. Coincidencia exacta normalizada
          foundRango = allRangos.find(r => normalizeText(r.nombre) === normTarget);

          // 2. Coincidencia por número de rango (ej. "Rango 1", "Rango 2"...)
          if (!foundRango) {
            const numMatch = normTarget.match(/\b([1-9])\b/);
            if (numMatch) {
              const targetNum = numMatch[1];
              foundRango = allRangos.find(r => {
                const rn = normalizeText(r.nombre);
                return rn.endsWith(targetNum) || rn.includes(`rango ${targetNum}`) || rn.includes(`rg ${targetNum}`) || rn.includes(`rg${targetNum}`);
              });
            }
          }

          // 3. Coincidencia por fumadores, ruleta o sin rango
          if (!foundRango) {
            if (normTarget.includes('fuma')) {
              foundRango = allRangos.find(r => normalizeText(r.nombre).includes('fuma'));
            } else if (normTarget.includes('ruleta')) {
              foundRango = allRangos.find(r => normalizeText(r.nombre).includes('ruleta'));
            } else if (normTarget.includes('sin rango') || normTarget === 'sr') {
              foundRango = allRangos.find(r => normalizeText(r.nombre).includes('sin rango') || normalizeText(r.nombre).includes('sinrango'));
            }
          }

          // 4. Coincidencia substring
          if (!foundRango) {
            foundRango = allRangos.find(r => normalizeText(r.nombre).includes(normTarget) || normTarget.includes(normalizeText(r.nombre)));
          }

          if (foundRango) {
            rangoUuid = foundRango.uuid;
            rangoNombre = foundRango.nombre;
          }
        }

        // Si no encontró rango o no se especificó, NO CREAR: usar el valor genérico "General"
        let rangoFallbackUsado = false;
        if (!rangoUuid && allRangos.length > 0) {
          const genRango = allRangos.find(r => normalizeText(r.nombre) === 'general') ||
                           allRangos.find(r => normalizeText(r.nombre) === 'sin rango') ||
                           allRangos[0];
          if (genRango) {
            rangoUuid = genRango.uuid;
            rangoNombre = genRango.nombre;
            rangoFallbackUsado = true;
          }
        }

        // B) Buscar o resolver Empleado / Operador de la SALA con matching inteligente
        let empleadoUuid = null;
        let empleadoNombre = parsed.operador || 'Operador General';
        let foundEmp = null;
        let empFallbackUsado = false;

        const allEmps = await sql`
          SELECT e.uuid, e.nombre, e.cedula, d.sala_uuid 
          FROM empleados e
          LEFT JOIN cargos c ON e.cargo_uuid = c.uuid
          LEFT JOIN areas a ON c.area_uuid = a.uuid
          LEFT JOIN departamentos d ON a.departamento_uuid = d.uuid
          WHERE COALESCE(e.activo, true) = true 
            AND COALESCE(e.is_deleted, false) = false
            ${mapping.sala_uuid ? sql`AND (d.sala_uuid = ${mapping.sala_uuid}::uuid OR d.sala_uuid IS NULL)` : sql``}
        `;

        if (parsed.operador && parsed.operador.toLowerCase() !== 'general' && allEmps.length > 0) {
          const normTarget = normalizeText(parsed.operador);

          // 1. Coincidencia exacta normalizada
          foundEmp = allEmps.find(e => normalizeText(e.nombre) === normTarget);

          // 2. Coincidencia si el nombre empieza con el término (ej. "Manuel" -> "Manuel Barrientos")
          if (!foundEmp) {
            foundEmp = allEmps.find(e => normalizeText(e.nombre).startsWith(normTarget + ' '));
          }

          // 3. Coincidencia por palabra individual (ej. "Jonas" en "Bonalde Jonas", o "Cesar" en "Cesar Mendoza")
          if (!foundEmp) {
            foundEmp = allEmps.find(e => {
              const words = normalizeText(e.nombre).split(/\s+/);
              return words.includes(normTarget);
            });
          }

          // 4. Coincidencia substring
          if (!foundEmp) {
            foundEmp = allEmps.find(e => normalizeText(e.nombre).includes(normTarget) || normTarget.includes(normalizeText(e.nombre)));
          }

          if (foundEmp) {
            empleadoUuid = foundEmp.uuid;
            empleadoNombre = foundEmp.nombre;
          }
        }

        // Si el operador no existe en la sala o no se especificó, NO CREAR: asignar al valor genérico "General"
        if (!empleadoUuid && allEmps.length > 0) {
          const genEmp = allEmps.find(e => normalizeText(e.nombre) === 'general') || allEmps[0];
          if (genEmp) {
            empleadoUuid = genEmp.uuid;
            empleadoNombre = genEmp.nombre;
            empFallbackUsado = true;
          }
        }

        // C) Evaluación de coincidencias para definir el chulito (Verde ✅ vs Azul ☑️)
        let esCoincidenciaExacta = true;
        let observaciones = [];

        // 1. Verificación de Rango: ¿existía ya en la BD o requirió fallback genérico?
        if (!parsed.explicit?.rango) {
          esCoincidenciaExacta = false;
          observaciones.push('Rango no especificado (asignado a General)');
        } else if (rangoFallbackUsado || !foundRango) {
          esCoincidenciaExacta = false;
          observaciones.push(`Rango "${parsed.rango}" no registrado en BD (asignado a ${rangoNombre})`);
        }

        // 2. Verificación de Operador: ¿coincidió con un empleado activo de la sala o requirió fallback?
        if (!parsed.explicit?.operador) {
          esCoincidenciaExacta = false;
          observaciones.push('Operador no especificado (asignado a General)');
        } else if (empFallbackUsado || !foundEmp) {
          esCoincidenciaExacta = false;
          observaciones.push(parsed.operador === 'General' ? 'Operador General' : `Operador "${parsed.operador}" no registrado en sala (asignado a ${empleadoNombre})`);
        }

        const logStatus = esCoincidenciaExacta ? 'procesado' : 'procesado_por_verificar';
        const checkEmoji = esCoincidenciaExacta ? '✅' : '☑️';
        const obsTexto = observaciones.length > 0 ? observaciones.join('; ') : null;

        // D) Hora de la transacción (Hora de Caracas, 00:00 a 23:59 garantizado)
        const horaStr = formatCaracasTime(parsed.hora || m.messageTimestamp);

        // D) Insertar en libro_aportes
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
            group_jid, group_name, sender_jid, sender_name, raw_message, parsed_data, status, error_message, inserted_record_uuid
          ) VALUES (
            ${remoteJid}, ${mapping.group_name}, ${senderJid}, ${senderName}, ${messageText}, 
            ${sql.json(parsed)}, ${logStatus}, ${obsTexto}, ${insertedUuid}
          )
        `;

        console.log(`${checkEmoji} [WhatsApp] ${parsed.tipo} registrado en Aportes [${logStatus}]: $${parsed.monto} - Rango: ${rangoNombre} - Operador: ${empleadoNombre} ${obsTexto ? `(${obsTexto})` : ''}`);

        // Confirmación en WhatsApp: Reaccionar con el check (Verde ✅ si todo coincide, Azul ☑️ si requiere verificación) con reintentos
        if (mapping.auto_reply && this.sock) {
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
            group_jid, group_name, sender_jid, sender_name, raw_message, status, error_message
          ) VALUES (
            ${remoteJid}, ${mapping?.group_name || 'Grupo WhatsApp'}, ${errSenderJid}, ${errSenderName}, ${messageText}, 'error_interno', ${err.message}
          )
        `;
      } catch (e) {}
    }
  }
}

export const whatsappService = new WhatsAppService();
