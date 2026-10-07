import dotenv from "dotenv";
dotenv.config();

import app from "./app.js";
import { runMigrations } from "./src/db/migrate.js";

const PORT = process.env.PORT || 3000;

try {
  await runMigrations();
} catch (err) {
  console.error("❌ Error aplicando migraciones. El servidor no arrancará.");
  console.error(err);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`Servidor escuchando en ${PORT}`);
});
