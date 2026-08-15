import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  // Project Pages URL: https://bbscalton.github.io/globalnetwork/
  base: '/globalnetwork/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        tcd: resolve(__dirname, 'tcd.html'),
      },
    },
  },
})
