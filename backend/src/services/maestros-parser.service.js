const ESPECIALIDADES_VALIDAS = ["PLAN COMUN", "PLAN_COMUN", "ICA", "ICQ", "ICI", "IOC", "ICE", "ICC"];

export function normalizarTexto(valor) {
  return String(valor ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

export function esMandante(v) {
  const s = normalizarTexto(v ?? '');
  return s === 'SI';
}

export function buscarColumna(curso, ...patrones) {
  for (const patron of patrones) {
    if (curso[patron] !== undefined) {
      return curso[patron];
    }
  }

  const normalizarClave = (valor) =>
    normalizarTexto(valor).replace(/[\s\n_]+/g, '');

  // Coincidencia normalizada exacta: ignora mayúsculas, tildes, espacios y
  // guiones bajos (ej. "CLASES A PROGRAMAR" encuentra "Clases A PROGRAMAR").
  for (const patron of patrones) {
    const patronNorm = normalizarClave(patron);
    for (const key of Object.keys(curso)) {
      if (normalizarClave(key) === patronNorm) {
        return curso[key];
      }
    }
  }

  // Coincidencia parcial con el primer patrón (compatibilidad)
  const patronNorm = normalizarClave(patrones[0]);
  for (const key of Object.keys(curso)) {
    const keyNorm = normalizarClave(key);
    if (keyNorm.includes(patronNorm) || patronNorm.includes(keyNorm)) {
      return curso[key];
    }
  }

  return undefined;
}

export function primerValorNoVacio(...valores) {
  for (const v of valores) {
    if (v != null && v !== '') return v;
  }
  return null;
}

export function limpiarSala(v) {
  if (v == null || String(v).trim() === '') return null;
  return String(v).trim();
}

export function limpiarNumeroSemestre(semestre) {
  if (semestre == null) return null;
  if (typeof semestre === 'number') return Math.floor(semestre);
  const num = parseInt(String(semestre).replace(/[^0-9]/g, ''), 10);
  return isNaN(num) ? null : num;
}

export function extraerEspecialidades(curso) {
  const especialidades = {};

  for (const key of Object.keys(curso)) {
    const keyNorm = normalizarTexto(key).replace(/[\s\n]+/g, '');
    let especialidad = null;

    for (const valida of ESPECIALIDADES_VALIDAS) {
      const vNorm = valida.replace(/[\s\n]+/g, '');
      if (keyNorm.includes(vNorm) || vNorm.includes(keyNorm)) {
        especialidad = valida;
        break;
      }
    }

    if (especialidad) {
      const valor = curso[key];
      if (valor != null && String(valor).trim() !== '') {
        const semestre = limpiarNumeroSemestre(valor);
        if (semestre !== null && semestre !== 0) {
          especialidades[especialidad] = semestre;
        }
      }
    }
  }

  return especialidades;
}

export function extraerDisponibilidad(curso) {
  const disponibilidad = {};

  const diasColumnas = ['LUNES', 'MARTES', 'MIÉRCOLES', 'MIERCOLES', 'JUEVES', 'VIERNES'];
  const diaNombres = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];

  for (let i = 0; i < diasColumnas.length; i++) {
    const idx = i >= 4 ? i - 1 : i;
    const colKey = `BLOQUES_DIA_${idx + 1}`;
    const valor = buscarColumna(curso, colKey, diasColumnas[i]);

    if (valor == null || String(valor).trim() === '') {
      continue;
    }

    const bloques = String(valor)
      .split(',')
      .map(b => b.trim())
      .filter(b => b.length > 0);

    if (bloques.length > 0) {
      disponibilidad[diaNombres[idx]] = bloques;
    }
  }

  return disponibilidad;
}
