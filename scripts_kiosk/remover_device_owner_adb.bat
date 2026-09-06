@echo off
chcp 65001 > nul
echo ============================================================
echo   WISI SPACE - REMOVER ADMINISTRADOR / DEVICE OWNER
echo ============================================================
echo.

echo [1/2] Desactivando fijación de pantalla...
adb shell am broadcast -a com.wisi.space.ACTION_KIOSK --ez enable false
echo.

echo [2/2] Removiendo permisos corporativos (Device Owner)...
adb shell dpm remove-active-admin com.wisi.space/.KioskDeviceAdminReceiver
echo.

echo ============================================================
echo   ¡Listo! El dispositivo vuelve a ser un teléfono/tablet normal.
echo ============================================================
pause
