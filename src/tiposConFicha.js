/**
 * Los tipos de activo que tienen ficha de inspección dibujada.
 *
 * Vive aparte porque lo consultan dos pantallas —el visor, para enseñar el
 * botón «Ver ficha» en el activo, y la de reportes, para ofrecer el PDF por
 * tipo— y una copia en cada una se desincroniza en cuanto se añade un
 * formato: el visor ofrecería una ficha que el servidor rechaza con un 400,
 * o al revés, la tendría y no la ofrecería.
 *
 * Esta lista tiene que seguir a `TABLAS` en pruebas/fichas_inspeccion.py,
 * que es quien decide de verdad: lo que no esté allí, el backend lo
 * rechaza. La prueba de montaje lo comprueba.
 */
export const TIPOS_CON_FICHA = [
  'tomas_canal_madre', 'tomas_l10', 'tomas_otros_sectores',
  'alcantarilla', 'aliviadero', 'bocatomas', 'cajas_hidraulicas',
  'camara_rompepresion', 'canoas', 'desarenadores', 'entregas',
  'estaciones_control', 'laterales', 'partidor', 'pases_de_tuberias',
  'puente_peatonal', 'puente_vehicular', 'rapidas', 'reservorios', 'sifon',
];

export const tieneFicha = (tipo) => TIPOS_CON_FICHA.includes(tipo);
