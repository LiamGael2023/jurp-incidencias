# GeoServer en el Linode — ortofoto y WMS

Para publicar la ortofoto del canal y, de paso, dejar un **WMS** al que
otros se puedan conectar desde QGIS.

---

## Antes de nada: ¿cabe?

GeoServer es Java. En reposo pide unos 700 MB y con una ortofoto grande
se va a 1,5 GB. En ese servidor ya corren Django, Postgres, el front y
`push_service`.

```bash
free -h
df -h /
docker ps --format "table {{.Names}}\t{{.Status}}"
```

Y el tamaño de la ortofoto, que es lo que más pesa en la decisión:

```bash
ls -lh /ruta/a/la/ortofoto.tif
gdalinfo /ruta/a/la/ortofoto.tif | head -20
```

**Si el disco queda por debajo del 20 % libre, no lo instales todavía.**
Un servidor sin disco no falla en GeoServer: falla en Postgres, que deja
de poder escribir, y eso se lleva por delante PLUVIRA entera. Si la
ortofoto no entra, la solución es dejarla en un bucket (Backblaze B2,
céntimos al mes) y apuntar GeoServer ahí, o servirla como COG desde el
bucket y olvidarse de GeoServer.

---

## 1. La ortofoto, primero

**Este paso importa más que GeoServer.** Un raster de vuelo sin resúmenes
obliga a leer los gigas enteros y reducirlos al vuelo cada vez que
alguien se aleja, para cada persona. Con overviews, esa misma vista se
lee de una copia de unos megas. No es «va más rápido»: es entre 40
segundos y 200 ms, y entre un servidor que aguanta tres personas y uno
que se cae.

### Si el original es un ECW — hay que convertirlo en Windows

Los vuelos de JURP vienen en **ECW**, que es formato propietario de
Hexagon. El GDAL de Ubuntu no lo lee: el SDK no se puede redistribuir, así
que ninguna distribución lo compila con ese soporte. Compruébalo antes de
subir nada:

```bash
gdalinfo --formats | grep -i ecw     # si no imprime nada, no lo lee
```

Tu QGIS de Windows **sí** lo lee —las compilaciones para Windows
incluyen el decodificador gratuito—, así que la conversión se hace ahí,
en el **OSGeo4W Shell**, y al servidor sube ya el GeoTIFF.

Lo primero, mirar qué hay dentro:

```
gdalinfo "D:\...\ECW LATERAL 10.ecw"
```

De ahí salen el CRS (el canal es **EPSG:32717**, UTM 17 Sur), el tamaño en
píxeles y las bandas. El Lateral 10 son 692.223 × 309.247 px a 3 cm:
**214 gigapíxeles**, 642 GB sin comprimir, que el ECW deja en 3,7 GB.

Un ratio así solo se consigue cuando casi todo el recuadro está vacío: el
vuelo es una franja estrecha y el resto es **blanco puro, 255 255 255**.
Ese blanco hay que recortarlo, o la capa tapará el mapa base alrededor del
canal y, en un mosaico, la franja del lateral vecino.

**La huella del vuelo**, en tres pasos de segundos cada uno:

```
gdal_translate -of GTiff -outsize 21631 9663 -r nearest -co COMPRESS=DEFLATE -co TILED=YES -co BIGTIFF=YES "D:\...\ECW LATERAL 10.ecw" "D:\l10_small.tif"

gdal_calc -A D:\l10_small.tif --A_band=1 -B D:\l10_small.tif --B_band=2 -C D:\l10_small.tif --C_band=3 --outfile=D:\l10_mask.tif --calc="logical_or(logical_or(A<245,B<245),C<245)" --type=Byte --NoDataValue=0 --co COMPRESS=DEFLATE

gdal_footprint -b 1 -srcnodata 0 -max_points unlimited -min_ring_area 2000 -simplify 5 -f "ESRI Shapefile" "D:\l10_mask.tif" "D:\ortofoto_lateral10.shp"
```

Tres cosas que costaron una mañana averiguar, por si se repite:

