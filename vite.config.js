import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Anything the React app requests at /api/... is forwarded to the Express
    // server on port 4000. To the browser it all looks like one origin, which
    // keeps the cookies simple (no CORS, no cross-site cookie rules).
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
})
