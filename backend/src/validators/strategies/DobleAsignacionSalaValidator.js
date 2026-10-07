import pool from '../../db/pool.js';
import { BLOQUES_MAP } from '../../constants/horarios.js';
import { normalizarHora } from '../../utils/horario-utils.js';

export default {
  nombre: 'doble_asignacion_sala',

  async validar({ horaProgramableId, dashboardId, dia, horaInicio }) {
    try {
      const progResult = await pool.query(
        `SELECT hp.sala_especial, hp.codigo, hp.seccion, hp.titulo, hp.tipo_hora
         FROM horas_programables hp
         WHERE hp.id = $1`,
        [horaProgramableId]
      );

      if (progResult.rows.length === 0) {
        return { isValid: true };
      }

      const { sala_especial, _codigo, _seccion, _titulo, _tipo_hora } = progResult.rows[0];

      if (!sala_especial) {
        return { isValid: true };
      }

      const conflictoResult = await pool.query(
        `SELECT hr.id, hr.dashboard_id, hr.horario, hr.dia_semana, hr.hora_inicio,
                hp.codigo as conflicto_codigo, hp.seccion as conflicto_seccion,
                hp.titulo as conflicto_titulo, hp.tipo_hora, hp.sala_especial
         FROM horas_registradas hr
         JOIN horas_programables hp ON hr.hora_programable_id = hp.id
         WHERE hr.dia_semana = $1
         AND hr.hora_inicio = $2
         AND hp.sala_especial = $3
         AND hr.dashboard_id = $4`,
        [dia, horaInicio, sala_especial, dashboardId]
      );

      if (conflictoResult.rows.length === 0) {
        return { isValid: true };
      }

      const conflicto = conflictoResult.rows[0];

      const horaInicioNorm = normalizarHora(typeof horaInicio === 'string' ? horaInicio.substring(0, 5) : horaInicio);
      const bloqueCompleto = BLOQUES_MAP[horaInicioNorm] || horaInicioNorm;

      return {
        isValid: false,
        warning: `🏫 Sala especial ocupada: "${sala_especial}" ya está asignada a ${conflicto.conflicto_titulo || conflicto.conflicto_codigo} Sección ${conflicto.conflicto_seccion} (${conflicto.tipo_hora}) el ${dia} ${bloqueCompleto} (horario: ${conflicto.horario}).`,
        conflictingHoraRegId: conflicto.id,
      };
    } catch (err) {
      console.error('Error en DobleAsignacionSalaValidator:', err);
      return { isValid: true };
    }
  },
};
