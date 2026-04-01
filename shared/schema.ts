import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  integer,
  real,
  boolean,
  date,
  timestamp,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const mealTypeEnum = pgEnum("meal_type", [
  "breakfast",
  "lunch",
  "dinner",
  "brunch",
]);

export const activityLevelEnum = pgEnum("activity_level", [
  "sedentary",
  "lightly_active",
  "moderately_active",
  "very_active",
  "extra_active",
]);

export const goalTypeEnum = pgEnum("goal_type", [
  "weight_loss",
  "weight_gain",
  "powerlifting_loss",
  "powerlifting_gain",
  "maintenance",
]);

export const sexEnum = pgEnum("sex", ["male", "female"]);

export const wearableSourceEnum = pgEnum("wearable_source", [
  "garmin",
  "fitbit",
]);

export const nutritionSourceEnum = pgEnum("nutrition_source", [
  "wvu",
  "usda",
  "usda_branded",
  "open_food_facts",
  "ai_estimated",
  "manual_exact",
]);

export const burnModeEnum = pgEnum("burn_mode", ["wearable", "tdee"]);

// ─── Users (Supabase Auth) ────────────────────────────────────────────────────
// We shadow the Supabase auth.users table with our own profile row
// linked by the same UUID.

export const users = pgTable("users", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  // bcrypt hash — only used for email/password fallback when not using Supabase
  passwordHash: text("password_hash"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  // Profile / TDEE inputs
  sex: sexEnum("sex"),
  dateOfBirth: date("date_of_birth"),
  heightCm: real("height_cm"),
  weightKg: real("weight_kg"),
  activityLevel: activityLevelEnum("activity_level"),
  // Goal
  goalType: goalTypeEnum("goal_type"),
  targetWeightKg: real("target_weight_kg"),
  targetDate: date("target_date"),
  burnMode: burnModeEnum("burn_mode").default("tdee"),
  // Powerlifting
  trainingDays: jsonb("training_days").$type<number[]>(), // 0=Sun..6=Sat
  // Meet
  meetDate: date("meet_date"),
  enableWaterCut: boolean("enable_water_cut").default(false),
  enableWaterTracking: boolean("enable_water_tracking").default(false),
  /** Saved water bottle presets [{id, name, mlSize}] */
  waterBottles: jsonb("water_bottles").$type<Array<{id: string; name: string; mlSize: number}>>(),
  /** Preferred display unit for water */
  waterUnit: text("water_unit").$type<"ml" | "oz" | "L" | "gal">().default("oz"),
  // Onboarding
  onboardingComplete: boolean("onboarding_complete").default(false),
  // AI Coach — encrypted Groq API key (AES-256-GCM, hex-encoded iv:tag:ciphertext)
  groqApiKeyEncrypted: text("groq_api_key_encrypted"),
  // AI Coach daily usage counter (resets each day)
  aiDailyUsage: integer("ai_daily_usage").default(0),
  aiDailyUsageDate: date("ai_daily_usage_date"),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ─── Wearable OAuth Tokens ────────────────────────────────────────────────────

export const wearableTokens = pgTable(
  "wearable_tokens",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: wearableSourceEnum("source").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at"),
    scope: text("scope"),
    rawPayload: jsonb("raw_payload"),
    updatedAt: timestamp("updated_at").default(sql`now()`),
  },
  (t) => [uniqueIndex("wearable_tokens_user_source").on(t.userId, t.source)]
);

export const insertWearableTokenSchema = createInsertSchema(
  wearableTokens
).omit({ id: true, updatedAt: true });
export type InsertWearableToken = z.infer<typeof insertWearableTokenSchema>;
export type WearableToken = typeof wearableTokens.$inferSelect;

// ─── Daily Activity (from wearables) ─────────────────────────────────────────

export const dailyActivity = pgTable(
  "daily_activity",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    source: wearableSourceEnum("source").notNull(),
    caloriesBurned: integer("calories_burned"),
    steps: integer("steps"),
    activeMinutes: integer("active_minutes"),
    rawPayload: jsonb("raw_payload"),
  },
  (t) => [uniqueIndex("daily_activity_user_date_source").on(t.userId, t.date, t.source)]
);

export const insertDailyActivitySchema = createInsertSchema(
  dailyActivity
).omit({ id: true });
export type InsertDailyActivity = z.infer<typeof insertDailyActivitySchema>;
export type DailyActivity = typeof dailyActivity.$inferSelect;

// ─── Dining Locations ─────────────────────────────────────────────────────────

