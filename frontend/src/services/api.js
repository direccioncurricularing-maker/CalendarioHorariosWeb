const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// ==================== USUARIOS ====================
export const authService = {
  async register(nombre, mail, password, adminPassword) {
    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, mail, password, adminPassword })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || 'Error en registro');
    }
    return res.json();
  },

  async login(mail, password) {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mail, password })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || 'Error en login');
    }
    return res.json();
  },

  async getUser(userId) {
    const res = await fetch(`${API_URL}/users/${userId}`);
    if (!res.ok) throw new Error('Error obteniendo usuario');
    return res.json();
  }
};

// ==================== SHEETS ====================
export const sheetsService = {
  async getMaestroList() {
    const res = await fetch(`${API_URL}/sheets/master.list`);
    if (!res.ok) throw new Error('Error obteniendo maestros');
    return res.json();
  },

  async loadMaestros() {
    const res = await fetch(`${API_URL}/sheets/load-maestros`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error('Error cargando maestros');
    return res.json();
  },

  async usarRespaldo(dashboardId) {
    const res = await fetch(`${API_URL}/sheets/usar-respaldo/${dashboardId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || 'Error aplicando respaldo');
    }
    return res.json();
  },

  async getHorariosProgramables() {
    const res = await fetch(`${API_URL}/sheets/horas-programables`);
    if (!res.ok) throw new Error('Error obteniendo horarios programables');
    return res.json();
  },

  async limpiarHorariosProgramables() {
    const res = await fetch(`${API_URL}/sheets/horas-programables`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Error limpiando horarios');
    return res.json();
  }
};

// ==================== DASHBOARDS ====================
export const dashboardService = {
  async getDashboards(userId) {
    const res = await fetch(`${API_URL}/dashboards?usuario_id=${userId}`);
    if (!res.ok) throw new Error('Error obteniendo dashboards');
    return res.json();
  },

  async getDashboard(dashboardId) {
    const res = await fetch(`${API_URL}/dashboards/${dashboardId}`);
    if (!res.ok) throw new Error('Error obteniendo dashboard');
    return res.json();
  },

  async createDashboard(nombre, userId, fechaInicio, fechaFin) {
    const res = await fetch(`${API_URL}/dashboards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, usuario_id: userId, fecha_inicio: fechaInicio, fecha_fin: fechaFin })
    });
    if (!res.ok) throw new Error('Error creando dashboard');
    return res.json();
  },

  async deleteDashboard(dashboardId) {
    const res = await fetch(`${API_URL}/dashboards/${dashboardId}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Error eliminando dashboard');
    return res.json();
  },

  async updateDashboard(dashboardId, nombre, fechaInicio, fechaFin) {
    const res = await fetch(`${API_URL}/dashboards/${dashboardId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, fecha_inicio: fechaInicio, fecha_fin: fechaFin })
    });
    if (!res.ok) throw new Error('Error actualizando dashboard');
    return res.json();
  },

  async toggleFeriado(dashboardId, fecha) {
    const res = await fetch(`${API_URL}/dashboards/${dashboardId}/feriados`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fecha })
    });
    if (!res.ok) throw new Error('Error toggling feriado');
    return res.json();
  }
};

// ==================== HORAS REGISTRADAS ====================
export const horasRegistradasService = {
  async obtenerPorDashboard(dashboardId) {
    const res = await fetch(`${API_URL}/horas-registradas/${dashboardId}`);
    if (!res.ok) throw new Error('Error obteniendo horas registradas');
    return res.json();
  },

  async crear(horaProgramableId, dashboardId, dia, bloqueIndex, semestreId, horarioEspecifico = null) {
    const body = {
      horaProgramableId,
      dashboardId,
      dia,
      bloqueIndex,
      semestreId
    };
    if (horarioEspecifico) body.horarioEspecifico = horarioEspecifico;
    const res = await fetch(`${API_URL}/horas-registradas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error creando hora registrada');
    }
    return res.json();
  },

  async actualizar(id, dia, bloqueIndex) {
    const res = await fetch(`${API_URL}/horas-registradas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dia, bloqueIndex })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error actualizando hora registrada');
    }
    return res.json();
  },

  async eliminar(id) {
    const res = await fetch(`${API_URL}/horas-registradas/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error eliminando hora registrada');
    }
    return res.json();
  },

  async limpiarDashboard(dashboardId) {
    const res = await fetch(`${API_URL}/horas-registradas/dashboard/${dashboardId}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error limpiando horas registradas');
    }
    return res.json();
  },

  async obtenerDiccionarioParaGoogleSheets(dashboardId) {
    const res = await fetch(`${API_URL}/horas-registradas/diccionario/${dashboardId}`);
    if (!res.ok) throw new Error('Error obteniendo diccionario');
    return res.json();
  },

  async enviarDiccionarioAGoogleSheets(dashboardId) {
    const res = await fetch(`${API_URL}/horas-registradas/enviar-sheets/${dashboardId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error enviando datos a Google Sheets');
    }
    return res.json();
  }
};

// ==================== PRUEBAS PROGRAMABLES ====================
export const pruebasProgramablesService = {
  async obtenerPruebasProgramables() {
    const res = await fetch(`${API_URL}/sheets/pruebas-programables`);
    if (!res.ok) throw new Error('Error obteniendo pruebas programables');
    return res.json();
  },

  async limpiarPruebasProgramables() {
    const res = await fetch(`${API_URL}/sheets/pruebas-programables`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error('Error limpiando pruebas');
    return res.json();
  },

  async actualizarCalendario(dashboardId) {
    const res = await fetch(`${API_URL}/sheets/actualizar-calendario/${dashboardId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error actualizando calendario');
    }
    return res.json();
  }
};

// ==================== PRUEBAS REGISTRADAS ====================
export const pruebasRegistradasService = {
  async obtenerPorDashboard(dashboardId) {
    const res = await fetch(`${API_URL}/pruebas-registradas/${dashboardId}`);
    if (!res.ok) throw new Error('Error obteniendo pruebas registradas');
    return res.json();
  },

  async obtenerPorRangoFechas(dashboardId, fechaInicio, fechaFin) {
    const res = await fetch(`${API_URL}/pruebas-registradas/rango/${dashboardId}?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`);
    if (!res.ok) throw new Error('Error obteniendo pruebas por rango de fechas');
    return res.json();
  },

  async crear(pruebaProgramableId, dashboardId, fecha, horaInicio = null, horaFin = null) {
    const res = await fetch(`${API_URL}/pruebas-registradas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        pruebaProgramableId, 
        dashboardId, 
        fecha,
        horaInicio,
        horaFin
      })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error creando prueba registrada');
    }
    return res.json();
  },

  async actualizar(id, fecha, horaInicio = null, horaFin = null) {
    const res = await fetch(`${API_URL}/pruebas-registradas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fecha, horaInicio, horaFin })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error actualizando prueba registrada');
    }
    return res.json();
  },

  async eliminar(id) {
    const res = await fetch(`${API_URL}/pruebas-registradas/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error eliminando prueba registrada');
    }
    return res.json();
  },

  async limpiarDashboard(dashboardId) {
    const res = await fetch(`${API_URL}/pruebas-registradas/dashboard/${dashboardId}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error limpiando pruebas registradas');
    }
    return res.json();
  },

  async enviarPruebasAGoogleSheets(dashboardId) {
    const res = await fetch(`${API_URL}/pruebas-registradas/enviar-sheets/${dashboardId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error enviando pruebas a Google Sheets');
    }
    return res.json();
  }
};
