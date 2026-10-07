import express from 'express';
import  pool  from '../db/pool.js';
import * as pruebasRegistradasService from '../services/pruebas-registradas.service.js';
import * as appScriptService from '../services/appscript.service.js';
import { reevaluarConflictosPruebasDashboard } from '../services/conflict-detector-pruebas.service.js';
import { obtenerPeriodoActual } from '../utils/periodo-utils.js';

const router = express.Router();

/**
 * GET /api/pruebas-registradas/:dashboardId
 * Obtener todas las pruebas registradas de un dashboard
 */
router.get('/:dashboardId', async (req, res) => {
  try {
    const { dashboardId } = req.params;
    const pruebasRegistradas = await pruebasRegistradasService.obtenerPorDashboard(dashboardId);
    res.json({ pruebasRegistradas });
  } catch (err) {
    console.error('Error al obtener pruebas registradas:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/pruebas-registradas/rango/:dashboardId
 * Obtener pruebas registradas por rango de fechas
 * Query params: fechaInicio, fechaFin (formato YYYY-MM-DD)
 */
router.get('/rango/:dashboardId', async (req, res) => {
  try {
    const { dashboardId } = req.params;
    const { fechaInicio, fechaFin } = req.query;

    if (!fechaInicio || !fechaFin) {
      return res.status(400).json({ error: 'Se requieren fechaInicio y fechaFin' });
    }

    const pruebas = await pruebasRegistradasService.obtenerPorRangoFechas(
      dashboardId,
      fechaInicio,
      fechaFin
    );
    res.json({ pruebas });
  } catch (err) {
    console.error('Error al obtener pruebas por rango de fechas:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pruebas-registradas
 * Crear una nueva prueba registrada
 * Body: { pruebaProgramableId, dashboardId, fecha, horaInicio, horaFin }
 */
router.post('/', async (req, res) => {
  try {
    const { pruebaProgramableId, dashboardId, fecha, horaInicio, horaFin } = req.body;

    if (!pruebaProgramableId || !dashboardId || !fecha) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos' });
    }

    // Validar cantidad_evaluaciones: contar pruebas registradas del mismo curso (codigo+seccion)
    // excluyendo EXAMEN del conteo
    const ppResult = await pool.query(
      'SELECT codigo, seccion, tipo_prueba, cantidad_evaluaciones, periodo FROM pruebas_programables WHERE id = $1',
      [pruebaProgramableId]
    );

    if (ppResult.rows.length > 0) {
      // La prueba debe pertenecer al mismo período del dashboard
      const dashResult = await pool.query(
        'SELECT periodo FROM dashboards WHERE id = $1',
        [dashboardId]
      );

      if (dashResult.rows.length === 0) {
        return res.status(404).json({ error: 'Dashboard no encontrado' });
      }

      if (ppResult.rows[0].periodo !== dashResult.rows[0].periodo) {
        return res.status(400).json({
          error: 'La prueba no pertenece al período de este dashboard'
        });
      }

      const pp = ppResult.rows[0];
      const tipoPrueba = (pp.tipo_prueba || '').toUpperCase();
      
      // Solo validar si no es EXAMEN y hay un límite definido
      if (tipoPrueba !== 'EXAMEN' && pp.cantidad_evaluaciones != null) {
        // Contar pruebas registradas del mismo curso (codigo+seccion) en este dashboard, excluyendo EXAMEN
        const countResult = await pool.query(
          `SELECT COUNT(*) as total FROM pruebas_registradas pr
           JOIN pruebas_programables pp2 ON pr.prueba_programable_id = pp2.id
           WHERE pr.dashboard_id = $1 
             AND pp2.codigo = $2 AND pp2.seccion = $3
             AND UPPER(pp2.tipo_prueba) != 'EXAMEN'`,
          [dashboardId, pp.codigo, pp.seccion]
        );

        const totalActual = parseInt(countResult.rows[0].total, 10);
        if (totalActual >= pp.cantidad_evaluaciones) {
          return res.status(400).json({ 
            error: `Límite de evaluaciones alcanzado para ${pp.codigo}-${pp.seccion}. Máximo: ${pp.cantidad_evaluaciones}, Actual: ${totalActual}` 
          });
        }
      }
    }

    const pruebaRegistrada = await pruebasRegistradasService.crear(
      pruebaProgramableId,
      dashboardId,
      fecha,
      horaInicio || null,
      horaFin || null
    );

    // Re-evaluar conflictos del dashboard después de crear
    await reevaluarConflictosPruebasDashboard(dashboardId);

    res.json({ pruebaRegistrada });
  } catch (err) {
    console.error('Error al crear prueba registrada:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/pruebas-registradas/:id
 * Actualizar una prueba registrada
 * Body: { fecha, horaInicio, horaFin }
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { fecha, horaInicio, horaFin } = req.body;

    if (!fecha) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos' });
    }

    const pruebaRegistrada = await pruebasRegistradasService.actualizar(
      id,
      fecha,
      horaInicio !== undefined ? horaInicio : null,
      horaFin !== undefined ? horaFin : null
    );

    // Re-evaluar conflictos del dashboard después de actualizar
    await reevaluarConflictosPruebasDashboard(pruebaRegistrada.dashboard_id);

    res.json({ pruebaRegistrada });
  } catch (err) {
    console.error('Error al actualizar prueba registrada:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/pruebas-registradas/:id
 * Eliminar una prueba registrada
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Obtener dashboard_id antes de eliminar
    const pruebaAntes = await pruebasRegistradasService.obtenerPorId(id);
    
    if (!pruebaAntes) {
      return res.status(404).json({ error: 'Prueba registrada no encontrada' });
    }
    
    const dashboardId = pruebaAntes.dashboard_id;
    
    // Limpiar conflictos antes de eliminar
    await pruebasRegistradasService.limpiarConflictos(id);
    
    const pruebaRegistrada = await pruebasRegistradasService.eliminar(id);

    // Re-evaluar conflictos del dashboard después de eliminar
    await reevaluarConflictosPruebasDashboard(dashboardId);

    res.json({ message: 'Prueba registrada eliminada', pruebaRegistrada });
  } catch (err) {
    console.error('Error al eliminar prueba registrada:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/pruebas-registradas/dashboard/:dashboardId
 * Eliminar todas las pruebas registradas de un dashboard
 */
router.delete('/dashboard/:dashboardId', async (req, res) => {
  try {
    const { dashboardId } = req.params;
    const count = await pruebasRegistradasService.limpiarDashboard(dashboardId);

    res.json({ message: `${count} pruebas registradas eliminadas` });
  } catch (err) {
    console.error('Error al limpiar pruebas registradas:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pruebas-registradas/enviar-sheets/:dashboardId
 * Armar diccionario de pruebas y enviarlo a Google Sheets
 */
router.post('/enviar-sheets/:dashboardId', async (req, res) => {
  try {
    const { dashboardId } = req.params;

    const dashResult = await pool.query(
      `SELECT periodo FROM dashboards WHERE id = $1`,
      [dashboardId]
    );
    if (dashResult.rows.length === 0) {
      return res.status(404).json({ error: 'Dashboard no encontrado' });
    }
    if (dashResult.rows[0].periodo !== obtenerPeriodoActual()) {
      return res.status(400).json({
        error: `Este dashboard pertenece al período "${dashResult.rows[0].periodo}". La exportación solo está disponible para el período actual.`
      });
    }

    const diccionario = await pruebasRegistradasService.armarDiccionarioPruebasParaGoogleSheets(dashboardId);
    const resultado = await appScriptService.enviarPruebasASheets(diccionario);

    res.json({
      mensaje: 'Pruebas enviadas a Google Sheets exitosamente',
      resultado
    });
  } catch (err) {
    console.error('Error al enviar pruebas a Google Sheets:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
