/**
 * WVU Dining Hall Menu Scraper
 *
 * WVU's dining site (dineoncampus.com powered) renders menus via JavaScript.
 * We use Playwright to render the page, then extract items.
 *
 * URL pattern: https://dineoncampus.com/wvu/whats-on-the-menu
 * The site uses a React-powered dropdown interface.
 *
 * To update this scraper if WVU changes their site:
 * 1. Open the URL in a browser and inspect the network tab for API calls
 * 2. Look for XHR/Fetch requests to api.dineoncampus.com
 * 3. Update the API endpoint and parsing logic below
 */
import axios from "axios";
import { storage } from "./storage.js";
import type { InsertDiningItem } from "../shared/schema.js";

// WVU uses dineoncampus.com — their API is documented/discoverable via network tab
// Location IDs discovered by intercepting XHR on https://dineoncampus.com/wvu
const WVU_LOCATION_IDS: Record<string, string> = {
  "cafe-evansdale": "5d09b35af3eeb60b629b2adf",
  hatfields: "5d09b35af3eeb60b629b2ae1",
  "summit-cafe": "5d09b35af3eeb60b629b2ae3",
};

const DINE_API_BASE = "https://api.dineoncampus.com/v1";

interface DineOnCampusItem {
  id: string;
  name: string;
  calories?: number;
  nutrients?: Array<{
    name: string;
    value: number;
    uom: string;
  }>;
  serving_size_amount?: number;
  serving_size_unit?: string;
}

interface DineOnCampusCategory {
  name: string;
  items: DineOnCampusItem[];
}

interface DineOnCampusResponse {
  status: string;
  menu?: {
    periods?: Array<{
      id: string;
      name: string;
      categories?: DineOnCampusCategory[];
    }>;
  };
  closed?: boolean;
}

/** Map DineOnCampus period names to our meal_type enum */
function normalizeMealType(
  periodName: string
): "breakfast" | "lunch" | "dinner" | "brunch" | null {
  const n = periodName.toLowerCase();
  if (n.includes("breakfast")) return "breakfast";
  if (n.includes("brunch")) return "brunch";
  if (n.includes("lunch")) return "lunch";
  if (n.includes("dinner") || n.includes("supper")) return "dinner";
  return null;
}

/** Extract a nutrient value by name from the nutrients array */
function getNutrient(
  nutrients: DineOnCampusItem["nutrients"],
  ...names: string[]
): number | undefined {
  if (!nutrients) return undefined;
  for (const name of names) {
    const n = nutrients.find((x) =>
      x.name.toLowerCase().includes(name.toLowerCase())
    );
    if (n && n.value != null) return Number(n.value);
  }
  return undefined;
}

/**
 * Scrape menus for a specific location and date using DineOnCampus API.
 * Returns true if at least one menu was found.
 */
export async function scrapeLocationDate(
  locationSlug: string,
  dateStr: string // YYYY-MM-DD
): Promise<boolean> {
  const apiLocationId = WVU_LOCATION_IDS[locationSlug];
  if (!apiLocationId) {
    console.warn(`[scraper] Unknown location slug: ${locationSlug}`);
    return false;
  }

  const dbLocation = await storage.getDiningLocationBySlug(locationSlug);
  if (!dbLocation) {
    console.warn(`[scraper] Location not found in DB: ${locationSlug}`);
    return false;
  }

  console.log(`[scraper] Fetching ${locationSlug} for ${dateStr}...`);

  let data: DineOnCampusResponse;
  try {
    const url = `${DINE_API_BASE}/location/${apiLocationId}/periods?platform=0&date=${dateStr}`;
    const resp = await axios.get(url, {
      headers: {
        "Accept": "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; WVUDiningTracker/1.0; +https://wvu.edu)",
      },
      timeout: 15000,
    });
    data = resp.data;
  } catch (err: any) {
    console.error(`[scraper] Network error for ${locationSlug} ${dateStr}:`, err.message);
    return false;
  }

  if (data.closed || !data.menu?.periods?.length) {
    console.log(`[scraper] ${locationSlug} is closed on ${dateStr}`);
    return false;
  }

  let savedAny = false;

  for (const period of data.menu.periods) {
    const mealType = normalizeMealType(period.name);
    if (!mealType) continue;

    // Check if we need to fetch items for this period
    let existingMenu = await storage.getDiningMenu(
      dbLocation.id,
      dateStr,
      mealType
    );

    // Always re-fetch if we're explicitly scraping
    if (existingMenu) {
      // Delete old items and re-scrape would be complex; skip if recent
      console.log(
        `[scraper] Menu already cached for ${locationSlug}/${mealType}/${dateStr}`
      );
      savedAny = true;
      continue;
    }

    // Fetch the period's full menu
    try {
      const itemsUrl = `${DINE_API_BASE}/location/${apiLocationId}/periods/${period.id}?platform=0&date=${dateStr}`;
      const itemsResp = await axios.get(itemsUrl, {
        headers: {
          "Accept": "application/json",
          "User-Agent":
            "Mozilla/5.0 (compatible; WVUDiningTracker/1.0; +https://wvu.edu)",
        },
        timeout: 15000,
      });

      const periodData = itemsResp.data as {
        menu?: {
          categories?: DineOnCampusCategory[];
        };
      };

      const categories = periodData.menu?.categories ?? [];
      const allItems: InsertDiningItem[] = [];

      // Create the menu row
      const menu = await storage.createDiningMenu({
        locationId: dbLocation.id,
        date: dateStr,
        mealType,
      });

      for (const category of categories) {
        for (const item of category.items ?? []) {
          const protein = getNutrient(item.nutrients, "protein");
          const carbs = getNutrient(item.nutrients, "carbohydrate", "carbs", "total carb");
          const fat = getNutrient(item.nutrients, "total fat", "fat");

          allItems.push({
            menuId: menu.id,
            name: item.name,
            calories: item.calories ?? null,
            proteinG: protein ?? null,
            carbsG: carbs ?? null,
            fatG: fat ?? null,
            servingSize: item.serving_size_amount
              ? `${item.serving_size_amount} ${item.serving_size_unit ?? ""}`.trim()
              : null,
            nutritionSource: "wvu",
            rawMetadata: {
              category: category.name,
              dineId: item.id,
            },
          });
        }
      }

      await storage.createDiningItemsBulk(allItems);
      console.log(
        `[scraper] Saved ${allItems.length} items for ${locationSlug}/${mealType}/${dateStr}`
      );
      savedAny = true;
    } catch (err: any) {
      console.error(
        `[scraper] Error fetching period ${period.name}:`,
        err.message
      );
    }
  }

  return savedAny;
}

/** Scrape all three dining halls for a given date */
export async function scrapeAllLocations(dateStr: string): Promise<void> {
  console.log(`[scraper] Starting full scrape for ${dateStr}`);
  await storage.seedDiningLocations();
  const locations = ["cafe-evansdale", "hatfields", "summit-cafe"];
  for (const slug of locations) {
    try {
      await scrapeLocationDate(slug, dateStr);
    } catch (err) {
      console.error(`[scraper] Failed for ${slug}:`, err);
    }
    // Brief pause between requests to be polite
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
