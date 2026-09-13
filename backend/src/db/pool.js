import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool, types } = pkg;

// DATE (OID 1082): devolver "YYYY-MM-DD" como texto, sin convertir a Date.
// Evita que un valor como 2026-03-01 se corra al día anterior al serializar
// desde una zona horaria distinta a la del navegador.
types.setTypeParser(1082, (valor) => valor);

const isProduction = process.env.NODE_ENV === "production";

const pool = isProduction
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    })
  : new Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });

export default pool;