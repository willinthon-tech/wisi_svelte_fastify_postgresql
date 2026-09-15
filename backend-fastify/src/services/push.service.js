import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sql, isPgConnected } from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isUuid = (val) => typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim());

let isFirebaseInitialized = false;
const inMemoryTokens = new Set();

/**
 * Inicializa Firebase Admin SDK buscando credenciales en:
 * 1. Variable de entorno FIREBASE_SERVICE_ACCOUNT (JSON en texto)
 * 2. Archivo service-account.json en la raíz de backend-fastify
 * 3. Archivo firebase-service-account.json
 * 4. GOOGLE_APPLICATION_CREDENTIALS
 */
function initFirebase() {
  if (isFirebaseInitialized || getApps().length > 0) {
    isFirebaseInitialized = true;
    return;
  }

  try {
    let serviceAccount = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      } catch (e) {
        console.warn('[Push FCM] Error parseando FIREBASE_SERVICE_ACCOUNT de .env:', e.message);
      }
    }

    if (!serviceAccount) {
      const candidates = [
        path.join(process.cwd(), 'service-account.json'),
        path.join(process.cwd(), 'firebase-service-account.json'),
        path.join(__dirname, '../../service-account.json'),
        path.join(__dirname, '../../firebase-service-account.json')
      ];

      for (const filePath of candidates) {
        if (fs.existsSync(filePath)) {
          try {
            const raw = fs.readFileSync(filePath, 'utf8');
            serviceAccount = JSON.parse(raw);
            break;
          } catch (err) {
            console.warn(`[Push FCM] Error leyendo archivo ${filePath}:`, err.message);
          }
        }
      }
    }

    if (serviceAccount) {
      initializeApp({
        credential: cert(serviceAccount)
      });
      isFirebaseInitialized = true;
      console.log(`[PUSH FCM] Firebase Admin SDK inicializado exitosamente (Proyecto: ${serviceAccount.project_id || 'wisi-space'})`);
    } else {
      console.log('[PUSH FCM] Firebase Admin no configurado aún. Para activar notificaciones push en segundo plano en Android, coloca el archivo service-account.json en backend-fastify/');
    }
  } catch (error) {
    console.warn('[Push FCM] No se pudo inicializar Firebase Admin SDK:', error.message);
  }
}

// Inicializar al cargar el módulo
initFirebase();

let tableInitialized = false;

/**
 * Asegura la existencia de la tabla fcm_tokens e índices requeridos
 */
