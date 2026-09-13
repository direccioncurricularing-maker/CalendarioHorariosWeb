import { useState, useMemo } from 'react';
import { HORARIOS } from '../constants/horarios';
import { pruebasRegistradasService } from '../services/api';
import { getPostitStyle } from '../utils/colorUtils';
import { filterForSemester, parseFechaLocal } from '../utils/filtros';
import { PruebasSidebar } from './PruebasSidebar';
import '../styles/CalendarView.css';

// Semana de lunes a domingo (getDay(): 0=Domingo .. 6=Sábado)
const DIAS_SEMANA_CALENDARIO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const INICIALES_DIAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const indiceDiaSemana = (fecha) => (fecha.getDay() + 6) % 7;

export function CalendarView({ 
  fechaInicio, 
  fechaFin, 
  pruebasRegistradas = [],
  pruebasProgramables = [],
  dashboardId,
  onPruebasChanged = () => {},
  filtroEspecialidad = 'TODOS',
  filtroSemestre = [],
  onFiltroEspecialidadChange = () => {},
  onFiltroSemestreChange = () => {},
  filtrarPrueba = () => true,
  feriados = [],
  onToggleFeriado = () => {}
}) {
  const [modoVisualizacion, setModoVisualizacion] = useState('cascada');
  const [semestreActual, setSemestreActual] = useState(0);

  const fechaInicioDate = useMemo(() => parseFechaLocal(fechaInicio), [fechaInicio]);
  const fechaFinDate = useMemo(() => parseFechaLocal(fechaFin), [fechaFin]);

  const [fechaActual, setFechaActual] = useState(() => parseFechaLocal(fechaInicio) || new Date());

  // Generar array de todos los meses en el rango
  const todosLosMeses = useMemo(() => {
    if (!fechaInicioDate || !fechaFinDate) return [];
    const meses = [];
    const inicio = new Date(fechaInicioDate.getFullYear(), fechaInicioDate.getMonth(), 1);
    const fin = new Date(fechaFinDate.getFullYear(), fechaFinDate.getMonth(), 1);
    let iter = new Date(inicio);
    while (iter <= fin) {
      meses.push(new Date(iter));
      iter = new Date(iter.getFullYear(), iter.getMonth() + 1, 1);
    }
    return meses;
  }, [fechaInicioDate, fechaFinDate]);

  // Si no hay fechas de rango, mostrar mensaje (después de todos los hooks)
  if (!fechaInicio || !fechaFin) {
    return (
      <div className="calendar-container">
        <div className="calendar-view">
          <div className="empty-calendar-message">
            <p>⚠️ Este dashboard no tiene un rango de fechas definido.</p>
            <p>Por favor edita el dashboard para establecer las fechas de inicio y fin.</p>
          </div>
        </div>
      </div>
    );
  }

  // Generar array de días del mes
  const getDiasDelMes = (fecha) => {
    if (!fecha) return [];
    const year = fecha.getFullYear();
    const month = fecha.getMonth();
    const primerDia = new Date(year, month, 1);
    const ultimoDia = new Date(year, month + 1, 0);
    const diasEnMes = ultimoDia.getDate();
    const primerDiaDelMes = indiceDiaSemana(primerDia);
    const dias = [];
    for (let i = 0; i < primerDiaDelMes; i++) dias.push(null);
    for (let i = 1; i <= diasEnMes; i++) dias.push(new Date(year, month, i));
    return dias;
  };

  // Obtener pruebas registradas para un día específico
  // Usar parseFechaLocal para evitar timezone issues con toISOString()
  const formatFechaLocal = (fecha) => {
    if (!fecha) return '';
    const d = parseFechaLocal(fecha);
    if (!d) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const getPruebasDelDia = (fecha) => {
    if (!fecha) return [];
    const fechaStr = formatFechaLocal(fecha);
    return pruebasRegistradas.filter(p => {
      if (!p.fecha) return false;
      const pruebaFechaStr = formatFechaLocal(p.fecha);
      return pruebaFechaStr === fechaStr;
    });
  };

  // Función helper para obtener el programable de una prueba
  const getPruebaProgramable = (pruebaProgId) => {
    return pruebasProgramables.find(pp => pp.id === pruebaProgId);
  };

  // Navegación mensual
  const puedeNavAnterior = () => {
    const anteriorMes = new Date(fechaActual.getFullYear(), fechaActual.getMonth() - 1);
    return anteriorMes.getFullYear() > fechaInicioDate.getFullYear() || 
           (anteriorMes.getFullYear() === fechaInicioDate.getFullYear() && anteriorMes.getMonth() >= fechaInicioDate.getMonth());
  };

  const puedeNavSiguiente = () => {
    const siguienteMes = new Date(fechaActual.getFullYear(), fechaActual.getMonth() + 1);
    return siguienteMes.getFullYear() < fechaFinDate.getFullYear() || 
           (siguienteMes.getFullYear() === fechaFinDate.getFullYear() && siguienteMes.getMonth() <= fechaFinDate.getMonth());
  };

  const puedeNavHoy = () => {
    const today = new Date();
    return today >= fechaInicioDate && today <= fechaFinDate;
  };

  const mesAnterior = () => {
    const nuevoMes = new Date(fechaActual.getFullYear(), fechaActual.getMonth() - 1);
    if (nuevoMes.getFullYear() > fechaInicioDate.getFullYear() || 
        (nuevoMes.getFullYear() === fechaInicioDate.getFullYear() && nuevoMes.getMonth() >= fechaInicioDate.getMonth())) {
      setFechaActual(nuevoMes);
    }
  };

  const mesSiguiente = () => {
    const nuevoMes = new Date(fechaActual.getFullYear(), fechaActual.getMonth() + 1);
    if (nuevoMes.getFullYear() < fechaFinDate.getFullYear() || 
        (nuevoMes.getFullYear() === fechaFinDate.getFullYear() && nuevoMes.getMonth() <= fechaFinDate.getMonth())) {
      setFechaActual(nuevoMes);
    }
  };

  const hoy = () => {
    const today = new Date();
    if (today >= fechaInicioDate && today <= fechaFinDate) {
      setFechaActual(today);
    }
  };

  const nombreMeses = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  const diasSemana = DIAS_SEMANA_CALENDARIO;

  // ── Filtro por semestre (misma lógica que TimeTable) ──
  function filterForSemesterLocal(semestreId) {
    return (p) => {
      if (!filtrarPrueba(p)) return false;
      return filterForSemester(p, semestreId);
    };
  }

  // ── Detección de día no coincidente (frontend) ──
  // NOTA: Usar getUTCDay() para evitar timezone issues. PostgreSQL almacena DATE como "YYYY-MM-DD"
  // sin timezone. new Date("2024-03-15") en Chile (UTC-3) da el día ANTERIOR si usamos getDay().
  const getDayMismatchWarning = (prueba) => {
    const prog = getPruebaProgramable(prueba.prueba_programable_id);
    if (!prog) return null;
    const tipo = (prog.tipo_prueba || '').toUpperCase();
    if (!['CLASE', 'AYUDANTIA', 'LAB/TALLER'].includes(tipo)) return null;

    let bloques = prog.bloques_horario;
    if (!bloques) return null;
    if (typeof bloques === 'string') {
      try { bloques = JSON.parse(bloques); } catch { return null; }
    }
    if (!Array.isArray(bloques) || bloques.length === 0) return null;

    const diasSemanaFull = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const fechaPrueba = new Date(prueba.fecha);
    // Usar getUTCDay() para evitar timezone (la fecha viene como "YYYY-MM-DD" desde PostgreSQL)
    const diaPrueba = diasSemanaFull[fechaPrueba.getUTCDay()];

    // Normalizar hora
    const norm = (h) => {
      if (!h) return null;
      const [hh, mm] = String(h).substring(0, 5).split(':');
      return `${parseInt(hh)}:${mm}`;
    };

    const horaInicio = norm(prueba.hora_inicio);
    const horaFin = norm(prueba.hora_fin);

    if (horaInicio && horaFin) {
      // Buscar el bloque específico que coincida con la hora seleccionada
      const bloqueSeleccionado = bloques.find(b => {
        const bInicio = b.inicio ? norm(b.inicio) : null;
        const bFin = b.fin ? norm(b.fin) : null;
        return bInicio === horaInicio && bFin === horaFin;
      });

      if (bloqueSeleccionado && bloqueSeleccionado.dia) {
        if (bloqueSeleccionado.dia !== diaPrueba) {
          return `📅 Día no coincide: bloque ${bloqueSeleccionado.dia} ${horaInicio}-${horaFin} pero prueba en ${diaPrueba}`;
        }
        return null;
      }
    }

    // Si no hay hora seleccionada, verificar contra todos los días
    const diasHorario = [...new Set(bloques.map(b => b.dia).filter(Boolean))];
    if (diasHorario.length === 0) return null;

    if (!diasHorario.includes(diaPrueba)) {
      return `📅 Día no coincide: ${tipo} es ${diasHorario.join('/')} pero prueba en ${diaPrueba}`;
    }
    return null;
  };

  // ── Helper de formato de tiempo ──
  const formatTime = (t) => {
    if (!t) return null;
    const s = typeof t === 'string' ? t.substring(0, 5) : t;
    const [h, m] = String(s).split(':');
    return `${parseInt(h)}:${m}`;
  };

  // ── Render del calendario para un semestre y mes ──
  const renderCalendar = (semestre, monthDate = null) => {
    const semestreFilter = filterForSemesterLocal(semestre.id);
    const targetMonth = monthDate || fechaActual;
    const diasDelMes = getDiasDelMes(targetMonth);

    return (
      <div className="calendar-view">
        <h3 className="calendar-semester-title" style={{ borderBottomColor: semestre.color }}>
          {semestre.nombre}
        </h3>

        <div className="calendar-grid">
          <div className="weekdays">
            {diasSemana.map(dia => (
              <div key={dia} className="weekday">{dia}</div>
            ))}
          </div>

          <div className="days-grid">
            {diasDelMes.map((fecha, index) => {
              if (!fecha) {
                return <div key={`empty-${index}`} className="day empty"></div>;
              }

              const todasPruebasDelDia = getPruebasDelDia(fecha);
              // Filtrar pruebas para este semestre. Si el catálogo aún no está
              // cargado, usar los datos que ya vienen en la prueba registrada.
              const pruebasDelDia = todasPruebasDelDia.filter(pr => {
                const prog = getPruebaProgramable(pr.prueba_programable_id) || pr;
                return semestreFilter(prog);
              });

              const esHoy = (
                fecha.getDate() === new Date().getDate() &&
                fecha.getMonth() === new Date().getMonth() &&
                fecha.getFullYear() === new Date().getFullYear()
              );
              const estaEnRango = fecha >= fechaInicioDate && fecha <= fechaFinDate;
              const estaFueraDeRango = !estaEnRango;
              const fechaStr = formatFechaLocal(fecha);
              const esFeriado = feriados.includes(fechaStr);

              return (
                <div
                  key={fechaStr}
                  className={`day ${esHoy ? 'today' : ''} ${estaEnRango ? 'in-range' : 'out-of-range'} ${pruebasDelDia.length > 0 ? 'has-pruebas' : ''} ${esFeriado ? 'feriado' : ''}`}
                  onDragOver={(e) => {
                    if (!estaEnRango) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={async (e) => {
                    if (!estaEnRango) return;
                    e.preventDefault();
                    
                    let data = null;
                    try { 
                      data = e.dataTransfer.getData('application/json'); 
                      if (data) data = JSON.parse(data);
                    } catch (err) { 
                      console.error('Error parsing drag data:', err);
                      return;
                    }
                    
                    if (!data) return;
                    
                    const ids = data.ids || (data.prueba ? [String(data.prueba.id)] : null);
                    
                    // Si es una prueba desde el sidebar (individual o grupo)
                    if (data.source === 'sidebar' && ids) {
                      const fechaStr = formatFechaLocal(fecha);
                      
                      try {
                        await Promise.all(ids.map(id =>
                          pruebasRegistradasService.crear(
                            id,
                            dashboardId,
                            fechaStr,
                            data.horaInicio || null,
                            data.horaFin || null
                          )
                        ));
                        onPruebasChanged();
                      } catch (err) {
                        console.error('Error creando prueba:', err);
                        alert(`Error: ${err.message}`);
                      }
                    }
                    
                    // Si es una prueba moviéndose entre celdas
                    if (data.type === 'prueba-registrada') {
                      const fechaStr = formatFechaLocal(fecha);
                      
                      try {
                        await pruebasRegistradasService.actualizar(
                          data.id,
                          fechaStr,
                          data.horaInicio || null,
                          data.horaFin || null
                        );
                        onPruebasChanged();
                      } catch (err) {
                        console.error('Error moviendo prueba:', err);
                        alert(`Error: ${err.message}`);
                      }
                    }
                  }}
                >
                  {estaEnRango && (
                    <button
                      className={`feriado-toggle ${esFeriado ? 'active' : ''}`}
                      title={esFeriado ? 'Quitar feriado' : 'Marcar como feriado'}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFeriado(fechaStr);
                      }}
                    >
                      {esFeriado ? '🔴' : '⚪'}
                    </button>
                  )}
                  <div className={`day-number ${estaFueraDeRango ? 'disabled' : ''}`}>{fecha.getDate()}</div>
                  <div className="day-name">
                    {INICIALES_DIAS[indiceDiaSemana(fecha)]}
                  </div>
                  {esFeriado && (
                    <div className="feriado-label">FERIADO</div>
                  )}
                  {estaEnRango && pruebasDelDia.length > 0 && (
                    <div className="pruebas-container">
                      {pruebasDelDia.map(prueba => {
                        const prog = getPruebaProgramable(prueba.prueba_programable_id) || prueba;
                        const tieneConflicto = Array.isArray(prueba.conflictos) && prueba.conflictos.length > 0;
                        const hasDayMismatch = Array.isArray(prueba.conflictos) && prueba.conflictos.includes(-2);
                        const hasProtectedSchedule = Array.isArray(prueba.conflictos) && prueba.conflictos.includes(-1);
                        const dayMismatchMsg = getDayMismatchWarning(prueba);
                        const colorStyle = prog 
                          ? getPostitStyle(prog.especialidades_semestres, tieneConflicto)
                          : {};
                        
                        const horaInicioStr = formatTime(prueba.hora_inicio);
                        const horaFinStr = formatTime(prueba.hora_fin);
                        const tieneHorario = horaInicioStr && horaFinStr;
                        
                        // Construir tooltip
                        let tooltip = `${prog?.titulo || 'Sin título'} - Sección ${prog?.seccion || '?'} - ${prog?.tipo_prueba || ''}`;
                        if (tieneHorario) tooltip += ` (${horaInicioStr}-${horaFinStr})`;
                        if (dayMismatchMsg) tooltip += `\n${dayMismatchMsg}`;
                        
                        return (
                          <div 
                            key={prueba.id} 
                            className={`prueba-tag ${tieneConflicto ? 'conflicting' : ''} ${hasDayMismatch ? 'day-mismatch' : ''} ${hasProtectedSchedule ? 'protected-schedule' : ''} tipo-${prog?.tipo_prueba?.toLowerCase().replace('/', '-')}`}
                            draggable={true}
                            style={colorStyle}
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = 'move';
                              e.dataTransfer.setData('application/json', JSON.stringify({
                                type: 'prueba-registrada',
                                id: prueba.id,
                                horaInicio: prueba.hora_inicio ? formatTime(prueba.hora_inicio) : null,
                                horaFin: prueba.hora_fin ? formatTime(prueba.hora_fin) : null
                              }));
                            }}
                            title={tooltip}
                          >
                            <div className="prueba-info">
                              <span className="prueba-codigo">{prog?.codigo || 'N/A'}-{prog?.seccion || '?'}</span>
                              <span className="prueba-titulo">{prog?.titulo || 'Sin título'}</span>
                              <span className="prueba-tipo">{prog?.tipo_prueba || ''}</span>
                              {tieneHorario && (
                                <span className="prueba-horario">{horaInicioStr}-{horaFinStr}</span>
                              )}
                              {hasDayMismatch && (
                                <span className="prueba-day-warning">📅 Día ≠ horario</span>
                              )}
                              {hasProtectedSchedule && (
                                <span className="prueba-protected-warning">🔒 Horario protegido</span>
                              )}
                            </div>
                            <button
                              className="prueba-remove-btn"
                              onClick={async (e) => {
                                e.stopPropagation();
                                
                                try {
                                  await pruebasRegistradasService.eliminar(prueba.id);
                                  onPruebasChanged();
                                } catch (err) {
                                  console.error('Error eliminando prueba:', err);
                                  alert(`Error: ${err.message}`);
                                }
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // ── Render calendario + sidebar para un semestre ──
  const renderCalendarWithSidebar = (semestre, monthDate = null) => (
    <div key={`${semestre.id}-${monthDate ? monthDate.getTime() : ''}`} className="calendar-with-sidebar">
      {renderCalendar(semestre, monthDate)}
      <div className="calendar-sidebar-container">
        <PruebasSidebar
          pruebas={pruebasProgramables}
          pruebasRegistradas={pruebasRegistradas}
          filterFn={filterForSemesterLocal(semestre.id)}
          dashboardId={dashboardId}
          filtroEspecialidad={filtroEspecialidad}
          filtroSemestre={filtroSemestre}
          onFiltroEspecialidadChange={onFiltroEspecialidadChange}
          onFiltroSemestreChange={onFiltroSemestreChange}
        />
      </div>
    </div>
  );

  return (
    <div className="calendar-container">
      {/* Navegación mensual solo en modo paginado */}
      {modoVisualizacion === 'paginado' && (
        <div className="calendar-header">
          <button onClick={mesAnterior} className="nav-btn" disabled={!puedeNavAnterior()}>← Anterior</button>
          <div className="month-year">
            <h2>{nombreMeses[fechaActual.getMonth()]} {fechaActual.getFullYear()}</h2>
            {fechaInicio && fechaFin && (
              <p className="date-range">
                Rango: {parseFechaLocal(fechaInicio)?.toLocaleDateString()} - {parseFechaLocal(fechaFin)?.toLocaleDateString()}
              </p>
            )}
          </div>
          <button onClick={mesSiguiente} className="nav-btn" disabled={!puedeNavSiguiente()}>Siguiente →</button>
          <button onClick={hoy} className="today-btn" disabled={!puedeNavHoy()}>Hoy</button>
        </div>
      )}

      {/* Controles de vista */}
      <div className="calendar-controls">
        <div className="view-mode-selector">
          <button
            className={`mode-btn ${modoVisualizacion === 'cascada' ? 'active' : ''}`}
            onClick={() => setModoVisualizacion('cascada')}
          >
            📋 Cascada
          </button>
          <button
            className={`mode-btn ${modoVisualizacion === 'paginado' ? 'active' : ''}`}
            onClick={() => setModoVisualizacion('paginado')}
          >
            📄 Paginado
          </button>
        </div>

        {modoVisualizacion === 'paginado' && (
          <div className="semester-selector">
            {HORARIOS.semestres.map((semestre, index) => (
              <button
                key={semestre.id}
                className={`semester-btn ${semestreActual === index ? 'active' : ''}`}
                onClick={() => setSemestreActual(index)}
                style={{
                  borderBottomColor: semestre.color,
                  color: semestreActual === index ? semestre.color : '#999'
                }}
              >
                {semestre.nombre}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grids del calendario */}
      {modoVisualizacion === 'cascada' ? (
        <div className="calendar-cascade">
          {todosLosMeses.map((mes, mesIdx) => (
            <div key={mesIdx} className="calendar-cascade-month">
              <h3 className="calendar-month-title">{nombreMeses[mes.getMonth()]} {mes.getFullYear()}</h3>
              {HORARIOS.semestres.map((semestre) => renderCalendarWithSidebar(semestre, mes))}
            </div>
          ))}
        </div>
      ) : (
        <div className="calendar-paginated">
          {renderCalendarWithSidebar(HORARIOS.semestres[semestreActual])}
        </div>
      )}

      <div className="calendar-legend">
        <div className="legend-item">
          <div className="legend-color today-legend"></div>
          <span>Hoy</span>
        </div>
        <div className="legend-item">
          <div className="legend-color pruebas-legend"></div>
          <span>Con Pruebas Registradas</span>
        </div>
        <div className="legend-item">
          <div className="legend-color day-mismatch-legend"></div>
          <span>Día ≠ Horario</span>
        </div>
        <div className="legend-item">
          <div className="legend-color protected-schedule-legend"></div>
          <span>🔒 Horario Protegido</span>
        </div>
        <div className="legend-item">
          <div className="legend-color feriado-legend"></div>
          <span>Feriado</span>
        </div>
        <div className="legend-item">
          <p style={{ margin: 0, fontSize: '12px', color: '#999' }}>
            Los días atenuados están fuera del rango de fechas. Clic en ⚪ para marcar feriado.
          </p>
        </div>
      </div>
    </div>
  );
}
