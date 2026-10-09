// ═══════════════════════════════════════════════════════════════════════════
//  Imágenes para los informes
// ═══════════════════════════════════════════════════════════════════════════
//
// Aparte de calculos.js porque esto SÍ toca el DOM: dibuja en un canvas. El
// otro módulo promete no hacerlo y conviene que la promesa siga siendo
// cierta.

/**
 * Una imagen a data-URL, para incrustarla en el PDF o el Excel.
 *
 * Nunca rechaza: si la imagen no carga, devuelve null. Un logo que no
 * aparece es un informe feo; una promesa rechazada a media generación es un
 * informe que no sale.
 */
export const imgToBase64 = (src) => new Promise((resolve) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    resolve(canvas.toDataURL('image/png'));
  };
  img.onerror = () => resolve(null);
  img.src = src;
});
