/**
 * WVU Dining Hall Menu Scraper
 *
 * WVU dining (Elior / TenKites powered) embeds menu JSON directly in the
 * HTML of each menu page. No separate JSON API — we fetch the page, extract
 * the `data-menu-json` attribute from the `.k10-data` div, and parse it.
 *
 * URL patterns:
 *   Summit Café  — https://menus.tenkites.com/eliorna/e7210
 *   Café Evansdale — https://menus.campus-dining.com/eliorna/e7208
 *   Hatfield's   — https://menus.campus-dining.com/eliorna/e7211
 *
 * Fetch flow per location + date:
 *   1. GET base?cl=true&mguid={locationGuid}&mldate={date}&internalrequest=true
 *      → HTML contains: period selector (breakfast/lunch/dinner) with data-menu-identifier GUIDs
 *      → Also contains embedded menu JSON for the default period
 *   2. For each period GUID found, GET base?...&mlguid={periodGuid}
 *      → HTML contains data-menu-json with all recipe items
 */
import axios from "axios";
import * as cheerio from "cheerio";
import { storage } from "./storage.js";
import type { InsertDiningItem } from "../shared/schema.js";

// ── Location config ───────────────────────────────────────────────────────────

interface LocationConfig {
  slug: string;
  baseUrl: string;     // TenKites menu base URL (no query params)
  mguid: string;       // location GUID (mguid param)
}

const WVU_LOCATIONS: LocationConfig[] = [
  {
    slug: "summit-cafe",
    baseUrl: "https://menus.tenkites.com/eliorna/e7210",
    mguid: "88f9059e-47a0-40bc-aa1a-649a2cb2a1d2",
  },
  {
    slug: "cafe-evansdale",
    baseUrl: "https://menus.campus-dining.com/eliorna/e7208",
    mguid: "dde18ffb-658d-43b0-8b5f-78f1b44b40f4",
  },
  {
    slug: "hatfields",
    baseUrl: "https://menus.campus-dining.com/eliorna/e7211",
    mguid: "cbbd5d2d-efd4-4d07-8b9c-614cdc4f36ae",
  },
];

const SCRAPER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Referer: "https://dining.wvu.edu/",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

// ── TenKites data types ───────────────────────────────────────────────────────

interface TenKitesNutrient {
  id: string;
  desc: string;
  perServRounded: string;
  uom?: string;
}

interface TenKitesItem {
  itemType: "recipe" | "sectionL1" | "sectionL2" | "section" | string;
  recipeGuid?: string;
  sectionGuid?: string;
  recipeName?: string;
  sectionName?: string;
  calories?: string | number;
  ntrs?: TenKitesNutrient[];
  isByo?: boolean;
  byoItems?: TenKitesItem[];
}

interface TenKitesMenuJson {
  items: TenKitesItem[];
}

// ── Nutrient extraction helpers ───────────────────────────────────────────────

/** Map TenKites nutrient id → value in grams/kcal */
function getNutrientById(ntrs: TenKitesNutrient[] | undefined, ...ids: string[]): number | null {
  if (!ntrs) return null;
  for (const id of ids) {
    const n = ntrs.find((x) => x.id === id);
    if (n && n.perServRounded && n.perServRounded !== "-") {
      // Handle "<1g" style values
      const raw = String(n.perServRounded).replace(/[^0-9.]/g, "");
      const val = parseFloat(raw);
      if (!isNaN(val)) return val;
    }
  }
  return null;
}

// ── Period name normalisation ─────────────────────────────────────────────────

function normalizeMealType(
  name: string
): "breakfast" | "lunch" | "dinner" | "brunch" | null {
  const n = name.toLowerCase().trim();
  if (n.includes("breakfast")) return "breakfast";
  if (n.includes("brunch")) return "brunch";
  if (n.includes("lunch")) return "lunch";
  if (n.includes("dinner") || n.includes("supper")) return "dinner";
  return null;
}

// ── Page fetching & parsing ───────────────────────────────────────────────────

async function fetchMenuPage(url: string): Promise<string> {
  const resp = await axios.get(url, {
    headers: SCRAPER_HEADERS,
    timeout: 20000,
    maxRedirects: 5,
  });
  return resp.data as string;
}

/**
 * Parse the embedded data-menu-json from a TenKites HTML page.
 * Returns all recipe items found.
 */
