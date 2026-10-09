import * as C from '../../src/costeo/calculos';
const r = [];
const ok = (c, m, e) => r.push({ ok: !!c, m, e: e === undefined ? '' : String(e) });

ok(C.round2(1.005) === 1.01, 'round2 redondea a dos', C.round2(1.005));
ok(C.round4(1.00005) === 1.0001, 'round4 a cuatro', C.round4(1.00005));

// horas de una actividad: su tramo de horómetro
const a1 = { hmInicio: '100', hmFin: '108', horasEfectivas: '', obsReduccion: '' };
ok(C.horasDeActividad(a1) === 8, 'tramo 100→108 = 8 h', C.horasDeActividad(a1));
ok(C.heDeActividad(a1) === 8, 'sin reducción, se cobra el tramo', C.heDeActividad(a1));
ok(C.hayReduccionEn(a1) === false, 'no hay reducción');

const a2 = { hmInicio: '100', hmFin: '108', horasEfectivas: '6', obsReduccion: 'avería' };
ok(C.heDeActividad(a2) === 6, 'con HE puesta, se cobra esa', C.heDeActividad(a2));
ok(C.hayReduccionEn(a2) === true, 'y hay reducción');
ok(C.muertasDeActividad(a2) === 2, '2 horas muertas', C.muertasDeActividad(a2));
ok(C.muertasDeLista([a1, a2]) === 2, 'la lista suma 2 muertas', C.muertasDeLista([a1, a2]));
ok(C.horasDeLista([a1, a2]) === 14, 'se cobran 8 + 6 = 14', C.horasDeLista([a1, a2]));
ok(C.tramoDeLista([a1, a2]) === 16, 'el tramo recorrido es 16', C.tramoDeLista([a1, a2]));
ok(C.resumenReduccion([a1, a2]).includes('avería'), 'el motivo sale en el resumen',
   C.resumenReduccion([a1, a2]));
const rg = C.rangoHorometro([a1, a2]);
ok(rg.inicio === 100 && rg.fin === 108, 'rango de horómetro', JSON.stringify(rg));

// metrado por fórmula: excavación = (B + b)/2 × h × L
const ex = { actividad: 'EXCAVACION DE MATERIAL', calcularMetrado: true,
  anchoBase: '4', corona: '2', altura: '1.5', longitud: '10' };
const m = C.calcMetradoDe(ex);
ok(Math.abs(m.val - 45) < 0.001, 'excavación (4+2)/2 × 1.5 × 10 = 45 m³',
   `${m.val} ${m.unit}`);
ok(m.unit === 'm³', 'en m³', m.unit);

const manual = { actividad: 'OTROS', calcularMetrado: false, metradoManual: '12.5',
  unidadMetrado: 'm2' };
const mm = C.calcMetradoDe(manual);
ok(mm.val === 12.5 && mm.unit === 'm²', 'metrado manual se respeta',
   `${mm.val} ${mm.unit}`);

// ida y vuelta al backend
const act = { ...C.estadoInicialActividad, zonaTrabajo: 'Prog 2+300',
  actividad: 'EXCAVACION DE MATERIAL', hmInicio: '100', hmFin: '108',
  horasEfectivas: '6', obsReduccion: 'avería', partidaId: '7',
  partidaCodigo: '01.02.04.01.01', partidaDescripcion: 'Excavación',
  calcularMetrado: true, anchoBase: '4', corona: '2', altura: '1.5', longitud: '10' };
const haciaBack = C.actividadesParaBackend([act])[0];
ok(haciaBack.partida === '7', 'manda la partida', haciaBack.partida);
ok(Math.abs(haciaBack.metrado - 45) < 0.001, 'y el metrado calculado', haciaBack.metrado);
ok(haciaBack.horas_efectivas === 6, 'y las HE', haciaBack.horas_efectivas);
const vuelta = C.actividadesDesdeBackend([haciaBack])[0];
ok(vuelta.zonaTrabajo === 'Prog 2+300', 'y vuelve la zona', vuelta.zonaTrabajo);
ok(vuelta.actividad === 'EXCAVACION DE MATERIAL', 'y la actividad', vuelta.actividad);
ok(vuelta.anchoBase == 4 && vuelta.longitud == 10,
   'y las medidas crudas, para poder reeditar', `${vuelta.anchoBase}/${vuelta.longitud}`);
ok(Math.abs(C.calcMetradoDe(vuelta).val - 45) < 0.001,
   'y al recalcular da lo mismo', C.calcMetradoDe(vuelta).val);

ok(C.correlativoMas('PD-0261-20261009', 1) === 'PD-0262-20261009',
   'el correlativo avanza', C.correlativoMas('PD-0261-20261009', 1));
ok(C.correlativoMas('PD-0261-20261009', 3) === 'PD-0264-20261009',
   'y de tres en tres', C.correlativoMas('PD-0261-20261009', 3));
ok(C.fechaCorta('2026-10-09') === '09/10', 'fecha corta', C.fechaCorta('2026-10-09'));
ok(C.fechaDe({ tipo: 'Maquinaria', fechaParte: '2026-10-09' }) === '2026-10-09',
   'la fecha de una máquina es la del parte');
ok(C.CATEGORIAS.length === 3, 'tres categorías', C.CATEGORIAS.map(c => c.key).join(','));
ok(!!C.IMG_METRADO['EXCAVACION DE MATERIAL'], 'las imágenes de referencia siguen');

window.__r = r;


// horasCobradas: tres fuentes, por orden
ok(C.horasCobradas({ horas_efectivas: '7.5' }) === 7.5,
   'horasCobradas usa la cabecera si la trae', C.horasCobradas({ horas_efectivas: '7.5' }));
const conActs = { actividades: [
  { horas_efectivas: '3' },
  { start_horometer: '100', end_horometer: '104' } ] };
ok(C.horasCobradas(conActs) === 7, 'si no, suma las actividades (3 + 4)',
   C.horasCobradas(conActs));
ok(C.horasCobradas({ start_horometer: '10', end_horometer: '18' }) === 8,
   'y si no hay ni una cosa ni otra, el tramo (partes antiguos)',
   C.horasCobradas({ start_horometer: '10', end_horometer: '18' }));
window.__r = r;
