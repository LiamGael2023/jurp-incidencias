# Inventario JURP — app de campo

App Flutter para levantar el inventario de infraestructura de riego: ver las
estructuras en el mapa, evaluarlas con la ficha del ANA y sacar los formatos.

## Antes que nada: esto no se ha ejecutado nunca

El código se escribió en un entorno sin SDK de Flutter y sin acceso a
pub.dev, así que **no está compilado ni probado**. El primer `flutter run`
va a sacar errores; son de esperar y se arreglan en una pasada. Lo que sí
está cuidado es que las versiones de las librerías son **las mismas que usa
PLUVIRA**, que ya compila y ya corre en los teléfonos de la Junta.

## Arrancar

Las carpetas `android/` e `ios/` no están en el repositorio: las genera
Flutter, dependen de su versión y escribirlas a mano envejece mal.

```bash
cd app_inventario

# Genera android/ e ios/ sin tocar lib/ ni assets/.
flutter create --org pe.org.jriegopresurizado \
               --project-name inventario_jurp \
               --platforms=android,ios .

# Si el comando reescribió el pubspec, recupéralo:
git checkout pubspec.yaml

flutter pub get
flutter run
```

## Permisos que hay que añadir a mano

`flutter create` no los pone. Sin ellos la app arranca pero la cámara y el
GPS fallan en silencio, que es lo peor que puede pasar en campo.

**`android/app/src/main/AndroidManifest.xml`**, dentro de `<manifest>` y
antes de `<application>`:

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
<uses-permission android:name="android.permission.CAMERA"/>
<!-- Android 13 en adelante, para elegir de la galería -->
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES"/>
```

**`ios/Runner/Info.plist`**:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Para ubicarte en el mapa junto a la estructura que vas a evaluar.</string>
<key>NSCameraUsageDescription</key>
<string>Para tomar la evidencia fotográfica de cada estructura.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>Para adjuntar fotos que ya tengas tomadas.</string>
```

## Cómo está organizado

```
lib/
  main.dart                     arranque: sesión guardada → mapa, si no login
  src/
    models/modelos.dart         lo que viaja entre servidor y pantalla
    services/
      auth_service.dart         login contra el padrón de riego
      inventario_service.dart   /vigapi/inventario: capas, campañas, fichas
      pendientes_service.dart   la bandeja de lo evaluado sin señal
    controllers/
      inventario_controller.dart  campaña, capas encendidas, evaluaciones
    views/pages/                login, mapa, ficha, evaluación, reportes
    views/widgets/panel_capas.dart
    utils/                      colores, tema, catálogo de capas, croquis
assets/
  croquis/                      13 láminas de las fichas de inspección
  img/                          el logo
```

## Decisiones que conviene no deshacer sin pensarlo

**Es el mismo backend que la web.** `/vigapi/inventario`, las mismas rutas.
No hay una API «de móvil» aparte, y es lo que se quiere: el día que cambie
un campo cambia para los dos a la vez y no hay forma de que uno se quede
atrás sin que nadie lo note.

**El formulario no está escrito en la app.** Los campos los devuelve
`/campos-evaluables/?tipo_activo=…`. Añadir un campo en la base lo hace
aparecer en el teléfono sin publicar una versión en la tienda: un cambio de
una tarde en vez de dos semanas esperando revisión.

**El catálogo de capas sí está en la app** (`utils/catalogo_capas.dart`).
Son los colores y la agrupación con los que la Junta lee sus propios planos:
eso es una decisión de cartografía, no un dato. Una capa nueva en el backend
aparece en `/capas/` con su total, pero no se dibuja hasta que entre ahí.

Son 40, las mismas que el visor web menos la red vial nacional, que no entra
aquí por lo que dice el comentario de su grupo. Cuando se toque una, hay que
tocar las dos: para comprobar que no se han separado,

```bash
python3 herramientas/comparar_capas.py
```

compara código, etiqueta, color y geometría contra `src/InventarioGIS.jsx` y
no devuelve 0 si discrepan.

Las marcadas `pesada: true` se listan pero arrancan **apagadas**. Hoy solo
los cauces de quebrada: once mil líneas que en el escritorio son un
parpadeo y en un teléfono en Chao son datos del inspector y medio minuto
mirando un mapa vacío.

**Un alta no entra en el inventario.** Lo que se registra en campo queda
«pendiente» hasta que alguien lo aprueba desde el visor web. Un apunte de
campo no puede volverse dato oficial sin que nadie lo mire, porque el
inventario es lo que la Junta reporta al ANA.

El punto sale del GPS y no de tocar el mapa, al revés que en la web: allí
se marca sobre la ortofoto porque se está mirando dónde debería ir; aquí el
inspector está delante de la obra, y el sitio lo sabe mejor el teléfono que
su dedo sobre una pantalla a pleno sol. La coordenada viaja en UTM
(`SRID=32717;POINT(…)`), que es como está la capa; la conversión está en
`utils/utm.dart` y se comprueba contra PROJ —la biblioteca de PostGIS— con

```bash
python3 herramientas/comparar_utm.py
```

Todavía **sin foto**: el almacén cuelga de una estructura que ya existe
(`tipo_activo` + `fid`) y un alta aún no tiene fid. Antes que inventar una
ruta que el servidor no tiene, el alta se guarda sin foto y las fotos se
añaden cuando se apruebe.

**La bandeja de pendientes no miente.** Una ficha sin subir NO está
guardada, y la app lo dice con todas sus letras —en el aviso al guardar, en
el contador rojo de la barra y en su propia pantalla—. El peor resultado
posible de una cola de pendientes es que el inspector crea que ya subió y
borre sus fotos.

**Lo que el servidor rechaza no va a la bandeja.** Si contestó «altura: este
campo es obligatorio», reintentarlo para siempre fallaría igual cada vez y
sin que nadie viera el motivo. Solo espera a la cobertura lo que ni siquiera
llegó a salir del teléfono.

**Las fotos se reducen a 1600 px antes de subir.** Son 3-5 MB cada una del
sensor del teléfono; tres por estructura y unas mil estructuras son diez
gigas en el servidor para mirarlas en un recuadro. Y con la cobertura que
hay en Chao, de cinco megas a trescientos kilobytes va de «no sube» a
«sube».

## Lo que todavía no hace

- **Evaluar sin señal del todo.** La ficha se guarda en la bandeja, pero el
  catálogo de campos y la campaña se piden al servidor: si nunca se abrió
  esa estructura con cobertura, no hay formulario que llenar. Guardar el
  catálogo en el teléfono es el siguiente paso natural.
- **Teselas del mapa sin señal.** Las capas sí se guardan y el mapa dibuja
  las geometrías sin cobertura, pero el fondo de satélite se queda en gris.
- **Dar de alta estructuras nuevas.** El backend ya tiene
  `/activos-nuevos/`; la app todavía no lo usa.
