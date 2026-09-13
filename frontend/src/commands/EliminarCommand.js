class EliminarCommand {
  constructor(api, items, espejos = []) {
    this.api = api;
    this.items = items;
    // Copias espejo (mismo curso/día/bloque en otros horarios) que deben
    // restaurarse al deshacer, porque el DELETE las borra todas juntas.
    this.espejos = espejos;
  }

  async execute() {
    for (const item of this.items) {
      await this.api.eliminar(item.id);
    }
  }

  async undo() {
    const aRestaurar = this.espejos.length > 0 ? this.espejos : this.items;
    for (const item of aRestaurar) {
      await this.api.crear(
        item.horaProgramableId,
        item.dashboardId,
        item.dia,
        item.bloqueIndex,
        item.horario,
        item.horario
      );
    }
  }
}

export default EliminarCommand;
