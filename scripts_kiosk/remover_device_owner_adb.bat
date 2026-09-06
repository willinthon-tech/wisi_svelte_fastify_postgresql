@echo off
echo ============================================================
echo   WISI SPACE - REMOVER ADMINISTRADOR / DEVICE OWNER
echo ============================================================
echo.
echo Esperando dispositivo USB...
adb wait-for-device
echo.
echo [1/2] Desactivando fijacion de pantalla...
adb shell am broadcast -a com.wisi.space.ACTION_KIOSK --ez enable false
echo.
echo [2/2] Removiendo permisos corporativos (Device Owner)...
adb shell dpm remove-active-admin com.wisi.space/.KioskDeviceAdminReceiver
echo.
echo ============================================================
echo   Listo: El dispositivo vuelve a ser normal.
echo ============================================================
pause
