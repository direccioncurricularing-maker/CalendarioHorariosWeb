/**
 * Períodos del maestro.
 *
 * Cada despliegue apunta a un maestro (APPSCRIPT_URL) con un nombre de período
 * (PERIODO_ACTUAL). Los dashboards nuevos se etiquetan con él; los antiguos
 * conservan la etiqueta "anterior" y quedan intactos.
 */

export const PERIODO_ANTERIOR = 'anterior';

/**
 * Período activo del despliegue actual. Se lee en cada llamada para no quedar
 * congelado si cambia la variable de entorno.
 */
export function obtenerPeriodoActual() {
  return process.env.PERIODO_ACTUAL || 'actual';
}