**El umbral de 245, no el blanco exacto.** Lo natural sería buscar
`255 255 255` directamente sobre el ECW. No sirve: a 173:1 el wavelet
produce *ringing* alrededor del salto de imagen a fondo, así que hay una
orla de cien o doscientos metros que es 250-254 y la huella la toma por
dato. Al publicarla se veía un manchón blanco con los bordes escalonados
—la forma de los bloques del wavelet— que tapaba el mapa base.

**`-r nearest` en el reducido.** Promediar mezclaría el fondo con la
imagen del borde y el fondo dejaría de ser plano. Y `gdal_footprint` no
admite `-srcnodata` junto con `-ovr`, por eso el reducido se hace a mano.

**`-simplify 5` y `-min_ring_area 2000` son un equilibrio medido, no un
número al azar.** GeoServer rasteriza el polígono ENTERO en cada tesela:

| contorno | `.shp` | tesela de 39 km | tramos estrechos |
|---|---|---|---|
| `-simplify 2 -min_ring_area 2000` | 274 KB | no vuelve en 60 s | bien |
| `-simplify 20 -min_ring_area 20000` | 20 KB | 1,6 s | **se pierden** |
| `-simplify 5 -min_ring_area 2000` | 130 KB | 0,2 s a zoom 13 | bien |

Simplificar de más borra las fajas angostas: sobre los túneles el vuelo
es una franja de quince o veinte metros siguiendo el camino de servicio,
y con tolerancia de 20 m se colapsa y desaparece del mapa aunque la
imagen esté en el ráster. Se comprueba en un minuto con el script de
«¿está completo?», al final de este archivo.

El tiempo de la tesela enorme dejó de importar cuando el visor pasó a no
pedir la capa por debajo del zoom 13 (`ORTOFOTO.minZoom` en
`src/capasBase.jsx`), pero conviene no volver al contorno de 274 KB: QGIS
sí puede pedir la vista completa.

El shapefile **se llama igual que el .tif** a propósito: así GeoServer lo
encuentra solo como sidecar del gránulo.

**La conversión** (una hora y media para el Lateral 10):

```
gdal_translate -of COG -a_srs EPSG:32717 -co COMPRESS=JPEG -co QUALITY=85 -co BLOCKSIZE=512 -co NUM_THREADS=ALL_CPUS -co BIGTIFF=YES -co OVERVIEW_RESAMPLING=AVERAGE "D:\...\ECW LATERAL 10.ecw" "D:\ortofoto_lateral10.tif"
```

**No metas el recorte aquí.** La vía obvia —`gdalwarp -cutline -dstalpha`
a un VRT y de ahí al COG— funciona, pero pasa cada bloque por el motor de
reproyección, que pide ventanas sueltas al ECW y le impide usar sus
overviews: medido, 36 horas en vez de hora y media, para una
transformación que es la identidad. El recorte lo aplica GeoServer al
servir, con la huella, y queda mejor: es geométrico y no por color, así
que no abre agujeros en la arena clara ni deja halo en los bordes.

JPEG al 85 % y no DEFLATE porque una ortofoto es una foto: tiene ruido, y
comprimir sin pérdida no sirve de nada.

### Si el original ya es un GeoTIFF

```bash
sudo apt install -y gdal-bin
sudo mkdir -p /var/www/geodatos && sudo chown "$USER" /var/www/geodatos
cd /var/www/envs/front/repo/deploy/geoserver
./preparar_ortofoto.sh /ruta/original.tif /var/www/geodatos/ortofotos/ortofoto.tif
```

Lánzalo dentro de `tmux` o con `nohup`: si se corta el SSH a mitad queda
un archivo incompleto que *parece* bueno.

---

## 2. Levantar GeoServer

```bash
cd /var/www/envs/front/repo/deploy/geoserver
cp env.ejemplo .env
nano .env          # la clave, y el RAM según el `free -h` de arriba
docker compose up -d
docker compose logs -f geoserver     # Ctrl-C cuando diga que arrancó
```

Dos cosas del `.env` que no son cosméticas:

- **`GEOSERVER_ADMIN_PASSWORD`** se aplica solo en el **primer** arranque.
  Si levantas una vez sin ponerla, queda `admin/geoserver` y hay que
  borrar `./datos` y empezar de nuevo.
- **`GS_XMX`** no debe pasar de la **mitad** del RAM libre. Si te pasas,
  el que muere no es GeoServer: es Postgres, porque el kernel mata al
  proceso más grande y nadie relaciona una cosa con la otra.

