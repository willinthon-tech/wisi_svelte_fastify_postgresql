@echo off
chcp 65001 > nul
echo ============================================================
echo   WISI SPACE - DESACTIVAR BLOQUEO KIOSCO POR ADB
echo ============================================================
echo.

echo Desactivando fijación de pantalla y restaurando barras del sistema...
adb shell am broadcast -a com.wisi.space.ACTION_KIOSK --ez enable false
echo.

echo ============================================================
echo   ¡Listo! El modo kiosco fue liberado.
echo ============================================================
pause
