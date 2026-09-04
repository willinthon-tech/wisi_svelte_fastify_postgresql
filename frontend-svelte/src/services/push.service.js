import { PushNotifications } from '@capacitor/push-notifications';

/**
 * Inicializa y registra el dispositivo para Notificaciones Push (Firebase Cloud Messaging)
 * Solo se activa si la app corre de forma nativa en Android con Capacitor.
 */
export async function initPushNotifications(userId, onNotificationReceived) {
  if (typeof window === 'undefined' || !window.Capacitor) {
    return;
  }

  try {
    let permStatus = await PushNotifications.checkPermissions();

    if (permStatus.receive === 'prompt') {
      permStatus = await PushNotifications.requestPermissions();
    }

    if (permStatus.receive !== 'granted') {
      console.warn('Permiso de notificaciones push no otorgado.');
      return;
    }

    // Registrar ante FCM
    await PushNotifications.register();

    // Escuchar el Token FCM generado por Google
    PushNotifications.addListener('registration', async (token) => {
      console.log('FCM Token Registrado:', token.value);
      localStorage.setItem('wisi_fcm_token', token.value);

      // Enviar el token al backend si hay usuario logueado
      try {
        await fetch('/api/auth/fcm-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId || null,
            token: token.value,
            platform: 'android',
            fecha: new Date().toISOString()
          })
        });
      } catch (err) {
        console.warn('Error enviando FCM Token al servidor:', err);
      }
    });

    PushNotifications.addListener('registrationError', (err) => {
      console.error('Error en registro de Push Notifications:', err);
    });

    // Notificación recibida
    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('Notificación push recibida:', notification);
      if (typeof onNotificationReceived === 'function') {
        onNotificationReceived(notification);
      }
    });

    // Notificación tocada / abierta por el usuario
    PushNotifications.addListener('pushNotificationActionPerformed', (notificationAction) => {
      console.log('Acción sobre notificación:', notificationAction);
    });

  } catch (error) {
    console.warn('No se pudo inicializar Push Notifications en este dispositivo:', error);
  }
}
