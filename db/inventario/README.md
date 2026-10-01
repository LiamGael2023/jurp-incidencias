# Catálogo de campos evaluables del inventario

Qué hay aquí y en qué orden se usa.

## Los dos archivos

**`gen_catalogo.py`** es la fuente de verdad. Declara, una sola vez, los campos
de las diez fichas de inspección que levantó JURP y los expande a los tipos de
activo que los usan.

**`alta_catalogo_fichas.sql`** es su salida. **No editarlo a mano**: la próxima
regeneración pisa el cambio. Lo que haya que corregir se corrige en el
generador.

```bash
python3 gen_catalogo.py > alta_catalogo_fichas.sql
```

El SQL se ejecuta contra la base del inventario, que vive en un contenedor
aparte del compose de `api_vigilantes`:

```bash
docker exec -i jurp_postgis psql -U gis_admin -d jurp_gis < alta_catalogo_fichas.sql
```

Es idempotente y autocorrectivo: inserta lo que falta, alinea lo que ya está
(etiqueta, tipo de dato, dominio, obligatoriedad y orden) y no duplica nada al
correrlo dos veces. Si un código de tipo de activo no existe en `tipos_activo`,
avisa por `NOTICE` y no inserta nada de ese tipo.

Va por SQL y no por el shell de Django a propósito: el usuario de la aplicación
(`gis_app`) tiene solo lectura sobre el catálogo (`tipos_activo`,
`campos_evaluables`, `dominios`), que es lo correcto — la app lee el catálogo,
no lo escribe. Se corre con el dueño de la base, `gis_admin`.

## Por qué un generador y no SQL escrito a mano

Las diez fichas son la misma plantilla con bloques intercambiables. Las
secciones 1 y 2 y la cabecera de la 3 son idénticas carácter por carácter en
ocho de ellas, y el vocabulario de dimensiones se repite: `Lt1 / B1 / b / h1 /
e` es el mismo juego en canoa, sifón y alcantarilla.

Escritas una por una son ~700 filas de SQL con los mismos nombres diez veces, y
la primera vez que haya que corregir «Espesor Muro (e)» hay que acordarse de
los diez sitios. Aquí el campo se declara una vez.

De los 709 campos del catálogo hay 313 nombres distintos: 81 se comparten entre
dos o más tipos. `ing_long` es la longitud de la transición de ingreso en canoa,
sifón, alcantarilla y desarenador — el mismo nombre en los cuatro, para que un
reporte pueda cruzar tipos sin traducir nombres.

## Decisiones que conviene conocer antes de tocar el catálogo

**Una captura, dos salidas.** La ficha de inspección es el formulario de campo
y es más rica que el Excel que se manda al ANA; el Excel es una proyección de
los mismos datos. Por eso no hay dos juegos de campos: está el de la ficha, más
las columnas que solo pide el ANA (`margen`, el material y la operación de la
compuerta, los dos juegos de áreas).

**Los nombres del shapefile no se cambian.** Varias capas vienen de shapefiles
y sus columnas ya tienen datos cargados. El formulario precarga por nombre de
campo, así que renombrarlas le quita al técnico el valor base contra el que
comparar. Manda el nombre de la columna aunque sea feo: `estado2`, `operaci_1`,
`Áreas_baj`, `número_to`. Están en `RENOMBRES`, y qué significa cada una sale de
los formatos B-1.A y B-1.C del ANA, no de adivinar.

**Fuera de la captura, a propósito:** las coordenadas UTM y la elevación (las da
el GPS al ubicar el activo, y el Excel del ANA las saca de `geom`); el nombre y
el código del activo (son columnas de la tabla); el canal al que pertenece (ya
está en la capa, en `ambito` y `tramo`); la fecha, el responsable, el croquis y
las fotografías.

**Las preguntas de sí/no van como desplegable y no como casilla.** En una
casilla, «no» y «sin responder» se ven idénticos, y en una ficha de inspección
esa diferencia es justamente el hallazgo.

**La agrupación del formulario viaja en la etiqueta**, antes del separador
` · `. `campos_evaluables` no tiene columna de sección, y el formulario
(`src/InventarioGIS.jsx`) recupera el bloque de ahí para plegar. Si se cambia el
separador hay que cambiarlo en los dos sitios.

## Lo que falta

- **`laterales.estado1`** — columna con datos cuyo significado no está
  identificado. El catálogo no la toca y el script la reporta por `NOTICE`.
- **Sublaterales** — hay 63 fichas levantadas y no existe el tipo de activo ni
  la capa. Su catálogo está declarado en el generador y no carga hasta que
  exista `sublateral` en `tipos_activo`.
- **Cuatro tipos sin ficha**, que se quedan con `estado` y `observacio`:
  `cajas_hidraulicas`, `camara_rompepresion`, `pases_de_tuberias`,
  `reservorios`.
- **Dos tipos cargados por inferencia, no por ficha propia:** `partidor` usa el
  bloque «Partidor ③» de la ficha 08 del aliviadero, y `puente_peatonal` la
  ficha 05 del pase vehicular. Si aparecen sus fichas, hay que cotejarlos.
