#!/usr/bin/env bash
#
# Deja una ortofoto lista para servir. Esto importa MÁS que GeoServer.
#
# ══════════════════════════════════════════════════════════════════════
# POR QUÉ UNA ORTOFOTO "TAL CUAL" VA MAL, SIEMPRE
# ══════════════════════════════════════════════════════════════════════
#
# Un GeoTIFF de un vuelo sale organizado por filas y sin resúmenes. Para
# pintar el canal entero alejado, el servidor tiene que LEER LOS GIGAS
# ENTEROS y reducirlos al vuelo, cada vez, para cada persona.
#
# Con overviews -copias reducidas guardadas dentro del propio archivo- esa
# misma vista se lee de una copia de unos megas. La diferencia no es «va
# más rápido»: es entre 40 segundos y 200 ms, y entre un servidor que
# aguanta y uno que se cae cuando entran tres personas.
#
# El que se salta este paso culpa a GeoServer de ser lento. No lo es.
#
# ══════════════════════════════════════════════════════════════════════
# USO
# ══════════════════════════════════════════════════════════════════════
#
#   ./preparar_ortofoto.sh vuelo_canal.tif /var/www/geodatos/ortofoto.tif
#
# Necesita GDAL 3.1 o superior (por el driver COG):
#   sudo apt install -y gdal-bin && gdalinfo --version
#
# Tarda. Una ortofoto de 20 GB puede estar una hora. Lánzalo con `nohup`
# o dentro de `tmux` si entras por SSH: si se corta la sesión a mitad, se
# queda un archivo incompleto que parece bueno.

set -euo pipefail

ENTRADA="${1:-}"
SALIDA="${2:-}"

if [[ -z "$ENTRADA" || -z "$SALIDA" ]]; then
    echo "uso: $0 <ortofoto_original> <destino.tif>"
    exit 1
fi
if [[ ! -f "$ENTRADA" ]]; then
    echo "No existe: $ENTRADA"
    exit 1
fi
if ! command -v gdal_translate >/dev/null; then
    echo "Falta GDAL:  sudo apt install -y gdal-bin"
    exit 1
fi

echo "── Lo que hay ────────────────────────────────────────────────────"
gdalinfo "$ENTRADA" | head -25
echo ""

# EL SISTEMA DE COORDENADAS TIENE QUE ESTAR. Una ortofoto sin CRS se
# publica igual y aparece en el golfo de Guinea —latitud 0, longitud 0—,
# que es donde acaban todas las capas sin georreferenciar del mundo.
if ! gdalinfo "$ENTRADA" | grep -qiE 'PROJCRS|GEOGCRS|PROJCS|GEOGCS'; then
    echo "AVISO: no se le encuentra sistema de coordenadas."
    echo "Si sabes cuál es -el canal está en UTM 17 Sur, EPSG:32717-,"
    echo "asígnalo antes:"
    echo "    gdal_edit.py -a_srs EPSG:32717 \"$ENTRADA\""
    echo ""
    read -r -p "¿Seguir de todas formas? [s/N] " r
    [[ "${r,,}" == "s" ]] || exit 1
fi

mkdir -p "$(dirname "$SALIDA")"

echo "── Convirtiendo a COG con overviews ──────────────────────────────"
echo "   (esto es lo que tarda)"

# COMPRESIÓN: por qué JPEG y no DEFLATE.
#
# Una ortofoto es una FOTO: tiene ruido, y los algoritmos sin pérdida no
# lo comprimen. Con DEFLATE un vuelo de 20 GB baja a unos 15; con JPEG al
# 85% baja a 1,5 GB y la diferencia no se ve en pantalla. En un VPS donde
# el disco se paga, eso decide si la capa entra o no.
#
# YCBCR es el truco que hace que JPEG rinda de verdad en imagen RGB. Solo
# vale para 3 bandas: si la ortofoto trae canal alfa (4 bandas), esta
# línea falla y hay que quitar el alfa antes —abajo se detecta—.
BANDAS=$(gdalinfo "$ENTRADA" | grep -c '^Band ' || true)
echo "   bandas: $BANDAS"

ARGS=(-of COG
      -co COMPRESS=JPEG
      -co QUALITY=85
      -co BLOCKSIZE=512
      -co OVERVIEWS=IGNORE_EXISTING
      -co NUM_THREADS=ALL_CPUS
      -co BIGTIFF=YES)

if [[ "$BANDAS" -ge 3 ]]; then
    ARGS+=(-co PHOTOMETRIC=YCBCR)
fi
if [[ "$BANDAS" -eq 4 ]]; then
    echo "   4 bandas: se descarta el alfa para poder usar YCBCR."
    echo "   (si el alfa hace falta —bordes transparentes del vuelo—,"
    echo "    quita PHOTOMETRIC y usa -co COMPRESS=DEFLATE)"
    ARGS+=(-b 1 -b 2 -b 3)
fi

gdal_translate "$ENTRADA" "$SALIDA" "${ARGS[@]}"

echo ""
echo "── Comprobando ───────────────────────────────────────────────────"
# Un COG mal hecho se ve igual en gdalinfo. Esto lo valida de verdad.
if python3 -c "import rio_cogeo" 2>/dev/null; then
    python3 -m rio_cogeo validate "$SALIDA" || true
else
    echo "(para validarlo del todo: pip install rio-cogeo)"
fi

gdalinfo "$SALIDA" | grep -iE 'Overviews|Size is|Block|Compression' || true

echo ""
echo "── Tamaños ───────────────────────────────────────────────────────"
du -h "$ENTRADA" "$SALIDA"

echo ""
echo "Listo. Ahora, en GeoServer:"
echo "  Stores -> Add new store -> GeoTIFF"
echo "  URL:  file:///datos/rasters/$(basename "$SALIDA")"
echo ""
echo "Esa ruta es la de DENTRO del contenedor. En el disco está en"
echo "$SALIDA, montado como /datos/rasters por el docker-compose."
