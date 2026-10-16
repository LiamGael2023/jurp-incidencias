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
