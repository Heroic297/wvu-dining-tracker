/**
 * Database connection singleton.
 * Uses DATABASE_URL from environment variables.
 * Compatible with Supabase PostgreSQL or any Postgres instance.
 *
 * SSL note: The pg driver can pick up sslmode=require from the connection
 * string and override Pool-level ssl config. We explicitly strip any
 * sslmode/sslcert/sslkey params from the URL and force our own ssl config
 * to prevent SELF_SIGNED_CERT_IN_CHAIN errors on Railway + Supabase pooler.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
const { Pool } = pkg;
import * as schema from "../shared/schema.js";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

/**
 * Strip SSL-related query parameters from a Postgres connection URL so the
 * pg driver doesn't override our Pool-level ssl config.
 */
function sanitizeDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove params that interfere with Pool-level ssl config
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("sslcert");
    parsed.searchParams.delete("sslkey");
    parsed.searchParams.delete("sslrootcert");
    parsed.searchParams.delete("ssl");
    return parsed.toString();
  } catch {
    // If URL parsing fails, return as-is and hope for the best
    return url;
  }
}

const connectionString = sanitizeDatabaseUrl(process.env.DATABASE_URL);

export const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
  // Increase connection timeout for Railway cold starts
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10,
});

// Log connection errors without crashing the process
pool.on("error", (err) => {
  console.error("[db] Pool error:", err.message);
});

export const db = drizzle(pool, { schema });
