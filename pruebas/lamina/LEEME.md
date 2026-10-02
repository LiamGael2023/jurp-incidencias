# Pruebas de la lámina temática

```bash
node pruebas/lamina/lamina.test.mjs
```

Monta la pantalla en un Chromium con el inventario simulado. Hace falta
Playwright y un Chromium; si no están en la ruta por defecto, se indican con
variables de entorno:

```bash
PLAYWRIGHT=/ruta/a/playwright/index.mjs CHROMIUM=/ruta/a/chrome \
  node pruebas/lamina/lamina.test.mjs
```

## Qué comprueban y por qué estas y no otras

**La escala.** Es lo único que esta pantalla no puede equivocar: una lámina
que dice 1:10 000 sin serlo es peor que una sin rótulo, porque alguien medirá
sobre ella. No se comprueba el rótulo —eso no demuestra nada— sino el dibujo:
se toman dos líneas de la cuadrícula, se mira cuántos metros UTM hay entre
ellas y cuántos milímetros de papel, y se divide. Se repite a tres anchos de
ventana porque la hoja se agranda sola para llenar el hueco, y ese ajuste
podría arrastrar la escala consigo.

**Los tres niveles.** Sector, tramo y canal salen de sitios distintos de la
API —polígonos, capas de Chavimochic y capas de JURP— y es fácil que un
cambio en el backend deje un selector vacío sin que nadie se entere.

**Las progresivas se proponen solas.** Estuvieron rotas: el efecto corría una
vez al montar, cuando todavía no había datos, y los campos se quedaban en
blanco para siempre. Con los campos vacíos la selección es el canal entero,
que nunca cabe en una lámina.

**La leyenda.** Debe nombrar lo que está dibujado, no lo que está encendido en
el panel. Listaba las treinta y siete capas y la última ni siquiera cabía en
el recuadro.

**El bloqueo del hilo principal.** En la lámina el racimo va apagado —en el
papel saldrían burbujas con un número— y eso son miles de marcadores sueltos.
Llegó a bloquear el navegador 4737 ms repartidos en ráfagas mientras cargaban
las capas, que desde fuera se ve como un temblor y no como una espera. El
límite de la prueba está puesto para que avise si se vuelve a acercar.

El inventario simulado imita los campos **reales**, que no son los que uno
supondría: las capas de JURP traen `nombre_canal` y la progresiva como número
en metros (1553.7, no "1+553.7"), `tramo` solo lo traen las capas de
Chavimochic, y el sector no es un atributo sino la capa `sectores_pech`.
