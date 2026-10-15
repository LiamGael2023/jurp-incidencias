import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy de desarrollo (solo aplica a `npm run dev`).
//
// Refleja las mismas tres rutas que en producción resuelve nginx —ver
// deploy/nginx-front.conf— para que lo que funciona en dev funcione
// desplegado. Antes solo estaba /api y apuntaba al Linode viejo, así que el
// login de SENTRIA no se podía probar en local.
//
// Todo va contra nexhydro, que es el host que ya sabe repartir: /api al
// contenedor de PLUVIRA y /vigapi al de vigilantes.
const SERVIDOR = 'https://nexhydro.192.81.132.87.nip.io'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // PLUVIRA
      '/api': {
        target: SERVIDOR,
        changeOrigin: true,
        secure: false,
      },
      // SENTRIA / vigilantes
      '/vigapi': {
        target: SERVIDOR,
        changeOrigin: true,
        secure: false,
      },
      // InnovaWeather
      '/innovapi': {
        target: SERVIDOR,
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
