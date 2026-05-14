import  pool  from '../db/pool.js';

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
    return Number.isNaN(numero) ? null : numero;
  }

  return null;
}

function extraerEspecialidadSemestres(especialidades) {
  if (!especialidades) return [];

  let esp = especialidades;
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
    pares.push({
      especialidad,
      label: String(nombreRaw ?? '').trim(),
      semestre
    });
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
 * Sistema modular de validaciones para horas registradas
 * Cada validador retorna: { isValid: boolean, warning?: string, error?: string }
 */

/**
 * Validador 1: Detectar toques de semestre
 * Verifica si dos horas del MISMO BLOQUE HORARIO comparten semestre
 * No compara si tienen el mismo código (mismo curso, diferentes secciones)
 */
async function validarToquesDeSemestre(horaProgramableId, dashboardId, horario, dia, horaInicio) {
  try {
    // Obtener la hora programable actual con sus especialidades y código
    const progResult = await pool.query(
      `SELECT codigo, seccion, especialidades_semestres FROM horas_programables WHERE id = $1`,
      [horaProgramableId]
    );
    
    if (progResult.rows.length === 0) {
      return { isValid: true };
    }

    const horaProgramableActual = progResult.rows[0];
    const paresActuales = extraerEspecialidadSemestres(
      horaProgramableActual.especialidades_semestres
    );

    if (paresActuales.length === 0) {
      return { isValid: true }; // Sin semestres asignados, no hay conflicto
    }

    // Obtener todas las horas registradas en el MISMO BLOQUE HORARIO
    // (mismo día + misma hora_inicio + mismo horario)
    const horasResult = await pool.query(
      `SELECT hr.id, hp.codigo, hp.seccion, hp.especialidades_semestres
       FROM horas_registradas hr
       JOIN horas_programables hp ON hr.hora_programable_id = hp.id
       WHERE hr.dashboard_id = $1 
       AND hr.horario = $2
       AND hr.dia_semana = $3
       AND hr.hora_inicio = $4`,
      [dashboardId, horario, dia, horaInicio]
    );

    // Verificar cada hora existente en el mismo bloque
    for (const row of horasResult.rows) {
      // SKIP: Si es del mismo código (mismo curso, diferente sección)
      if (row.codigo === horaProgramableActual.codigo) {
        continue;
      }

      const paresOtras = extraerEspecialidadSemestres(row.especialidades_semestres);
      if (paresOtras.length === 0) {
        continue;
      }

      const clavesOtras = new Set(
        paresOtras.map(p => `${p.especialidad}|${p.semestre}`)
      );

      const paresComunes = paresActuales.filter(p =>
        clavesOtras.has(`${p.especialidad}|${p.semestre}`)
      );

      // Si comparten semestre en el mismo bloque horario
      if (paresComunes.length > 0) {
        const detalles = [...new Set(paresComunes.map((p) => {
          const label = p.label || p.especialidad;
          return label ? `${label} ${p.semestre}` : `Semestre ${p.semestre}`;
        }))];

        // Obtener títulos de los programables para el mensaje
        const prog1Result = await pool.query(
          `SELECT titulo FROM horas_programables WHERE id = $1`,
          [horaProgramableId]
        );
        const prog1Title = prog1Result.rows[0]?.titulo || horaProgramableActual.codigo;

        const prog2Result = await pool.query(
          `SELECT titulo FROM horas_programables WHERE id = (SELECT hora_programable_id FROM horas_registradas WHERE id = $1)`,
          [row.id]
        );
        const prog2Title = prog2Result.rows[0]?.titulo || row.codigo;

        return {
          isValid: false,
          warning: `⚠️ Conflicto de horario: ${prog1Title} Sección ${horaProgramableActual.seccion} está tocando con ${prog2Title} Sección ${row.seccion} en ${detalles.join(', ')}.`,
          conflictingHoraRegId: row.id,
          conflictingCourses: [
            { codigo: horaProgramableActual.codigo, seccion: horaProgramableActual.seccion, horaProgId: horaProgramableId },
            { codigo: row.codigo, seccion: row.seccion, horaRegId: row.id }
          ],
          conflictingSemesters: detalles
        };
      }
    }

    return { isValid: true };
  } catch (err) {
    console.error('Error en validarToquesDeSemestre:', err);
    return { isValid: true }; // No bloquear, solo avisar
  }
}

/**
 * Validador 2: Detectar horarios protegidos
 * Verifica si el horario se está programando en franjas horarias protegidas
 * Solo aplica para 'plan_comun' y '5to_6to'
 * Horarios protegidos:
 * - Martes: 17:30-18:20, 18:30-19:20
 * - Miércoles: 17:30-18:20, 18:30-19:20
 * - Viernes: 10:30-11:20, 11:30-12:20, 12:30-13:20
 */
function validarHorarioProtegido(dia, horaInicio, tipoHorario) {
  try {
    // Solo aplicar validación para plan_comun y 5to_6to
    const tiposAplicables = ['plan_comun', '5to_6to'];
    if (!tiposAplicables.includes(tipoHorario)) {
      return { isValid: true };
    }

    // Convertir nombre de día a número (Martes=2, Miércoles=3, Viernes=5)
    const dias = {
      'Martes': 2,
      'Miércoles': 3,
      'Viernes': 5
    };

    const diaNumeroPorNombre = dias[dia];
    if (!diaNumeroPorNombre) {
      return { isValid: true }; // Solo validar los días especificados
    }

    // Horarios protegidos por día
    const horariosProtegidos = {
      2: ['17:30', '18:30'], // Martes
      3: ['17:30', '18:30'], // Miércoles
      5: ['10:30', '11:30', '12:30'] // Viernes
    };

    const horasProhibidas = horariosProtegidos[diaNumeroPorNombre] || [];

    if (horasProhibidas.includes(horaInicio)) {
      const nombreTipoHorario = tipoHorario === 'plan_comun' ? 'Plan Común' : '5to y 6to';
      return {
        isValid: true, // No bloquea, solo advierte
        warning: `🔒 Horario Protegido: Esta programación se encuentra en una franja protegida de ${nombreTipoHorario}. ${dia} a las ${horaInicio}.`
      };
    }

    return { isValid: true };
  } catch (err) {
    console.error('Error en validarHorarioProtegido:', err);
    return { isValid: true }; // No bloquear en caso de error
  }
}

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
 * Validador 3: Verificar disponibilidad del profesor
 * Comprueba si el profesor asignado al curso está disponible en el día y bloque solicitado.
 * La disponibilidad se almacena en horas_programables.disponibilidad como JSON:
 *   { "Lunes": ["9:30-10:20", "10:30-11:20"], "Martes": [...], ... }
 * Si no hay disponibilidad registrada, se permite (no bloquea).
 */
async function validarDisponibilidadProfesor(horaProgramableId, dia, horaInicio) {
  try {
    const result = await pool.query(
      `SELECT hp.disponibilidad, hp.codigo, hp.seccion, hp.titulo, hp.tipo_hora,
              hp.profesor_1_id, hp.profesor_2_id,
              p1.nombre as prof1_nombre, p2.nombre as prof2_nombre
       FROM horas_programables hp
       LEFT JOIN profesores p1 ON hp.profesor_1_id = p1.id
       LEFT JOIN profesores p2 ON hp.profesor_2_id = p2.id
       WHERE hp.id = $1`,
      [horaProgramableId]
    );

    if (result.rows.length === 0) {
      return { isValid: true };
    }

    const {
      disponibilidad,
      codigo,
      seccion,
      titulo,
      tipo_hora,
      profesor_1_id,
      profesor_2_id,
      prof1_nombre,
      prof2_nombre
    } = result.rows[0];

    if (tipo_hora === 'AYUDANTIA') {
      return { isValid: true };
    }

    if (!profesor_1_id && !profesor_2_id) {
      return { isValid: true };
    }

    // Si no hay disponibilidad registrada, permitir
    if (!disponibilidad || Object.keys(disponibilidad).length === 0) {
      return { isValid: true };
    }

    let disp = disponibilidad;
    if (typeof disp === 'string') {
      try { disp = JSON.parse(disp); } catch (e) { return { isValid: true }; }
    }

    // Obtener los bloques disponibles para ese día
    const bloquesDisponibles = disp[dia];

    // Si no hay datos para ese día, el profesor no tiene disponibilidad ese día
    if (!bloquesDisponibles || !Array.isArray(bloquesDisponibles) || bloquesDisponibles.length === 0) {
      const nombreProf = prof1_nombre || prof2_nombre || 'Profesor';
      return {
        isValid: false,
        warning: `🚫 Disponibilidad: ${nombreProf} no tiene disponibilidad registrada el día ${dia} para ${titulo || codigo} Sección ${seccion}.`
      };
    }

    // Construir el rango del bloque solicitado: "9:30-10:20"
    const horaInicioNorm = normalizarHora(horaInicio);
    const bloqueCompleto = BLOQUES_MAP[horaInicioNorm];

    if (!bloqueCompleto) {
      return { isValid: true }; // Bloque desconocido, no bloquear
    }

    // Verificar si el bloque está en la lista de disponibilidad
    // Normalizar los bloques de disponibilidad para comparación
    const bloquesNormalizados = bloquesDisponibles.map(b => {
      const partes = b.split('-');
      if (partes.length === 2) {
        return `${normalizarHora(partes[0])}-${normalizarHora(partes[1])}`;
      }
      return b;
    });

    if (!bloquesNormalizados.includes(bloqueCompleto)) {
      const nombreProf = prof1_nombre || prof2_nombre || 'Profesor';
      return {
        isValid: false,
        warning: `🚫 Disponibilidad: ${nombreProf} no está disponible ${dia} ${bloqueCompleto} para ${titulo || codigo} Sección ${seccion}.`
      };
    }

    return { isValid: true };
  } catch (err) {
    console.error('Error en validarDisponibilidadProfesor:', err);
    return { isValid: true }; // No bloquear en caso de error
  }
}

/**
 * Validador 4: Prevenir doble asignación de profesor
 * Verifica que el profesor asignado a esta hora no esté ya programado
 * en el mismo día y bloque horario EN CUALQUIER dashboard y horario (los 4 timetables).
 * Compara por profesor_1_id y profesor_2_id.
 */
async function validarDobleAsignacionProfesor(horaProgramableId, dashboardId, dia, horaInicio) {
  try {
    // Obtener los profesores del hora_programable que se quiere registrar
    const progResult = await pool.query(
      `SELECT hp.profesor_1_id, hp.profesor_2_id, hp.codigo, hp.seccion, hp.titulo, hp.tipo_hora,
              p1.nombre as prof1_nombre, p2.nombre as prof2_nombre
       FROM horas_programables hp
       LEFT JOIN profesores p1 ON hp.profesor_1_id = p1.id
       LEFT JOIN profesores p2 ON hp.profesor_2_id = p2.id
       WHERE hp.id = $1`,
      [horaProgramableId]
    );

    if (progResult.rows.length === 0) {
      return { isValid: true };
    }

    const {
      profesor_1_id,
      profesor_2_id,
      codigo,
      seccion,
      titulo,
      tipo_hora,
      prof1_nombre,
      prof2_nombre
    } = progResult.rows[0];

    if (tipo_hora === 'AYUDANTIA') {
      return { isValid: true };
    }

    // Si no hay profesores asignados, no hay nada que validar
    if (!profesor_1_id && !profesor_2_id) {
      return { isValid: true };
    }

    // Construir lista de IDs de profesores a verificar
    const profesorIds = [];
    if (profesor_1_id) profesorIds.push(profesor_1_id);
    if (profesor_2_id) profesorIds.push(profesor_2_id);

    // Buscar todas las horas registradas en el mismo día y hora_inicio
    // que tengan alguno de estos profesores asignados
    // Busca en TODOS los dashboards y TODOS los horarios (4 timetables)
    const conflictoResult = await pool.query(
      `SELECT hr.id, hr.dashboard_id, hr.horario, hr.dia_semana, hr.hora_inicio,
              hp.codigo as conflicto_codigo, hp.seccion as conflicto_seccion, 
              hp.titulo as conflicto_titulo, hp.tipo_hora,
              hp.profesor_1_id, hp.profesor_2_id,
              p1.nombre as conflicto_prof1, p2.nombre as conflicto_prof2
       FROM horas_registradas hr
       JOIN horas_programables hp ON hr.hora_programable_id = hp.id
       LEFT JOIN profesores p1 ON hp.profesor_1_id = p1.id
       LEFT JOIN profesores p2 ON hp.profesor_2_id = p2.id
       WHERE hr.dia_semana = $1
       AND hr.hora_inicio = $2
       AND (hp.profesor_1_id = ANY($3) OR hp.profesor_2_id = ANY($3))`,
      [dia, horaInicio, profesorIds]
    );

    if (conflictoResult.rows.length === 0) {
      return { isValid: true };
    }

    // Hay un conflicto - el profesor ya está asignado en ese bloque
    const conflicto = conflictoResult.rows[0];
    
    // Determinar cuál profesor causa el conflicto
    let nombreProfesorConflicto = '';
    for (const profId of profesorIds) {
      if (profId === conflicto.profesor_1_id || profId === conflicto.profesor_2_id) {
        // Buscar nombre
        if (profId === profesor_1_id) nombreProfesorConflicto = prof1_nombre || '';
        else if (profId === profesor_2_id) nombreProfesorConflicto = prof2_nombre || '';
        break;
      }
    }

    const horaInicioNorm = normalizarHora(typeof horaInicio === 'string' ? horaInicio.substring(0, 5) : horaInicio);
    const bloqueCompleto = BLOQUES_MAP[horaInicioNorm] || horaInicioNorm;

    return {
      isValid: false,
      warning: `👨‍🏫 Doble asignación: ${nombreProfesorConflicto || 'El profesor'} ya está asignado en ${conflicto.conflicto_titulo || conflicto.conflicto_codigo} Sección ${conflicto.conflicto_seccion} (${conflicto.tipo_hora}) el ${dia} ${bloqueCompleto} (horario: ${conflicto.horario}).`,
      conflictingHoraRegId: conflicto.id
    };
  } catch (err) {
    console.error('Error en validarDobleAsignacionProfesor:', err);
    return { isValid: true }; // No bloquear en caso de error
  }
}

/**
 * Validador 5: Prevenir doble asignación de sala especial
 * Verifica que la sala especial asignada a esta hora no esté ya ocupada
 * en el mismo día y bloque horario EN CUALQUIER dashboard y horario.
 * A diferencia de profesores, aplica incluso entre mismo código distinta sección.
 */
async function validarDobleAsignacionSalaEspecial(horaProgramableId, dashboardId, dia, horaInicio) {
  try {
    // Obtener la sala_especial del hora_programable que se quiere registrar
    const progResult = await pool.query(
      `SELECT hp.sala_especial, hp.codigo, hp.seccion, hp.titulo, hp.tipo_hora
       FROM horas_programables hp
       WHERE hp.id = $1`,
      [horaProgramableId]
    );

    if (progResult.rows.length === 0) {
      return { isValid: true };
    }

    const { sala_especial, codigo, seccion, titulo, tipo_hora } = progResult.rows[0];

    // Si no tiene sala especial asignada, no hay nada que validar
    if (!sala_especial) {
      return { isValid: true };
    }

    // Buscar todas las horas registradas en el mismo día y hora_inicio
    // que tengan la misma sala_especial
    const conflictoResult = await pool.query(
      `SELECT hr.id, hr.dashboard_id, hr.horario, hr.dia_semana, hr.hora_inicio,
              hp.codigo as conflicto_codigo, hp.seccion as conflicto_seccion, 
              hp.titulo as conflicto_titulo, hp.tipo_hora, hp.sala_especial
       FROM horas_registradas hr
       JOIN horas_programables hp ON hr.hora_programable_id = hp.id
       WHERE hr.dia_semana = $1
       AND hr.hora_inicio = $2
       AND hp.sala_especial = $3`,
      [dia, horaInicio, sala_especial]
    );

    if (conflictoResult.rows.length === 0) {
      return { isValid: true };
    }

    // Hay un conflicto - la sala especial ya está ocupada en ese bloque
    const conflicto = conflictoResult.rows[0];

    const horaInicioNorm = normalizarHora(typeof horaInicio === 'string' ? horaInicio.substring(0, 5) : horaInicio);
    const bloqueCompleto = BLOQUES_MAP[horaInicioNorm] || horaInicioNorm;

    return {
      isValid: false,
      warning: `🏫 Sala especial ocupada: "${sala_especial}" ya está asignada a ${conflicto.conflicto_titulo || conflicto.conflicto_codigo} Sección ${conflicto.conflicto_seccion} (${conflicto.tipo_hora}) el ${dia} ${bloqueCompleto} (horario: ${conflicto.horario}).`,
      conflictingHoraRegId: conflicto.id
    };
  } catch (err) {
    console.error('Error en validarDobleAsignacionSalaEspecial:', err);
    return { isValid: true }; // No bloquear en caso de error
  }
}

/**
 * Ejecutar todas las validaciones disponibles
 * Retorna { hasWarnings: boolean, warnings: string[], hasErrors: boolean, errors: string[], conflictIds: number[] }
 */
async function ejecutarValidaciones(horaProgramableId, dashboardId, horario, dia, horaInicio) {
  const warnings = [];
  const errors = [];
  const conflictIds = [];

  // Ejecutar validadores
  const resultadoToques = await validarToquesDeSemestre(horaProgramableId, dashboardId, horario, dia, horaInicio);
  
  if (!resultadoToques.isValid && resultadoToques.warning) {
    warnings.push(resultadoToques.warning);
    if (resultadoToques.conflictingHoraRegId) {
      conflictIds.push(resultadoToques.conflictingHoraRegId);
    }
  }
  if (resultadoToques.error) {
    errors.push(resultadoToques.error);
  }

  // Validador 2: Horarios protegidos
  const resultadoHorarioProtegido = validarHorarioProtegido(dia, horaInicio, horario);
  
  if (resultadoHorarioProtegido.warning) {
    warnings.push(resultadoHorarioProtegido.warning);
  }
  if (resultadoHorarioProtegido.error) {
    errors.push(resultadoHorarioProtegido.error);
  }

  // Validador 3: Disponibilidad del profesor
  const resultadoDisponibilidad = await validarDisponibilidadProfesor(horaProgramableId, dia, horaInicio);
  
  if (!resultadoDisponibilidad.isValid && resultadoDisponibilidad.warning) {
    warnings.push(resultadoDisponibilidad.warning);
  }
  if (resultadoDisponibilidad.error) {
    errors.push(resultadoDisponibilidad.error);
  }

  // Validador 4: Doble asignación de profesor (across all dashboards/timetables)
  const resultadoDobleAsignacion = await validarDobleAsignacionProfesor(horaProgramableId, dashboardId, dia, horaInicio);
  
  if (!resultadoDobleAsignacion.isValid && resultadoDobleAsignacion.warning) {
    warnings.push(resultadoDobleAsignacion.warning);
    if (resultadoDobleAsignacion.conflictingHoraRegId) {
      conflictIds.push(resultadoDobleAsignacion.conflictingHoraRegId);
    }
  }
  if (resultadoDobleAsignacion.error) {
    errors.push(resultadoDobleAsignacion.error);
  }

  // Validador 5: Doble asignación de sala especial (across all dashboards/timetables)
  const resultadoSalaEspecial = await validarDobleAsignacionSalaEspecial(horaProgramableId, dashboardId, dia, horaInicio);
  
  if (!resultadoSalaEspecial.isValid && resultadoSalaEspecial.warning) {
    warnings.push(resultadoSalaEspecial.warning);
    if (resultadoSalaEspecial.conflictingHoraRegId) {
      conflictIds.push(resultadoSalaEspecial.conflictingHoraRegId);
    }
  }
  if (resultadoSalaEspecial.error) {
    errors.push(resultadoSalaEspecial.error);
  }

  return {
    hasWarnings: warnings.length > 0,
    warnings,
    hasErrors: errors.length > 0,
    errors,
    isValid: errors.length === 0,
    conflictIds
  };
}

export {
  validarToquesDeSemestre,
  validarHorarioProtegido,
  validarDisponibilidadProfesor,
  validarDobleAsignacionProfesor,
  validarDobleAsignacionSalaEspecial,
  ejecutarValidaciones
};