export const diningLocations = pgTable("dining_locations", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(), // e.g. "cafe-evansdale"
  wvuIdentifier: text("wvu_identifier"), // used in scraper URL/selector
  isActive: boolean("is_active").default(true),
});

export const insertDiningLocationSchema = createInsertSchema(
  diningLocations
).omit({ id: true });
export type InsertDiningLocation = z.infer<typeof insertDiningLocationSchema>;
export type DiningLocation = typeof diningLocations.$inferSelect;

// ─── Dining Menus ─────────────────────────────────────────────────────────────

export const diningMenus = pgTable(
  "dining_menus",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    locationId: varchar("location_id", { length: 36 })
      .notNull()
      .references(() => diningLocations.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    mealType: mealTypeEnum("meal_type").notNull(),
    scrapedAt: timestamp("scraped_at").default(sql`now()`),
  },
  (t) => [
    uniqueIndex("dining_menus_loc_date_meal").on(
      t.locationId,
      t.date,
      t.mealType
    ),
  ]
);

export const insertDiningMenuSchema = createInsertSchema(diningMenus).omit({
  id: true,
  scrapedAt: true,
});
export type InsertDiningMenu = z.infer<typeof insertDiningMenuSchema>;
export type DiningMenu = typeof diningMenus.$inferSelect;

// ─── Dining Items ─────────────────────────────────────────────────────────────

export const diningItems = pgTable(
  "dining_items",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    menuId: varchar("menu_id", { length: 36 })
      .notNull()
      .references(() => diningMenus.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    calories: integer("calories"),
    proteinG: real("protein_g"),
    carbsG: real("carbs_g"),
    fatG: real("fat_g"),
    servingSize: text("serving_size"),
    nutritionSource: nutritionSourceEnum("nutrition_source").default("wvu"),
    rawMetadata: jsonb("raw_metadata"),
  },
  (t) => [index("dining_items_menu_id").on(t.menuId)]
);

export const insertDiningItemSchema = createInsertSchema(diningItems).omit({
  id: true,
});
export type InsertDiningItem = z.infer<typeof insertDiningItemSchema>;
export type DiningItem = typeof diningItems.$inferSelect;

// ─── AI Nutrition Cache ───────────────────────────────────────────────────────
// Stores Groq-estimated macros keyed by normalized food name

export const nutritionCache = pgTable(
  "nutrition_cache",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    foodName: text("food_name").notNull(),
    normalizedKey: text("normalized_key").notNull().unique(), // lowercased/trimmed
    calories: integer("calories"),
    proteinG: real("protein_g"),
    carbsG: real("carbs_g"),
    fatG: real("fat_g"),
    servingSize: text("serving_size"),
    source: nutritionSourceEnum("source").default("ai_estimated"),
    confidence: text("confidence"), // "high" | "medium" | "low"
    cachedAt: timestamp("cached_at").default(sql`now()`),
  }
);

export const insertNutritionCacheSchema = createInsertSchema(
  nutritionCache
).omit({ id: true, cachedAt: true });
export type InsertNutritionCache = z.infer<typeof insertNutritionCacheSchema>;
export type NutritionCache = typeof nutritionCache.$inferSelect;

// ─── User Meals ───────────────────────────────────────────────────────────────

export const userMeals = pgTable(
  "user_meals",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    mealType: mealTypeEnum("meal_type").notNull(),
    locationId: varchar("location_id", { length: 36 }).references(
      () => diningLocations.id
    ), // null = non-dining-hall
    totalCalories: real("total_calories").default(0),
    totalProtein: real("total_protein").default(0),
    totalCarbs: real("total_carbs").default(0),
    totalFat: real("total_fat").default(0),
    notes: text("notes"),
    createdAt: timestamp("created_at").default(sql`now()`),
  },
  (t) => [
    index("user_meals_user_date").on(t.userId, t.date),
    uniqueIndex("user_meals_user_date_type_loc").on(
      t.userId,
      t.date,
      t.mealType,
      t.locationId
    ),
  ]
);

export const insertUserMealSchema = createInsertSchema(userMeals).omit({
  id: true,
  createdAt: true,
});
export type InsertUserMeal = z.infer<typeof insertUserMealSchema>;
export type UserMeal = typeof userMeals.$inferSelect;

// ─── User Meal Items ──────────────────────────────────────────────────────────

