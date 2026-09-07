import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { toBackendUrl } from '../config/api.config.js';
import { openPhotoModalForAttlog } from '../controllers/globalModal.store.js';

/**
 * Inicializa y registra el dispositivo para Notificaciones Push (Firebase Cloud Messaging)
 * Solo se activa si la app corre de forma nativa en Android/iOS con Capacitor.
 */
export async function initPushNotifications(userId, onNotificationReceived) {
  if (typeof window === 'undefined' || !Capacitor.isNativePlatform()) {
    return;
  }

  try {
    // 1. Crear canal de notificaciones de alta prioridad para Android 8.0+
    try {
      await PushNotifications.createChannel({
        id: 'wisi_attendance_channel',
        name: 'Marcajes y Asistencia',
        description: 'Notificaciones de marcaje de personal y puertas en tiempo real',
        importance: 5, // IMPORTANCE_HIGH / MAX
        visibility: 1, // VISIBILITY_PUBLIC
        vibration: true,
        lights: true,
        lightColor: '#2563eb'
      });
    } catch (chanErr) {
      console.warn('[Push] Error creando canal de notificaciones Android:', chanErr);
    }

    // 2. Verificar y solicitar permisos de notificación (requerido en Android 13+)
    let permStatus = await PushNotifications.checkPermissions();

    if (permStatus.receive === 'prompt' || permStatus.receive === 'prompt-with-rationale') {
      permStatus = await PushNotifications.requestPermissions();
    }

    if (permStatus.receive !== 'granted') {
      console.warn('[Push] Permiso de notificaciones push no otorgado por el usuario.');
      return;
    }

    async function syncTokenWithBackend(tokenVal, uId) {
      if (!tokenVal) return;
      try {
        localStorage.setItem('wisi_fcm_token', tokenVal);
      } catch (e) {}

      try {
        const endpoint = toBackendUrl('/api/auth/fcm-token');
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: uId || null,
            token: tokenVal,
            platform: Capacitor.getPlatform(),
            fecha: new Date().toISOString()
          })
        });
        console.log('✅ [Push] Token FCM sincronizado exitosamente con user_id:', uId);
      } catch (err) {
        console.warn('⚠️ [Push] Error enviando FCM Token al servidor:', err);
      }
    }

    // Si ya existe un token almacenado en este teléfono, sincronizarlo de inmediato
    try {
      const cachedToken = localStorage.getItem('wisi_fcm_token');
      if (cachedToken) {
        syncTokenWithBackend(cachedToken, userId);
      }
    } catch (e) {}

    // 3. Limpiar y registrar listeners ANTES de llamar a register() para evitar perder el evento
    await PushNotifications.removeAllListeners();

    PushNotifications.addListener('registration', async (token) => {
      console.log('✅ [Push] FCM Token Registrado:', token?.value);
      if (token?.value) {
        await syncTokenWithBackend(token.value, userId);
      }
    });

    PushNotifications.addListener('registrationError', (err) => {
      console.error('❌ [Push] Error en registro de Push Notifications:', err);
    });

    // Notificación recibida en primer plano
    PushNotifications.addListener('pushNotificationReceived', async (notification) => {
      console.log('🔔 [Push] Notificación push recibida en primer plano:', notification);
      try {
        const data = notification?.data || {};
        if (data.attlog_id || data.id || data.nombre) {
          const status = String(data.tipo || data.attendancestatus || '').toLowerCase().trim();
          const rec = {
            id: data.attlog_id || data.id,
            employee_no: data.employee_no || '',
            nombre: data.nombre || notification.title || '',
            cargo_nombre: data.cargo || '',
            sala_nombre: data.sala || '',
            sala_id: data.sala_id ? Number(data.sala_id) : null,
            attendancestatus: status,
            status: status,
            foto: data.image_url || null
          };
          const { latestAttlogEventStore, latestCheckInStore, latestCheckOutStore, latestMarcajeAlertStore } = await import('../controllers/websocket.store.js');
          latestAttlogEventStore.set(rec);
          if (status === 'entrada' || status === 'checkin') {
            latestCheckInStore.set(rec);
          } else if (status === 'salida' || status === 'checkout') {
            latestCheckOutStore.set(rec);
          } else {
            latestMarcajeAlertStore.set(rec);
          }
        }
      } catch (e) {
        console.warn('Error procesando push en primer plano:', e);
      }

      if (typeof onNotificationReceived === 'function') {
        onNotificationReceived(notification);
      }
    });

    // Notificación tocada / abierta por el usuario en Android
    PushNotifications.addListener('pushNotificationActionPerformed', (notificationAction) => {
      console.log('👆 [Push] Acción sobre notificación:', notificationAction);
      const data = notificationAction.notification?.data || {};
      const attlogId = data.attlog_id || data.id;
      if (attlogId) {
        openPhotoModalForAttlog(attlogId);
      }
    });

    // 4. Registrar ante FCM (Firebase Cloud Messaging) tras tener los listeners listos
    await PushNotifications.register();

  } catch (error) {
    console.warn('⚠️ [Push] No se pudo inicializar Push Notifications en este dispositivo:', error);
  }
}

/**
 * Desregistra el dispositivo del backend al cerrar sesión
 */
export async function unregisterPushNotifications() {
  if (typeof window === 'undefined') return;
  try {
    const token = localStorage.getItem('wisi_fcm_token');
    if (token) {
      const endpoint = toBackendUrl('/api/auth/fcm-token/unregister');
      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      }).catch(() => {});
    }
  } catch (e) {}
}
