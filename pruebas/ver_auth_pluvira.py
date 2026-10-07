# -*- coding: utf-8 -*-
"""Cómo valida el backend un token de PLUVIRA.

    docker compose exec -T web python manage.py shell < ver_auth_pluvira.py

SOLO LEE. No escribe, no migra, no manda nada.

PARA QUE. El boton «Notificar a la app» da 403. La web tiene sesion iniciada,
pero el token de PLUVIRA no sirve para escribir: «Las credenciales de PLUVIRA
solo permiten consultar datos». Ese rechazo lo da la capa de autenticacion
ANTES de llegar a la vista, asi que mandar la cabecera Authorization no
ayuda: la convierte en 401.

LA SALIDA, sin tocar esa regla ni inventar un secreto. El token viaja en una
cabecera con OTRO nombre -X-Pluvira-Token-, que la capa de autenticacion ni
mira, y la vista lo valida ella misma llamando a la misma funcion que ya
existe. Resultado: identidad de verdad, nada nuevo que guardar en sitio
alguno, y en el registro queda QUIEN mando cada aviso.

La alternativa era una clave compartida metida en el JavaScript de la web.
Ahi la lee cualquiera que abra el codigo fuente, y de todos los endpoints de
operations este es justo el unico que puede hacer dano: hace sonar catorce
telefonos. Un secreto publico que protege lo unico peligroso es el peor sitio
donde ponerlo.

Para escribir eso hace falta saber DOS cosas de auth_pluvira.py: con que
funcion se valida un token, y que devuelve. Nada mas.
"""

from __future__ import print_function

import io
import os
import re

from django.conf import settings

BASE = str(settings.BASE_DIR)

print("")
print("=" * 74)
print("1. DONDE ESTA")
print("=" * 74)

candidatos = []
for raiz, dirs, archivos in os.walk(BASE):
    dirs[:] = [d for d in dirs if d not in (".git", "__pycache__", "node_modules",
                                            "media", "static", "venv", ".venv")]
    for a in archivos:
        if a == "auth_pluvira.py" or (a.endswith(".py") and "pluvira" in a.lower()):
            candidatos.append(os.path.join(raiz, a))

if not candidatos:
    print("  No encontre ningun archivo con 'pluvira' en el nombre.")
    print("  Busco la frase del mensaje de error por todo el proyecto:")
    import subprocess
    try:
        r = subprocess.run(["grep", "-rln", "--include=*.py",
                            "solo permiten consultar", "."],
                           cwd=BASE, stdout=subprocess.PIPE, timeout=30)
        for l in (r.stdout.decode("utf-8", "replace").strip().splitlines() or
                  ["  (tampoco)"]):
            print("      {0}".format(l))
            if l.endswith(".py"):
                candidatos.append(os.path.join(BASE, l.lstrip("./")))
    except Exception as e:
        print("      no pude buscar: {0}".format(e))

for ruta in candidatos[:3]:
    print("")
    print("=" * 74)
    print("2. {0}".format(os.path.relpath(ruta, BASE)))
    print("=" * 74)
    try:
        txt = io.open(ruta, encoding="utf-8", errors="replace").read()
    except Exception as e:
        print("  no pude leerlo: {0}".format(e))
        continue

    print("  {0} lineas".format(txt.count("\n") + 1))
    print("")
    print("  Funciones y clases:")
    for m in re.finditer(r"^(?:async\s+)?(def|class)\s+(\w+)\s*\(([^)]*)\)", txt, re.M):
        print("      {0} {1}({2})".format(m.group(1), m.group(2),
                                          " ".join(m.group(3).split())[:80]))

    print("")
    print("  ── EL ARCHIVO ────────────────────────────────────────────────")
    for i, linea in enumerate(txt.splitlines(), 1):
        # Nunca se imprime algo con pinta de credencial.
        bajo = linea.lower()
        if any(k in bajo for k in ("password", "secret", "private_key",
                                   "api_key", "token =", "token=")) \
           and "=" in linea and len(linea.strip()) > 20 \
           and not linea.strip().startswith("#"):
            # Se enseña el nombre pero no el valor.
            izq = linea.split("=")[0]
            print("  {0:4d}| {1}= <valor omitido>".format(i, izq))
            continue
        print("  {0:4d}| {1}".format(i, linea[:150]))

print("")
print("=" * 74)
print("3. COMO ESTA CONECTADO")
print("=" * 74)
drf = getattr(settings, "REST_FRAMEWORK", {}) or {}
print("  DEFAULT_AUTHENTICATION_CLASSES:")
for c in (drf.get("DEFAULT_AUTHENTICATION_CLASSES") or ["(ninguna)"]):
    print("      {0}".format(c))
print("  DEFAULT_PERMISSION_CLASSES:")
for c in (drf.get("DEFAULT_PERMISSION_CLASSES") or ["(ninguna)"]):
    print("      {0}".format(c))

print("")
print("=" * 74)
print("4. ESTE USUARIO EXISTE Y TIENE TOKEN")
print("=" * 74)
try:
    from django.contrib.auth.models import User
    u = User.objects.filter(username="test_mobile_gerencia").first()
    if u is None:
        print("  'test_mobile_gerencia' no esta en ESTA base.")
        print("  Normal si los usuarios viven en PLUVIRA y aqui solo se validan.")
    else:
        print("  usuario : {0}  (id {1}, activo={2})".format(u.username, u.id, u.is_active))
        try:
            from rest_framework.authtoken.models import Token
            t = Token.objects.filter(user=u).first()
            print("  token local: {0}".format("si" if t else "no"))
        except Exception:
            print("  (no hay authtoken instalado)")
except Exception as e:
    print("  no pude mirar: {0}".format(e))

print("")
print("Nada se ha escrito.")
