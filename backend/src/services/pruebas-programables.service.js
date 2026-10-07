import pool from "../db/pool.js";

export async function crearPruebaProgramable(
  codigo, seccion, tipoPrueba, especialidades,
  profesor1Id, profesor2Id, titulo, bloquesHorario,
  tieneExamen, cantidadEvaluaciones, salaEspecial, periodo
) {
  if (tipoPrueba === 'EXAMEN' && !tieneExamen) {
    return null;
  }

  const result = await pool.query(
    `INSERT INTO pruebas_programables
     (codigo, seccion, tipo_prueba, especialidades_semestres,
      profesor_1_id, profesor_2_id, titulo, bloques_horario,
      tiene_examen, cantidad_evaluaciones, sala_especial, periodo, vigente)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE)
     ON CONFLICT (periodo, codigo, seccion, tipo_prueba)
     DO UPDATE SET
       especialidades_semestres = EXCLUDED.especialidades_semestres,
       profesor_1_id = EXCLUDED.profesor_1_id,
       profesor_2_id = EXCLUDED.profesor_2_id,
       titulo = EXCLUDED.titulo,
       bloques_horario = EXCLUDED.bloques_horario,
       tiene_examen = EXCLUDED.tiene_examen,
       cantidad_evaluaciones = EXCLUDED.cantidad_evaluaciones,
       sala_especial = EXCLUDED.sala_especial,
       vigente = TRUE,
       updated_at = NOW()
     RETURNING *`,
    [
      codigo, seccion, tipoPrueba,
      JSON.stringify(especialidades),
      profesor1Id, profesor2Id,
      titulo || `${codigo} - ${tipoPrueba}`,
      JSON.stringify(bloquesHorario || []),
      tieneExamen, cantidadEvaluaciones, salaEspecial,
      periodo,
    ]
  );

  return result.rows[0];
}

export async function obtenerPruebasProgramables(periodo = null) {
  if (periodo) {
    const result = await pool.query(
      `SELECT * FROM pruebas_programables
       WHERE periodo = $1 AND vigente = TRUE
       ORDER BY codigo, seccion, tipo_prueba`,
      [periodo]
    );
    return result.rows;
  }

  const result = await pool.query(
    `SELECT * FROM pruebas_programables
     WHERE vigente = TRUE
     ORDER BY codigo, seccion, tipo_prueba`
  );
  return result.rows;
}

export async function obtenerPruebasPorDashboard(dashboardId) {
  const result = await pool.query(
    `SELECT pp.*
     FROM pruebas_programables pp
     JOIN pruebas_registradas pr ON pr.prueba_programable_id = pp.id
     WHERE pr.dashboard_id = $1
     GROUP BY pp.id
     ORDER BY pp.codigo, pp.seccion, pp.tipo_prueba`,
    [dashboardId]
  );
  return result.rows;
}

export async function limpiarPruebasProgramables(periodo = null) {
  if (periodo) {
    await pool.query(`DELETE FROM pruebas_programables WHERE periodo = $1`, [periodo]);
    return;
  }
  await pool.query(`DELETE FROM pruebas_programables`);
}

