/**
 * API client helpers.
 * All requests go through apiRequest from queryClient.ts.
 */
import { apiRequest } from "./queryClient";

export const api = {
  // Auth
  login: (email: string, password: string) =>
    apiRequest("POST", "/api/auth/login", { email, password }),
  register: (email: string, password: string, displayName?: string, inviteCode?: string) =>
    apiRequest("POST", "/api/auth/register", { email, password, displayName, inviteCode }),
  logout: () => apiRequest("POST", "/api/auth/logout"),
  me: () => apiRequest("GET", "/api/auth/me"),

  // Profile
  getProfile: () => apiRequest("GET", "/api/user/profile"),
  updateProfile: (data: Record<string, any>) =>
    apiRequest("PATCH", "/api/user/profile", data),

  // Dashboard
  getDashboard: (date?: string) =>
    apiRequest("GET", `/api/dashboard${date ? `?date=${date}` : ""}`),

  // Targets
  getTargets: (date?: string) =>
    apiRequest("GET", `/api/targets${date ? `?date=${date}` : ""}`),

  // Dining
  getLocations: () => apiRequest("GET", "/api/dining/locations"),
  getMenu: (locationSlug: string, date: string, mealType: string) =>
    apiRequest(
      "GET",
      `/api/dining/menu?locationSlug=${locationSlug}&date=${date}&mealType=${mealType}`
    ),

  // Nutrition
  lookupNutrition: (q: string) =>
    apiRequest("GET", `/api/nutrition/lookup?q=${encodeURIComponent(q)}`),
  lookupBarcode: (upc: string) =>
    apiRequest("GET", `/api/nutrition/barcode?upc=${encodeURIComponent(upc)}`),

  // Meals
  getMeals: (date?: string) =>
    apiRequest("GET", `/api/meals${date ? `?date=${date}` : ""}`),
  getMealsRange: (startDate: string, endDate: string) =>
    apiRequest("GET", `/api/meals/range?startDate=${startDate}&endDate=${endDate}`),
  createMeal: (data: Record<string, any>) =>
    apiRequest("POST", "/api/meals", data),
  deleteMeal: (id: string) => apiRequest("DELETE", `/api/meals/${id}`),

  // Meal items
  getMealItems: (mealId: string) =>
    apiRequest("GET", `/api/meals/${mealId}/items`),
  addMealItem: (mealId: string, data: Record<string, any>) =>
    apiRequest("POST", `/api/meals/${mealId}/items`, data),
  updateMealItem: (id: string, data: Record<string, any>) =>
    apiRequest("PATCH", `/api/meal-items/${id}`, data),
  deleteMealItem: (id: string) => apiRequest("DELETE", `/api/meal-items/${id}`),

  // Weight
  getWeight: (limit?: number) =>
    apiRequest("GET", `/api/weight${limit ? `?limit=${limit}` : ""}`),
  logWeight: (data: Record<string, any>) =>
    apiRequest("POST", "/api/weight", data),
  deleteWeightLog: (id: string) => apiRequest("DELETE", `/api/weight/${id}`),

  // History / data management
  previewHistoryClear: (startDate?: string, endDate?: string) => {
    const qs = new URLSearchParams();
    if (startDate) qs.set("startDate", startDate);
    if (endDate)   qs.set("endDate", endDate);
    const q = qs.toString();
    return apiRequest("GET", `/api/user/history/preview${q ? `?${q}` : ""}`);
  },
  clearHistory: (data: {
    confirm: "DELETE";
    startDate?: string;
    endDate?: string;
    meals?: boolean;
    weightLogs?: boolean;
    waterLogs?: boolean;
    supplementLogs?: boolean;
    workoutLogs?: boolean;
    coachMemory?: boolean;
  }) => apiRequest("DELETE", "/api/user/history", data),

  // Water
  getWater: (date: string) => apiRequest("GET", `/api/water?date=${date}`),
  logWater: (date: string, mlLogged: number) =>
    apiRequest("POST", "/api/water", { date, mlLogged }),

  // Activity
  getActivity: (days?: number) =>
    apiRequest("GET", `/api/activity${days ? `?days=${days}` : ""}`),

  // AI Coach
  coachChat: (message: string) =>
    apiRequest("POST", "/api/coach/chat", { message }),
  coachProfile: () => apiRequest("GET", "/api/coach/profile"),
  coachUpdateProfile: (data: Record<string, any>) =>
    apiRequest("PATCH", "/api/coach/profile", data),
  coachHistory: () => apiRequest("GET", "/api/coach/history"),
  coachClearMemory: () => apiRequest("DELETE", "/api/coach/memory"),
  coachSaveApiKey: (apiKey: string, provider: string, model: string) =>
    apiRequest("PATCH", "/api/coach/apikey", { apiKey, provider, model }),
  coachDeleteApiKey: (provider?: string) =>
    apiRequest("DELETE", provider ? `/api/coach/apikey?provider=${provider}` : "/api/coach/apikey"),
  coachUpdateProvider: (provider: string, model: string) =>
    apiRequest("PATCH", "/api/coach/provider", { provider, model }),
  coachLiveContext: () => apiRequest("GET", "/api/coach/live-context"),

  // Meal Favorites
  getFavorites: () => apiRequest("GET", "/api/favorites"),
  saveFavorite: (data: {
    name: string;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    servingSize?: string;
    barcode?: string;
    source?: string;
  }) => apiRequest("POST", "/api/favorites", data),
  deleteFavorite: (id: string) => apiRequest("DELETE", `/api/favorites/${id}`),
};

/** Store the JWT token in memory */
let _token: string | null = null;

export function setToken(t: string | null) {
  _token = t;
}
export function getToken(): string | null {
  return _token;
}

/** Today's date in YYYY-MM-DD, expressed in the given timezone (defaults to Eastern) */
export function todayStr(tz: string = "America/New_York"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Guess current meal type based on local time */
export function guessMealType(): "breakfast" | "lunch" | "dinner" | "brunch" {
  const h = new Date().getHours();
  if (h < 11) return "breakfast";
  if (h < 16) return "lunch";
  return "dinner";
}

/** Format a number with at most 1 decimal place */
export function fmt1(n: number | null | undefined): string {
  if (n == null) return "0";
  return (Math.round(n * 10) / 10).toString();
}

/**
 * Convert kg to lbs.
 *
 * IMPORTANT: returns the full-precision value. Rounding here caused a
 * round-trip drift bug — e.g. a user-entered 148 lb became 67.1 kg on save,
 * which then rendered back as 147.9 lb on next load, drifting further every
 * save. Use `fmtLbs` / `fmtKg` when formatting for display.
 */
export function kgToLbs(kg: number): number {
  return kg * 2.20462262185;
}

/**
 * Convert lbs to kg.
 *
 * Full precision — see note on `kgToLbs`.
 */
export function lbsToKg(lbs: number): number {
  return lbs / 2.20462262185;
}

/** Format a lbs value for display (1 decimal). */
export function fmtLbs(lbs: number | null | undefined): string {
  if (lbs == null || Number.isNaN(lbs)) return "";
  return (Math.round(lbs * 10) / 10).toString();
}

/** Format a kg value for display (1 decimal). */
export function fmtKg(kg: number | null | undefined): string {
  if (kg == null || Number.isNaN(kg)) return "";
  return (Math.round(kg * 10) / 10).toString();
}

/** Format date as Month Day, Year */
export function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
