import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const rpcProxyTarget = env.ARC_RPC_UPSTREAM_URL || 'https://rpc.testnet.arc.network';
  const catboxProxyTarget = env.CATBOX_UPLOAD_UPSTREAM_URL || 'https://catbox.moe';
  const apiProxyTarget = env.VITE_API_UPSTREAM_URL || 'http://127.0.0.1:8787';

  return {
    plugins: [
      react(),
      VitePWA({
        disable: mode !== 'production',
        registerType: 'autoUpdate',
        manifest: false,
        includeAssets: ['icons/icon.svg', 'icons/maskable-icon.svg'],
        workbox: {
          clientsClaim: true,
          skipWaiting: true,
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,svg,png,webmanifest}'],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
              handler: 'NetworkOnly',
              options: {
                cacheName: 'api'
              }
            },
            {
              urlPattern: ({ request }) => request.destination === 'document',
              handler: 'NetworkOnly',
              options: {
                cacheName: 'documents'
              }
            },
            {
              urlPattern: ({ request }) => request.destination === 'script' || request.destination === 'style',
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'assets'
              }
            },
            {
              urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'fonts'
              }
            }
          ]
        }
      })
    ],
    server: {
      port: 5173,
      proxy: {
        '/rpc/arc': {
          target: rpcProxyTarget,
          changeOrigin: true,
          rewrite: () => ''
        },
        '/upload/catbox': {
          target: catboxProxyTarget,
          changeOrigin: true,
          rewrite: () => '/user/api.php'
        },
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true
        }
      }
    }
  };
});