Comprobar que está vivo, desde el propio servidor:

```bash
curl -s 'http://127.0.0.1:8085/geoserver/ows?service=WMS&request=GetCapabilities' | head -5
```

---

## 3. Publicarlo con nginx

```bash
sudo nano /etc/nginx/sites-available/jurp-front
```

Pega los `location` de `nginx-geoserver.conf` **dentro** del `server { }`
que ya sirve el front, al lado de los `/vigapi/`. Luego:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

**El panel de administración queda cerrado** (`return 404`). Para entrar:

```bash
ssh -L 8085:127.0.0.1:8085 webadmin@192.81.132.87
# y en tu navegador:  http://localhost:8085/geoserver/web/
```

No es incomodidad por gusto. GeoServer nace con `admin/geoserver` y su
panel permite leer archivos del disco del servidor con el «Store»
apropiado: abierto a internet es una puerta a la máquina, no una página
de configuración. Y `/geoserver/rest/` hace lo mismo sin pasar por el
panel, por eso también está cerrado.

---

## 4. Publicar la capa

Sube a `/var/www/geodatos/ortofotos/` el `.tif` y los cuatro archivos del
shapefile de su huella (`.shp`, `.dbf`, `.shx`, `.prj`), con el mismo
nombre base. Desde tu PC:

```
scp "D:\ortofoto_lateral10.tif" "D:\ortofoto_lateral10.shp" "D:\ortofoto_lateral10.dbf" "D:\ortofoto_lateral10.shx" "D:\ortofoto_lateral10.prj" webadmin@192.81.132.87:/var/www/geodatos/ortofotos/
```

Y en el servidor:

```bash
cd /var/www/envs/front/repo/deploy/geoserver
./publicar_mosaico.sh
```

Eso crea el espacio de trabajo `jurp`, monta un **ImageMosaic** con todos
los `.tif` de la carpeta, enciende el recorte por huella y deja publicada
la capa `jurp:ortofotos`. El script lista antes qué encontró y avisa de
cualquier `.tif` que no tenga huella al lado.

**Un mosaico y no una capa por lateral**: cada vuelo es un archivo, pero
para el visor es *la ortofoto*. GeoServer mira qué gránulo cae en la
ventana pedida y solo abre ese. No hay nada que tocar en la web ni en la
app cuando se añade uno.

Para añadir el lateral 11: deja su `.tif` y su huella en la carpeta y
corre

```bash
./publicar_mosaico.sh --rehacer
```

Hace falta el `--rehacer` porque un ImageMosaic no vigila la carpeta: los
gránulos nuevos se «cosechan», y la cosecha va por el mismo endpoint
`external.imagemosaic` que en esta versión contesta 400. Rehacer el
índice son un par de minutos y no toca ningún `.tif`.

Comprobar desde fuera:

```
https://nexhydro.jriegopresurizado.org.pe/geoserver/jurp/wms?service=WMS&version=1.3.0&request=GetCapabilities
```

Si la capa sale vacía o en blanco, el motivo está en el log:

```bash
docker compose logs --tail=200 geoserver | grep -iE 'mosaic|footprint|error'
```

---

## 5. Consumirlo

### En la web (Leaflet)

```js
L.tileLayer.wms('/geoserver/jurp/wms', {
  layers: 'jurp:ortofotos',
  format: 'image/vnd.jpeg-png',   // ver nota abajo
  transparent: true,
  maxZoom: 22,
  attribution: 'JURP',
}).addTo(map);
```

Ruta **relativa**: mismo host que el front, así que no hay CORS de por
medio.

**`transparent: true` y ese formato no son opcionales.** El vuelo es una
franja dentro de un rectángulo vacío; fuera de la huella no hay imagen.
Pidiendo `image/jpeg` —que no tiene canal alfa— GeoServer rellena esa
parte de blanco y vuelve el problema que resolvimos con la huella.

`image/vnd.jpeg-png` es un formato de GeoServer que decide por tesela:
JPEG donde es toda imagen, PNG donde hay transparencia. Así el interior
del canal pesa lo que pesaría en JPEG y solo los bordes pagan el PNG.

### En la app (Flutter, flutter_map)

