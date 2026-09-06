package com.wisi.space;

import android.app.ActivityManager;
import android.app.DownloadManager;
import android.app.admin.DevicePolicyManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String DEFAULT_HOST = "https://willinthon.wisi.space";
    private boolean isKiosk = false;
    private BroadcastReceiver downloadReceiver;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // 1. Mantener la pantalla encendida permanentemente mientras Wisi Space esté abierta
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // 2. Registrar receptor de descargas completadas para auto-instalación de APKs
        registerDownloadReceiver();

        // 3. Solicitar permisos iniciales en versiones modernas (Notificaciones en Android 13+)
        requestInitialPermissions();

        // 4. Configurar WebView con DownloadListener y KioskBridge
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
                downloadWithManager(url, contentDisposition, mimetype);
            });

            webView.addJavascriptInterface(new KioskBridge(), "AndroidKiosk");
        }

        // 5. En tablets y dispositivos antiguos, auto-ocultar barras de navegación si se deslizan
        View decorView = getWindow().getDecorView();
        decorView.setOnSystemUiVisibilityChangeListener(visibility -> {
            if (isKiosk && ((visibility & View.SYSTEM_UI_FLAG_FULLSCREEN) == 0 || (visibility & View.SYSTEM_UI_FLAG_HIDE_NAVIGATION) == 0)) {
                decorView.postDelayed(() -> {
                    if (isKiosk) setImmersiveMode(true);
                }, 300);
            }
        });
    }

    private void requestInitialPermissions() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 101);
                }
            }
        } catch (Exception ignored) {}
    }

    private void registerDownloadReceiver() {
        try {
            downloadReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    long downloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                    if (downloadId != -1) {
                        checkCompletedDownload(downloadId);
                    }
                }
            };
            IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(downloadReceiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                registerReceiver(downloadReceiver, filter);
            }
        } catch (Exception e) {
            // Ignorar si el sistema restringe el registro
        }
    }

    private void checkCompletedDownload(long downloadId) {
        try {
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (dm == null) return;

            DownloadManager.Query query = new DownloadManager.Query();
            query.setFilterById(downloadId);
            Cursor cursor = dm.query(query);
            if (cursor != null && cursor.moveToFirst()) {
                int statusIdx = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
                int uriIdx = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_URI);
                int titleIdx = cursor.getColumnIndex(DownloadManager.COLUMN_TITLE);

                if (statusIdx != -1 && cursor.getInt(statusIdx) == DownloadManager.STATUS_SUCCESSFUL) {
                    String localUri = uriIdx != -1 ? cursor.getString(uriIdx) : null;
                    String title = titleIdx != -1 ? cursor.getString(titleIdx) : "Archivo";

                    Toast.makeText(this, "✅ Descarga completada: " + title, Toast.LENGTH_SHORT).show();

                    if (localUri != null && localUri.endsWith(".apk")) {
                        promptInstallApk(Uri.parse(localUri));
                    }
                }
                cursor.close();
            }
        } catch (Exception e) {
            // Ignorar fallos de consulta
        }
    }

    private void promptInstallApk(Uri localUri) {
        try {
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Uri contentUri;
            if ("content".equals(localUri.getScheme())) {
                contentUri = localUri;
            } else {
                String path = localUri.getPath();
                if (path != null) {
                    java.io.File file = new java.io.File(path);
                    contentUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", file);
                } else {
                    contentUri = localUri;
                }
            }

            installIntent.setDataAndType(contentUri, "application/vnd.android.package-archive");
            startActivity(installIntent);
        } catch (Exception e) {
            Toast.makeText(this, "El instalador está listo en la carpeta Descargas.", Toast.LENGTH_LONG).show();
        }
    }

    public void downloadWithManager(String url, String contentDisposition, String mimetype) {
        if (url == null || url.trim().isEmpty()) return;

        // 1. Normalizar URL si es relativa
        String normalizedUrl = url.trim();
        if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
            if (normalizedUrl.startsWith("/")) {
                normalizedUrl = DEFAULT_HOST + normalizedUrl;
            } else {
                normalizedUrl = DEFAULT_HOST + "/" + normalizedUrl;
            }
        }

        // 2. Verificar permisos de almacenamiento en Android <= 9 (API <= 28)
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P) {
            if (checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{
                    android.Manifest.permission.WRITE_EXTERNAL_STORAGE,
                    android.Manifest.permission.READ_EXTERNAL_STORAGE
                }, 102);
                Toast.makeText(this, "Por favor concede permiso de almacenamiento y vuelve a presionar Descargar", Toast.LENGTH_LONG).show();
                return;
            }
        }

        // 3. Ejecutar descarga con DownloadManager
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(normalizedUrl));
            if (mimetype != null && !mimetype.isEmpty()) {
                request.setMimeType(mimetype);
            }

            String filename = URLUtil.guessFileName(normalizedUrl, contentDisposition, mimetype);
            if (filename == null || filename.isEmpty() || filename.endsWith(".bin")) {
                if (normalizedUrl.contains(".apk")) filename = "app-wisi.apk";
                else if (normalizedUrl.contains(".exe")) filename = "app-wisi.exe";
                else filename = "descarga_wisi";
            }

            request.setTitle(filename);
            request.setDescription("Descargando " + filename + " desde WISI Space");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(true);

            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (dm != null) {
                dm.enqueue(request);
                Toast.makeText(this, "⬇️ Descargando " + filename + " en Descargas...", Toast.LENGTH_SHORT).show();
            } else {
                throw new Exception("DownloadManager no disponible");
            }
        } catch (Exception e) {
            // Fallback: abrir en navegador del sistema (Chrome, Samsung Internet, etc.)
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(normalizedUrl));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
                Toast.makeText(this, "Abriendo descarga en el navegador...", Toast.LENGTH_SHORT).show();
            } catch (Exception ex) {
                Toast.makeText(this, "Error al descargar: " + ex.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
    }

    public void setImmersiveMode(boolean enable) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                if (enable) {
                    controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                    controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                } else {
                    controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                }
            }
        } else {
            View decorView = getWindow().getDecorView();
            if (enable) {
                decorView.setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                );
            } else {
                decorView.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
            }
        }
    }

    public void enableKioskMode(boolean enable) {
        isKiosk = enable;
        setImmersiveMode(enable);

        // Si la app está provisionada como Device Owner (Empresarial por comando ADB)
        try {
            DevicePolicyManager dpm = (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
            ComponentName adminComponent = new ComponentName(this, KioskDeviceAdminReceiver.class);
            if (dpm != null && dpm.isDeviceOwnerApp(getPackageName())) {
                if (enable) {
                    dpm.setLockTaskPackages(adminComponent, new String[]{getPackageName()});
                    startLockTask();
                } else {
                    stopLockTask();
                }
            }
        } catch (Exception ignored) {}

        if (enable) {
            Toast.makeText(this, "🔒 Modo Kiosco activado", Toast.LENGTH_SHORT).show();
        } else {
            Toast.makeText(this, "🔓 Modo Kiosco desactivado", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public void onBackPressed() {
        if (isKiosk) {
            // Bloquea el botón Atrás / triangulito de navegación en tablets y teléfonos
            return;
        }
        super.onBackPressed();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (isKiosk) {
            int keyCode = event.getKeyCode();
            if (keyCode == KeyEvent.KEYCODE_BACK) {
                return true; // Intercepta y anula el botón Atrás
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    public void onPause() {
        super.onPause();
        if (isKiosk) {
            try {
                ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                if (am != null) {
                    am.moveTaskToFront(getTaskId(), 0);
                }
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && isKiosk) {
            setImmersiveMode(true);
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (downloadReceiver != null) {
            try {
                unregisterReceiver(downloadReceiver);
            } catch (Exception ignored) {}
        }
    }

    public class KioskBridge {
        @JavascriptInterface
        public boolean isKioskSupported() {
            return true;
        }

        @JavascriptInterface
        public boolean isKioskActive() {
            return isKiosk;
        }

        @JavascriptInterface
        public void enterKiosk() {
            runOnUiThread(() -> enableKioskMode(true));
        }

        @JavascriptInterface
        public void exitKiosk() {
            runOnUiThread(() -> enableKioskMode(false));
        }

        @JavascriptInterface
        public void setKiosk(boolean enable) {
            runOnUiThread(() -> enableKioskMode(enable));
        }

        @JavascriptInterface
        public void downloadFile(String url, String filename, String mimeType) {
            runOnUiThread(() -> downloadWithManager(url, "attachment; filename=" + filename, mimeType));
        }

        @JavascriptInterface
        public void openInBrowser(String url) {
            runOnUiThread(() -> {
                try {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(intent);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Error: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                }
            });
        }
    }
}
