import express from "express";
import { callAppScript } from "../services/appscript.service.js";
import {
  procesarMaestrosYCrearHorarios,
  obtenerHorariosProgramables,
  limpiarHorariosProgramables,
  obtenerPruebasProgramables,
  limpiarPruebasProgramables,
  actualizarCalendarioPruebas,
} from "../services/maestros.service.js";
import { reevaluarConflictosDashboard } from "../services/conflict-detector.service.js";
import { reevaluarConflictosPruebasDashboard } from "../services/conflict-detector-pruebas.service.js";
import  pool  from "../db/pool.js";
import { usarRespaldoDesdeHoja } from "../services/sheets-sync.service.js";

const router = express.Router();

router.get("/ping", async (req, res) => {
  try {
    const result = await callAppScript("ping");

    res.json({
      ok: true,
      appscript: result,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

router.get("/master.list", async (req, res) => {
  try {
    const result = await callAppScript("maestro.listar");

    res.json({
      ok: true,
      appscript: result,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * POST /api/sheets/load-maestros
 * Carga los maestros desde Google Sheets y crea los horarios programables
 */
router.post("/load-maestros", async (req, res) => {
  try {
    // Obtener datos de maestro.listar
    console.log("Llamando a maestro.listar en AppScript...");
    const resultString = await callAppScript("maestro.listar");
    console.log("Respuesta de maestro.listar recibida.",resultString);
    // Parsear el JSON string
    let maestrosData;
    try {
      maestrosData = JSON.parse(resultString);
    } catch (parseError) {
      return res.status(400).json({
        ok: false,
        error: "Error parseando JSON de maestros",
        details: parseError.message,
      });
    }

    // Validar que sea un array
    if (!Array.isArray(maestrosData)) {
      return res.status(400).json({
        ok: false,
        error: "Los datos de maestros no son un array",
      });
    }

    // Procesar y crear horarios
    const resultadoMaestros = await procesarMaestrosYCrearHorarios(maestrosData);

    // Re-evaluar conflictos de todos los dashboards
    const dashboardsResult = await pool.query(`SELECT id FROM dashboards`);
    for (const dash of dashboardsResult.rows) {
      await reevaluarConflictosDashboard(dash.id);
      await reevaluarConflictosPruebasDashboard(dash.id);
    }
    console.log(`[load-maestros] Re-evaluados conflictos de ${dashboardsResult.rows.length} dashboards`);

    res.json({
      ok: true,
      mensaje: `Se procesaron ${resultadoMaestros.creados ?? 0} horarios programables`,
      horariosCreados: resultadoMaestros,
    });
  } catch (err) {
    console.error("Error en load-maestros:", err);
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * POST /api/sheets/usar-respaldo/:dashboardId
 * Carga maestros como el flujo actual + restaura horas/pruebas registradas desde MAESTRO
 */
router.post("/usar-respaldo/:dashboardId", async (req, res) => {
  try {
    const { dashboardId } = req.params;
    const resultado = await usarRespaldoDesdeHoja(parseInt(dashboardId, 10));

    res.json({
      ok: true,
      mensaje: "Respaldo aplicado correctamente",
      resumen: {
        maestrosProcesados: resultado.maestrosProcesados,
        horariosProgramablesProcesados: resultado.horariosProgramablesProcesados,
        horasRestauradas: resultado.horasRestauradas,
        pruebasRestauradas: resultado.pruebasRestauradas,
        pruebasCalendarioCreadas: resultado.pruebasCalendarioCreadas,
        pruebasCalendarioEliminadas: resultado.pruebasCalendarioEliminadas,
        conflictosHoras: resultado.conflictosHoras,
        conflictosPruebas: resultado.conflictosPruebas,
        advertencias: resultado.advertencias,
      },
      horarios: resultado.horarios,
      pruebas: resultado.pruebas,
    });
  } catch (err) {
    console.error("Error en usar-respaldo:", err);
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * GET /api/sheets/horas-programables
 * Obtiene todos los horarios programables creados
 */
router.get("/horas-programables", async (req, res) => {
  try {
    const horarios = await obtenerHorariosProgramables();

    res.json({
      ok: true,
      cantidad: horarios.length,
      horarios,
    });
  } catch (err) {
    console.error("Error en horas-programables:", err);
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * DELETE /api/sheets/horas-programables
 * Limpia todos los horarios programables (para reload)
 */
router.delete("/horas-programables", async (req, res) => {
  try {
    const cantidad = await limpiarHorariosProgramables();

    res.json({
      ok: true,
      mensaje: `Se eliminaron ${cantidad} horarios programables`,
    });
  } catch (err) {
    console.error("Error limpiando horas-programables:", err);
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * GET /api/sheets/pruebas-programables
 * Obtiene todas las pruebas programables creadas
 */
router.get("/pruebas-programables", async (req, res) => {
  try {
    const pruebas = await obtenerPruebasProgramables();

    res.json({
      ok: true,
      cantidad: pruebas.length,
      pruebas,
    });
  } catch (err) {
    console.error("Error en pruebas-programables:", err);
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * DELETE /api/sheets/pruebas-programables
 * Limpia todas las pruebas programables (para reload)
 */
router.delete("/pruebas-programables", async (req, res) => {
  try {
    const cantidad = await limpiarPruebasProgramables();

    res.json({
      ok: true,
      mensaje: `Se eliminaron ${cantidad} pruebas programables`,
    });
  } catch (err) {
    console.error("Error limpiando pruebas-programables:", err);
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * POST /api/sheets/actualizar-calendario/:dashboardId
 * Crea/actualiza pruebas programables de CLASE, AYUDANTIA y LAB/TALLER
 * basándose en las horas registradas del dashboard
 */
router.post("/actualizar-calendario/:dashboardId", async (req, res) => {
  try {
    const { dashboardId } = req.params;
    const { pruebasCreadas, eliminadas } = await actualizarCalendarioPruebas(parseInt(dashboardId));
    const todasLasPruebas = await obtenerPruebasProgramables();
    res.json({
      ok: true,
      mensaje: `Se crearon/actualizaron ${pruebasCreadas.length} pruebas programables desde el horario`,
      pruebasCreadas,
      eliminadas,
      pruebas: todasLasPruebas,
    });
  } catch (err) {
    console.error("Error en actualizar-calendario:", err);
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * GET /api/sheets/debug-profesores
 * Diagnóstico: verificar profesores y su asignación a horas_programables
 */
router.get("/debug-profesores", async (req, res) => {
  try {
    const { pool } = await import("../db/pool.js");
    
    // Contar profesores
    const profResult = await pool.query(
      `SELECT id, rut, nombre FROM profesores ORDER BY id`
    );
    
    // Horas programables con sus profesores
    const hpResult = await pool.query(
      `SELECT hp.id, hp.codigo, hp.seccion, hp.tipo_hora, hp.titulo,
              hp.profesor_1_id, hp.profesor_2_id,
              p1.nombre as prof1_nombre, p1.rut as prof1_rut,
              p2.nombre as prof2_nombre, p2.rut as prof2_rut
       FROM horas_programables hp
       LEFT JOIN profesores p1 ON hp.profesor_1_id = p1.id
       LEFT JOIN profesores p2 ON hp.profesor_2_id = p2.id
       ORDER BY hp.codigo, hp.seccion, hp.tipo_hora`
    );
    
    // Resumen
    const sinProfesor = hpResult.rows.filter(r => !r.profesor_1_id && !r.profesor_2_id);
    const conProfesor = hpResult.rows.filter(r => r.profesor_1_id || r.profesor_2_id);
    
    res.json({
      ok: true,
      profesores: {
        total: profResult.rows.length,
        lista: profResult.rows
      },
      horasProgramables: {
        total: hpResult.rows.length,
        conProfesor: conProfesor.length,
        sinProfesor: sinProfesor.length,
        sinProfesorDetalle: sinProfesor.map(r => `${r.codigo} Sec${r.seccion} ${r.tipo_hora}`),
        detalle: hpResult.rows.map(r => ({
          id: r.id,
          curso: `${r.codigo} Sec${r.seccion} ${r.tipo_hora}`,
          titulo: r.titulo,
          prof1: r.profesor_1_id ? `${r.prof1_nombre} (id=${r.profesor_1_id}, rut=${r.prof1_rut})` : null,
          prof2: r.profesor_2_id ? `${r.prof2_nombre} (id=${r.profesor_2_id}, rut=${r.prof2_rut})` : null
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
