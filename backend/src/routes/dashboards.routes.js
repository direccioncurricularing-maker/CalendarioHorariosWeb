import express from 'express';
import  pool  from '../db/pool.js';
import { obtenerPeriodoActual } from '../utils/periodo-utils.js';

const router = express.Router();

// Obtener dashboards de un usuario
router.get('/', async (req, res) => {
  try {
    const { usuario_id } = req.query;

    if (!usuario_id) {
      return res.status(400).json({ error: 'usuario_id es requerido' });
    }

    const result = await pool.query(
      'SELECT id, nombre, usuario_id, fecha_inicio, fecha_fin, periodo, feriados, created_at, updated_at FROM dashboards WHERE usuario_id = $1 ORDER BY created_at DESC',
      [usuario_id]
    );

    const periodoActual = obtenerPeriodoActual();
    res.json(result.rows.map(d => ({
      ...d,
      periodo_actual: d.periodo === periodoActual,
    })));
  } catch (error) {
    console.error('Error obteniendo dashboards:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Obtener un dashboard por ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'SELECT id, nombre, usuario_id, fecha_inicio, fecha_fin, periodo, feriados, created_at, updated_at FROM dashboards WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dashboard no encontrado' });
    }

    const dashboard = result.rows[0];
    res.json({
      ...dashboard,
      periodo_actual: dashboard.periodo === obtenerPeriodoActual(),
    });
  } catch (error) {
    console.error('Error obteniendo dashboard:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Crear dashboard
router.post('/', async (req, res) => {
  try {
    const { nombre, usuario_id, fecha_inicio, fecha_fin } = req.body;

    if (!nombre || !usuario_id) {
      return res.status(400).json({ error: 'Nombre y usuario_id son requeridos' });
    }

    // Verificar que el usuario existe
    const userCheck = await pool.query(
      'SELECT id FROM usuarios WHERE id = $1',
      [usuario_id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const result = await pool.query(
      `INSERT INTO dashboards (nombre, usuario_id, fecha_inicio, fecha_fin, periodo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, usuario_id, fecha_inicio, fecha_fin, periodo, feriados, created_at, updated_at`,
      [nombre, usuario_id, fecha_inicio || null, fecha_fin || null, obtenerPeriodoActual()]
    );

    res.status(201).json({ ...result.rows[0], periodo_actual: true });
  } catch (error) {
    console.error('Error creando dashboard:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Actualizar dashboard
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, fecha_inicio, fecha_fin } = req.body;

    if (!nombre && !fecha_inicio && !fecha_fin) {
      return res.status(400).json({ error: 'Debe enviar al menos un campo para actualizar' });
    }

    const campos = [];
    const valores = [];
    let index = 1;

    if (nombre) {
      campos.push(`nombre = $${index}`);
      valores.push(nombre);
      index++;
    }
    if (fecha_inicio !== undefined) {
      campos.push(`fecha_inicio = $${index}`);
      valores.push(fecha_inicio || null);
      index++;
    }
    if (fecha_fin !== undefined) {
      campos.push(`fecha_fin = $${index}`);
      valores.push(fecha_fin || null);
      index++;
    }

    valores.push(id);

    const result = await pool.query(
      `UPDATE dashboards SET ${campos.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${index} RETURNING id, nombre, usuario_id, fecha_inicio, fecha_fin, feriados, created_at, updated_at`,
      valores
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dashboard no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error actualizando dashboard:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Eliminar dashboard
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM dashboards WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dashboard no encontrado' });
    }

    res.json({ message: 'Dashboard eliminado exitosamente', id });
  } catch (error) {
    console.error('Error eliminando dashboard:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Toggle feriado en un dashboard (agregar o quitar una fecha de la lista)
router.patch('/:id/feriados', async (req, res) => {
  try {
    const { id } = req.params;
    const { fecha } = req.body; // formato YYYY-MM-DD

    if (!fecha) {
      return res.status(400).json({ error: 'fecha es requerida (formato YYYY-MM-DD)' });
    }

    // Obtener feriados actuales
    const current = await pool.query(
      'SELECT feriados FROM dashboards WHERE id = $1',
      [id]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Dashboard no encontrado' });
    }

    let feriados = current.rows[0].feriados || [];
    if (typeof feriados === 'string') {
      try { feriados = JSON.parse(feriados); } catch { feriados = []; }
    }

    // Toggle: si ya existe, quitar; si no, agregar
    const index = feriados.indexOf(fecha);
    if (index >= 0) {
      feriados.splice(index, 1);
    } else {
      feriados.push(fecha);
    }

    const result = await pool.query(
      `UPDATE dashboards SET feriados = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2
       RETURNING id, nombre, usuario_id, fecha_inicio, fecha_fin, feriados, created_at, updated_at`,
      [JSON.stringify(feriados), id]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error toggling feriado:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
