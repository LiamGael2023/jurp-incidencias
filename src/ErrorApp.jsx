import React from 'react';

/**
 * EL CAZADOR DE ERRORES: que una pantalla en blanco diga qué pasó.
 *
 * Cuando algo revienta durante el pintado, React desmonta el árbol entero y
 * deja el `<div id="root">` vacío. Para quien lo sufre eso es «se puso en
 * blanco», sin más: ni mensaje, ni pista, ni forma de contarlo. El error
 * existe —está en la consola del navegador— pero hay que saber que la
 * consola existe, abrirla antes de recargar y copiar la línea correcta.
 * Entre un inspector en campo y el que arregla el código eso son varios
 * mensajes de ida y vuelta para averiguar lo que el navegador ya sabía.
 *
 * Esto lo enseña en pantalla, con un botón que lo copia entero al
 * portapapeles para pegarlo en un WhatsApp.
 *
 * LO QUE NO CAZA. Los límites de error de React solo recogen lo que falla
 * al pintar o en los efectos. Lo que reviente dentro de un manejador de
 * clic o en una promesa no pasa por aquí, pero tampoco deja la pantalla en
 * blanco, así que para el caso que nos ocupa cubre lo que hay que cubrir.
 *
 * NO REINTENTA SOLO. Volver a pintar lo que acaba de romperse da el mismo
 * error en bucle; «Recargar» rehace el arranque limpio, que es lo que de
 * verdad arregla un estado corrupto. Y hay «Volver al inicio» porque casi
 * siempre lo que falla es una pantalla concreta y el resto de la app está
 * perfectamente bien: con el hash quitado, el siguiente arranque abre la
 * vista inicial en vez de volver a la que revienta.
 */
export default class ErrorApp extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, pila: '', copiado: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ pila: info?.componentStack || '' });
    // Que siga saliendo en la consola: quien sepa mirarla tendrá ahí la
    // traza completa y sin minificar si el despliegue lleva sourcemaps.
    console.error('[JURP] pantalla rota:', error, info);
  }

  texto() {
    const e = this.state.error;
    return [
      `JURP · ${window.location.hash || '#'} · ${new Date().toISOString()}`,
      `${e?.name || 'Error'}: ${e?.message || e}`,
      this.state.pila ? `\nDónde:${this.state.pila}` : '',
      e?.stack ? `\nTraza:\n${e.stack}` : '',
    ].join('\n');
  }

  copiar = async () => {
    try {
      await navigator.clipboard.writeText(this.texto());
      this.setState({ copiado: true });
    } catch {
      // Sin permiso de portapapeles: al menos queda seleccionable en pantalla.
      this.setState({ copiado: false });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    const e = this.state.error;
    const caja = {
      background: '#0f172a', color: '#e2e8f0', border: '1px solid #1e293b',
      borderRadius: 8, padding: 12, fontSize: 11.5, lineHeight: 1.5,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      maxHeight: 260, overflow: 'auto', userSelect: 'text',
    };
    const boton = {
      padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700,
      cursor: 'pointer', border: '1px solid #cbd5e1', background: '#fff',
      color: '#334155',
    };

    return (
      <div style={{
        minHeight: '100vh', background: '#f1f5f9', padding: 24,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
      }}>
        <div style={{
          width: 'min(720px, 100%)', background: '#fff', borderRadius: 14,
          padding: 24, boxShadow: '0 12px 40px rgba(15,23,42,.12)',
        }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#0f172a' }}>
            Esta pantalla se rompió
          </div>
          <div style={{ fontSize: 13.5, color: '#475569', marginTop: 6,
            lineHeight: 1.55 }}>
            El resto del sistema sigue funcionando. Copia lo de abajo y
            mándalo: con eso se sabe exactamente qué falló.
          </div>

          <div style={{ ...caja, marginTop: 16 }}>
            {`${e?.name || 'Error'}: ${e?.message || String(e)}`}
            {this.state.pila ? `\n\nDónde:${this.state.pila}` : ''}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 16,
            flexWrap: 'wrap' }}>
            <button onClick={this.copiar}
              style={{ ...boton, background: '#1d4ed8', color: '#fff',
                borderColor: '#1d4ed8' }}>
              {this.state.copiado ? 'Copiado' : 'Copiar el error'}
            </button>
            <button onClick={() => window.location.reload()} style={boton}>
              Recargar
            </button>
            <button style={boton}
              onClick={() => {
                window.location.hash = '';
                window.location.reload();
              }}>
              Volver al inicio
            </button>
          </div>
        </div>
      </div>
    );
  }
}
