import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'fs';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
const APP_VERSION = pkg.version || '6.0.0';
const APP_VERSION_NUM = parseInt(APP_VERSION, 10) || 6;
const BUILD_TIME = Date.now();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(`v${APP_VERSION_NUM}`),
    __APP_VERSION_NUM__: JSON.stringify(APP_VERSION_NUM),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME)
  },
  plugins: [
    svelte(),
    {
      name: 'html-version-injector',
      transformIndexHtml(html) {
        let result = html;
        if (result.includes('name="app-version"')) {
          result = result.replace(/<meta\s+name=["']app-version["']\s+content=["'][^"']*["']\s*\/?>/i, `<meta name="app-version" content="v${APP_VERSION_NUM}" />`);
        } else {
          result = result.replace('</head>', `    <meta name="app-version" content="v${APP_VERSION_NUM}" />\n  </head>`);
        }

        if (result.includes('name="app-version-num"')) {
          result = result.replace(/<meta\s+name=["']app-version-num["']\s+content=["'][^"']*["']\s*\/?>/i, `<meta name="app-version-num" content="${APP_VERSION_NUM}" />`);
        } else {
          result = result.replace('</head>', `    <meta name="app-version-num" content="${APP_VERSION_NUM}" />\n  </head>`);
        }

        if (result.includes('name="build-time"')) {
          result = result.replace(/<meta\s+name=["']build-time["']\s+content=["'][^"']*["']\s*\/?>/i, `<meta name="build-time" content="${BUILD_TIME}" />`);
        } else {
          result = result.replace('</head>', `    <meta name="build-time" content="${BUILD_TIME}" />\n  </head>`);
        }

        return result;
      }
    },
    {
      name: 'generate-version-json',
      buildStart() {
        const versionData = JSON.stringify({
          version: APP_VERSION,
          buildTime: BUILD_TIME,
          buildDate: new Date(BUILD_TIME).toISOString()
        }, null, 2);
        try {
          fs.writeFileSync(new URL('./public/version.json', import.meta.url), versionData);
        } catch (e) {}
      },
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({
            version: APP_VERSION,
            buildTime: BUILD_TIME,
            buildDate: new Date(BUILD_TIME).toISOString()
          }, null, 2)
        });
      }
    },
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'favicon.png', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'maskable-icon-512x512.png', 'logo.png'],
      manifest: {
        id: '/',
        name: 'Wisi Space',
        short_name: 'Wisi Space',
        description: 'Wisi Space - Gestión Integral de Personal, Marcajes y Salas',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        lang: 'es',
        start_url: '/',
        scope: '/',
        categories: ['business', 'productivity', 'utilities'],
        shortcuts: [
          {
            name: 'Reportes y Cortes',
            short_name: 'Reportes',
            description: 'Acceso directo a Reportes y Cortes RRHH',
            url: '/',
            icons: [{ src: '/pwa-192x192.png', sizes: '192x192' }]
          }
        ],
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/ws/, /^\/version\.json/, /^\/empleados\//, /^\/clientes\//, /^\/attlogs\//, /^\/salas\//],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /version\.json(\?.*)?$/i,
            handler: 'NetworkOnly'
          },
          {
            urlPattern: /^https:\/\/cdn-icons-png\.flaticon\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'external-icons-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: ({ request, url }) => {
              // Interceptar ÚNICAMENTE archivos de imágenes reales, jamás endpoints de datos JSON
              const isImageExt = /\.(jpe?g|png|webp|gif|svg|ico|bmp)(\?.*)?$/i.test(url.pathname);
              return request.destination === 'image' || isImageExt;
            },
            handler: 'CacheFirst',
            options: {
              cacheName: 'wisi-media-cache-v1',
              expiration: {
                maxEntries: 2500,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 días
              },
              cacheableResponse: {
                statuses: [0, 200]
              },
              plugins: [
                {
                  handlerDidError: async () => {
                    // Evitar rechazo de promesa no controlada 'no-response' en Workbox offline
                    return new Response('', { status: 404, statusText: 'Offline Media Not Cached' });
                  }
                }
              ]
            }
          }
        ]
      }
    })
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3030',
        changeOrigin: true
      },
      '/empleados': {
        target: 'http://127.0.0.1:3030',
        changeOrigin: true
      },
      '/attlogs': {
        target: 'http://127.0.0.1:3030',
        changeOrigin: true
      },
      '/salas': {
        target: 'http://127.0.0.1:3030',
        changeOrigin: true
      },
      '/downloads': {
        target: 'http://127.0.0.1:3030',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://127.0.0.1:3030',
        ws: true,
        changeOrigin: true
      }
    }
  }
});
