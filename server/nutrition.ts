/**
 * Nutrition lookup service.
 *
 * Routing logic:
 * 1. Local DB cache (exact match on normalized key)
 * 2. Simple single ingredients → USDA FoodData Central (precise for raw foods)
 * 3. Everything else → Groq llama-3.3-70b-versatile AI estimation
 *    - Restaurant meals ("Chick-fil-A spicy deluxe with pepperjack...")
 *    - Weighted portions ("200g chicken breast")
 *    - Multi-item combo orders
 *
 * AI model choice: llama-3.3-70b-versatile via Groq
 *   - Extensive knowledge of US restaurant menus and branded foods
 *   - Accurate for complex descriptive queries USDA can't handle
 *   - Fast inference via Groq (~1-2s)
 */
import Groq from "groq-sdk";
import axios from "axios";
import { storage } from "./storage.js";
import type { InsertNutritionCache } from "../shared/schema.js";

const USDA_API_KEY = process.env.USDA_API_KEY || "DEMO_KEY";
const USDA_BASE = "https://api.nal.usda.gov/fdc/v1";

export interface NutritionResult {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSize: string;
  source: "usda" | "ai_estimated" | "manual_exact";
  confidence?: string;
  foodName: string;
  breakdown?: Array<{ item: string; calories: number; proteinG: number; carbsG: number; fatG: number }>;
}

function normalizeKey(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Detect if a query is "complex" — restaurant order, multi-item, weighted portion.
 * These go straight to AI; USDA won't give accurate results for them.
 */
function isComplexQuery(query: string): boolean {
  const q = query.toLowerCase();

  // Multi-word restaurant items or combos
  const restaurantKeywords = [
    "chick-fil-a", "chick fil a", "mcdonald", "burger king", "wendy", "subway",
    "chipotle", "panera", "taco bell", "domino", "pizza hut", "starbucks",
    "dunkin", "popeyes", "kfc", "five guys", "shake shack", "raising cane",
    "cook out", "cookout", "jersey mike", "jimmy john", "firehouse",
  ];
  if (restaurantKeywords.some((r) => q.includes(r))) return true;

  // Multi-item orders (contains "and", "with", comma-separated items)
  if (/\band\b/.test(q) || q.includes(",") || /\bwith\b/.test(q)) return true;

  // Weighted portions (e.g. "200g chicken", "6oz steak")
  if (/\d+\s*(g|oz|ml|lb|lbs|cup|tbsp|tsp)\b/.test(q)) return true;

  // Descriptive modifiers that USDA can't resolve
  if (/\b(spicy|grilled|fried|baked|crispy|smoked|bbq|buffalo|ranch)\b/.test(q)) return true;

  return false;
}

function getUsdaNutrient(
  nutrients: Array<{ nutrientNumber?: string; value?: number }>,
  ...ids: string[]
): number {
  for (const id of ids) {
    const found = nutrients.find((n) => n.nutrientNumber === id);
    if (found?.value != null) return Math.round(found.value * 10) / 10;
  }
  return 0;
}

async function lookupUsda(foodName: string): Promise<NutritionResult | null> {
  try {
    const resp = await axios.get(`${USDA_BASE}/foods/search`, {
      params: {
        query: foodName,
        pageSize: 3,
        dataType: "Foundation,SR Legacy",
        api_key: USDA_API_KEY,
      },
      timeout: 8000,
    });

    const foods = resp.data?.foods ?? [];
    if (!foods.length) return null;

    const food = foods[0];
    const nutrients = food.foodNutrients ?? [];

    const calories = getUsdaNutrient(nutrients, "208");
    const proteinG = getUsdaNutrient(nutrients, "203");
    const carbsG   = getUsdaNutrient(nutrients, "205");
    const fatG     = getUsdaNutrient(nutrients, "204");

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

async function estimateWithAI(foodName: string): Promise<NutritionResult | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.warn("[nutrition] GROQ_API_KEY not set — skipping AI estimation");
    return null;
  }

  const groq = new Groq({ apiKey });

  const systemPrompt = `You are a professional sports dietitian and nutrition database with expert knowledge of:
- US restaurant chains and their exact menu item nutritional data (Chick-fil-A, McDonald's, Chipotle, etc.)
- USDA nutritional data for whole foods and ingredients
- Accurate calorie and macro estimation for weighted portions (e.g. "200g chicken breast")
- Complex meal orders with multiple components

When given a food query, return ONLY valid JSON with NO markdown formatting, NO code blocks, NO explanation.

For simple foods or weighted portions, return:
{
  "calories": <integer, total for the described portion>,
  "proteinG": <number, 1 decimal>,
  "carbsG": <number, 1 decimal>,
  "fatG": <number, 1 decimal>,
  "servingSize": "<concise description of the portion>",
  "confidence": "<'high' | 'medium' | 'low'>",
  "breakdown": []
}

For restaurant orders or multi-item meals, return the TOTAL and a per-item breakdown:
{
  "calories": <integer, SUM of all items>,
  "proteinG": <number, SUM of all items>,
  "carbsG": <number, SUM of all items>,
  "fatG": <number, SUM of all items>,
  "servingSize": "<description of the full order>",
  "confidence": "<'high' | 'medium' | 'low'>",
  "breakdown": [
    { "item": "<item name>", "calories": <int>, "proteinG": <num>, "carbsG": <num>, "fatG": <num> },
    ...
  ]
}

Use your knowledge of actual restaurant nutrition facts. For Chick-fil-A, McDonald's, etc., use their official published numbers.
For weighted portions like "200g chicken breast", use precise USDA values (cooked chicken breast = ~165 kcal/100g, 31g protein/100g).
Be accurate — this data is used for athletic nutrition planning.`;

  const userPrompt = `Estimate the nutritional content for: "${foodName}"`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 600,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";

    // Strip markdown code fences if present
    const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
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
      breakdown?: Array<{ item: string; calories: number; proteinG: number; carbsG: number; fatG: number }>;
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
      breakdown: parsed.breakdown ?? [],
    };
  } catch (err: any) {
    console.error("[nutrition] Groq AI error:", err.message);
    return null;
  }
}

/**
 * Main nutrition lookup entry point.
 * Cache → (USDA for simple | AI for complex) → AI fallback → null
 */
export async function lookupNutrition(foodName: string): Promise<NutritionResult | null> {
  const key = normalizeKey(foodName);

  // 1. Cache hit
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

  // 2. Route: simple foods → USDA first, complex → AI directly
  let result: NutritionResult | null = null;

  if (isComplexQuery(foodName)) {
    // Complex query — go straight to AI for accuracy
    result = await estimateWithAI(foodName);
  } else {
    // Simple food — try USDA, fall back to AI
    result = await lookupUsda(foodName);
    if (!result) {
      result = await estimateWithAI(foodName);
    }
  }

  // 3. Cache result
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
