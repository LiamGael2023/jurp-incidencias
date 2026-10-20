# Archivos para el backend de vigilantes

Esto NO es parte del front. Viaja en este repo solo porque es el canal que ya
está montado entre esta máquina y el servidor: el cron de despliegue hace
`git pull` cada dos minutos, así que dejar aquí un archivo es la forma más
corta de hacerlo llegar sin scp ni pegar nada por consola.

El proyecto de vigilantes (`/var/www/envs/vigilantes`) no está versionado.

## sync_incidencias_pluvira.py

Mantiene `operations.IncidentReport` al día con las incidencias de PLUVIRA,
forzando el pk para que los partes, materiales y personal sigan colgando de
la incidencia correcta. Sustituye el paso de teclear el id a mano.

Instalación, en el servidor:

```bash
mkdir -p /var/www/envs/vigilantes/operations/management/commands
touch /var/www/envs/vigilantes/operations/management/__init__.py \
      /var/www/envs/vigilantes/operations/management/commands/__init__.py
cp /var/www/envs/front/repo/deploy/backend-vigilantes/sync_incidencias_pluvira.py \
   /var/www/envs/vigilantes/operations/management/commands/
```

Prueba sin escribir nada:

```bash
docker exec django_api python manage.py sync_incidencias_pluvira --token <TOKEN> --dry-run
```

Cron, cada cinco minutos:

```
*/5 * * * * cd /var/www/envs/vigilantes && /usr/bin/docker compose exec -T web python manage.py sync_incidencias_pluvira --token <TOKEN> >> /home/webadmin/sync_incidencias.log 2>&1
```

EL DÍA DEL CORTE: añadir `--base http://127.0.0.1:8003` o, mejor, dejar de
apuntar al servidor viejo y usar el dominio definitivo.

## vigilar_estaciones.py

Avisa por push cuando una estación deja de reportar, y cuando vuelve. Nació de
que LUZMILA estuvo nueve días caída sin que nadie se enterara.

Instalación igual que el anterior:

```bash
cp /var/www/envs/front/repo/deploy/backend-vigilantes/vigilar_estaciones.py \
   /var/www/envs/vigilantes/operations/management/commands/
touch /var/www/envs/vigilantes/estado_estaciones.json
sudo chown 33:33 /var/www/envs/vigilantes/estado_estaciones.json
```

Ese archivo guarda qué estaciones están caídas, para avisar una sola vez por
caída y no en cada pasada. Tiene que pertenecer al usuario del contenedor (33).

Prueba, sin mandar nada:

```bash
docker exec django_api python manage.py vigilar_estaciones --token <TOKEN> --dry-run
```

Cron, cada veinte minutos:

```
*/20 * * * * cd /var/www/envs/vigilantes && /usr/bin/docker compose exec -T web python manage.py vigilar_estaciones --token <TOKEN> >> /home/webadmin/vigilar_estaciones.log 2>&1
```

Por defecto avisa a `supervisor_group` y considera caída una estación con más
de 6 horas de silencio. Ambas cosas se cambian con `--usuarios` y `--horas`.

## pronostico_lluvia.py

Avisa por push cuando el pronóstico (Open-Meteo) prevé lluvia de nivel
amarillo, naranja o rojo en alguna estación dentro de las próximas horas. Usa
los mismos umbrales que el mapa, pasados a mm/h (0.84 / 2.52 / 4.24), y avisa
una sola vez por estación, día y nivel: solo repite si el nivel sube.

Instalación:

```bash
cp /var/www/envs/front/repo/deploy/backend-vigilantes/pronostico_lluvia.py \
   /var/www/envs/vigilantes/operations/management/commands/
touch /var/www/envs/vigilantes/estado_pronostico.json
mkdir -p /var/www/envs/vigilantes/archivo_pronostico
sudo chown 33:33 /var/www/envs/vigilantes/estado_pronostico.json \
                 /var/www/envs/vigilantes/archivo_pronostico
```

### El archivo de corridas

Cada pasada guarda en `archivo_pronostico/AAAA-MM.ndjson` lo que el modelo
predijo, con alerta o sin ella: una línea por estación y alcance (1, 6, 12, 24
y 48 horas), con los milímetros, la probabilidad y **la altura de la celda del
modelo**, que casi nunca es la del pluviómetro y es lo que explica la mayor
parte del error en lluvia orográfica.

Esto no se puede recuperar después. La consulta de hoy, mañana devuelve otra
cosa: un pronóstico que no se archivó no se puede evaluar nunca más, y sin
evaluarlo no hay forma de corregirlo por estación. Por eso se archiva aunque
todavía no se vaya a usar.

Ocupa poco —unas 145 líneas por pasada, del orden de 10 MB al mes— porque se
guardan cinco alcances y no las 48 horas enteras. Si hiciera falta recortar,
se comprimen los meses viejos; borrarlos es tirar la única medición que existe
de cuánto se equivoca el modelo en este valle.

Necesita salida a internet desde el contenedor (`api.open-meteo.com`), igual
que la consulta a InnovaWeather.

Prueba, sin mandar nada:

```bash
docker exec django_api python manage.py pronostico_lluvia --token <TOKEN> --dry-run
```

Cron, cada hora (los modelos se actualizan cada pocas horas; más seguido no
aporta):

```
15 * * * * cd /var/www/envs/vigilantes && /usr/bin/docker compose exec -T web python manage.py pronostico_lluvia --token <TOKEN> >> /home/webadmin/pronostico_lluvia.log 2>&1
```

Por defecto mira 48 horas, cuenta solo horas con probabilidad >= 40 % y avisa a
`supervisor_group`. Se cambia con `--horas`, `--prob` y `--usuarios`.
