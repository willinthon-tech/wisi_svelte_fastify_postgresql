@echo off
chcp 65001 > nul
echo ============================================================
echo   WISI SPACE - ACTIVAR MODO KIOSCO 100%% POR ADB
echo ============================================================
echo.

echo [1/3] Verificando dispositivo conectado por USB...
adb devices
echo.

echo [2/3] Asignando Wisi Space como Propietario del Dispositivo (Device Owner)...
adb shell dpm set-device-owner com.wisi.space/.KioskDeviceAdminReceiver
echo.

echo [3/3] Activando bloqueo de pantalla inmersiva y modo Kiosco...
adb shell am broadcast -a com.wisi.space.ACTION_KIOSK --ez enable true
echo.

echo ============================================================
echo   ¡LISTO! La tableta o teléfono ha quedado 100%% bloqueado
echo   en Modo Kiosco dedicado para Wisi Space.
echo ============================================================
pause
