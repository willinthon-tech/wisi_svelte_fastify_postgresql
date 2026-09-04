import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sql, isPgConnected } from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  if (isFirebaseInitialized) return;

  try {
    let serviceAccount = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      } catch (e) {
        console.warn('⚠️ [Push FCM] Error parseando FIREBASE_SERVICE_ACCOUNT de .env:', e.message);
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
            console.warn(`⚠️ [Push FCM] Error leyendo archivo ${filePath}:`, err.message);
          }
        }
      }
    }

    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      isFirebaseInitialized = true;
      console.log(`\x1b[32m🟢 [PUSH FCM]\x1b[0m Firebase Admin SDK inicializado exitosamente (Proyecto: ${serviceAccount.project_id || 'wisi-space'})`);
    } else {
      console.log('\x1b[33m🟡 [PUSH FCM]\x1b[0m Firebase Admin no configurado aún. Para activar notificaciones push en segundo plano en Android, coloca el archivo service-account.json en backend-fastify/');
    }
  } catch (error) {
    console.warn('⚠️ [Push FCM] No se pudo inicializar Firebase Admin SDK:', error.message);
  }
}

// Inicializar al cargar el módulo
initFirebase();

/**
 * Registra o actualiza el token FCM de un dispositivo móvil (Android / iOS)
 */
export async function registerDeviceToken({ user_id = null, token, platform = 'android' }) {
  if (!token || typeof token !== 'string') return;
  const cleanToken = token.trim();
  if (!cleanToken) return;

  inMemoryTokens.add(cleanToken);

  if (isPgConnected && sql) {
    try {
      await sql`
        INSERT INTO fcm_tokens (user_id, token, platform, activo, updated_at)
        VALUES (${user_id}, ${cleanToken}, ${platform}, TRUE, NOW())
        ON CONFLICT (token) 
        DO UPDATE SET 
          user_id = COALESCE(EXCLUDED.user_id, fcm_tokens.user_id),
          platform = EXCLUDED.platform,
          activo = TRUE,
          updated_at = NOW();
      `;
    } catch (err) {
      console.warn('⚠️ [Push FCM] Error guardando token en PostgreSQL:', err.message);
    }
  }
}

/**
 * Envía una notificación push a todos los dispositivos móviles registrados vía Firebase Cloud Messaging (FCM).
 * Se despierta el teléfono y muestra el banner en la barra de notificaciones de Android, exactamente igual a WhatsApp.
 */
export async function sendPushNotificationToAll({ title, body, data = {}, icon = null }) {
  // 1. Obtener lista de tokens activos
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

  // Filtrar tokens válidos y únicos
  tokens = Array.from(new Set(tokens.filter(Boolean)));

  if (tokens.length === 0) {
    return { success: false, reason: 'No_tokens_registered' };
  }

  // Si Firebase Admin no está inicializado, intentar inicializarlo por si el archivo fue colocado
  if (!isFirebaseInitialized) {
    initFirebase();
  }

  if (!isFirebaseInitialized) {
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
      body: body || 'Nuevo marcaje registrado'
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
        defaultVibrateTimings: true
      }
    },
    tokens
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);

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
    console.warn('⚠️ [Push FCM] Error enviando notificaciones multicast:', err.message);
    return { success: false, error: err.message };
  }
}