```dart
TileLayer(
  urlTemplate: 'https://nexhydro.jriegopresurizado.org.pe/geoserver/gwc/'
      'service/tms/1.0.0/jurp:ortofotos@EPSG:900913@png/{z}/{x}/{y}.png',
  tms: true,
)
```

Por **GWC/TMS** y no por WMS: las teselas van cacheadas y con URL fija, y
eso en el canal —con la cobertura que hay— es la diferencia entre un mapa
que carga y uno que no.

En PNG porque la caché guarda un formato fijo y necesita alfa. Hay que
añadir `image/png` a los formatos cacheados de la capa (*Tile Caching* →
*Tile Image Formats*), que por defecto trae PNG y JPEG.

### Desde QGIS (lo del WMS)

Capa → Añadir capa WMS/WMTS → Nueva conexión:

```
https://nexhydro.jriegopresurizado.org.pe/geoserver/jurp/wms
```

Sin usuario ni clave: los servicios son de solo lectura. Esto es lo que
puedes pasarle a quien te pida la ortofoto, en vez de mandar el archivo.

---

## ¿Está completo?

Un hueco en la capa puede ser dos cosas muy distintas: que el vuelo no
cubriera esa zona, o que el recorte por huella se la esté comiendo.
Mirando el mapa no se distinguen. Esto pregunta al ráster directamente,
tramo por tramo, usando el trazado del canal que ya está en el repo:

```bash
cd /var/www/envs/front/repo/src/data
python3 - <<'PY'
import json, subprocess

RASTER = '/var/www/geodatos/ortofotos/ortofoto_lateral10.tif'
fs = json.load(open('Lateral_10.json'))['features']

def centro(f):
    anillo = f['geometry']['coordinates'][0]
    return (sum(c[0] for c in anillo) / len(anillo),
            sum(c[1] for c in anillo) / len(anillo))

def cubierto(lon, lat):
    r = subprocess.run(['gdallocationinfo', '-wgs84', '-valonly', RASTER,
                        str(lon), str(lat)], capture_output=True, text=True)
    v = [x for x in r.stdout.split() if x.isdigit()]
    if len(v) < 3:
        return None                      # fuera del rectangulo del vuelo
    return any(int(x) < 250 for x in v)  # algo que no sea blanco

sin_vuelo, fuera, con = [], [], 0
for f in fs:
    lon, lat = centro(f)
    c = cubierto(lon, lat)
    if c is None:   fuera.append(f['properties'])
    elif c:         con += 1
    else:           sin_vuelo.append(f['properties'])

print('tramos del Lateral 10 :', len(fs))
print('con imagen            :', con)
print('dentro, pero en blanco:', len(sin_vuelo))
print('fuera del vuelo       :', len(fuera))
for p in sin_vuelo + fuera:
    print('   %-26s %-16s %s' % (p.get('ESTRUCTURA'), p.get('PROGRESIVA'),
                                 p.get('NOMBRE')))
PY
```

Pregunta al **.tif**, no a la capa publicada: si dice que hay imagen y en
el mapa no se ve, el culpable es la huella —`-simplify` de más, o
`footprint_inset` de más— y no hay que volver a convertir nada.

Fue exactamente lo que pasó con los túneles: 106 de 106 tramos tenían
imagen y el mapa mostraba un hueco de varios kilómetros.

---

## Si va lento

Por orden de probabilidad:

1. **La ortofoto no tiene overviews.** Es el 90 % de los casos. Revisa
   que `gdalinfo` liste `Overviews:` en el archivo publicado.
2. **El GWC está apagado** en esa capa, así que cada vista relee el
   raster.
3. **Xmx corto** — mira `docker stats geoserver`: si está pegado al techo
   todo el rato, súbelo (pero mira antes el `free -h`).
4. **Demasiadas peticiones a la vez.** Para eso está
   `controlflow.properties`; bajar `ows.wms.getmap` encola en vez de
   tumbar.

## Respaldo

Solo hace falta `./datos` (megas: capas, estilos y usuarios). Los rasters
de `/var/www/geodatos` son el original, que ya tienes en otro sitio.

```bash
cd /var/www/envs/front/repo/deploy/geoserver
tar czf ~/geoserver-datos-$(date +%F).tar.gz datos/
```
