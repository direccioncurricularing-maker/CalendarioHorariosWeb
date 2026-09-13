import pool from "../db/pool.js";
import { callAppScript } from "./appscript.service.js";
import {
	procesarMaestrosYCrearHorarios,
	actualizarCalendarioPruebas,
	obtenerHorariosProgramables,
	obtenerPruebasProgramables,
} from "./maestros.service.js";
import { reevaluarConflictosDashboard } from "./conflict-detector.service.js";
import { reevaluarConflictosPruebasDashboard } from "./conflict-detector-pruebas.service.js";
import { BLOQUES, DIAS } from "../constants/horarios.js";
import { normalizarTexto, calcularHorariosDestino } from "../utils/horario-utils.js";

const DIAS_RESPALDO = DIAS;

const TIPO_POR_ALIAS = {
	CLAS: "CLASE",
	CLASE: "CLASE",
	AYUD: "AYUDANTIA",
	AYUDANTIA: "AYUDANTIA",
	LABTALLER: "LAB/TALLER",
	"LAB/TALLER": "LAB/TALLER",
	LAB: "LAB/TALLER",
	EXAM: "EXAMEN",
	EXAMEN: "EXAMEN",
	TARDE: "TARDE",
};

function normalizarClaveCurso(valor) {
	return normalizarTexto(valor).replace(/[^A-Z0-9]/g, "");
}

function normalizarHora(hora) {
	if (hora == null) return null;
	const texto = String(hora).trim();
	const m = texto.match(/^(\d{1,2}):(\d{2})$/);
	if (!m) return null;
	const horas = Number(m[1]);
	const minutos = Number(m[2]);
	if (Number.isNaN(horas) || Number.isNaN(minutos)) return null;
	if (horas < 0 || horas > 23 || minutos < 0 || minutos > 59) return null;
	return `${horas}:${String(minutos).padStart(2, "0")}`;
}

function horaAMinutos(hora) {
	const normalizada = normalizarHora(hora);
	if (!normalizada) return null;
	const [h, m] = normalizada.split(":").map(Number);
	return h * 60 + m;
}

function parsearRangoHorario(rango) {
	const texto = String(rango ?? "").trim();
	const m = texto.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
	if (!m) return null;
	const inicio = normalizarHora(m[1]);
	const fin = normalizarHora(m[2]);
	if (!inicio || !fin) return null;
	if ((horaAMinutos(fin) ?? -1) <= (horaAMinutos(inicio) ?? -1)) return null;
	return { inicio, fin };
}

function mapearTipo(aliasTipo) {
	const clave = normalizarTexto(aliasTipo).replace(/\s+/g, "");
	return TIPO_POR_ALIAS[clave] || null;
}

function parsearEntradasCelda(valor, { requiereHorario = false } = {}) {
	if (valor == null) return [];
	const texto = String(valor).trim();
	if (!texto) return [];

	const partes = texto
		.split(/,|\n|;/)
		.map((x) => x.trim())
		.filter(Boolean);

	const entradas = [];
	for (const parte of partes) {
		const m = parte.match(/^([A-Za-zÀ-ÿ/]+)\s*(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})?$/);
		if (!m) continue;

		const tipo = mapearTipo(m[1]);
		if (!tipo) continue;

		const rango = m[2] ? parsearRangoHorario(m[2]) : null;
		if (requiereHorario && !rango) continue;

		entradas.push({
			tipo,
			horaInicio: rango?.inicio ?? null,
			horaFin: rango?.fin ?? null,
		});
	}

	return entradas;
}

function expandirRangoABloques(horaInicio, horaFin) {
	const ini = horaAMinutos(horaInicio);
	const fin = horaAMinutos(horaFin);
	if (ini == null || fin == null || fin <= ini) return [];

	return BLOQUES.filter((b) => {
		const bIni = horaAMinutos(b.inicio);
		const bFin = horaAMinutos(b.fin);
		return bIni != null && bFin != null && bIni >= ini && bFin <= fin;
	});
}

