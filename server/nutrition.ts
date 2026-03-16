/**
 * Nutrition lookup service.
 *
 * Priority order:
 * 1. Local nutrition cache (previously looked up)
 * 2. USDA FoodData Central API (free, no key required for basic search)
 * 3. Groq Qwen 3 32B AI estimation (fallback)
 *
 * Results from USDA and AI are cached in the DB for future reuse.
 */
import axios from "axios";
import Groq from "groq-sdk";
import { storage } from "./storage.js";
import type { InsertNutritionCache } from "../shared/schema.js";

const USDA_API_KEY = process.env.USDA_API_KEY || "DEMO_KEY"; // Free demo key: 30 req/hr
const USDA_BASE = "https://api.nal.usda.gov/fdc/v1";

interface NutritionResult {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSize: string;
  source: "usda" | "ai_estimated" | "manual_exact";
  confidence?: string;
  foodName: string;
}

/** Normalize a food name for cache keying */
function normalizeKey(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Extract nutrient value from USDA FoodNutrients array */
function getUsdaNutrient(
  nutrients: Array<{ nutrientNumber?: string; nutrientName?: string; value?: number }>,
  ...ids: string[]
): number {
  for (const id of ids) {
    const found = nutrients.find(
      (n) => n.nutrientNumber === id
    );
    if (found?.value != null) return Math.round(found.value * 10) / 10;
  }
  return 0;
}

/** Search USDA FoodData Central for a food item */
async function lookupUsda(foodName: string): Promise<NutritionResult | null> {
  try {
    const resp = await axios.get(`${USDA_BASE}/foods/search`, {
      params: {
        query: foodName,
        pageSize: 3,
        dataType: "Survey (FNDDS),SR Legacy",
        api_key: USDA_API_KEY,
      },
      timeout: 8000,
    });

    const foods = resp.data?.foods ?? [];
    if (!foods.length) return null;

    const food = foods[0];
    const nutrients = food.foodNutrients ?? [];

    // USDA nutrient IDs: 208=Energy(kcal), 203=Protein, 205=Carbs, 204=Fat
    const calories = getUsdaNutrient(nutrients, "208");
    const proteinG = getUsdaNutrient(nutrients, "203");
    const carbsG = getUsdaNutrient(nutrients, "205");
    const fatG = getUsdaNutrient(nutrients, "204");

    if (!calories) return null;

    return {
      calories,
      proteinG,
      carbsG,
      fatG,
      servingSize: "100g (USDA standard)",
      source: "usda",
      confidence: "high",
      foodName: food.description ?? foodName,
    };
  } catch (err: any) {
    console.warn("[nutrition] USDA lookup failed:", err.message);
    return null;
  }
}

/** Estimate nutrition via Groq Qwen 3 32B */
async function estimateWithAI(foodName: string): Promise<NutritionResult | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn("[nutrition] GROQ_API_KEY not set — skipping AI estimation");
    return null;
  }

  const groq = new Groq({ apiKey });

  const systemPrompt = `You are a nutrition database assistant. Given a food item name, estimate its nutritional content for a typical single serving.
Return ONLY valid JSON with this exact structure, no markdown, no explanation:
{
  "calories": <integer>,
  "proteinG": <number with 1 decimal>,
  "carbsG": <number with 1 decimal>,
  "fatG": <number with 1 decimal>,
  "servingSize": "<string describing the serving, e.g. '1 cup (240ml)'>",
  "confidence": "<'high' | 'medium' | 'low'>"
}`;

  const userPrompt = `Food item: "${foodName}"
Context: Typical serving as would be found in a US college dining hall.
Provide realistic nutritional estimates for a single standard serving.`;

  try {
    const completion = await groq.chat.completions.create({
      model: "qwen-qwq-32b",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 300,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";

    // Extract JSON from response (handle markdown code blocks if present)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[nutrition] AI returned non-JSON:", raw.slice(0, 200));
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      calories: number;
      proteinG: number;
      carbsG: number;
      fatG: number;
      servingSize: string;
      confidence: string;
    };

    return {
      calories: Math.round(parsed.calories),
      proteinG: Math.round(parsed.proteinG * 10) / 10,
      carbsG: Math.round(parsed.carbsG * 10) / 10,
      fatG: Math.round(parsed.fatG * 10) / 10,
      servingSize: parsed.servingSize ?? "1 serving",
      source: "ai_estimated",
      confidence: parsed.confidence ?? "medium",
      foodName,
    };
  } catch (err: any) {
    console.error("[nutrition] Groq AI error:", err.message);
    return null;
  }
}

/**
 * Main nutrition lookup entry point.
 * Checks cache → USDA → Groq AI → null
 */
export async function lookupNutrition(
  foodName: string
): Promise<NutritionResult | null> {
  const key = normalizeKey(foodName);

  // 1. Check cache
  const cached = await storage.getNutritionCache(key);
  if (cached) {
    return {
      calories: cached.calories ?? 0,
      proteinG: cached.proteinG ?? 0,
      carbsG: cached.carbsG ?? 0,
      fatG: cached.fatG ?? 0,
      servingSize: cached.servingSize ?? "1 serving",
      source: (cached.source as NutritionResult["source"]) ?? "ai_estimated",
      confidence: cached.confidence ?? undefined,
      foodName: cached.foodName,
    };
  }

  // 2. Try USDA
  let result = await lookupUsda(foodName);

  // 3. Fallback to AI
  if (!result) {
    result = await estimateWithAI(foodName);
  }

  // 4. Cache result if found
  if (result) {
    const entry: InsertNutritionCache = {
      foodName: result.foodName,
      normalizedKey: key,
      calories: result.calories,
      proteinG: result.proteinG,
      carbsG: result.carbsG,
      fatG: result.fatG,
      servingSize: result.servingSize,
      source: result.source,
      confidence: result.confidence,
    };
    await storage.upsertNutritionCache(entry).catch((err) =>
      console.warn("[nutrition] Cache write failed:", err.message)
    );
  }

  return result;
}
