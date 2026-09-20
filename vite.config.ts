import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        name: 'Skrivist Books',
        short_name: 'Books',
        description:
          'Local-first EPUB and PDF reading. No account or cloud storage.',
        theme_color: '#f6f3ec',
        background_color: '#f6f3ec',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,bcmap,ttf,otf,pfb,wasm}'],
        maximumFileSizeToCacheInBytes: 2000000,
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.origin === self.location.origin &&
              (url.pathname.startsWith('/assets/') ||
                url.pathname.startsWith('/pdf-assets/')),
            handler: 'CacheFirst',
            options: {
              cacheName: 'books-assets-v1',
              expiration: { maxEntries: 256 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  test: { environment: 'jsdom', setupFiles: ['./tests/setup.ts'] },
  build: { target: 'es2022' },
  worker: { format: 'es' },
});
