/**
 * Nutrition lookup service — v3
 *
 * Pipeline (in order):
 *   1. Cache check (skip when forceAi)
 *   2. Text preprocessing — normalise, detect intent, classify query type
 *   3. Branded product search (USDA Branded Foods) — protein shakes, packaged foods, etc.
 *      → AI selects the best match from top candidates (avoids false positives)
 *   4. Whole food / ingredient search (USDA Foundation + SR Legacy)
 *      → AI selects best match from candidates
 *   5. Restaurant / chain lookup → AI with chain-specific published-data prompt
 *   6. Pure AI estimation fallback — generic foods, homemade meals, anything else
 *
 * The key insight: USDA has extensive branded + restaurant data but its text
 * search returns noisy results. We fetch the top N candidates and let the AI
 * pick the correct match rather than blindly taking result[0].
 *
 * AI model: llama-3.3-70b-versatile via Groq
 * Temperature: 0.05 — near-deterministic for reproducibility
 */
import Groq from "groq-sdk";
import axios from "axios";
import { storage } from "./storage.js";
import type { InsertNutritionCache } from "../shared/schema.js";

const USDA_API_KEY = process.env.USDA_API_KEY || "DEMO_KEY";
const USDA_BASE = "https://api.nal.usda.gov/fdc/v1";

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
  source: "usda" | "usda_branded" | "ai_estimated" | "manual_exact";
  confidence?: string;
  foodName: string;
  breakdown?: NutritionComponent[];
}

