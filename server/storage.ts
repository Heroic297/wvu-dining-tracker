/**
 * Database storage layer — all CRUD operations go through here.
 * Routes should stay thin; business logic belongs here or in service modules.
 */
import { db, pool } from "./db.js";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import {
  users,
  wearableTokens,
  dailyActivity,
  diningLocations,
  diningMenus,
  diningItems,
  nutritionCache,
  userMeals,
  userMealItems,
  weightLog,
  waterLogs,
  inviteCodes,
  type User,
  type InsertUser,
  type WearableToken,
  type InsertWearableToken,
  type DailyActivity,
  type InsertDailyActivity,
  type DiningLocation,
  type InsertDiningLocation,
  type DiningMenu,
  type InsertDiningMenu,
  type DiningItem,
  type InsertDiningItem,
  type NutritionCache,
  type InsertNutritionCache,
  type UserMeal,
  type InsertUserMeal,
  type UserMealItem,
  type InsertUserMealItem,
  type WeightLog,
  type InsertWeightLog,
  type WaterLog,
  type InsertWaterLog,
  type InviteCode,
  type InsertInviteCode,
} from "../shared/schema.js";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined>;

  // Wearables
  getWearableToken(userId: string, source: string): Promise<WearableToken | undefined>;
  getAllWearableTokens(): Promise<WearableToken[]>;
  upsertWearableToken(token: InsertWearableToken): Promise<WearableToken>;
  deleteWearableToken(userId: string, source: string): Promise<void>;

  // Daily Activity
  getDailyActivity(userId: string, date: string): Promise<DailyActivity[]>;
  getRecentActivity(userId: string, days: number): Promise<DailyActivity[]>;
  upsertDailyActivity(activity: InsertDailyActivity): Promise<DailyActivity>;

  // Dining Locations
  getDiningLocations(): Promise<DiningLocation[]>;
  getDiningLocation(id: string): Promise<DiningLocation | undefined>;
  getDiningLocationBySlug(slug: string): Promise<DiningLocation | undefined>;
  seedDiningLocations(): Promise<void>;

  // Dining Menus
  getDiningMenu(locationId: string, date: string, mealType: string): Promise<DiningMenu | undefined>;
  createDiningMenu(menu: InsertDiningMenu): Promise<DiningMenu>;
  getDiningMenusForDate(locationId: string, date: string): Promise<DiningMenu[]>;

  // Dining Items
  getDiningItems(menuId: string): Promise<DiningItem[]>;
  createDiningItem(item: InsertDiningItem): Promise<DiningItem>;
  createDiningItemsBulk(items: InsertDiningItem[]): Promise<DiningItem[]>;
  deleteDiningItemsByMenu(menuId: string): Promise<void>;

  // Nutrition Cache
  getNutritionCache(normalizedKey: string): Promise<NutritionCache | undefined>;
  upsertNutritionCache(entry: InsertNutritionCache): Promise<NutritionCache>;

  // User Meals
  getUserMeal(id: string): Promise<UserMeal | undefined>;
  getUserMeals(userId: string, date: string): Promise<UserMeal[]>;
  getUserMealsRange(userId: string, startDate: string, endDate: string): Promise<UserMeal[]>;
  createUserMeal(meal: InsertUserMeal): Promise<UserMeal>;
  updateUserMeal(id: string, data: Partial<InsertUserMeal>): Promise<UserMeal | undefined>;
  deleteUserMeal(id: string): Promise<void>;
  recalcUserMealTotals(mealId: string): Promise<void>;

  // User Meal Items
  getUserMealItems(mealId: string): Promise<UserMealItem[]>;
  createUserMealItem(item: InsertUserMealItem): Promise<UserMealItem>;
  updateUserMealItem(id: string, data: Partial<InsertUserMealItem>): Promise<UserMealItem | undefined>;
  deleteUserMealItem(id: string): Promise<void>;

  // Weight Log
  getWeightLog(userId: string, date: string): Promise<WeightLog | undefined>;
  getWeightLogs(userId: string, limit?: number): Promise<WeightLog[]>;
  upsertWeightLog(entry: InsertWeightLog): Promise<WeightLog>;
  deleteWeightLog(userId: string, id: string): Promise<boolean>;
  deleteWeightLogsForUser(userId: string, startDate?: string, endDate?: string): Promise<number>;

  // Water Logs
  getWaterLog(userId: string, date: string): Promise<WaterLog | undefined>;
  upsertWaterLog(userId: string, date: string, mlLogged: number): Promise<WaterLog>;
  deleteWaterLogsForUser(userId: string, startDate?: string, endDate?: string): Promise<number>;

  // Bulk history cleanup (user-scoped)
  deleteUserMealsForUser(userId: string, startDate?: string, endDate?: string): Promise<number>;
  countUserHistory(userId: string, startDate?: string, endDate?: string): Promise<{
    meals: number;
    weightLogs: number;
    waterLogs: number;
    supplementLogs: number;
    workoutLogs: number;
    physiquePhotos: number;
  }>;

  // Invite Codes
  getInviteCode(code: string): Promise<InviteCode | undefined>;
  listInviteCodes(): Promise<InviteCode[]>;
  createInviteCode(data: InsertInviteCode): Promise<InviteCode>;
  consumeInviteCode(code: string): Promise<boolean>;
  revokeInviteCode(id: string): Promise<void>;
  deleteInviteCode(id: string): Promise<void>;
}

