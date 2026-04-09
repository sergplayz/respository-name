import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), '')
  // Vercel injects process.env at build time. RENDER_API_URL works without the VITE_ prefix.
  const apiBase = (
    process.env.RENDER_API_URL ||
    process.env.VITE_API_URL ||
    fileEnv.RENDER_API_URL ||
    fileEnv.VITE_API_URL ||
    ''
  )
    .trim()
    .replace(/\/$/, '')

  return {
    plugins: [react()],
    define: {
      __API_ORIGIN__: JSON.stringify(apiBase),
    },
    server: {
      port: 5173,
      // Avoid ERR_CONNECTION_REFUSED when the browser resolves `localhost` to IPv6 only.
      host: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
  }
})