export const userMealItems = pgTable(
  "user_meal_items",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userMealId: varchar("user_meal_id", { length: 36 })
      .notNull()
      .references(() => userMeals.id, { onDelete: "cascade" }),
    diningItemId: varchar("dining_item_id", { length: 36 }).references(
      () => diningItems.id
    ),
    customName: text("custom_name"),
    servings: real("servings").default(1),
    calories: real("calories").notNull().default(0),
    proteinG: real("protein_g").default(0),
    carbsG: real("carbs_g").default(0),
    fatG: real("fat_g").default(0),
    source: nutritionSourceEnum("source").notNull(),
  },
  (t) => [index("user_meal_items_meal_id").on(t.userMealId)]
);

export const insertUserMealItemSchema = createInsertSchema(
  userMealItems
).omit({ id: true });
export type InsertUserMealItem = z.infer<typeof insertUserMealItemSchema>;
export type UserMealItem = typeof userMealItems.$inferSelect;

// ─── Weight Log ───────────────────────────────────────────────────────────────

export const weightLog = pgTable(
  "weight_log",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    weightKg: real("weight_kg").notNull(),
    notes: text("notes"),
    loggedAt: timestamp("logged_at").default(sql`now()`),
  },
  (t) => [uniqueIndex("weight_log_user_date").on(t.userId, t.date)]
);

export const insertWeightLogSchema = createInsertSchema(weightLog).omit({
  id: true,
  loggedAt: true,
});
export type InsertWeightLog = z.infer<typeof insertWeightLogSchema>;
export type WeightLog = typeof weightLog.$inferSelect;

// ─── Water Logs ────────────────────────────────────────────────────────────

export const waterLogs = pgTable(
  "water_logs",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    /** Total ml consumed so far today */
    mlLogged: integer("ml_logged").notNull().default(0),
    updatedAt: timestamp("updated_at").default(sql`now()`),
  },
  (t) => [uniqueIndex("water_logs_user_date").on(t.userId, t.date)]
);

export const insertWaterLogSchema = createInsertSchema(waterLogs).omit({
  id: true,
  updatedAt: true,
});
export type InsertWaterLog = z.infer<typeof insertWaterLogSchema>;
export type WaterLog = typeof waterLogs.$inferSelect;

// ─── Invite Codes ────────────────────────────────────────────────────────────

export const inviteCodes = pgTable("invite_codes", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),
  /** Friendly label for the owner to identify who they gave this to */
  label: text("label"),
  /** How many times it can be used (null = unlimited) */
  maxUses: integer("max_uses"),
  usedCount: integer("used_count").notNull().default(0),
  /** Set to false to instantly revoke without deleting */
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").default(sql`now()`),
});

export const insertInviteCodeSchema = createInsertSchema(inviteCodes).omit({
  id: true,
  usedCount: true,
  createdAt: true,
});
export type InsertInviteCode = z.infer<typeof insertInviteCodeSchema>;
export type InviteCode = typeof inviteCodes.$inferSelect;

// ─── AI Coach Profiles ───────────────────────────────────────────────────────
// Stores onboarding answers and the rolling memory summary for each user.

export const aiProfiles = pgTable("ai_profiles", {
  userId: varchar("user_id", { length: 36 })
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // Onboarding state
  onboardingComplete: boolean("onboarding_complete").default(false),
  // Answers from Q+A
  preferredName: text("preferred_name"),
  mainGoal: text("main_goal"),             // "lose_weight" | "build_muscle" | "powerlifting" | "general_fitness" | "other"
  isWvuStudent: boolean("is_wvu_student").default(false),
  experienceLevel: text("experience_level"), // "beginner" | "intermediate" | "advanced"
  notes: text("notes"),                    // free-text: injuries, dietary restrictions, preferences
  // Rolling memory — rewritten by compaction, never appended
  rollingSummary: text("rolling_summary"),
  // Tone preference set during onboarding or by user request
  coachTone: text("coach_tone").default("balanced"), // "coach" | "data" | "balanced"
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export type AiProfile = typeof aiProfiles.$inferSelect;

// ─── AI Chat Messages ─────────────────────────────────────────────────────────
// Rolling window of recent messages. Old messages are compacted into ai_profiles.rolling_summary.

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),   // "user" | "assistant" | "tool"
    content: text("content").notNull(),
    // Tool call metadata (assistant tool-use turns)
    toolName: text("tool_name"),
    toolArgs: jsonb("tool_args"),
    toolResult: text("tool_result"),
    createdAt: timestamp("created_at").default(sql`now()`),
  },
  (t) => [index("chat_messages_user_created").on(t.userId, t.createdAt)]
);

export type ChatMessage = typeof chatMessages.$inferSelect;

// ─── Sessions (express-session via pg) ───────────────────────────────────────

export const sessions = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire").notNull(),
});
