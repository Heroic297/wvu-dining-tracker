import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, guessMealType, todayStr, fmt1 } from "@/lib/api";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/DateInput";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Search, Loader2, ChefHat, ScanBarcode, CheckCheck } from "lucide-react";
import BarcodeScanner from "@/components/BarcodeScanner";

const MEAL_TYPES = ["breakfast", "lunch", "dinner", "brunch"];
const NO_LOCATION = "__none__";
const QTY_PRESETS = [0.5, 1, 1.5, 2];

// ── Per-item quantity row ─────────────────────────────────────────────────────

interface BreakdownItem {
  item: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSize: string;
  confidence: string;
}

interface ComponentRowProps {
  comp: BreakdownItem;
  idx: number;
  qty: number;
  customQty: string;
  onPreset: (idx: number, q: number) => void;
  onCustom: (idx: number, val: string) => void;
  selected: boolean;
  onToggle: (idx: number) => void;
}

function ComponentRow({ comp, idx, qty, customQty, onPreset, onCustom, selected, onToggle }: ComponentRowProps) {
  const scaledCal = Math.round(comp.calories * qty);
  const scaledPro = Math.round(comp.proteinG * qty * 10) / 10;
  const scaledCarb = Math.round(comp.carbsG * qty * 10) / 10;
  const scaledFat = Math.round(comp.fatG * qty * 10) / 10;

  return (
    <div
      className={`rounded-xl border transition-colors p-3 space-y-2 ${
        selected
          ? "border-primary/60 bg-primary/5"
          : "border-border bg-card"
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{comp.item}</p>
          <p className="text-xs text-muted-foreground">{comp.servingSize}</p>
        </div>
        {/* Include toggle */}
        <button
          type="button"
          onClick={() => onToggle(idx)}
          data-testid={`button-component-toggle-${idx}`}
          className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-muted-foreground hover:border-primary/60"
          }`}
        >
          {selected && <CheckCheck className="w-3 h-3" />}
        </button>
      </div>

      {/* Macro summary (scaled) */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="font-semibold text-foreground">{scaledCal} kcal</span>
        <span className="macro-protein">P:{scaledPro}g</span>
        <span className="macro-carbs">C:{scaledCarb}g</span>
        <span className="macro-fat">F:{scaledFat}g</span>
        {qty !== 1 && (
          <span className="text-muted-foreground line-through">{comp.calories} kcal</span>
        )}
      </div>

      {/* Quantity selector */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-muted-foreground mr-1">Qty:</span>
        {QTY_PRESETS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPreset(idx, q)}
            className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${
              qty === q && !customQty
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-secondary text-secondary-foreground border-border hover:border-primary/60"
            }`}
          >
            {q === 1 ? "1×" : `${q}×`}
          </button>
        ))}
        <input
          type="number"
          min="0.1"
          step="0.1"
          placeholder="Custom"
          value={customQty}
          onChange={(e) => onCustom(idx, e.target.value)}
          className={`w-16 h-6 rounded border text-xs text-center bg-background px-1 outline-none transition-colors ${
            customQty ? "border-primary" : "border-border"
          } focus:border-primary`}
        />
        <span className="text-xs text-muted-foreground">×</span>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LogMealPage() {
  const today = todayStr();
  const [date, setDate] = useState(today);
  const [mealType, setMealType] = useState<string>(guessMealType());
  const [locationSlug, setLocationSlug] = useState(NO_LOCATION);

  // Global search state
  const [customSearch, setCustomSearch] = useState("");
  const [searchResult, setSearchResult] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // Manual macro fields (used for single-item result)
  const [manualCalories, setManualCalories] = useState("");
  const [manualProtein, setManualProtein] = useState("");
  const [manualCarbs, setManualCarbs] = useState("");
  const [manualFat, setManualFat] = useState("");

  // Global quantity (for single items and dining hall items)
  const [quantity, setQuantity] = useState<number>(1);
  const [customQty, setCustomQty] = useState("");

  // Per-component state for multi-item breakdown results
  // qty: multiplier per component, customQty: raw input string, selected: whether to include
  const [componentQtys, setComponentQtys] = useState<number[]>([]);
  const [componentCustomQtys, setComponentCustomQtys] = useState<string[]>([]);
  const [componentSelected, setComponentSelected] = useState<boolean[]>([]);

  const { toast } = useToast();

  // Initialise per-component state whenever breakdown changes
  useEffect(() => {
    const breakdown: BreakdownItem[] = searchResult?.breakdown ?? [];
    if (breakdown.length > 1) {
      setComponentQtys(breakdown.map(() => 1));
      setComponentCustomQtys(breakdown.map(() => ""));
      setComponentSelected(breakdown.map(() => true));
    }
  }, [searchResult]);

  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ["/api/dining/locations"],
  });

  const { data: meals = [], refetch: refetchMeals } = useQuery<any[]>({
    queryKey: ["/api/meals", date],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/meals?date=${date}`);
      return res.json();
    },
  });

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

  const [activeMeal, setActiveMeal] = useState<any>(null);

  const addItem = async (item: any) => {
    try {
      const meal = await ensureMeal();
      const qty = quantity;
      await api.addMealItem(meal.id, {
        diningItemId: item.id,
        calories: Math.round((item.calories ?? 0) * qty),
        proteinG: Math.round((item.proteinG ?? 0) * qty * 10) / 10,
        carbsG:   Math.round((item.carbsG   ?? 0) * qty * 10) / 10,
        fatG:     Math.round((item.fatG     ?? 0) * qty * 10) / 10,
        servings: qty,
        source: "wvu",
      });
      await refetchMeals();
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: `${qty === 1 ? item.name : `${item.name} ×${qty}`} added` });
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

  // ── Search ────────────────────────────────────────────────────────────────
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

  const handleBarcodeScan = async (upc: string) => {
    setShowScanner(false);
    setSearching(true);
    setSearchResult(null);
    setCustomSearch("");
    try {
      const res = await api.lookupBarcode(upc);
      if (!res.ok) {
        const err = await res.json();
        setSearchResult({ error: err.error ?? "Product not found — try entering the name manually" });
        return;
      }
      const data = await res.json();
      setCustomSearch(data.foodName ?? `UPC ${upc}`);
      setSearchResult(data);
    } catch {
      setSearchResult({ error: "Barcode lookup failed — try entering the name manually" });
    } finally {
      setSearching(false);
    }
  };

  // Auto-fill macro fields for single-item results
  useEffect(() => {
    if (searchResult && !searchResult.error) {
      const breakdown: BreakdownItem[] = searchResult.breakdown ?? [];
      // Only auto-fill the manual fields if this is NOT a multi-component result
      if (breakdown.length <= 1) {
        setManualCalories(String(searchResult.calories ?? ""));
        setManualProtein(String(searchResult.proteinG ?? ""));
        setManualCarbs(String(searchResult.carbsG ?? ""));
        setManualFat(String(searchResult.fatG ?? ""));
      }
    }
  }, [searchResult]);

  // ── Add single custom food ────────────────────────────────────────────────
  const addCustomFood = async () => {
    if (!customSearch.trim()) return;
    const name = customSearch.trim();
    const qty = quantity;
    try {
      const meal = await ensureMeal();
      await api.addMealItem(meal.id, {
        customName: name,
        calories: Math.round((parseFloat(manualCalories) || 0) * qty),
        proteinG: Math.round((parseFloat(manualProtein) || 0) * qty * 10) / 10,
        carbsG:   Math.round((parseFloat(manualCarbs)   || 0) * qty * 10) / 10,
        fatG:     Math.round((parseFloat(manualFat)     || 0) * qty * 10) / 10,
        servings: qty,
        source: searchResult && !searchResult.error ? searchResult.source : "manual_exact",
      });
      await refetchMeals();
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      resetSearch();
      toast({ title: `${qty === 1 ? name : `${name} ×${qty}`} added` });
    } catch {
      toast({ title: "Failed to add food", variant: "destructive" });
    }
  };

  // ── Add multiple components (breakdown result) ────────────────────────────
  const addBreakdownComponents = async () => {
    const breakdown: BreakdownItem[] = searchResult?.breakdown ?? [];
    const selected = breakdown.filter((_, i) => componentSelected[i]);
    if (selected.length === 0) {
      toast({ title: "Select at least one item to add", variant: "destructive" });
      return;
    }
    try {
      const meal = await ensureMeal();
      for (let i = 0; i < breakdown.length; i++) {
        if (!componentSelected[i]) continue;
        const comp = breakdown[i];
        const qty = componentQtys[i] ?? 1;
        await api.addMealItem(meal.id, {
          customName: comp.item,
          calories: Math.round(comp.calories * qty),
          proteinG: Math.round(comp.proteinG * qty * 10) / 10,
          carbsG:   Math.round(comp.carbsG   * qty * 10) / 10,
          fatG:     Math.round(comp.fatG     * qty * 10) / 10,
          servings: qty,
          source: "ai_estimated",
        });
      }
      await refetchMeals();
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      resetSearch();
      toast({ title: `${selected.length} item${selected.length > 1 ? "s" : ""} added to ${mealType}` });
    } catch {
      toast({ title: "Failed to add items", variant: "destructive" });
    }
  };

  const resetSearch = () => {
    setCustomSearch("");
    setSearchResult(null);
    setManualCalories(""); setManualProtein(""); setManualCarbs(""); setManualFat("");
    setQuantity(1); setCustomQty("");
    setComponentQtys([]); setComponentCustomQtys([]); setComponentSelected([]);
  };

  // Per-component handlers
  const handleComponentPreset = (idx: number, q: number) => {
    setComponentQtys((prev) => { const n = [...prev]; n[idx] = q; return n; });
    setComponentCustomQtys((prev) => { const n = [...prev]; n[idx] = ""; return n; });
  };
  const handleComponentCustom = (idx: number, val: string) => {
    setComponentCustomQtys((prev) => { const n = [...prev]; n[idx] = val; return n; });
    const v = parseFloat(val);
    if (!isNaN(v) && v > 0) {
      setComponentQtys((prev) => { const n = [...prev]; n[idx] = v; return n; });
    }
  };
  const handleComponentToggle = (idx: number) => {
    setComponentSelected((prev) => { const n = [...prev]; n[idx] = !n[idx]; return n; });
  };

  const currentMeal = meals.find((m: any) => m.mealType === mealType && m.date === date);
  const menuItems = menuData?.items ?? [];
  const breakdown: BreakdownItem[] = searchResult?.breakdown ?? [];
  const isMultiBreakdown = breakdown.length > 1;

  // Totals for selected breakdown components
  const selectedTotal = isMultiBreakdown
    ? breakdown.reduce(
        (acc, comp, i) => {
          if (!componentSelected[i]) return acc;
          const qty = componentQtys[i] ?? 1;
          return {
            calories: acc.calories + Math.round(comp.calories * qty),
            proteinG: acc.proteinG + comp.proteinG * qty,
            carbsG:   acc.carbsG   + comp.carbsG   * qty,
            fatG:     acc.fatG     + comp.fatG     * qty,
          };
        },
        { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
      )
    : null;

  return (
    <>
      {showScanner && (
        <BarcodeScanner
          onDetected={handleBarcodeScan}
          onClose={() => setShowScanner(false)}
        />
      )}

      <div className="p-4 md:p-6 max-w-2xl space-y-5">
        <h1 className="text-xl font-bold">Log meal</h1>

        {/* Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Date</Label>
            <DateInput value={date} onChange={setDate} testId="input-date" />
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
          <div className="space-y-1 sm:col-span-2 md:col-span-1">
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

        {/* Global quantity bar — shown only for non-multi-breakdown */}
        {!isMultiBreakdown && (
          <div className="bg-card border border-border rounded-xl px-4 py-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Portion</span>
              <div className="flex gap-1.5 flex-wrap">
                {QTY_PRESETS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    data-testid={`button-qty-${q}`}
                    onClick={() => { setQuantity(q); setCustomQty(""); }}
                    className={`px-3 py-1 rounded-lg text-sm font-medium border transition-colors ${
                      quantity === q && !customQty
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-secondary text-secondary-foreground border-border hover:border-primary"
                    }`}
                  >
                    {q === 1 ? "1×" : `${q}×`}
                  </button>
                ))}
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    placeholder="Custom"
                    value={customQty}
                    data-testid="input-qty-custom"
                    onChange={(e) => {
                      setCustomQty(e.target.value);
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v > 0) setQuantity(v);
                    }}
                    className={`w-20 h-8 rounded-lg border text-sm text-center font-medium bg-background px-2 outline-none transition-colors ${
                      customQty ? "border-primary text-primary" : "border-border text-muted-foreground"
                    } focus:border-primary`}
                  />
                  <span className="text-xs text-muted-foreground">×</span>
                </div>
              </div>
              {quantity !== 1 && (
                <span className="text-xs text-primary font-medium ml-auto">{quantity}× serving</span>
              )}
            </div>
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
                        <span className="text-xs text-muted-foreground">
                          {quantity !== 1 && item.calories != null
                            ? <><span className="line-through opacity-50">{item.calories}</span>{" "}<span className="text-primary font-medium">{Math.round(item.calories * quantity)}</span> kcal</>
                            : <>{item.calories ?? "?"} kcal</>
                          }
                        </span>
                        {item.proteinG != null && <span className="text-xs macro-protein">P:{fmt1(item.proteinG * quantity)}g</span>}
                        {item.carbsG  != null && <span className="text-xs macro-carbs">C:{fmt1(item.carbsG  * quantity)}g</span>}
                        {item.fatG    != null && <span className="text-xs macro-fat">F:{fmt1(item.fatG    * quantity)}g</span>}
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

            {/* Search row */}
            <div className="flex gap-2">
              <Input
                placeholder="e.g. 8oz salmon, 1 cup rice, broccoli"
                value={customSearch}
                onChange={(e) => setCustomSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                data-testid="input-food-search"
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={handleSearch}
                disabled={searching}
                data-testid="button-search-food"
                title="AI nutrition search"
              >
                {searching
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Search className="w-4 h-4" />}
              </Button>
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

            {/* ── Multi-component breakdown result ────────────────────────── */}
            {searchResult && !searchResult.error && isMultiBreakdown && (
              <div className="space-y-3">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold">Meal components detected</p>
                    <p className="text-xs text-muted-foreground">
                      Adjust quantities per item, then tap Add selected
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                      searchResult.confidence === "high"   ? "bg-green-500/20 text-green-400" :
                      searchResult.confidence === "medium" ? "bg-yellow-500/20 text-yellow-400" :
                      "bg-red-500/20 text-red-400"
                    }`}>{searchResult.confidence} confidence</span>
                  </div>
                </div>

                {/* Per-component rows */}
                <div className="space-y-2">
                  {breakdown.map((comp, i) => (
                    <ComponentRow
                      key={i}
                      comp={comp}
                      idx={i}
                      qty={componentQtys[i] ?? 1}
                      customQty={componentCustomQtys[i] ?? ""}
                      onPreset={handleComponentPreset}
                      onCustom={handleComponentCustom}
                      selected={componentSelected[i] ?? true}
                      onToggle={handleComponentToggle}
                    />
                  ))}
                </div>

                {/* Selected total */}
                {selectedTotal && (
                  <div className="bg-secondary rounded-lg px-3 py-2 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Selected total</span>
                    <span className="font-semibold">
                      {selectedTotal.calories} kcal · P:{fmt1(selectedTotal.proteinG)}g · C:{fmt1(selectedTotal.carbsG)}g · F:{fmt1(selectedTotal.fatG)}g
                    </span>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    onClick={addBreakdownComponents}
                    className="flex-1"
                    data-testid="button-add-components"
                  >
                    <Plus className="w-4 h-4 mr-1.5" />
                    Add selected to {mealType}
                  </Button>
                  <Button variant="outline" onClick={resetSearch} data-testid="button-reset-search">
                    Clear
                  </Button>
                </div>
              </div>
            )}

            {/* ── Single-item result ──────────────────────────────────────── */}
            {searchResult && !searchResult.error && !isMultiBreakdown && (
              <div className="bg-secondary rounded-lg p-3 space-y-2 text-sm">
                {searchResult.foodName && (
                  <p className="font-medium">{searchResult.foodName}</p>
                )}
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
              </div>
            )}

            {/* Error result */}
            {searchResult?.error && (
              <div className="rounded-lg bg-destructive/10 text-destructive p-3 text-sm">
                {searchResult.error}
              </div>
            )}

            {/* Manual macro fields — shown for single item or error */}
            {(!isMultiBreakdown || searchResult?.error) && (
              <>
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
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
