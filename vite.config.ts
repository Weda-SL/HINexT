import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Relative base so the build works from any path (Netlify, sub-folders, offline copies).
export default defineConfig({
  base: './',
  plugins: [
    react(),
    // Installable app that works offline after the first visit. The app registers the
    // service worker itself (src/pwa.ts) and asks before switching to a new version.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'fonts/*.ttf', 'fonts/*.txt'],
      manifest: {
        name: 'HINexT — Pinch Analysis',
        short_name: 'HINexT',
        description: 'Free, open-source pinch analysis: targets, heat exchanger network design and evolution, in the browser.',
        theme_color: '#0b0b0b',
        background_color: '#f6f5f3',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ttf,txt,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
