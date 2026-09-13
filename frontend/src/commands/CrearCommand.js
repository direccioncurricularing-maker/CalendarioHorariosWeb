class CrearCommand {
  constructor(api, paramsList) {
    this.api = api;
    this.paramsList = paramsList;
    this.createdFirstIds = [];
    this.warnings = [];
  }

  async execute() {
    this.createdFirstIds = [];
    this.warnings = [];
    for (const p of this.paramsList) {
      const res = await this.api.crear(p.horaProgramableId, p.dashboardId, p.dia, p.bloqueIndex, p.semestreId);
      if (res.horasRegistradas && res.horasRegistradas.length > 0) {
        this.createdFirstIds.push(res.horasRegistradas[0].id);
      }
      if (Array.isArray(res.warnings)) {
        this.warnings.push(...res.warnings);
      }
    }
  }

  async undo() {
    for (const id of this.createdFirstIds) {
      try {
        await this.api.eliminar(id);
      } catch (err) {
        if (err.message && err.message.includes('no encontrada')) continue;
        throw err;
      }
    }
  }
}

export default CrearCommand;
