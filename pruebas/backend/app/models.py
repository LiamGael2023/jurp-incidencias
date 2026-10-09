from django.db import models as M

class Proyecto(M.Model):
    codigo = M.CharField(max_length=120, unique=True)
    nombre = M.CharField(max_length=300)
    class Meta: app_label = 'app'

class Partida(M.Model):
    obra = M.CharField(max_length=120, db_index=True)
    proyecto = M.CharField(max_length=300, blank=True, default='')
    proyecto_ref = M.ForeignKey(Proyecto, null=True, blank=True,
                                on_delete=M.CASCADE, related_name='partidas')
    codigo = M.CharField(max_length=40)
    descripcion = M.CharField(max_length=300)
    unidad = M.CharField(max_length=12)
    metrado = M.DecimalField(max_digits=14, decimal_places=4, default=0)
    precio = M.DecimalField(max_digits=14, decimal_places=2, default=0)
    estructura = M.CharField(max_length=200, blank=True, default='')
    grupo = M.CharField(max_length=200, blank=True, default='')
    ruta = M.TextField(blank=True, default='')
    activo = M.BooleanField(default=True)
    class Meta: app_label = 'app'

class ActividadObra(M.Model):
    # Las constantes del modelo de verdad. Sin ellas la vista casca con un
    # AttributeError que no tiene nada que ver con lo que se esta probando:
    # el mock tiene que igualar, no parecerse.
    EN_EJECUCION = "ejecucion"
    TERMINADA = "terminada"
    SUSPENDIDA = "suspendida"

    obra = M.CharField(max_length=120, db_index=True)
    proyecto = M.CharField(max_length=300, blank=True, default='')
    proyecto_ref = M.ForeignKey(Proyecto, null=True, blank=True,
                                on_delete=M.CASCADE, related_name='actividades')
    codigo = M.CharField(max_length=30, blank=True, default='')
    nombre = M.CharField(max_length=300)
    descripcion = M.TextField(blank=True, default='')
    ubicacion_text = M.CharField(max_length=300, blank=True, default='')
    responsable = M.CharField(max_length=160, blank=True, default='')
    estado = M.CharField(max_length=20, default='ejecucion')
    fecha_inicio = M.DateField(null=True, blank=True)
    fecha_fin = M.DateField(null=True, blank=True)
    partidas = M.ManyToManyField(Partida, blank=True, related_name='actividades_obra')
    created_at = M.DateTimeField(auto_now_add=True)
    class Meta:
        app_label = 'app'
        ordering = ['-created_at']

# lo que la vista importa y aqui no hace falta de verdad
class ModeloEquipo(M.Model):
    codigo = M.CharField(max_length=30)
    estado = M.IntegerField(default=0)   # 0 = disponible
    activo = M.BooleanField(default=True)
    class Meta: app_label = 'app'

class DailyPartHeavyEquipment(M.Model):
    actividad_obra = M.ForeignKey(ActividadObra, null=True, blank=True,
                                  on_delete=M.SET_NULL, related_name='partes')
    fecha = M.DateField(null=True, blank=True)
    maquina = M.ForeignKey(ModeloEquipo, null=True, blank=True, on_delete=M.SET_NULL)
    cerrado = M.BooleanField(default=False)
    fecha_cierre = M.DateTimeField(null=True, blank=True)
    class Meta: app_label = 'app'
class IncidentPersonnel(M.Model):
    class Meta: app_label = 'app'
class IncidentMaterial(M.Model):
    class Meta: app_label = 'app'


class DailyPartActivity(M.Model):
    parte = M.ForeignKey(DailyPartHeavyEquipment, on_delete=M.CASCADE)
    # related_name REAL del servidor. Sin el, el choque de nombres con el
    # M2M de ActividadObra no se reproduce aqui y la prueba pasa en verde
    # mientras el servidor se niega a arrancar.
    partida = M.ForeignKey(Partida, null=True, blank=True, on_delete=M.SET_NULL,
                           related_name='actividades')
    metrado = M.DecimalField(max_digits=14, decimal_places=4, default=0)
    metrado_unidad = M.CharField(max_length=12, blank=True, default='')
    class Meta: app_label = 'app'