function normalizarTiempo(timeStr) {
  if (!timeStr) return '';
  const partes = String(timeStr).split(':');
  if (partes.length < 2) return String(timeStr).padStart(5, '0');
  const hh = partes[0].padStart(2, '0');
  const mm = partes[1].padStart(2, '0');
  return `${hh}:${mm}`;
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = String(timeStr).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export async function actualizarCalendarioPruebas(dashboardId) {
  try {
    const dashResult = await pool.query(
      `SELECT periodo FROM dashboards WHERE id = $1`,
      [dashboardId]
    );
    const periodo = dashResult.rows[0]?.periodo;
    if (!periodo) {
      throw new Error('Dashboard no encontrado');
    }

    const horasResult = await pool.query(
      `SELECT hr.*, hp.codigo, hp.seccion, hp.titulo, hp.tipo_hora,
              hp.especialidades_semestres, hp.profesor_1_id, hp.profesor_2_id
       FROM horas_registradas hr
       JOIN horas_programables hp ON hr.hora_programable_id = hp.id
       WHERE hr.dashboard_id = $1
       ORDER BY hp.codigo, hp.seccion, hp.tipo_hora, hr.dia_semana, hr.hora_inicio`,
      [dashboardId]
    );

    const horas = horasResult.rows;

    const grupos = {};
    for (const hora of horas) {
      const clave = `${hora.codigo}|${hora.seccion}|${hora.tipo_hora}`;
      if (!grupos[clave]) {
        grupos[clave] = {
          codigo: hora.codigo,
          seccion: hora.seccion,
          tipo_hora: hora.tipo_hora,
          titulo: hora.titulo,
          especialidades_semestres: hora.especialidades_semestres,
          profesor_1_id: hora.profesor_1_id,
          profesor_2_id: hora.profesor_2_id,
          horas: []
        };
      }
      grupos[clave].horas.push(hora);
    }

    const DESCANSO_MAXIMO = 15;
    const pruebasCreadas = [];

    for (const clave in grupos) {
      const grupo = grupos[clave];

      const horasPorDia = {};
      for (const hora of grupo.horas) {
        const dia = hora.dia_semana;
        if (!horasPorDia[dia]) horasPorDia[dia] = [];
        horasPorDia[dia].push({
          inicio: normalizarTiempo(hora.hora_inicio.substring(0, 5)),
          fin: normalizarTiempo(hora.hora_fin.substring(0, 5))
        });
      }

      const bloques = [];
      for (const dia in horasPorDia) {
        const horasOrdenadas = horasPorDia[dia].sort(
          (a, b) => timeToMinutes(a.inicio) - timeToMinutes(b.inicio)
        );

        if (!horasOrdenadas.length) continue;

        let bloqueActual = { ...horasOrdenadas[0] };

        for (let i = 1; i < horasOrdenadas.length; i++) {
          const proximaHora = horasOrdenadas[i];
          const finActual = timeToMinutes(bloqueActual.fin);
          const inicioProxima = timeToMinutes(proximaHora.inicio);
          const descanso = inicioProxima - finActual;

          if (descanso >= 0 && descanso <= DESCANSO_MAXIMO) {
            bloqueActual.fin = proximaHora.fin;
          } else {
            bloques.push({ dia, inicio: bloqueActual.inicio, fin: bloqueActual.fin });
            bloqueActual = { ...proximaHora };
          }
        }
        bloques.push({ dia, inicio: bloqueActual.inicio, fin: bloqueActual.fin });
      }

      let especialidades = grupo.especialidades_semestres;
      if (typeof especialidades === 'string') {
        try { especialidades = JSON.parse(especialidades); } catch { especialidades = {}; }
      }

      const metaResult = await pool.query(
        `SELECT
           MAX(tiene_examen::int)::boolean as tiene_examen,
           MAX(cantidad_evaluaciones) as cantidad_evaluaciones,
           MAX(CASE WHEN tipo_prueba = 'TARDE' THEN sala_especial END) as sala_pruebas,
           MAX(CASE WHEN tipo_prueba = 'EXAMEN' THEN sala_especial END) as sala_examen
         FROM pruebas_programables
         WHERE codigo = $1 AND seccion = $2 AND tipo_prueba IN ('EXAMEN', 'TARDE')
           AND periodo = $3`,
        [grupo.codigo, grupo.seccion, periodo]
      );
      const tieneExamen = metaResult.rows[0]?.tiene_examen ?? true;
      const cantidadEvaluaciones = metaResult.rows[0]?.cantidad_evaluaciones ?? null;
      const salaEspecialPruebas = metaResult.rows[0]?.sala_pruebas || metaResult.rows[0]?.sala_examen || null;

      if (!cantidadEvaluaciones || cantidadEvaluaciones < 1) {
        continue;
      }

      const prueba = await crearPruebaProgramable(
        grupo.codigo,
        grupo.seccion,
        grupo.tipo_hora,
        especialidades,
        grupo.profesor_1_id,
        grupo.profesor_2_id,
        grupo.titulo,
        bloques,
        tieneExamen,
        cantidadEvaluaciones,
        salaEspecialPruebas,
        periodo
      );

      pruebasCreadas.push(prueba);
    }

    const codigosSeccionesActivos = new Set(Object.keys(grupos));

    const todasPruebasCalendario = await pool.query(
      `SELECT pp.id, pp.codigo, pp.seccion, pp.tipo_prueba
       FROM pruebas_programables pp
       WHERE pp.tipo_prueba IN ('CLASE', 'AYUDANTIA', 'LAB/TALLER')
         AND pp.periodo = $1`,
      [periodo]
    );

    for (const pp of todasPruebasCalendario.rows) {
      const clave = `${pp.codigo}|${pp.seccion}|${pp.tipo_prueba}`;
      if (!codigosSeccionesActivos.has(clave)) {
        await pool.query(
          'DELETE FROM pruebas_registradas WHERE prueba_programable_id = $1 AND dashboard_id = $2',
          [pp.id, dashboardId]
        );
        const remaining = await pool.query(
          'SELECT COUNT(*) as cnt FROM pruebas_registradas WHERE prueba_programable_id = $1',
          [pp.id]
        );
        if (parseInt(remaining.rows[0].cnt, 10) === 0) {
          await pool.query('DELETE FROM pruebas_programables WHERE id = $1', [pp.id]);
        }
      }
    }

    const prResult = await pool.query(
      `SELECT pr.id, pr.hora_inicio, pr.hora_fin, pr.fecha,
              pp.codigo, pp.seccion, pp.tipo_prueba, pp.titulo, pp.bloques_horario
       FROM pruebas_registradas pr
       JOIN pruebas_programables pp ON pr.prueba_programable_id = pp.id
       WHERE pr.dashboard_id = $1
         AND pp.tipo_prueba IN ('CLASE', 'AYUDANTIA', 'LAB/TALLER')`,
      [dashboardId]
    );

    const eliminadas = [];
    for (const pr of prResult.rows) {
      if (!pr.hora_inicio || !pr.hora_fin) continue;

      let bloques = pr.bloques_horario;
      if (typeof bloques === 'string') {
        try { bloques = JSON.parse(bloques); } catch { bloques = []; }
      }
      if (!Array.isArray(bloques)) bloques = [];

      const hiNorm = normalizarTiempo(pr.hora_inicio.substring(0, 5));
      const hfNorm = normalizarTiempo(pr.hora_fin.substring(0, 5));

      const bloqueExiste = bloques.some(b =>
        normalizarTiempo(b.inicio) === hiNorm &&
        normalizarTiempo(b.fin) === hfNorm
      );

      if (!bloqueExiste) {
        await pool.query('DELETE FROM pruebas_registradas WHERE id = $1', [pr.id]);
        eliminadas.push({
          id: pr.id,
          codigo: pr.codigo,
          seccion: pr.seccion,
          tipo_prueba: pr.tipo_prueba,
          titulo: pr.titulo,
          fecha: pr.fecha,
          hora_inicio: hiNorm,
          hora_fin: hfNorm
        });
      }
    }

    return { pruebasCreadas, eliminadas };
  } catch (error) {
    throw new Error(`Error actualizando calendario de pruebas: ${error.message}`);
  }
}