function parseMenuJson(html: string): TenKitesItem[] {
  const $ = cheerio.load(html);

  // The JSON is in data-menu-json attribute on a div.k10-data element
  let rawJson = $("[data-menu-json]").attr("data-menu-json");

  if (!rawJson) return [];

  // Cheerio already HTML-decodes attribute values
  try {
    const data: TenKitesMenuJson = JSON.parse(rawJson);
    return data.items ?? [];
  } catch {
    // Fallback: try regex extraction + manual unescape
    const m = html.match(/data-menu-json="([\s\S]*?)"(?:\s|>)/);
    if (!m) return [];
    const decoded = m[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    try {
      const data: TenKitesMenuJson = JSON.parse(decoded);
      return data.items ?? [];
    } catch {
      return [];
    }
  }
}

/**
 * Extract period options from TenKites HTML.
 * Returns array of { name, guid } for each available meal period.
 */
function parsePeriodOptions(html: string): Array<{ name: string; guid: string }> {
  const $ = cheerio.load(html);
  const periods: Array<{ name: string; guid: string }> = [];

  $(".k10-menu-selector__option").each((_i, el) => {
    const guid = $(el).attr("data-menu-identifier");
    const name = $(el).text().trim();
    if (guid && guid !== "00000000-0000-0000-0000-000000000000" && name) {
      periods.push({ name, guid });
    }
  });

  return periods;
}

// ── Main scrape function ──────────────────────────────────────────────────────

/**
 * Scrape menus for a specific location and date.
 * Returns true if at least one menu was successfully saved.
 */
export async function scrapeLocationDate(
  locationSlug: string,
  dateStr: string
): Promise<boolean> {
  const config = WVU_LOCATIONS.find((l) => l.slug === locationSlug);
  if (!config) {
    console.warn(`[scraper] Unknown location slug: ${locationSlug}`);
    return false;
  }

  const dbLocation = await storage.getDiningLocationBySlug(locationSlug);
  if (!dbLocation) {
    console.warn(`[scraper] Location not found in DB: ${locationSlug}`);
    return false;
  }

  console.log(`[scraper] Fetching ${locationSlug} for ${dateStr}...`);

  // Step 1: fetch the default period page to discover all available periods
  const defaultUrl = `${config.baseUrl}?cl=true&mguid=${config.mguid}&mldate=${dateStr}&internalrequest=true`;

  let defaultHtml: string;
  try {
    defaultHtml = await fetchMenuPage(defaultUrl);
  } catch (err: any) {
    console.error(`[scraper] Network error for ${locationSlug} ${dateStr}:`, err.message);
    return false;
  }

  const periods = parsePeriodOptions(defaultHtml);
  if (periods.length === 0) {
    console.log(`[scraper] ${locationSlug} is closed / no menu on ${dateStr}`);
    return false;
  }

  let savedAny = false;

  for (const period of periods) {
    const mealType = normalizeMealType(period.name);
    if (!mealType) {
      console.log(`[scraper] Skipping unrecognised period: ${period.name}`);
      continue;
    }

    // Skip if already cached
    const existing = await storage.getDiningMenu(dbLocation.id, dateStr, mealType);
    if (existing) {
      console.log(`[scraper] Already cached: ${locationSlug}/${mealType}/${dateStr}`);
      savedAny = true;
      continue;
    }

    // Step 2: fetch the specific period page
    let html: string;
    try {
      const periodUrl = `${config.baseUrl}?cl=true&mguid=${config.mguid}&mldate=${dateStr}&mlguid=${period.guid}&internalrequest=true`;
      html = await fetchMenuPage(periodUrl);
    } catch (err: any) {
      console.error(`[scraper] Error fetching period ${period.name}:`, err.message);
      continue;
    }

    const items = parseMenuJson(html);
    const recipes = items.filter((x) => x.itemType === "recipe" && x.recipeName);

    if (recipes.length === 0) {
      console.log(`[scraper] No items found for ${locationSlug}/${period.name}/${dateStr}`);
      continue;
    }

    // Build category map from section items above each recipe
    let currentCategory = "General";
    const categoryMap = new Map<string, string>();
    for (const item of items) {
      if ((item.itemType === "sectionL1" || item.itemType === "sectionL2" || item.itemType === "section") && item.sectionName) {
        currentCategory = item.sectionName;
      } else if (item.itemType === "recipe" && item.recipeGuid) {
        categoryMap.set(item.recipeGuid, currentCategory);
      }
    }

    // Create menu row
    const menu = await storage.createDiningMenu({
      locationId: dbLocation.id,
      date: dateStr,
      mealType,
    });

    const diningItems: InsertDiningItem[] = recipes.map((recipe) => {
      const ntrs = recipe.ntrs ?? [];
      const calories = recipe.calories != null
        ? parseInt(String(recipe.calories), 10) || null
        : getNutrientById(ntrs, "2"); // id 2 = Calories

      return {
        menuId: menu.id,
        name: recipe.recipeName!,
        calories,
        proteinG: getNutrientById(ntrs, "3"),   // id 3 = Protein
        carbsG:   getNutrientById(ntrs, "4"),   // id 4 = Carbs
        fatG:     getNutrientById(ntrs, "8"),   // id 8 = Total Fat
        servingSize: null,
        nutritionSource: "wvu",
        rawMetadata: {
          category: categoryMap.get(recipe.recipeGuid ?? "") ?? currentCategory,
          recipeGuid: recipe.recipeGuid,
          periodName: period.name,
        },
      };
    });

    await storage.createDiningItemsBulk(diningItems);
    console.log(
      `[scraper] Saved ${diningItems.length} items for ${locationSlug}/${mealType}/${dateStr}`
    );
    savedAny = true;

    // Brief pause between period requests
    await new Promise((r) => setTimeout(r, 300));
  }

  return savedAny;
}

/** Scrape all three dining halls for a given date */
export async function scrapeAllLocations(dateStr: string): Promise<void> {
  console.log(`[scraper] Starting full scrape for ${dateStr}`);
  await storage.seedDiningLocations();
  for (const loc of WVU_LOCATIONS) {
    try {
      await scrapeLocationDate(loc.slug, dateStr);
    } catch (err) {
      console.error(`[scraper] Failed for ${loc.slug}:`, err);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`[scraper] Done scraping ${dateStr}`);
}

/** Get today's date in YYYY-MM-DD format in the America/New_York timezone */
export function todayString(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
