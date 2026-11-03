# -*- coding: utf-8 -*-
"""
Genera los iconos de la app a partir del logo de INVENTARIO.

    python3 herramientas/iconos.py           # escribe en android/ e ios/
    python3 herramientas/iconos.py --salida /tmp/iconos

Necesita Pillow (`pip install pillow`). Si no está, no pasa nada: los iconos
ya generados están en el repositorio del front y se copian a mano. Esto es
para cuando cambie el logo.

POR QUÉ NO flutter_launcher_icons. Haría lo mismo con una dependencia menos
que mantener... pero no la capa monocroma con huecos, que es la que hace que
el icono temático de Android 13 siga pareciendo el nuestro. Y añadir un
paquete al pubspec para generar cuatro ficheros que no cambian nunca es
pagar en cada `pub get` algo que se usa una vez al año.
"""

import argparse
import os

from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
PROYECTO = os.path.dirname(AQUI)
LOGO = os.path.join(PROYECTO, 'assets/img/logo-inventario-min.png')

# Icono clásico: ocupa casi todo el cuadro, sobre blanco. Blanco y no verde
# porque la gota es verde y sobre verde no se ve.
CLASICO = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}

# Adaptativo: el sistema recorta el primer plano con la forma que use el
# lanzador —círculo, cuadrado redondeado, gota— y solo garantiza los 66 dp
# centrales de los 108. De ahí el 58 %: más grande, y en un lanzador con
# máscara circular la gota sale con la punta cortada.
ADAPT = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}

# Los nombres son los de la plantilla de Flutter, para que el Contents.json
# que ya está en el proyecto siga valiendo sin tocarlo.
IOS = {
    'Icon-App-20x20@1x.png': 20, 'Icon-App-20x20@2x.png': 40,
    'Icon-App-20x20@3x.png': 60, 'Icon-App-29x29@1x.png': 29,
    'Icon-App-29x29@2x.png': 58, 'Icon-App-29x29@3x.png': 87,
    'Icon-App-40x40@1x.png': 40, 'Icon-App-40x40@2x.png': 80,
    'Icon-App-40x40@3x.png': 120, 'Icon-App-60x60@2x.png': 120,
    'Icon-App-60x60@3x.png': 180, 'Icon-App-76x76@1x.png': 76,
    'Icon-App-76x76@2x.png': 152, 'Icon-App-83.5x83.5@2x.png': 167,
    'Icon-App-1024x1024@1x.png': 1024,
}

ADAPTATIVO_XML = '''<?xml version="1.0" encoding="utf-8"?>
<!-- Icono adaptativo: el sistema recorta estas capas con la forma que use
     el lanzador. El fondo es blanco porque la gota es verde, y verde sobre
     verde no se ve. La capa monochrome es para los iconos tematicos de
     Android 13, que se tiñen con el color del fondo de pantalla. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
'''

COLOR_XML = '''<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#FFFFFF</color>
</resources>
'''


def centrado(logo, tam, escala, fondo):
    """El logo centrado en un cuadrado de `tam`, ocupando `escala` de el."""
    lienzo = Image.new('RGBA', (tam, tam), fondo)
    lado = round(tam * escala)
    pequeno = logo.resize((lado, lado), Image.LANCZOS)
    lienzo.paste(pequeno, ((tam - lado) // 2, (tam - lado) // 2), pequeno)
    return lienzo


def silueta(fuente):
    """Alfa de la gota MENOS las partes blancas.

    La capa monocroma solo conserva la forma: el sistema la tiñe entera con
    un color del fondo de pantalla. Con el alfa tal cual, el portapapeles y
    el visto -que son blancos DENTRO de la gota- desaparecen y queda una
    gota lisa, indistinguible de la de cualquier otra app de agua.
    Volviendolos transparentes se convierten en huecos y el dibujo se
    reconoce igual que en color.
    """
    px = fuente.load()
    ancho, alto = fuente.size
    salida = Image.new('L', fuente.size, 0)
    sp = salida.load()
    for y in range(alto):
        for x in range(ancho):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            blancura = (min(r, g, b) / 255.0) ** 2
            sp[x, y] = int(a * (1 - blancura))
    return salida


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--salida', default=PROYECTO,
                   help='raiz donde escribir android/ e ios/')
    args = p.parse_args()

    logo = Image.open(LOGO).convert('RGBA')
    res = os.path.join(args.salida, 'android/app/src/main/res')

    for dpi, tam in CLASICO.items():
        d = os.path.join(res, 'mipmap-' + dpi)
        os.makedirs(d, exist_ok=True)
        icono = centrado(logo, tam, 0.80, (255, 255, 255, 255)).convert('RGB')
        icono.save(os.path.join(d, 'ic_launcher.png'))
        icono.save(os.path.join(d, 'ic_launcher_round.png'))

    for dpi, tam in ADAPT.items():
        d = os.path.join(res, 'mipmap-' + dpi)
        os.makedirs(d, exist_ok=True)
        frente = centrado(logo, tam, 0.58, (0, 0, 0, 0))
        frente.save(os.path.join(d, 'ic_launcher_foreground.png'))
        negro = Image.new('RGBA', frente.size, (0, 0, 0, 255))
        negro.putalpha(silueta(frente))
        negro.save(os.path.join(d, 'ic_launcher_monochrome.png'))

    d = os.path.join(res, 'mipmap-anydpi-v26')
    os.makedirs(d, exist_ok=True)
    for nombre in ('ic_launcher.xml', 'ic_launcher_round.xml'):
        with open(os.path.join(d, nombre), 'w') as f:
            f.write(ADAPTATIVO_XML)

    d = os.path.join(res, 'values')
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, 'ic_launcher_background.xml'), 'w') as f:
        f.write(COLOR_XML)

    # iOS no admite transparencia en el icono: lo que quede detras se ve negro.
    d = os.path.join(args.salida,
                     'ios/Runner/Assets.xcassets/AppIcon.appiconset')
    os.makedirs(d, exist_ok=True)
    for nombre, tam in IOS.items():
        centrado(logo, tam, 0.80, (255, 255, 255, 255)).convert('RGB') \
            .save(os.path.join(d, nombre))

    print('Iconos generados en ' + args.salida)


if __name__ == '__main__':
    main()
