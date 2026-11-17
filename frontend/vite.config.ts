import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The API is reached through a same-origin proxy (`/api` → backend), as
 * Caddy does in production. The refresh cookie is SameSite=Strict and
 * scoped to /api/v1/auth, so the browser must see one origin.
 * VITE_API_PROXY overrides the target (e.g. the test backend on :3100).
 */
const target = process.env.VITE_API_PROXY ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': { target, changeOrigin: false } },
  },
  preview: {
    proxy: { '/api': { target, changeOrigin: false } },
  },
})
