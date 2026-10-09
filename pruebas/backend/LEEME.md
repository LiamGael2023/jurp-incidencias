# Pruebas del backend de actividades

    cd pruebas/backend
    python3 -I actividades.prueba.py

Corre las vistas parcheadas contra **PostgreSQL y DRF de verdad**, no contra
mocks de Django. Levanta una base vacía, aplica los modelos, carga la vista
que produce el parche y le pega peticiones con `APIClient`.

`app/models.py` es una copia reducida de los modelos del servidor. **Tiene que
llevar los mismos `related_name` que los de verdad.** Por no llevar el de
`DailyPartActivity.partida` (`related_name='actividades'`), la prueba pasó en
verde mientras el servidor se negaba a arrancar con cuatro `fields.E304`: el
M2M nuevo pedía ese mismo nombre. Un mock que se parece pero no iguala es
peor que no tener mock, porque da permiso para desplegar.

Por eso lo primero que corre ahora son los **checks de modelos de Django**.
Eso es lo que caza un `related_name` repetido, y es gratis.
