import express from 'express';
import * as horasRegistradasService from '../services/horas-registradas.service.js';
import * as appScriptService from '../services/appscript.service.js';
import { ejecutarValidaciones } from '../validators/hora-registrada.validators.js';
import { reevaluarConflictosDashboard, reevaluarConflictosNuevoItem, reevaluarConflictosItemMovido, limpiarConflictosDeItem } from '../services/conflict-detector.service.js';
import { BLOQUES, DIAS_NUMERO } from '../constants/horarios.js';
import { calcularHorariosDestino } from '../utils/horario-utils.js';
import pool from '../db/pool.js';


const router = express.Router();

const diaNumeroPorNombre = DIAS_NUMERO;



/**
 * GET /api/horas-registradas/diccionario/:dashboardId
 * Obtener diccionario preparado para Google Sheets
 */
router.get('/diccionario/:dashboardId', async (req, res) => {
  try {
    const { dashboardId } = req.params;
    const diccionario = await horasRegistradasService.armarDiccionarioParaGoogleSheets(dashboardId);
    res.json({ diccionario });
  } catch (err) {
    console.error('Error al armar diccionario para Google Sheets:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/horas-registradas/debug-conflictos/:dashboardId
 * Diagnóstico: muestra datos de profesores y conflictos detectados
 */
router.get('/debug-conflictos/:dashboardId', async (req, res) => {
  try {
    const { dashboardId } = req.params;
    
    // Re-evaluar conflictos primero
    const resultado = await reevaluarConflictosDashboard(dashboardId);
    
    // Obtener estado actual
    const { pool: dbPool } = await import('../db/pool.js');
    const { rows } = await dbPool.query(
      `SELECT 
        hr.id, hr.dia_semana, hr.hora_inicio, hr.horario, hr.conflictos,
        hp.codigo, hp.seccion, hp.tipo_hora, hp.profesor_1_id, hp.profesor_2_id
       FROM horas_registradas hr
       JOIN horas_programables hp ON hr.hora_programable_id = hp.id
       WHERE hr.dashboard_id = $1
       ORDER BY hr.dia_semana, hr.hora_inicio`,
      [dashboardId]
    );
    
    res.json({ 
      resultado,
      horas: rows.map(r => ({
        id: r.id,
        dia: r.dia_semana,
        hora: String(r.hora_inicio),
        horario: r.horario,
        curso: `${r.codigo} Sec${r.seccion} ${r.tipo_hora}`,
        prof1: r.profesor_1_id,
        prof2: r.profesor_2_id,
        conflictos: r.conflictos
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/horas-registradas/:dashboardId
 * Obtener todas las horas registradas de un dashboard
 */
router.get('/:dashboardId', async (req, res) => {
  try {
    const { dashboardId } = req.params;
    const horasRegistradas = await horasRegistradasService.obtenerPorDashboard(dashboardId);
    res.json({ horasRegistradas });
  } catch (err) {
    console.error('Error al obtener horas registradas:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/horas-registradas
 * Crear una nueva hora registrada
 * Body: { horaProgramableId, dashboardId, dia, bloqueIndex, semestreId }
 */
router.post('/', async (req, res) => {
  try {
    const { horaProgramableId, dashboardId, dia, bloqueIndex, semestreId, horarioEspecifico } = req.body;
    const esRestore = !!horarioEspecifico;

    if (!horaProgramableId || !dashboardId || !dia || bloqueIndex === undefined) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos' });
    }

    // Obtener la hora de inicio y fin del bloque
    const bloque = BLOQUES[bloqueIndex];
    if (!bloque) {
      return res.status(400).json({ error: 'Bloque inválido' });
    }

    const progResult = await pool.query(
      `SELECT id, especialidades_semestres, codigo, seccion, tipo_hora
       FROM horas_programables
       WHERE id = $1`,
      [horaProgramableId]
    );

    if (progResult.rows.length === 0) {
      return res.status(404).json({ error: 'Hora programable no encontrada' });
    }

    // Un curso solo puede asignarse en los horarios/grupos que le corresponden
    // según sus especialidades y semestres. El undo (esRestore) queda exento.
    if (!esRestore && semestreId) {
      const destinosNaturales = calcularHorariosDestino(progResult.rows[0].especialidades_semestres);
      if (!destinosNaturales.includes(semestreId)) {
        return res.status(400).json({
          error: 'Este curso no pertenece al horario seleccionado'
        });
      }
    }

    const existeMismoBloque = await pool.query(
      `SELECT id
       FROM horas_registradas
       WHERE hora_programable_id = $1
         AND dashboard_id = $2
         AND dia_semana = $3
         AND hora_inicio = $4::time
         AND hora_fin = $5::time
       LIMIT 1`,
      [horaProgramableId, dashboardId, dia, bloque.inicio, bloque.fin]
    );

    if (existeMismoBloque.rows.length > 0 && !esRestore) {
      return res.status(400).json({
        error: 'Esta hora ya está registrada para el mismo curso/sección/tipo en ese bloque'
      });
    }

    // Convertir el día a número
    const diaNumero = diaNumeroPorNombre[dia] || 1;

    let warnings = [];
    if (!esRestore) {
      const validationResult = await ejecutarValidaciones(horaProgramableId, dashboardId, semestreId, dia, bloque.inicio);
      if (validationResult.hasErrors) {
        return res.status(400).json({
          error: 'Validación fallida',
          errors: validationResult.errors
        });
      }
      warnings = validationResult.warnings;
    }

    const horariosObjetivo = horarioEspecifico
      ? [horarioEspecifico]
      : calcularHorariosDestino(progResult.rows[0].especialidades_semestres, semestreId);

    const horasCreadas = [];
    for (const horarioObjetivo of horariosObjetivo) {
      const horaRegistrada = await horasRegistradasService.crear(
        horaProgramableId,
        dashboardId,
        diaNumero,
        bloqueIndex,
        bloque.inicio,
        bloque.fin,
        horarioObjetivo
      );
      horasCreadas.push(horaRegistrada);
    }

    for (const hr of horasCreadas) {
      await reevaluarConflictosNuevoItem(hr.id);
    }

    // Retornar la hora registrada junto con las advertencias
    res.json({
      horaRegistrada: horasCreadas[0],
      horasRegistradas: horasCreadas,
      warnings
    });
  } catch (err) {
    console.error('Error al crear hora registrada:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/horas-registradas/:id
 * Actualizar una hora registrada (cuando se mueve)
 * Body: { dia, bloqueIndex }
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { dia, bloqueIndex } = req.body;

    if (!dia || bloqueIndex === undefined) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos' });
    }

    const bloque = BLOQUES[bloqueIndex];
    if (!bloque) {
      return res.status(400).json({ error: 'Bloque inválido' });
    }

    const horaBase = await horasRegistradasService.obtenerPorId(id);
    if (!horaBase) {
      return res.status(404).json({ error: 'Hora registrada no encontrada' });
    }

    const horaInicioActual = String(horaBase.hora_inicio).substring(0, 8);
    const horaFinActual = String(horaBase.hora_fin).substring(0, 8);

    const existeEnDestino = await pool.query(
      `SELECT id
       FROM horas_registradas
       WHERE hora_programable_id = $1
         AND dashboard_id = $2
         AND dia_semana = $3
         AND hora_inicio = $4::time
         AND hora_fin = $5::time
         AND NOT (
           dia_semana = $6
           AND hora_inicio = $7::time
           AND hora_fin = $8::time
         )
       LIMIT 1`,
      [
        horaBase.hora_programable_id,
        horaBase.dashboard_id,
        dia,
        bloque.inicio,
        bloque.fin,
        horaBase.dia_semana,
        horaInicioActual,
        horaFinActual,
      ]
    );

    if (existeEnDestino.rows.length > 0) {
      return res.status(400).json({
        error: 'Ya existe una hora registrada para el mismo curso/sección/tipo en ese bloque destino',
      });
    }

    const diaNumero = diaNumeroPorNombre[dia] || 1;
    const diaSemanaDestino = Object.keys(diaNumeroPorNombre).find(k => diaNumeroPorNombre[k] === diaNumero) || dia;

    const result = await pool.query(
      `UPDATE horas_registradas
       SET dia_semana = $1, hora_inicio = $2::time, hora_fin = $3::time, updated_at = CURRENT_TIMESTAMP
       WHERE hora_programable_id = $4
         AND dashboard_id = $5
         AND dia_semana = $6
         AND hora_inicio = $7::time
         AND hora_fin = $8::time
       RETURNING *`,
      [
        diaSemanaDestino,
        bloque.inicio,
        bloque.fin,
        horaBase.hora_programable_id,
        horaBase.dashboard_id,
        horaBase.dia_semana,
        horaInicioActual,
        horaFinActual,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No se encontraron horas para actualizar' });
    }

    for (const row of result.rows) {
      await reevaluarConflictosItemMovido(row.id);
    }

    res.json({
      horaRegistrada: result.rows[0],
      horasRegistradas: result.rows,
    });
  } catch (err) {
    console.error('Error al actualizar hora registrada:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/horas-registradas/:id
 * Eliminar una hora registrada
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Obtener el dashboardId antes de eliminar
    const horaCompleta = await horasRegistradasService.obtenerPorId(id);
    if (!horaCompleta) {
      return res.status(404).json({ error: 'Hora registrada no encontrada' });
    }

    const horaInicioActual = String(horaCompleta.hora_inicio).substring(0, 8);
    const horaFinActual = String(horaCompleta.hora_fin).substring(0, 8);

    // Buscar las filas espejo antes de borrarlas, para poder limpiar las
    // referencias de conflicto que otros post-its guardan hacia ellas.
    const aEliminar = await pool.query(
      `SELECT *
       FROM horas_registradas
       WHERE hora_programable_id = $1
         AND dashboard_id = $2
         AND dia_semana = $3
         AND hora_inicio = $4::time
         AND hora_fin = $5::time`,
      [
        horaCompleta.hora_programable_id,
        horaCompleta.dashboard_id,
        horaCompleta.dia_semana,
        horaInicioActual,
        horaFinActual,
      ]
    );

    for (const row of aEliminar.rows) {
      await limpiarConflictosDeItem(row.id);
    }

    const eliminadas = await pool.query(
      `DELETE FROM horas_registradas
       WHERE hora_programable_id = $1
         AND dashboard_id = $2
         AND dia_semana = $3
         AND hora_inicio = $4::time
         AND hora_fin = $5::time
       RETURNING *`,
      [
        horaCompleta.hora_programable_id,
        horaCompleta.dashboard_id,
        horaCompleta.dia_semana,
        horaInicioActual,
        horaFinActual,
      ]
    );

    res.json({
      message: `${eliminadas.rows.length} hora(s) registrada(s) eliminada(s)`,
      horasRegistradas: eliminadas.rows,
      horaRegistrada: eliminadas.rows[0] || null,
    });
  } catch (err) {
    console.error('Error al eliminar hora registrada:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/horas-registradas/dashboard/:dashboardId
 * Eliminar todas las horas registradas de un dashboard
 */
router.delete('/dashboard/:dashboardId', async (req, res) => {
  try {
    const { dashboardId } = req.params;
    const count = await horasRegistradasService.limpiarDashboard(dashboardId);

    res.json({ message: `${count} horas registradas eliminadas` });
  } catch (err) {
    console.error('Error al limpiar horas registradas:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/horas-registradas/enviar-sheets/:dashboardId
 * Obtener diccionario y enviarlo a Google Sheets
 */
router.post('/enviar-sheets/:dashboardId', async (req, res) => {
  try {
    const { dashboardId } = req.params;
    
    // Obtener el diccionario preparado
    const diccionario = await horasRegistradasService.armarDiccionarioParaGoogleSheets(dashboardId);
    
    // Enviar a Google Sheets a través del Apps Script
    const resultado = await appScriptService.enviarDiccionarioASheets(diccionario);
    
    res.json({ 
      mensaje: 'Datos enviados a Google Sheets exitosamente',
      resultado 
    });
  } catch (err) {
    console.error('Error al enviar datos a Google Sheets:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

