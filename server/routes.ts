/**
 * Express API routes.
 * All routes prefixed with /api.
 */
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage.js";
import { requireAuth, optionalAuth, hashPassword, verifyPassword, signToken, type AuthRequest } from "./auth.js";
import { scrapeLocationDate, scrapeAllLocations, todayString } from "./scraper.js";
import { lookupNutrition } from "./nutrition.js";
import { computeDailyTargets, generateWaterCutPlan, generatePeakWeekPlan, analyzeWaterCut, calcDailyWaterMl } from "./tdee.js";
import {
  getFitbitAuthUrl,
  exchangeFitbitCode,
  getGarminAuthUrl,
  exchangeGarminCode,
  syncUserWearable,
} from "./wearables.js";
import {
  garminLogin,
  getGarminStatus,
  getGarminSummary,
  syncGarminData,
  disconnectGarmin,
  importDiToken,
} from "./garmin.js";
import { pool } from "./db.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import crypto from "crypto";
import { registerCoachRoutes } from "./coach.js";

const CRON_SECRET = process.env.CRON_SECRET ?? "cron-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ── AI Coach ──────────────────────────────────────────────────────────
  registerCoachRoutes(app);

  // ── Auth ───────────────────────────────────────────────────────────────────

  app.post("/api/auth/register", async (req, res) => {
    try {
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(8),
        displayName: z.string().optional(),
        inviteCode: z.string().min(1, "Invite code is required"),
      });
      const { email, password, displayName, inviteCode } = schema.parse(req.body);

      // Validate invite code before doing anything else
      const valid = await storage.consumeInviteCode(inviteCode.trim().toUpperCase());
      if (!valid) {
        return res.status(403).json({ error: "Invalid or expired invite code" });
      }

      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ error: "Email already registered" });
      }

      const passwordHash = await hashPassword(password);
      const user = await storage.createUser({
        email,
        passwordHash,
        displayName: displayName ?? email.split("@")[0],
      });

      const token = signToken(user.id);
      (req.session as any).token = token;
      res.json({ token, user: sanitizeUser(user) });
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ error: err.errors[0].message });
      }
      console.error("[auth/register]", err);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  // ── Admin: Invite Code Management ──────────────────────────────────────────
  // Gated to the owner account by email — uses normal JWT auth.
  const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "owengidusko@gmail.com";

  const requireOwner = (req: AuthRequest, res: any, next: any) => {
    if (!req.user || req.user.email !== OWNER_EMAIL) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };

  app.get("/api/admin/invites", requireAuth as any, requireOwner as any, async (_req, res) => {
    const codes = await storage.listInviteCodes();
    res.json(codes);
  });

  app.post("/api/admin/invites", requireAuth as any, requireOwner as any, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        label: z.string().optional(),
        maxUses: z.number().int().positive().optional().nullable(),
        code: z.string().optional(),
      });
      const data = schema.parse(req.body);
      const code = data.code
        ? data.code.trim().toUpperCase()
        : Math.random().toString(36).substring(2, 10).toUpperCase();
      const invite = await storage.createInviteCode({
        code,
        label: data.label,
        maxUses: data.maxUses ?? null,
        active: true,
      });
      res.status(201).json(invite);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ error: err.errors[0].message });
      }
      res.status(500).json({ error: "Failed to create invite" });
    }
  });

  app.patch("/api/admin/invites/:id/revoke", requireAuth as any, requireOwner as any, async (req, res) => {
    await storage.revokeInviteCode(req.params.id);
    res.json({ ok: true });
  });

  app.delete("/api/admin/invites/:id", requireAuth as any, requireOwner as any, async (req, res) => {
    await storage.deleteInviteCode(req.params.id);
    res.json({ ok: true });
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const schema = z.object({
        email: z.string().email(),
        password: z.string(),
      });
      const { email, password } = schema.parse(req.body);

      const user = await storage.getUserByEmail(email);
      if (!user || !user.passwordHash) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const valid = await verifyPassword(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      const token = signToken(user.id);
      (req.session as any).token = token;
      res.json({ token, user: sanitizeUser(user) });
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ error: err.errors[0].message });
      }
      console.error("[auth/login]", err);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/logout", requireAuth as any, (req: AuthRequest, res) => {
    req.session?.destroy?.(() => {});
    res.json({ ok: true });
  });

  app.get("/api/auth/me", requireAuth as any, (req: AuthRequest, res) => {
    res.json({ user: sanitizeUser(req.user!) });
  });

  // ── User / Profile ────────────────────────────────────────────────────────

  app.get("/api/user/profile", requireAuth as any, async (req: AuthRequest, res) => {
    res.json(sanitizeUser(req.user!));
  });

  app.patch("/api/user/profile", requireAuth as any, async (req: AuthRequest, res) => {
    try {
      const updateSchema = z.object({
        displayName: z.string().optional(),
        sex: z.enum(["male", "female"]).optional(),
        dateOfBirth: z.string().optional(),
        heightCm: z.number().optional(),
        weightKg: z.number().optional(),
        activityLevel: z
          .enum([
            "sedentary",
            "lightly_active",
            "moderately_active",
            "very_active",
            "extra_active",
          ])
          .optional(),
        goalType: z
          .enum([
            "weight_loss",
            "weight_gain",
            "powerlifting_loss",
            "powerlifting_gain",
            "maintenance",
          ])
          .optional(),
        targetWeightKg: z.number().optional(),
        targetDate: z.string().optional(),
        burnMode: z.enum(["wearable", "tdee"]).optional(),
        trainingDays: z.array(z.number().int().min(0).max(6)).optional(),
        meetDate: z.string().optional().nullable(),
        enableWaterTracking: z.boolean().optional(),
        waterBottles: z.array(z.object({
          id: z.string(),
          name: z.string(),
          mlSize: z.number().positive(),
        })).optional(),
        waterUnit: z.enum(["ml", "oz", "L", "gal"]).optional(),
        onboardingComplete: z.boolean().optional(),
      });
      const data = updateSchema.parse(req.body);
      const updated = await storage.updateUser(req.user!.id, data);
      res.json(sanitizeUser(updated!));
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ error: err.errors[0].message });
      }
      console.error("[user/profile PATCH]", err);
      res.status(500).json({ error: "Update failed" });
    }
  });

  // ── Diet Targets ──────────────────────────────────────────────────────────

  app.get("/api/targets", requireAuth as any, async (req: AuthRequest, res) => {
    try {
      const date = (req.query.date as string) ?? todayString();
      const user = req.user!;

      // Get wearable burn if available
      let burnCalories: number | undefined;
      if (user.burnMode === "wearable") {
        const activities = await storage.getDailyActivity(user.id, date);
        const totalBurn = activities.reduce(
          (sum, a) => sum + (a.caloriesBurned ?? 0),
          0
        );
        if (totalBurn > 0) burnCalories = totalBurn;
      }

      // Most recent weight log — MUST be fetched before computeDailyTargets
      // so the latest logged weight drives tier + buffer calculations
      const recentWeightLogs = await storage.getWeightLogs(user.id, 1);
      const recentWeightKg = recentWeightLogs[0]?.weightKg ?? user.weightKg;

      const targets = computeDailyTargets(user, burnCalories, date, recentWeightKg);
      if (!targets) {
        return res.status(400).json({
          error: "Profile incomplete — please finish setup to get targets",
        });
      }

      // Water cut analysis
      const waterCutAnalysis = user.meetDate
        ? analyzeWaterCut(user, recentWeightKg)
        : null;

      // Water cut plan — shown automatically when analysis determines it's needed (Tier 2+)
      let waterCutPlan = null;
      if (user.meetDate && waterCutAnalysis?.needsWaterCut) {
        waterCutPlan = generateWaterCutPlan(user, user.meetDate);
      }

      // Peak week plan if within 14 days of meet
      let peakWeekPlan = null;
      if (user.meetDate) {
        const plan = generatePeakWeekPlan(user, user.meetDate, recentWeightKg ?? undefined);
        if (plan.length > 0) peakWeekPlan = plan;
      }

      res.json({ targets, waterCutPlan, peakWeekPlan, waterCutAnalysis });
    } catch (err) {
      console.error("[targets]", err);
      res.status(500).json({ error: "Failed to compute targets" });
    }
  });

  // ── Dining Locations ──────────────────────────────────────────────────────

  app.get("/api/dining/locations", async (_req, res) => {
    try {
      await storage.seedDiningLocations();
      const locations = await storage.getDiningLocations();
      res.json(locations);
    } catch (err) {
      console.error("[dining/locations]", err);
      res.status(500).json({ error: "Failed to get locations" });
    }
  });

  // ── Dining Menus ──────────────────────────────────────────────────────────

  app.get(
    "/api/dining/menu",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          locationSlug: z.string(),
          date: z.string(),
          mealType: z.enum(["breakfast", "lunch", "dinner", "brunch"]),
        });
        const { locationSlug, date, mealType } = schema.parse(req.query);

        const location = await storage.getDiningLocationBySlug(locationSlug);
        if (!location) {
          return res.status(404).json({ error: "Location not found" });
        }

        // Check if menu is already cached
        let menu = await storage.getDiningMenu(location.id, date, mealType);

        if (!menu) {
          // On-demand scrape
          console.log(
            `[routes] On-demand scrape for ${locationSlug}/${mealType}/${date}`
          );
          await scrapeLocationDate(locationSlug, date);
          menu = await storage.getDiningMenu(location.id, date, mealType);
        }

        if (!menu) {
          return res.json({ menu: null, items: [], message: "No menu available for this selection" });
        }

        let items = await storage.getDiningItems(menu.id);

        // Deduplicate items by name in case of prior double-scrape bug.
        // If duplicates exist, clean them from the DB so future reads are clean.
        const seen = new Set<string>();
        const unique = items.filter((item) => {
          if (seen.has(item.name)) return false;
          seen.add(item.name);
          return true;
        });
        if (unique.length < items.length) {
          console.log(`[routes] Deduplicating ${items.length - unique.length} duplicate items for menu ${menu.id}`);
          // Keep only unique items — delete all and reinsert the deduplicated set
          const uniqueInsert = unique.map(({ id: _id, ...rest }) => rest);
          await storage.deleteDiningItemsByMenu(menu.id);
          if (uniqueInsert.length > 0) {
            await storage.createDiningItemsBulk(uniqueInsert as any);
          }
          items = await storage.getDiningItems(menu.id);
        }

        res.json({ menu, items, location });
      } catch (err: any) {
        if (err.name === "ZodError") {
          return res.status(400).json({ error: err.errors[0].message });
        }
        console.error("[dining/menu]", err);
        res.status(500).json({ error: "Failed to get menu" });
      }
    }
  );

  // ── Nutrition Lookup ──────────────────────────────────────────────────────

  app.get(
    "/api/nutrition/lookup",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        const foodName = req.query.q as string;
        if (!foodName?.trim()) {
          return res.status(400).json({ error: "Query parameter 'q' required" });
        }
        // Text search always uses AI — barcode route uses USDA/Open Food Facts
        const result = await lookupNutrition(foodName.trim(), { forceAi: true });
        if (!result) {
          return res.status(404).json({
            error: "Could not find nutrition info — please enter manually",
          });
        }
        res.json(result);
      } catch (err) {
        console.error("[nutrition/lookup]", err);
        res.status(500).json({ error: "Nutrition lookup failed" });
      }
    }
  );

  // ── Barcode / UPC Lookup ──────────────────────────────────────────────────
  // Priority: USDA Branded Foods (exact gtinUpc match) → Open Food Facts → AI name lookup

  app.get(
    "/api/nutrition/barcode",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        const upc = (req.query.upc as string)?.trim();
        if (!upc) {
          return res.status(400).json({ error: "Query parameter 'upc' required" });
        }

        const axios = (await import("axios")).default;
        const USDA_KEY = process.env.USDA_API_KEY || "DEMO_KEY";
        const USDA_BASE = "https://api.nal.usda.gov/fdc/v1";

        // ── 1. USDA Branded Foods — exact gtinUpc (UPC/EAN barcode) match ────────
        //    This is the gold standard: official label data straight from the USDA FDC.
        //    Uses the /foods/search endpoint with dataType=Branded and gtinUpc filter.
        try {
          const usdaResp = await axios.get(`${USDA_BASE}/foods/search`, {
            params: {
              query: upc,
              dataType: "Branded",
              pageSize: 5,
              api_key: USDA_KEY,
            },
            timeout: 8000,
          });

          const foods: any[] = usdaResp.data?.foods ?? [];
          // Filter to exact UPC/GTIN match
          const match = foods.find(
            (f: any) =>
              f.gtinUpc === upc ||
              f.gtinUpc === upc.replace(/^0+/, "") ||
              ("0" + f.gtinUpc) === upc
          );

          if (match) {
            // USDA /foods/search returns nutrients per 100g for branded foods.
            // We must scale by (servingSize / 100) to get per-serving values.
            const servingGrams: number = parseFloat(match.servingSize) || 100;
            const scaleFactor = servingGrams / 100;

            const getNutrientPer100g = (number: string): number => {
              const found = (match.foodNutrients ?? []).find(
                (n: any) => n.nutrientNumber === number
              );
              return found?.value ?? 0;
            };

            const scale = (per100g: number) =>
              Math.round(per100g * scaleFactor * 10) / 10;

            const caloriesPer100g = getNutrientPer100g("208");
            const calories = scale(caloriesPer100g);

            const brandPart = match.brandName ? ` (${match.brandName})` : "";
            const name = match.description
              ? `${match.description}${brandPart}`
              : "Scanned product";

            const servingSize = match.servingSize && match.servingSizeUnit
              ? `${match.servingSize}${match.servingSizeUnit}`
              : "per serving";

            if (calories > 0) {
              console.log(`[barcode] USDA Branded match: ${name} — ${servingGrams}g serving, ${calories} kcal (fdcId ${match.fdcId})`);
              return res.json({
                foodName: name,
                calories,
                proteinG: scale(getNutrientPer100g("203")),
                carbsG:   scale(getNutrientPer100g("205")),
                fatG:     scale(getNutrientPer100g("204")),
                servingSize,
                source: "usda_branded",
                confidence: "high",
                breakdown: [],
              });
            }
          }
        } catch (usdaErr: any) {
          console.warn("[barcode] USDA branded lookup failed:", usdaErr.message);
        }

        // ── 2. Open Food Facts — covers global branded products not in USDA ────────
        try {
          const offResp = await axios.get(
            `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(upc)}.json`,
            { timeout: 8000 }
          );

          if (offResp.data?.status === 1) {
            const product = offResp.data.product ?? {};
            const n = product.nutriments ?? {};
            const name = product.product_name_en || product.product_name || "Scanned product";

            const servingQty: number = parseFloat(product.serving_quantity) || 100;
            const servingLabel: string = product.serving_size || `${servingQty}g`;

            const getVal = (perServing: string, per100: string): number => {
              const sv = parseFloat(n[perServing]);
              if (!isNaN(sv) && sv > 0) return Math.round(sv * 10) / 10;
              const v100 = parseFloat(n[per100]);
              if (!isNaN(v100) && v100 > 0) return Math.round((v100 * servingQty / 100) * 10) / 10;
              return 0;
            };

            const calories = getVal("energy-kcal_serving", "energy-kcal_100g");
            if (calories > 0) {
              console.log(`[barcode] Open Food Facts match: ${name}`);
              return res.json({
                foodName: name,
                calories,
                proteinG: getVal("proteins_serving",     "proteins_100g"),
                carbsG:   getVal("carbohydrates_serving", "carbohydrates_100g"),
                fatG:     getVal("fat_serving",           "fat_100g"),
                servingSize: servingLabel,
                source: "open_food_facts",
                confidence: "high",
                breakdown: [],
              });
            }
          }
        } catch (offErr: any) {
          console.warn("[barcode] Open Food Facts lookup failed:", offErr.message);
        }

        // ── 3. AI fallback — last resort, AI tries to identify product by UPC ─────
        const result = await lookupNutrition(`barcode product UPC ${upc}`);
        if (result) {
          return res.json(result);
        }

        return res.status(404).json({
          error: "Product not found in USDA or Open Food Facts. Try typing the food name instead.",
        });
      } catch (err) {
        console.error("[nutrition/barcode]", err);
        res.status(500).json({ error: "Barcode lookup failed" });
      }
    }
  );

  // ── Meal Logging ──────────────────────────────────────────────────────────

  app.get("/api/meals", requireAuth as any, async (req: AuthRequest, res) => {
    try {
      const date = (req.query.date as string) ?? todayString();
      const meals = await storage.getUserMeals(req.user!.id, date);
      const mealsWithItems = await Promise.all(
        meals.map(async (meal) => ({
          ...meal,
          items: await storage.getUserMealItems(meal.id),
        }))
      );
      res.json(mealsWithItems);
    } catch (err) {
      console.error("[meals GET]", err);
      res.status(500).json({ error: "Failed to get meals" });
    }
  });

  app.get(
    "/api/meals/range",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          startDate: z.string(),
          endDate: z.string(),
        });
        const { startDate, endDate } = schema.parse(req.query);
        const meals = await storage.getUserMealsRange(
          req.user!.id,
          startDate,
          endDate
        );
        const mealsWithItems = await Promise.all(
          meals.map(async (meal) => ({
            ...meal,
            items: await storage.getUserMealItems(meal.id),
          }))
        );
        res.json(mealsWithItems);
      } catch (err: any) {
        if (err.name === "ZodError") {
          return res.status(400).json({ error: err.errors[0].message });
        }
        res.status(500).json({ error: "Failed to get meal range" });
      }
    }
  );

  app.post("/api/meals", requireAuth as any, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        date: z.string(),
        mealType: z.enum(["breakfast", "lunch", "dinner", "brunch"]),
        locationId: z.string().optional().nullable(),
        notes: z.string().optional(),
      });
      const data = schema.parse(req.body);
      const meal = await storage.createUserMeal({
        userId: req.user!.id,
        ...data,
      });
      res.status(201).json(meal);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ error: err.errors[0].message });
      }
      console.error("[meals POST]", err);
      res.status(500).json({ error: "Failed to create meal" });
    }
  });

  app.delete(
    "/api/meals/:id",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        const meal = await storage.getUserMeal(req.params.id as string);
        if (!meal || meal.userId !== req.user!.id) {
          return res.status(404).json({ error: "Meal not found" });
        }
        await storage.deleteUserMeal(req.params.id as string);
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: "Failed to delete meal" });
      }
    }
  );

  // ── Meal Items ────────────────────────────────────────────────────────────

  app.get(
    "/api/meals/:mealId/items",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        const meal = await storage.getUserMeal(req.params.mealId as string);
        if (!meal || meal.userId !== req.user!.id) {
          return res.status(404).json({ error: "Meal not found" });
        }
        const items = await storage.getUserMealItems(req.params.mealId as string);
        res.json(items);
      } catch (err) {
        res.status(500).json({ error: "Failed to get items" });
      }
    }
  );

  app.post(
    "/api/meals/:mealId/items",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        const meal = await storage.getUserMeal(req.params.mealId as string);
        if (!meal || meal.userId !== req.user!.id) {
          return res.status(404).json({ error: "Meal not found" });
        }

        const schema = z.object({
          diningItemId: z.string().optional().nullable(),
          customName: z.string().optional().nullable(),
          servings: z.number().positive().default(1),
          calories: z.number().min(0),
          proteinG: z.number().min(0).default(0),
          carbsG: z.number().min(0).default(0),
          fatG: z.number().min(0).default(0),
          source: z.enum(["wvu", "usda", "usda_branded", "open_food_facts", "ai_estimated", "manual_exact"]),
        });

        const data = schema.parse(req.body);

        // Normalize source to values guaranteed to exist in the Postgres enum.
        // usda_branded and open_food_facts may not be in older DB instances.
        const safeSourceMap: Record<string, string> = {
          usda_branded: "usda",
          open_food_facts: "usda",
        };
        const safeSource = (safeSourceMap[data.source] ?? data.source) as typeof data.source;

        // Macros are already pre-scaled by the client before sending.
        // servings is stored as metadata only — do NOT multiply again here.
        const scaledItem = {
          userMealId: req.params.mealId as string,
          ...data,
          source: safeSource,
        };

        const item = await storage.createUserMealItem(scaledItem);
        res.status(201).json(item);
      } catch (err: any) {
        if (err.name === "ZodError") {
          return res.status(400).json({ error: err.errors[0].message });
        }
        console.error("[items POST]", err);
        res.status(500).json({ error: "Failed to add item" });
      }
    }
  );

  app.patch(
    "/api/meal-items/:id",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        const item = await storage.getUserMealItems(
          (await storage.getUserMeal(req.params.id as string))?.id ?? ""
        );
        // Verify ownership via meal
        const schema = z.object({
          servings: z.number().positive().optional(),
          calories: z.number().min(0).optional(),
          proteinG: z.number().min(0).optional(),
          carbsG: z.number().min(0).optional(),
          fatG: z.number().min(0).optional(),
        });
        const data = schema.parse(req.body);
        const updated = await storage.updateUserMealItem(req.params.id as string, data);
        if (!updated) return res.status(404).json({ error: "Item not found" });
        res.json(updated);
      } catch (err: any) {
        if (err.name === "ZodError") {
          return res.status(400).json({ error: err.errors[0].message });
        }
        res.status(500).json({ error: "Failed to update item" });
      }
    }
  );

  app.delete(
    "/api/meal-items/:id",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        await storage.deleteUserMealItem(req.params.id as string);
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: "Failed to delete item" });
      }
    }
  );

  // ── Weight Tracking ───────────────────────────────────────────────────────

  app.get(
    "/api/weight",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        const limit = parseInt((req.query.limit as string) ?? "90");
        const logs = await storage.getWeightLogs(req.user!.id, limit);
        res.json(logs);
      } catch (err) {
        res.status(500).json({ error: "Failed to get weight logs" });
      }
    }
  );

  app.post(
    "/api/weight",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          date: z.string(),
          weightKg: z.number().positive(),
          notes: z.string().optional(),
        });
        const data = schema.parse(req.body);
        const log = await storage.upsertWeightLog({
          userId: req.user!.id,
          source: "manual",
          ...data,
        });

        // Update user's current weight
        await storage.updateUser(req.user!.id, { weightKg: data.weightKg });

        res.json(log);
      } catch (err: any) {
        if (err.name === "ZodError") {
          return res.status(400).json({ error: err.errors[0].message });
        }
        res.status(500).json({ error: "Failed to log weight" });
      }
    }
  );

  // ── Water Tracking ───────────────────────────────────────────────────────

  app.get("/api/water", requireAuth as any, async (req: AuthRequest, res) => {
    try {
      const date = (req.query.date as string) ?? todayString();
      const log = await storage.getWaterLog(req.user!.id, date);
      res.json({ mlLogged: log?.mlLogged ?? 0, date });
    } catch (err) {
      res.status(500).json({ error: "Failed to get water log" });
    }
  });

  app.post("/api/water", requireAuth as any, async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        date: z.string(),
        mlLogged: z.number().min(0),
      });
      const { date, mlLogged } = schema.parse(req.body);
      const log = await storage.upsertWaterLog(req.user!.id, date, mlLogged);
      res.json(log);
    } catch (err: any) {
      if (err.name === "ZodError") {
        return res.status(400).json({ error: err.errors[0].message });
      }
      res.status(500).json({ error: "Failed to log water" });
    }
  });

  // ── Wearables ─────────────────────────────────────────────────────────────

  // Fitbit OAuth2
  app.get(
    "/api/wearables/fitbit/connect",
    requireAuth as any,
    (req: AuthRequest, res) => {
      if (!process.env.FITBIT_CLIENT_ID) {
        return res.status(503).json({ error: "Fitbit integration not configured" });
      }
      const state = `${req.user!.id}:${randomUUID()}`;
      const url = getFitbitAuthUrl(state);
      res.json({ url });
    }
  );

  app.get("/api/wearables/fitbit/callback", async (req, res) => {
    try {
      const { code, state } = req.query as {
        code: string;
        state: string;
      };
      const userId = state?.split(":")?.[0];
      if (!userId || !code) {
        return res.status(400).send("Invalid OAuth callback");
      }

      const tokens = await exchangeFitbitCode(code);
      await storage.upsertWearableToken({
        userId,
        source: "fitbit",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scope: tokens.scope,
        rawPayload: tokens as any,
      });

      // Kick off initial sync
      syncUserWearable(userId, "fitbit").catch(console.error);

      res.redirect("/#/settings?connected=fitbit");
    } catch (err) {
      console.error("[fitbit callback]", err);
      res.redirect("/#/settings?error=fitbit");
    }
  });

  app.delete(
    "/api/wearables/:source",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      const source = req.params.source as string as "fitbit" | "garmin";
      if (!["fitbit", "garmin"].includes(source)) {
        return res.status(400).json({ error: "Invalid source" });
      }
      await storage.deleteWearableToken(req.user!.id, source);
      res.json({ ok: true });
    }
  );

  // Garmin OAuth2
  app.get(
    "/api/wearables/garmin/connect",
    requireAuth as any,
    (req: AuthRequest, res) => {
      if (!process.env.GARMIN_CLIENT_ID) {
        return res.status(503).json({ error: "Garmin integration not configured" });
      }
      const state = `${req.user!.id}:${randomUUID()}`;
      const url = getGarminAuthUrl(state);
      res.json({ url });
    }
  );

  app.get("/api/wearables/garmin/callback", async (req, res) => {
    try {
      const { oauth_token, oauth_verifier, state } = req.query as {
        oauth_token: string;
        oauth_verifier: string;
        state: string;
      };
      const code = (req.query.code as string) ?? oauth_token;
      const userId = state?.split(":")?.[0];
      if (!userId || !code) {
        return res.status(400).send("Invalid OAuth callback");
      }

      const tokens = await exchangeGarminCode(code);
      await storage.upsertWearableToken({
        userId,
        source: "garmin",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        rawPayload: tokens as any,
      });

      syncUserWearable(userId, "garmin").catch(console.error);
      res.redirect("/#/settings?connected=garmin");
    } catch (err) {
      console.error("[garmin callback]", err);
      res.redirect("/#/settings?error=garmin");
    }
  });

  app.get(
    "/api/wearables/status",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      const fitbit = await storage.getWearableToken(req.user!.id, "fitbit");
      const garmin = await storage.getWearableToken(req.user!.id, "garmin");
      res.json({
        fitbit: !!fitbit,
        garmin: !!garmin,
      });
    }
  );

  app.post(
    "/api/wearables/sync",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      const source = req.body.source as "fitbit" | "garmin";
      try {
        await syncUserWearable(req.user!.id, source);
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: "Sync failed" });
      }
    }
  );

  // Activity (wearable data for UI)
  app.get(
    "/api/activity",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        const days = parseInt((req.query.days as string) ?? "7");
        const activity = await storage.getRecentActivity(req.user!.id, days);
        res.json(activity);
      } catch (err) {
        res.status(500).json({ error: "Failed to get activity" });
      }
    }
  );

  // ── Garmin MVP (unofficial garmin-connect integration) ──────────────────────

  // Connect Garmin via email/password
  app.post(
    "/api/garmin/connect",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          email: z.string().email(),
          password: z.string().min(1),
        });
        const { email, password } = schema.parse(req.body);
        const result = await garminLogin(req.user!.id, email, password);
        if (!result.ok) {
          return res.status(401).json({ error: result.error });
        }
        // Kick off initial sync in background
        syncGarminData(req.user!.id).catch(console.error);
        res.json({ ok: true });
      } catch (err: any) {
        if (err.name === "ZodError") {
          return res.status(400).json({ error: err.errors[0].message });
        }
        console.error("[garmin/connect]", err);
        res.status(500).json({ error: "Garmin connection failed" });
      }
    }
  );

  // Get Garmin connection status + latest summary
  app.get(
    "/api/garmin/status",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        const status = await getGarminStatus(req.user!.id);
        const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        let summary = status.connected ? await getGarminSummary(req.user!.id, date) : null;
        if (!summary && status.connected) {
          summary = await getGarminSummary(req.user!.id, yesterday);
        }
        res.json({ ...status, summary });
      } catch (err) {
        console.error("[garmin/status]", err);
        res.status(500).json({ error: "Failed to get Garmin status" });
      }
    }
  );

  // Sync / refresh Garmin data
  app.post(
    "/api/garmin/sync",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        const result = await syncGarminData(req.user!.id);
        if (!result.ok) {
          return res.status(400).json({ error: result.error });
        }
        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        let summary = await getGarminSummary(req.user!.id, today);
        if (!summary) {
          summary = await getGarminSummary(req.user!.id, yesterday);
        }
        res.json({ ok: true, categories: result.categories, summary });
      } catch (err) {
        console.error("[garmin/sync]", err);
        res.status(500).json({ error: "Sync failed" });
      }
    }
  );

  // Disconnect Garmin
  app.delete(
    "/api/garmin/disconnect",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        await disconnectGarmin(req.user!.id);
        res.json({ ok: true });
      } catch (err) {
        console.error("[garmin/disconnect]", err);
        res.status(500).json({ error: "Disconnect failed" });
      }
    }
  );

  // Import Garmin DI token (available to all authenticated users)
  app.post(
    "/api/garmin/import-di-token",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          di_token: z.string().min(1, "di_token is required"),
          di_refresh_token: z.string().min(1, "di_refresh_token is required"),
          di_client_id: z.string().min(1, "di_client_id is required"),
        });
        const { di_token, di_refresh_token, di_client_id } = schema.parse(req.body);
        const result = await importDiToken(req.user!.id, di_token, di_refresh_token, di_client_id);
        if (!result.ok) {
          return res.status(400).json({ error: result.error });
        }
        // Kick off initial sync in background
        syncGarminData(req.user!.id).catch(console.error);
        res.json({ ok: true });
      } catch (err: any) {
        if (err.name === "ZodError") {
          return res.status(400).json({ error: err.errors[0].message });
        }
        console.error("[garmin/import-di-token]", err);
        res.status(500).json({ error: "DI token import failed" });
      }
    }
  );

  // Get effective weight (considering Garmin vs manual precedence)
  app.get(
    "/api/weight/effective",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        const logs = await storage.getWeightLogs(req.user!.id, 1);
        const latest = logs[0];
        res.json({
          weightKg: latest?.weightKg ?? req.user!.weightKg ?? null,
          source: (latest as any)?.source ?? "manual",
          date: latest?.date ?? null,
        });
      } catch (err) {
        res.status(500).json({ error: "Failed to get effective weight" });
      }
    }
  );

  // ── Dev / Testing ──────────────────────────────────────────────────────────
  // Seed 7 days of fake Garmin sleep data for the authenticated user.
  // Gated to non-production environments so it can never run on prod.
  // Usage: POST /api/dev/seed-garmin-sleep  (no body needed)
  app.post(
    "/api/dev/seed-garmin-sleep",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      if (process.env.NODE_ENV === "production") {
        return res.status(403).json({ error: "Not available in production" });
      }
      try {
        const userId = req.user!.id;

        // Ensure a garmin_sessions row exists so getGarminCoachContext sees status=connected
        await pool.query(
          `INSERT INTO garmin_sessions (user_id, encrypted_tokens, status, token_type, updated_at)
           VALUES ($1, 'seed', 'connected', 'seed', now())
           ON CONFLICT (user_id) DO UPDATE SET
             status = 'connected',
             token_type = 'seed',
             last_error = NULL,
             updated_at = now()`,
          [userId]
        );

        // Realistic sleep data for a collegiate powerlifter — slight fatigue trend
        // heading into a meet week (scores drop, less deep sleep)
        const seedDays = [
          { daysAgo: 7, durMin: 452, score: 79, deep: 72, rem: 88, light: 252, awake: 18, hrv: 62, rhr: 52 },
          { daysAgo: 6, durMin: 438, score: 75, deep: 68, rem: 82, light: 243, awake: 21, hrv: 58, rhr: 53 },
          { daysAgo: 5, durMin: 461, score: 81, deep: 80, rem: 91, light: 248, awake: 15, hrv: 65, rhr: 51 },
          { daysAgo: 4, durMin: 423, score: 71, deep: 58, rem: 76, light: 244, awake: 27, hrv: 54, rhr: 55 },
          { daysAgo: 3, durMin: 445, score: 74, deep: 64, rem: 85, light: 249, awake: 22, hrv: 57, rhr: 54 },
          { daysAgo: 2, durMin: 397, score: 66, deep: 50, rem: 70, light: 238, awake: 31, hrv: 49, rhr: 57 },
          { daysAgo: 1, durMin: 418, score: 69, deep: 55, rem: 78, light: 241, awake: 28, hrv: 52, rhr: 56 },
        ];

        const now = Date.now();
        let inserted = 0;

        for (const d of seedDays) {
          const dateStr = new Date(now - d.daysAgo * 86400000).toISOString().slice(0, 10);
          await pool.query(
            `INSERT INTO garmin_daily_summary (
              user_id, date,
              sleep_duration_min, sleep_score,
              deep_sleep_min, light_sleep_min, rem_sleep_min, awake_sleep_min,
              avg_overnight_hrv, hrv_status,
              resting_heart_rate,
              total_steps, calories_burned, active_minutes,
              synced_at
            ) VALUES (
              $1, $2,
              $3, $4,
              $5, $6, $7, $8,
              $9, $10,
              $11,
              $12, $13, $14,
              now()
            )
            ON CONFLICT (user_id, date) DO UPDATE SET
              sleep_duration_min = $3,
              sleep_score        = $4,
              deep_sleep_min     = $5,
              light_sleep_min    = $6,
              rem_sleep_min      = $7,
              awake_sleep_min    = $8,
              avg_overnight_hrv  = $9,
              hrv_status         = $10,
              resting_heart_rate = $11,
              synced_at          = now()`,
            [
              userId, dateStr,
              d.durMin, d.score,
              d.deep, d.light, d.rem, d.awake,
              d.hrv, "BALANCED",
              d.rhr,
              8000 + Math.floor(Math.random() * 4000),  // steps
              300 + Math.floor(Math.random() * 200),     // calories
              45 + Math.floor(Math.random() * 30),       // active minutes
            ]
          );
          inserted++;
        }

        res.json({
          ok: true,
          inserted,
          message: `Seeded ${inserted} days of fake Garmin sleep data for user ${userId}. The AI coach will now include sleep history context.`,
        });
      } catch (err: any) {
        console.error("[dev/seed-garmin-sleep]", err);
        res.status(500).json({ error: err.message });
      }
    }
  );

  // ── Background Job Triggers (for Railway cron or external triggers) ────────

  app.post("/api/jobs/scrape", async (req, res) => {
    const secret = req.headers["x-cron-secret"];
    if (secret !== CRON_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const date = (req.body.date as string) ?? todayString();
    scrapeAllLocations(date).catch(console.error);
    res.json({ ok: true, date });
  });

  app.post("/api/jobs/sync-wearables", async (req, res) => {
    const secret = req.headers["x-cron-secret"];
    if (secret !== CRON_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    // would iterate all users in production
    res.json({ ok: true });
  });

  // ── Dashboard summary ──────────────────────────────────────────────────────

  app.get(
    "/api/dashboard",
    requireAuth as any,
    async (req: AuthRequest, res) => {
      try {
        const date = (req.query.date as string) ?? todayString();
        const user = req.user!;

        // Meals
        const meals = await storage.getUserMeals(user.id, date);
        const mealsWithItems = await Promise.all(
          meals.map(async (m) => ({
            ...m,
            items: await storage.getUserMealItems(m.id),
          }))
        );

        // Totals
        const totals = mealsWithItems.reduce(
          (acc, m) => ({
            calories: acc.calories + (m.totalCalories ?? 0),
            protein: acc.protein + (m.totalProtein ?? 0),
            carbs: acc.carbs + (m.totalCarbs ?? 0),
            fat: acc.fat + (m.totalFat ?? 0),
          }),
          { calories: 0, protein: 0, carbs: 0, fat: 0 }
        );

        // Wearable activity
        let burnCalories: number | undefined;
        const activities = await storage.getDailyActivity(user.id, date);
        if (activities.length > 0) {
          burnCalories = activities.reduce(
            (sum, a) => sum + (a.caloriesBurned ?? 0),
            0
          );
        }

        // Recent weight — must be fetched before computeDailyTargets
        const recentWeights = await storage.getWeightLogs(user.id, 7);

        // Targets — pass most recent weight so tier+buffer uses real current weight
        const mostRecentForTargets = recentWeights[0]?.weightKg ?? user.weightKg;
        const targets = computeDailyTargets(user, burnCalories, date, mostRecentForTargets);

        // Recent activity (7 days)
        const recentActivity = await storage.getRecentActivity(user.id, 7);

        // Peak week — today's plan if within 14 days of meet
        // Pass most recent weight for dynamic protocol adjustments
        const mostRecentWeight = mostRecentForTargets;
        let peakWeekToday = null;
        if (user.meetDate) {
          const plan = generatePeakWeekPlan(user, user.meetDate, mostRecentWeight ?? undefined);
          peakWeekToday = plan.find((d) => d.isToday) ?? null;
        }

        // Water cut analysis — uses most recent weight
        const waterCutAnalysis = user.meetDate
          ? analyzeWaterCut(user, mostRecentWeight)
          : null;

        // Water log for today
        const waterLog = await storage.getWaterLog(user.id, date);

        // Water target — available to ALL users with enableWaterTracking
        // Peak week uses waterTargetL from the day's plan (evidence-based per protocol)
        // General users use the weight/sex/age-based formula
        let waterTargetMl: number | null = null;
        if (user.enableWaterTracking) {
          if (peakWeekToday?.waterTargetL) {
            // Use the numeric target from the peak week plan directly
            waterTargetMl = Math.round(peakWeekToday.waterTargetL * 1000);
          } else {
            // General recommendation based on weight, sex, age
            waterTargetMl = calcDailyWaterMl(user);
          }
        }

        res.json({
          date,
          meals: mealsWithItems,
          totals,
          targets,
          activities: recentActivity,
          recentWeights,
          peakWeekToday,
          waterCutAnalysis,
          waterMl: waterLog?.mlLogged ?? 0,
          waterTargetMl,
          enableWaterTracking: user.enableWaterTracking ?? false,
          waterBottles: user.waterBottles ?? [],
          waterUnit: user.waterUnit ?? "oz",
        });
      } catch (err) {
        console.error("[dashboard]", err);
        res.status(500).json({ error: "Failed to get dashboard" });
      }
    }
  );

  return httpServer;
}

/** Remove sensitive fields from user object */
function sanitizeUser(user: any) {
  const { passwordHash, groqApiKeyEncrypted, openrouterApiKeyEncrypted, ...safe } = user;
  return safe;
}
