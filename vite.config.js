import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

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

const aqui = (ruta) => fileURLToPath(new URL(ruta, import.meta.url))

export default defineConfig({
  plugins: [react()],

  /* DOS PUERTAS, UN SOLO SITIO.
   *
   *   /            → NEXHYDRO entero (index.html)
   *   /inventario/ → solo INVENTARIO, instalable en el teléfono
   *
   * Es una compilación y no dos proyectos: las pantallas del inventario son
   * LOS MISMOS archivos en las dos, así que lo que se arregle en una queda
   * arreglado en la otra. Dos repos se habrían desincronizado al segundo
   * arreglo, que es como estas cosas acaban siempre.
   *
   * Comparten además el mismo montón de assets con hash -Leaflet, jsPDF,
   * las capas, los croquis-, así que la segunda puerta no duplica peso en
   * el servidor: casi todo son los mismos archivos.
   *
   * Nginx no necesita nada: `try_files $uri $uri/ /index.html` encuentra
   * /inventario/index.html por sí solo. */
  build: {
    rollupOptions: {
      input: {
        main: aqui('index.html'),
        inventario: aqui('inventario/index.html'),
      },
    },
  },

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
