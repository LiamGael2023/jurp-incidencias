import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import logoJurp from './assets/nexhidra/logo-jurp.png';
import heroCanal from './assets/nexhidra/hero-canal.jpg';
import appHydrometrix from './assets/nexhidra/app-caudixa.jpg';
import appPluvira from './assets/nexhidra/app-pluvira.jpg';
import appSentria from './assets/nexhidra/app-sentria.jpg';

/* ---------- paleta ---------- */
const AZUL = '#1268C3';
const NARANJA = '#EE7B12';
const VERDE = '#2E9E4F';
const NAVY = '#0B2A5B';

/* Ancho fijo del lienzo. Todo se escala para caber en la pantalla. */
const ANCHO = 1880;
const CORTE_MOVIL = 900;

/* ---------- icono generico ---------- */
function Ico({ d, color = NAVY, size = 28, sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

/* ---------- paths ---------- */
const P = {
  gota: ['M12 3c3.5 4.2 6 7.4 6 10.5A6 6 0 0 1 6 13.5C6 10.4 8.5 7.2 12 3z'],
  matraz: ['M9 3h6', 'M10 3v5.5L5.5 17a3 3 0 0 0 2.7 4.5h7.6a3 3 0 0 0 2.7-4.5L14 8.5V3'],
  barras: ['M6 20V12', 'M12 20V6', 'M18 20v-4'],
  nube: ['M17 17a4 4 0 0 0 0-8 6 6 0 0 0-11.3 1.5A3.5 3.5 0 0 0 6.5 17z', 'M8 20l1 2', 'M12 20l1 2', 'M16 20l1 2'],
  nubeLluvia: ['M17 15a4 4 0 0 0 0-8 6 6 0 0 0-11.3 1.5A3.5 3.5 0 0 0 6.5 15z', 'M12 17v4'],
  pin: ['M12 21c4-4.5 7-7.6 7-11a7 7 0 1 0-14 0c0 3.4 3 6.5 7 11z', 'M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  campana: ['M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6', 'M10.5 20a1.7 1.7 0 0 0 3 0'],
  escudo: ['M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z', 'M12 13.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  credencial: ['M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M7 10a1.5 1.5 0 1 0 0-3', 'M6 15c.4-1.4 1.6-2 3-2s2.6.6 3 2', 'M14 9h4', 'M14 13h4'],
  reporte: ['M8 4h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M9 9h6', 'M9 13h6', 'M9 17h4'],
  camara: ['M4 8a2 2 0 0 1 2-2h1l1.5-2h7L17 6h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z'],
  flecha: ['M5 12h13', 'M13 6l6 6-6 6'],
};

export default function Nexhidra({ onEntrar, onCaudixa, onSentria,
  hrefPluvira, hrefCaudixa, hrefSentria }) {
  const stageRef = useRef(null);
  const [movil, setMovil] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= CORTE_MOVIL
  );

  /* fuentes */
  useEffect(() => {
    const id = 'nx-fonts';
    if (document.getElementById(id)) return;
    const l = document.createElement('link');
    l.id = id;
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(l);
  }, []);

  /* escalar el lienzo para que quepa completo en la pantalla */
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const ajustar = () => {
      const esMovil = window.innerWidth <= CORTE_MOVIL;
      setMovil(esMovil);

      if (esMovil) {
        stage.style.transform = 'none';
        return;
      }
      stage.style.transform = 'none';
      const alto = stage.offsetHeight;
      if (!alto) return;
      const s = Math.min((window.innerWidth - 10) / ANCHO, (window.innerHeight - 8) / alto);
      stage.style.transform = `scale(${s})`;
      stage.style.transformOrigin = 'center center';
    };

    ajustar();
    const t1 = setTimeout(ajustar, 150);
    const t2 = setTimeout(ajustar, 600);   // tras cargar imagenes y fuentes
    window.addEventListener('resize', ajustar);
    if (document.fonts?.ready) document.fonts.ready.then(ajustar).catch(() => {});

    return () => {
      clearTimeout(t1); clearTimeout(t2);
      window.removeEventListener('resize', ajustar);
    };
  }, []);

  const soluciones = [
    {
      key: 'hydrometrix', src: appHydrometrix, color: AZUL, tint: '#e3f0fc',
      pre: 'HYDROMETRI', fin: 'X', tagline: 'MONITOREO INTELIGENTE DEL AGUA', icono: P.gota,
      desc: 'Monitoreamos en tiempo real el caudal y la calidad del agua para una operación eficiente y sostenible.',
      features: [
        { d: P.gota, label: 'CAUDAL EN TIEMPO REAL' },
        { d: P.matraz, label: 'CALIDAD DEL AGUA' },
        { d: P.barras, label: 'REPORTES AUTOMÁTICOS' },
      ],
      onClick: onCaudixa, href: hrefCaudixa,
    },
    {
      key: 'pluvira', src: appPluvira, color: NARANJA, tint: '#fdeede',
      pre: 'PLUVIR', fin: 'A', tagline: 'GESTIÓN INTELIGENTE DE RIESGOS', icono: P.nube,
      desc: 'Anticipamos eventos naturales, evaluamos riesgos y activamos acciones oportunas para proteger nuestra infraestructura.',
      features: [
        { d: P.nubeLluvia, label: 'MONITOREO CLIMÁTICO' },
        { d: P.pin, label: 'MAPAS DE RIESGO' },
        { d: P.campana, label: 'ALERTAS TEMPRANAS' },
      ],
      onClick: onEntrar, href: hrefPluvira,
    },
    {
      key: 'sentria', src: appSentria, color: VERDE, tint: '#e4f4e9',
      pre: 'SENTRI', fin: 'A', tagline: 'SEGURIDAD ACTIVA EN TIEMPO REAL', icono: P.escudo,
      desc: 'Controlamos, vigilamos y respondemos ante incidentes para garantizar la seguridad de personas e instalaciones.',
      features: [
        { d: P.credencial, label: 'CONTROL DE ACCESOS' },
        { d: P.reporte, label: 'INCIDENTES Y REPORTES' },
        { d: P.camara, label: 'VIGILANCIA EN TIEMPO REAL' },
      ],
      onClick: onSentria, href: hrefSentria,
    },
  ];

  return (
    <div className={`nx-viewport ${movil ? 'nx-movil' : ''}`}>
      <style>{CSS}</style>

      <div className="nx-stage" ref={stageRef}>

        {/* ================= HERO ================= */}
        <header className="nx-hero">
          <div className="nx-hero-txt">
            <div className="nx-brand">
              <img className="nx-logo" src={logoJurp} alt="Logo JURP" />
              <div>
                <div className="nx-jurp">JURP</div>
                <div className="nx-nex"><span>NEX</span><span className="nx-hidra">HIDRO</span></div>
              </div>
            </div>
            <p className="nx-eyebrow">PLATAFORMA DIGITAL DE GESTIÓN INTELIGENTE</p>
            <p className="nx-junta">JUNTA DE USUARIOS DE RIEGO PRESURIZADO</p>
            <p className="nx-lead">
              Innovación tecnológica para una gestión eficiente, segura y sostenible del recurso hídrico.
            </p>
          </div>
          <div className="nx-hero-img">
            <img src={heroCanal} alt="Canal de riego presurizado" />
            <p className="nx-hero-cap">
              Conectamos información, optimizamos decisiones y fortalecemos el riego presurizado.
            </p>
          </div>
        </header>

        {/* ================= SOLUCIONES ================= */}
        <section className="nx-panel">
          <div className="nx-cards">
            {soluciones.map((s) => {
              const activo = typeof s.onClick === 'function';
              // La tarjeta entera es un enlace: asi el clic con la rueda o
              // ctrl+clic en cualquier punto abre una pestaña nueva.
              const Tarjeta = activo ? 'a' : 'article';
              const propsTarjeta = activo
                ? {
                    href: s.href || '#',
                    onClick: (e) => {
                      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                      e.preventDefault();
                      s.onClick();
                    },
                  }
                : {};
              return (
                <Tarjeta
                  key={s.key}
                  className={`nx-card ${activo ? 'nx-card-on' : ''}`}
                  style={{ '--c': s.color, '--tint': s.tint }}
                  {...propsTarjeta}
                >
                  <div className="nx-card-top">
                    <div className="nx-phone">
                      <span className="nx-notch" />
                      <img src={s.src} alt={`App ${s.pre}${s.fin}`} />
                    </div>
                    <div className="nx-card-id">
                      <div className="nx-badge"><Ico d={s.icono} color={s.color} size={32} /></div>
                      <h2 className="nx-name">{s.pre}<span>{s.fin}</span></h2>
                      <p className="nx-tag">{s.tagline}</p>
                    </div>
                  </div>

                  <p className="nx-desc">{s.desc}</p>

                  <ul className="nx-feats">
                    {s.features.map((f) => (
                      <li key={f.label}>
                        <span className="nx-fcircle"><Ico d={f.d} color={s.color} size={28} /></span>
                        <span className="nx-flabel">{f.label}</span>
                      </li>
                    ))}
                  </ul>

                  {activo ? (
                    <span className="nx-btn">
                      INGRESAR <Ico d={P.flecha} color="#fff" size={20} />
                    </span>
                  ) : (
                    <span className="nx-btn nx-btn-off">PRÓXIMAMENTE</span>
                  )}
                </Tarjeta>
              );
            })}
          </div>
        </section>

        <div className="nx-espacio" />
      </div>
    </div>
  );
}

/* ================================================================= */
const CSS = `
.nx-viewport{
  --azul:#1268C3; --naranja:#EE7B12; --verde:#2E9E4F;
  --navy:#0B2A5B; --texto:#3a5d86; --cielo:#35B6E9;
  position:fixed; inset:0; z-index:1;
  display:flex; align-items:center; justify-content:center;
  overflow:hidden;
  background:linear-gradient(160deg,#254268 0%,#1d375a 45%,#132741 100%);
  font-family:'Manrope',system-ui,sans-serif; color:#12335e;
}
.nx-viewport *{box-sizing:border-box;}
.nx-stage{
  width:1880px; flex-shrink:0;
  background:linear-gradient(160deg,#f4faff 0%,#e8f3fc 45%,#cfe6f7 100%);
  overflow:hidden;
}

/* ---------- hero ---------- */
.nx-hero{display:grid;grid-template-columns:33fr 67fr;}
.nx-hero-txt{padding:0 48px 36px 64px;display:flex;flex-direction:column;justify-content:center;}
.nx-brand{display:flex;align-items:center;gap:28px;margin-top:44px;}
.nx-logo{width:120px;height:120px;object-fit:contain;flex-shrink:0;}
.nx-jurp{font-family:'Sora',sans-serif;font-weight:800;font-size:44px;line-height:1;color:var(--navy);}
.nx-nex{font-family:'Sora',sans-serif;font-weight:800;font-size:72px;line-height:1.02;letter-spacing:-1px;color:var(--navy);}
.nx-hidra{color:var(--azul);}
.nx-eyebrow{font-family:'Sora',sans-serif;font-weight:700;font-size:22px;letter-spacing:2px;color:var(--azul);margin:18px 0 0;}
.nx-junta{font-family:'Sora',sans-serif;font-weight:600;font-size:18px;letter-spacing:2.5px;
  margin:10px 0 0;padding-top:10px;border-top:3px solid var(--cielo);align-self:flex-start;
  color:var(--navy);}
.nx-lead{font-size:21px;line-height:1.55;color:var(--texto);max-width:560px;margin:14px 0 0;text-wrap:pretty;}

.nx-hero-img{position:relative;aspect-ratio:900/387;}
/* la foto se vuelve transparente en el borde inferior y en el izquierdo:
   no se pinta un degradado encima, se recorta con mascara */
.nx-hero-img img{width:100%;height:100%;object-fit:cover;display:block;
  --mascara-abajo:linear-gradient(to bottom,#000 68%,rgba(0,0,0,.5) 87%,rgba(0,0,0,0) 100%);
  --mascara-izq:linear-gradient(to right,rgba(0,0,0,0) 0,#000 7%);
  -webkit-mask-image:var(--mascara-abajo),var(--mascara-izq);
  -webkit-mask-composite:source-in;
  mask-image:var(--mascara-abajo),var(--mascara-izq);
  mask-composite:intersect;}
.nx-hero-cap{position:absolute;right:32px;bottom:58px;margin:0;max-width:330px;
  background:rgba(11,42,91,.82);color:#fff;font-weight:600;font-size:19px;line-height:1.5;
  padding:20px 26px;border-radius:14px;backdrop-filter:blur(4px);}

/* ---------- panel soluciones ---------- */
.nx-panel{position:relative;margin:0 40px;background:#fff;border-radius:28px;
  box-shadow:0 24px 60px rgba(11,42,91,.12);padding:34px 44px;}
.nx-cards{display:grid;grid-template-columns:1fr 1fr 1fr;gap:44px;}

.nx-card{display:flex;flex-direction:column;gap:18px;padding:16px 14px 18px;border-radius:20px;
  text-decoration:none;color:inherit;
  border:2px solid transparent;transition:background .25s,transform .25s,box-shadow .25s,border-color .25s;}
.nx-card-on{cursor:pointer;}
.nx-card-on:hover{background:var(--tint);border-color:var(--c);transform:translateY(-6px);
  box-shadow:0 16px 36px rgba(11,42,91,.16);}

.nx-card-top{display:flex;gap:20px;align-items:flex-start;}
.nx-phone{position:relative;flex-shrink:0;background:#10203c;border-radius:30px;padding:8px;
  box-shadow:0 14px 30px rgba(11,42,91,.28);width:138px;}
.nx-notch{position:absolute;top:0;left:50%;transform:translateX(-50%);width:56px;height:16px;
  background:#10203c;border-radius:0 0 12px 12px;z-index:2;}
.nx-phone img{width:100%;height:264px;object-fit:cover;border-radius:22px;display:block;}

.nx-card-id{padding-top:6px;min-width:0;}
.nx-badge{width:58px;height:58px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:var(--tint);}
.nx-name{font-family:'Sora',sans-serif;font-weight:800;font-size:33px;letter-spacing:.5px;
  color:var(--navy);margin:12px 0 0;}
.nx-name span{color:var(--c);}
.nx-tag{font-family:'Sora',sans-serif;font-weight:700;font-size:15.5px;letter-spacing:1.5px;
  color:var(--c);margin:8px 0 0;line-height:1.4;}
.nx-desc{font-size:17.5px;line-height:1.55;color:var(--texto);margin:0;text-wrap:pretty;}

.nx-feats{display:flex;gap:12px;list-style:none;padding:0;margin:0 0 auto;}
.nx-feats li{flex:1;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;}
.nx-fcircle{width:62px;height:62px;border-radius:50%;border:2.5px solid var(--c);background:#fff;
  display:flex;align-items:center;justify-content:center;}
.nx-flabel{font-weight:800;font-size:13px;letter-spacing:.8px;color:var(--navy);line-height:1.35;}

.nx-btn{width:100%;border:none;border-radius:12px;padding:13px 18px;text-decoration:none;
  font-family:'Sora',sans-serif;font-weight:700;font-size:16px;letter-spacing:1.8px;
  display:flex;align-items:center;justify-content:center;gap:10px;
  background:var(--c);color:#fff;cursor:pointer;transition:filter .2s,transform .2s;}
.nx-btn:hover:not(.nx-btn-off){filter:brightness(1.08);transform:translateY(-2px);}
.nx-btn:focus-visible{outline:3px solid var(--navy);outline-offset:3px;}
.nx-btn-off{background:#eef4fa;color:#93aac2;cursor:not-allowed;}

.nx-espacio{height:36px;}

/* ================= MOVIL: se apila y hace scroll normal ================= */
.nx-viewport.nx-movil{position:relative;inset:auto;display:block;overflow:visible;
  min-height:100vh;background:linear-gradient(160deg,#f4faff 0%,#e8f3fc 45%,#cfe6f7 100%);}
.nx-movil .nx-stage{width:100%;transform:none!important;background:transparent;}
.nx-movil .nx-hero{grid-template-columns:1fr;}
.nx-movil .nx-hero-txt{padding:26px 20px 22px;text-align:center;align-items:center;}
.nx-movil .nx-brand{justify-content:center;gap:16px;margin-top:0;}
.nx-movil .nx-logo{width:72px;height:72px;}
.nx-movil .nx-jurp{font-size:26px;}
.nx-movil .nx-nex{font-size:42px;}
.nx-movil .nx-eyebrow{font-size:14px;letter-spacing:1.4px;margin-top:14px;}
.nx-movil .nx-junta{font-size:12.5px;letter-spacing:1.6px;align-self:center;}
.nx-movil .nx-lead{font-size:16px;margin-left:auto;margin-right:auto;}
.nx-movil .nx-hero-img{aspect-ratio:16/10;}
.nx-movil .nx-hero-img img{--mascara-izq:linear-gradient(to right,#000,#000);}
.nx-movil .nx-hero-cap{left:14px;right:14px;bottom:30px;max-width:none;font-size:14px;padding:12px 16px;}
.nx-movil .nx-panel{margin:22px 14px 0;padding:22px 16px;border-radius:22px;}
.nx-movil .nx-cards{grid-template-columns:1fr;gap:26px;}
.nx-movil .nx-card-top{flex-direction:column;align-items:center;text-align:center;gap:14px;}
.nx-movil .nx-badge{margin:0 auto;width:50px;height:50px;}
.nx-movil .nx-name{font-size:28px;margin-top:10px;}
.nx-movil .nx-tag{font-size:13px;}
.nx-movil .nx-desc{font-size:15.5px;}
.nx-movil .nx-flabel{font-size:11px;}
.nx-movil .nx-fcircle{width:52px;height:52px;}
.nx-movil .nx-espacio{height:24px;}

@media (prefers-reduced-motion:reduce){
  .nx-card,.nx-btn{transition:none;}
}
`;