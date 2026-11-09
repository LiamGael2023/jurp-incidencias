#!/usr/bin/env bash
#
# Publica -o amplia- el mosaico de ortofotos en GeoServer, por REST.
#
# ══════════════════════════════════════════════════════════════════════
# USO, EN EL LINODE
# ══════════════════════════════════════════════════════════════════════
#
#   cd /var/www/envs/front/repo/deploy/geoserver
#   ./publicar_mosaico.sh
#
# La primera vez crea el almacen y publica la capa jurp:ortofotos.
# Las siguientes, mete en esa misma capa los .tif nuevos que encuentre.
# Es idempotente: correrlo dos veces no duplica nada.
#
# POR REST Y NO POR EL PANEL: el panel solo se alcanza por tunel SSH, y
# un mosaico mal armado se diagnostica leyendo el log, no mirando la
# pantalla. Asi queda ademas escrito lo que se hizo.

set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Lo que se puede cambiar sin tocar el script ──────────────────────
REST="${REST:-http://127.0.0.1:8085/geoserver/rest}"
USUARIO="${GS_USER:-admin}"
WS="${WS:-jurp}"
ALMACEN="${ALMACEN:-ortofotos}"
CAPA="${CAPA:-ortofotos}"

# La carpeta vista desde el HOST y la misma vista desde DENTRO del
# contenedor. El docker-compose las conecta; si cambias una, cambia la
# otra o GeoServer buscara donde no hay nada.
DIR_HOST="${DIR_HOST:-/var/www/geodatos/ortofotos}"
DIR_CONT="${DIR_CONT:-/datos/rasters/ortofotos}"

# ── La clave, del .env ───────────────────────────────────────────────
CLAVE="${GS_PASS:-}"
if [[ -z "$CLAVE" && -f "$AQUI/.env" ]]; then
    CLAVE="$(grep -E '^GEOSERVER_ADMIN_PASSWORD=' "$AQUI/.env" | head -1 | cut -d= -f2-)"
    # Quitar comillas si las lleva, de un tipo o del otro.
    CLAVE="${CLAVE%\"}"; CLAVE="${CLAVE#\"}"
    CLAVE="${CLAVE%\'}"; CLAVE="${CLAVE#\'}"
fi
if [[ -z "$CLAVE" ]]; then
    echo "No encuentro la clave del admin."
    echo "Ponla en $AQUI/.env (GEOSERVER_ADMIN_PASSWORD=...) o pasala asi:"
    echo "    GS_PASS='tu-clave' $0"
    exit 1
fi

CURL=(curl -sS -u "$USUARIO:$CLAVE")

codigo() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$@"; }

# Llamada que NO se traga el error.
#
# La primera version mandaba la respuesta a /dev/null y el script decia
# "creado" cuando GeoServer habia contestado 400. Media hora buscando el
# fallo en el montaje de Docker, que estaba bien. Ahora: si el codigo no
# empieza por 2, se imprime el cuerpo -que es donde GeoServer explica el
# motivo en una linea- y se corta.
pedir() {
    local que="$1"; shift
    local salida http cuerpo
    salida="$("${CURL[@]}" -w $'\n%{http_code}' "$@")" || true
    http="${salida##*$'\n'}"
    cuerpo="${salida%$'\n'*}"
    if [[ "$http" != 2* ]]; then
        echo ""
        echo "FALLO: $que  (HTTP $http)"
        # El cuerpo de error de GeoServer viene en HTML; esto saca la frase.
        echo "$cuerpo" | sed -e 's/<[^>]*>/ /g' -e 's/  */ /g' | grep -v '^ *$' | head -5
        exit 1
    fi
}

# ── 1. Que haya algo que publicar ────────────────────────────────────
if [[ ! -d "$DIR_HOST" ]]; then
    echo "No existe $DIR_HOST."
    echo "Creala y deja ahi los .tif:   sudo mkdir -p $DIR_HOST && sudo chown \$USER $DIR_HOST"
    exit 1
fi

