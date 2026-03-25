import { defineConfig, loadEnv } from 'vite'
import { lingui } from '@lingui/vite-plugin'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || env.VITE_API_BASE_URL || 'http://localhost:18080'

  return {
    plugins: [
      react(),
      ...lingui(),
    ],
    test: {
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      exclude: ['playwright/**'],
    },
    server: {
      host: '0.0.0.0',
      port: 15173,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          ws: true,
        },
        '/healthz': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 15173,
    },
  }
})
