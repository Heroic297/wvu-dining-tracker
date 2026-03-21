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

  // Wearables
  getWearableStatus: () => apiRequest("GET", "/api/wearables/status"),
  getFitbitAuthUrl: () => apiRequest("GET", "/api/wearables/fitbit/connect"),
  getGarminAuthUrl: () => apiRequest("GET", "/api/wearables/garmin/connect"),
  disconnectWearable: (source: string) =>
    apiRequest("DELETE", `/api/wearables/${source}`),
  syncWearable: (source: string) =>
    apiRequest("POST", "/api/wearables/sync", { source }),

  // Activity
  getActivity: (days?: number) =>
    apiRequest("GET", `/api/activity${days ? `?days=${days}` : ""}`),
};

/** Store the JWT token in memory */
let _token: string | null = null;

export function setToken(t: string | null) {
  _token = t;
}
export function getToken(): string | null {
  return _token;
}

/** Today's date in YYYY-MM-DD, expressed in Eastern Time (America/New_York) */
export function todayStr(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
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

/** Convert kg to lbs */
export function kgToLbs(kg: number): number {
  return Math.round(kg * 2.20462 * 10) / 10;
}

/** Convert lbs to kg */
export function lbsToKg(lbs: number): number {
  return Math.round((lbs / 2.20462) * 10) / 10;
}

/** Format date as Month Day, Year */
export function formatDate(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
