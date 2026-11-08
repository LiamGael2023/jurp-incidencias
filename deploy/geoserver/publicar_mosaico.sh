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

# ── 3. El espacio de trabajo ─────────────────────────────────────────
if [[ "$(codigo "$REST/workspaces/$WS.json")" == "200" ]]; then
    echo "Espacio de trabajo '$WS': ya existe."
else
    "${CURL[@]}" -XPOST -H 'Content-type: application/json' \
        -d "{\"workspace\":{\"name\":\"$WS\"}}" "$REST/workspaces" >/dev/null
    echo "Espacio de trabajo '$WS': creado."
fi

# ── 4. El almacen ────────────────────────────────────────────────────
EXISTE="$(codigo "$REST/workspaces/$WS/coveragestores/$ALMACEN.json")"

if [[ "$EXISTE" != "200" ]]; then
    echo "Almacen '$ALMACEN': creando y publicando la capa (esto tarda,"
    echo "   GeoServer esta construyendo el indice y leyendo cada .tif)..."
    # PUT sobre un almacen que no existe = crearlo con toda la carpeta.
    "${CURL[@]}" -XPUT -H 'Content-type: text/plain' \
        -d "file://$DIR_CONT" \
        "$REST/workspaces/$WS/coveragestores/$ALMACEN/external.imagemosaic" >/dev/null
    echo "Almacen '$ALMACEN': creado."
else
    echo "Almacen '$ALMACEN': ya existe, busco granulos nuevos."
    # POST = cosechar. GeoServer ignora los que ya estan indexados, asi
    # que no hace falta saber cuales son nuevos.
    for t in "${TIFS[@]}"; do
        "${CURL[@]}" -XPOST -H 'Content-type: text/plain' \
            -d "file://$DIR_CONT/$(basename "$t")" \
            "$REST/workspaces/$WS/coveragestores/$ALMACEN/external.imagemosaic" >/dev/null || true
    done
    echo "Cosecha terminada."
fi

# ── 5. El recorte por huella, encendido ──────────────────────────────
#
# Sin esto el footprints.properties no sirve de nada: la huella se lee,
# pero no se aplica. Es el paso que la gente olvida y luego no entiende
# por que sigue viendo el blanco.
#
#   Transparent  - fuera de la huella, transparente. Lo que queremos.
#   Cut          - recorta pero rellena de negro.
#   None         - ignora la huella.
echo "Aplicando FootprintBehavior=Transparent..."
"${CURL[@]}" -XPUT -H 'Content-type: text/xml' -d \
"<coverage>
   <enabled>true</enabled>
   <parameters>
     <entry><string>FootprintBehavior</string><string>Transparent</string></entry>
   </parameters>
 </coverage>" \
    "$REST/workspaces/$WS/coveragestores/$ALMACEN/coverages/$CAPA.xml" >/dev/null

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
