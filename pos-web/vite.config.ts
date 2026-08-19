import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ command, isPreview }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@desk': path.resolve(root, '../ops-web/src'),
    },
  },
  base: command === 'build' || isPreview ? '/globalnetwork/pos/' : '/',
  server: {
    port: 5174,
    strictPort: false,
    fs: { allow: [path.resolve(root, '..')] },
  },
}))
