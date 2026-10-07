import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pool from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../sql/migrations");
const LOCK_KEY = 727001;

/**
 * Aplica las migraciones pendientes de sql/migrations (archivos .sql ordenados
 * por nombre). Usa una tabla schema_migrations para llevar el historial y un
 * advisory lock para que dos instancias no migren al mismo tiempo.
 *
 * Cada migración se aplica dentro de una transacción: si falla, se revierte
 * completa y el error se propaga (el servidor no arranca).
 *
 * @returns {Promise<string[]>} nombres de los archivos aplicados
 */
export async function runMigrations() {
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const aplicadasResult = await client.query("SELECT id FROM schema_migrations");
    const aplicadas = new Set(aplicadasResult.rows.map((r) => r.id));

    const archivos = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const pendientes = archivos.filter((f) => !aplicadas.has(f));

    if (pendientes.length === 0) {
      console.log("[Migraciones] Base de datos al día, sin migraciones pendientes");
      return [];
    }

    const aplicadasAhora = [];
    for (const archivo of pendientes) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, archivo), "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [archivo]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migración fallida "${archivo}": ${err.message}`);
      }

      aplicadasAhora.push(archivo);
      console.log(`[Migraciones] Aplicada: ${archivo}`);
    }

    return aplicadasAhora;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    client.release();
  }
}
