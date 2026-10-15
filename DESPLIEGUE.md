# Despliegue

Dónde vive cada dirección de este front, y qué hay que tocar el día que el
backend cambie de sitio.

## El host del backend sale del entorno

Está en un solo sitio, `src/api.js`:

```js
const BASE = import.meta.env.VITE_API_BASE || 'https://api.192.81.132.87.nip.io';
```

`VITE_API_BASE` se define en **Vercel → Settings → Environment Variables**.
El valor por defecto es el que vale hoy, para que un clon recién bajado
funcione sin configurar nada.

**Vite lo resuelve al compilar, no al arrancar.** Cambiar la variable en
Vercel no basta: hay que redesplegar (el botón *Redeploy*). No se comporta
como una variable del servidor, que se lee en cada arranque.

De ahí salen tres cosas, y conviene usar la que toca:

| | para qué |
|---|---|
| `API_BASE` | el host a secas: imágenes, PDF, lo que cuelga de la raíz |
| `API_OPS`  | casi todo: incidencias, partes, maquinaria, proyectos |
| `MEDIA`    | fotos y archivos subidos |

Hoy son el mismo valor. Están separadas para que el día que las imágenes se
sirvan de otro sitio se cambie una línea y no veinte llamadas.

## `vercel.json` hay que cambiarlo a mano

Es el **único** sitio del front donde queda un host escrito. Los *rewrites*
se resuelven en el borde de Vercel, antes de que exista nada del código, así
que `VITE_API_BASE` no llega hasta ahí.

Y no admite comentarios: Vercel valida el fichero contra un esquema y
rechaza cualquier clave que no conozca —un `$comment` tumbó un despliegue
entero, con el error `should NOT have additional property`—. Por eso estas
notas están en este archivo y no dentro del JSON.

Para comprobarlo antes de empujar:

```
node pruebas/comprobar_vercel_json.mjs
```

### Pendiente: `/api/` va por HTTP

```json
{ "source": "/api/(.*)", "destination": "http://sistema.jriegopresurizado.org.pe/api/$1" }
```

Lo que pasa por ahí —incluidos los tokens de sesión de PLUVIRA— **viaja en
claro** entre Vercel y ese servidor. Hay que pasarlo a `https://` en cuanto
ese host lo sirva. No se ha cambiado todavía porque, si aún no tiene HTTPS,
el cambio deja la app sin datos.

## Lo que la migración de servidor no cambia sola

Dos hosts viven en el backend, no aquí, y salieron del `.env` que se copió
tal cual del servidor viejo. Ninguno de los dos se nota probando la web:

- **`URL_PUBLICA` / `ALLOWED_HOSTS`** — de ahí sale la dirección de la imagen
  que viaja en la notificación. Si apunta al servidor viejo, el aviso llega
  igual y la imagen da 404 *en el teléfono del vigilante*.
- **`MAPA_NOTIFY_HOSTS`** — la lista de sitios de los que se acepta una
  imagen para notificar. Si el host nuevo no está, publicar un aviso del
  mapa se **rechaza**.

```
cd /root/proyectos/api_vigilantes
curl -sO https://raw.githubusercontent.com/LiamGael2023/jurp-incidencias/main/pruebas/ver_hosts_servidor.py
docker compose exec web python manage.py shell < ver_hosts_servidor.py
```

No toca nada: dice cuál de los dos está mal y con qué línea arreglarlo.
