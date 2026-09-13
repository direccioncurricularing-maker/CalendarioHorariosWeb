import pool from '../db/pool.js';
import { normalizarHora } from '../utils/horario-utils.js';
import { extraerSemestres } from './conflict-utils.js';

const diasSemanaMap = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * Normaliza una fecha (Date o string "YYYY-MM-DD") a "YYYY-MM-DD" para
 * comparar días sin depender de la zona horaria.
 */
function normalizarFecha(fecha) {
  if (!fecha) return '';
  if (fecha instanceof Date) return fecha.toISOString().substring(0, 10);
  return String(fecha).substring(0, 10);
}

function tieneConflictoHorarioProtegidoPrueba(prueba) {
  try {
    const { tipo_prueba, fecha } = prueba;

    if (tipo_prueba !== 'TARDE') {
      return false;
    }

    const fechaObj = new Date(fecha);
    const diaSemana = fechaObj.getUTCDay();

    return [2, 3].includes(diaSemana);

  } catch (error) {
    console.error('[ConflictDetector] Error verificando horario protegido de prueba:', error);
    return false;
  }
}

async function reevaluarConflictosPruebasDashboard(dashboardId) {
  try {
    await pool.query(
      `UPDATE pruebas_registradas
       SET conflictos = '[]'::json
       WHERE dashboard_id = $1`,
      [dashboardId]
    );

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
    const conflictosPorPrueba = {};

    for (let i = 0; i < pruebas.length; i++) {
      for (let j = i + 1; j < pruebas.length; j++) {
        const prueba1 = pruebas[i];
        const prueba2 = pruebas[j];

        if (normalizarFecha(prueba1.fecha) === normalizarFecha(prueba2.fecha) &&
            prueba1.tipo_prueba === prueba2.tipo_prueba) {

          if (prueba1.codigo === prueba2.codigo) {
            continue;
          }

          const semestres1 = extraerSemestres(prueba1.especialidades_semestres);
          const semestres2 = extraerSemestres(prueba2.especialidades_semestres);

          const semestresComunes = semestres1.filter(s => semestres2.includes(s));

          if (semestresComunes.length > 0) {
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

    for (let i = 0; i < pruebas.length; i++) {
      for (let j = i + 1; j < pruebas.length; j++) {
        const prueba1 = pruebas[i];
        const prueba2 = pruebas[j];

        if (normalizarFecha(prueba1.fecha) === normalizarFecha(prueba2.fecha) &&
            prueba1.tipo_prueba === prueba2.tipo_prueba) {

          const prof1Ids = [prueba1.profesor_1_id, prueba1.profesor_2_id].filter(Boolean);
          const prof2Ids = [prueba2.profesor_1_id, prueba2.profesor_2_id].filter(Boolean);

          const profesorComun = prof1Ids.find(p => prof2Ids.includes(p));

          if (profesorComun) {
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

    for (const prueba of pruebas) {
      if (tieneConflictoHorarioProtegidoPrueba(prueba)) {
        if (!conflictosPorPrueba[prueba.prueba_reg_id]) {
          conflictosPorPrueba[prueba.prueba_reg_id] = [];
        }
        if (!conflictosPorPrueba[prueba.prueba_reg_id].includes(-1)) {
          conflictosPorPrueba[prueba.prueba_reg_id].push(-1);
        }
      }
    }

    for (const prueba of pruebas) {
      const tipoPrueba = (prueba.tipo_prueba || '').toUpperCase();
      if (!['CLASE', 'AYUDANTIA', 'LAB/TALLER'].includes(tipoPrueba)) continue;

      let bloques = prueba.bloques_horario;
      if (!bloques) continue;
      if (typeof bloques === 'string') {
        try { bloques = JSON.parse(bloques); } catch { continue; }
      }
      if (!Array.isArray(bloques) || bloques.length === 0) continue;

      const fechaObj = new Date(prueba.fecha);
      const diaFecha = diasSemanaMap[fechaObj.getUTCDay()];

      let diaCoincide = false;

      const horaInicioPrueba = prueba.hora_inicio ? normalizarHora(String(prueba.hora_inicio).substring(0, 5)) : null;
      const horaFinPrueba = prueba.hora_fin ? normalizarHora(String(prueba.hora_fin).substring(0, 5)) : null;

      if (horaInicioPrueba && horaFinPrueba) {
        const bloqueSeleccionado = bloques.find(b => {
          const bInicio = b.inicio ? normalizarHora(b.inicio) : null;
          const bFin = b.fin ? normalizarHora(b.fin) : null;
          return bInicio === horaInicioPrueba && bFin === horaFinPrueba;
        });

        if (bloqueSeleccionado && bloqueSeleccionado.dia) {
          diaCoincide = bloqueSeleccionado.dia === diaFecha;
        } else {
          const diasHorario = [...new Set(bloques.map(b => b.dia).filter(Boolean))];
          diaCoincide = diasHorario.length === 0 || diasHorario.includes(diaFecha);
        }
      } else {
        const diasHorario = [...new Set(bloques.map(b => b.dia).filter(Boolean))];
        diaCoincide = diasHorario.length === 0 || diasHorario.includes(diaFecha);
      }

      if (!diaCoincide) {
        if (!conflictosPorPrueba[prueba.prueba_reg_id]) {
          conflictosPorPrueba[prueba.prueba_reg_id] = [];
        }
        if (!conflictosPorPrueba[prueba.prueba_reg_id].includes(-2)) {
          conflictosPorPrueba[prueba.prueba_reg_id].push(-2);
        }
      }
    }

    for (const [pruebaRegId, conflictIds] of Object.entries(conflictosPorPrueba)) {
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

export { reevaluarConflictosPruebasDashboard, tieneConflictoHorarioProtegidoPrueba };
