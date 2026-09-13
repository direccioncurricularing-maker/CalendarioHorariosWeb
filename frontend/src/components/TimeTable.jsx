import { useState, useEffect } from 'react';
import { HORARIOS } from '../constants/horarios';
import { horasRegistradasService } from '../services/api';
import { getPostitStyle, getTipoHorario } from '../utils/colorUtils';
import { filterForSemester, determinarSemestre } from '../utils/filtros';
import '../styles/TimeTable.css';
import HorariosSidebar from './HorariosSidebar';
import { undoManager, CrearCommand, MoverCommand, EliminarCommand } from '../commands';

export function TimeTable({ 
  dashboardId, 
  horariosProgramables = [],
  filtroEspecialidad = 'TODOS',
  filtroSemestre = [],
  onFiltroEspecialidadChange = () => {},
  onFiltroSemestreChange = () => {},
  filtrarHorario = () => true,
  refreshKey = 0
}) {
  const [modoVisualizacion, setModoVisualizacion] = useState('cascada');
  const [semestreActual, setSemestreActual] = useState(0);
  // placedItems: { [semestreId]: [ { id (BD), instanceId, hora_programable_id, codigo, seccion, titulo, tipo_hora, cantidad_horas, dia, bloqueIndex } ] }
  const [placedItems, setPlacedItems] = useState({});
  const [_cargando, setCargando] = useState(false);
  const [warningsMap, setWarningsMap] = useState({});  // { instanceId: [msg1, msg2, ...] }
  const [conflictingPostits, setConflictingPostits] = useState(new Set());
  const [draggedDisponibilidad, setDraggedDisponibilidad] = useState(null);
  const [operando, setOperando] = useState(false);
  const [_undoVersion, setUndoVersion] = useState(0);
  const [avisos, setAvisos] = useState([]);

  // Mapa de bloques: inicio -> rango completo
  const BLOQUES_MAP = {
    "8:30": "8:30-9:20", "9:30": "9:30-10:20", "10:30": "10:30-11:20",
    "11:30": "11:30-12:20", "12:30": "12:30-13:20", "13:30": "13:30-14:20",
    "14:30": "14:30-15:20", "15:30": "15:30-16:20", "16:30": "16:30-17:20",
    "17:30": "17:30-18:20", "18:30": "18:30-19:20", "19:30": "19:30-20:20"
  };

  // Normaliza rangos "08:30-09:20" -> "8:30-9:20" para compararlos con BLOQUES_MAP
  const normalizarRangoHorario = (rango) => {
    if (!rango) return rango;
    const [inicio, fin] = String(rango).split('-').map(p => p.trim());
    if (!inicio || !fin) return rango;
    const norm = (hora) => {
      const [h, m] = hora.split(':');
      return `${parseInt(h)}:${m}`;
    };
    return `${norm(inicio)}-${norm(fin)}`;
  };

  /**
   * NUEVA función simplificada que lee conflictos desde la BD
   * Los conflictos se calculan en el backend de forma centralizada
   */
  const evaluarConflictosDesBD = (itemsAValidar) => {
    try {
      const advertenciasPorPostit = {};
      const nuevosConflicting = new Set();

      // Recopilar TODOS los items de TODOS los semestres
      const todosLosItems = [];
      Object.keys(itemsAValidar).forEach(semestreId => {
        (itemsAValidar[semestreId] || []).forEach(pi => {
          todosLosItems.push({ ...pi, semestreId });
        });
      });

      // Helper: agregar advertencia a un post-it específico
      const addWarning = (instanceId, msg) => {
        if (!advertenciasPorPostit[instanceId]) advertenciasPorPostit[instanceId] = [];
        if (!advertenciasPorPostit[instanceId].includes(msg)) advertenciasPorPostit[instanceId].push(msg);
      };

      // Procesar cada item y evaluar sus conflictos desde el campo 'conflictos' de la BD
      todosLosItems.forEach(pi => {
        // 1. Conflictos de BD (calculados por el backend)
        if (pi.conflictos && Array.isArray(pi.conflictos) && pi.conflictos.length > 0) {
          nuevosConflicting.add(pi.instanceId);
          
          // Buscar los items en conflicto para mostrar detalles
          pi.conflictos.forEach(conflicto => {
            // Soportar formato viejo (número) y nuevo (objeto {id, tipo})
            const conflictId = typeof conflicto === 'object' ? conflicto.id : conflicto;
            const tipo = typeof conflicto === 'object' ? conflicto.tipo : null;

            if (tipo === 'disponibilidad' || conflictId === -3) {
              addWarning(pi.instanceId, `🚫 Profesor no disponible en este horario`);
            } else if (tipo === 'profesor') {
              const itemEnConflicto = todosLosItems.find(item => item.id === conflictId);
              if (itemEnConflicto) {
                addWarning(pi.instanceId, `👤 Profesor compartido con ${itemEnConflicto.titulo} Sec ${itemEnConflicto.seccion}`);
              } else {
                addWarning(pi.instanceId, `👤 Profesor asignado a otro curso en este horario`);
              }
            } else if (tipo === 'semestre') {
              const itemEnConflicto = todosLosItems.find(item => item.id === conflictId);
              if (itemEnConflicto) {
                addWarning(pi.instanceId, `⚠️ Toque de semestre con ${itemEnConflicto.titulo} Sec ${itemEnConflicto.seccion}`);
              } else {
                addWarning(pi.instanceId, `⚠️ Toque de semestre detectado`);
              }
            } else if (tipo === 'sala_especial') {
              const itemEnConflicto = todosLosItems.find(item => item.id === conflictId);
              if (itemEnConflicto) {
                addWarning(pi.instanceId, `🏫 Sala especial compartida con ${itemEnConflicto.titulo} Sec ${itemEnConflicto.seccion}`);
              } else {
                addWarning(pi.instanceId, `🏫 Sala especial ocupada en este horario`);
              }
            } else {
              // Formato legacy o desconocido
              const itemEnConflicto = conflictId ? todosLosItems.find(item => item.id === conflictId) : null;
              if (itemEnConflicto) {
                addWarning(pi.instanceId, `⚠️ Conflicto con ${itemEnConflicto.titulo} Sec ${itemEnConflicto.seccion}`);
              } else {
                addWarning(pi.instanceId, `⚠️ Conflicto detectado`);
              }
            }
          });
        }

        // 2. Horario protegido (evaluación local simple)
        if (pi.hasProtectedScheduleWarning) {
          nuevosConflicting.add(pi.instanceId);
          const nombreTipo = pi.semestreId === 'plan_comun' ? 'Plan Común' : '5to y 6to';
          addWarning(pi.instanceId, `🔒 Horario protegido de ${nombreTipo}`);
        }
      });

      setWarningsMap(advertenciasPorPostit);
      setConflictingPostits(nuevosConflicting);
    } catch (err) {
      console.error('Error evaluando conflictos:', err);
    }
  };

  // Cargar horas registradas al iniciar o cuando se recargan datos
  useEffect(() => {
    if (dashboardId) {
      cargarHorasRegistradas();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardId, refreshKey]);

  // Re-evaluar conflictos cuando llegan los horariosProgramables (recarga de página)
  useEffect(() => {
    if (horariosProgramables.length > 0 && Object.keys(placedItems).length > 0) {
      evaluarConflictosDesBD(placedItems);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horariosProgramables]);

  // Función para determinar si un horario es protegido
  const esHorarioProtegido = (dia, horaInicio, semestreId) => {
    // Solo aplica para plan_comun, 5to_6to y 7mo_8vo
    if (!['plan_comun', '5to_6to', '7mo_8vo'].includes(semestreId)) {
      return false;
    }

    // Horarios protegidos por día
    const horariosProtegidos = {
      'Martes': ['17:30', '18:30'],
      'Miércoles': ['17:30', '18:30'],
      'Viernes': ['10:30', '11:30', '12:30']
    };

    const horasProhibidas = horariosProtegidos[dia] || [];
    return horasProhibidas.includes(horaInicio);
  };

  const handleUndo = async () => {
    if (!undoManager.canUndo) return;
    setOperando(true);
    try {
      await undoManager.undo();
      setUndoVersion(v => v + 1);
      await cargarHorasRegistradas();
    } catch (err) {
      console.error('Error deshaciendo:', err);
      alert(`Error al deshacer: ${err.message}`);
    } finally {
      setOperando(false);
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cargarHorasRegistradas = async () => {
    try {
      setCargando(true);
      const { horasRegistradas: hrs } = await horasRegistradasService.obtenerPorDashboard(dashboardId);
      
      // Función para normalizar tiempo: "09:30" -> "9:30" (remover leading zeros)
      const normalizarTiempo = (tiempoStr) => {
        const [horas, minutos] = tiempoStr.substring(0, 5).split(':');
        return `${parseInt(horas)}:${minutos}`;
      };
      
      // Convertir horas registradas a placedItems
      const grouped = {};
      hrs.forEach(hr => {
        // Usar el campo horario de la BD si existe, si no, usar determinación por especialidades
        const semestreId = hr.horario || determinarSemestrePorEspecialidades(hr.hora_programable_id);
        
        if (!grouped[semestreId]) {
          grouped[semestreId] = [];
        }

        // Normalizar hora_inicio (PostgreSQL devuelve HH:MM:SS, necesitamos 9:30 sin leading zero)
        const horaInicio = normalizarTiempo(hr.hora_inicio);
        
        // Encontrar el bloque index basado en hora_inicio normalizada
        const bloqueIndex = HORARIOS.bloques.findIndex(b => b.inicio === horaInicio);

        grouped[semestreId].push({
          id: hr.id, // ID de la BD
          instanceId: `${hr.hora_programable_id}-${hr.id}`, // Usar ID de BD + prog ID
          hora_programable_id: hr.hora_programable_id,
          codigo: hr.codigo,
          seccion: hr.seccion,
          titulo: hr.titulo,
          tipo_hora: hr.tipo_hora,
          dia: hr.dia_semana,
          bloqueIndex: bloqueIndex >= 0 ? bloqueIndex : 0,
          conflictos: hr.conflictos || [], // Cargar conflictos desde la BD
          hasProtectedScheduleWarning: esHorarioProtegido(hr.dia_semana, horaInicio, semestreId) // Detectar horario protegido
        });
      });

      setPlacedItems(grouped);
      
      // Evaluar conflictos desde la BD
      evaluarConflictosDesBD(grouped);
    } catch (err) {
      console.error('Error cargando horas registradas:', err);
    } finally {
      setCargando(false);
    }
  };

  // Determinar el semestre basado en especialidades del programable
  const determinarSemestrePorEspecialidades = (horaProgId) => {
    const prog = horariosProgramables.find(h => h.id === horaProgId);
    return determinarSemestre(prog);
  };

  // Calcular horas usadas de un programable en TODOS los semestres
  const getHorasUsadas = (horaProgId) => {
    const id = String(horaProgId);
    const bloquesUnicos = new Set();
    Object.values(placedItems).forEach(semItems => {
      semItems
        .filter(pi => String(pi.hora_programable_id) === id)
        .forEach((pi) => {
          // El mismo bloque espejado en distintos horarios cuenta como una sola hora.
          bloquesUnicos.add(`${pi.dia}|${pi.bloqueIndex}`);
        });
    });
    return bloquesUnicos.size;
  };

  // Contar cuántos bloques tienen TODAS las secciones de un grupo juntas
  const getGrupoUsos = (groupIds) => {
    const bloqueIds = groupIds.map(String);
    const bloqueSecciones = {};
    Object.values(placedItems).forEach(semItems => {
      semItems.forEach(pi => {
        const key = `${pi.dia}|${pi.bloqueIndex}`;
        if (!bloqueSecciones[key]) bloqueSecciones[key] = new Set();
        bloqueSecciones[key].add(String(pi.hora_programable_id));
      });
    });
    let count = 0;
    Object.values(bloqueSecciones).forEach(secciones => {
      if (bloqueIds.every(id => secciones.has(id))) count++;
    });
    return count;
  };

  // Verificar si se puede agregar más instancias de un programable
  const puedeAgregar = (horaProgId, cantidadHoras) => {
    return getHorasUsadas(horaProgId) < cantidadHoras;
  };

  // Filtrar programables para un semestre particular
  // Ahora también aplica los filtros de usuario (especialidad/semestre)
  function filterForSemesterLocal(semestreId) {
    return (h) => {
      if (!filtrarHorario(h)) return false;
      return filterForSemester(h, semestreId);
    };
  }

  const renderHorario = (semestre) => (
    <div key={semestre.id} className="timetable-view">
      <h3 className="timetable-title" style={{ borderBottomColor: semestre.color }}>
        {semestre.nombre}
      </h3>

      <div className="timetable">
        <div className="timetable-header">
          <div className="time-column"></div>
          {HORARIOS.dias.map((dia) => (
            <div key={dia} className="day-header">
              {dia}
            </div>
          ))}
        </div>

        <div className="timetable-body">
          {HORARIOS.bloques.map((bloque, index) => (
            <div
              key={index}
              className="time-row"
              style={{ backgroundColor: bloque.colorFila }}
            >
              <div className="time-label" style={{ backgroundColor: bloque.colorFila }}>
                {bloque.tipo === 'almuerzo' ? '🍽️' : ''} {bloque.inicio} - {bloque.fin}
              </div>

              {HORARIOS.dias.map((dia) => {
                const bloqueCompleto = BLOQUES_MAP[bloque.inicio];
                let cellDragClass = '';
                if (draggedDisponibilidad && Object.keys(draggedDisponibilidad).length > 0) {
                  const diaDisp = draggedDisponibilidad[dia];
                  const diaDispNorm = Array.isArray(diaDisp)
                    ? diaDisp.map(normalizarRangoHorario)
                    : [];
                  const isAvailable = diaDispNorm.includes(bloqueCompleto);
                  cellDragClass = isAvailable ? 'cell-available' : 'cell-unavailable';
                }

                return (
                <div
                  key={`${dia}-${bloque.inicio}`}
                  className={`cell ${cellDragClass}`.trim()}
                  style={{
                    backgroundColor: bloque.colorFila,
                    borderBottomColor: bloque.tipo === 'almuerzo' ? '#b39ddb' : '#ddd'
                  }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDraggedDisponibilidad(null);
                      let data = null;
                      try { data = e.dataTransfer.getData('application/json'); } catch { /* ignore */ }
                      if (!data) data = e.dataTransfer.getData('text/plain');
                      if (!data) return;
                      try { data = JSON.parse(data); } catch { /* ignore */ }
                      
                      if (data && data.type === 'placed') {
                        const { id: horaRegId, instanceId: _instanceId, semestreId, dia: oldDia, bloqueIndex: oldBloqueIndex } = data;
                        if (semestreId !== semestre.id) {
                          setAvisos(['Una hora solo puede moverse dentro de su mismo horario.']);
                          return;
                        }

                        setOperando(true);
                        const cmd = new MoverCommand(horasRegistradasService, horaRegId, oldDia, oldBloqueIndex, dia, index);
                        undoManager.execute(cmd)
                          .then(() => {
                            setAvisos([]);
                            setUndoVersion(v => v + 1);
                            cargarHorasRegistradas();
                          })
                          .catch(err => {
                            console.error('Error moviendo hora:', err);
                            alert(`Error: ${err.message}`);
                          })
                          .finally(() => setOperando(false));
                        return;
                      }
                      
                      const ids = data.ids || (data.id ? [String(data.id)] : null);
                      if (!ids) return;

                      const programasPorId = new Map(
                        horariosProgramables.map(p => [String(p.id), p])
                      );

                      const idsValidos = ids.filter(id => {
                        const prog = programasPorId.get(String(id));
                        if (!prog) return false;
                        // El curso solo puede ir a un horario al que pertenece
                        if (!filterForSemester(prog, semestre.id)) return false;
                        return puedeAgregar(prog.id, prog.cantidad_horas);
                      });

                      if (idsValidos.length === 0) {
                        const hayFueraDeHorario = ids.some(id => {
                          const prog = programasPorId.get(String(id));
                          return prog && !filterForSemester(prog, semestre.id);
                        });
                        setAvisos(hayFueraDeHorario
                          ? ['Este curso no pertenece a este horario. Solo puede asignarse en el horario que le corresponde según su especialidad y semestre.']
                          : ['Este curso ya tiene todas sus horas asignadas en este horario.']);
                        return;
                      }

                      setOperando(true);
                      const paramsList = idsValidos.map(id => ({
                        horaProgramableId: id,
                        dashboardId,
                        dia,
                        bloqueIndex: index,
                        semestreId: semestre.id
                      }));
                      const cmd = new CrearCommand(horasRegistradasService, paramsList);
                      undoManager.execute(cmd)
                        .then(() => {
                          setAvisos(cmd.warnings || []);
                          setUndoVersion(v => v + 1);
                          cargarHorasRegistradas();
                        })
                        .catch(err => {
                          console.error('Error creando horas registradas:', err);
                          alert(`Error: ${err.message}`);
                        })
                        .finally(() => setOperando(false));
                    }}
                >
                  <div className="cell-content">
                    {(placedItems[semestre.id] || [])
                      .filter(pi => {
                        // Filtrar por día y bloque
                        if (pi.dia !== dia || pi.bloqueIndex !== index) return false;
                        
                        // Aplicar filtro de usuario
                        const prog = horariosProgramables.find(p => p.id === pi.hora_programable_id);
                        if (!prog) return true; // Si no encontramos el programable, mostrar igual
                        
                        return filtrarHorario(prog);
                      })
                      .map(pi => {
                        // Obtener el programable para conocer las especialidades_semestres
                        const prog = horariosProgramables.find(p => p.id === pi.hora_programable_id);
                        const tieneConflicto = conflictingPostits.has(pi.instanceId);
                        const colorStyle = prog 
                          ? getPostitStyle(prog.especialidades_semestres, tieneConflicto, getTipoHorario(semestre.id))
                          : {};
                        const distribucion = prog && prog.distribucion_horario != null ? String(prog.distribucion_horario).trim() : '';
                        
                        return (
                        <div
                          key={pi.instanceId}
                          className={`placed-postit ${tieneConflicto ? 'conflicting' : ''}`}
                          draggable
                          title={warningsMap[pi.instanceId] ? warningsMap[pi.instanceId].join('\n') : ''}
                          style={colorStyle}
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('application/json', JSON.stringify({
                              type: 'placed',
                              instanceId: pi.instanceId,
                              semestreId: semestre.id,
                              ...pi
                            }));
                            const prog = horariosProgramables.find(p => p.id === pi.hora_programable_id);
                            if (prog && prog.disponibilidad && typeof prog.disponibilidad === 'object' && Object.keys(prog.disponibilidad).length > 0) {
                              setDraggedDisponibilidad(prog.disponibilidad);
                            }
                          }}
                          onDragEnd={() => setDraggedDisponibilidad(null)}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="postit-content">
                            <div className="postit-header">
                              <strong>{pi.codigo}-{pi.seccion}</strong>
                              <button
                                className="remove-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOperando(true);

                                  // Recolectar todas las copias espejo (mismo curso, día y bloque
                                  // en otros horarios) para poder restaurarlas con el undo.
                                  const espejos = [];
                                  const vistos = new Set();
                                  Object.entries(placedItems).forEach(([trackId, items]) => {
                                    items.forEach(item => {
                                      if (item.hora_programable_id !== pi.hora_programable_id) return;
                                      if (item.dia !== pi.dia || item.bloqueIndex !== pi.bloqueIndex) return;
                                      const clave = `${trackId}|${item.dia}|${item.bloqueIndex}`;
                                      if (vistos.has(clave)) return;
                                      vistos.add(clave);
                                      espejos.push({
                                        horaProgramableId: item.hora_programable_id,
                                        dashboardId,
                                        dia: item.dia,
                                        bloqueIndex: item.bloqueIndex,
                                        horario: trackId
                                      });
                                    });
                                  });

                                  const cmd = new EliminarCommand(
                                    horasRegistradasService,
                                    [{
                                      id: pi.id,
                                      horaProgramableId: pi.hora_programable_id,
                                      dashboardId,
                                      dia: pi.dia,
                                      bloqueIndex: pi.bloqueIndex,
                                      semestreId: semestre.id,
                                      horario: semestre.id
                                    }],
                                    espejos
                                  );
                                  undoManager.execute(cmd)
                                    .then(() => {
                                      setUndoVersion(v => v + 1);
                                      cargarHorasRegistradas();
                                    })
                                    .catch(err => console.error('Error eliminando hora:', err))
                                    .finally(() => setOperando(false));
                                }}
                              >
                                ✕
                              </button>
                            </div>
                            <div className="postit-title-small">{pi.titulo || '-'}</div>
                            <div className="postit-type">{pi.tipo_hora}{distribucion ? ` • ${distribucion}` : ''}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )})}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderHorarioWithSidebar = (semestre) => (
    <div key={semestre.id} className="timetable-with-sidebar">
      {renderHorario(semestre)}
      <div className="sidebar-container">
        <HorariosSidebar
          horarios={horariosProgramables}
          filterFn={filterForSemesterLocal(semestre.id)}
          getHorasUsadas={getHorasUsadas}
          getGrupoUsos={getGrupoUsos}
          puedeAgregar={puedeAgregar}
          tipoHorario={getTipoHorario(semestre.id)}
          filtroEspecialidad={filtroEspecialidad}
          filtroSemestre={filtroSemestre}
          onFiltroEspecialidadChange={onFiltroEspecialidadChange}
          onFiltroSemestreChange={onFiltroSemestreChange}
          onSidebarDragStart={setDraggedDisponibilidad}
          onSidebarDragEnd={() => setDraggedDisponibilidad(null)}
        />
      </div>
    </div>
  );

  return (
    <div className="timetable-container">
      <div className="timetable-controls">
        <div className="controls-row">
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
          <button
            className="undo-btn"
            disabled={!undoManager.canUndo}
            onClick={handleUndo}
            title="Deshacer (Ctrl+Z)"
          >
            ↩ Deshacer
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

      {avisos.length > 0 && (
        <div className="avisos-panel">
          <div className="avisos-header">
            <strong>Avisos</strong>
            <button className="avisos-close" onClick={() => setAvisos([])} title="Cerrar avisos">✕</button>
          </div>
          <ul className="avisos-list">
            {avisos.map((aviso, idx) => (
              <li key={idx}>{aviso}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="color-legend">
        <span className="legend-label">Colores:</span>
        <span className="legend-item" style={{ background: '#FFEB99', borderLeft: '3px solid #FFEB99', color: '#333' }}>Plan Común 1</span>
        <span className="legend-item" style={{ background: '#A8E6A0', borderLeft: '3px solid #A8E6A0', color: '#333' }}>Plan Común 2 / ICI Impar</span>
        <span className="legend-item" style={{ background: '#FFB3B3', borderLeft: '3px solid #FFB3B3', color: '#333' }}>Plan Común 3</span>
        <span className="legend-item" style={{ background: '#A3D5FF', borderLeft: '3px solid #A3D5FF', color: '#333' }}>Plan Común 4 / IOC Impar</span>
        <span className="legend-item" style={{ background: '#4CAF50', borderLeft: '3px solid #4CAF50', color: 'white' }}>ICI Par</span>
        <span className="legend-item" style={{ background: '#2196F3', borderLeft: '3px solid #2196F3', color: 'white' }}>IOC Par</span>
        <span className="legend-item" style={{ background: '#FF9800', borderLeft: '3px solid #FF9800', color: 'white' }}>ICE Par</span>
        <span className="legend-item" style={{ background: '#757575', borderLeft: '3px solid #757575', color: 'white' }}>ICC Par</span>
        <span className="legend-item" style={{ background: '#E91E63', borderLeft: '3px solid #E91E63', color: 'white' }}>ICA Par</span>
        <span className="legend-item" style={{ background: '#9C27B0', borderLeft: '3px solid #9C27B0', color: 'white' }}>ICQ Par</span>
        <span className="legend-item" style={{ background: '#FFCDD2', borderLeft: '3px solid #d32f2f', color: '#333' }}>Conflicto</span>
      </div>

      {operando && <div className="loading-overlay">Verificando conflictos…</div>}

      {modoVisualizacion === 'cascada' ? (
        <div className="timetable-cascade">
          {HORARIOS.semestres.map((semestre) => renderHorarioWithSidebar(semestre))}
        </div>
      ) : (
        <div className="timetable-paginated">
          <div className="timetable-with-sidebar">
            {renderHorario(HORARIOS.semestres[semestreActual])}
            <div className="sidebar-container">
              <HorariosSidebar
                horarios={horariosProgramables}
                filterFn={filterForSemesterLocal(HORARIOS.semestres[semestreActual].id)}
                getHorasUsadas={getHorasUsadas}
                getGrupoUsos={getGrupoUsos}
                puedeAgregar={puedeAgregar}
                tipoHorario={getTipoHorario(HORARIOS.semestres[semestreActual].id)}
                filtroEspecialidad={filtroEspecialidad}
                filtroSemestre={filtroSemestre}
                onFiltroEspecialidadChange={onFiltroEspecialidadChange}
                onFiltroSemestreChange={onFiltroSemestreChange}
                onSidebarDragStart={setDraggedDisponibilidad}
                onSidebarDragEnd={() => setDraggedDisponibilidad(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
