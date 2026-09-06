@echo off
echo ============================================================
echo   WISI SPACE - ACTIVAR MODO KIOSCO 100% POR ADB
echo ============================================================
echo.
echo [1/3] Conectando con el dispositivo (enciende y desbloquea la pantalla)...
adb wait-for-device
echo Dispositivo USB detectado con exito.
echo.
echo [2/3] Asignando Wisi Space como Device Owner...
adb shell dpm set-device-owner com.wisi.space/.KioskDeviceAdminReceiver
echo.
echo [3/3] Activando modo Kiosco...
adb shell am broadcast -a com.wisi.space.ACTION_KIOSK --ez enable true
echo.
echo ============================================================
echo   LISTO: Dispositivo en Modo Kiosco Wisi Space
echo ============================================================
pause
