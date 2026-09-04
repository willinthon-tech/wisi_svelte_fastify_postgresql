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

    // 3. Registrar ante FCM (Firebase Cloud Messaging)
    await PushNotifications.register();

    // 4. Escuchar el Token FCM generado por Google Services
    await PushNotifications.removeAllListeners();

    PushNotifications.addListener('registration', async (token) => {
      console.log('✅ [Push] FCM Token Registrado:', token.value);
      try {
        localStorage.setItem('wisi_fcm_token', token.value);
      } catch (e) {}

      // Enviar el token al backend usando la URL absoluta de la nube
      try {
        const endpoint = toBackendUrl('/api/auth/fcm-token');
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId || null,
            token: token.value,
            platform: Capacitor.getPlatform(),
            fecha: new Date().toISOString()
          })
        });
        console.log('✅ [Push] Token FCM sincronizado exitosamente con el backend');
      } catch (err) {
        console.warn('⚠️ [Push] Error enviando FCM Token al servidor:', err);
      }
    });

    PushNotifications.addListener('registrationError', (err) => {
      console.error('❌ [Push] Error en registro de Push Notifications:', err);
    });

    // Notificación recibida en primer plano
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('🔔 [Push] Notificación push recibida:', notification);
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

  } catch (error) {
    console.warn('⚠️ [Push] No se pudo inicializar Push Notifications en este dispositivo:', error);
  }
}
