import { obtenerOCrearProfesor } from "./profesores.service.js";
import pool from "../db/pool.js";
import {
  esMandante, buscarColumna,
  limpiarSala, extraerEspecialidades, extraerDisponibilidad
} from "./maestros-parser.service.js";
import { crearHorarioProgramable } from "./horas-programables.service.js";
import { crearPruebaProgramable } from "./pruebas-programables.service.js";

export {
  obtenerHorariosProgramables,
  obtenerHorariosPorDashboard,
  limpiarHorariosProgramables,
} from "./horas-programables.service.js";

export {
  obtenerPruebasProgramables,
  obtenerPruebasPorDashboard,
  limpiarPruebasProgramables,
  actualizarCalendarioPruebas,
} from "./pruebas-programables.service.js";

const TIPOS_HORA = ["CLASE", "AYUDANTIA", "LAB/TALLER"];

// Nombres de columna aceptados para la cantidad de horas a programar por tipo
const ALIAS_CANTIDAD = {
  "CLASE": ["CLASES A PROGRAMAR", "CANTIDAD_CLASE", "CANT_CLASE", "CLASES", "CLASE"],
  "AYUDANTIA": ["AYUDANTIAS PROGRAMAR", "CANTIDAD_AYUDANTIA", "CANT_AYUDANTIA", "AYUDANTIAS", "AYUDANTIA"],
  "LAB/TALLER": ["LABORATORIOS O TALLERES PROGRAMAR", "CANTIDAD_LAB/TALLER", "CANT_LAB/TALLER", "LABORATORIOS O TALLERES", "LAB/TALLER"],
};

// Nombre de columna de distribución horaria (formato "2+1" o "3")
const ALIAS_DISTRIBUCION = [
  "2+1 O 3? (DISTRIBUCION HORARIO DE CLASES)",
  "DISTRIBUCION",
  "DIST",
];

const BLOQUES_EXAMEN = [
  { inicio: "8:30", fin: "10:20" },
  { inicio: "9:30", fin: "11:20" },
  { inicio: "10:30", fin: "12:20" },
  { inicio: "11:30", fin: "13:20" },
  { inicio: "12:30", fin: "14:20" },
  { inicio: "13:30", fin: "15:20" },
  { inicio: "14:30", fin: "16:20" },
  { inicio: "15:30", fin: "17:20" },
  { inicio: "16:30", fin: "18:20" },
  { inicio: "17:30", fin: "19:20" }
];

const BLOQUES_TARDE = [
  { inicio: "19:30", fin: "21:20" }
];

