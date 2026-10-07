import pool from '../../db/pool.js';
import { BLOQUES_MAP } from '../../constants/horarios.js';
import { normalizarHora } from '../../utils/horario-utils.js';

export default {
  nombre: 'doble_asignacion_profesor',

  async validar({ horaProgramableId, dashboardId, dia, horaInicio }) {
    try {
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
        profesor_1_id, profesor_2_id, _codigo, _seccion, _titulo,
        tipo_hora, prof1_nombre, prof2_nombre,
      } = progResult.rows[0];

      if (tipo_hora === 'AYUDANTIA') {
        return { isValid: true };
      }

      if (!profesor_1_id && !profesor_2_id) {
        return { isValid: true };
      }

      const profesorIds = [];
      if (profesor_1_id) profesorIds.push(profesor_1_id);
      if (profesor_2_id) profesorIds.push(profesor_2_id);

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
         AND (hp.profesor_1_id = ANY($3) OR hp.profesor_2_id = ANY($3))
         AND hr.dashboard_id = $4`,
        [dia, horaInicio, profesorIds, dashboardId]
      );

      if (conflictoResult.rows.length === 0) {
        return { isValid: true };
      }

      const conflicto = conflictoResult.rows[0];

      let nombreProfesorConflicto = '';
      for (const profId of profesorIds) {
        if (profId === conflicto.profesor_1_id || profId === conflicto.profesor_2_id) {
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
        conflictingHoraRegId: conflicto.id,
      };
    } catch (err) {
      console.error('Error en DobleAsignacionProfesorValidator:', err);
      return { isValid: true };
    }
  },
};
