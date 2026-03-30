/**
 * Nutrition lookup service — v4 (Option C)
 *
 * Pipeline per query:
 *   1. Cache check (skip when forceAi)
 *   2. Classify the query
 *   3. Route:
 *      a. Multi-component meal → AI breakdown prompt
 *      b. Restaurant / chain item → AI with chain-specific published-data prompt
 *      c. Branded / packaged product → Open Food Facts text search → AI fallback
 *      d. Raw whole ingredient (simple, no brand) → USDA Foundation/SR Legacy → AI fallback
 *      e. Everything else → AI direct
 *   4. Cache result
 *
 * Why this works better than previous approaches:
 * - Open Food Facts has 3M+ branded products with exact per-serving label data
 * - USDA Foundation is only used for simple raw ingredients where it excels
 * - AI handles restaurants, complex meals, and anything the databases miss
 * - No more AI-assisted USDA candidate selection (slow, error-prone, rate-limited)
 */
import Groq from "groq-sdk";
import axios from "axios";
import { storage } from "./storage.js";
import type { InsertNutritionCache } from "../shared/schema.js";

const USDA_API_KEY = process.env.USDA_API_KEY || "DEMO_KEY";
const USDA_BASE = "https://api.nal.usda.gov/fdc/v1";
const OFF_BASE = "https://world.openfoodfacts.org/cgi/search.pl";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NutritionComponent {
  item: string;
  quantityStr?: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSize: string;
  confidence: "high" | "medium" | "low";
}

export interface NutritionResult {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSize: string;
  source: "usda" | "usda_branded" | "open_food_facts" | "ai_estimated" | "manual_exact";
  confidence?: string;
  foodName: string;
  breakdown?: NutritionComponent[];
}

// ─── Restaurant chain patterns ────────────────────────────────────────────────

