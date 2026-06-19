import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Shared renderer libraries live at trunk/ (next to ui/). The Docker build mirrors
// the repo layout (/repo/trunk/ui), so `../<lib>` → /repo/trunk/<lib> resolves the
// same locally and in the image.
const blackhole = fileURLToPath(new URL('../blackhole-lensing', import.meta.url))
const grovekeeper = fileURLToPath(new URL('../grovekeeper', import.meta.url))
// `@trunk` gives module UIs (in ../../modules/<name>/ui) a stable import surface
// for trunk's shared code (api, contexts, components) wherever they're loaded from.
const trunk = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { 'blackhole-lensing': blackhole, 'grovekeeper': grovekeeper, '@trunk': trunk },
  },
  server: {
    proxy: { '/api': 'http://localhost:8000' },
    fs: { allow: ['../..'] },   // dev server reads the sibling libs + ../../modules
  },
})
