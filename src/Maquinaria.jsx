/* =====================================================================
     PEGA ESTO EN Maquinaria.jsx reemplazando desde la línea

         return (
           <div style={{ height: '100%', overflowY: 'auto', ... }}>

     hasta el final del PAGINADOR — es decir, la línea anterior a este
     comentario del archivo:

         {/* ── Modal: elegir formato del reporte de flota ───────────── *​/}

     Los tres modales y el <MantenedorEquipos> de abajo NO se tocan, ni
     tampoco las dos etiquetas </div> que cierran al final del archivo.
     ===================================================================== */

  // Colores por estado: se propagan a la franja, el icono y la banda.
  const ESTADOS = {
    disponible:    { c: '#16a34a', tinte: '#f0fdf4', texto: 'DISPONIBLE' },
    incidente:     { c: '#d63939', tinte: '#fef2f2', texto: 'EN INCIDENTE' },
    mantenimiento: { c: '#d97706', tinte: '#fff7ed', texto: 'EN MANTENIMIENTO' },
  };

  return (
    <div className="maq-wrap">

      {/* ══════════════ CABECERA ══════════════ */}
      <header className="maq-head">
        <div>
          <div className="maq-pretitulo">Gestión de Flota</div>
          <h2 className="maq-titulo">Panel de Maquinaria</h2>
        </div>
        <div className="maq-acciones">
          <button className="maq-btn" onClick={() => setMantenedorAbierto(true)}>
            <FaCog /> Gestionar catálogo
          </button>
          <button className="maq-btn maq-btn-primario" onClick={() => setModalReporteFlota(true)}
            disabled={cargando || maquinas.length === 0} title="Reporte de toda la flota">
            <FaDownload /> Reporte
          </button>
          <button className="maq-btn" onClick={cargar}>
            <FaSyncAlt className={cargando ? 'spin-anim' : ''} /> Actualizar
          </button>
        </div>
      </header>

      <div className="maq-body">

        {/* ══════════════ INDICADORES ══════════════ */}
        <div className="maq-kpis">
          <div className="maq-kpi" style={{ '--c': '#1268C3' }}>
            <div className="maq-kpi-label"><FaTruck /> Total máquinas</div>
            <div className="maq-kpi-valor">{maquinas.length}</div>
          </div>
          <div className="maq-kpi" style={{ '--c': '#16a34a' }}>
            <div className="maq-kpi-label"><FaCheckCircle /> Disponibles</div>
            <div className="maq-kpi-valor">{disponibles}</div>
          </div>
          <div className="maq-kpi" style={{ '--c': '#d63939' }}>
            <div className="maq-kpi-label"><FaExclamationTriangle /> En incidente</div>
            <div className="maq-kpi-valor">{ocupadas}</div>
          </div>
          <div className="maq-kpi" style={{ '--c': '#d97706' }}>
            <div className="maq-kpi-label"><FaTools /> En mantenimiento</div>
            <div className="maq-kpi-valor">{enMantenimiento}</div>
          </div>
        </div>

        {/* ══════════════ FILTROS ══════════════ */}
        <div className="maq-filtros">
          <span className="maq-filtros-label"><FaSearch size={11} /> Filtrar</span>
          <select className="maq-select" value={filtroOrigen} onChange={e => setFiltroOrigen(e.target.value)}>
            <option value="">Todos los orígenes</option>
            <option value="JURP">JURP (propia)</option>
            <option value="EXTERNA">Externa</option>
          </select>
          <select className="maq-select" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
            <option value="">Todos los estados</option>
            <option value="0">Solo disponibles</option>
            <option value="1">Solo en incidente</option>
            <option value="mant">Solo en mantenimiento</option>
          </select>
          <div className="maq-buscar">
            <FaSearch size={12} />
            <input type="text" placeholder="Buscar código, equipo, modelo, placa…"
              value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            {busqueda && (
              <button className="maq-buscar-x" onClick={() => setBusqueda('')} title="Limpiar">
                <FaTimes size={12} />
              </button>
            )}
          </div>
          {busqueda && <span className="maq-contador">{maquinasFiltradas.length} de {maquinas.length}</span>}
        </div>

        {/* ══════════════ REJILLA ══════════════ */}
        {cargando ? (
          <div className="maq-estado-vacio">
            <FaSyncAlt className="spin-anim icono" size={30} />
            <div className="titulo">Cargando maquinaria…</div>
          </div>
        ) : maquinas.length === 0 ? (
          <div className="maq-estado-vacio">
            <FaTruck className="icono" size={44} />
            <div className="titulo">No hay máquinas que coincidan con el filtro</div>
          </div>
        ) : maquinasFiltradas.length === 0 ? (
          <div className="maq-estado-vacio">
            <FaSearch className="icono" size={38} />
            <div className="titulo">Ninguna máquina coincide con "{busqueda}"</div>
            <button className="maq-accion verde" style={{ width: 'auto', padding: '9px 18px' }}
              onClick={() => setBusqueda('')}>Limpiar búsqueda</button>
          </div>
        ) : (
          <div className="maq-grid">
            {maquinasPagina.map(m => {
              const enMant = !!m.en_mantenimiento;
              const ocupada = !m.disponible && !enMant;
              const est = enMant ? ESTADOS.mantenimiento : (ocupada ? ESTADOS.incidente : ESTADOS.disponible);
              return (
                <div key={m.id} className="maq-card"
                  style={{ '--c': est.c, '--tinte': est.tinte }}
                  onClick={() => abrirDetalle(m)}>

                  {/* banda de estado */}
                  <div className="maq-card-banda">
                    {enMant ? <FaTools color={est.c} size={13} />
                      : ocupada ? <FaExclamationTriangle color={est.c} size={13} />
                      : <FaCheckCircle color={est.c} size={13} />}
                    <span className="maq-card-estado">{est.texto}</span>
                    <span className={`maq-origen ${m.origen === 'JURP' ? 'jurp' : 'ext'}`}>
                      {m.origen === 'JURP' ? 'JURP' : 'EXT'}
                    </span>
                  </div>

                  <div className="maq-card-cuerpo">
                    <div className="maq-codigo"><FaTruck size={14} /> {m.codigo}</div>
                    <div className="maq-equipo">{m.equipo} · {m.marca}</div>
                    <div className="maq-modelo">
                      {m.modelo && <span>Modelo: <b>{m.modelo}</b></span>}
                      {m.modelo && m.placa && ' · '}
                      {m.placa && <span>Placa: <b>{m.placa}</b></span>}
                    </div>

                    {/* ocupada con parte abierto */}
                    {ocupada && m.parte_activo && (
                      <div className="maq-aviso rojo">
                        <div className="maq-aviso-tit">{m.parte_activo.part_number}</div>
                        {m.parte_activo.incidente_tipo && <p style={{ fontWeight: 600 }}>{m.parte_activo.incidente_tipo}</p>}
                        <p><FaMapMarkerAlt size={10} /> {m.parte_activo.incidente_lugar || 'Sin ubicación'}</p>
                        {m.parte_activo.incidente_id && irAIncidente && (
                          <button className="maq-accion rojo"
                            onClick={(e) => { e.stopPropagation(); irAIncidente(m.parte_activo.incidente_id); }}>
                            <FaExternalLinkAlt size={10} /> Ir a la incidencia
                          </button>
                        )}
                      </div>
                    )}

                    {/* ocupada sin parte abierto */}
                    {ocupada && !m.parte_activo && (
                      <div className="maq-aviso rojo">
                        <div className="nota">Marcada como ocupada, pero sin parte abierto.</div>
                        {m.ultimo_parte && (
                          <div style={{ marginTop: 6 }}>
                            <p style={{ fontSize: 11 }}>Último parte: <b>{m.ultimo_parte.part_number}</b> · {m.ultimo_parte.date}</p>
                            {m.ultimo_parte.incidente_lugar && <p style={{ fontSize: 11 }}>📍 {m.ultimo_parte.incidente_lugar}</p>}
                            {m.ultimo_parte.incidente_id && irAIncidente && (
                              <button className="maq-accion rojo"
                                onClick={(e) => { e.stopPropagation(); irAIncidente(m.ultimo_parte.incidente_id); }}>
                                <FaExternalLinkAlt size={10} /> Ir a la incidencia
                              </button>
                            )}
                          </div>
                        )}
                        <button className="maq-accion verde"
                          onClick={(e) => { e.stopPropagation(); liberarMaquina(m); }}>
                          <FaCheckCircle size={11} /> Liberar máquina
                        </button>
                      </div>
                    )}

                    {/* en mantenimiento */}
                    {enMant && (
                      <div className="maq-aviso ambar">
                        <div className="maq-aviso-tit"><FaTools size={11} /> En mantenimiento</div>
                        {m.mantenimiento_obs && <p>{m.mantenimiento_obs}</p>}
                        {m.mantenimiento_inicio && <small>Desde: {new Date(m.mantenimiento_inicio).toLocaleString('es-PE')}</small>}
                      </div>
                    )}

                    {/* enviar / sacar de mantenimiento */}
                    {!ocupada && (
                      <button className={`maq-accion ${enMant ? 'verde' : 'ambar'}`}
                        onClick={(e) => { e.stopPropagation(); toggleMantenimiento(m); }}>
                        <FaTools size={11} /> {enMant ? 'Marcar operativa' : 'Enviar a mantenimiento'}
                      </button>
                    )}

                    <div className="maq-historial"><FaHistory size={10} /> Ver historial de partes →</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ══════════════ PAGINADOR ══════════════ */}
        {maquinasFiltradas.length > PORPAGINA && (
          <div className="maq-paginador">
            <button className="maq-pag" onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={paginaSegura === 1}>
              ← Anterior
            </button>

            {Array.from({ length: totalPaginas }, (_, i) => i + 1)
              .filter(n => n === 1 || n === totalPaginas || Math.abs(n - paginaSegura) <= 1)
              .map((n, idx, arr) => (
                <span key={n} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {idx > 0 && arr[idx - 1] !== n - 1 && <span className="maq-pag-puntos">…</span>}
                  <button className={`maq-pag maq-pag-num ${n === paginaSegura ? 'activo' : ''}`}
                    onClick={() => setPagina(n)}>{n}</button>
                </span>
              ))}

            <button className="maq-pag" onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={paginaSegura === totalPaginas}>
              Siguiente →
            </button>

            <span className="maq-pag-info">
              Página {paginaSegura} de {totalPaginas} · {maquinasFiltradas.length} máquinas
            </span>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
          PEGA TODO ESTO AL FINAL DE Maquinaria.jsx, justo después del
          bloque del PAGINADOR (donde ahora termina el archivo).
          Es la parte que se borró: los tres modales, el mantenedor, los
          cierres del componente y las constantes de estilo.
          ══════════════════════════════════════════════════════════════════ */}

      {/* ── Modal: elegir formato del reporte de flota ─────────────────── */}
      {modalReporteFlota && (
        <div onClick={() => !generandoFlota && setModalReporteFlota(false)}
          style={{ position:'fixed', inset:0, zIndex:10001, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', padding:'16px' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'#fff', borderRadius:'12px', width:'100%', maxWidth:'440px', overflow:'hidden', boxShadow:'0 20px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 18px', borderBottom:'1px solid #e2e8f0', background:'#f8fafc' }}>
              <h5 style={{ margin:0, fontSize:'16px', color:'#1e293b', display:'flex', alignItems:'center', gap:'8px' }}>
                <FaTruck color="#0ea5e9" /> Reporte de Maquinaria
              </h5>
              <button onClick={() => !generandoFlota && setModalReporteFlota(false)} disabled={generandoFlota} style={xBtnStyle}><FaTimes /></button>
            </div>
            <div style={{ padding:'20px 18px' }}>
              <p style={{ margin:'0 0 6px', fontSize:'13px', color:'#334155' }}>
                Se generará un archivo con <b>{maquinasFiltradas.length} máquina(s)</b>, cada una con el
                detalle de sus partes diarios.
              </p>
              {(filtroOrigen || filtroEstado || busqueda.trim()) && (
                <p style={{ margin:'6px 0', fontSize:'12px', color:'#0369a1', background:'#f0f9ff', border:'1px solid #bae6fd', borderRadius:'6px', padding:'8px 10px' }}>
                  Se aplicarán los filtros activos ({maquinasFiltradas.length} de {maquinas.length}).
                </p>
              )}
              <p style={{ margin:'12px 0 16px', fontSize:'13px', color:'#64748b' }}>Elige el formato:</p>
              {generandoFlota ? (
                <div style={{ textAlign:'center', padding:'24px 0' }}>
                  <FaSyncAlt className="spin-anim" style={{ fontSize:'26px', color:'#0ea5e9' }} />
                  <p style={{ fontSize:'13px', color:'#64748b', marginTop:'10px' }}>Generando reporte…</p>
                </div>
              ) : (
                <div style={{ display:'flex', gap:'12px' }}>
                  <button onClick={reporteFlotaPDF}
                    style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'8px', padding:'18px 12px', background:'#fef2f2', color:'#b91c1c', border:'2px solid #fecaca', borderRadius:'10px', cursor:'pointer', fontSize:'14px', fontWeight:700 }}>
                    <FaFilePdf size={26} /> PDF
                  </button>
                  <button onClick={reporteFlotaExcel}
                    style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:'8px', padding:'18px 12px', background:'#f0fdf4', color:'#15803d', border:'2px solid #bbf7d0', borderRadius:'10px', cursor:'pointer', fontSize:'14px', fontWeight:700 }}>
                    <FaDownload size={26} /> Excel
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal de historial de partes ───────────────────────────────── */}
      {detalle && (
        <div onClick={() => { setDetalle(null); setHistorial(null); }} style={overlayStyle}>
          <div onClick={e => e.stopPropagation()} style={{ ...modalStyle, maxWidth: '1400px', maxHeight: '94vh' }}>
            <div style={modalHeadStyle}>
              <h5 style={{ margin: 0, fontSize: '16px', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FaTruck color="#475569" /> {detalle.codigo} · {detalle.modelo || detalle.placa}
              </h5>
              <button onClick={() => { setDetalle(null); setHistorial(null); }} style={xBtnStyle}><FaTimes /></button>
            </div>

            <div style={{ padding: '18px', overflowY: 'auto' }}>
              {/* Badge de estado */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: detalle.en_mantenimiento ? '#fff7ed' : (detalle.disponible ? '#f0fdf4' : '#fef2f2'),
                color: detalle.en_mantenimiento ? '#d97706' : (detalle.disponible ? '#16a34a' : '#dc2626'),
                padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, marginBottom: '14px' }}>
                {detalle.en_mantenimiento ? <FaTools size={12} /> : (detalle.disponible ? <FaCheckCircle size={12} /> : <FaExclamationTriangle size={12} />)}
                {detalle.en_mantenimiento ? 'EN MANTENIMIENTO' : (detalle.disponible ? 'DISPONIBLE' : 'EN INCIDENTE')}
              </div>

              {/* Datos de la máquina */}
              <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
                <Campo label="Equipo" valor={`${detalle.equipo} · ${detalle.marca}`} />
                <Campo label="Modelo" valor={detalle.modelo} />
                <Campo label="Placa" valor={detalle.placa} />
                <Campo label="Origen" valor={detalle.origen_texto} />
              </div>

              {/* Totales del historial */}
              {historial && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '14px' }}>
                  <div style={{ background: '#eff6ff', borderRadius: '6px', padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>PARTES</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#206bc4' }}>{historial.total_partes}</div>
                  </div>
                  <div style={{ background: '#fffbeb', borderRadius: '6px', padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>HORAS</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#b45309' }}>{historial.total_horas}</div>
                  </div>
                  <div style={{ background: '#f0fdf4', borderRadius: '6px', padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>COSTO</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#16a34a' }}>S/ {fmtNum(historial.total_costo)}</div>
                  </div>
                </div>
              )}

              {/* Lista de partes */}
              <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FaHistory size={11} /> Historial de partes diarios
                </div>
                {historial && historial.partes && historial.partes.length > 0 && (
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                    <button onClick={exportarHistorialExcel} title="Descargar en Excel"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#dcfce7', color: '#15803d', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                      <FaDownload size={11} /> Excel
                    </button>
                    <button onClick={exportarHistorialPDF} title="Descargar en PDF"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                      <FaFilePdf size={11} /> PDF
                    </button>
                  </div>
                )}
              </div>

              {cargandoHist ? (
                <div style={{ textAlign: 'center', padding: '30px', color: '#94a3b8' }}>
                  <FaSyncAlt className="spin-anim" style={{ fontSize: '22px' }} />
                  <p style={{ fontSize: '13px' }}>Cargando historial…</p>
                </div>
              ) : !historial ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>
                  No se pudo cargar el historial.
                </div>
              ) : historial.partes.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '13px', fontStyle: 'italic' }}>
                  Esta máquina aún no tiene partes diarios registrados.
                </div>
              ) : (
                <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #e2e8f0' }}>
                        <th style={{ textAlign: 'left', padding: '10px 10px', fontSize: '11px', color: '#475569', whiteSpace: 'nowrap' }}>N° PARTE</th>
                        <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>FECHA</th>
                        <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>ESTADO</th>
                        <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>ACTIVIDAD</th>
                        <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>VOLUMEN</th>
                        <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>HORAS</th>
                        <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>COMBUST.</th>
                        <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>PROVEEDOR</th>
                        <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: '11px', color: '#475569', whiteSpace: 'nowrap' }}>N° INCIDENCIA</th>
                        <th style={{ textAlign: 'right', padding: '10px 8px', fontSize: '11px', color: '#475569' }}>TOTAL</th>
                        <th style={{ textAlign: 'right', padding: '10px 14px', fontSize: '11px', color: '#475569' }}>PDF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historial.partes.map(p => (
                        <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9', background: p.cerrado ? '#fff' : '#fffbeb' }}>
                          <td style={{ padding: '11px 10px', fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap' }}>{p.part_number}</td>
                          <td style={{ padding: '11px 8px', color: '#475569', whiteSpace: 'nowrap' }}>{p.date ? p.date.split('T')[0].split('-').reverse().join('/') : '—'}</td>
                          <td style={{ padding: '11px 8px' }}>
                            <span style={{ fontSize: '10px', fontWeight: 700, padding: '3px 9px', borderRadius: '4px', background: p.cerrado ? '#dcfce7' : '#fef3c7', color: p.cerrado ? '#15803d' : '#b45309', whiteSpace: 'nowrap' }}>
                              {p.cerrado ? 'CERRADO' : 'ABIERTO'}
                            </span>
                          </td>
                          <td style={{ padding: '11px 8px', color: '#475569', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.activities || ''}>{p.activities || '—'}</td>
                          <td style={{ padding: '11px 8px', textAlign: 'right', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>{fmtNum(p.metrado || 0)} {uMet(p.metrado_unidad)}</td>
                          <td style={{ padding: '11px 8px', textAlign: 'right', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap' }}>{fmtNum(p.horas)} HE</td>
                          <td style={{ padding: '11px 8px', textAlign: 'right', color: '#334155', whiteSpace: 'nowrap' }}>{fmtNum(p.fuel_gallons || 0)} Gls</td>
                          <td style={{ padding: '11px 8px', color: '#475569', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.provider || ''}>{p.provider || '—'}</td>
                          <td style={{ padding: '11px 8px', color: '#475569', whiteSpace: 'nowrap' }}>{p.incidente_codigo || (p.incidente_id ? `#${p.incidente_id}` : '—')}</td>
                          <td style={{ padding: '11px 8px', textAlign: 'right', fontWeight: 700, color: '#1463A5', whiteSpace: 'nowrap' }}>S/ {fmtNum(p.costo)}</td>
                          <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                            <button onClick={() => abrirPdfParte(p.id, p.part_number)} title="Ver PDF"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: '#e0f2fe', color: '#0284c7', border: 'none', borderRadius: '5px', padding: '5px 10px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                              <FaFilePdf size={11} /> PDF
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                        <td colSpan="4" style={{ padding: '13px 14px', fontWeight: 700, color: '#334155' }}>TOTAL · {historial.total_partes} parte{historial.total_partes !== 1 ? 's' : ''}</td>
                        <td style={{ padding: '13px 8px' }}></td>
                        <td style={{ padding: '13px 8px', textAlign: 'right', fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>{fmtNum(historial.total_horas)} HE</td>
                        <td style={{ padding: '13px 8px', textAlign: 'right', fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>{fmtNum(historial.partes.reduce((s, p) => s + (parseFloat(p.fuel_gallons) || 0), 0))} Gls</td>
                        <td style={{ padding: '13px 8px' }}></td>
                        <td style={{ padding: '13px 8px' }}></td>
                        <td style={{ padding: '13px 8px', textAlign: 'right', fontWeight: 800, fontSize: '15px', color: '#1463A5', whiteSpace: 'nowrap' }}>S/ {fmtNum(historial.total_costo)}</td>
                        <td style={{ padding: '13px 14px' }}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal visor de PDF ─────────────────────────────────────────── */}
      {pdfModal && (
        <div onClick={() => setPdfModal(null)} style={{ ...overlayStyle, zIndex: 10000, alignItems: 'flex-start', padding: '2vh 16px' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: '900px', height: '92vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: '10px', overflow: 'hidden' }}>
            <div style={modalHeadStyle}>
              <h5 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <FaFilePdf color="#dc2626" /> {pdfModal.nombre}
              </h5>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                <a href={pdfModal.url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '5px', background: '#206bc4', color: '#fff', textDecoration: 'none', borderRadius: '6px', padding: '6px 12px', fontSize: '13px', fontWeight: 600 }}>
                  <FaDownload size={13} /> Abrir aparte
                </a>
                <button onClick={() => setPdfModal(null)} style={xBtnStyle}><FaTimes /></button>
              </div>
            </div>
            <div style={{ flex: 1, backgroundColor: '#525659' }}>
              <iframe src={pdfModal.url} style={{ width: '100%', height: '100%', border: 'none' }} title="Visor PDF" />
            </div>
          </div>
        </div>
      )}

      {/* ── Mantenedor de catálogos (Equipos/Marcas/Modelos) ─────────────── */}
      <MantenedorEquipos
        abierto={mantenedorAbierto}
        onClose={() => { setMantenedorAbierto(false); cargar(); }}
      />

      </div>
    </div>
  );


// Componente auxiliar para mostrar un campo del detalle.
function Campo({ label, valor, icono }) {
  if (!valor) return null;
  return (
    <div style={{ display: 'flex', padding: '5px 0' }}>
      <div style={{ width: '110px', fontSize: '12px', color: '#94a3b8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
        {icono}{label}
      </div>
      <div style={{ fontSize: '13px', color: '#1e293b', flex: 1 }}>{valor}</div>
    </div>
  );
}

const overlayStyle = { position: 'fixed', inset: 0, zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' };
const modalStyle = { background: '#fff', borderRadius: '12px', width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const modalHeadStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc' };
const xBtnStyle = { background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '18px', display: 'flex' };