mapfile -t TIFS < <(find "$DIR_HOST" -maxdepth 1 -type f -name '*.tif' | sort)
if [[ ${#TIFS[@]} -eq 0 ]]; then
    echo "No hay ningun .tif en $DIR_HOST."
    exit 1
fi

echo "── Granulos encontrados ──────────────────────────────────────────"
for t in "${TIFS[@]}"; do
    base="${t%.tif}"
    if [[ -f "$base.shp" || -f "$base.wkt" || -f "$base.wkb" ]]; then
        huella="huella ok"
    else
        huella="SIN HUELLA -> se vera el rectangulo blanco entero"
    fi
    printf '   %-40s %8s  %s\n' "$(basename "$t")" "$(du -h "$t" | cut -f1)" "$huella"
done
echo ""

# ── 2. La configuracion del mosaico, al lado de los rasters ──────────
#
# Se copia solo si falta: si ya esta, puede haber sido ajustada a mano y
# pisarla volveria a dejar el indice y la configuracion en desacuerdo.
for f in indexer.properties footprints.properties; do
    if [[ -f "$DIR_HOST/$f" ]]; then
        echo "   $f ya estaba, no lo toco."
    else
        cp "$AQUI/mosaico/$f" "$DIR_HOST/$f"
        echo "   $f copiado."
    fi
done
echo ""

# ── 2 bis. Rehacer el indice, si se pide ─────────────────────────────
#
# Para cuando se anade un lateral. Borra la capa, el almacen y el indice
# que GeoServer habia dejado en la carpeta, y el resto del script lo
# vuelve a construir leyendo todos los .tif que haya ahora.
#
# No toca ningun .tif ni ninguna huella: solo lo que GeoServer genero.
if [[ "${1:-}" == "--rehacer" ]]; then
    echo "── Rehaciendo el indice ──────────────────────────────────────────"
    "${CURL[@]}" -XDELETE \
        "$REST/workspaces/$WS/coveragestores/$ALMACEN?recurse=true&purge=none" >/dev/null || true
    rm -f "$DIR_HOST/$CAPA".{shp,shx,dbf,prj,qix,fix} \
          "$DIR_HOST/$CAPA.properties" \
          "$DIR_HOST"/sample_image* 2>/dev/null || true
    echo "   almacen y indice borrados; se reconstruye abajo."
    echo ""
fi

# ── 3. El espacio de trabajo ─────────────────────────────────────────
if [[ "$(codigo "$REST/workspaces/$WS.json")" == "200" ]]; then
    echo "Espacio de trabajo '$WS': ya existe."
else
    "${CURL[@]}" -XPOST -H 'Content-type: application/json' \
        -d "{\"workspace\":{\"name\":\"$WS\"}}" "$REST/workspaces" >/dev/null
    echo "Espacio de trabajo '$WS': creado."
fi

# ── 4. El almacen ────────────────────────────────────────────────────
# NO se usa `external.imagemosaic`, que seria el atajo documentado para
# publicar una carpeta de un golpe. En 2.26 contesta
#   400 Failed to locate the input file file:///datos/rasters/ortofotos
# con la carpeta existiendo y siendo escribible desde dentro del propio
# contenedor -comprobado con `docker compose exec ... ls`-. Describir el
# almacen en XML y crear la cobertura aparte funciona a la primera y
# ademas deja ver en que paso falla.
if [[ "$(codigo "$REST/workspaces/$WS/coveragestores/$ALMACEN.json")" != "200" ]]; then
    pedir "crear el almacen" -XPOST -H 'Content-type: text/xml' -d \
"<coverageStore>
   <name>$ALMACEN</name>
   <type>ImageMosaic</type>
   <enabled>true</enabled>
   <workspace>$WS</workspace>
   <url>file://$DIR_CONT</url>
 </coverageStore>" \
        "$REST/workspaces/$WS/coveragestores"
    echo "Almacen '$ALMACEN': creado."
else
    echo "Almacen '$ALMACEN': ya existe."
fi

# ── 5. La capa, con el recorte por huella encendido ──────────────────
#
# FootprintBehavior es el paso que se olvida: sin el, el
# footprints.properties se lee pero no se aplica, y se sigue viendo el
# rectangulo blanco sin que nada de error.
#
#   Transparent  - fuera de la huella, transparente. Lo que queremos.
#   Cut          - recorta pero rellena de negro.
#   None         - ignora la huella.
XML_CAPA="<coverage>
   <name>$CAPA</name>
   <nativeName>$CAPA</nativeName>
   <enabled>true</enabled>
   <parameters>
     <entry><string>FootprintBehavior</string><string>Transparent</string></entry>
   </parameters>
 </coverage>"

if [[ "$(codigo "$REST/workspaces/$WS/coveragestores/$ALMACEN/coverages/$CAPA.json")" != "200" ]]; then
    echo "Capa '$CAPA': creando. Aqui es donde GeoServer abre cada .tif,"
    echo "   construye el indice y lee las huellas; tarda."
    pedir "crear la capa" -XPOST -H 'Content-type: text/xml' -d "$XML_CAPA" \
        "$REST/workspaces/$WS/coveragestores/$ALMACEN/coverages"
    echo "Capa '$CAPA': creada."
else
    echo "Capa '$CAPA': ya existe, reafirmo el recorte por huella."
    pedir "actualizar la capa" -XPUT -H 'Content-type: text/xml' -d "$XML_CAPA" \
        "$REST/workspaces/$WS/coveragestores/$ALMACEN/coverages/$CAPA.xml"
    echo ""
    echo "   OJO: esto NO incorpora .tif nuevos. Un ImageMosaic no mira la"
    echo "   carpeta por su cuenta; se cosecha, y la cosecha va por el mismo"
    echo "   endpoint external.imagemosaic que aqui contesta 400. Para anadir"
    echo "   un lateral, rehaz el indice:"
    echo "        $0 --rehacer"
fi

# ── 6. Comprobar ─────────────────────────────────────────────────────
echo ""
echo "── Como quedo ────────────────────────────────────────────────────"
"${CURL[@]}" "$REST/workspaces/$WS/coveragestores/$ALMACEN/coverages/$CAPA.json" \
  | tr ',' '\n' | grep -iE '"name"|"srs"|"enabled"|minx|maxx|miny|maxy' | head -12 || true

echo ""
echo "WMS publico:"
echo "  https://nexhydro.jriegopresurizado.org.pe/geoserver/$WS/wms?service=WMS&version=1.3.0&request=GetCapabilities"
echo ""
echo "Vista rapida (por el tunel SSH, sin pasar por nginx):"
echo "  http://localhost:8085/geoserver/$WS/wms/reflect?layers=$WS:$CAPA&format=image/png&width=800"
echo ""
echo "Si la capa sale en blanco o vacia, el motivo esta en el log, no en"
echo "la pantalla:"
echo "  docker compose logs --tail=200 geoserver | grep -iE 'mosaic|footprint|error'"
