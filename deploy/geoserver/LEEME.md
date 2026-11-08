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

**Este paso importa más que GeoServer.** Un GeoTIFF de vuelo, tal cual
sale, no tiene resúmenes: para pintar el canal entero alejado hay que
leer los gigas enteros y reducirlos al vuelo, cada vez y para cada
persona. Con overviews, esa misma vista se lee de una copia de unos
megas.

No es «va más rápido»: es entre 40 segundos y 200 ms, y entre un servidor
que aguanta tres personas y uno que se cae.

```bash
sudo apt install -y gdal-bin
sudo mkdir -p /var/www/geodatos && sudo chown "$USER" /var/www/geodatos

cd /var/www/envs/front/repo/deploy/geoserver
./preparar_ortofoto.sh /ruta/original.tif /var/www/geodatos/ortofoto.tif
```

Tarda. Veinte gigas pueden ser una hora: lánzalo dentro de `tmux` o con
`nohup`, porque si se corta el SSH a mitad queda un archivo incompleto
que *parece* bueno.

El script convierte a **COG con compresión JPEG**. Un vuelo de 20 GB suele
quedar en 1,5–2 GB sin diferencia visible en pantalla — una ortofoto es
una foto, y comprimirla sin pérdida no sirve de nada porque el ruido no
se comprime.

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

Por el túnel, en `http://localhost:8085/geoserver/web/`:

1. **Workspaces** → *Add new* → nombre `jurp`, URI
   `https://nexhydro.jriegopresurizado.org.pe/jurp`. Marcarlo como *default*.
2. **Stores** → *Add new store* → **GeoTIFF**
   - Workspace: `jurp`
   - Nombre: `ortofoto`
   - URL: `file:///datos/rasters/ortofoto.tif`

   Esa ruta es la de **dentro del contenedor**; en el disco está en
   `/var/www/geodatos/`. El `docker-compose` las conecta.
3. **Publish** → en la pestaña *Publishing*:
   - *Declared SRS*: el que diga `gdalinfo` (el canal suele ser
     `EPSG:32717`, UTM 17 Sur).
   - *Native SRS* ya debería venir solo.
4. En la pestaña *Tile Caching*, deja el **GWC** activado: es lo que hace
   que la segunda persona que mire la misma zona no vuelva a pagar la
   lectura del raster.

Comprobar desde fuera:

```
https://nexhydro.jriegopresurizado.org.pe/geoserver/jurp/wms?service=WMS&version=1.3.0&request=GetCapabilities
```

---

## 5. Consumirlo

### En la web (Leaflet)

```js
L.tileLayer.wms('/geoserver/jurp/wms', {
  layers: 'jurp:ortofoto',
  format: 'image/jpeg',   // jpeg, no png: es una foto y pesa la cuarta parte
  transparent: false,
  maxZoom: 22,
  attribution: 'JURP',
}).addTo(map);
```

Ruta **relativa**: mismo host que el front, así que no hay CORS de por
medio.

### En la app (Flutter, flutter_map)

```dart
TileLayer(
  urlTemplate: 'https://nexhydro.jriegopresurizado.org.pe/geoserver/gwc/'
      'service/tms/1.0.0/jurp:ortofoto@EPSG:900913@jpeg/{z}/{x}/{y}.jpeg',
  tms: true,
)
```

Por **GWC/TMS** y no por WMS: las teselas van cacheadas y con URL fija, y
eso en el canal —con la cobertura que hay— es la diferencia entre un mapa
que carga y uno que no.

### Desde QGIS (lo del WMS)

Capa → Añadir capa WMS/WMTS → Nueva conexión:

```
https://nexhydro.jriegopresurizado.org.pe/geoserver/jurp/wms
```

Sin usuario ni clave: los servicios son de solo lectura. Esto es lo que
puedes pasarle a quien te pida la ortofoto, en vez de mandar el archivo.

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
