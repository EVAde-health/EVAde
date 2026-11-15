import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig } from 'vite'

// Voice/API backend (the `evade` Cloudflare Worker). In production the app is served from
// the same origin; in dev, /api (incl. the voice WebSocket) is proxied there.
const API_TARGET = process.env.EVADE_API_TARGET || 'https://evade.health'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  server: {
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true, secure: true, ws: true },
    },
  },
})
