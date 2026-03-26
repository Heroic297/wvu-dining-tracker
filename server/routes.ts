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
import { computeDailyTargets, generateWaterCutPlan, generatePeakWeekPlan } from "./tdee.js";
import {
  getFitbitAuthUrl,
  exchangeFitbitCode,
  getGarminAuthUrl,
  exchangeGarminCode,
  syncUserWearable,
} from "./wearables.js";
import { z } from "zod";
import { randomUUID } from "crypto";
import crypto from "crypto";

const CRON_SECRET = process.env.CRON_SECRET ?? "cron-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
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
        enableWaterCut: z.boolean().optional(),
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

      const targets = computeDailyTargets(user, burnCalories, date);
      if (!targets) {
        return res.status(400).json({
          error: "Profile incomplete — please finish setup to get targets",
        });
      }

      // Water cut plan if within 7 days of meet
      let waterCutPlan = null;
      if (user.enableWaterCut && user.meetDate) {
        waterCutPlan = generateWaterCutPlan(user, user.meetDate);
      }

      // Peak week plan if within 14 days of meet
      let peakWeekPlan = null;
      if (user.meetDate) {
        const plan = generatePeakWeekPlan(user, user.meetDate);
        if (plan.length > 0) peakWeekPlan = plan;
      }

      res.json({ targets, waterCutPlan, peakWeekPlan });
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

        // 1. Open Food Facts — purpose-built barcode database, free, no key required
        //    Covers millions of packaged goods with per-serving nutrition data
        try {
          const offResp = await axios.get(
            `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(upc)}.json`,
            { timeout: 8000 }
          );

          if (offResp.data?.status === 1) {
            const product = offResp.data.product ?? {};
            const n = product.nutriments ?? {};
            const name = product.product_name || product.product_name_en || "Scanned product";

            // Prefer per-serving values; fall back to per-100g scaled to serving quantity
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
            if (calories) {
              return res.json({
                foodName: name,
                calories,
                proteinG: getVal("proteins_serving",      "proteins_100g"),
                carbsG:   getVal("carbohydrates_serving",  "carbohydrates_100g"),
                fatG:     getVal("fat_serving",            "fat_100g"),
                servingSize: servingLabel,
                source: "usda",   // surface as "USDA database" in the UI — still a verified DB
                confidence: "high",
                breakdown: [],
              });
            }
          }
        } catch (offErr: any) {
          console.warn("[barcode] Open Food Facts lookup failed:", offErr.message);
        }

        // 2. Fallback: ask AI to identify the product by name if known
        //    Pass the UPC so the AI can try to recognise the product
        const result = await lookupNutrition(`UPC ${upc}`);
        if (result && result.source !== "manual_exact") {
          return res.json(result);
        }

        return res.status(404).json({
          error: "Product not found — try typing the food name in the search bar instead.",
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
          source: z.enum(["wvu", "usda", "ai_estimated", "manual_exact"]),
        });

        const data = schema.parse(req.body);

        // Macros are already pre-scaled by the client before sending.
        // servings is stored as metadata only — do NOT multiply again here.
        const scaledItem = {
          userMealId: req.params.mealId as string,
          ...data,
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

        // Targets
        const targets = computeDailyTargets(user, burnCalories, date);

        // Recent weight
        const recentWeights = await storage.getWeightLogs(user.id, 7);

        // Recent activity (7 days)
        const recentActivity = await storage.getRecentActivity(user.id, 7);

        // Peak week — today's plan if within 14 days of meet
        let peakWeekToday = null;
        if (user.meetDate) {
          const plan = generatePeakWeekPlan(user, user.meetDate);
          peakWeekToday = plan.find((d) => d.isToday) ?? null;
        }

        // Water log for today
        const waterLog = await storage.getWaterLog(user.id, date);

        // Recommended water target (ml)
        // Peak week overrides general recommendation
        let waterTargetMl: number | null = null;
        if (user.enableWaterTracking) {
          if (peakWeekToday) {
            // Parse peak week waterL string like "3–4 L" — use midpoint
            const match = peakWeekToday.waterL.match(/([\d.]+)/);
            waterTargetMl = match ? Math.round(parseFloat(match[1]) * 1000) : 3000;
          } else if (user.weightKg && user.heightCm && user.sex) {
            // General: ~35ml/kg bodyweight, adjusted for sex
            const base = user.weightKg * 35;
            waterTargetMl = Math.round(user.sex === "male" ? base * 1.1 : base);
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
          waterMl: waterLog?.mlLogged ?? 0,
          waterTargetMl,
          enableWaterTracking: user.enableWaterTracking ?? false,
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
  const { passwordHash, ...safe } = user;
  return safe;
}