function formatearFechaISO(date) {
	const yyyy = date.getFullYear();
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

function parsearFechaCabecera(cabecera) {
	const raw = String(cabecera ?? "").trim();
	if (!raw) return null;

	let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
	if (m) {
		const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
		return Number.isNaN(date.getTime()) ? null : formatearFechaISO(date);
	}

	m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
	if (m) {
		const date = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
		return Number.isNaN(date.getTime()) ? null : formatearFechaISO(date);
	}

	if (!/[/-]|GMT|UTC|T\d{2}:\d{2}/i.test(raw)) {
		return null;
	}

	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return null;
	return formatearFechaISO(date);
}

function obtenerCampoPorAlias(fila, aliases) {
	for (const alias of aliases) {
		if (Object.prototype.hasOwnProperty.call(fila, alias)) {
			return fila[alias];
		}
	}

	const aliasesNormalizados = aliases.map((a) => normalizarTexto(a));
	for (const [key, value] of Object.entries(fila)) {
		const keyNormalizado = normalizarTexto(key);
		if (aliasesNormalizados.includes(keyNormalizado)) {
			return value;
		}
	}

	return undefined;
}

function obtenerClaveCursoFila(fila) {
	const llave = obtenerCampoPorAlias(fila, [
		"LLAVE Código- sec ",
		"LLAVE CÓDIGO- SEC",
		"LLAVE CODIGO- SEC",
		"LLAVE",
	]);

	if (llave != null && String(llave).trim() !== "") {
		return normalizarClaveCurso(llave);
	}

	const codigo = obtenerCampoPorAlias(fila, ["CODIGO", "CÓDIGO"]);
	const seccion = obtenerCampoPorAlias(fila, ["SECCIONES", "SECCION", "SECCIÓN"]);
	if (codigo == null || seccion == null) return null;
	return normalizarClaveCurso(`${codigo}${seccion}`);
}

function obtenerHorarioPreferente(especialidadesSemestres) {
	const objetivos = calcularHorariosDestino(especialidadesSemestres);
	return objetivos[0] || "plan_comun";
}

function extraerEntradasHorasDesdeMaestro(maestrosData) {
	const raw = [];

	for (const fila of maestrosData) {
		const claveCurso = obtenerClaveCursoFila(fila);
		if (!claveCurso) continue;

		for (const dia of DIAS_RESPALDO) {
			const diaSinAcento = dia
				.normalize("NFD")
				.replace(/[\u0300-\u036f]/g, "");

			const valorDia = obtenerCampoPorAlias(fila, [dia, diaSinAcento, dia.toUpperCase(), diaSinAcento.toUpperCase()]);
			const entradas = parsearEntradasCelda(valorDia, { requiereHorario: true });

			for (const entrada of entradas) {
				raw.push({
					claveCurso,
					dia,
					tipo: entrada.tipo,
					horaInicio: entrada.horaInicio,
					horaFin: entrada.horaFin,
				});
			}
		}
	}

	return raw;
}

function extraerEntradasPruebasDesdeMaestro(maestrosData) {
	const raw = [];

	for (const fila of maestrosData) {
		const claveCurso = obtenerClaveCursoFila(fila);
		if (!claveCurso) continue;

		for (const [cabecera, valor] of Object.entries(fila)) {
			const fecha = parsearFechaCabecera(cabecera);
			if (!fecha) continue;

			const entradas = parsearEntradasCelda(valor, { requiereHorario: false });
			for (const entrada of entradas) {
				raw.push({
					claveCurso,
					fecha,
					tipo: entrada.tipo,
					horaInicio: entrada.horaInicio,
					horaFin: entrada.horaFin,
				});
			}
		}
	}

	return raw;
}

function construirIndiceHorasProgramables(horasProgramables) {
	const indice = new Map();

	for (const hp of horasProgramables) {
		const clave = normalizarClaveCurso(`${hp.codigo}${hp.seccion}`);
		const tipo = normalizarTexto(hp.tipo_hora);
		if (!indice.has(clave)) indice.set(clave, new Map());
		const porTipo = indice.get(clave);
		if (!porTipo.has(tipo)) porTipo.set(tipo, []);

		porTipo.get(tipo).push({
			...hp,
			horarioPreferente: obtenerHorarioPreferente(hp.especialidades_semestres),
			horariosObjetivo: calcularHorariosDestino(hp.especialidades_semestres),
		});
	}

	return indice;
}

function construirIndicePruebasProgramables(pruebasProgramables) {
	const indice = new Map();

	for (const pp of pruebasProgramables) {
		const clave = normalizarClaveCurso(`${pp.codigo}${pp.seccion}`);
		const tipo = normalizarTexto(pp.tipo_prueba);
		if (!indice.has(clave)) indice.set(clave, new Map());
		const porTipo = indice.get(clave);
		if (!porTipo.has(tipo)) porTipo.set(tipo, []);
		porTipo.get(tipo).push(pp);
	}

	return indice;
}

function mapearHorasARegistros(rawHoras, indiceHoras) {
	const registros = [];
	const advertencias = [];
	const seen = new Set();

	for (const entrada of rawHoras) {
		const porClave = indiceHoras.get(entrada.claveCurso);
		const candidatos = porClave?.get(normalizarTexto(entrada.tipo)) || [];
		if (candidatos.length === 0) {
			advertencias.push(`Hora ignorada: no existe horas_programables para ${entrada.claveCurso} (${entrada.tipo})`);
			continue;
		}

		const programable = candidatos[0];
		const bloques = expandirRangoABloques(entrada.horaInicio, entrada.horaFin);

		if (bloques.length === 0) {
			advertencias.push(
				`Hora ignorada: rango ${entrada.horaInicio}-${entrada.horaFin} no coincide con bloques válidos (${entrada.claveCurso}, ${entrada.tipo}, ${entrada.dia})`
			);
			continue;
		}

		for (const bloque of bloques) {
			for (const horario of programable.horariosObjetivo || [programable.horarioPreferente]) {
				const key = `${programable.id}|${entrada.dia}|${bloque.inicio}|${bloque.fin}|${horario}`;
				if (seen.has(key)) continue;
				seen.add(key);

				registros.push({
					horaProgramableId: programable.id,
					diaSemana: entrada.dia,
					horaInicio: bloque.inicio,
					horaFin: bloque.fin,
					horario,
				});
			}
		}
	}

	return { registros, advertencias };
}

function mapearPruebasARegistros(rawPruebas, indicePruebas) {
	const registros = [];
	const advertencias = [];
	const seen = new Set();

	for (const entrada of rawPruebas) {
		const porClave = indicePruebas.get(entrada.claveCurso);
		const candidatos = porClave?.get(normalizarTexto(entrada.tipo)) || [];
		if (candidatos.length === 0) {
			advertencias.push(`Prueba ignorada: no existe pruebas_programables para ${entrada.claveCurso} (${entrada.tipo})`);
			continue;
		}

		const programable = candidatos[0];
		const key = `${programable.id}|${entrada.fecha}|${entrada.horaInicio || ""}|${entrada.horaFin || ""}`;
		if (seen.has(key)) continue;
		seen.add(key);

		registros.push({
			pruebaProgramableId: programable.id,
			fecha: entrada.fecha,
			horaInicio: entrada.horaInicio,
			horaFin: entrada.horaFin,
		});
	}

	return { registros, advertencias };
}

async function insertarHorasRegistros(dashboardId, registrosHoras) {
	let insertadas = 0;
	for (const reg of registrosHoras) {
		await pool.query(
			`INSERT INTO horas_registradas (hora_programable_id, dashboard_id, dia_semana, hora_inicio, hora_fin, horario)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			[reg.horaProgramableId, dashboardId, reg.diaSemana, reg.horaInicio, reg.horaFin, reg.horario]
		);
		insertadas += 1;
	}
	return insertadas;
}

async function insertarPruebasRegistros(dashboardId, registrosPruebas) {
	let insertadas = 0;
	for (const reg of registrosPruebas) {
		await pool.query(
			`INSERT INTO pruebas_registradas (prueba_programable_id, dashboard_id, fecha, hora_inicio, hora_fin)
			 VALUES ($1, $2, $3, $4, $5)`,
			[reg.pruebaProgramableId, dashboardId, reg.fecha, reg.horaInicio, reg.horaFin]
		);
		insertadas += 1;
	}
	return insertadas;
}

async function obtenerMaestrosDesdeAppScript() {
	const resultString = await callAppScript("maestro.listar");

	let maestrosData;
	try {
		maestrosData = JSON.parse(resultString);
	} catch (error) {
		throw new Error(`No se pudo parsear la respuesta de maestro.listar: ${error.message}`);
	}

	if (!Array.isArray(maestrosData)) {
		throw new Error("La respuesta de maestro.listar no es un array");
	}

	return maestrosData;
}

export async function usarRespaldoDesdeHoja(dashboardId) {
	const id = Number(dashboardId);
	if (!Number.isInteger(id) || id <= 0) {
		throw new Error("dashboardId inválido");
	}

	// 1) Leer MAESTRO desde App Script
	const maestrosData = await obtenerMaestrosDesdeAppScript();

	// 2) Extraer respaldo bruto desde la hoja (antes de mutar BD)
	const rawHoras = extraerEntradasHorasDesdeMaestro(maestrosData);
	const rawPruebas = extraerEntradasPruebasDesdeMaestro(maestrosData);

	// 3) Cargar maestros como flujo actual (actualiza/crea programables)
	const horariosCreados = await procesarMaestrosYCrearHorarios(maestrosData);

	// 4) Preparar mapeo para horas
	const horasProgramablesResult = await pool.query(
		`SELECT id, codigo, seccion, tipo_hora, especialidades_semestres
		 FROM horas_programables`
	);
	const indiceHoras = construirIndiceHorasProgramables(horasProgramablesResult.rows);
	const { registros: registrosHoras, advertencias: advertenciasHoras } = mapearHorasARegistros(rawHoras, indiceHoras);

	// 5) Limpiar datos del dashboard y restaurar horas
	await pool.query(`DELETE FROM pruebas_registradas WHERE dashboard_id = $1`, [id]);
	await pool.query(`DELETE FROM horas_registradas WHERE dashboard_id = $1`, [id]);

	const horasRestauradas = await insertarHorasRegistros(id, registrosHoras);

	// 6) Recalcular conflictos de horas y actualizar calendario de pruebas
	const conflictosHoras = await reevaluarConflictosDashboard(id);
	const resultadoCalendario = await actualizarCalendarioPruebas(id);

	// 7) Preparar mapeo para pruebas (después de actualizar calendario)
	const pruebasProgramablesResult = await pool.query(
		`SELECT id, codigo, seccion, tipo_prueba
		 FROM pruebas_programables`
	);
	const indicePruebas = construirIndicePruebasProgramables(pruebasProgramablesResult.rows);
	const { registros: registrosPruebas, advertencias: advertenciasPruebas } = mapearPruebasARegistros(
		rawPruebas,
		indicePruebas
	);

	// 8) Restaurar pruebas y recalcular conflictos de pruebas
	const pruebasRestauradas = await insertarPruebasRegistros(id, registrosPruebas);
	const conflictosPruebas = await reevaluarConflictosPruebasDashboard(id);

	const horarios = await obtenerHorariosProgramables();
	const pruebas = await obtenerPruebasProgramables();

	return {
		maestrosProcesados: maestrosData.length,
		horariosProgramablesProcesados: horariosCreados.creados ?? 0,
		horasRestauradas,
		pruebasRestauradas,
		pruebasCalendarioCreadas: resultadoCalendario?.pruebasCreadas?.length || 0,
		pruebasCalendarioEliminadas: resultadoCalendario?.eliminadas?.length || 0,
		conflictosHoras: conflictosHoras?.horasConConflictos || 0,
		conflictosPruebas: conflictosPruebas?.pruebasConConflictos || 0,
		advertencias: [...advertenciasHoras, ...advertenciasPruebas],
		horarios,
		pruebas,
	};
}