export async function ensureFcmTokensTable() {
  if (tableInitialized || !isPgConnected || !sql) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS fcm_tokens (
        uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_uuid UUID REFERENCES usuarios(uuid) ON DELETE CASCADE,
        token TEXT UNIQUE NOT NULL,
        platform VARCHAR(50) DEFAULT 'android',
        activo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user_uuid ON fcm_tokens(user_uuid);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_fcm_tokens_activo ON fcm_tokens(activo);`;
    tableInitialized = true;
  } catch (err) {
    console.warn('[Push FCM] Error asegurando tabla fcm_tokens:', err.message);
  }
}

/**
 * Registra o actualiza el token FCM de un dispositivo móvil (Android / iOS)
 * Si el usuario no está autenticado (user_uuid nulo), el token se desactiva para evitar recibir alertas.
 */
export async function registerDeviceToken({ user_id = null, user_uuid = null, token, platform = 'android' }) {
  if (!token || typeof token !== 'string') return;
  const cleanToken = token.trim();
  if (!cleanToken) return;

  await ensureFcmTokensTable();

  const targetUserUuid = (user_uuid && isUuid(user_uuid)) ? user_uuid : (user_id && isUuid(user_id) ? user_id : null);

  // Si no hay usuario autenticado (deslogueado), desactivar cualquier registro de este token
  if (!targetUserUuid) {
    inMemoryTokens.delete(cleanToken);
    if (isPgConnected && sql) {
      try {
        await sql`
          UPDATE fcm_tokens 
          SET activo = FALSE, user_uuid = NULL, updated_at = NOW() 
          WHERE token = ${cleanToken};
        `;
      } catch (err) {
        console.warn('[Push FCM] Error desactivando token no autenticado:', err.message);
      }
    }
    return;
  }

  inMemoryTokens.add(cleanToken);

  if (isPgConnected && sql) {
    try {
      await sql`
        INSERT INTO fcm_tokens (uuid, user_uuid, token, platform, activo, updated_at)
        VALUES (gen_random_uuid(), ${targetUserUuid}::uuid, ${cleanToken}, ${platform}, TRUE, NOW())
        ON CONFLICT (token) 
        DO UPDATE SET 
          user_uuid = EXCLUDED.user_uuid,
          platform = EXCLUDED.platform,
          activo = TRUE,
          updated_at = NOW();
      `;
    } catch (err) {
      console.warn('[Push FCM] Error guardando token en PostgreSQL:', err.message);
    }
  }
}

/**
 * Desactiva el token FCM de un dispositivo al cerrar sesión
 */
export async function unregisterDeviceToken({ token }) {
  if (!token || typeof token !== 'string') return;
  const cleanToken = token.trim();
  inMemoryTokens.delete(cleanToken);

  await ensureFcmTokensTable();

  if (isPgConnected && sql) {
    try {
      await sql`
        UPDATE fcm_tokens 
        SET activo = FALSE, user_uuid = NULL, updated_at = NOW() 
        WHERE token = ${cleanToken};
      `;
    } catch (err) {
      console.warn('[Push FCM] Error desactivando token en PostgreSQL:', err.message);
    }
  }
}

/**
 * Envía una notificación push FCM filtrada estrictamente por la sala del marcaje.
 * REGLAS OBLIGATORIAS:
 * 1. El usuario DEBE estar autenticado (user_uuid no nulo y activo = TRUE).
 * 2. El usuario DEBE tener asignada esa sala específica en `user_salas`.
 * 3. Si el usuario no tiene salas asignadas o está deslogueado, NO recibe ninguna notificación.
 */
export async function sendPushNotificationForAttlog({ salaId = null, sala_uuid = null, title, body, data = {}, imageUrl = null, icon = null }) {
  let tokens = [];
  const targetSalaUuid = (sala_uuid && isUuid(sala_uuid)) ? sala_uuid : (salaId && isUuid(salaId) ? salaId : null);

  // Si el evento no tiene sala_uuid, no se puede asociar a salas de usuarios -> no enviar
  if (!targetSalaUuid) {
    return { success: true, message: 'Marcaje sin sala_uuid especificada, omitiendo alerta push.' };
  }

  await ensureFcmTokensTable();

  if (isPgConnected && sql) {
    try {
      // Consulta estricta: INNER JOIN con user_salas para garantizar que el usuario
      // autenticado tenga asignada ESTA sala_uuid. Si no tiene salas o está deslogueado, retorna 0 filas.
      const rows = await sql`
        SELECT DISTINCT ft.token 
        FROM fcm_tokens ft
        INNER JOIN user_salas us ON us.user_uuid = ft.user_uuid
        WHERE ft.activo = TRUE 
          AND ft.user_uuid IS NOT NULL
          AND us.sala_uuid = ${targetSalaUuid}::uuid
      `;
      tokens = rows.map(r => r.token).filter(Boolean);
    } catch (err) {
      console.warn('[Push FCM] Error consultando tokens por sala:', err.message);
      tokens = [];
    }
  } else {
    tokens = [];
  }

  if (tokens.length === 0) {
    return { success: true, message: 'No hay usuarios asignados a esta sala con dispositivos activos.' };
  }

  return executeMulticastSend({ tokens, title, body, data, imageUrl, icon });
}

/**
 * Retorna información de diagnóstico sobre Firebase y tokens registrados
 */
export async function getPushDiagnostics() {
  let tokenCount = 0;
  let tokens = [];
  if (isPgConnected && sql) {
    try {
      const rows = await sql`
        SELECT uuid, uuid AS id, user_uuid, user_uuid AS user_id, platform, activo, updated_at, 
               SUBSTRING(token, 1, 15) || '...' as token_preview 
        FROM fcm_tokens 
        ORDER BY updated_at DESC 
        LIMIT 20
      `;
      tokens = rows;
      tokenCount = rows.length;
    } catch (e) {
      tokenCount = inMemoryTokens.size;
    }
  } else {
    tokenCount = inMemoryTokens.size;
  }
  return {
    firebaseInitialized: isFirebaseInitialized,
    activeTokensCount: tokenCount,
    tokensSample: tokens
  };
}

/**
 * Envía una notificación push a todos los dispositivos móviles registrados vía Firebase Cloud Messaging (FCM).
 */
export async function sendPushNotificationToAll({ title, body, data = {}, imageUrl = null, icon = null }) {
  let tokens = [];

  if (isPgConnected && sql) {
    try {
      const rows = await sql`
        SELECT token FROM fcm_tokens WHERE activo = TRUE
      `;
      tokens = rows.map(r => r.token);
    } catch (err) {
      tokens = Array.from(inMemoryTokens);
    }
  } else {
    tokens = Array.from(inMemoryTokens);
  }

  return executeMulticastSend({ tokens, title, body, data, imageUrl, icon });
}

async function executeMulticastSend({ tokens = [], title, body, data = {}, imageUrl = null, icon = null }) {

  // Filtrar tokens válidos y únicos
  tokens = Array.from(new Set(tokens.filter(Boolean)));

  if (tokens.length === 0) {
    console.log('[PUSH FCM] No hay tokens FCM registrados o activos para enviar.');
    return { success: false, reason: 'No_tokens_registered' };
  }

  // Si Firebase Admin no está inicializado, intentar inicializarlo por si el archivo fue colocado
  if (!isFirebaseInitialized) {
    initFirebase();
  }

  if (!isFirebaseInitialized) {
    console.warn('[PUSH FCM] Firebase Admin no está inicializado (falta service-account.json en el servidor).');
    return { success: false, reason: 'Firebase_not_initialized' };
  }

  // Asegurar que todos los valores de `data` sean strings (requerimiento estricto de FCM)
  const stringData = {};
  for (const [k, v] of Object.entries(data)) {
    stringData[k] = String(v ?? '');
  }

  const message = {
    notification: {
      title: title || 'WISI Space',
      body: body || 'Nuevo marcaje registrado',
      ...(imageUrl ? { imageUrl } : {})
    },
    data: stringData,
    android: {
      priority: 'high',
      notification: {
        channelId: 'wisi_attendance_channel',
        sound: 'default',
        priority: 'max',
        visibility: 'public',
        defaultSound: true,
        defaultVibrateTimings: true,
        ...(imageUrl ? { imageUrl } : {})
      }
    },
    tokens
  };

  try {
    const messaging = getMessaging();
    const response = await messaging.sendEachForMulticast(message);
    console.log(`[PUSH FCM] Notificación enviada a ${tokens.length} dispositivo(s). Éxitos: ${response.successCount} | Fallos: ${response.failureCount}`);

    // Limpiar tokens inválidos o desinstalados
    if (response.failureCount > 0 && isPgConnected && sql) {
      response.responses.forEach(async (resp, idx) => {
        if (!resp.success) {
          const errCode = resp.error?.code;
          if (
            errCode === 'messaging/registration-token-not-registered' ||
            errCode === 'messaging/invalid-registration-token' ||
            errCode === 'messaging/invalid-argument'
          ) {
            const badToken = tokens[idx];
            inMemoryTokens.delete(badToken);
            try {
              await sql`UPDATE fcm_tokens SET activo = FALSE WHERE token = ${badToken}`;
            } catch (e) {}
          }
        }
      });
    }

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount
    };
  } catch (err) {
    console.warn('[Push FCM] Error enviando notificaciones multicast:', err.message);
    return { success: false, error: err.message };
  }
}
