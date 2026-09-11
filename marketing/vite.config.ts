import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Project Pages URL: https://bbscalton.github.io/globalnetwork/
  base: '/globalnetwork/',
})
