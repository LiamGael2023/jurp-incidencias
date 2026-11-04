/* La pantalla de Monitoreos rutinarios, montada con datos de mentira.
 *
 * El servidor se sustituye por un fetch propio. Lo que se comprueba aqui es
 * justo lo que no se ve a voluntad en produccion: una rutina a medias -con
 * tramos recorridos, uno con hallazgo y varios sin asignar- y un tramo con
 * DOS empresas responsables, que es el caso del III, del V y del X y el que
 * rompe la fila si la tabla da por hecho que hay una.
 */
import { createRoot } from 'react-dom/client';
import Monitoreos from '../../src/Monitoreos';

localStorage.setItem('userToken', 'falso');

/* Quien recorre: coordinadores de las empresas usuarias. Se incluyen dos
 * cuentas de la MISMA persona -Emilio Alvarez-, que es el caso real: 14 de
 * los 31 coordinadores del cuadro estan duplicados en el padron. */
const CAND = [
  { id: 11, username: 'Aemilio', nombre: 'EMILIO ALVAREZ', grupo: 'mobile_usuarios' },
  { id: 12, username: 'Ealvarez', nombre: 'Emilio Alvarez', grupo: 'mobile_usuarios' },
  { id: 13, username: 'Lrodriguez', nombre: 'Luis Rodriguez', grupo: 'mobile_usuarios' },
  { id: 14, username: 'cherrera', nombre: 'Cesar Herrera', grupo: 'mobile_gerencia' },
];
/* A quien se avisa: el grupo de Gerencia, igual para los catorce tramos. */
const AVISADOS = [
  { id: 14, username: 'cherrera', nombre: 'Cesar Herrera' },
  { id: 15, username: 'i_camones', nombre: 'Ilich Lopez' },
];
const TRAMOS = ['0','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII']
  .map((t, i) => ({
    id: i + 1, tramo: t,
    // 0 = sin asignar, 1 = uno, 2 = dos personas en el mismo tramo
    asignados: i % 3 === 2 ? [] : (i % 3 === 1 ? [CAND[1], CAND[2]] : [CAND[0]]),
    visitas: i < 5 ? 1 : 0,
    hallazgos: i === 2 ? 1 : 0,
    recorrido: i < 5,
    detalle: i < 5 ? [{ id: i, sin_novedad: i !== 2, observacion: '', por: CAND[i % 3],
                        registrada_en: '2026-11-03T10:00:00Z', incidente: i === 2 ? 77 : null }] : [],
    contactos: [{ empresa: 'EMPRESA ' + t, coordinador: 'COORDINADOR ' + t, celular: '9' + (10000000 + i) }]
      .concat(i === 3 ? [{ empresa: 'SEGUNDA EMPRESA', coordinador: 'OTRO', celular: '912345678' }] : []),
  }));
const RUTINA = {
  id: 1, nombre: 'Recorrido noviembre 2026', fecha_inicio: '2026-11-01',
  fecha_fin: '2026-11-30', notas: '', cerrada: false, vigente: true,
  creada_por: CAND[0], creada_en: '2026-11-01T08:00:00Z',
  total_tramos: 14, recorridos: 5, sin_asignar: 4, tramos: TRAMOS,
};

window.fetch = async (url) => {
  const cuerpo =
    url.includes('/candidatos/') ? { ok: true, results: CAND, avisados: AVISADOS }
    : url.includes('/rutinas/1/') ? { ok: true, rutina: RUTINA }
    : url.includes('/rutinas/')   ? { ok: true, results: [RUTINA] }
    : { ok: true };
  return new Response(JSON.stringify(cuerpo),
    { status: 200, headers: { 'Content-Type': 'application/json' } });
};

createRoot(document.getElementById('app')).render(<Monitoreos />);
window.addEventListener('error', e => { window.__fallo = String(e.error || e.message); });
