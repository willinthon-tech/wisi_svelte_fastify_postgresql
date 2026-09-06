# 📱 Instrucciones para Modo Kiosco 100% por ADB (Wisi Space)

Este método utiliza las políticas corporativas nativas de Google Android (**Device Owner**). 
Al configurarse de esta manera, **el sistema operativo Android desactiva completamente los gestos de deslizar, la barra superior de notificaciones, los botones de navegación y el botón de inicio**. Nadie puede salir de la aplicación a menos que uses el script de desactivación.

---

## ⚠️ Requisito Único de Seguridad de Google:
Para que Android permita nombrar a Wisi Space como "Device Owner", el teléfono o tableta **NO debe tener ninguna cuenta de Google activa en ese momento**:
1. En tu teléfono/tablet ve a: **Ajustes ⚙️ ➡️ Cuentas (o Google) ➡️ Selecciona tu cuenta ➡️ Quitar cuenta temporalmente**.
*(Una vez que ejecutes el script de activación, puedes volver a iniciar sesión en Google si lo deseas).*
2. Asegúrate de tener activada la **Depuración USB** en *Ajustes ➡️ Opciones de desarrollador*.

---

## 🚀 ¿Cómo Activar el Modo Kiosco 100%?
1. Conecta el teléfono o tablet a tu PC con el cable USB.
2. Abre la carpeta `scripts_kiosk` en tu PC.
3. Haz doble clic en el archivo:
   👉 **`activar_kiosco_adb.bat`**
4. ¡Listo! La pantalla quedará 100% bloqueada en Wisi Space. Si alguien intenta deslizar de arriba o de abajo, Android lo bloqueará de forma nativa.

---

## 🔓 ¿Cómo Desbloquear o Salir del Modo Kiosco?
Tienes dos opciones:

### Opción 1: Desactivar temporalmente el bloqueo (Para mantenimiento)
- Haz doble clic en:
  👉 **`desactivar_kiosco_adb.bat`**
- Esto libera la pantalla y devuelve las barras de navegación sin desinstalar ni quitar los permisos.

### Opción 2: Remover Device Owner por completo (Devolver a teléfono normal)
- Haz doble clic en:
  👉 **`remover_device_owner_adb.bat`**
- Esto le quita el superpoder de administrador a la app y la deja como una app común y corriente.
