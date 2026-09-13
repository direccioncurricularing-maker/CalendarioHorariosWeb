/**
 * Sistema de colores para post-its basado en semestres y especialidades
 */

import { esPlanComun } from './filtros';

// Definición de colores por semestre y especialidad
const COLORES_PLAN_COMUN = {
  1: '#FFEB99', // Amarillo claro
  2: '#A8E6A0', // Verde claro
  3: '#FFB3B3', // Rojo claro
  4: '#A3D5FF', // Azul claro
};

const COLORES_ESPECIALIDADES = {
  'ICI': {
    claro: '#A8E6A0', // Verde claro (impar)
    oscuro: '#4CAF50', // Verde oscuro (par)
  },
  'IOC': {
    claro: '#A3D5FF', // Azul claro (impar)
    oscuro: '#2196F3', // Azul oscuro (par)
  },
  'ICE': {
    claro: '#FFD699', // Naranjo claro (impar)
    oscuro: '#FF9800', // Naranjo oscuro (par)
  },
  'ICC': {
    claro: '#D3D3D3', // Gris claro (impar)
    oscuro: '#757575', // Gris oscuro (par)
  },
  'ICA': {
    claro: '#FFB3D9', // Rosado claro (impar)
    oscuro: '#E91E63', // Rosado oscuro (par)
  },
  'ICQ': {
    claro: '#D4A5D4', // Morado claro (impar)
    oscuro: '#9C27B0', // Morado oscuro (par)
  },
};

// Color de conflicto (rojo destacado)
const COLOR_CONFLICTO = '#FFCDD2';

/**
 * Limpia el número de semestre removiendo letras
 * Ejemplos: "11e" -> 11, "9" -> 9, "10a" -> 10
 */
function limpiarNumeroSemestre(semestre) {
  if (!semestre) return null;
  const semestreStr = String(semestre);
  const numero = parseInt(semestreStr.replace(/[^0-9]/g, ''), 10);
  return isNaN(numero) ? null : numero;
}

/**
 * Determina si un semestre es impar o par
 */
function esSemestreImpar(semestre) {
  const num = limpiarNumeroSemestre(semestre);
  return num ? num % 2 !== 0 : false;
}

/**
 * Obtiene el color para un semestre de plan común
 */
function getColorPlanComun(semestre) {
  const num = limpiarNumeroSemestre(semestre);
  return COLORES_PLAN_COMUN[num] || '#fff9c4'; // Amarillo por defecto
}

/**
 * Obtiene el color para una especialidad y semestre
 */
function getColorEspecialidad(especialidad, semestre) {
  const especialidadUpper = especialidad?.toUpperCase();
  const colores = COLORES_ESPECIALIDADES[especialidadUpper];
  
  if (!colores) return '#fff9c4'; // Amarillo por defecto
  
  const esImpar = esSemestreImpar(semestre);
  return esImpar ? colores.claro : colores.oscuro;
}

/**
 * Parsea el JSON de especialidades_semestres y retorna un array normalizado
 * Estructura esperada:
 * - Puede ser un array: [{nombre: "ICI", semestre: 5}, ...]
 * - Puede ser un objeto: {plan_comun: [1, 2], ICI: [5, 7], ...}
 */
function parseEspecialidadesSemestres(especialidades_semestres) {
  if (!especialidades_semestres) return [];
  
  let esp = especialidades_semestres;
  if (typeof esp === 'string') {
    try {
      esp = JSON.parse(esp);
    } catch {
      return [];
    }
  }
  
  const resultado = [];
  
  // Caso 1: Array de objetos {nombre, semestre}
  if (Array.isArray(esp)) {
    esp.forEach(item => {
      if (item && item.nombre && item.semestre) {
        resultado.push({
          nombre: item.nombre,
          semestre: limpiarNumeroSemestre(item.semestre),
        });
      }
    });
    return resultado;
  }
  
  // Caso 2: Objeto con claves de especialidades
  if (typeof esp === 'object') {
    Object.keys(esp).forEach(key => {
      const semestres = esp[key];
      
      // Puede ser un array o un valor directo
      if (Array.isArray(semestres)) {
        semestres.forEach(sem => {
          const semestreNum = limpiarNumeroSemestre(sem);
          if (semestreNum) {
            resultado.push({
              nombre: key,
              semestre: semestreNum,
            });
          }
        });
      } else {
        // Valor directo (ej: {ICQ: 9})
        const semestreNum = limpiarNumeroSemestre(semestres);
        if (semestreNum) {
          resultado.push({
            nombre: key,
            semestre: semestreNum,
          });
        }
      }
    });
    return resultado;
  }
  
  return [];
}

/**
 * Determina los colores para un horario/prueba basado en su especialidades_semestres
 * @param {Object|String} especialidades_semestres - JSON con las especialidades y semestres
 * @param {String} tipoHorario - 'plan_comun' o la especialidad específica para filtrar
 * @returns {Array} Array de colores [{ color, porcentaje }]
 */
