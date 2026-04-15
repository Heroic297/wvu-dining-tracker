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
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "10mb" }));

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
    // Add token_type column to garmin_sessions for DI token support
    await pool.query(`
      ALTER TABLE garmin_sessions ADD COLUMN IF NOT EXISTS token_type TEXT NOT NULL DEFAULT 'garmin-connect'
    `);
    // Add source column to weight_log if missing
    await pool.query(`
      ALTER TABLE weight_log ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'
    `);

    // ── Apple Health ──────────────────────────────────────────────────────
    try { await pool.query(`ALTER TYPE wearable_source ADD VALUE IF NOT EXISTS 'apple_health'`); } catch { /* already exists */ }
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_health_token TEXT`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS apple_health_daily (
        id                 VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id            VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date               DATE NOT NULL,
        total_steps        INTEGER,
        calories_burned    INTEGER,
        active_minutes     INTEGER,
        sleep_duration_min INTEGER,
        deep_sleep_min     INTEGER,
        rem_sleep_min      INTEGER,
        resting_heart_rate INTEGER,
        avg_overnight_hrv  REAL,
        weight_kg          REAL,
        body_fat_pct       REAL,
        synced_at          TIMESTAMPTZ DEFAULT now(),
        UNIQUE(user_id, date)
      )
    `);

    // ── Apple Health extra columns (workouts, VO2, respiratory) ─────────
    await pool.query(`ALTER TABLE apple_health_daily ADD COLUMN IF NOT EXISTS workouts JSONB`);
    await pool.query(`ALTER TABLE apple_health_daily ADD COLUMN IF NOT EXISTS vo2_max REAL`);
    await pool.query(`ALTER TABLE apple_health_daily ADD COLUMN IF NOT EXISTS respiratory_rate REAL`);

    // ── Micronutrient columns on user_meal_items ──────────────────────────
    await pool.query(`ALTER TABLE user_meal_items ADD COLUMN IF NOT EXISTS fiber_g REAL`);
    await pool.query(`ALTER TABLE user_meal_items ADD COLUMN IF NOT EXISTS sugar_g REAL`);
    await pool.query(`ALTER TABLE user_meal_items ADD COLUMN IF NOT EXISTS sodium_mg REAL`);
    await pool.query(`ALTER TABLE user_meal_items ADD COLUMN IF NOT EXISTS potassium_mg REAL`);
    await pool.query(`ALTER TABLE user_meal_items ADD COLUMN IF NOT EXISTS vitamin_c_mg REAL`);
    await pool.query(`ALTER TABLE user_meal_items ADD COLUMN IF NOT EXISTS calcium_mg REAL`);
    await pool.query(`ALTER TABLE user_meal_items ADD COLUMN IF NOT EXISTS iron_mg REAL`);
    await pool.query(`ALTER TABLE user_meal_items ADD COLUMN IF NOT EXISTS vitamin_d_iu REAL`);
    await pool.query(`ALTER TABLE user_meal_items ADD COLUMN IF NOT EXISTS saturated_fat_g REAL`);
    await pool.query(`ALTER TABLE user_meal_items ADD COLUMN IF NOT EXISTS trans_fat_g REAL`);
    await pool.query(`ALTER TABLE user_meal_items ADD COLUMN IF NOT EXISTS cholesterol_mg REAL`);
    await pool.query(`ALTER TABLE user_meal_items ADD COLUMN IF NOT EXISTS barcode TEXT`);

    // ── Supplements ───────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS supplements (
        id            VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        brand         TEXT,
        barcode       TEXT,
        serving_size  TEXT,
        serving_unit  TEXT DEFAULT 'serving',
        calories      REAL,
        protein_g     REAL,
        carbs_g       REAL,
        fat_g         REAL,
        fiber_g       REAL,
        sodium_mg     REAL,
        vitamin_c_mg  REAL,
        vitamin_d_iu  REAL,
        vitamin_b12_mcg REAL,
        zinc_mg       REAL,
        magnesium_mg  REAL,
        calcium_mg    REAL,
        iron_mg       REAL,
        custom_nutrients JSONB,
        notes         TEXT,
        is_active     BOOLEAN DEFAULT TRUE,
        created_at    TIMESTAMPTZ DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS supplements_user_id ON supplements(user_id)`);

    // ── Supplement Logs ───────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS supplement_logs (
        id             VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        supplement_id  VARCHAR(36) NOT NULL REFERENCES supplements(id) ON DELETE CASCADE,
        date           DATE NOT NULL,
        servings       REAL NOT NULL DEFAULT 1,
        logged_at      TIMESTAMPTZ DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS supplement_logs_user_date ON supplement_logs(user_id, date)`);

    // ── Physique Tracking ─────────────────────────────────────────────────
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS enable_physique_tracking BOOLEAN DEFAULT FALSE`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS physique_photos (
        id          VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        photo_url   TEXT NOT NULL,
        weight_kg   REAL,
        body_fat_pct REAL,
        notes       TEXT,
        photo_date  DATE NOT NULL,
        groq_analysis TEXT,
        created_at  TIMESTAMPTZ DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS physique_photos_user_date ON physique_photos(user_id, photo_date)`);

    // ── Training Programs ─────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS training_programs (
        id            VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        source        TEXT NOT NULL DEFAULT 'manual',
        raw_content   TEXT,
        parsed_blocks JSONB,
        is_active     BOOLEAN DEFAULT TRUE,
        created_at    TIMESTAMPTZ DEFAULT now(),
        updated_at    TIMESTAMPTZ DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS training_programs_user_id ON training_programs(user_id)`);

    // ── Workout Logs ──────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS workout_logs (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        program_id      VARCHAR(36) REFERENCES training_programs(id) ON DELETE SET NULL,
        date            DATE NOT NULL,
        week_number     INTEGER,
        day_label       TEXT,
        exercises       JSONB NOT NULL DEFAULT '[]',
        notes           TEXT,
        logged_at       TIMESTAMPTZ DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS workout_logs_user_date ON workout_logs(user_id, date)`);
    // Prevent duplicate dining items by adding unique constraint.
    // First, purge any pre-existing duplicate (menu_id, name) rows so the
    // unique index can be built.  We keep the row with the latest `id`
    // (UUIDs are random so "max" is an arbitrary but deterministic pick).
    // Then create the constraint only if it doesn't already exist.
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'dining_items_unique_menu_name'
        ) THEN
          -- Remove duplicates: keep the row with the MAX id per (menu_id, name)
          DELETE FROM dining_items
          WHERE id NOT IN (
            SELECT MAX(id)
            FROM dining_items
            GROUP BY menu_id, name
          );

          ALTER TABLE dining_items ADD CONSTRAINT dining_items_unique_menu_name UNIQUE (menu_id, name);
        END IF;
      END
      $$;
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
