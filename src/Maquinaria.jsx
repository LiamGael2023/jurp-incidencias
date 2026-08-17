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