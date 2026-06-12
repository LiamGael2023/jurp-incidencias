import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react' // <--- ¡AQUÍ ESTABA EL ERROR!

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Nuestra configuración del proxy se mantiene igual
  server: {
    proxy: {
      '/api': {
        target: 'http://sistema.jriegopresurizado.org.pe',
        changeOrigin: true,
        secure: false, 
      }
    }
  }
})