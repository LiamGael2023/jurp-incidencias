# Equipo enlazado: una cuenta, un celular

Para que prestar la clave no sirva. La cuenta queda atada al teléfono desde
el que se entró la primera vez; desde otro, el login se rechaza aunque el
usuario y la contraseña sean correctos.

Esto **disuade, no blinda**. Una app modificada puede falsear su
identificador. Frena el préstamo de claves entre compañeros, que es el
problema real; no frena a alguien decidido.

---

## El orden en que se enciende

No es un detalle de despliegue: hecho al revés deja fuera a la gente de
campo, que es justo la que no puede quedarse fuera.

1. **Publicar la app** que manda `device_id`. Hasta aquí nada cambia: el
   servidor acepta igual a quien no lo mande.
2. **Esperar** a que las instalaciones estén en esa versión. El panel enseña
   cuántos usuarios siguen entrando sin identificar; cuando ese número llega
   a cero, ya es seguro.
3. **Encender el interruptor** (`EXIGIR_DISPOSITIVO = True`) y, si se
   quiere, invalidar todos los tokens para que todos vuelvan a entrar y
   queden enlazados de una vez.

El paso 3 es una decisión que se toma un día concreto, no algo que ocurra
solo al desplegar. Por eso es un ajuste y no una constante en el código.

---

## Qué manda la app al entrar

`POST /api/v1/mobile/auth/login/`

```json
{
  "username": "jperez",
  "password": "...",
  "device_id": "a1b2c3d4e5f6a7b8",
  "plataforma": "android",
  "equipo": "Samsung SM-A135M"
}
```

| campo        | quién lo manda        | para qué                                    |
|--------------|-----------------------|---------------------------------------------|
| `device_id`  | solo las apps         | la clave del enlace                         |
| `plataforma` | apps y web            | `android`, `ios` o `web`                    |
| `equipo`     | solo las apps         | el nombre que se ve en el panel             |

De dónde sale `device_id` en Flutter (`device_info_plus`):

- Android — `androidInfo.id`
- iOS — `iosInfo.identifierForVendor`

Ninguno de los dos es eterno: el de Android se reinicia al restaurar de
fábrica, y el de iOS se borra si se desinstalan todas las apps del
fabricante. **Por eso el panel de liberación no es un extra: es parte de que
esto funcione.**

## El navegador va exento, y no es un detalle

La web manda `plataforma: "web"` y ningún `device_id`: un navegador no tiene
un identificador que valga la pena enlazar. El servidor la deja pasar sin
enlazarla **y sin contarla**.

Sin esa exención pasan dos cosas, las dos malas:

- `sin_identificar` no llega a cero nunca, porque la web siempre va a entrar
  sin `device_id`. Y ese número es el que decide cuándo se puede encender el
  bloqueo, así que nunca se encendería.
- El día que se encendiera de todas formas, **la web dejaría de entrar para
  todos de golpe**.

La exención es por un `"web"` explícito, nunca por la ausencia de
`plataforma`. Si la ausencia contara, la app vieja —que tampoco la manda—
quedaría exenta también y el bloqueo no mordería a nadie: la medida entera se
queda en nada sin que salte ningún error.

Lo que se paga: una app modificada que mande `plataforma: "web"` se salta el
enlace. Es el mismo nivel que falsear el `device_id` —esto disuade, no
blinda— y es el precio de que la web siga entrando. Se puede vigilar: en el
panel, un usuario de campo entrando como `web` se ve.

**Son dos mitades y hacen falta las dos.** El servidor exime a quien dice
`web`; la web tiene que decirlo (`src/Login.jsx`). Si una cambia sin la otra,
esto se rompe en silencio y no se nota hasta el día del encendido. Por eso
`pruebas/parche_equipo.prueba.py` mira los dos ficheros.

Para la web la regla es otra —una sesión a la vez— y se trata aparte.

## Qué responde

**Entra** — igual que hoy, con su `token` y su `user`. Si era su primer
ingreso, el equipo queda enlazado.

**Equipo distinto** — `403`:

```json
{
  "detail": "Esta cuenta está enlazada a otro equipo.",
  "codigo": "equipo_distinto",
  "equipo_enlazado": "Samsung SM-A135M",
  "desde": "2026-10-23T09:14:02Z"
}
```

El `codigo` existe para que la app pueda enseñar su propia pantalla en vez
de un texto suelto: *«Tu cuenta está enlazada a otro celular. Pide a
administración que la libere.»*

**Sin `device_id` y con el interruptor encendido** — `403` con
`codigo: "falta_device_id"`. Es el caso de una app vieja: el mensaje tiene
que mandar a actualizar, no a soporte.

---

## El panel

`GET /api/v1/mobile/auth/dispositivos/`

Solo para administradores. Admite `?q=` para buscar por usuario o equipo y
`?estado=activos|liberados|todos`.

```json
{
  "sin_identificar": 12,
  "resultados": [
    {
      "id": 7,
      "usuario": "jperez",
      "nombre_usuario": "Juan Pérez",
      "equipo": "Samsung SM-A135M",
      "plataforma": "android",
      "device_id": "a1b2…a7b8",
      "desde": "2026-10-23T09:14:02Z",
      "ultimo_uso": "2026-10-23T17:40:11Z",
      "activo": true,
      "liberado_por": null,
      "liberado_en": null
    }
  ]
}
```

`sin_identificar` es cuántos usuarios entraron sin mandar `device_id` **desde
una app** —los que entran por el navegador no cuentan—. Es el número que hay
que ver en cero antes de encender el interruptor.

`device_id` va recortado a propósito: en el panel sirve para distinguir dos
equipos, y completo es un dato que no hace falta enseñar.

`POST /api/v1/mobile/auth/dispositivos/<id>/liberar/`

Marca el enlace como liberado y **firma quién lo hizo y cuándo**. No se
borra la fila: se desactiva. El historial es lo que permite responder
«¿quién liberó esta cuenta tres veces este mes?», que es la pregunta que
aparece en cuanto esto lleva un tiempo andando.

El siguiente ingreso de ese usuario enlaza el equipo nuevo.

---

## Lo que queda apuntado

Una fila por enlace, no un campo en el usuario. Un campo solo sabe dónde
está ahora; la tabla sabe por dónde pasó, y eso es lo que se necesita cuando
alguien dice «me liberaron y sigo sin poder entrar».

| campo                     | para qué                                  |
|---------------------------|-------------------------------------------|
| `usuario`                 | de quién es                               |
| `device_id`               | el identificador del equipo               |
| `equipo`, `plataforma`    | para reconocerlo en el panel              |
| `creado`, `ultimo_uso`    | desde cuándo y hasta cuándo se usó        |
| `activo`                  | si es el enlace vigente                   |
| `liberado_por`, `liberado_en` | la firma de quién lo soltó            |

Un solo enlace `activo` por usuario. Los anteriores quedan como historial.
