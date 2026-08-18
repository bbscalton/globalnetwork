import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, isPreview }) => ({
  plugins: [react()],
  // GitHub Pages nests the desk at /globalnetwork/ops/. Local `npm run dev` uses `/`
  // so http://localhost:5173 works without that prefix.
  base: command === 'build' || isPreview ? '/globalnetwork/ops/' : '/',
  server: {
    port: 5173,
    strictPort: false,
  },
}))
