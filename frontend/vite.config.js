import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  preview: {
    host: true,
    allowedHosts: [
      "calendariohorariosweb-frontend.onrender.com",
      "calendariohorarioswebfrontend.onrender.com",
      "localhost"
    ]
  }
})
