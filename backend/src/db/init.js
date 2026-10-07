import { runMigrations } from "./migrate.js";

async function initDB() {
  try {
    const aplicadas = await runMigrations();
    if (aplicadas.length === 0) {
      console.log("✅ Base de datos al día (sin migraciones pendientes)");
    } else {
      console.log(`✅ Migraciones aplicadas: ${aplicadas.join(", ")}`);
    }
    process.exit(0);
  } catch (err) {
    console.error("❌ Error aplicando migraciones");
    console.error(err);
    process.exit(1);
  }
}

initDB();
