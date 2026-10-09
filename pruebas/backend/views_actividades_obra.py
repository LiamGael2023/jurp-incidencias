# -*- coding: utf-8 -*-
"""Actividades de obra: lista, ficha y cierre.

Calcado de lo que ya hace Incidentes, con un proyecto arriba en vez de un
incidente. No se inventa nada nuevo: los partes, el personal y los materiales
son los mismos modelos de siempre.
"""

from django.db.models import Count, Q, Sum
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import (
    ActividadObra,
    DailyPartHeavyEquipment,
    IncidentPersonnel,
    IncidentMaterial,
    Partida,
    Proyecto,
)


class ActividadObraSerializer(serializers.ModelSerializer):
    partes = serializers.SerializerMethodField()
    avance = serializers.SerializerMethodField()
    # Las partidas viajan dos veces y no es redundancia: 'partidas' son los
    # ids, que es lo que el formulario manda de vuelta, y 'partidas_detalle'
    # es lo que hace falta para pintar la ficha sin pedir el presupuesto
    # entero por cada actividad de la lista.
    partidas_detalle = serializers.SerializerMethodField()
    presupuestado = serializers.SerializerMethodField()

    class Meta:
        model = ActividadObra
        fields = ["id", "obra", "proyecto", "codigo", "nombre", "descripcion",
                  "ubicacion_text", "responsable", "estado", "fecha_inicio",
                  "fecha_fin", "created_at", "partes", "avance",
                  "partidas", "partidas_detalle", "presupuestado"]

    def get_partes(self, obj):
        return obj.partes.count()

    def get_partidas_detalle(self, obj):
        """Las partidas a las que ESTA actividad ha imputado metrado.

        No sale de una declaracion sino de los partes: una actividad no sabe
        de antemano todo lo que va a tocar, y obligarla a decirlo al crearla
        acaba en declaraciones que no se parecen a lo que se hizo.

        Cada fila mezcla dos cosas a proposito y por eso van con nombres
        distintos: 'imputado' y 'valorizado' son de esta actividad, mientras
        que 'metrado', 'ejecutado' y 'saldo' son de la partida en TODA la
        obra. El saldo de una partida no depende de quien se lo haya ido
        gastando, y ensenar uno "propio" invitaria a pasarse del presupuesto
        entre varias actividades sin que ninguna lo notara.

        Solo cuenta el metrado imputado en la MISMA unidad que la partida. Lo
        imputado en otra no se suma -daria un avance falso- pero tampoco se
        esconde: va en la cuenta de avance, que ya lo avisa.
        """
        from .models import DailyPartActivity

        partes = list(obj.partes.values_list("id", flat=True))
        if not partes:
            return []

        # Lo que imputo ESTA actividad, por partida y unidad.
        mio = {}
        for f in (DailyPartActivity.objects
                  .filter(parte_id__in=partes, partida__isnull=False)
                  .values("partida_id", "metrado_unidad")
                  .annotate(suma=Sum("metrado"))):
            mio.setdefault(f["partida_id"], {})[
                _normaliza(f["metrado_unidad"])] = float(f["suma"] or 0)

        if not mio:
            return []

        # Lo que lleva cada una de esas partidas en toda la obra.
        de_la_obra = {}
        for f in (DailyPartActivity.objects
                  .filter(partida_id__in=list(mio.keys()))
                  .values("partida_id", "metrado_unidad")
                  .annotate(suma=Sum("metrado"))):
            de_la_obra.setdefault(f["partida_id"], {})[
                _normaliza(f["metrado_unidad"])] = float(f["suma"] or 0)

        salida = []
        for p in Partida.objects.filter(id__in=list(mio.keys())).order_by("codigo"):
            u = _normaliza(p.unidad)
            total = float(p.metrado or 0)
            precio = float(p.precio or 0)
            imputado = mio.get(p.id, {}).get(u, 0.0)
            eje = de_la_obra.get(p.id, {}).get(u, 0.0)
            salida.append({
                "id": p.id,
                "codigo": p.codigo,
                "descripcion": p.descripcion,
                "unidad": p.unidad,
                "precio": precio,
                # de esta actividad
                "imputado": round(imputado, 4),
                "valorizado": round(imputado * precio, 2),
                # de la partida en toda la obra
                "metrado": total,
                "importe": round(total * precio, 2),
                "ejecutado": round(eje, 4),
                "saldo": round(total - eje, 4),
                "avance": round(eje / total * 100, 2) if total else None,
            })
        return salida

    def get_presupuestado(self, obj):
        """Siempre 0: una actividad no tiene presupuesto propio.

        La actividad ya no declara sus partidas, asi que no hay denominador
        contra el que medir SU avance: una partida se reparte entre varias
        actividades y ninguna sabe cuanto le toca. Inventar uno daria
        porcentajes que parecen buenos y no significan nada.

        Se deja el campo, devolviendo 0, para no romper a quien lo lea.
        """
        return 0
    def get_avance(self, obj):
        """Lo valorizado por esta actividad, al precio del presupuesto.

        Es la misma cuenta del tablero de obra: metrado imputado x precio de
        la partida. No es lo que cuesta la maquinaria, que es otra cosa y se
        calcula aparte.
        """
        total = 0.0
        descartado = 0.0
        partes = obj.partes.all().values_list("id", flat=True)
        if not partes:
            return {"valorizado": 0, "metrado_otra_unidad": 0}
        from .models import DailyPartActivity
        filas = (DailyPartActivity.objects
                 .filter(parte_id__in=list(partes), partida__isnull=False)
                 .values("metrado", "metrado_unidad",
                         "partida__precio", "partida__unidad"))
        for f in filas:
            u1 = _normaliza(f.get("metrado_unidad"))
            u2 = _normaliza(f.get("partida__unidad"))
            m = float(f.get("metrado") or 0)
            if u1 != u2:
                descartado += m
                continue
            total += m * float(f.get("partida__precio") or 0)
        return {"valorizado": round(total, 2),
                "metrado_otra_unidad": round(descartado, 4)}


