import pool from "../db/pool.js";

export async function crearHorarioProgramable(
  codigo, seccion, tipoHora, cantidadHoras,
  especialidades, profesor1Id, profesor2Id, titulo,
  disponibilidad, salaEspecial, distribucionHorario, periodo
) {
  const result = await pool.query(
    `INSERT INTO horas_programables
     (codigo, seccion, tipo_hora, cantidad_horas, especialidades_semestres,
      profesor_1_id, profesor_2_id, titulo, disponibilidad, sala_especial,
      distribucion_horario, periodo, vigente)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE)
     ON CONFLICT (periodo, codigo, seccion, tipo_hora)
     DO UPDATE SET
       cantidad_horas = EXCLUDED.cantidad_horas,
       especialidades_semestres = EXCLUDED.especialidades_semestres,
       profesor_1_id = EXCLUDED.profesor_1_id,
       profesor_2_id = EXCLUDED.profesor_2_id,
       titulo = EXCLUDED.titulo,
       disponibilidad = EXCLUDED.disponibilidad,
       sala_especial = EXCLUDED.sala_especial,
       distribucion_horario = EXCLUDED.distribucion_horario,
       vigente = TRUE
     RETURNING id`,
    [
      codigo, seccion, tipoHora, cantidadHoras,
      JSON.stringify(especialidades),
      profesor1Id, profesor2Id, titulo || `${codigo} ${tipoHora}`,
      JSON.stringify(disponibilidad),
      salaEspecial || null,
      distribucionHorario ? JSON.stringify(distribucionHorario) : null,
      periodo,
    ]
  );

  return result.rows[0];
}

export async function obtenerHorariosProgramables(periodo = null) {
  if (periodo) {
    const result = await pool.query(
      `SELECT * FROM horas_programables
       WHERE periodo = $1 AND vigente = TRUE
       ORDER BY codigo, seccion, tipo_hora`,
      [periodo]
    );
    return result.rows;
  }

  const result = await pool.query(
    `SELECT * FROM horas_programables
     WHERE vigente = TRUE
     ORDER BY codigo, seccion, tipo_hora`
  );
  return result.rows;
}

export async function obtenerHorariosPorDashboard(dashboardId) {
  const result = await pool.query(
    `SELECT hp.*
     FROM horas_programables hp
     JOIN horas_registradas hr ON hr.hora_programable_id = hp.id
     WHERE hr.dashboard_id = $1
     GROUP BY hp.id
     ORDER BY hp.codigo, hp.seccion, hp.tipo_hora`,
    [dashboardId]
  );
  return result.rows;
}

export async function limpiarHorariosProgramables(periodo = null) {
  if (periodo) {
    await pool.query(`DELETE FROM horas_programables WHERE periodo = $1`, [periodo]);
    return;
  }
  await pool.query(`DELETE FROM horas_programables`);
}
