import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // RAG server (server/index.js) — optional; the app works without it.
    proxy: { '/api': 'http://localhost:8787' },
  },
})
