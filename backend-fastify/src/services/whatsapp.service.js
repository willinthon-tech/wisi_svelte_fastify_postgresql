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

// Directorio para guardar las credenciales de la sesión de WhatsApp (ruta absoluta fija)
const AUTH_DIR = path.resolve(__dirname, '../../auth_whatsapp');

// Migración de retrocompatibilidad si creds.json existía en la raíz
try {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }
  const legacyDir = path.join(process.cwd(), 'auth_whatsapp');
  if (legacyDir !== AUTH_DIR && fs.existsSync(legacyDir)) {
    const legacyCreds = path.join(legacyDir, 'creds.json');
    const targetCreds = path.join(AUTH_DIR, 'creds.json');
    if (fs.existsSync(legacyCreds) && !fs.existsSync(targetCreds)) {
      const files = fs.readdirSync(legacyDir);
      for (const f of files) {
        fs.copyFileSync(path.join(legacyDir, f), path.join(AUTH_DIR, f));
      }
      console.log('📦 [WhatsApp] Credenciales migradas a ubicación absoluta permanente:', AUTH_DIR);
    }
  }
} catch (e) {
  console.warn('Advertencia comprobando AUTH_DIR de WhatsApp:', e.message);
}

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'waiting_qr' | 'connected'
    this.qrDataUrl = null;
    this.qrRaw = null;
    this.userInfo = null;
    this.lastError = null;
    this.connectionAttempts = 0;
    this.isReconnecting = false;
  }

  hasSavedSession() {
    try {
      const credsFile = path.join(AUTH_DIR, 'creds.json');
      if (fs.existsSync(credsFile)) {
        const stat = fs.statSync(credsFile);
        return stat.size > 20;
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
      hasSavedSession: this.hasSavedSession()
    };
  }

  async init() {
    // Si ya existe una sesión guardada válida y no está conectado, auto-conectar en segundo plano
    if (this.hasSavedSession() && this.status === 'disconnected') {
      console.log('📱 [WhatsApp] Sesión previa detectada. Auto-conectando motor en segundo plano...');
      this.connect().catch(err => {
        console.warn('⚠️ [WhatsApp] Auto-conexión inicial falló:', err.message);
      });
    }
  }

  async connect() {
    if (this.sock && this.status === 'connected') {
      return this.getStatus();
    }
    if (this.sock && this.status === 'waiting_qr' && this.qrDataUrl) {
      return this.getStatus();
    }
    if (this.status === 'connecting' && this.sock) {
      return this.getStatus();
    }

    if (this.sock) {
      try {
        this.sock.end(new Error('Resetting socket'));
      } catch (e) {}
      this.sock = null;
    }

    try {
      this.status = 'connecting';
      this.lastError = null;

      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

      this.sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: ['WISI Casino System', 'Chrome', '1.0.0'],
        syncFullHistory: false
      });

      this.sock.ev.on('creds.update', saveCreds);

      // Esperar activamente hasta que Baileys emita el primer código QR o abra la conexión
      const waitForFirstQR = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(), 3500);

        const checkHandler = (update) => {
          if (update.qr || update.connection === 'open' || update.connection === 'close') {
            clearTimeout(timeout);
            setTimeout(() => resolve(), 150);
          }
        };

        this.sock.ev.on('connection.update', checkHandler);
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
            console.log('⚡ [WhatsApp] Nuevo código QR generado para vinculación.');
          } catch (qrErr) {
            console.error('Error generando imagen QR:', qrErr);
          }
        }

        if (connection === 'open') {
          this.status = 'connected';
          this.qrDataUrl = null;
          this.qrRaw = null;
          this.connectionAttempts = 0;

          const userJid = this.sock.user?.id || '';
          const phone = userJid.split(':')[0] || userJid.split('@')[0] || '';
          this.userInfo = {
            id: userJid,
            phone: phone ? `+${phone}` : 'Desconocido',
            name: this.sock.user?.name || 'Bot WISI'
          };

          console.log(`✅ [WhatsApp] Conectado exitosamente como: ${this.userInfo.name} (${this.userInfo.phone})`);
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          console.warn(`⚠️ [WhatsApp] Conexión cerrada. Razón/Código: ${statusCode}. Reconectar: ${shouldReconnect}`);

          if (statusCode === DisconnectReason.loggedOut) {
            this.status = 'disconnected';
            this.userInfo = null;
            this.qrDataUrl = null;
            this.sock = null;
            this.clearAuthFiles();
          } else if (shouldReconnect) {
            this.status = 'connecting';
            setTimeout(() => this.connect(), 3000);
          } else {
            this.status = 'disconnected';
            this.sock = null;
          }
        }
      });

      // Escuchador de mensajes entrantes
      this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const m of messages) {
          if (!m.message || m.key.fromMe) continue;
          await this.handleIncomingMessage(m);
        }
      });

      // Esperar a que el evento inicial (QR o conexión abierta) esté listo
      await waitForFirstQR;

    } catch (err) {
      console.error('❌ [WhatsApp] Error iniciando conexión:', err);
      this.status = 'disconnected';
      this.lastError = err.message;
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
      this.sock = null;
      this.status = 'disconnected';
      this.userInfo = null;
      this.qrDataUrl = null;
      this.clearAuthFiles();
    }
    return this.getStatus();
  }

  clearAuthFiles() {
    try {
      if (fs.existsSync(AUTH_DIR)) {
        const files = fs.readdirSync(AUTH_DIR);
        for (const file of files) {
          try {
            fs.unlinkSync(path.join(AUTH_DIR, file));
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
        // A) Buscar o crear el Cliente
        let clienteUuid = null;
        const existingClients = await sql`
          SELECT uuid FROM clientes 
          WHERE LOWER(TRIM(nombre)) = LOWER(${parsed.cliente.trim()})
          LIMIT 1
        `;

        if (existingClients.length > 0) {
          clienteUuid = existingClients[0].uuid;
        } else {
          // Crear cliente tipo General
          const newClient = await sql`
            INSERT INTO clientes (nombre)
            VALUES (${parsed.cliente.trim()})
            RETURNING uuid
          `;
          clienteUuid = newClient[0]?.uuid;
        }

        // B) Buscar método de pago por coincidencia inteligente (Diccionario & NLP)
        let metodoPagoUuid = null;
        const allMetodos = await sql`
          SELECT uuid, nombre FROM metodos_pago 
          WHERE COALESCE(is_deleted, false) = false
        `;

        const normMetodo = normalizeText(parsed.metodo);
        // 1. Coincidencia exacta normalizada
        let foundMetodo = allMetodos.find(m => normalizeText(m.nombre) === normMetodo);

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
          }
        }

        // 3. Fallback a método Cash / Efectivo o primer método disponible
        if (!foundMetodo && allMetodos.length > 0) {
          foundMetodo = allMetodos.find(m => normalizeText(m.nombre) === 'cash' || normalizeText(m.nombre).includes('efectivo')) || allMetodos[0];
        }

        if (foundMetodo) {
          metodoPagoUuid = foundMetodo.uuid;
        }

        // C) Evaluación de coincidencias para definir el chulito (Verde ✅ vs Azul ☑️)
        let esCoincidenciaExacta = true;
        let observaciones = [];

        // 1. Verificación de Cliente: ¿existía ya en la base de datos?
        if (existingClients.length === 0) {
          esCoincidenciaExacta = false;
          observaciones.push(parsed.cliente === 'General' ? 'Cliente no especificado (asignado General)' : `Cliente nuevo (${parsed.cliente})`);
        }

        // 2. Verificación de Método de Pago: ¿fue explícito o se asumió por descarte?
        if (!parsed.explicit?.metodo) {
          esCoincidenciaExacta = false;
          observaciones.push('Método de pago no explícito (asumido por defecto)');
        }

        const logStatus = esCoincidenciaExacta ? 'procesado' : 'procesado_por_verificar';
        const checkEmoji = esCoincidenciaExacta ? '✅' : '☑️';
        const obsTexto = observaciones.length > 0 ? observaciones.join('; ') : null;

        // D) Hora actual de Caracas
        const horaStr = new Date().toLocaleTimeString('es-VE', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'America/Caracas'
        });

        const notaStr = parsed.nota 
          ? (obsTexto ? `${parsed.nota} [Verificar: ${obsTexto}]` : `${parsed.nota} (vía WhatsApp)`)
          : (obsTexto ? `Vía WhatsApp por ${senderName} [Verificar: ${obsTexto}]` : `Vía WhatsApp por ${senderName}`);

        // E) Insertar en libro_control_clientes
        const insertRes = await sql`
          INSERT INTO libro_control_clientes (
            libro_uuid,
            multisala_uuid,
            cliente_uuid,
            caja,
            tipo,
            monto,
            metodo_pago_uuid,
            hora,
            nota
          ) VALUES (
            ${libro.uuid}::uuid,
            ${targetMultisalaUuid ? sql`${targetMultisalaUuid}::uuid` : sql`NULL`},
            ${clienteUuid ? sql`${clienteUuid}::uuid` : sql`NULL`},
            ${parsed.caja},
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

        console.log(`${checkEmoji} [WhatsApp] Operación registrada en Control de Clientes [${logStatus}]: ${parsed.tipo} $${parsed.monto} - ${parsed.cliente} (${parsed.caja}) ${obsTexto ? `(${obsTexto})` : ''}`);

        // F) Confirmación en WhatsApp: Reaccionar con el check (Verde ✅ si todo coincide, Azul ☑️ si requiere verificación)
        if (mapping.auto_reply && this.sock) {
          try {
            await this.sock.sendMessage(remoteJid, {
              react: {
                text: checkEmoji,
                key: m.key
              }
            });
          } catch (eReact) {
            console.warn('Error enviando reacción check en WhatsApp:', eReact.message);
          }
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

        // Variable para verificar si el rango fue encontrado con certeza
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

        // Fallback por defecto si no encontró ninguno
        if (!rangoUuid && allRangos.length > 0) {
          const defRango = allRangos.find(r => normalizeText(r.nombre) === 'rango 1') ||
                           allRangos.find(r => normalizeText(r.nombre) === 'general') ||
                           allRangos[0];
          if (defRango) {
            rangoUuid = defRango.uuid;
            rangoNombre = defRango.nombre;
          }
        }

        // B) Buscar o resolver Empleado / Operador con matching inteligente
        let empleadoUuid = null;
        let empleadoNombre = parsed.operador || 'Operador General';
        let foundEmp = null;

        const allEmps = await sql`
          SELECT uuid, nombre, cedula 
          FROM empleados 
          WHERE COALESCE(activo, true) = true 
            AND COALESCE(is_deleted, false) = false
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
          } else {
            // Si el operador no existe aún en el sistema, crearlo como empleado para asociarlo
            const tempCedula = `WA-${Date.now().toString().slice(-8)}`;
            const newEmp = await sql`
              INSERT INTO empleados (nombre, cedula, activo)
              VALUES (${parsed.operador.trim()}, ${tempCedula}, true)
              RETURNING uuid, nombre
            `;
            if (newEmp.length > 0) {
              empleadoUuid = newEmp[0].uuid;
              empleadoNombre = newEmp[0].nombre;
            }
          }
        } else {
          // Si no se especificó operador, asignar al primer empleado activo disponible
          if (allEmps.length > 0) {
            empleadoUuid = allEmps[0].uuid;
            empleadoNombre = allEmps[0].nombre;
          }
        }

        // C) Evaluación de coincidencias para definir el chulito (Verde ✅ vs Azul ☑️)
        let esCoincidenciaExacta = true;
        let observaciones = [];

        // 1. Verificación de Rango: ¿fue explícito y coincide con la BD?
        if (!parsed.explicit?.rango || !foundRango) {
          esCoincidenciaExacta = false;
          observaciones.push('Rango no especificado o asignado por defecto');
        }

        // 2. Verificación de Operador: ¿coincidió con un empleado activo existente?
        if (!parsed.explicit?.operador || !foundEmp) {
          esCoincidenciaExacta = false;
          observaciones.push(parsed.operador === 'General' ? 'Operador no especificado (asignado General)' : `Operador nuevo/no registrado (${parsed.operador})`);
        }

        const logStatus = esCoincidenciaExacta ? 'procesado' : 'procesado_por_verificar';
        const checkEmoji = esCoincidenciaExacta ? '✅' : '☑️';
        const obsTexto = observaciones.length > 0 ? observaciones.join('; ') : null;

        const horaStr = new Date().toLocaleTimeString('es-VE', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'America/Caracas'
        });

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

        // Confirmación en WhatsApp: Reaccionar con el check (Verde ✅ si todo coincide, Azul ☑️ si requiere verificación)
        if (mapping.auto_reply && this.sock) {
          try {
            await this.sock.sendMessage(remoteJid, {
              react: {
                text: checkEmoji,
                key: m.key
              }
            });
          } catch (eReact) {
            console.warn('Error enviando reacción check en WhatsApp:', eReact.message);
          }
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