export class PgStorage implements IStorage {
  // ── Users ──────────────────────────────────────────────────────────────────

  async getUser(id: string) {
    const [row] = await db.select().from(users).where(eq(users.id, id));
    return row;
  }

  async getUserByEmail(email: string) {
    const [row] = await db.select().from(users).where(eq(users.email, email));
    return row;
  }

  async createUser(user: InsertUser) {
    const [row] = await db.insert(users).values(user as any).returning();
    return row;
  }

  async updateUser(id: string, data: Partial<InsertUser>) {
    const [row] = await db
      .update(users)
      .set(data as any)
      .where(eq(users.id, id))
      .returning();
    return row;
  }

  // ── Wearables ──────────────────────────────────────────────────────────────

  async getWearableToken(userId: string, source: string) {
    const [row] = await db
      .select()
      .from(wearableTokens)
      .where(
        and(
          eq(wearableTokens.userId, userId),
          eq(wearableTokens.source, source as any)
        )
      );
    return row;
  }

  async upsertWearableToken(token: InsertWearableToken) {
    const [row] = await db
      .insert(wearableTokens)
      .values(token)
      .onConflictDoUpdate({
        target: [wearableTokens.userId, wearableTokens.source],
        set: {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: token.expiresAt,
          scope: token.scope,
          rawPayload: token.rawPayload,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return row;
  }

  async getAllWearableTokens() {
    return db.select().from(wearableTokens);
  }

  async deleteWearableToken(userId: string, source: string) {
    await db
      .delete(wearableTokens)
      .where(
        and(
          eq(wearableTokens.userId, userId),
          eq(wearableTokens.source, source as any)
        )
      );
  }

  // ── Daily Activity ─────────────────────────────────────────────────────────

  async getDailyActivity(userId: string, date: string) {
    return db
      .select()
      .from(dailyActivity)
      .where(
        and(eq(dailyActivity.userId, userId), eq(dailyActivity.date, date))
      );
  }

  async getRecentActivity(userId: string, days: number) {
    return db
      .select()
      .from(dailyActivity)
      .where(eq(dailyActivity.userId, userId))
      .orderBy(desc(dailyActivity.date))
      .limit(days);
  }

  async upsertDailyActivity(activity: InsertDailyActivity) {
    const [row] = await db
      .insert(dailyActivity)
      .values(activity)
      .onConflictDoUpdate({
        target: [dailyActivity.userId, dailyActivity.date, dailyActivity.source],
        set: {
          caloriesBurned: activity.caloriesBurned,
          steps: activity.steps,
          activeMinutes: activity.activeMinutes,
          rawPayload: activity.rawPayload,
        },
      })
      .returning();
    return row;
  }

  // ── Dining Locations ───────────────────────────────────────────────────────

  async getDiningLocations() {
    return db
      .select()
      .from(diningLocations)
      .where(eq(diningLocations.isActive, true));
  }

  async getDiningLocation(id: string) {
    const [row] = await db
      .select()
      .from(diningLocations)
      .where(eq(diningLocations.id, id));
    return row;
  }

  async getDiningLocationBySlug(slug: string) {
    const [row] = await db
      .select()
      .from(diningLocations)
      .where(eq(diningLocations.slug, slug));
    return row;
  }

  async seedDiningLocations() {
    const existing = await this.getDiningLocations();
    if (existing.length > 0) return;

    const locations: InsertDiningLocation[] = [
      {
        name: "Café Evansdale",
        slug: "cafe-evansdale",
        wvuIdentifier: "01",
        isActive: true,
      },
      {
        name: "Hatfields",
        slug: "hatfields",
        wvuIdentifier: "03",
        isActive: true,
      },
      {
        name: "Summit Café",
        slug: "summit-cafe",
        wvuIdentifier: "05",
        isActive: true,
      },
    ];
    await db.insert(diningLocations).values(locations).onConflictDoNothing();
  }

  // ── Dining Menus ───────────────────────────────────────────────────────────

  async getDiningMenu(locationId: string, date: string, mealType: string) {
    const [row] = await db
      .select()
      .from(diningMenus)
      .where(
        and(
          eq(diningMenus.locationId, locationId),
          eq(diningMenus.date, date),
          eq(diningMenus.mealType, mealType as any)
        )
      );
    return row;
  }

  async createDiningMenu(menu: InsertDiningMenu) {
    const [row] = await db
      .insert(diningMenus)
      .values(menu)
      .onConflictDoUpdate({
        target: [diningMenus.locationId, diningMenus.date, diningMenus.mealType],
        set: { scrapedAt: sql`now()` },
      })
      .returning();
    return row;
  }

  async getDiningMenusForDate(locationId: string, date: string) {
    return db
      .select()
      .from(diningMenus)
      .where(
        and(
          eq(diningMenus.locationId, locationId),
          eq(diningMenus.date, date)
        )
      );
  }

  // ── Dining Items ───────────────────────────────────────────────────────────

  async getDiningItems(menuId: string) {
    return db
      .select()
      .from(diningItems)
      .where(eq(diningItems.menuId, menuId));
  }

  async createDiningItem(item: InsertDiningItem) {
    const [row] = await db.insert(diningItems).values(item).returning();
    return row;
  }

  async createDiningItemsBulk(items: InsertDiningItem[]) {
    if (items.length === 0) return [];
    return db
      .insert(diningItems)
      .values(items)
      .onConflictDoUpdate({
        target: [diningItems.menuId, diningItems.name],
        set: {
          calories: sql`EXCLUDED.calories`,
          proteinG: sql`EXCLUDED.protein_g`,
          carbsG: sql`EXCLUDED.carbs_g`,
          fatG: sql`EXCLUDED.fat_g`,
          rawMetadata: sql`EXCLUDED.raw_metadata`,
        },
      })
      .returning();
  }

  async deleteDiningItemsByMenu(menuId: string) {
    await db.delete(diningItems).where(eq(diningItems.menuId, menuId));
  }

  // ── Nutrition Cache ────────────────────────────────────────────────────────

  async getNutritionCache(normalizedKey: string) {
    const [row] = await db
      .select()
      .from(nutritionCache)
      .where(eq(nutritionCache.normalizedKey, normalizedKey));
    return row;
  }

  async upsertNutritionCache(entry: InsertNutritionCache) {
    const [row] = await db
      .insert(nutritionCache)
      .values(entry)
      .onConflictDoUpdate({
        target: nutritionCache.normalizedKey,
        set: {
          calories: entry.calories,
          proteinG: entry.proteinG,
          carbsG: entry.carbsG,
          fatG: entry.fatG,
          source: entry.source,
          cachedAt: sql`now()`,
        },
      })
      .returning();
    return row;
  }

  // ── User Meals ─────────────────────────────────────────────────────────────

  async getUserMeal(id: string) {
    const [row] = await db
      .select()
      .from(userMeals)
      .where(eq(userMeals.id, id));
    return row;
  }

  async getUserMeals(userId: string, date: string) {
    return db
      .select()
      .from(userMeals)
      .where(and(eq(userMeals.userId, userId), eq(userMeals.date, date)));
  }

  async getUserMealsRange(
    userId: string,
    startDate: string,
    endDate: string
  ) {
    return db
      .select()
      .from(userMeals)
      .where(
        and(
          eq(userMeals.userId, userId),
          sql`${userMeals.date} >= ${startDate}`,
          sql`${userMeals.date} <= ${endDate}`
        )
      )
      .orderBy(desc(userMeals.date));
  }

  async createUserMeal(meal: InsertUserMeal) {
    const [row] = await db.insert(userMeals).values(meal).returning();
    return row;
  }

  async updateUserMeal(id: string, data: Partial<InsertUserMeal>) {
    const [row] = await db
      .update(userMeals)
      .set(data)
      .where(eq(userMeals.id, id))
      .returning();
    return row;
  }

  async deleteUserMeal(id: string) {
    await db.delete(userMeals).where(eq(userMeals.id, id));
  }

  async recalcUserMealTotals(mealId: string) {
    const items = await this.getUserMealItems(mealId);
    const totals = items.reduce(
      (acc, item) => ({
        totalCalories: acc.totalCalories + (item.calories ?? 0),
        totalProtein: acc.totalProtein + (item.proteinG ?? 0),
        totalCarbs: acc.totalCarbs + (item.carbsG ?? 0),
        totalFat: acc.totalFat + (item.fatG ?? 0),
      }),
      { totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0 }
    );
    await db
      .update(userMeals)
      .set(totals)
      .where(eq(userMeals.id, mealId));
  }

  /**
   * Bulk-delete meals (and, via FK cascade, their items) for one user.
   * If startDate/endDate are provided, only meals in [startDate, endDate]
   * (inclusive, YYYY-MM-DD) are removed. Returns the number of meals deleted.
   */
  async deleteUserMealsForUser(userId: string, startDate?: string, endDate?: string) {
    const conds = [eq(userMeals.userId, userId)];
    if (startDate) conds.push(gte(userMeals.date, startDate));
    if (endDate)   conds.push(lte(userMeals.date, endDate));
    const result = await db.delete(userMeals).where(and(...conds));
    return (result as unknown as { rowCount?: number }).rowCount ?? 0;
  }

  // ── User Meal Items ────────────────────────────────────────────────────────

  async getUserMealItems(mealId: string) {
    return db
      .select()
      .from(userMealItems)
      .where(eq(userMealItems.userMealId, mealId));
  }

  async createUserMealItem(item: InsertUserMealItem) {
    const [row] = await db.insert(userMealItems).values(item).returning();
    await this.recalcUserMealTotals(item.userMealId);
    return row;
  }

  async updateUserMealItem(id: string, data: Partial<InsertUserMealItem>) {
    const [existing] = await db
      .select()
      .from(userMealItems)
      .where(eq(userMealItems.id, id));
    if (!existing) return undefined;
    const [row] = await db
      .update(userMealItems)
      .set(data)
      .where(eq(userMealItems.id, id))
      .returning();
    await this.recalcUserMealTotals(existing.userMealId);
    return row;
  }

  async deleteUserMealItem(id: string) {
    const [existing] = await db
      .select()
      .from(userMealItems)
      .where(eq(userMealItems.id, id));
    if (!existing) return;
    await db.delete(userMealItems).where(eq(userMealItems.id, id));
    await this.recalcUserMealTotals(existing.userMealId);
  }

  // ── Weight Log ─────────────────────────────────────────────────────────────

  async getWeightLog(userId: string, date: string) {
    const [row] = await db
      .select()
      .from(weightLog)
      .where(
        and(eq(weightLog.userId, userId), eq(weightLog.date, date))
      );
    return row;
  }

  async getWeightLogs(userId: string, limit = 90) {
    return db
      .select()
      .from(weightLog)
      .where(eq(weightLog.userId, userId))
      .orderBy(desc(weightLog.date))
      .limit(limit);
  }

  async upsertWeightLog(entry: InsertWeightLog) {
    const [row] = await db
      .insert(weightLog)
      .values(entry)
      .onConflictDoUpdate({
        target: [weightLog.userId, weightLog.date],
        set: {
          weightKg: entry.weightKg,
          notes: entry.notes,
          source: entry.source ?? "manual",
          loggedAt: sql`now()`,
        },
      })
      .returning();

    // Keep users.weightKg in sync with the most-recent weight-log entry so
    // TDEE calculations always use the latest known weight.
    const [latest] = await db
      .select({ weightKg: weightLog.weightKg })
      .from(weightLog)
      .where(eq(weightLog.userId, entry.userId))
      .orderBy(desc(weightLog.date))
      .limit(1);
    if (latest) {
      await db
        .update(users)
        .set({ weightKg: latest.weightKg })
        .where(eq(users.id, entry.userId));
    }

    return row;
  }


  /**
   * Delete a single weight-log row, scoped to the owning user.
   * Returns true if a row was removed, false if not found / not owned.
   */
  async deleteWeightLog(userId: string, id: string) {
    const result = await db
      .delete(weightLog)
      .where(and(eq(weightLog.id, id), eq(weightLog.userId, userId)));
    const n = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    if (n > 0) {
      await this.syncUserLatestWeight(userId);
    }
    return n > 0;
  }

  /**
   * Bulk-delete weight logs for a user, optionally bounded by date range.
   * Returns the number of rows removed.
   */
  async deleteWeightLogsForUser(userId: string, startDate?: string, endDate?: string) {
    const conds = [eq(weightLog.userId, userId)];
    if (startDate) conds.push(gte(weightLog.date, startDate));
    if (endDate)   conds.push(lte(weightLog.date, endDate));
    const result = await db.delete(weightLog).where(and(...conds));
    const n = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    if (n > 0) await this.syncUserLatestWeight(userId);
    return n;
  }

  /**
   * Re-sync users.weight_kg with the most recent weight_log entry, or NULL if
   * none remain. Called after any destructive weight-log operation so downstream
   * TDEE / coach calculations don't keep using a stale cached weight.
   */
  private async syncUserLatestWeight(userId: string) {
    const [latest] = await db
      .select({ weightKg: weightLog.weightKg })
      .from(weightLog)
      .where(eq(weightLog.userId, userId))
      .orderBy(desc(weightLog.date))
      .limit(1);
    await db
      .update(users)
      .set({ weightKg: latest?.weightKg ?? null })
      .where(eq(users.id, userId));
  }

  // ── Water Logs ───────────────────────────────────────────────────────────

  async getWaterLog(userId: string, date: string) {
    const [row] = await db
      .select()
      .from(waterLogs)
      .where(and(eq(waterLogs.userId, userId), eq(waterLogs.date, date)));
    return row;
  }

  async upsertWaterLog(userId: string, date: string, mlLogged: number) {
    const [row] = await db
      .insert(waterLogs)
      .values({ userId, date, mlLogged })
      .onConflictDoUpdate({
        target: [waterLogs.userId, waterLogs.date],
        set: { mlLogged, updatedAt: sql`now()` },
      })
      .returning();
    return row;
  }


  /**
   * Bulk-delete water logs for a user, optionally bounded by date range.
   * Returns the number of rows removed.
   */
  async deleteWaterLogsForUser(userId: string, startDate?: string, endDate?: string) {
    const conds = [eq(waterLogs.userId, userId)];
    if (startDate) conds.push(gte(waterLogs.date, startDate));
    if (endDate)   conds.push(lte(waterLogs.date, endDate));
    const result = await db.delete(waterLogs).where(and(...conds));
    return (result as unknown as { rowCount?: number }).rowCount ?? 0;
  }

  /**
   * Return row counts for everything the “clear history” UI can wipe.
   * Used to preview an impending bulk delete before the user confirms.
   * Uses raw SQL via the shared pool so tables that aren't imported into
   * Drizzle here (supplement_logs, workout_logs, physique_photos) still work.
   */
  async countUserHistory(userId: string, startDate?: string, endDate?: string) {
    const params = [userId, startDate ?? "-infinity", endDate ?? "infinity"];
    const range = (col: string) => `AND ${col} BETWEEN $2::date AND $3::date`;

    const queries = [
      `SELECT COUNT(*)::int AS n FROM user_meals       WHERE user_id=$1 ${range("date")}`,
      `SELECT COUNT(*)::int AS n FROM weight_log       WHERE user_id=$1 ${range("date")}`,
      `SELECT COUNT(*)::int AS n FROM water_logs       WHERE user_id=$1 ${range("date")}`,
      `SELECT COUNT(*)::int AS n FROM supplement_logs  WHERE user_id=$1 ${range("date")}`,
      `SELECT COUNT(*)::int AS n FROM workout_logs     WHERE user_id=$1 ${range("date")}`,
      `SELECT COUNT(*)::int AS n FROM physique_photos  WHERE user_id=$1 ${range("photo_date")}`,
    ];
    const results = await Promise.all(
      queries.map(q => pool.query(q, params).then(r => r.rows[0]?.n ?? 0))
    );
    return {
      meals:          results[0],
      weightLogs:     results[1],
      waterLogs:      results[2],
      supplementLogs: results[3],
      workoutLogs:    results[4],
      physiquePhotos: results[5],
    };
  }

  // ── Invite Codes ───────────────────────────────────────────────────────────

  async getInviteCode(code: string) {
    const [row] = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.code, code));
    return row;
  }

  async listInviteCodes() {
    return db
      .select()
      .from(inviteCodes)
      .orderBy(desc(inviteCodes.createdAt));
  }

  async createInviteCode(data: InsertInviteCode) {
    const [row] = await db
      .insert(inviteCodes)
      .values(data)
      .returning();
    return row;
  }

  /**
   * Validate and consume one use of an invite code.
   * Returns true if the code was valid and has been consumed.
   */
  async consumeInviteCode(code: string): Promise<boolean> {
    const [row] = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.code, code));

    if (!row || !row.active) return false;
    if (row.maxUses !== null && row.usedCount >= row.maxUses) return false;

    await db
      .update(inviteCodes)
      .set({ usedCount: row.usedCount + 1 })
      .where(eq(inviteCodes.id, row.id));

    return true;
  }

  async revokeInviteCode(id: string) {
    await db
      .update(inviteCodes)
      .set({ active: false })
      .where(eq(inviteCodes.id, id));
  }

  async deleteInviteCode(id: string) {
    await db.delete(inviteCodes).where(eq(inviteCodes.id, id));
  }
}

export const storage = new PgStorage();
