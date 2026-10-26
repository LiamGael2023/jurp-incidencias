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
//
// El nombre de nip.io que había aquí sigue funcionando en el servidor —se
// dejó en el server_name a propósito—, pero el dominio propio es el que va a
// durar, y es el único que no delata la IP en cada petición de desarrollo.
const SERVIDOR = 'https://nexhydro.jriegopresurizado.org.pe'

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