// ─── Known restaurant chains ──────────────────────────────────────────────────

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
  { pattern: /sonic\b/i,               name: "Sonic Drive-In" },
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
  { pattern: /moe'?s?/i,               name: "Moe's Southwest Grill" },
  { pattern: /sweetgreen/i,            name: "Sweetgreen" },
  { pattern: /dave'?s? hot chicken/i,  name: "Dave's Hot Chicken" },
  { pattern: /raising cane/i,          name: "Raising Cane's" },
  { pattern: /portillo'?s?/i,          name: "Portillo's" },
  { pattern: /culver'?s?/i,            name: "Culver's" },
  { pattern: /steak 'n shake/i,        name: "Steak 'n Shake" },
  { pattern: /jack.in.the.box/i,       name: "Jack in the Box" },
  { pattern: /carl'?s jr/i,            name: "Carl's Jr." },
  { pattern: /del taco/i,              name: "Del Taco" },
  { pattern: /el pollo loco/i,         name: "El Pollo Loco" },
  { pattern: /habit burger/i,          name: "The Habit Burger Grill" },
  { pattern: /smashburger/i,           name: "Smashburger" },
  { pattern: /freddy'?s?/i,            name: "Freddy's Frozen Custard" },
];

// ─── Text preprocessing ───────────────────────────────────────────────────────

interface ParsedQuery {
  raw: string;
  normalised: string;
  chain: string | null;
  isBrandedProduct: boolean;
  isMultiComponent: boolean;
  hasExplicitQuantity: boolean;
  components: string[];
  cleanedQuery: string;
}

const UNIT_NORMALISE: Array<[RegExp, string]> = [
  [/\b(oz|ounce|ounces)\b/gi, "oz"],
  [/\b(lb|lbs|pound|pounds)\b/gi, "lbs"],
  [/\b(g|gr|gram|grams)\b/gi, "g"],
  [/\b(kg|kilogram|kilograms)\b/gi, "kg"],
  [/\b(ml|milliliter|milliliters)\b/gi, "ml"],
  [/\b(tbsp|tablespoon|tablespoons)\b/gi, "tbsp"],
  [/\b(tsp|teaspoon|teaspoons)\b/gi, "tsp"],
  [/\b(cups?)\b/gi, "cup"],
  [/\b(slice|slices|piece|pieces|pc|pcs)\b/gi, "piece"],
];

const SIZE_NORMALISE: Array<[RegExp, string]> = [
  [/\b(sm|small)\b/gi, "small"],
  [/\b(med|medium|regular|reg)\b/gi, "medium"],
  [/\b(lg|large)\b/gi, "large"],
  [/\b(xl|extra.large)\b/gi, "extra large"],
];

const MULTI_SEPARATORS = /\band\b|,|&|\bwith\b|\bplus\b|\+/i;

/** Brand name signals — suggests a packaged/branded product */
const BRANDED_SIGNALS = [
  // Protein/supplement brands
  /\b(core power|fairlife|premier protein|dymatize|optimum nutrition|on gold standard|iso\s*100|myprotein|ghost|reign|celsius|monster|red bull|gatorade|powerade|body armor|vitamin water)\b/i,
  // Packaged food brands
  /\b(kind bar|rxbar|quest|clif|larabar|nature valley|granola bar|protein bar|protein shake|muscle milk|ensure|boost|orgain|garden of life|vega|naked juice|odwalla)\b/i,
  /\b(elite|advanced|isolate|whey|casein|mass gainer|pre.?workout|bcaa|creatine)\b/i,
  // Generic branded signals
  /\b(original|flavor|vanilla|chocolate|strawberry|cookies.?(and|&|n).?cream)\s+(flavor|protein|shake|bar|powder)/i,
];

function isBrandedProductQuery(q: string): boolean {
  return BRANDED_SIGNALS.some((p) => p.test(q));
}

function hasQuantity(q: string): boolean {
  return /\d+(\.\d+)?\s*(g|oz|ml|lb|lbs|kg|cup|tbsp|tsp|piece|slice|serving)\b/i.test(q) ||
    /\b(a|one|two|three|four|five|half|quarter)\s+(cup|scoop|piece|slice|serving)\b/i.test(q);
}

function splitComponents(query: string): string[] {
  return query
    .split(MULTI_SEPARATORS)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);
}

export function preprocessQuery(raw: string): ParsedQuery {
  let cleaned = raw.trim();
  for (const [re, rep] of UNIT_NORMALISE) cleaned = cleaned.replace(re, rep);
  for (const [re, rep] of SIZE_NORMALISE) cleaned = cleaned.replace(re, rep);
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  const normalised = cleaned.toLowerCase();

  let chain: string | null = null;
  for (const { pattern, name } of CHAIN_PATTERNS) {
    if (pattern.test(normalised)) { chain = name; break; }
  }

  const isBrandedProduct = isBrandedProductQuery(normalised);

  const isMultiComponent = MULTI_SEPARATORS.test(normalised) || (
    normalised.split(/\s+/).length >= 3 &&
    !hasQuantity(normalised) &&
    !chain &&
    !isBrandedProduct &&
    !/(sauce|dressing|seasoned|grilled|baked|fried|crispy|spicy|smoked)/i.test(normalised)
  );

  const components = isMultiComponent ? splitComponents(cleaned) : [cleaned];

  return {
    raw: raw.trim(),
    normalised,
    chain,
    isBrandedProduct,
    isMultiComponent,
    hasExplicitQuantity: hasQuantity(normalised),
    components,
    cleanedQuery: cleaned,
  };
}

// ─── USDA helpers ─────────────────────────────────────────────────────────────

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

interface UsdaCandidate {
  fdcId: number;
  description: string;
  brandOwner?: string;
  brandName?: string;
  ingredients?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  dataType: string;
  foodNutrients: Array<{ nutrientNumber?: string; value?: number }>;
}

/**
 * Search USDA for candidates across specified data types.
 * Returns up to `limit` candidates for AI selection.
 */
async function searchUsdaCandidates(
  query: string,
  dataTypes: string,
  limit = 6
): Promise<UsdaCandidate[]> {
  try {
    const resp = await axios.get(`${USDA_BASE}/foods/search`, {
      params: {
        query,
        pageSize: limit,
        dataType: dataTypes,
        api_key: USDA_API_KEY,
      },
      timeout: 8000,
    });
    return resp.data?.foods ?? [];
  } catch (err: any) {
    console.warn(`[nutrition] USDA search failed (${dataTypes}):`, err.message);
    return [];
  }
}

/**
 * Fetch full details for a specific fdcId including per-serving nutrients.
 */
async function fetchUsdaById(fdcId: number): Promise<UsdaCandidate | null> {
  try {
    const resp = await axios.get(`${USDA_BASE}/food/${fdcId}`, {
      params: { api_key: USDA_API_KEY },
      timeout: 8000,
    });
    return resp.data ?? null;
  } catch (err: any) {
    console.warn(`[nutrition] USDA fdcId lookup failed:`, err.message);
    return null;
  }
}

function extractNutrientsFromCandidate(food: UsdaCandidate): {
  calories: number; proteinG: number; carbsG: number; fatG: number; servingSize: string;
} {
  const label = (food as any).labelNutrients;

  // Prefer labelNutrients — these are exact per-serving values from the product label
  if (label?.calories?.value != null) {
    const servingSizeStr = food.servingSize
      ? `${food.servingSize} ${food.servingSizeUnit ?? ""}`.trim()
      : "1 serving";
    return {
      calories: Math.round(label.calories.value),
      proteinG: Math.round((label.protein?.value ?? 0) * 10) / 10,
      carbsG:   Math.round((label.carbohydrates?.value ?? 0) * 10) / 10,
      fatG:     Math.round((label.fat?.value ?? 0) * 10) / 10,
      servingSize: servingSizeStr,
    };
  }

  // Fallback: foodNutrients are per 100g/ml — scale by serving size
  const nutrients = food.foodNutrients ?? [];
  const per100cal = getUsdaNutrient(nutrients, "208");
  const per100pro = getUsdaNutrient(nutrients, "203");
  const per100carb = getUsdaNutrient(nutrients, "205");
  const per100fat  = getUsdaNutrient(nutrients, "204");

  // Parse serving size number for scaling (e.g. "414 MLT" → 414, "340 ml" → 340)
  let servingNum = 100; // default: assume per-100g values are the serving
  let servingSizeStr = "100g (USDA standard)";
  if (food.servingSize) {
    const sizeNum = parseFloat(String(food.servingSize));
    if (!isNaN(sizeNum) && sizeNum > 0) {
      servingNum = sizeNum;
      servingSizeStr = `${sizeNum} ${food.servingSizeUnit ?? "g"}`.trim();
    }
  }

  const scale = servingNum / 100;
  return {
    calories: Math.round(per100cal * scale),
    proteinG: Math.round(per100pro  * scale * 10) / 10,
    carbsG:   Math.round(per100carb * scale * 10) / 10,
    fatG:     Math.round(per100fat  * scale * 10) / 10,
    servingSize: servingSizeStr,
  };
}

// ─── AI-assisted USDA candidate selection ────────────────────────────────────

/**
 * Ask the AI to pick the best matching candidate from USDA results.
 * Returns the fdcId of the best match, or null if none are a good match.
 */
async function aiSelectUsdaCandidate(
  query: string,
  candidates: UsdaCandidate[],
  groq: Groq
): Promise<number | null> {
  if (candidates.length === 0) return null;

  const candidateList = candidates.map((c, i) => {
    const brand = c.brandOwner || c.brandName ? ` (${c.brandOwner ?? c.brandName})` : "";
    const nutrients = extractNutrientsFromCandidate(c);
    return `${i + 1}. [fdcId: ${c.fdcId}] ${c.description}${brand} — ${nutrients.calories} kcal, P:${nutrients.proteinG}g, C:${nutrients.carbsG}g, F:${nutrients.fatG}g per ${nutrients.servingSize}`;
  }).join("\n");

  const systemPrompt = `You are a nutrition database expert. A user searched for a food item and you must select the BEST matching result from the USDA database candidates.

Rules:
- Pick the candidate that EXACTLY matches what the user is looking for (correct brand, flavor, product line)
- If none of the candidates are a close match, return null
- Do NOT pick a similar-but-different product just to return something
- For branded products: brand name AND product name must match
- For restaurant items: the specific menu item must match
- Return ONLY valid JSON: {"fdcId": <number>} or {"fdcId": null}`;

  const userPrompt = `User searched for: "${query}"

USDA candidates:
${candidateList}

Which fdcId best matches? Return {"fdcId": <number>} or {"fdcId": null} if none match well.`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      temperature: 0.0,
      max_tokens: 50,
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return typeof parsed.fdcId === "number" ? parsed.fdcId : null;
  } catch {
    return null;
  }
}

// ─── AI estimation (direct) ───────────────────────────────────────────────────

function buildSystemPrompt(parsed: ParsedQuery): string {
  const baseIdentity = `You are a professional sports dietitian and precision nutrition analyst with encyclopedic knowledge of:
- Official published nutritional data for every major US restaurant chain
- USDA FoodData Central values for all whole foods and raw ingredients
- Precise macro estimation for weighted portions using verified nutritional density values
- Bodybuilding, powerlifting, and athletic nutrition standards

Your outputs are used for elite athletic nutrition tracking. Accuracy is critical.`;

  const jsonRule = `Return ONLY a single valid JSON object. No markdown, no code fences, no explanation.`;

  const componentSchema = `{
  "item": "<food name with quantity>",
  "calories": <integer>,
  "proteinG": <number, 1 decimal>,
  "carbsG": <number, 1 decimal>,
  "fatG": <number, 1 decimal>,
  "servingSize": "<specific size>",
  "confidence": "<'high'|'medium'|'low'>"
}`;

  if (parsed.chain) {
    return `${baseIdentity}

TASK: Return exact nutritional data for a ${parsed.chain} menu item using their OFFICIAL PUBLISHED nutrition facts.

${jsonRule}

${parsed.isMultiComponent ? `Return total plus breakdown:
{
  "calories": <total>, "proteinG": <total>, "carbsG": <total>, "fatG": <total>,
  "servingSize": "<description>", "confidence": "<level>",
  "breakdown": [${componentSchema}, ...]
}` : `Return:
{
  "calories": <integer>, "proteinG": <number>, "carbsG": <number>, "fatG": <number>,
  "servingSize": "<official serving size>", "confidence": "high", "breakdown": []
}`}`;
  }

  if (parsed.isMultiComponent) {
    return `${baseIdentity}

TASK: Return combined total AND per-component breakdown for a multi-item meal.
Use USDA values for whole foods. Assume standard adult athlete serving sizes if not specified.

${jsonRule}

Return:
{
  "calories": <sum>, "proteinG": <sum>, "carbsG": <sum>, "fatG": <sum>,
  "servingSize": "<overall description>", "confidence": "<level>",
  "breakdown": [${componentSchema}, ...]
}`;
  }

  if (parsed.hasExplicitQuantity) {
    return `${baseIdentity}

TASK: Calculate precise nutritional content for the exact weight/volume specified.
Use USDA nutritional density values and scale precisely to the specified quantity.

${jsonRule}

Return:
{
  "calories": <integer>, "proteinG": <number>, "carbsG": <number>, "fatG": <number>,
  "servingSize": "<exact quantity specified>", "confidence": "high", "breakdown": []
}`;
  }

  return `${baseIdentity}

TASK: Return nutritional content for one standard serving of the described food.
Use USDA FoodData Central as primary reference. State the serving size explicitly.

${jsonRule}

Return:
{
  "calories": <integer>, "proteinG": <number>, "carbsG": <number>, "fatG": <number>,
  "servingSize": "<specific serving size with grams>", "confidence": "<level>", "breakdown": []
}`;
}

interface RawAIResponse {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSize: string;
  confidence: string;
  breakdown?: Array<{
    item: string;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    servingSize?: string;
    confidence?: string;
  }>;
}

async function estimateWithAI(parsed: ParsedQuery): Promise<NutritionResult | null> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  const groq = new Groq({ apiKey });
  const systemPrompt = buildSystemPrompt(parsed);

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
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

// ─── Main pipeline ────────────────────────────────────────────────────────────

function normalizeKey(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Full nutrition lookup pipeline:
 * Cache → Branded USDA (AI-selected) → Whole food USDA (AI-selected) → AI direct
 */
export async function lookupNutrition(
  foodName: string,
  options: { forceAi?: boolean } = {}
): Promise<NutritionResult | null> {
  const parsed = preprocessQuery(foodName);
  const key = normalizeKey(parsed.cleanedQuery);

  // 1. Cache (bypass when forceAi)
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

  const apiKey = process.env.GROQ_API_KEY;
  const groq = apiKey ? new Groq({ apiKey }) : null;

  let result: NutritionResult | null = null;

  // For multi-component meals → go directly to AI with breakdown prompt
  if (parsed.isMultiComponent) {
    result = await estimateWithAI(parsed);
  }

  // For restaurant/chain items → AI with chain-specific prompt
  else if (parsed.chain) {
    // Still try USDA Branded first — many chain items are in there with exact data
    if (groq) {
      const candidates = await searchUsdaCandidates(parsed.cleanedQuery, "Branded", 8);
      const fdcId = await aiSelectUsdaCandidate(parsed.cleanedQuery, candidates, groq);
      if (fdcId) {
        const food = await fetchUsdaById(fdcId);
        if (food) {
          const { calories, proteinG, carbsG, fatG, servingSize } = extractNutrientsFromCandidate(food);
          if (calories > 0) {
            const brand = food.brandOwner || food.brandName || parsed.chain;
            console.log(`[nutrition] USDA Branded match for chain item: ${food.description} (fdcId ${fdcId})`);
            result = {
              calories, proteinG, carbsG, fatG, servingSize,
              source: "usda_branded",
              confidence: "high",
              foodName: food.description ?? parsed.cleanedQuery,
            };
          }
        }
      }
    }
    // Fall back to AI with chain prompt
    if (!result) result = await estimateWithAI(parsed);
  }

  // For branded products → Branded USDA (AI-selected) → AI fallback
  else if (parsed.isBrandedProduct && groq) {
    const candidates = await searchUsdaCandidates(parsed.cleanedQuery, "Branded", 8);
    const fdcId = await aiSelectUsdaCandidate(parsed.cleanedQuery, candidates, groq);
    if (fdcId) {
      const food = await fetchUsdaById(fdcId);
      if (food) {
        const { calories, proteinG, carbsG, fatG, servingSize } = extractNutrientsFromCandidate(food);
        if (calories > 0) {
          console.log(`[nutrition] USDA Branded match: ${food.description} (fdcId ${fdcId})`);
          result = {
            calories, proteinG, carbsG, fatG, servingSize,
            source: "usda_branded",
            confidence: "high",
            foodName: food.description ?? parsed.cleanedQuery,
          };
        }
      }
    }
    if (!result) result = await estimateWithAI(parsed);
  }

  // For everything else: try Branded USDA first (many packaged foods),
  // then whole-food USDA, then AI
  else {
    // Step A: Branded search — catches protein bars, packaged snacks, etc.
    if (groq) {
      const brandedCandidates = await searchUsdaCandidates(parsed.cleanedQuery, "Branded", 6);
      const fdcId = await aiSelectUsdaCandidate(parsed.cleanedQuery, brandedCandidates, groq);
      if (fdcId) {
        const food = await fetchUsdaById(fdcId);
        if (food) {
          const { calories, proteinG, carbsG, fatG, servingSize } = extractNutrientsFromCandidate(food);
          if (calories > 0) {
            console.log(`[nutrition] USDA Branded match: ${food.description} (fdcId ${fdcId})`);
            result = {
              calories, proteinG, carbsG, fatG, servingSize,
              source: "usda_branded",
              confidence: "high",
              foodName: food.description ?? parsed.cleanedQuery,
            };
          }
        }
      }
    }

    // Step B: Whole food / ingredient USDA search
    if (!result && groq) {
      const wholeCandidates = await searchUsdaCandidates(
        parsed.cleanedQuery, "Foundation,SR Legacy", 6
      );
      const fdcId = await aiSelectUsdaCandidate(parsed.cleanedQuery, wholeCandidates, groq);
      if (fdcId) {
        const food = await fetchUsdaById(fdcId);
        if (food) {
          const { calories, proteinG, carbsG, fatG, servingSize } = extractNutrientsFromCandidate(food);
          if (calories > 0) {
            console.log(`[nutrition] USDA whole-food match: ${food.description} (fdcId ${fdcId})`);
            result = {
              calories, proteinG, carbsG, fatG, servingSize,
              source: "usda",
              confidence: "high",
              foodName: food.description ?? parsed.cleanedQuery,
            };
          }
        }
      }
    }

    // Step C: AI fallback
    if (!result) result = await estimateWithAI(parsed);
  }

  // Cache result
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
