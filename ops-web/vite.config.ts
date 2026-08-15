import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Nested on GitHub Pages: https://bbscalton.github.io/globalnetwork/ops/
  base: '/globalnetwork/ops/',
})
