/// <reference types="vitest/config" />
import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the site from /<repo>/. GITHUB_REPOSITORY ("owner/repo") is set by Actions.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'indoor-navigation';
const base = process.env.GITHUB_PAGES ? `/${repoName}/` : '/';

export default defineConfig(({ mode }) => ({
  base,
  plugins: [
    react(),
    tailwindcss(),
    // Camera and motion sensors on a phone require a secure context, so the LAN dev server runs on HTTPS.
    mode === 'lan' && basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Indoor Navigation',
        short_name: 'Indoor Nav',
        description: 'Office indoor navigation with visual localization, no backend',
        lang: 'en',
        theme_color: '#4f46e5',
        background_color: '#020617',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell, TF.js chunk, default map and floor plan are precached.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json}'],
        globIgnores: ['models/**'],
        // The TensorFlow.js chunk is larger than Workbox's 2 MiB default.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Model weights (~7.5 MB) are cached on first use of the scanner, not on install.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith(`${base}models/`),
            handler: 'CacheFirst',
            options: {
              cacheName: 'mobilenet-model',
              expiration: { maxEntries: 10 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    // TensorFlow.js (~720 kB) is a lazily loaded chunk that is only fetched when the camera is used.
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
