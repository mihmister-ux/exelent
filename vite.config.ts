import { fileURLToPath } from "node:url"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// import.meta.url вместо __dirname: конфиг одинаково работает и когда Vite
// собирает его сам, и при нативной загрузке (--configLoader native).
const srcDir = fileURLToPath(new URL("./src", import.meta.url))

export default defineConfig({
  // GitHub Pages отдаёт проект с подкаталога /exelent/, а не с корня домена.
  // base пишется явно: с base './' service worker и манифест претендуют на
  // область сайта целиком и конфликтуют с другими проектами на том же Pages.
  // Роутинг приложения — HashRouter, поэтому префикс пути ничего не ломает.
  base: '/exelent/',
  plugins: [
    react(),
    tailwindcss(),
    // Манифест лежит статикой в public/manifest.webmanifest (manifest: false),
    // здесь только service worker. Оффлайн-режим проверяем на этапе 4.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      devOptions: { enabled: false },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,woff2}'],
      },
    }),
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      "@": srcDir,
    },
  },
})
