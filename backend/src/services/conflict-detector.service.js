import  pool  from '../db/pool.js';

/**
 * Servicio centralizado para detectar y actualizar conflictos
 * Este servicio re-evalúa TODOS los conflictos de un dashboard después de cualquier cambio
 */

// Bloques de horario: inicio -> rango completo "inicio-fin"
const BLOQUES_MAP = {
  "8:30": "8:30-9:20",
  "9:30": "9:30-10:20",
  "10:30": "10:30-11:20",
  "11:30": "11:30-12:20",
  "12:30": "12:30-13:20",
  "13:30": "13:30-14:20",
  "14:30": "14:30-15:20",
  "15:30": "15:30-16:20",
  "16:30": "16:30-17:20",
  "17:30": "17:30-18:20",
  "18:30": "18:30-19:20",
  "19:30": "19:30-20:20"
};

/**
 * Normaliza hora de inicio: "09:30" -> "9:30" (remover leading zero)
 */
function normalizarHora(hora) {
  if (!hora) return hora;
  const [h, m] = hora.split(':');
  return `${parseInt(h)}:${m}`;
}

/**
 * Re-evaluar TODOS los conflictos de un dashboard
 * Limpia todos los conflictos existentes y los recalcula desde cero
 */
async function reevaluarConflictosDashboard(dashboardId) {
  try {
    // 1. Limpiar todos los conflictos del dashboard
    await pool.query(
      `UPDATE horas_registradas 
       SET conflictos = '[]'::json 
       WHERE dashboard_id = $1`,
      [dashboardId]
    );

    // 2. Obtener todas las horas registradas del dashboard con su información completa
    const result = await pool.query(
      `SELECT 
        hr.id as hora_reg_id,
        hr.hora_programable_id,
        hr.dia_semana,
        hr.hora_inicio,
        hr.hora_fin,
        hr.horario,
        hp.codigo,
        hp.seccion,
        hp.titulo,
        hp.tipo_hora,
        hp.especialidades_semestres,
        hp.disponibilidad,
        hp.profesor_1_id,
        hp.profesor_2_id,
        hp.sala_especial
       FROM horas_registradas hr
       JOIN horas_programables hp ON hr.hora_programable_id = hp.id
       WHERE hr.dashboard_id = $1
       ORDER BY hr.id`,
      [dashboardId]
    );

    const horas = result.rows;
    const conflictosPorHora = {}; // hora_reg_id -> [{id, tipo}]

    // Helper para agregar conflicto bidireccional con tipo
    const agregarConflicto = (id1, id2, tipo) => {
      if (!conflictosPorHora[id1]) conflictosPorHora[id1] = [];
      if (!conflictosPorHora[id2]) conflictosPorHora[id2] = [];
      if (!conflictosPorHora[id1].some(c => c.id === id2 && c.tipo === tipo)) {
        conflictosPorHora[id1].push({ id: id2, tipo });
      }
      if (!conflictosPorHora[id2].some(c => c.id === id1 && c.tipo === tipo)) {
        conflictosPorHora[id2].push({ id: id1, tipo });
      }
    };

    // Helper para agregar conflicto especial (sin otra hora, solo tipo)
    const agregarConflictoEspecial = (id, tipo) => {
      if (!conflictosPorHora[id]) conflictosPorHora[id] = [];
      if (!conflictosPorHora[id].some(c => c.tipo === tipo)) {
        conflictosPorHora[id].push({ id: null, tipo });
      }
    };

    // Normalizar hora_inicio para comparación: TIME de PG viene como "09:30:00" o "9:30:00"
    const normHoraInicio = (h) => {
      if (!h) return '';
      const str = String(h).substring(0, 5); // "09:30:00" -> "09:30"
      const [hh, mm] = str.split(':');
      return `${parseInt(hh)}:${mm}`; // "09:30" -> "9:30"
    };

    // Pre-procesar: extraer IDs de profesores como Set de números por cada hora
    const profesoresPorHora = horas.map(h => {
      const ids = new Set();
      if (h.profesor_1_id != null) ids.add(Number(h.profesor_1_id));
      if (h.profesor_2_id != null) ids.add(Number(h.profesor_2_id));
      return ids;
    });

    // Debug: mostrar info
    console.log(`[ConflictDetector] Dashboard ${dashboardId}: ${horas.length} horas totales`);
    horas.forEach((h, idx) => {
      const profs = [...profesoresPorHora[idx]];
      if (profs.length > 0) {
        console.log(`  [${idx}] hr_id=${h.hora_reg_id} ${h.codigo} Sec${h.seccion} ${h.tipo_hora} | dia=${h.dia_semana} hora=${normHoraInicio(h.hora_inicio)} horario=${h.horario} | profIds=[${profs.join(',')}]`);
      }
    });

    // 3. Detectar conflictos de toque de semestre (misma especialidad + mismo semestre)
    for (let i = 0; i < horas.length; i++) {
      for (let j = i + 1; j < horas.length; j++) {
        const hora1 = horas[i];
        const hora2 = horas[j];

        // Solo comparar si están en el mismo bloque horario Y mismo horario
        if (hora1.dia_semana === hora2.dia_semana && 
            normHoraInicio(hora1.hora_inicio) === normHoraInicio(hora2.hora_inicio) &&
            hora1.horario === hora2.horario) {
          
          // Skip si son del mismo curso
          if (hora1.codigo === hora2.codigo) {
            continue;
          }

          const pares1 = extraerEspecialidadSemestres(hora1.especialidades_semestres);
          const pares2 = extraerEspecialidadSemestres(hora2.especialidades_semestres);
          const claves2 = new Set(pares2.map(p => `${p.especialidad}|${p.semestre}`));
          const paresComunes = pares1.filter(p => claves2.has(`${p.especialidad}|${p.semestre}`));

          if (paresComunes.length > 0) {
            agregarConflicto(hora1.hora_reg_id, hora2.hora_reg_id, 'semestre');
          }
        }
      }
    }

    // 4. Detectar conflictos de doble asignación de profesor
    // Agrupar horas por bloque (dia + hora normalizada) para comparar eficientemente
    const bloqueMap = {}; // "Lunes|9:30" -> [índices en array horas]
    horas.forEach((h, idx) => {
      const clave = `${h.dia_semana}|${normHoraInicio(h.hora_inicio)}`;
      if (!bloqueMap[clave]) bloqueMap[clave] = [];
      bloqueMap[clave].push(idx);
    });

    console.log(`[ConflictDetector] Bloques ocupados: ${Object.keys(bloqueMap).length}`);
    for (const [clave, indices] of Object.entries(bloqueMap)) {
      if (indices.length < 2) continue; // Sin posibilidad de conflicto

      console.log(`  Bloque [${clave}]: ${indices.length} horas`);
      
      // Comparar todas las combinaciones dentro del mismo bloque
      for (let i = 0; i < indices.length; i++) {
        for (let j = i + 1; j < indices.length; j++) {
          const idx1 = indices[i];
          const idx2 = indices[j];
          const hora1 = horas[idx1];
          const hora2 = horas[idx2];

          // Si son la misma hora_programable espejada en distintos horarios, no es conflicto.
          if (hora1.hora_programable_id === hora2.hora_programable_id) {
            continue;
          }

          if (hora1.tipo_hora === 'AYUDANTIA' || hora2.tipo_hora === 'AYUDANTIA') {
            continue;
          }

          const profs1 = profesoresPorHora[idx1];
          const profs2 = profesoresPorHora[idx2];

          // Si alguna no tiene profesores, no hay conflicto posible
          if (profs1.size === 0 || profs2.size === 0) continue;

          // Buscar intersección de profesores
          let profesorComun = null;
          for (const profId of profs1) {
            if (profs2.has(profId)) {
              profesorComun = profId;
              break;
            }
          }

          if (profesorComun !== null) {
            console.log(`    ⚠️ PROFESOR COMPARTIDO (id=${profesorComun}): ${hora1.codigo} Sec${hora1.seccion} ${hora1.tipo_hora} [${hora1.horario}] vs ${hora2.codigo} Sec${hora2.seccion} ${hora2.tipo_hora} [${hora2.horario}]`);
            agregarConflicto(hora1.hora_reg_id, hora2.hora_reg_id, 'profesor');
          }
        }
      }
    }

    // 5. Detectar conflictos de sala especial
    // Dos horas en el mismo bloque NO pueden compartir la misma sala_especial,
    // incluso si son del mismo código pero diferente sección
    for (const [clave, indices] of Object.entries(bloqueMap)) {
      if (indices.length < 2) continue;

      for (let i = 0; i < indices.length; i++) {
        for (let j = i + 1; j < indices.length; j++) {
          const idx1 = indices[i];
          const idx2 = indices[j];
          const hora1 = horas[idx1];
          const hora2 = horas[idx2];

          // Si son la misma hora_programable espejada en distintos horarios, no es conflicto.
          if (hora1.hora_programable_id === hora2.hora_programable_id) {
            continue;
          }

          // Ambas deben tener sala_especial asignada y ser la misma
          if (hora1.sala_especial && hora2.sala_especial &&
              hora1.sala_especial === hora2.sala_especial) {
            console.log(`    ⚠️ SALA ESPECIAL COMPARTIDA ("${hora1.sala_especial}"): ${hora1.codigo} Sec${hora1.seccion} ${hora1.tipo_hora} vs ${hora2.codigo} Sec${hora2.seccion} ${hora2.tipo_hora}`);
            agregarConflicto(hora1.hora_reg_id, hora2.hora_reg_id, 'sala_especial');
          }
        }
      }
    }

    // 6. Detectar conflictos de disponibilidad de profesor
    for (const hora of horas) {
      if (tieneConflictoDisponibilidad(hora)) {
        agregarConflictoEspecial(hora.hora_reg_id, 'disponibilidad');
      }
    }

    // 7. Actualizar el campo conflictos en la BD
    for (const [horaRegId, conflictIds] of Object.entries(conflictosPorHora)) {
      // Remover duplicados
      const uniqueConflicts = [...new Set(conflictIds)];
      
      await pool.query(
        `UPDATE horas_registradas 
         SET conflictos = $1::json 
         WHERE id = $2`,
        [JSON.stringify(uniqueConflicts), horaRegId]
      );
    }

    console.log(`[ConflictDetector] Re-evaluados conflictos para dashboard ${dashboardId}. Encontrados: ${Object.keys(conflictosPorHora).length} horas con conflictos`);
    
    return {
      success: true,
      totalHoras: horas.length,
      horasConConflictos: Object.keys(conflictosPorHora).length
    };

  } catch (error) {
    console.error('[ConflictDetector] Error re-evaluando conflictos:', error);
    throw error;
  }
}

