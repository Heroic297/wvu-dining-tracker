import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, guessMealType, todayStr, fmt1 } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Search, Loader2, ChefHat, ScanBarcode } from "lucide-react";
import BarcodeScanner from "@/components/BarcodeScanner";

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "brunch"];
const NO_LOCATION = "__none__";

export default function LogMealPage() {
  const today = todayStr();
  const [date, setDate] = useState(today);
  const [mealType, setMealType] = useState<string>(guessMealType());
  const [locationSlug, setLocationSlug] = useState(NO_LOCATION);
  const [customSearch, setCustomSearch] = useState("");
  const [searchResult, setSearchResult] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const [activeMeal, setActiveMeal] = useState<any>(null);
  const [manualCalories, setManualCalories] = useState("");
  const [manualProtein, setManualProtein] = useState("");
  const [manualCarbs, setManualCarbs] = useState("");
  const [manualFat, setManualFat] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const { toast } = useToast();

  // Fetch locations
  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["/api/dining/locations"],
  });

  // Fetch today's meals
  const { data: meals = [], refetch: refetchMeals } = useQuery<any[]>({
    queryKey: ["/api/meals", date],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/meals?date=${date}`);
      return res.json();
    },
  });

  // Fetch menu items — only when a real location is selected
  const activeSlug = locationSlug === NO_LOCATION ? "" : locationSlug;
  const { data: menuData, isLoading: menuLoading } = useQuery<any>({
    queryKey: ["/api/dining/menu", activeSlug, date, mealType],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/dining/menu?locationSlug=${activeSlug}&date=${date}&mealType=${mealType}`
      );
      return res.json();
    },
    enabled: !!activeSlug,
    staleTime: 10 * 60 * 1000,
  });

  const ensureMeal = async () => {
    const existing = meals.find((m: any) => m.mealType === mealType && m.date === date);
    if (existing) { setActiveMeal(existing); return existing; }
    const res = await api.createMeal({ date, mealType, locationId: menuData?.location?.id ?? null });
    const meal = await res.json();
    await refetchMeals();
    setActiveMeal(meal);
    return meal;
  };

  const addItem = async (item: any) => {
    try {
      const meal = await ensureMeal();
      await api.addMealItem(meal.id, {
        diningItemId: item.id,
        calories: item.calories ?? 0,
        proteinG: item.proteinG ?? 0,
        carbsG: item.carbsG ?? 0,
        fatG: item.fatG ?? 0,
        servings: 1,
        source: "wvu",
      });
      await refetchMeals();
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: `${item.name} added` });
    } catch {
      toast({ title: "Failed to add item", variant: "destructive" });
    }
  };

  const removeItem = async (itemId: string) => {
    try {
      await api.deleteMealItem(itemId);
      await refetchMeals();
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    } catch {
      toast({ title: "Failed to remove item", variant: "destructive" });
    }
  };

  // ── Nutrition lookup (text search) ────────────────────────────────────────
  const handleSearch = async () => {
    if (!customSearch.trim()) return;
    setSearching(true);
    setSearchResult(null);
    try {
      const res = await api.lookupNutrition(customSearch.trim());
      const data = await res.json();
      setSearchResult(data);
    } catch {
      setSearchResult({ error: "Not found — please enter values manually" });
    } finally {
      setSearching(false);
    }
  };

  // ── Barcode handler ────────────────────────────────────────────────────────
  const handleBarcodeScan = async (upc: string) => {
    setShowScanner(false);
    setSearching(true);
    setSearchResult(null);
    // Show the scanned code in the search field for reference
    setCustomSearch(`Scanned: ${upc}`);
    try {
      const res = await api.lookupBarcode(upc);
      if (!res.ok) {
        const err = await res.json();
        setSearchResult({ error: err.error ?? "Product not found — try entering the name manually" });
        setCustomSearch("");
        return;
      }
      const data = await res.json();
      // Use the product name in the search field so the user can see what was found
      setCustomSearch(data.foodName ?? `UPC ${upc}`);
      setSearchResult(data);
    } catch {
      setSearchResult({ error: "Barcode lookup failed — try entering the name manually" });
      setCustomSearch("");
    } finally {
      setSearching(false);
    }
  };

  // Auto-fill macro fields when any lookup returns
  useEffect(() => {
    if (searchResult && !searchResult.error) {
      setManualCalories(String(searchResult.calories ?? ""));
      setManualProtein(String(searchResult.proteinG ?? ""));
      setManualCarbs(String(searchResult.carbsG ?? ""));
      setManualFat(String(searchResult.fatG ?? ""));
    }
  }, [searchResult]);

  const addCustomFood = async () => {
    if (!customSearch.trim()) return;
    // Strip the "Scanned: XXXX" prefix if present
    const name = customSearch.replace(/^Scanned:\s*\d+\s*/, "").trim() || customSearch.trim();
    try {
      const meal = await ensureMeal();
      await api.addMealItem(meal.id, {
        customName: name,
        calories: parseFloat(manualCalories) || 0,
        proteinG: parseFloat(manualProtein) || 0,
        carbsG: parseFloat(manualCarbs) || 0,
        fatG: parseFloat(manualFat) || 0,
        servings: 1,
        source: searchResult && !searchResult.error ? searchResult.source : "manual_exact",
      });
      await refetchMeals();
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      setCustomSearch("");
      setSearchResult(null);
      setManualCalories(""); setManualProtein(""); setManualCarbs(""); setManualFat("");
      toast({ title: `${name} added` });
    } catch {
      toast({ title: "Failed to add food", variant: "destructive" });
    }
  };

  const currentMeal = meals.find((m: any) => m.mealType === mealType && m.date === date);
  const menuItems = menuData?.items ?? [];

  return (
    <>
      {/* Barcode scanner overlay */}
      {showScanner && (
        <BarcodeScanner
          onDetected={handleBarcodeScan}
          onClose={() => setShowScanner(false)}
        />
      )}

      <div className="p-4 md:p-6 max-w-2xl space-y-5">
        <h1 className="text-xl font-bold">Log meal</h1>

        {/* Controls */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-date" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Meal</Label>
            <Select value={mealType} onValueChange={setMealType}>
              <SelectTrigger data-testid="select-meal-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MEAL_TYPES.map((m) => (
                  <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 col-span-2 md:col-span-1">
            <Label className="text-xs">Dining hall</Label>
            <Select value={locationSlug} onValueChange={setLocationSlug}>
              <SelectTrigger data-testid="select-location"><SelectValue placeholder="Select hall..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LOCATION}>None (custom food only)</SelectItem>
                {locations.map((l: any) => (
                  <SelectItem key={l.slug} value={l.slug}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Current meal summary */}
        {currentMeal && (
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="font-semibold capitalize">{mealType} — logged items</p>
              <p className="text-sm font-semibold">{Math.round(currentMeal.totalCalories ?? 0)} kcal</p>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              P:{fmt1(currentMeal.totalProtein)}g · C:{fmt1(currentMeal.totalCarbs)}g · F:{fmt1(currentMeal.totalFat)}g
            </p>
            {currentMeal.items?.map((item: any) => (
              <div key={item.id} className="flex items-center justify-between py-1.5 border-t border-border" data-testid={`meal-item-${item.id}`}>
                <span className="text-sm">{item.customName ?? item.diningItemId?.name ?? "Custom item"}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{Math.round(item.calories)} kcal</span>
                  <button onClick={() => removeItem(item.id)} className="text-destructive hover:opacity-80">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Dining hall menu */}
        {activeSlug && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
              <ChefHat className="w-4 h-4" />
              {menuData?.location?.name ?? "Menu"}
            </h2>
            {menuLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
              </div>
            ) : menuItems.length === 0 ? (
              <div className="bg-card border border-border rounded-xl p-4 text-center text-sm text-muted-foreground">
                {menuData?.message ?? "No menu available for this date and meal type."}
              </div>
            ) : (
              <div className="space-y-2">
                {menuItems.map((item: any) => (
                  <div
                    key={item.id}
                    data-testid={`menu-item-${item.id}`}
                    className="bg-card border border-border rounded-xl p-3 flex items-center justify-between hover:border-primary/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{item.calories ?? "?"} kcal</span>
                        {item.proteinG != null && <span className="text-xs macro-protein">P:{fmt1(item.proteinG)}g</span>}
                        {item.carbsG != null && <span className="text-xs macro-carbs">C:{fmt1(item.carbsG)}g</span>}
                        {item.fatG != null && <span className="text-xs macro-fat">F:{fmt1(item.fatG)}g</span>}
                        {item.nutritionSource === "ai_estimated" && (
                          <Badge variant="outline" className="text-xs h-4 px-1">AI</Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm" variant="ghost"
                      onClick={() => addItem(item)}
                      data-testid={`button-add-item-${item.id}`}
                      className="ml-2 h-8 w-8 p-0"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Custom food entry */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Add custom food</h2>
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">

            {/* Search row — text search + barcode scan button */}
            <div className="flex gap-2">
              <Input
                placeholder="Food name or describe the meal…"
                value={customSearch}
                onChange={(e) => setCustomSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                data-testid="input-food-search"
                className="flex-1"
              />
              {/* Text search */}
              <Button
                variant="outline"
                onClick={handleSearch}
                disabled={searching}
                data-testid="button-search-food"
                title="Search by name"
              >
                {searching
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Search className="w-4 h-4" />}
              </Button>
              {/* Barcode scan */}
              <Button
                variant="outline"
                onClick={() => setShowScanner(true)}
                disabled={searching}
                data-testid="button-scan-barcode"
                title="Scan product barcode"
                className="text-primary border-primary/40 hover:bg-primary/10"
              >
                <ScanBarcode className="w-4 h-4" />
              </Button>
            </div>

            {/* Lookup result */}
            {searchResult && (
              <div className={`rounded-lg text-sm ${searchResult.error ? "bg-destructive/10 text-destructive p-3" : "bg-secondary p-3"}`}>
                {searchResult.error ? (
                  <p>{searchResult.error}</p>
                ) : (
                  <div className="space-y-2">
                    {/* Product name (from barcode) */}
                    {searchResult.foodName && (
                      <p className="font-medium text-sm">{searchResult.foodName}</p>
                    )}
                    {/* Source + confidence */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        {searchResult.source === "ai_estimated" ? "AI estimated"
                          : searchResult.source === "usda" ? "USDA database"
                          : "Manual"}
                      </span>
                      {searchResult.confidence && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          searchResult.confidence === "high"   ? "bg-green-500/20 text-green-400" :
                          searchResult.confidence === "medium" ? "bg-yellow-500/20 text-yellow-400" :
                          "bg-red-500/20 text-red-400"
                        }`}>{searchResult.confidence} confidence</span>
                      )}
                      {searchResult.servingSize && (
                        <span className="text-xs text-muted-foreground">· {searchResult.servingSize}</span>
                      )}
                    </div>
                    {/* Per-item breakdown for multi-item AI results */}
                    {searchResult.breakdown && searchResult.breakdown.length > 1 && (
                      <div className="space-y-1 pt-1 border-t border-border/50">
                        <p className="text-xs font-medium text-muted-foreground">Breakdown:</p>
                        {searchResult.breakdown.map((item: any, i: number) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span className="text-foreground truncate flex-1 mr-2">{item.item}</span>
                            <span className="text-muted-foreground flex-shrink-0">
                              {item.calories} kcal · P:{item.proteinG}g · C:{item.carbsG}g · F:{item.fatG}g
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Macro fields */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: "Calories",    value: manualCalories, setter: setManualCalories, id: "cal"  },
                { label: "Protein (g)", value: manualProtein,  setter: setManualProtein,  id: "pro"  },
                { label: "Carbs (g)",   value: manualCarbs,    setter: setManualCarbs,    id: "carb" },
                { label: "Fat (g)",     value: manualFat,      setter: setManualFat,      id: "fat"  },
              ].map(({ label, value, setter, id }) => (
                <div key={id} className="space-y-1">
                  <Label className="text-xs">{label}</Label>
                  <Input
                    type="number" value={value}
                    onChange={(e) => setter(e.target.value)}
                    placeholder="0"
                    data-testid={`input-macro-${id}`}
                  />
                </div>
              ))}
            </div>

            <Button
              onClick={addCustomFood}
              disabled={!customSearch.trim()}
              className="w-full"
              data-testid="button-add-custom-food"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Add to {mealType}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
