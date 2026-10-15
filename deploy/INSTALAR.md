# Instalación del front en el Linode nuevo

Se corre **una sola vez**, en `webadmin@jurp-new-2026-server` (192.81.132.87).
Después de esto, cada `git push` a `main` queda publicado en el servidor en
menos de dos minutos, sin tocar nada.

Vercel puede seguir corriendo en paralelo durante todo el proceso. No hay corte.

---

## 1. Node

Vite 8 y React 19 necesitan Node 20 o superior; el de los repos de Ubuntu es
más viejo. Se instala desde NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v
```

Debe reportar `v22.x`.

## 2. Carpetas y clon

```bash
sudo mkdir -p /var/www/envs/front
sudo chown -R webadmin:webadmin /var/www/envs/front
mkdir -p /var/www/envs/front/releases
git clone https://github.com/LiamGael2023/jurp-incidencias /var/www/envs/front/repo
chmod +x /var/www/envs/front/repo/deploy/deploy.sh
```

## 3. Primer despliegue a mano

Se fuerza porque el script sale sin hacer nada cuando no detecta cambios:

```bash
cd /var/www/envs/front/repo && git reset --hard HEAD~1 --quiet
/var/www/envs/front/repo/deploy/deploy.sh
```

Debe terminar en `publicado ...` y `listo`. Comprueba que el symlink quedó:

```bash
ls -la /var/www/envs/front/current && ls /var/www/envs/front/current/
```

Tiene que verse `index.html` y la carpeta `assets/`.

## 4. nginx

```bash
sudo cp /var/www/envs/front/repo/deploy/nginx-front.conf /etc/nginx/sites-available/jurp-front
sudo ln -sf /etc/nginx/sites-available/jurp-front /etc/nginx/sites-enabled/jurp-front
sudo nginx -t && sudo systemctl reload nginx
```

nginx necesita poder atravesar las carpetas hasta el `dist/`:

```bash
chmod o+x /var/www/envs/front /var/www/envs/front/releases
```

Prueba:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://nexhydro.192.81.132.87.nip.io/
```

Un **200** y ya está sirviendo.

## 5. Certificado

```bash
sudo certbot --nginx -d nexhydro.192.81.132.87.nip.io
```

## 6. Despliegue automático

```bash
(crontab -l 2>/dev/null; echo "*/2 * * * * /var/www/envs/front/repo/deploy/deploy.sh >> /var/www/envs/front/deploy.log 2>&1") | crontab -
crontab -l
```

A partir de aquí, cualquier push a `main` se publica solo. Para ver qué pasó:

```bash
tail -20 /var/www/envs/front/deploy.log
```

---

## Cuando se migre el Linode viejo

El dominio definitivo es `nexhydro.jriegopresurizado.org.pe`. Créalo en tu panel
de DNS apuntando a `192.81.132.87`, agrégalo al `server_name` de
`nginx-front.conf` junto al de nip.io, y pide el certificado para los dos:

```bash
sudo certbot --nginx -d nexhydro.192.81.132.87.nip.io -d nexhydro.jriegopresurizado.org.pe
```

Conviene dejar los dos nombres activos un tiempo: quien tenga guardado el de
nip.io sigue entrando mientras el nuevo propaga. Después se puede quitar el de
nip.io del `server_name`.

Ahí ya puedes apagar el proyecto en Vercel.

## Volver a una versión anterior

Las últimas cinco quedan guardadas:

```bash
ls -1dt /var/www/envs/front/releases/*/
ln -sfn /var/www/envs/front/releases/LA_QUE_QUIERAS /var/www/envs/front/current.tmp
mv -Tf /var/www/envs/front/current.tmp /var/www/envs/front/current
```

El cron volverá a publicar `main` en cuanto detecte un commit nuevo, así que
esto es un parche temporal: para revertir de verdad, se revierte en git.