const CHAIN_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /chick.fil.a/i,           name: "Chick-fil-A" },
  { pattern: /mcdonald'?s?/i,          name: "McDonald's" },
  { pattern: /burger king/i,            name: "Burger King" },
  { pattern: /wendy'?s?/i,             name: "Wendy's" },
  { pattern: /subway/i,                 name: "Subway" },
  { pattern: /chipotle/i,              name: "Chipotle Mexican Grill" },
  { pattern: /panera/i,                name: "Panera Bread" },
  { pattern: /taco bell/i,             name: "Taco Bell" },
  { pattern: /domino'?s?/i,            name: "Domino's" },
  { pattern: /pizza hut/i,             name: "Pizza Hut" },
  { pattern: /starbucks/i,             name: "Starbucks" },
  { pattern: /dunkin'?/i,              name: "Dunkin'" },
  { pattern: /popeyes/i,               name: "Popeyes" },
  { pattern: /\bkfc\b/i,               name: "KFC" },
  { pattern: /five guys/i,             name: "Five Guys" },
  { pattern: /shake shack/i,           name: "Shake Shack" },
  { pattern: /raising cane'?s?/i,      name: "Raising Cane's" },
  { pattern: /cook.?out/i,             name: "Cook Out" },
  { pattern: /jersey mike'?s?/i,       name: "Jersey Mike's" },
  { pattern: /jimmy john'?s?/i,        name: "Jimmy John's" },
  { pattern: /firehouse subs?/i,       name: "Firehouse Subs" },
  { pattern: /sheetz/i,                name: "Sheetz" },
  { pattern: /wawa/i,                  name: "Wawa" },
  { pattern: /\bsonic\b/i,             name: "Sonic Drive-In" },
  { pattern: /dairy queen/i,           name: "Dairy Queen" },
  { pattern: /in.n.out/i,              name: "In-N-Out Burger" },
  { pattern: /whataburger/i,           name: "Whataburger" },
  { pattern: /arby'?s?/i,              name: "Arby's" },
  { pattern: /hardee'?s?/i,            name: "Hardee's" },
  { pattern: /bojangles/i,             name: "Bojangles" },
  { pattern: /panda express/i,         name: "Panda Express" },
  { pattern: /olive garden/i,          name: "Olive Garden" },
  { pattern: /applebee'?s?/i,          name: "Applebee's" },
  { pattern: /\bihop\b/i,              name: "IHOP" },
  { pattern: /cracker barrel/i,        name: "Cracker Barrel" },
  { pattern: /red lobster/i,           name: "Red Lobster" },
  { pattern: /texas roadhouse/i,       name: "Texas Roadhouse" },
  { pattern: /outback/i,               name: "Outback Steakhouse" },
  { pattern: /buffalo wild wings/i,    name: "Buffalo Wild Wings" },
  { pattern: /b-?dubs/i,               name: "Buffalo Wild Wings" },
  { pattern: /qdoba/i,                 name: "Qdoba" },
  { pattern: /sweetgreen/i,            name: "Sweetgreen" },
  { pattern: /dave'?s? hot chicken/i,  name: "Dave's Hot Chicken" },
  { pattern: /portillo'?s?/i,          name: "Portillo's" },
  { pattern: /culver'?s?/i,            name: "Culver's" },
  { pattern: /steak 'n shake/i,        name: "Steak 'n Shake" },
  { pattern: /jack.in.the.box/i,       name: "Jack in the Box" },
  { pattern: /carl'?s? jr/i,           name: "Carl's Jr." },
  { pattern: /del taco/i,              name: "Del Taco" },
  { pattern: /el pollo loco/i,         name: "El Pollo Loco" },
  { pattern: /smashburger/i,           name: "Smashburger" },
  { pattern: /freddy'?s?/i,            name: "Freddy's" },
  { pattern: /moe'?s?\s+(southwest|grill)/i, name: "Moe's Southwest Grill" },
];

// ─── Brand signals — routes to Open Food Facts ───────────────────────────────

const BRANDED_SIGNALS = [
  // Known supplement/protein brands
  /\b(fairlife|core power|premier protein|dymatize|optimum nutrition|on gold standard|iso\s*100|myprotein|ghost protein|reign|celsius|body armor|muscle milk|ensure|boost|orgain|garden of life|vega protein|rxbar|quest bar|clif bar|larabar|kind bar|built bar|one bar|pure protein|power crunch|thinkThin|atkins bar|met.rx|cytosport|cytogainer|labrada|bsn syntha|eas lean|kirkland protein)\b/i,
  // Product type signals that imply a packaged product
  /\b(protein shake|protein bar|protein powder|protein drink|meal replacement|nutrition shake|energy bar|granola bar|protein cookie|protein ice cream|halo top|enlightened ice cream)\b/i,
  // Multi-word brand+product patterns
  /\b(greek yogurt|skyr|cottage cheese|string cheese|babybel|laughing cow)\b/i,
];

function isBrandedProduct(q: string): boolean {
  return BRANDED_SIGNALS.some((p) => p.test(q));
}

// ─── Simple whole-food signals — routes to USDA Foundation ───────────────────
// Only route to USDA when the query is a simple raw ingredient with no brand,
// preparation method, or portion specification beyond weight.

const WHOLE_FOOD_PATTERNS = [
  /^(raw |cooked |fresh |frozen )?(chicken|beef|pork|turkey|salmon|tuna|tilapia|shrimp|cod|halibut|sardine|egg|eggs)\b/i,
  /^(raw |cooked |dry )?(white rice|brown rice|oats?|oatmeal|quinoa|lentils?|black beans?|chickpeas?)\b/i,
  /^(raw |fresh )?(broccoli|spinach|kale|romaine|arugula|cabbage|cauliflower|sweet potato|potato|banana|apple|orange|avocado|blueberries?|strawberries?|almonds?|walnuts?|cashews?)\b/i,
  /^(whole |skim |2% |fat.?free )?milk\b/i,
  /^(extra virgin |virgin )?olive oil\b/i,
  /^(salted |unsalted )?butter\b/i,
];

function isSimpleWholeFoodQuery(q: string): boolean {
  const normalised = q.toLowerCase().trim();
  // Must NOT have brand name, restaurant name, or complex modifiers
  if (isBrandedProduct(normalised)) return false;
  if (CHAIN_PATTERNS.some(({ pattern }) => pattern.test(normalised))) return false;
  return WHOLE_FOOD_PATTERNS.some((p) => p.test(normalised));
}

// ─── Text preprocessing ───────────────────────────────────────────────────────

const UNIT_NORMALISE: Array<[RegExp, string]> = [
  [/\b(oz|ounce|ounces)\b/gi, "oz"],
  [/\b(lb|lbs|pound|pounds)\b/gi, "lbs"],
  [/\b(g|gr|gram|grams)\b/gi, "g"],
  [/\b(kg|kilogram|kilograms)\b/gi, "kg"],
  [/\b(ml|milliliter|milliliters)\b/gi, "ml"],
  [/\b(tbsp|tablespoon|tablespoons)\b/gi, "tbsp"],
  [/\b(tsp|teaspoon|teaspoons)\b/gi, "tsp"],
  [/\b(cups?)\b/gi, "cup"],
];

const MULTI_SEPARATORS = /\band\b|,|&|\bwith\b|\bplus\b|\+/i;

function hasQuantity(q: string): boolean {
  return /\d+(\.\d+)?\s*(g|oz|ml|lb|lbs|kg|cup|tbsp|tsp|piece|slice|serving)\b/i.test(q);
}

function splitComponents(query: string): string[] {
  return query
    .split(MULTI_SEPARATORS)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);
}

interface ParsedQuery {
  raw: string;
  normalised: string;
  cleanedQuery: string;
  chain: string | null;
  isBranded: boolean;
  isWholeFoodSimple: boolean;
  isMultiComponent: boolean;
  hasExplicitQuantity: boolean;
  components: string[];
}

export function preprocessQuery(raw: string): ParsedQuery {
  let cleaned = raw.trim();
  for (const [re, rep] of UNIT_NORMALISE) cleaned = cleaned.replace(re, rep);
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  const normalised = cleaned.toLowerCase();

  let chain: string | null = null;
  for (const { pattern, name } of CHAIN_PATTERNS) {
    if (pattern.test(normalised)) { chain = name; break; }
  }

  const isBranded = isBrandedProduct(normalised);
  const isWholeFoodSimple = isSimpleWholeFoodQuery(normalised);

  const isMultiComponent = !chain && !isBranded && MULTI_SEPARATORS.test(normalised);
  const components = isMultiComponent ? splitComponents(cleaned) : [cleaned];

  return {
    raw: raw.trim(),
    normalised,
    cleanedQuery: cleaned,
    chain,
    isBranded,
    isWholeFoodSimple,
    isMultiComponent,
    hasExplicitQuantity: hasQuantity(normalised),
    components,
  };
}

// ─── Open Food Facts lookup ───────────────────────────────────────────────────

async function lookupOpenFoodFacts(query: string): Promise<NutritionResult | null> {
  try {
    const resp = await axios.get(OFF_BASE, {
      params: {
        search_terms: query,
        json: 1,
        page_size: 8,
        fields: "product_name,brands,nutriments,serving_size,serving_quantity,quantity",
        lc: "en",
        cc: "us",
      },
      timeout: 8000,
      headers: { "User-Agent": "MacroApp/1.0 (nutrition tracker; contact@macroapp.com)" },
    });

    const products: any[] = resp.data?.products ?? [];

    // Filter: must have calories > 0 and prefer per-serving data
    const valid = products.filter((p) => {
      const n = p.nutriments ?? {};
      return (
        (n["energy-kcal_serving"] != null && n["energy-kcal_serving"] > 0) ||
        (n["energy-kcal_100g"] != null && n["energy-kcal_100g"] > 0)
      );
    });

    if (!valid.length) return null;

    const p = valid[0];
    const n = p.nutriments ?? {};

    // Strongly prefer per-serving values — that's what users expect
    const hasServingData = n["energy-kcal_serving"] != null && n["energy-kcal_serving"] > 0;

    const calories = hasServingData ? n["energy-kcal_serving"] : n["energy-kcal_100g"];
    const proteinG = hasServingData ? (n["proteins_serving"] ?? 0) : (n["proteins_100g"] ?? 0);
    const carbsG   = hasServingData ? (n["carbohydrates_serving"] ?? 0) : (n["carbohydrates_100g"] ?? 0);
    const fatG     = hasServingData ? (n["fat_serving"] ?? 0) : (n["fat_100g"] ?? 0);

    const servingSize = hasServingData
      ? (p.serving_size ?? "1 serving")
      : "100g";

    const brand = p.brands ? `${p.brands.split(",")[0].trim()} ` : "";
    const foodName = `${brand}${p.product_name ?? query}`.trim();

    console.log(`[nutrition] Open Food Facts match: ${foodName} (${calories} kcal${hasServingData ? "/serving" : "/100g"})`);

    return {
      calories: Math.round(calories),
      proteinG: Math.round(proteinG * 10) / 10,
      carbsG:   Math.round(carbsG   * 10) / 10,
      fatG:     Math.round(fatG     * 10) / 10,
      servingSize,
      source: "open_food_facts",
      confidence: "high",
      foodName,
    };
  } catch (err: any) {
    console.warn("[nutrition] Open Food Facts lookup failed:", err.message);
    return null;
  }
}

// ─── USDA Foundation lookup ───────────────────────────────────────────────────

async function lookupUsda(foodName: string): Promise<NutritionResult | null> {
  try {
    const resp = await axios.get(`${USDA_BASE}/foods/search`, {
      params: {
        query: foodName,
        pageSize: 5,
        dataType: "Foundation,SR Legacy",
        api_key: USDA_API_KEY,
      },
      timeout: 8000,
    });

    const foods: any[] = resp.data?.foods ?? [];

    // Filter out zero-calorie results and pick first valid one
    const valid = foods.filter((f) => {
      const cal = (f.foodNutrients ?? []).find(
        (n: any) => n.nutrientNumber === "208" || n.nutrientId === 1008
      );
      return cal?.value > 0;
    });

    if (!valid.length) return null;

    const food = valid[0];
    const getNutrient = (...ids: string[]) => {
      for (const id of ids) {
        const found = (food.foodNutrients ?? []).find(
          (n: any) => n.nutrientNumber === id || String(n.nutrientId) === id
        );
        if (found?.value != null && found.value > 0) return Math.round(found.value * 10) / 10;
      }
      return 0;
    };

    const calories = getNutrient("208", "1008");
    const proteinG = getNutrient("203", "1003");
    const carbsG   = getNutrient("205", "1005");
    const fatG     = getNutrient("204", "1004");

    if (!calories) return null;

    console.log(`[nutrition] USDA Foundation match: ${food.description} (${calories} kcal/100g)`);

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

// ─── AI estimation ────────────────────────────────────────────────────────────

function buildSystemPrompt(parsed: ParsedQuery): string {
  const base = `You are a professional sports dietitian with encyclopedic knowledge of:
- Official published nutrition facts for every major US restaurant chain
- USDA nutritional data for whole foods and raw ingredients
- Exact label data for branded packaged foods and supplements
- Bodybuilding and powerlifting nutrition standards

Accuracy is critical — this data is used for athletic nutrition planning.`;

  const jsonOnly = `Return ONLY valid JSON. No markdown, no code fences, no explanation.`;

  const singleSchema = `{
  "calories": <integer>,
  "proteinG": <number, 1 decimal>,
  "carbsG": <number, 1 decimal>,
  "fatG": <number, 1 decimal>,
  "servingSize": "<specific size>",
  "confidence": "<'high'|'medium'|'low'>",
  "breakdown": []
}`;

  const componentSchema = `{
  "item": "<name>", "calories": <int>, "proteinG": <num>,
  "carbsG": <num>, "fatG": <num>, "servingSize": "<size>", "confidence": "<level>"
}`;

  // Restaurant chain
  if (parsed.chain) {
    return `${base}

TASK: Return exact macros for this ${parsed.chain} menu item using their OFFICIAL PUBLISHED nutrition facts.
Use the exact values from ${parsed.chain}'s published nutrition information.

${jsonOnly}

${parsed.isMultiComponent
  ? `Return total + breakdown:
{
  "calories": <total>, "proteinG": <total>, "carbsG": <total>, "fatG": <total>,
  "servingSize": "<description>", "confidence": "high",
  "breakdown": [${componentSchema}, ...]
}`
  : singleSchema}`;
  }

  // Branded packaged product
  if (parsed.isBranded) {
    return `${base}

TASK: Return the EXACT label nutrition facts for this specific branded product.

CRITICAL RULES:
- Return macros for the ENTIRE CONTAINER as sold (full bottle, full bar, full package)
- Single-serve items (protein shakes, bars): return for the whole item, NOT per 100g
- Multi-serve items (protein powder tubs, large boxes): return per 1 scoop/1 serving
- Use the ACTUAL label values — do not estimate
- Core Power Elite (any flavor): 230 kcal, 42g protein, 9g carbs, 3.5g fat per bottle
- Premier Protein shake: 160 kcal, 30g protein, 5g carbs, 3g fat per bottle
- RXBAR Chocolate Sea Salt: 210 kcal, 12g protein, 23g carbs, 9g fat per bar
- Set confidence "low" if you are not certain of the exact label values

${jsonOnly}

${singleSchema}`;
  }

  // Multi-component meal
  if (parsed.isMultiComponent) {
    return `${base}

TASK: Return combined total AND per-component breakdown for a multi-item meal.
For each component, assume a standard adult athlete portion if no quantity given.
Use USDA values for whole foods.

${jsonOnly}

Return:
{
  "calories": <sum>, "proteinG": <sum>, "carbsG": <sum>, "fatG": <sum>,
  "servingSize": "<overall description>", "confidence": "<level>",
  "breakdown": [${componentSchema}, ...]
}`;
  }

  // Explicit weight/volume
  if (parsed.hasExplicitQuantity) {
    return `${base}

TASK: Calculate precise macros for the exact quantity specified.
Use USDA nutritional density values scaled precisely to the amount given.
Reference densities per 100g cooked: chicken breast 165kcal/31g P; salmon 208kcal/20g P;
white rice 130kcal/2.7g P/28g C; broccoli 34kcal/2.8g P/7g C; egg (large whole) 78kcal/6g P.

${jsonOnly}

${singleSchema}`;
  }

  // Generic fallback
  return `${base}

TASK: Return macros for one standard serving of the described food.
- For whole foods: use USDA per-100g values, state "100g" as serving size
- For ambiguous items: assume most common adult portion
- State the serving size explicitly

${jsonOnly}

${singleSchema}`;
}

interface RawAIResponse {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSize: string;
  confidence: string;
  breakdown?: Array<{
    item: string; calories: number; proteinG: number;
    carbsG: number; fatG: number; servingSize?: string; confidence?: string;
  }>;
}

async function estimateWithAI(parsed: ParsedQuery): Promise<NutritionResult | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const groq = new Groq({ apiKey });

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: buildSystemPrompt(parsed) },
        { role: "user",   content: `Nutrition for: "${parsed.cleanedQuery}"` },
      ],
      temperature: 0.05,
      max_tokens: 1200,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const p = JSON.parse(jsonMatch[0]) as RawAIResponse;

    const breakdown: NutritionComponent[] = (p.breakdown ?? []).map((b) => ({
      item: b.item,
      calories: Math.round(b.calories),
      proteinG: Math.round(b.proteinG * 10) / 10,
      carbsG:   Math.round(b.carbsG   * 10) / 10,
      fatG:     Math.round(b.fatG     * 10) / 10,
      servingSize: b.servingSize ?? "1 serving",
      confidence: (b.confidence as NutritionComponent["confidence"]) ?? "medium",
    }));

    return {
      calories: Math.round(p.calories),
      proteinG: Math.round(p.proteinG * 10) / 10,
      carbsG:   Math.round(p.carbsG   * 10) / 10,
      fatG:     Math.round(p.fatG     * 10) / 10,
      servingSize: p.servingSize ?? "1 serving",
      source: "ai_estimated",
      confidence: p.confidence ?? "medium",
      foodName: parsed.cleanedQuery,
      breakdown,
    };
  } catch (err: any) {
    console.error("[nutrition] Groq AI error:", err.message);
    return null;
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────────

function normalizeKey(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

export async function lookupNutrition(
  foodName: string,
  options: { forceAi?: boolean } = {}
): Promise<NutritionResult | null> {
  const parsed = preprocessQuery(foodName);
  const key = normalizeKey(parsed.cleanedQuery);

  // 1. Cache check
  if (!options.forceAi) {
    const cached = await storage.getNutritionCache(key);
    if (cached) {
      return {
        calories:    cached.calories    ?? 0,
        proteinG:   cached.proteinG    ?? 0,
        carbsG:     cached.carbsG      ?? 0,
        fatG:       cached.fatG        ?? 0,
        servingSize: cached.servingSize ?? "1 serving",
        source: (cached.source as NutritionResult["source"]) ?? "ai_estimated",
        confidence: cached.confidence  ?? undefined,
        foodName: cached.foodName,
      };
    }
  }

  let result: NutritionResult | null = null;

  // 2a. Multi-component meal → AI breakdown
  if (parsed.isMultiComponent) {
    console.log(`[nutrition] Route: multi-component AI → "${parsed.cleanedQuery}"`);
    result = await estimateWithAI(parsed);
  }

  // 2b. Restaurant chain → AI with chain prompt
  else if (parsed.chain) {
    console.log(`[nutrition] Route: chain AI (${parsed.chain}) → "${parsed.cleanedQuery}"`);
    result = await estimateWithAI(parsed);
  }

  // 2c. Branded/packaged product → Open Food Facts → AI fallback
  else if (parsed.isBranded) {
    console.log(`[nutrition] Route: branded → Open Food Facts → "${parsed.cleanedQuery}"`);
    result = await lookupOpenFoodFacts(parsed.cleanedQuery);
    if (!result) {
      console.log(`[nutrition] OFF miss, falling back to AI for "${parsed.cleanedQuery}"`);
      result = await estimateWithAI(parsed);
    }
  }

  // 2d. Simple whole food → USDA Foundation → AI fallback
  else if (parsed.isWholeFoodSimple) {
    console.log(`[nutrition] Route: whole food USDA → "${parsed.cleanedQuery}"`);
    result = await lookupUsda(parsed.cleanedQuery);
    if (!result) {
      console.log(`[nutrition] USDA miss, falling back to AI for "${parsed.cleanedQuery}"`);
      result = await estimateWithAI(parsed);
    }
  }

  // 2e. Everything else → AI direct
  else {
    console.log(`[nutrition] Route: AI direct → "${parsed.cleanedQuery}"`);
    result = await estimateWithAI(parsed);
  }

  // 3. Cache
  if (result) {
    const entry: InsertNutritionCache = {
      foodName: result.foodName,
      normalizedKey: key,
      calories:  result.calories,
      proteinG:  result.proteinG,
      carbsG:    result.carbsG,
      fatG:      result.fatG,
      servingSize: result.servingSize,
      source:    result.source,
      confidence: result.confidence,
    };
    await storage.upsertNutritionCache(entry).catch((err) =>
      console.warn("[nutrition] Cache write failed:", err.message)
    );
  }

  return result;
}