def _normaliza(u):
    u = (u or "").strip().lower()
    return u.replace("\u00b3", "3").replace("\u00b2", "2")


def _partidas_de_otro(ids, obra):
    """Devuelve el aviso si alguna partida no es de esta obra; si no, None.

    Colgar una partida de otro proyecto no da un error visible: da un avance
    que suma dos presupuestos y parece correcto. Por eso se corta aqui.
    """
    if not ids:
        return None
    try:
        ids = [int(x) for x in ids]
    except (TypeError, ValueError):
        return "Las partidas tienen que venir como ids."

    encontradas = dict(Partida.objects.filter(id__in=ids)
                       .values_list("id", "obra"))
    faltan = [str(i) for i in ids if i not in encontradas]
    if faltan:
        return "No existen estas partidas: {0}.".format(", ".join(faltan))

    ajenas = sorted(set(o for i, o in encontradas.items() if o != obra))
    if ajenas:
        return ("Hay partidas de otro proyecto ({0}). Sumarlas daria un "
                "avance que mezcla dos presupuestos.".format(", ".join(ajenas)))
    return None


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def actividades_obra(request):
    """GET lista (filtrable por obra y estado). POST crea."""
    if request.method == "GET":
        qs = ActividadObra.objects.all()
        # Por clave si viene, que es lo que manda ahora la web. El filtro por
        # texto se queda para lo que todavia no se ha migrado.
        pro_id = request.query_params.get("proyecto")
        if pro_id:
            qs = qs.filter(proyecto_ref_id=pro_id)
        obra = request.query_params.get("obra")
        if obra:
            qs = qs.filter(obra=obra)
        estado = request.query_params.get("estado")
        if estado:
            qs = qs.filter(estado=estado)
        busca = (request.query_params.get("q") or "").strip()
        if busca:
            qs = qs.filter(Q(nombre__icontains=busca) |
                           Q(codigo__icontains=busca) |
                           Q(ubicacion_text__icontains=busca))
        return Response(ActividadObraSerializer(qs, many=True).data)

    datos = dict(request.data)
    for k, v in list(datos.items()):
        # 'partidas' es una lista de verdad, no un campo de formulario que
        # llega envuelto. Aplanarla cuando trae UNA sola la convertia en un
        # numero suelto, y la comprobacion de abajo petaba con un TypeError
        # que salia por pantalla como "tienen que venir como ids" - correcto
        # y completamente inutil, porque el que lo leia habia mandado ids.
        # Con dos o mas no pasaba, que es lo que lo hacia dificil de ver.
        if k == "partidas":
            continue
        if isinstance(v, list) and len(v) == 1:
            datos[k] = v[0]

    # El proyecto puede llegar de dos formas y las dos dejan la fila
    # completa: por clave (lo que manda la web desde que existe Proyectos) o
    # por el texto de siempre. Lo que NO puede pasar es que se cree una
    # actividad con proyecto_ref en NULL: a partir de ahi el avance sale
    # distinto segun por donde se mire.
    pro = None
    pro_id = datos.get("proyecto_id") or datos.get("proyecto_ref")
    if pro_id:
        try:
            pro = Proyecto.objects.get(pk=pro_id)
        except (Proyecto.DoesNotExist, ValueError, TypeError):
            return Response({"detail": "No existe el proyecto {0}.".format(pro_id)},
                            status=status.HTTP_400_BAD_REQUEST)
        datos["obra"] = pro.codigo
        datos["proyecto"] = pro.nombre[:300]

    obra = (datos.get("obra") or "").strip()
    if not obra:
        return Response({"detail": "Falta el proyecto."},
                        status=status.HTTP_400_BAD_REQUEST)

    if pro is None:
        # Vino solo el texto. Se busca su proyecto igual: enganchar aqui es
        # gratis, y no hacerlo deja una fila que habra que repescar a mano.
        pro = Proyecto.objects.filter(codigo=obra).first()
    if not (datos.get("nombre") or "").strip():
        return Response({"detail": "Falta el nombre de la actividad."},
                        status=status.HTTP_400_BAD_REQUEST)

    # El proyecto se copia del presupuesto, que es donde vive de verdad.
    if not (datos.get("proyecto") or "").strip():
        p = Partida.objects.filter(obra=obra).exclude(proyecto="").first()
        datos["proyecto"] = p.proyecto if p else ""

    # Correlativo por obra, calculado aqui y no en el cliente: dos pestanas
    # abiertas a la vez generarian el mismo numero.
    if not (datos.get("codigo") or "").strip():
        n = ActividadObra.objects.filter(obra=obra).count() + 1
        datos["codigo"] = "ACT-{0:04d}".format(n)

    mal = _partidas_de_otro(datos.get("partidas"), obra)
    if mal:
        return Response({"detail": mal}, status=status.HTTP_400_BAD_REQUEST)

    ser = ActividadObraSerializer(data=datos)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
    ser.save(proyecto_ref=pro)
    return Response(ser.data, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([AllowAny])
def actividad_obra_detalle(request, pk):
    try:
        act = ActividadObra.objects.get(pk=pk)
    except ActividadObra.DoesNotExist:
        return Response({"detail": "No existe."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        return Response(ActividadObraSerializer(act).data)

    if request.method == "DELETE":
        # Borrar una actividad se lleva por delante sus partes, su personal y
        # su material, que es trabajo registrado. Se dice cuanto ANTES de
        # hacerlo y solo se hace si lo piden a proposito.
        n = act.partes.count() + act.personal.count() + act.materiales.count()
        if n and request.query_params.get("confirmar") != "si":
            return Response({
                "detail": "Esta actividad tiene {0} registro(s) colgando "
                          "(partes, personal, materiales). Si de verdad "
                          "quieres borrarla, repite con ?confirmar=si".format(n),
                "registros": n,
            }, status=status.HTTP_409_CONFLICT)
        act.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    mal = _partidas_de_otro(request.data.get("partidas"), act.obra)
    if mal:
        return Response({"detail": mal},
                        status=status.HTTP_400_BAD_REQUEST)
    ser = ActividadObraSerializer(act, data=request.data, partial=True)
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
    ser.save()
    return Response(ser.data)


@api_view(["GET"])
@permission_classes([AllowAny])
def actividades_obra_resumen(request):
    """Cuantas hay por estado, para las tarjetas de la pantalla."""
    qs = ActividadObra.objects.all()
    pro_id = request.query_params.get("proyecto")
    if pro_id:
        qs = qs.filter(proyecto_ref_id=pro_id)
    obra = request.query_params.get("obra")
    if obra:
        qs = qs.filter(obra=obra)
    por_estado = {}
    # order_by() vacio NO es decorativo. Meta.ordering es ["-created_at"], y
    # Django mete el campo de ordenacion en el GROUP BY: sin limpiarlo, esto
    # agrupa por (estado, fecha) y devuelve una fila por actividad en vez de
    # una por estado. El total y el desglose dejan de cuadrar, y como los dos
    # numeros son plausibles nadie lo nota hasta que alguien los suma.
    for fila in qs.values("estado").order_by().annotate(n=Count("id")):
        por_estado[fila["estado"]] = fila["n"]
    return Response({
        "total": qs.count(),
        "por_estado": por_estado,
        "obras": list(ActividadObra.objects.values_list("obra", flat=True)
                      .distinct().order_by("obra")),
    })


@api_view(["POST"])
@permission_classes([AllowAny])
def terminar_actividad(request, pk):
    """Cierra los partes de una actividad, libera sus maquinas y la marca.

    Es lo mismo que cerrar_incidente() para una incidencia. La diferencia es
    donde queda la marca: una incidencia la guarda en IncidenteCerrado y una
    actividad en su propio estado, que ya existe. Dos marcas de lo mismo
    acaban discrepando.
    """
    from django.utils import timezone
    # Dentro de la funcion y no arriba: views.py importa de aqui, y al reves
    # arriba del fichero se montaria un import circular.
    from .views import _liberar_maquina_de_parte

    try:
        act = ActividadObra.objects.get(pk=pk)
    except ActividadObra.DoesNotExist:
        return Response({"detail": "No existe la actividad."},
                        status=status.HTTP_404_NOT_FOUND)

    # cerrado=False: terminar dos veces no vuelve a cerrar ni a liberar.
    partes = DailyPartHeavyEquipment.objects.filter(actividad_obra_id=act.id,
                                                    cerrado=False)
    total = 0
    liberadas = []
    for parte in partes:
        parte.cerrado = True
        parte.fecha_cierre = timezone.now()
        parte.save(update_fields=["cerrado", "fecha_cierre"])
        maq = _liberar_maquina_de_parte(parte)
        if maq:
            liberadas.append(maq.codigo)
        total += 1

    act.estado = ActividadObra.TERMINADA
    act.save(update_fields=["estado"])

    return Response({
        "detail": "Se cerraron {0} parte(s) y se liberaron {1} maquina(s).".format(
            total, len(liberadas)),
        "cerrados": total,
        "maquinas_liberadas": liberadas,
        "estado": act.estado,
    })


@api_view(["POST"])
@permission_classes([AllowAny])
def reanudar_actividad(request, pk):
    """Devuelve la actividad a ejecucion para poder seguir editando.

    NO reabre los partes, igual que reabrir_incidente(). Un parte cerrado ya
    libero su maquina y puede haberla cogido otra actividad; reabrirlos en
    bloque reclamaria maquinas que ya no son suyas.
    """
    try:
        act = ActividadObra.objects.get(pk=pk)
    except ActividadObra.DoesNotExist:
        return Response({"detail": "No existe la actividad."},
                        status=status.HTTP_404_NOT_FOUND)

    act.estado = ActividadObra.EN_EJECUCION
    act.save(update_fields=["estado"])
    return Response({
        "detail": "Actividad reanudada. Los partes ya cerrados siguen cerrados.",
        "estado": act.estado,
    })
