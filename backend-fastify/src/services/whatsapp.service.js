import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { sql, isPgConnected } from '../config/db.js';
import { parseWhatsAppMessage } from './whatsapp-parser.js';

// Directorio para guardar las credenciales de la sesión de WhatsApp
const AUTH_DIR = path.join(process.cwd(), 'auth_whatsapp');
if (!fs.existsSync(AUTH_DIR)) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
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

  getStatus() {
    return {
      status: this.status,
      qr: this.qrDataUrl,
      user: this.userInfo,
      error: this.lastError
    };
  }

  async connect() {
    if (this.sock && this.status === 'connected') {
      return this.getStatus();
    }
    if (this.sock && this.status === 'waiting_qr' && this.qrDataUrl) {
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

      // Esperar activamente hasta que Baileys emita el primer código QR (típicamente 300ms a 1.2s)
      const waitForFirstQR = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(), 4000);

        const checkHandler = (update) => {
          if (update.qr || update.connection === 'open' || update.connection === 'close') {
            clearTimeout(timeout);
            setTimeout(() => resolve(), 200);
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

      // Esperar a que el QR esté listo antes de responder la petición HTTP
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
          fs.unlinkSync(path.join(AUTH_DIR, file));
        }
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

      // 2. Ejecutar el parser inteligente
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

      // 3. Buscar el libro operativo activo para la sala vinculada
      const libros = await sql`
        SELECT uuid, id, sala_uuid, fecha
        FROM libros
        WHERE (sala_uuid = ${mapping.sala_uuid}::uuid OR id::text = ${mapping.sala_uuid}::text)
          AND (estado = 'abierto' OR estado = 'Activo' OR fecha = CURRENT_DATE)
        ORDER BY id DESC
        LIMIT 1
      `;

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

        // B) Buscar método de pago por coincidencia
        let metodoPagoUuid = null;
        const metodos = await sql`
          SELECT uuid, nombre FROM metodos_pago 
          WHERE LOWER(TRIM(nombre)) = LOWER(${parsed.metodo.trim()})
          LIMIT 1
        `;
        if (metodos.length > 0) {
          metodoPagoUuid = metodos[0].uuid;
        }

        // C) Hora actual de Caracas
        const horaStr = new Date().toLocaleTimeString('es-VE', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'America/Caracas'
        });

        // D) Insertar en libro_control_clientes
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
            ${mapping.multisala_uuid ? sql`${mapping.multisala_uuid}::uuid` : sql`NULL`},
            ${clienteUuid ? sql`${clienteUuid}::uuid` : sql`NULL`},
            ${parsed.caja},
            ${parsed.tipo},
            ${parsed.monto},
            ${metodoPagoUuid ? sql`${metodoPagoUuid}::uuid` : sql`NULL`},
            ${horaStr},
            ${parsed.nota ? sql`${parsed.nota} (vía WhatsApp)` : sql`Vía WhatsApp por ${senderName}`}
          )
          RETURNING uuid
        `;

        insertedUuid = insertRes[0]?.uuid;

        // Registrar log
        await sql`
          INSERT INTO whatsapp_logs (
            group_jid, group_name, sender_jid, sender_name, raw_message, parsed_data, status, inserted_record_uuid
          ) VALUES (
            ${remoteJid}, ${mapping.group_name}, ${senderJid}, ${senderName}, ${messageText}, 
            ${sql.json(parsed)}, 'procesado', ${insertedUuid}
          )
        `;

        console.log(`✅ [WhatsApp] Operación registrada en Control de Clientes: ${parsed.tipo} $${parsed.monto} - ${parsed.cliente} (${parsed.caja})`);

        // E) Confirmación en WhatsApp
        if (mapping.auto_reply && this.sock) {
          const confirmText = 
`✅ *Operación Registrada en WISI*
• *Tipo:* ${parsed.tipo}
• *Monto:* $${parsed.monto}
• *Método:* ${parsed.metodo}
• *Caja:* ${parsed.caja}
• *Cliente:* ${parsed.cliente}
• *Hora:* ${horaStr}`;

          await this.sock.sendMessage(remoteJid, { text: confirmText }, { quoted: m });
        }

      } else if (parsed.modulo === 'aportes_maquinas') {
        // Módulo de aportes y devoluciones en máquinas
        // A) Buscar o resolver Rango
        let rangoUuid = null;
        let rangoNombre = parsed.rango || 'General';

        if (parsed.rango) {
          const rgClean = parsed.rango.trim().toLowerCase();
          const rangos = await sql`
            SELECT uuid, nombre FROM rangos 
            WHERE LOWER(TRIM(nombre)) = ${rgClean}
               OR LOWER(TRIM(nombre)) LIKE ${`%${rgClean}%`}
            ORDER BY 
              CASE WHEN LOWER(TRIM(nombre)) = ${rgClean} THEN 0 ELSE 1 END
            LIMIT 1
          `;
          if (rangos.length > 0) {
            rangoUuid = rangos[0].uuid;
            rangoNombre = rangos[0].nombre;
          }
        }

        if (!rangoUuid) {
          const defRango = await sql`
            SELECT uuid, nombre FROM rangos 
            ORDER BY CASE WHEN LOWER(nombre) = 'rango 1' THEN 0 WHEN LOWER(nombre) = 'general' THEN 1 ELSE 2 END
            LIMIT 1
          `;
          if (defRango.length > 0) {
            rangoUuid = defRango[0].uuid;
            rangoNombre = defRango[0].nombre;
          }
        }

        // B) Buscar o resolver Empleado / Operador
        let empleadoUuid = null;
        let empleadoNombre = parsed.operador || 'Operador General';

        if (parsed.operador && parsed.operador.toLowerCase() !== 'general') {
          const opClean = parsed.operador.trim().toLowerCase();
          const emps = await sql`
            SELECT uuid, nombre FROM empleados 
            WHERE (LOWER(TRIM(nombre)) = ${opClean}
               OR LOWER(TRIM(nombre)) LIKE ${`%${opClean}%`})
              AND COALESCE(is_deleted, false) = false
            ORDER BY 
              CASE WHEN LOWER(TRIM(nombre)) = ${opClean} THEN 0 ELSE 1 END,
              LENGTH(nombre) ASC
            LIMIT 1
          `;

          if (emps.length > 0) {
            empleadoUuid = emps[0].uuid;
            empleadoNombre = emps[0].nombre;
          } else {
            // Si el operador no existe aún en el sistema, crearlo como empleado para asociarlo
            const newEmp = await sql`
              INSERT INTO empleados (nombre, activo)
              VALUES (${parsed.operador.trim()}, true)
              RETURNING uuid, nombre
            `;
            if (newEmp.length > 0) {
              empleadoUuid = newEmp[0].uuid;
              empleadoNombre = newEmp[0].nombre;
            }
          }
        } else {
          // Si no se especificó operador, asignar al primer empleado activo disponible
          const defEmp = await sql`
            SELECT uuid, nombre FROM empleados 
            WHERE COALESCE(activo, true) = true AND COALESCE(is_deleted, false) = false 
            ORDER BY id ASC LIMIT 1
          `;
          if (defEmp.length > 0) {
            empleadoUuid = defEmp[0].uuid;
            empleadoNombre = defEmp[0].nombre;
          }
        }

        const horaStr = new Date().toLocaleTimeString('es-VE', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'America/Caracas'
        });

        // C) Insertar en libro_aportes
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
            ${mapping.multisala_uuid ? sql`${mapping.multisala_uuid}::uuid` : sql`NULL`},
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
            group_jid, group_name, sender_jid, sender_name, raw_message, parsed_data, status, inserted_record_uuid
          ) VALUES (
            ${remoteJid}, ${mapping.group_name}, ${senderJid}, ${senderName}, ${messageText}, 
            ${sql.json(parsed)}, 'procesado', ${insertedUuid}
          )
        `;

        console.log(`✅ [WhatsApp] ${parsed.tipo} registrado en Aportes: $${parsed.monto} - Rango: ${rangoNombre} - Operador: ${empleadoNombre}`);

        if (mapping.auto_reply && this.sock) {
          const confirmText = 
`✅ *${parsed.tipo} Registrado en WISI*
• *Monto:* $${parsed.monto}
• *Rango:* ${rangoNombre}
• *Operador:* ${empleadoNombre}
• *Hora:* ${horaStr}`;

          await this.sock.sendMessage(remoteJid, { text: confirmText }, { quoted: m });
        }
      }

    } catch (err) {
      console.error('❌ Error procesando mensaje de WhatsApp:', err);
      try {
        await sql`
          INSERT INTO whatsapp_logs (
            group_jid, group_name, raw_message, status, error_message
          ) VALUES (
            ${remoteJid}, 'Error', ${messageText}, 'error_interno', ${err.message}
          )
        `;
      } catch (e) {}
    }
  }
}

export const whatsappService = new WhatsAppService();