export function getColoresPostit(especialidades_semestres, tipoHorario = null) {
  const especialidades = parseEspecialidadesSemestres(especialidades_semestres);
  
  if (especialidades.length === 0) {
    return [{ color: '#fff9c4', porcentaje: 100 }]; // Amarillo claro por defecto
  }
  
  const coloresMap = new Map();
  
  // Si tipoHorario está especificado, filtrar por ese horario
  let especialidadesFiltradas = especialidades;
  if (tipoHorario) {
    if (tipoHorario === 'plan_comun') {
      especialidadesFiltradas = especialidades.filter(e => esPlanComun(e.nombre));
    } else {
      // Para otros horarios, buscar por la especialidad
      especialidadesFiltradas = especialidades.filter(e => {
        const nombreUpper = e.nombre?.toUpperCase();
        return nombreUpper === tipoHorario.toUpperCase() || 
               nombreUpper?.includes(tipoHorario.toUpperCase());
      });
    }
  }
  
  // Si después del filtro no hay resultados, usar todas
  if (especialidadesFiltradas.length === 0) {
    especialidadesFiltradas = especialidades;
  }
  
  // Determinar colores para cada especialidad-semestre
  especialidadesFiltradas.forEach(({ nombre, semestre }) => {
    let color;
    
    // Verificar si es plan común (semestres 1-4)
    if (esPlanComun(nombre) || semestre <= 4) {
      color = getColorPlanComun(semestre);
    } else {
      // Es una especialidad
      color = getColorEspecialidad(nombre, semestre);
    }
    
    // Contar ocurrencias del mismo color
    const count = coloresMap.get(color) || 0;
    coloresMap.set(color, count + 1);
  });
  
  // Convertir a array con porcentajes
  const total = especialidadesFiltradas.length;
  const colores = Array.from(coloresMap.entries()).map(([color, count]) => ({
    color,
    porcentaje: (count / total) * 100,
  }));
  
  return colores;
}

/**
 * Genera el estilo CSS para el background basado en los colores
 * Si hay un solo color, retorna color sólido
 * Si hay múltiples colores, retorna un gradiente linear dividido en partes iguales
 */
export function getBackgroundStyle(colores) {
  if (!colores || colores.length === 0) {
    return { background: '#fff9c4' };
  }
  
  if (colores.length === 1) {
    return { background: colores[0].color };
  }
  
  // Crear gradiente con múltiples colores
  let acumulado = 0;
  const gradientStops = [];
  
  colores.forEach(({ color, porcentaje }) => {
    gradientStops.push(`${color} ${acumulado}%`);
    acumulado += porcentaje;
    gradientStops.push(`${color} ${acumulado}%`);
  });
  
  return {
    background: `linear-gradient(to right, ${gradientStops.join(', ')})`,
  };
}

/**
 * Determina el color de texto basado en el brillo del fondo
 * Retorna 'white' para fondos oscuros, '#333' para fondos claros
 */
function getTextColor(backgroundColor) {
  if (!backgroundColor) return '#333';
  const hex = backgroundColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  // Fórmula de luminosidad relativa (W3C)
  const luminosidad = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminosidad > 0.5 ? '#333' : 'white';
}

/**
 * Obtiene el estilo completo para un postit, incluyendo conflictos
 * @param {Object|String} especialidades_semestres - JSON con las especialidades
 * @param {Boolean} tieneConflicto - Si el postit tiene conflictos
 * @param {String} tipoHorario - Tipo de horario para filtrar colores
 */
export function getPostitStyle(especialidades_semestres, tieneConflicto = false, tipoHorario = null) {
  // Si tiene conflicto, usar color de conflicto
  if (tieneConflicto) {
    return {
      background: COLOR_CONFLICTO,
      borderLeftColor: '#d32f2f',
      color: '#333',
    };
  }
  
  const colores = getColoresPostit(especialidades_semestres, tipoHorario);
  const backgroundStyle = getBackgroundStyle(colores);
  
  // Determinar el color del borde (usar el primer color)
  const borderColor = colores.length > 0 ? colores[0].color : '#ffeb3b';
  const textColor = colores.length > 0 ? getTextColor(colores[0].color) : '#333';
  
  return {
    ...backgroundStyle,
    borderLeftColor: borderColor,
    color: textColor,
  };
}

/**
 * Función helper para obtener el tipo de horario desde el semestreId
 */
export function getTipoHorario(semestreId) {
  // Mapeo de semestreId a tipo de horario
  const mapaSemestres = {
    'plan_comun': 'plan_comun',
    '5to_6to': null, // En 5to y 6to pueden haber varias especialidades
    '7mo_8vo': null,
    '9no_10_11': null,
  };
  
  return mapaSemestres[semestreId] || null;
}
