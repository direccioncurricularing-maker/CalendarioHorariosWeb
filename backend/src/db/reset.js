import pool from "./pool.js";
import { runMigrations } from "./migrate.js";

async function resetDB() {
  try {
    await pool.query("BEGIN");

    await pool.query(`
      DO $$
      DECLARE
        r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
        LOOP
          EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);

    await pool.query("COMMIT");

    // Al caer todas las tablas (incluida schema_migrations), el runner
    // vuelve a aplicar el esquema completo desde cero.
    const aplicadas = await runMigrations();
    console.log(`♻️ Base de datos reiniciada. Migraciones aplicadas: ${aplicadas.join(", ")}`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Error reseteando DB", err);
    process.exit(1);
  }
}

resetDB();
