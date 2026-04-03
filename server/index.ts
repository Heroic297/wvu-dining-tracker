import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import { registerRoutes } from "./routes.js";
import { serveStatic } from "./static.js";
import { createServer } from "http";
import { startScheduler } from "./scheduler.js";
import { storage } from "./storage.js";
import { pool } from "./db.js";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-session" {
  interface SessionData {
    token: string;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// Session (used as fallback token store)
app.use(
  session({
    secret: process.env.SESSION_SECRET ?? "wvu-dining-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
  })
);

// Seed dining locations on startup
storage.seedDiningLocations().catch(console.error);

// Run any pending schema migrations on startup
async function runMigrations() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS invite_codes (
        id        VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        code      TEXT        NOT NULL UNIQUE,
        label     TEXT,
        max_uses  INTEGER,
        used_count INTEGER     NOT NULL DEFAULT 0,
        active    BOOLEAN     NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS water_logs (
        id          VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date        DATE        NOT NULL,
        ml_logged   INTEGER     NOT NULL DEFAULT 0,
        updated_at  TIMESTAMPTZ DEFAULT now(),
        UNIQUE(user_id, date)
      )
    `);
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS enable_water_tracking BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS water_bottles JSONB
    `);
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS water_unit TEXT NOT NULL DEFAULT 'oz'
    `);
    // AI Coach columns on users
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS groq_api_key_encrypted TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS openrouter_api_key_encrypted TEXT`);
    // Migrate: move OpenRouter keys from the shared groq column to the dedicated openrouter column
    await pool.query(`
      UPDATE users
      SET openrouter_api_key_encrypted = groq_api_key_encrypted,
          groq_api_key_encrypted = NULL
      WHERE ai_provider = 'openrouter'
        AND groq_api_key_encrypted IS NOT NULL
        AND openrouter_api_key_encrypted IS NULL
    `);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_daily_usage INTEGER NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_daily_usage_date DATE`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_provider TEXT NOT NULL DEFAULT 'groq'`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_model TEXT`);
    // AI Coach profile table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_profiles (
        user_id            VARCHAR(36) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        onboarding_complete BOOLEAN    NOT NULL DEFAULT FALSE,
        preferred_name     TEXT,
        main_goal          TEXT,
        is_wvu_student     BOOLEAN     NOT NULL DEFAULT FALSE,
        experience_level   TEXT,
        notes              TEXT,
        rolling_summary    TEXT,
        coach_tone         TEXT        NOT NULL DEFAULT 'balanced',
        updated_at         TIMESTAMPTZ DEFAULT now()
      )
    `);
    // AI Chat messages table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id          VARCHAR(36)  PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     VARCHAR(36)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role        TEXT         NOT NULL,
        content     TEXT         NOT NULL,
        tool_name   TEXT,
        tool_args   JSONB,
        tool_result TEXT,
        created_at  TIMESTAMPTZ  DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS chat_messages_user_created ON chat_messages(user_id, created_at)
    `);
    // Add new enum values to nutrition_source if not already present.
    // ALTER TYPE ADD VALUE cannot run inside a PL/pgSQL block with EXCEPTION handler —
    // must run as a direct statement. Use a separate try/catch per value.
    try {
      await pool.query(`ALTER TYPE nutrition_source ADD VALUE IF NOT EXISTS 'usda_branded'`);
    } catch { /* already exists */ }
    try {
      await pool.query(`ALTER TYPE nutrition_source ADD VALUE IF NOT EXISTS 'open_food_facts'`);
    } catch { /* already exists */ }

    // ── Garmin MVP tables ──────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS garmin_sessions (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        encrypted_tokens TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'connected',
        last_sync_at    TIMESTAMPTZ,
        last_error      TEXT,
        created_at      TIMESTAMPTZ DEFAULT now(),
        updated_at      TIMESTAMPTZ DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS garmin_daily_summary (
        id                  VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id             VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date                DATE NOT NULL,
        total_steps         INTEGER,
        calories_burned     INTEGER,
        active_minutes      INTEGER,
        sleep_duration_min  INTEGER,
        deep_sleep_min      INTEGER,
        light_sleep_min     INTEGER,
        rem_sleep_min       INTEGER,
        awake_sleep_min     INTEGER,
        sleep_score         INTEGER,
        resting_heart_rate  INTEGER,
        max_heart_rate      INTEGER,
        avg_stress          INTEGER,
        body_battery_high   INTEGER,
        body_battery_low    INTEGER,
        avg_overnight_hrv   REAL,
        hrv_status          TEXT,
        weight_kg           REAL,
        body_fat_pct        REAL,
        recent_activities   JSONB,
        raw_payload         JSONB,
        synced_at           TIMESTAMPTZ DEFAULT now(),
        UNIQUE(user_id, date)
      )
    `);
    // Add source column to weight_log if missing
    await pool.query(`
      ALTER TABLE weight_log ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'
    `);
    console.log("[db] migrations complete");
  } catch (err: any) {
    console.error("[db] Migration error:", err.message);
  }
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Migrations MUST complete before routes are registered so all columns exist
  await runMigrations();

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);

    // Start background scheduler
    startScheduler();
    },
  );
})();
