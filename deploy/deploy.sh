#!/usr/bin/env bash
#
# Despliegue del front en el Linode nuevo. Lo corre un cron cada 2 minutos.
#
# Modelo "pull": el servidor consulta GitHub, no al revés. No hay llaves de
# despliegue en GitHub ni puertos abiertos; si GitHub no responde, no pasa nada.
#
# Si el build falla, el script aborta ANTES de mover el symlink, así que la
# versión que está publicada sigue intacta. Nunca se publica algo roto.

set -euo pipefail

BASE=/var/www/envs/front
REPO="$BASE/repo"
RELEASES="$BASE/releases"
CURRENT="$BASE/current"
RAMA=main
CONSERVAR=5          # cuántas versiones anteriores se guardan

# --forzar: construir y publicar aunque el repo ya esté al día.
#
# Hace falta porque este script decide si hay trabajo comparando HEAD con
# origin/main, y eso da un falso negativo en cuanto alguien hace `git pull` a
# mano en el repo: HEAD ya está al día, el script dice "sin cambios" y sale
# con 0 en silencio... mientras `current` sigue apuntando a la versión
# anterior. Pasó, y desde fuera es indistinguible de un despliegue correcto.
FORZAR=0
if [ "${1:-}" = "--forzar" ]; then
    FORZAR=1
fi

log() { echo "[$(date '+%F %T')] $*"; }

cd "$REPO"

git fetch --quiet origin "$RAMA"
LOCAL=$(git rev-parse HEAD)
REMOTO=$(git rev-parse "origin/$RAMA")

# Sin cambios: salir en silencio. Esto es lo que pasa el 99% de las veces,
# y por eso el cron no ensucia el log.
if [ "$LOCAL" = "$REMOTO" ] && [ "$FORZAR" -eq 0 ]; then
    exit 0
fi

if [ "$LOCAL" = "$REMOTO" ]; then
    log "forzado: el repo ya está en ${LOCAL:0:7}, se reconstruye igual"
fi

log "cambio detectado: ${LOCAL:0:7} -> ${REMOTO:0:7}"
git reset --hard --quiet "origin/$RAMA"

log "instalando dependencias"
npm ci --no-audit --no-fund

log "construyendo"
# El bundle es pesado; si el servidor tiene poca RAM y el build muere con
# "JavaScript heap out of memory", subir este número.
NODE_OPTIONS="--max-old-space-size=2048" npm run build

if [ ! -f dist/index.html ]; then
    log "ERROR: el build no generó dist/index.html, no se publica nada"
    exit 1
fi

NUEVA="$RELEASES/$(date +%Y%m%d_%H%M%S)_${REMOTO:0:7}"
mkdir -p "$NUEVA"
cp -r dist/. "$NUEVA/"

# Cambio atómico: el symlink se reemplaza de golpe, nadie ve un directorio
# a medio copiar.
ln -sfn "$NUEVA" "$CURRENT.tmp"
mv -Tf "$CURRENT.tmp" "$CURRENT"

log "publicado $NUEVA"

# Limpieza de versiones viejas.
ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +$((CONSERVAR + 1)) | xargs -r rm -rf

log "listo"
