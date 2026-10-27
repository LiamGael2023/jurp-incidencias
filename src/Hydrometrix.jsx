/**
 * HYDROMETRIX: Distribución y Calidad de Agua.
 *
 * ESTADO: el módulo entra, falta pintar los datos.
 *
 * Lo que ya está resuelto y no hay que volver a averiguar:
 *
 *   - Las cuentas. Son las del sistema de siempre; el login de NEXHYDRO
 *     pega contra ese mismo servidor. Antes esta tarjeta mandaba fuera, a
 *     http://sistema.jriegopresurizado.org.pe/ —y por http, con la clave en
 *     claro—.
 *   - Los datos. Están en `registro_operadores`: 3998 lecturas horarias con
 *     caudales, nivel de poza, turbidez y dosajes.
 *   - Las unidades. Los caudales se guardan en l/s; m³/h es ×3,6.
 *   - El estado de la poza viene guardado («Muy bajo», «Bajo», «En su
 *     nivel», «Excedencia»), no se calcula con umbrales.
 *   - Los endpoints, que además ya agregan del lado del servidor:
 *       /api/operadores/tomas/
 *       /api/operadores/tomas/status-summary/   las tarjetas
 *       /api/operadores/series/                 caudales, NTU y dosajes
 *       /api/operadores/volumes/by-toma/
 *       /api/operadores/volumes/by-month/
 *
 * LO QUE FALTA es la forma exacta de esas respuestas: cómo se llama cada
 * campo y cómo se piden los filtros de toma, periodo y fecha. Se resuelve
 * con una llamada a cada endpoint.
 *
 * POR QUE ESTA PANTALLA DICE ESTO EN VEZ DE ENSEÑAR UNA TABLA VACIA. Una
 * tabla sin filas se lee como «no hay datos», que es mentira: hay casi
 * cuatro mil lecturas. Y unos gráficos pintados adivinando los nombres de
 * los campos saldrían con huecos o, peor, con números plausibles y
 * equivocados que nadie comprobaría contra el papel.
 */
import { FaWater, FaFlask, FaInfoCircle } from 'react-icons/fa';

const PANTALLAS = {
  distribucion: {
    icono: <FaWater />,
    titulo: 'Distribución',
    rotulo: 'Operadores L10',
    tendra: [
      'Resumen por toma: caudal de salida, desnivel del sedimentador, turbidez y hora de la última lectura.',
      'Caudal de ingreso y de salida, por hora, con el día o el periodo que elijas.',
      'Caudal de excedencia de la toma 10.6/7 y su comparación con el caudal total.',
      'Volumen por tomas y volumen mensual.',
    ],
  },
  'calidad-agua': {
    icono: <FaFlask />,
    titulo: 'Calidad de Agua',
    rotulo: 'Operadores L10',
    tendra: [
      'Turbidez de salida de cada toma frente al canal fijo (10.2), en NTU.',
      'Dosajes en ppm: floculante, coagulante orgánico y sulfato férrico.',
      'Los mismos filtros de toma, periodo y fecha para los tres gráficos.',
    ],
  },
};

export default function Hydrometrix({ vista }) {
  const p = PANTALLAS[vista] || PANTALLAS.distribucion;
  return (
    <div className="tbl-page-wrapper">
      <div className="tbl-page-header">
        <div className="tbl-row align-items-center">
          <div className="tbl-col">
            <div className="tbl-page-pretitle">{p.rotulo}</div>
            <h2 className="tbl-page-title">{p.titulo}</h2>
          </div>
        </div>
      </div>

      <div className="tbl-page-body">
        <div style={{background:'#fff',border:'1px solid rgba(98,105,118,0.16)',
                     borderRadius:'6px',padding:'22px 24px',maxWidth:'760px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'10px',
                       color:'#206bc4',fontSize:'20px',marginBottom:'4px'}}>
            {p.icono}
            <span style={{fontSize:'16px',fontWeight:700,color:'#1d273b'}}>
              Esta pantalla está en construcción
            </span>
          </div>

          <p style={{color:'#475569',fontSize:'13px',lineHeight:1.6,margin:'10px 0 0'}}>
            El acceso ya funciona: entras con las mismas credenciales de
            siempre y los datos están en el servidor —casi cuatro mil
            lecturas horarias—. Falta terminar de dibujarlos.
          </p>

          <div style={{fontSize:'12px',color:'#626976',textTransform:'uppercase',
                       fontWeight:600,margin:'18px 0 8px'}}>
            Lo que va a mostrar
          </div>
          <ul style={{margin:0,paddingLeft:'18px',color:'#475569',fontSize:'13px',
                      lineHeight:1.7}}>
            {p.tendra.map((x, i) => <li key={i}>{x}</li>)}
          </ul>

          {/* Se dice que no hay datos aquí para que nadie lea esta pantalla
              como «el sistema no tiene registros». Los tiene. */}
          <div style={{display:'flex',gap:'8px',alignItems:'flex-start',
                       marginTop:'20px',padding:'11px 14px',background:'#eff6ff',
                       border:'1px solid #bfdbfe',borderRadius:'6px',
                       color:'#1e40af',fontSize:'12.5px',lineHeight:1.55}}>
            <FaInfoCircle style={{marginTop:'2px',flexShrink:0}} />
            <span>
              Mientras tanto, estos datos siguen consultándose en el sistema
              anterior. Que esta pantalla esté vacía no significa que no haya
              registros.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
