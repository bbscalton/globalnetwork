import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = path.dirname(fileURLToPath(import.meta.url))
const reactRoot = path.resolve(root, 'node_modules/react')
const reactDomRoot = path.resolve(root, 'node_modules/react-dom')

export default defineConfig(({ command, isPreview }) => ({
  plugins: [react()],
  // POS imports TSX from ops-web via @desk. Pages CI runs `npm ci` in ops-web first,
  // so Vite would otherwise bind those files to ops-web's React while the renderer
  // uses pos-web's copy — production then crashes on null.useState.
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@desk': path.resolve(root, '../ops-web/src'),
      'react/jsx-runtime': path.resolve(reactRoot, 'jsx-runtime.js'),
      'react/jsx-dev-runtime': path.resolve(reactRoot, 'jsx-dev-runtime.js'),
      'react/compiler-runtime': path.resolve(reactRoot, 'compiler-runtime.js'),
      react: reactRoot,
      'react-dom': reactDomRoot,
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
  base: command === 'build' || isPreview ? '/globalnetwork/pos/' : '/',
  server: {
    port: 5174,
    strictPort: false,
    fs: { allow: [path.resolve(root, '..')] },
  },
}))
