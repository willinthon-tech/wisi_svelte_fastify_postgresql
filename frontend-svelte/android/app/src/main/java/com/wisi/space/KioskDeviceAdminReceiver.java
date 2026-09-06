package com.wisi.space;

import android.app.admin.DeviceAdminReceiver;
import android.content.Context;
import android.content.Intent;
import android.widget.Toast;

/**
 * Receptor de Políticas de Dispositivo para Modo Kiosco 100% Empresarial / Dedicado.
 * Permite que una tableta o smartphone se configure como kiosco inquebrantable mediante:
 * adb shell dpm set-device-owner com.wisi.space/.KioskDeviceAdminReceiver
 */
public class KioskDeviceAdminReceiver extends DeviceAdminReceiver {
    @Override
    public void onEnabled(Context context, Intent intent) {
        super.onEnabled(context, intent);
        Toast.makeText(context, "Modo Administrador de Kiosco Wisi habilitado", Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onDisabled(Context context, Intent intent) {
        super.onDisabled(context, intent);
        Toast.makeText(context, "Modo Administrador de Kiosco Wisi deshabilitado", Toast.LENGTH_SHORT).show();
    }
}