export async function procesarMaestrosYCrearHorarios(maestrosData, periodo) {
  console.log(`[Maestros] Procesando ${maestrosData.length} cursos para el período "${periodo}"...`);
  const contador = { creados: 0, actualizados: 0, errores: 0, omitidos: 0, desactivados: 0 };

  const activosHoras = new Set();
  const activosPruebas = new Set();

  const previosHoras = (await pool.query(
    `SELECT codigo, seccion, tipo_hora FROM horas_programables
     WHERE periodo = $1 AND vigente = TRUE`,
    [periodo]
  )).rows;

  const previasPruebas = (await pool.query(
    `SELECT codigo, seccion, tipo_prueba FROM pruebas_programables
     WHERE periodo = $1 AND vigente = TRUE AND tipo_prueba IN ('EXAMEN', 'TARDE')`,
    [periodo]
  )).rows;

  // Lo que no venga en esta carga se conserva (por las horas ya registradas)
  // pero se oculta de los sidebars marcándolo como no vigente.
  await pool.query(
    `UPDATE horas_programables SET vigente = FALSE WHERE periodo = $1`,
    [periodo]
  );
  await pool.query(
    `UPDATE pruebas_programables SET vigente = FALSE
     WHERE periodo = $1 AND tipo_prueba IN ('EXAMEN', 'TARDE')`,
    [periodo]
  );

  for (const curso of maestrosData) {
    try {
      if (!esMandante(buscarColumna(curso, "MANDANTE", "MANDA"))) {
        contador.omitidos++;
        continue;
      }

      const codigo = String(buscarColumna(curso, "CODIGO", "COD", "CÓDIGO", "CÓD") || '').trim();
      const seccion = String(buscarColumna(curso, "SECCION", "SEC", "SECCIÓN") || '').trim();
      const titulo = String(buscarColumna(curso, "TITULO", "TÍTULO", "NOMBRE", "ASIGNATURA", "MATERIA") || '').trim();

      if (!codigo || !seccion) {
        console.warn(`[Maestros] Curso sin código o sección: codigo="${codigo}" seccion="${seccion}"`);
        contador.errores++;
        continue;
      }

      const rutProf1 = String(buscarColumna(curso, "RUT PROFESOR 1", "RUT_PROFESOR_1", "RUT_PROF_1", "RUT 1", "RUT1") || '').trim();
      const nombreProf1 = String(buscarColumna(curso, "NOMBRE PROFESOR BANNER 1", "NOMBRE PROFESOR 1", "NOMBRE_PROFESOR_1", "NOMBRE_PROF_1", "NOMBRE 1", "NOMBRE1") || '').trim();
      const rutProf2 = String(buscarColumna(curso, "RUT PROFESOR 2", "RUT_PROFESOR_2", "RUT_PROF_2", "RUT 2", "RUT2") || '').trim();
      const nombreProf2 = String(buscarColumna(curso, "NOMBRE PROFESOR 2", "NOMBRE_PROFESOR_2", "NOMBRE_PROF_2", "NOMBRE 2", "NOMBRE2") || '').trim();

      const ctx = `${codigo}-${seccion}`;
      const prof1 = await obtenerOCrearProfesor(rutProf1 || null, nombreProf1 || null, `prof1 ${ctx}`);
      const prof2 = await obtenerOCrearProfesor(rutProf2 || null, nombreProf2 || null, `prof2 ${ctx}`);

      const especialidades = extraerEspecialidades(curso);
      const disponibilidad = extraerDisponibilidad(curso);

      let salaEspecial = null;
      if (buscarColumna(curso, "SALA", "SALA ESPECIAL", "SALA_ESPECIAL") != null) {
        salaEspecial = limpiarSala(buscarColumna(curso, "SALA", "SALA ESPECIAL", "SALA_ESPECIAL"));
      }

      for (const tipoHora of TIPOS_HORA) {
        const cantidadHorasCol = buscarColumna(curso, ...ALIAS_CANTIDAD[tipoHora]);
        const cantidadHorasTexto = cantidadHorasCol != null ? String(cantidadHorasCol).trim() : '';
        const cantidadHoras = cantidadHorasTexto !== '' ? (parseInt(cantidadHorasTexto, 10) || 0) : 0;

        if (!cantidadHoras || cantidadHoras <= 0) {
          continue;
        }

        const distribucionStr = buscarColumna(
          curso,
          `DISTRIBUCION_${tipoHora}`,
          `DIST_${tipoHora}`,
          ...ALIAS_DISTRIBUCION
        );
        const distribucionHorario = distribucionStr ? String(distribucionStr).trim() : null;

        await crearHorarioProgramable(
          codigo, seccion, tipoHora, cantidadHoras,
          especialidades, prof1?.id || null, prof2?.id || null, titulo,
          disponibilidad, salaEspecial, distribucionHorario, periodo
        );

        activosHoras.add(`${codigo}|${seccion}|${tipoHora}`);
        contador.creados++;
      }

      const tieneExamenCol = buscarColumna(curso, "TIENE_EXAMEN", "EXAMEN (SI O NO)", "EXAMEN");
      const tieneExamen = tieneExamenCol != null && esMandante(tieneExamenCol);

      const cantEvalStr = buscarColumna(
        curso,
        "CANTIDAD_EVALUACIONES",
        "CANTIDAD EVALUACIONES (SEMESTRALES)",
        "CANT_EVAL",
        "EVALUACIONES"
      );
      const cantEvalTexto = cantEvalStr != null ? String(cantEvalStr).trim() : '';
      const cantidadEvaluaciones = cantEvalTexto !== '' ? (parseInt(cantEvalTexto, 10) || 0) : 0;

      if (tieneExamen) {
        const pruebaExamen = await crearPruebaProgramable(
          codigo, seccion, "EXAMEN",
          especialidades, prof1?.id || null, prof2?.id || null,
          titulo, BLOQUES_EXAMEN, tieneExamen, cantidadEvaluaciones, null, periodo
        );
        if (pruebaExamen) activosPruebas.add(`${codigo}|${seccion}|EXAMEN`);
      }

      const pruebaTarde = await crearPruebaProgramable(
        codigo, seccion, "TARDE",
        especialidades, prof1?.id || null, prof2?.id || null,
        titulo, BLOQUES_TARDE, false, 0, null, periodo
      );
      if (pruebaTarde) activosPruebas.add(`${codigo}|${seccion}|TARDE`);

    } catch (error) {
      console.error(`[Maestros] Error procesando curso:`, error);
      contador.errores++;
    }
  }

  const desactivadosHoras = previosHoras.filter(
    p => !activosHoras.has(`${p.codigo}|${p.seccion}|${p.tipo_hora}`)
  );
  const desactivadasPruebas = previasPruebas.filter(
    p => !activosPruebas.has(`${p.codigo}|${p.seccion}|${p.tipo_prueba}`)
  );

  contador.desactivados = desactivadosHoras.length + desactivadasPruebas.length;
  contador.detalleDesactivados = [
    ...desactivadosHoras.map(p => `${p.codigo}-${p.seccion} ${p.tipo_hora}`),
    ...desactivadasPruebas.map(p => `${p.codigo}-${p.seccion} ${p.tipo_prueba}`),
  ];

  console.log(`[Maestros] Procesamiento completado. ${JSON.stringify(contador)}`);
  return contador;
}
