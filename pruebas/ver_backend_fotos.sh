#!/usr/bin/env bash
#
# Qué hace falta saber para añadir el almacén de fotos del inventario.
#
# No toca nada: solo mira y escribe. Se ejecuta en el servidor nuevo.
#
#   bash ver_backend_fotos.sh
#
# POR QUÉ ANTES DE PARCHEAR. Un parche de backend a ciegas puede dejar el
# contenedor sin arrancar, y este sirve también a SENTRIA y al inventario
# entero. Diez segundos de mirar valen más que una tarde de restaurar.

RAIZ=${1:-/var/www/envs/vigilantes}
cd "$RAIZ" 2>/dev/null || { echo "No existe $RAIZ"; exit 1; }

echo "════════ 1. DÓNDE VIVEN LAS RUTAS DEL INVENTARIO ════════"
# El endpoint que sí funciona sirve de rastro: donde se declara
# campos-evaluables está el urls.py que hay que tocar.
grep -rln "campos-evaluables" --include='*.py' . 2>/dev/null | head -5
echo "--- y el router / las rutas declaradas ahí ---"
grep -rn "campos-evaluables\|evaluaciones\|campanias" --include='*.py' . 2>/dev/null \
  | grep -i "path(\|url(\|register(" | head -15

echo
echo "════════ 2. QUÉ ARCHIVOS TIENE ESA APP ════════"
APP=$(grep -rln "campos-evaluables" --include='*.py' . 2>/dev/null | head -1 | xargs -r dirname)
echo "App: ${APP:-no encontrada}"
[ -n "$APP" ] && ls -la "$APP" | head -25

echo
echo "════════ 3. EL MODELO DE EVALUACIÓN ════════"
# La foto se cuelga del mismo par (tipo_activo, activo_fid) que la
# evaluación, así que su modelo es el molde a seguir.
grep -rn "class .*Evaluacion.*(models.Model)" --include='*.py' . 2>/dev/null | head -3
grep -rn "tipo_activo\s*=\|activo_fid\s*=" --include='*.py' . 2>/dev/null | head -6

echo
echo "════════ 4. MEDIA: ¿HAY DÓNDE GUARDAR? ════════"
grep -rn "MEDIA_ROOT\|MEDIA_URL\|DEFAULT_FILE_STORAGE" --include='*.py' . 2>/dev/null | head -8
echo "--- ¿y en el .env? ---"
grep -n "MEDIA" .env 2>/dev/null | head -5

echo
echo "════════ 5. PILLOW (lo exige ImageField) ════════"
docker compose exec -T web python -c \
  "import PIL, django; print('Pillow', PIL.__version__, '· Django', django.get_version())" \
  2>&1 | tail -2

echo
echo "════════ 6. NGINX: ¿SIRVE /media/? ════════"
grep -rn "media" /etc/nginx/sites-available/* 2>/dev/null | head -8 \
  || echo "(sin acceso a /etc/nginx o sin reglas de media)"

echo
echo "════════ 7. VOLÚMENES DEL CONTENEDOR ════════"
# Si el media no está en un volumen, las fotos se borran en cada
# despliegue. Es el fallo que no se ve hasta el segundo despliegue.
grep -n "volumes:" -A 8 docker-compose.yml 2>/dev/null | head -20

echo
echo "════════ 8. RUTAS QUE YA RESPONDEN ════════"
for r in campanias capas evaluaciones campos-evaluables fotos activos-nuevos reportes; do
  printf '  %-18s ' "$r"
  curl -s -o /dev/null -w '%{http_code}\n' \
    "https://nexhydro.jriegopresurizado.org.pe/vigapi/inventario/$r/"
done
