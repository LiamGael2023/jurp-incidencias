/**
 * HYDROMETRIX: la puerta de las dos pantallas.
 *
 * Lo único que hace es elegir cuál. Están en ficheros aparte porque son dos
 * pantallas de verdad —seis gráficos una, cuatro la otra— y tenerlas juntas
 * obligaría a bajar media pantalla para encontrar la que se busca.
 *
 * LO QUE YA ESTABA RESUELTO antes de dibujar nada, y no hay que volver a
 * averiguar:
 *
 *   · Las cuentas son las del sistema de siempre; el login de NEXHYDRO pega
 *     contra ese mismo servidor. Esta tarjeta llegó a mandar fuera, a
 *     http://sistema.jriegopresurizado.org.pe/ —y por http, con la clave en
 *     claro—.
 *   · Las lecturas están en `registro_operadores`, en PLUVIRA: 3998 filas
 *     horarias con caudales, nivel de poza, turbidez y dosajes. En el
 *     Linode de vigilancia solo hay cuatro filas de prueba.
 *   · Los caudales se guardan en l/s. m³/h es ×3,6.
 *   · El estado de la poza viene guardado, no se calcula con umbrales.
 *
 * Lo que sigue sin medirse es el nombre exacto de cada campo de las
 * respuestas. `datosHydro.js` prueba varios y, cuando no reconoce ninguno,
 * el panel lo dice y enseña lo que llegó en vez de pintar un lienzo vacío.
 */
import HydroDistribucion from './HydroDistribucion';
import HydroCalidad from './HydroCalidad';

export default function Hydrometrix({ vista }) {
  if (vista === 'calidad-agua') return <HydroCalidad />;
  return <HydroDistribucion />;
}
