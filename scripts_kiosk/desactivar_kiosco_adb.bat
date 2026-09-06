@echo off
echo ============================================================
echo   WISI SPACE - DESACTIVAR BLOQUEO KIOSCO POR ADB
echo ============================================================
echo.
echo Esperando dispositivo USB...
adb wait-for-device
echo Desactivando fijacion de pantalla y restaurando barras...
adb shell am broadcast -a com.wisi.space.ACTION_KIOSK --ez enable false
echo.
echo ============================================================
echo   Listo: El modo kiosco fue liberado.
echo ============================================================
pause