/**
 * Extrae pares {especialidad, semestre} desde especialidades_semestres
 * Maneja tanto array como objeto
 */
function normalizarEspecialidad(nombre) {
  return String(nombre ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function parseNumeroSemestre(semestre) {
  if (semestre == null) return null;

  if (typeof semestre === 'number') {
    return Math.floor(semestre);
  }

  if (typeof semestre === 'string') {
    const numero = parseInt(semestre.replace(/[^0-9]/g, ''), 10);
    return isNaN(numero) ? null : numero;
  }

  return null;
}

function extraerEspecialidadSemestres(especialidades_semestres) {
  if (!especialidades_semestres) return [];

  let esp = especialidades_semestres;
  if (typeof esp === 'string') {
    try {
      esp = JSON.parse(esp);
    } catch (e) {
      return [];
    }
  }

  const pares = [];
  const pushPar = (nombreRaw, semestreRaw) => {
    const especialidad = normalizarEspecialidad(nombreRaw);
    const semestre = parseNumeroSemestre(semestreRaw);
    if (!especialidad || semestre == null) return;
    pares.push({ especialidad, semestre });
  };

  if (Array.isArray(esp)) {
    esp.forEach((item) => {
      if (item && typeof item === 'object') {
        const nombre = item.nombre ?? item.especialidad ?? item.nombre_especialidad;
        const semestre = item.semestre ?? item.valor ?? item;
        pushPar(nombre, semestre);
      }
    });
  } else if (typeof esp === 'object') {
    Object.entries(esp).forEach(([nombre, valor]) => {
      if (Array.isArray(valor)) {
        valor.forEach((sem) => pushPar(nombre, sem));
      } else {
        pushPar(nombre, valor);
      }
    });
  }

  return pares;
}

/**
 * Verificar si una hora tiene conflictos de disponibilidad de profesor
 * Retorna true si el profesor NO está disponible
 */
function tieneConflictoDisponibilidad(hora) {
  try {
    const { disponibilidad, dia_semana, hora_inicio, profesor_1_id, profesor_2_id, tipo_hora } = hora;

    if (tipo_hora === 'AYUDANTIA') {
      return false;
    }

    if (!profesor_1_id && !profesor_2_id) {
      return false;
    }

    if (!disponibilidad || Object.keys(disponibilidad).length === 0) {
      return false; // Sin disponibilidad registrada, no hay conflicto
    }

    let disp = disponibilidad;
    if (typeof disp === 'string') {
      try { disp = JSON.parse(disp); } catch (e) { return false; }
    }

    const bloquesDisponibles = disp[dia_semana];

    // Si no hay bloques para ese día, hay conflicto
    if (!bloquesDisponibles || !Array.isArray(bloquesDisponibles) || bloquesDisponibles.length === 0) {
      return true;
    }

    const horaInicioNorm = normalizarHora(hora_inicio);
    const bloqueCompleto = BLOQUES_MAP[horaInicioNorm];

    if (!bloqueCompleto) {
      return false;
    }

    // Normalizar bloques de disponibilidad
    const bloquesNorm = bloquesDisponibles.map(b => {
      const partes = b.split('-');
      if (partes.length === 2) {
        return `${normalizarHora(partes[0])}-${normalizarHora(partes[1])}`;
      }
      return b;
    });

    // Verificar si el bloque está en la disponibilidad
    return !bloquesNorm.includes(bloqueCompleto);

  } catch (error) {
    console.error('[ConflictDetector] Error verificando disponibilidad:', error);
    return false;
  }
}

/**
 * Verificar si una hora está en horario protegido
 * Retorna true si está en horario protegido
 */
function tieneConflictoHorarioProtegido(hora) {
  try {
    const { horario, dia_semana, hora_inicio } = hora;

    // Solo aplica para plan_comun y 5to_6to
    if (!['plan_comun', '5to_6to'].includes(horario)) {
      return false;
    }

    const horariosProtegidos = {
      'Martes': ['17:30', '18:30'],
      'Miércoles': ['17:30', '18:30'],
      'Viernes': ['10:30', '11:30', '12:30']
    };

    const horasProhibidas = horariosProtegidos[dia_semana] || [];
    return horasProhibidas.includes(hora_inicio);

  } catch (error) {
    console.error('[ConflictDetector] Error verificando horario protegido:', error);
    return false;
  }
}

/**
 * Re-evaluar TODOS los conflictos de pruebas de un dashboard
 * Similar a horas, pero adaptado para pruebas con fechas
 * Las pruebas solo tienen fecha y tipo_prueba (no hora_inicio/fin)
 */
async function reevaluarConflictosPruebasDashboard(dashboardId) {
  try {
    // 1. Limpiar todos los conflictos de pruebas del dashboard
    await pool.query(
      `UPDATE pruebas_registradas 
       SET conflictos = '[]'::json 
       WHERE dashboard_id = $1`,
      [dashboardId]
    );

    // 2. Obtener todas las pruebas registradas del dashboard
    const result = await pool.query(
      `SELECT 
        pr.id as prueba_reg_id,
        pr.prueba_programable_id,
        pr.fecha,
        pr.hora_inicio,
        pr.hora_fin,
        pp.codigo,
        pp.seccion,
        pp.titulo,
        pp.tipo_prueba,
        pp.especialidades_semestres,
        pp.bloques_horario,
        pp.profesor_1_id,
        pp.profesor_2_id
       FROM pruebas_registradas pr
       JOIN pruebas_programables pp ON pr.prueba_programable_id = pp.id
       WHERE pr.dashboard_id = $1
       ORDER BY pr.id`,
      [dashboardId]
    );

    const pruebas = result.rows;
    const conflictosPorPrueba = {}; // prueba_reg_id -> [ids de pruebas en conflicto]

    // 3. Detectar conflictos de toque de semestre
    // Las pruebas del mismo tipo en la misma fecha pueden tener conflicto de semestre
    for (let i = 0; i < pruebas.length; i++) {
      for (let j = i + 1; j < pruebas.length; j++) {
        const prueba1 = pruebas[i];
        const prueba2 = pruebas[j];

        // Solo comparar si están en la misma fecha y tienen el mismo tipo
        // (porque las pruebas del mismo tipo se realizan simultáneamente)
        if (prueba1.fecha.getTime() === prueba2.fecha.getTime() && 
            prueba1.tipo_prueba === prueba2.tipo_prueba) {
          
          // Skip si son del mismo curso
          if (prueba1.codigo === prueba2.codigo) {
            continue;
          }

          // Extraer semestres de ambas pruebas
          const pares1 = extraerEspecialidadSemestres(prueba1.especialidades_semestres);
          const pares2 = extraerEspecialidadSemestres(prueba2.especialidades_semestres);
          const claves2 = new Set(pares2.map(p => `${p.especialidad}|${p.semestre}`));
          const paresComunes = pares1.filter(p => claves2.has(`${p.especialidad}|${p.semestre}`));

          if (paresComunes.length > 0) {
            // Hay conflicto de toque de semestre
            if (!conflictosPorPrueba[prueba1.prueba_reg_id]) {
              conflictosPorPrueba[prueba1.prueba_reg_id] = [];
            }
            if (!conflictosPorPrueba[prueba2.prueba_reg_id]) {
              conflictosPorPrueba[prueba2.prueba_reg_id] = [];
            }
            
            conflictosPorPrueba[prueba1.prueba_reg_id].push(prueba2.prueba_reg_id);
            conflictosPorPrueba[prueba2.prueba_reg_id].push(prueba1.prueba_reg_id);
          }
        }
      }
    }

    // 4. Detectar conflictos de doble asignación de profesor
    // Solo si están en la misma fecha y tipo (porque coinciden en hora)
    for (let i = 0; i < pruebas.length; i++) {
      for (let j = i + 1; j < pruebas.length; j++) {
        const prueba1 = pruebas[i];
        const prueba2 = pruebas[j];

        // Solo comparar si están en la misma fecha y tipo
        if (prueba1.fecha.getTime() === prueba2.fecha.getTime() && 
            prueba1.tipo_prueba === prueba2.tipo_prueba) {
          
          // Verificar si comparten algún profesor
          const prof1Ids = [prueba1.profesor_1_id, prueba1.profesor_2_id].filter(Boolean);
          const prof2Ids = [prueba2.profesor_1_id, prueba2.profesor_2_id].filter(Boolean);
          
          const profesorComun = prof1Ids.find(p => prof2Ids.includes(p));

          if (profesorComun) {
            // Hay conflicto de doble asignación
            if (!conflictosPorPrueba[prueba1.prueba_reg_id]) {
              conflictosPorPrueba[prueba1.prueba_reg_id] = [];
            }
            if (!conflictosPorPrueba[prueba2.prueba_reg_id]) {
              conflictosPorPrueba[prueba2.prueba_reg_id] = [];
            }
            
            if (!conflictosPorPrueba[prueba1.prueba_reg_id].includes(prueba2.prueba_reg_id)) {
              conflictosPorPrueba[prueba1.prueba_reg_id].push(prueba2.prueba_reg_id);
            }
            if (!conflictosPorPrueba[prueba2.prueba_reg_id].includes(prueba1.prueba_reg_id)) {
              conflictosPorPrueba[prueba2.prueba_reg_id].push(prueba1.prueba_reg_id);
            }
          }
        }
      }
    }

    // 5. Detectar conflictos de horarios protegidos
    // SOLO para pruebas tipo TARDE en martes y miércoles
    for (const prueba of pruebas) {
      if (tieneConflictoHorarioProtegidoPrueba(prueba)) {
        if (!conflictosPorPrueba[prueba.prueba_reg_id]) {
          conflictosPorPrueba[prueba.prueba_reg_id] = [];
        }
        // Agregar -1 como indicador especial de horario protegido
        if (!conflictosPorPrueba[prueba.prueba_reg_id].includes(-1)) {
          conflictosPorPrueba[prueba.prueba_reg_id].push(-1);
        }
      }
    }

    // 5b. Detectar conflictos de día no coincidente
    // Para pruebas tipo CLASE, AYUDANTIA, LAB/TALLER: verificar que la fecha
    // coincida con el día del bloque seleccionado (hora_inicio/hora_fin).
    // Si la prueba tiene hora_inicio/hora_fin, buscar el bloque específico en
    // bloques_horario que coincida y verificar su día.
    // Si no tiene hora, verificar que el día esté en algún bloque.
    const diasSemanaMap = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    for (const prueba of pruebas) {
      const tipoPrueba = (prueba.tipo_prueba || '').toUpperCase();
      // Solo aplica para CLASE, AYUDANTIA, LAB/TALLER
      if (!['CLASE', 'AYUDANTIA', 'LAB/TALLER'].includes(tipoPrueba)) continue;

      let bloques = prueba.bloques_horario;
      if (!bloques) continue;
      if (typeof bloques === 'string') {
        try { bloques = JSON.parse(bloques); } catch(e) { continue; }
      }
      if (!Array.isArray(bloques) || bloques.length === 0) continue;

      // Obtener día de la fecha de la prueba
      const diaFecha = diasSemanaMap[prueba.fecha.getDay()];

      let diaCoincide = false;

      // Si la prueba tiene hora_inicio y hora_fin, buscar el bloque específico
      const horaInicioPrueba = prueba.hora_inicio ? normalizarHora(String(prueba.hora_inicio).substring(0, 5)) : null;
      const horaFinPrueba = prueba.hora_fin ? normalizarHora(String(prueba.hora_fin).substring(0, 5)) : null;

      if (horaInicioPrueba && horaFinPrueba) {
        // Buscar el bloque que coincida con hora_inicio y hora_fin
        const bloqueSeleccionado = bloques.find(b => {
          const bInicio = b.inicio ? normalizarHora(b.inicio) : null;
          const bFin = b.fin ? normalizarHora(b.fin) : null;
          return bInicio === horaInicioPrueba && bFin === horaFinPrueba;
        });

        if (bloqueSeleccionado && bloqueSeleccionado.dia) {
          // Verificar que el día del bloque seleccionado coincida con el día de la fecha
          diaCoincide = bloqueSeleccionado.dia === diaFecha;
        } else {
          // Si no encontramos el bloque exacto, verificar contra todos los días
          const diasHorario = [...new Set(bloques.map(b => b.dia).filter(Boolean))];
          diaCoincide = diasHorario.length === 0 || diasHorario.includes(diaFecha);
        }
      } else {
        // Sin hora seleccionada: verificar que el día esté en algún bloque
        const diasHorario = [...new Set(bloques.map(b => b.dia).filter(Boolean))];
        diaCoincide = diasHorario.length === 0 || diasHorario.includes(diaFecha);
      }

      if (!diaCoincide) {
        if (!conflictosPorPrueba[prueba.prueba_reg_id]) {
          conflictosPorPrueba[prueba.prueba_reg_id] = [];
        }
        // -2 como indicador especial de día no coincidente
        if (!conflictosPorPrueba[prueba.prueba_reg_id].includes(-2)) {
          conflictosPorPrueba[prueba.prueba_reg_id].push(-2);
        }
      }
    }

    // 6. Actualizar el campo conflictos en la BD
    for (const [pruebaRegId, conflictIds] of Object.entries(conflictosPorPrueba)) {
      // Remover duplicados
      const uniqueConflicts = [...new Set(conflictIds)];
      
      await pool.query(
        `UPDATE pruebas_registradas 
         SET conflictos = $1::json 
         WHERE id = $2`,
        [JSON.stringify(uniqueConflicts), pruebaRegId]
      );
    }

    console.log(`[ConflictDetector] Re-evaluados conflictos de pruebas para dashboard ${dashboardId}. Encontrados: ${Object.keys(conflictosPorPrueba).length} pruebas con conflictos`);
    
    return {
      success: true,
      totalPruebas: pruebas.length,
      pruebasConConflictos: Object.keys(conflictosPorPrueba).length
    };

  } catch (error) {
    console.error('[ConflictDetector] Error re-evaluando conflictos de pruebas:', error);
    throw error;
  }
}

/**
 * Verificar si una prueba está en horario protegido
 * SOLO aplica para tipo_prueba = 'TARDE' en Martes/Miércoles
 */
function tieneConflictoHorarioProtegidoPrueba(prueba) {
  try {
    const { tipo_prueba, fecha } = prueba;

    // Solo aplica para pruebas tipo TARDE
    if (tipo_prueba !== 'TARDE') {
      return false;
    }

    // Obtener día de la semana (0=Domingo, 1=Lunes, ... 6=Sábado)
    const diaSemana = fecha.getDay();
    
    // 2=Martes, 3=Miércoles
    return [2, 3].includes(diaSemana);

  } catch (error) {
    console.error('[ConflictDetector] Error verificando horario protegido de prueba:', error);
    return false;
  }
}

export {
  reevaluarConflictosDashboard,
  reevaluarConflictosPruebasDashboard,
  extraerEspecialidadSemestres,
  tieneConflictoDisponibilidad,
  tieneConflictoHorarioProtegido,
  tieneConflictoHorarioProtegidoPrueba
};
