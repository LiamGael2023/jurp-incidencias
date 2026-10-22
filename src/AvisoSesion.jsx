/**
 * El cartel que dice por qué no hay datos.
 *
 * Antes no había ninguno: las pantallas se quedaban vacías y había que
 * adivinar entre «caducó la sesión», «el servidor está caído» y «se cortó
 * la red». Los tres se arreglan distinto.
 *
 * VA ARRIBA Y NO SE PONE SOLO ENCIMA DEL MAPA. El mapa ocupa la pantalla
 * entera; un aviso dentro de la lista de incidencias no se vería cuando lo
 * que falló fue el mapa, y al revés. Por eso lo monta App una sola vez.
 *
 * NO CIERRA LA SESION SOLO. Ofrece el botón, pero la decisión es de quien
 * está delante: puede tener un parte a medio escribir, y tirarle el token
 * por un 401 de un endpoint suelto le borraría el trabajo.
 *
 * DICE CUANTO LLEVABA ABIERTA la sesión cuando la rechazaron. Si el token
 * caduca, ese número se repite; si el servidor falla a ratos, sale
 * cualquiera. Es lo que convierte el próximo susto en un dato.
 */
import { useEffect, useState } from 'react';
import { FaExclamationTriangle, FaTimes, FaSignInAlt, FaSyncAlt } from 'react-icons/fa';
import { alFallar, TEXTOS, duracionLegible } from './sesion';
import './AvisoSesion.css';

export default function AvisoSesion({ onVolverAEntrar }) {
  const [aviso, setAviso] = useState(null);

  useEffect(() => alFallar(setAviso), []);

  if (!aviso) return null;

  const esSesion = aviso.motivo === 'sesion';
  const duracion = esSesion ? duracionLegible(aviso.minutos) : null;

  return (
    <div className={`avs ${esSesion ? 'avs-sesion' : 'avs-otro'}`} role="alert">
      <FaExclamationTriangle size={14} className="avs-ico" />
      <div className="avs-txt">
        <b>{TEXTOS[aviso.motivo] || 'No se pudieron cargar los datos.'}</b>
        {duracion && (
          <span className="avs-dato"> La sesión llevaba abierta {duracion}.</span>
        )}
        {aviso.status ? (
          <span className="avs-dato"> (código {aviso.status})</span>
        ) : null}
      </div>
      <div className="avs-botones">
        {esSesion ? (
          <button type="button" className="avs-btn avs-btn-ok"
            onClick={() => { setAviso(null); onVolverAEntrar && onVolverAEntrar(); }}>
            <FaSignInAlt size={11} /> Volver a entrar
          </button>
        ) : (
          <button type="button" className="avs-btn avs-btn-ok"
            onClick={() => window.location.reload()}>
            <FaSyncAlt size={11} /> Reintentar
          </button>
        )}
        <button type="button" className="avs-btn avs-cerrar" title="Cerrar aviso"
          onClick={() => setAviso(null)}><FaTimes size={12} /></button>
      </div>
    </div>
  );
}
