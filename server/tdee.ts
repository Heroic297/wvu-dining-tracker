/**
 * TDEE / BMR calculations and meet-prep planning logic.
 *
 * BMR: Mifflin-St Jeor equation
 *
 * ── Evidence base for peak week protocol ──────────────────────────────────────
 *
 * TIERED PROTOCOL by % bodyweight cut needed:
 *
 * Tier 0 — <1% BW (essentially at weight):
 *   No manipulation needed. Eat normally, taper training, carb load.
 *   Components: Carb load only.
 *
 * Tier 1 — 1–2% BW (small cut, 2hr or 24hr weigh-in):
 *   Gut residue reduction (low fiber, low residue foods for 3 days).
 *   No water cut, no sodium manipulation, no glycogen depletion.
 *   GI residue = ~1.5–2.5% BW. Remove with zero performance cost.
 *   Components: Gut cut + carb load.
 *
 * Tier 2 — 2–4% BW (moderate cut):
 *   Gut residue + water/sodium loading and cut.
 *   Glycogen depletion NOT needed — water/sodium alone covers 2–3% BW.
 *   Safe for both 2hr and 24hr weigh-ins within this range.
 *   Components: Gut cut + water/sodium load+cut + carb load.
 *
 * Tier 3 — 4–6% BW (significant cut, requires 24hr weigh-in):
 *   Full protocol: glycogen depletion + water/sodium + gut cut.
 *   Glycogen depletion adds ~2% BW (NIH PMC 2025).
 *   Depletion → carb load supercompensation achieves 147% baseline glycogen
 *   vs 124% without depletion (NIH glycogen study, Am J Physiol 2003).
 *   With 24hr weigh-in: full glycogen replenishment possible.
 *   With 2hr weigh-in: avoid depletion — insufficient time to reload.
 *   Components: Depletion + water/sodium load+cut + gut cut + carb load.
 *
 * Tier 4 — 6–8% BW (aggressive, 24hr weigh-in only):
 *   Same as Tier 3 but more aggressive water restriction.
 *   Evidence: 5% loss over 5 days = no performance loss with 4hr weigh-in (Ideal Nutrition).
 *   At this level: consider competing at current weight class instead.
 *
 * Tier 5 — >8% BW (unsafe):
 *   Do NOT water cut. Diet over weeks to reach weight class.
 *   Evidence: IPF 2hr weigh-in = performance decrements shown at >5% with <3hr recovery.
 *
 * ── Sodium protocol (corrected) ───────────────────────────────────────────────
 *
 * Loading days: HIGH sodium (3,000–3,500mg) + HIGH water together.
 *   → Primes aldosterone suppression (water + Na excretion mechanisms).
 * Cut day: DROP both water AND sodium abruptly.
 *   → Kidneys continue excreting at elevated rate for hours.
 * Carb load days: MODERATE-HIGH sodium (2,500–3,000mg).
 *   → Sodium is SGLT co-transporter for glucose into muscle cells.
 *   → Higher sodium = faster glycogen loading into muscle = fuller, stronger.
 * Day before: LOW sodium (1,200–1,500mg).
 *   → Final subcutaneous water reduction.
 *
 * ── Gut residue protocol ──────────────────────────────────────────────────────
 *
 * 3 days out: Switch to low-fiber, low-residue foods only.
 * High caloric density per gram of food = same calories, less gut weight.
 * No performance cost — gut weight has zero effect on strength.
 * Estimated reduction: 1.5–2.5% BW (PRS 2018 protocol).
 *
 * Sources:
 *   - NIH PMC 2025 (Short term body mass manipulation in powerlifting)
 *   - Am J Physiol Endocrinol Metab 2003 (glycogen supercompensation study)
 *   - Ideal Nutrition dietitian guide (2020)
 *   - powerliftingtowin.com (water loading mechanics)
 *   - RP Strength (5 common water cut mistakes)
 *   - Progressive Resistance Systems (gut cut protocol)
 *   - PubMed 2022 (IPF world championships weight cut survey: avg 2.9% BW)
 */
import type { User } from "../shared/schema.js";

const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
  extra_active: 1.9,
};

function calcAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

export function calcBMR(
  weightKg: number, heightCm: number, age: number, sex: "male" | "female"
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === "male" ? base + 5 : base - 161;
}

export function calcTDEE(bmr: number, activityLevel: string): number {
  return Math.round(bmr * (ACTIVITY_MULTIPLIERS[activityLevel] ?? 1.55));
}

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface DailyTargets {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  tdee: number;
  bmr: number;
  deficit: number;
  isTrainingDay?: boolean;
}

export interface PeakWeekDay {
  daysOut: number;
  label: string;
  phase: string;
  isToday: boolean;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  sodiumMg: number;
  waterL: string;
  waterTargetL: number;
  focus: string;
  guidance: string[];
  foods: string[];
  avoid: string[];
  isKeyDay: boolean;
  tier: number;         // protocol tier 0–5
}

export interface MeetPlan {
  daysOut: number;
  targetCalories: number;
  waterIntake: string;
  sodiumMg: number;
  sodiumLabel: string;   // e.g. "3,000–3,500 mg"
  carbsG: number;
  notes: string;
}

export interface WaterCutAnalysis {
  currentWeightKg: number;
  targetWeightKg: number;
  cutKg: number;
  cutPct: number;
  needsWaterCut: boolean;
  cutCategory: "none" | "minimal" | "moderate" | "aggressive" | "unsafe";
  tier: 0 | 1 | 2 | 3 | 4 | 5;
  useGlycogenDepletion: boolean;
  useGutCut: boolean;
  useWaterSodiumLoad: boolean;
  weeksToMeet: number;
  recommendation: string;
}

// ── computeDailyTargets ───────────────────────────────────────────────────────

export function computeDailyTargets(
  user: User, burnCalories?: number, date?: string, recentWeightKg?: number
): DailyTargets | null {
  if (!user.weightKg || !user.heightCm || !user.dateOfBirth || !user.sex) return null;

  // Use the most recent logged weight for all calculations when available.
  // Falls back to user.weightKg (profile weight) only if no recent weigh-in.
  const currentWeightKg = recentWeightKg ?? user.weightKg;

  const age = calcAge(user.dateOfBirth);
  const bmr = calcBMR(currentWeightKg, user.heightCm, age, user.sex as "male" | "female");
  const tdee = calcTDEE(bmr, user.activityLevel ?? "moderately_active");
  const dailyBurn = burnCalories ?? tdee;

  let isTrainingDay = false;
  if (date && user.trainingDays) {
    const dow = new Date(date).getDay();
    isTrainingDay = (user.trainingDays as number[]).includes(dow);
  }

  let targetCalories = dailyBurn;

  if (user.goalType && user.targetWeightKg && user.targetDate) {
    const daysLeft = Math.max(1, Math.round(
      (new Date(user.targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    ));
    const isLossGoal = user.goalType === "weight_loss" || user.goalType === "powerlifting_loss";
    // Automatically reserve a buffer for whichever cut method the protocol uses.
    // The diet only needs to get the athlete to the point where the cut method
    // covers the remainder — so we don\'t over-diet unnecessarily close to the meet.
    //
    // Buffer = total weight the PROTOCOL removes from the scale.
    // The diet only needs to reach (targetWeight + buffer).
    // If current weight is already below that diet target, eat at maintenance.
    //
    //   Tier 0 (<0.5%):  No protocol — buffer = 0
    //   Tier 1 (0.5-2%): Gut cut only     = 1.5% BW
    //   Tier 2 (2-4%):   Gut cut (1.5%) + water/sodium (1.0%) = 2.5% BW combined
    //   Tier 3 (4-6%):   Gut + water + glycogen depletion      = 4.0% BW combined
    //   Tier 4+ (6%+):   Full aggressive protocol              = 4.5% BW combined
    const analysis = isLossGoal && user.targetWeightKg
      ? analyzeWaterCut(user, currentWeightKg)
      : null;
    const tier = analysis?.tier ?? 0;
    const cutBufferKg = isLossGoal
      ? tier === 1 ? currentWeightKg * 0.015   // gut cut only: 1.5% BW
      : tier === 2 ? currentWeightKg * 0.025   // gut + water/sodium: 2.5% BW
      : tier >= 3  ? currentWeightKg * 0.040   // gut + water + depletion: 4.0% BW
      : 0
      : 0;
    const dietTargetKg = (user.targetWeightKg ?? 0) + cutBufferKg;
    const kgToChange = dietTargetKg - currentWeightKg;
    const dailyAdjust = (kgToChange * 7700) / daysLeft;

    if (isLossGoal) {
      targetCalories = Math.max(dailyBurn + Math.max(dailyAdjust, -1000), 1200);
    } else if (user.goalType === "weight_gain" || user.goalType === "powerlifting_gain") {
      targetCalories = dailyBurn + Math.min(dailyAdjust, 700);
    }
  }

  if (
    (user.goalType === "powerlifting_loss" || user.goalType === "powerlifting_gain") &&
    user.trainingDays && date
  ) {
    targetCalories += isTrainingDay ? 150 : -100;
  }

  targetCalories = Math.round(targetCalories);
  const proteinG = Math.round(currentWeightKg * 2.0);
  const fatCal = Math.round(targetCalories * 0.28);
  const fatG = Math.round(fatCal / 9);
  const carbsG = Math.round(Math.max(0, targetCalories - proteinG * 4 - fatCal) / 4);

  return { calories: targetCalories, proteinG, carbsG, fatG, tdee, bmr: Math.round(bmr), deficit: Math.round(targetCalories - dailyBurn), isTrainingDay };
}

// ── Water cut analysis ────────────────────────────────────────────────────────

export function analyzeWaterCut(user: User, recentWeightKg?: number): WaterCutAnalysis | null {
  if (!user.targetWeightKg || !user.meetDate) return null;

  const currentWeightKg = recentWeightKg ?? user.weightKg ?? 0;
  if (!currentWeightKg) return null;

  const cutKg = Math.max(0, currentWeightKg - user.targetWeightKg);
  const cutPct = (cutKg / currentWeightKg) * 100;
  const meetDate = new Date(user.meetDate + "T12:00:00");
  const weeksToMeet = Math.max(0, (meetDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 7));

  let tier: 0 | 1 | 2 | 3 | 4 | 5;
  let cutCategory: WaterCutAnalysis["cutCategory"];
  let needsWaterCut = false;
  let useGlycogenDepletion = false;
  let useGutCut = false;
  let useWaterSodiumLoad = false;
  let recommendation = "";

  if (cutPct < 0.5) {
    tier = 0; cutCategory = "none";
    recommendation = `You're essentially at weight (${cutKg.toFixed(2)}kg to lose). No manipulation needed — focus entirely on carb loading to maximise glycogen and come in at full strength.`;
  } else if (cutPct <= 2) {
    tier = 1; cutCategory = "minimal"; useGutCut = true;
    recommendation = `A ${cutPct.toFixed(1)}% cut (${cutKg.toFixed(1)}kg) is achievable through gut residue reduction alone — switching to low-fiber, calorie-dense foods for 3 days removes 1.5–2.5% BW from your GI tract with zero performance cost. No water cut or depletion needed.`;
  } else if (cutPct <= 4) {
    tier = 2; cutCategory = "minimal"; needsWaterCut = true; useGutCut = true; useWaterSodiumLoad = true;
    recommendation = `A ${cutPct.toFixed(1)}% cut (${cutKg.toFixed(1)}kg) is manageable with gut residue + water/sodium loading. No glycogen depletion needed — water/sodium manipulation alone covers this range with minimal performance impact. Safe for 2hr or 24hr weigh-ins.`;
  } else if (cutPct <= 6) {
    tier = 3; cutCategory = "moderate"; needsWaterCut = true; useGlycogenDepletion = true; useGutCut = true; useWaterSodiumLoad = true;
    recommendation = `A ${cutPct.toFixed(1)}% cut (${cutKg.toFixed(1)}kg) requires the full protocol: glycogen depletion + water/sodium + gut cut. Requires a 24hr weigh-in to fully reload glycogen before lifting. With depletion you'll achieve ~147% baseline glycogen at lift time (supercompensation) — you'll actually be stronger than normal if executed correctly.`;
  } else if (cutPct <= 8) {
    tier = 4; cutCategory = "aggressive"; needsWaterCut = true; useGlycogenDepletion = true; useGutCut = true; useWaterSodiumLoad = true;
    recommendation = `A ${cutPct.toFixed(1)}% cut (${cutKg.toFixed(1)}kg) is at the upper safe limit. Full protocol required. 24hr weigh-in is essential — a 2hr weigh-in at this cut would likely impair performance. Seriously consider competing at your current weight class instead.`;
  } else {
    tier = 5; cutCategory = "unsafe"; needsWaterCut = false;
    recommendation = `A ${cutPct.toFixed(1)}% cut (${cutKg.toFixed(1)}kg) is unsafe and will significantly impair performance. Evidence shows performance decrements at >5% with <3hr recovery (IPF 2hr weigh-in format). Compete at your current weight class or start a long-term diet cycle now for the next meet.`;
  }

  return { currentWeightKg, targetWeightKg: user.targetWeightKg, cutKg, cutPct, needsWaterCut, cutCategory, tier, useGlycogenDepletion, useGutCut, useWaterSodiumLoad, weeksToMeet, recommendation };
}

// ── Daily water target ────────────────────────────────────────────────────────

export function calcDailyWaterMl(user: User): number {
  if (!user.weightKg) return 3000;
  const sex = user.sex ?? "male";
  const age = user.dateOfBirth ? calcAge(user.dateOfBirth) : 30;
  const baseMlPerKg = sex === "male" ? 38 : 32;
  const ageReduction = age > 50 ? Math.min(0.20, ((age - 50) / 10) * 0.05) : 0;
  return Math.round(user.weightKg * baseMlPerKg * (1 - ageReduction) / 100) * 100;
}

// ── generateWaterCutPlan (legacy) ─────────────────────────────────────────────

export function generateWaterCutPlan(user: User, meetDate: string): MeetPlan[] {
  const target = new Date(meetDate);
  const daysToMeet = Math.round((target.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
  if (daysToMeet > 7 || daysToMeet < 0) return [];

  const weightKg = user.weightKg ?? 80;
  const bmr = user.heightCm && user.dateOfBirth && user.sex
    ? calcBMR(weightKg, user.heightCm, calcAge(user.dateOfBirth), user.sex as "male" | "female")
    : 1800;

  // Evidence-based 2hr USAPL weigh-in protocol (adjusted per user suggestion):
  // - 2 high-load days instead of 3
  // - Cut sodium day 2 out, moderate water
  // - Day 1 out: low water finished 10-12h before weigh-in, NOT zero all day
  // - Morning of: no fluids, but only 10-12h dry window
  // - Post weigh-in: 500-750ml fluid + sodium + carbs over 20-30 min
  const normalWaterLow  = parseFloat((weightKg * 0.033).toFixed(1));
  const normalWaterHigh = parseFloat((weightKg * 0.040).toFixed(1));
  const loadWaterLow    = parseFloat((weightKg * 0.055).toFixed(1));
  const loadWaterHigh   = parseFloat((weightKg * 0.060).toFixed(1));

  type DayPlan = { waterIntake: string; sodiumMg: number; sodiumLabel: string; notes: string; carbsG: number; targetCalories: number; };
  const dayMap: Record<number, DayPlan> = {
    // Days 7-5: Normal baseline — stable sodium, normal hydration
    7: {
      waterIntake: `${normalWaterLow}–${normalWaterHigh} L`,
      sodiumMg: 2650, sodiumLabel: "2,300–3,000 mg (normal baseline)",
      notes: "Normal training week. Keep hydration and sodium consistent — you need a stable baseline before the loading phase.",
      carbsG: Math.round((bmr * 1.4 * 0.45) / 4), targetCalories: Math.round(bmr * 1.4),
    },
    6: {
      waterIntake: `${normalWaterLow}–${normalWaterHigh} L`,
      sodiumMg: 2650, sodiumLabel: "2,300–3,000 mg (normal baseline)",
      notes: "Continue normal intake. Loading begins tomorrow — don't under-eat sodium today or the loading effect is blunted.",
      carbsG: Math.round((bmr * 1.4 * 0.45) / 4), targetCalories: Math.round(bmr * 1.4),
    },
    5: {
      waterIntake: `${normalWaterLow}–${normalWaterHigh} L`,
      sodiumMg: 2650, sodiumLabel: "2,300–3,000 mg (normal baseline)",
      notes: "Final normal day. Tomorrow loading starts. Eat and drink as usual — no changes yet.",
      carbsG: Math.round((bmr * 1.4 * 0.45) / 4), targetCalories: Math.round(bmr * 1.4),
    },
    // Days 4-3: Water + sodium LOAD — primes aldosterone suppression
    4: {
      waterIntake: `${loadWaterLow}–${loadWaterHigh} L`,
      sodiumMg: 3250, sodiumLabel: "3,000–3,500 mg (HIGH — load day 1)",
      notes: "Load 1: Increase both water AND sodium together. Sip consistently throughout the day — don't chug. High sodium + high water primes your kidneys for excretion.",
      carbsG: Math.round((bmr * 1.2 * 0.40) / 4), targetCalories: Math.round(bmr * 1.2),
    },
    3: {
      waterIntake: `${loadWaterLow}–${loadWaterHigh} L`,
      sodiumMg: 3250, sodiumLabel: "3,000–3,500 mg (HIGH — load day 2)",
      notes: "Load 2: Same as yesterday — high water, high sodium. Your kidneys are now in elevated excretion mode. The sharp drop tomorrow is what drives scale weight down.",
      carbsG: Math.round((bmr * 1.2 * 0.40) / 4), targetCalories: Math.round(bmr * 1.2),
    },
    // Day 2: Cut sodium sharply, moderate water reduction
    2: {
      waterIntake: "2–2.5 L",
      sodiumMg: 700, sodiumLabel: "< 600–800 mg (CUT sharply — trace amounts only)",
      notes: "Cut sodium sharply today — no added salt, no processed food, no canned food, no sports drinks. Water drops to moderate. Your kidneys are still excreting at elevated rate from loading — the sharp sodium cut accelerates excretion.",
      carbsG: Math.round(weightKg * 2.0), targetCalories: Math.round(bmr * 1.0),
    },
    // Day 1: Final reduction — last fluids 10-12h before weigh-in, NOT zero all day
    1: {
      waterIntake: "1–1.5 L total, last drink 10–12h before weigh-in",
      sodiumMg: 500, sodiumLabel: "< 400–600 mg (low, from food trace amounts)",
      notes: "Drink 1–1.5 L total today, finishing 10–12h before your weigh-in. Low-residue, lower-carb foods later in the day. If still a bit heavy morning of weigh-in: hot shower, light clothing, brief light sweating — do NOT extend dry window further. Post weigh-in: 500–750ml fluid with sodium + carbs over 20–30 min, then small frequent carb/protein meals until lift time.",
      carbsG: Math.round(weightKg * 1.0), targetCalories: Math.round(bmr * 0.85),
    },
  };

  const plans: MeetPlan[] = [];
  for (let i = 7; i >= 1; i--) {
    const d = dayMap[i];
    plans.push({ daysOut: i, targetCalories: d.targetCalories, waterIntake: d.waterIntake, sodiumMg: d.sodiumMg, sodiumLabel: d.sodiumLabel, carbsG: d.carbsG, notes: d.notes });
  }
  return plans;
}

// ── generatePeakWeekPlan ──────────────────────────────────────────────────────

/**
 * Generates a fully tiered 14-day peak week protocol calibrated to how much
 * the athlete actually needs to cut as a percentage of their bodyweight.
 *
 * Tier 0 (<1%):   Carb load only
 * Tier 1 (1–2%):  Gut cut + carb load
 * Tier 2 (2–4%):  Gut cut + water/sodium + carb load
 * Tier 3 (4–6%):  Gut cut + depletion + water/sodium + carb load (24hr required)
 * Tier 4 (6–8%):  Full aggressive protocol (24hr required)
 * Tier 5 (>8%):   Advise against — diet down instead
 */
export function generatePeakWeekPlan(
  user: User, meetDate: string, recentWeightKg?: number
): PeakWeekDay[] {
  const target = new Date(meetDate + "T12:00:00");
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);

  const daysToMeet = Math.round(
    (target.getTime() - now.setHours(12, 0, 0, 0)) / (1000 * 60 * 60 * 24)
  );
  if (daysToMeet > 14 || daysToMeet < 0) return [];

  const weightKg = recentWeightKg ?? user.weightKg ?? 80;
  const bmr = user.heightCm && user.dateOfBirth && user.sex
    ? calcBMR(weightKg, user.heightCm, calcAge(user.dateOfBirth), user.sex as "male" | "female")
    : 1800;
  const proteinG = Math.round(weightKg * 2.2);

  const analysis = analyzeWaterCut(user, recentWeightKg);
  const tier = analysis?.tier ?? 0;
  const cutKg = analysis?.cutKg ?? 0;
  const cutPct = analysis?.cutPct ?? 0;
  const useDepletion = analysis?.useGlycogenDepletion ?? false;
  const useWaterSodium = analysis?.useWaterSodiumLoad ?? false;
  const useGutCut = analysis?.useGutCut ?? false;

  // Get user's normal daily targets for Normal Prep days
  const normalTargets = computeDailyTargets(user, undefined, undefined);

  // Personalised baseline water target: 38ml/kg for males, 32ml/kg for females
  // Athletic adjustment: +10% for training days, rounded to nearest 0.1L
  // This replaces the hardcoded "3–4 L" which was calibrated for ~80kg athletes
  const baseWaterL = Math.round(weightKg * (user.sex === "female" ? 32 : 38) / 100) / 10;
  // Format as a range: target ±0.3L
  const normalWaterL = `${(baseWaterL - 0.2).toFixed(1)}–${(baseWaterL + 0.3).toFixed(1)} L`;
  const normalWaterTargetL = baseWaterL;

  const days: PeakWeekDay[] = [];

  for (let i = 14; i >= 0; i--) {
    const dayDate = new Date(target);
    dayDate.setDate(dayDate.getDate() - i);
    const dayStr = dayDate.toISOString().slice(0, 10);
    const isToday = dayStr === todayStr;

    let phase: string, focus: string, label: string;
    let calories: number, carbsG: number, fatG: number;
    let sodiumMg: number, waterL: string, waterTargetL: number;
    let guidance: string[], foods: string[], avoid: string[];
    let isKeyDay = false;

    // ── MEET DAY (day 0) ───────────────────────────────────────────────────────
    if (i === 0) {
      label = "Meet day"; phase = "Competition"; isKeyDay = true;
      focus = "Execute your plan — fuel between attempts, stay hydrated";
      // Macros drive calories — compute calories FROM macros, not independently
      carbsG = Math.round(weightKg * 4);   // 4g/kg: enough glycogen without GI distress
      fatG = Math.round(weightKg * 0.8);   // moderate fat — normal, not ultra-low
      calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
      sodiumMg = 2500; waterL = normalWaterL; waterTargetL = normalWaterTargetL;
      guidance = [
        "Pre-meet meal 2–3 hours before opening: white rice, lean protein, banana. Keep it familiar — never eat anything new on meet day.",
        "Between attempts: sip 150–250ml electrolyte drink (Pedialyte, Liquid IV). Small sips only — do NOT chug water between flights.",
        "After each flight: 30–50g fast carbs — rice cakes with honey, dates, banana, gummy bears. This tops off glycogen between attempts.",
        "Avoid all high-fiber, high-fat foods. Gastric distress kills third attempts.",
        tier >= 2
          ? `Post weigh-in priority: 500ml electrolyte solution immediately on the scale, then 100–150g carbs (white rice, rice cakes) every 2 hours. Prioritise carbs over water for glycogen replenishment.`
          : "You came in fresh without a hard cut — you have a major advantage. Stay fuelled and trust your prep.",
      ];
      foods = ["White rice", "Rice cakes + honey", "Banana / dates / dried mango", "Lean chicken or turkey", "Pedialyte / Liquid IV", "Gummy bears / energy gels"];
      avoid = ["High-fiber vegetables", "Fatty meats or cheese", "New or unfamiliar foods", "Alcohol", "Excessive caffeine (above your normal dose)"];

    // ── DAY 1 (day before meet) ────────────────────────────────────────────────
    } else if (i === 1) {
      label = "1 day out"; phase = "Final prep"; isKeyDay = true;
      // Macros drive calories for consistency
      carbsG = Math.round(weightKg * 5);   // high carbs: top off glycogen
      // Fat: very low for Tier 2+ (water cut = want minimal digestive load)
      //      normal for Tier 0-1 (no cut = no restriction needed)
      fatG = tier >= 2 ? Math.round(weightKg * 0.4) : Math.round(weightKg * 0.9);
      calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
      sodiumMg = tier >= 2 ? 1200 : 2000;
      const stopWaterHours = tier >= 3 ? 12 : (tier >= 2 ? 10 : 0);
      waterL = tier >= 2 ? `< 1 L (stop ${stopWaterHours}h before weigh-in)` : "2–3 L";
      waterTargetL = tier >= 2 ? 0.8 : 2.5;

      if (tier === 0) {
        focus = "Rest, top-off glycogen, early bedtime — you're coming in at full weight";
        guidance = [
          "Eat 4–6 small carb-dense meals: white rice, rice cakes, banana, white pasta.",
          "Sodium is normal — no restriction needed. You're not cutting.",
          "Sleep 8+ hours. Your body rebuilds overnight.",
          "Lay out everything for tomorrow: singlet, belt, wraps, attempt card, post-meet food.",
          "You have a significant advantage over athletes who cut — enter the platform at full strength and full hydration.",
        ];
      } else if (tier === 1) {
        focus = "Gut cut day 3 (final) — normal calories, low-residue foods";
        guidance = [
          "Day 3 of 3 for your gut cut. Continue the low-residue protocol: protein shakes, almonds, white rice, zero-fiber carbs.",
          "Your GI tract has been clearing for 48+ hours. By weigh-in time tomorrow, the residue from your previous high-fiber diet will largely have passed. Expected to be on weight.",
          "Hydrate normally (2–3 L). You want to be well-hydrated for lift time.",
          "Sodium stays normal — salted almonds preferred.",
          "Sleep 8+ hours. Everything is in order — trust the process.",
        ];
      } else {
        focus = `Cut water AND sodium now — stop all fluids ${stopWaterHours}h before weigh-in`;
        guidance = [
          `Stop all water intake ${stopWaterHours} hours before your weigh-in. Set a phone alarm for the exact cutoff time.`,
          `Sodium under ${sodiumMg}mg today — no added salt, no processed foods, no sports drinks.`,
          "Eat 4–6 small carb-dense meals: white rice, rice cakes with honey/jam, banana, white pasta. Keep fat very low.",
          "The carb load from yesterday and today is building your glycogen reserves. You will feel full and heavy — that is exactly correct.",
          "Lay out your post weigh-in food: electrolyte drink, rice cakes, bananas, honey. Have it ready the moment you step off the scale.",
        ];
      }
      foods = ["White rice", "Rice cakes + honey", "Banana", "White pasta (small portions)", tier >= 2 ? "Lean chicken (unsalted)" : "Lean protein"];
      avoid = ["Salt / sodium", "High-fat foods", "High-fiber vegetables", "Legumes", "New foods", "Alcohol"];

    // ── CORRECTED PROTOCOL (days 2–6) ────────────────────────────────────────
    //
    // TIER 1 (gut cut only):
    //   Days 5-6: normal eating
    //   Days 4-3-2: gut cut (low residue, normal calories) — days 3,2,1 before weigh-in
    //   Day 1: gut cut day 3, normal hydration
    //
    // TIER 2+ (gut cut + water/sodium load/cut):
    //   Days 5-6: normal eating (baseline before loading)
    //   Day 4:    LOAD 1 — high water + high sodium, gut cut day 1
    //   Day 3:    LOAD 2 — high water + high sodium, gut cut day 2
    //   Day 2:    CUT sodium sharply, moderate water, gut cut day 3
    //   Day 1:    Dry window (last drink 10-12h before weigh-in), low residue
    //
    // TIER 3+ (full depletion protocol) — same as Tier 2 but with depletion days 6-5

    } else if (i <= 3 && i >= 1) {
      label = i === 1 ? "1 day out" : `${i} days out`;
      isKeyDay = true;

      const normalDay = computeDailyTargets(user, undefined, undefined);
      const normalCals = normalDay?.calories ?? Math.round(bmr * 1.4);
      const normalCarbs = normalDay?.carbsG ?? Math.round(weightKg * 3.0);
      const normalFat   = normalDay?.fatG   ?? Math.round(weightKg * 1.0);

      if (tier <= 1) {
        // ── TIER 0-1: Pure gut cut days ─────────────────────────────────────
        phase = i === 3 ? "Gut cut — day 1" : i === 2 ? "Gut cut — day 2" : "Gut cut — day 3";
        calories = normalCals; carbsG = normalCarbs; fatG = normalFat;
        sodiumMg = 2500; waterL = normalWaterL; waterTargetL = normalWaterTargetL;
        focus = i === 3
          ? "Gut cut day 1 — switch to low-residue foods, same total calories"
          : i === 2
          ? "Gut cut day 2 — continue low-residue eating"
          : "Gut cut day 3 (final) — normal calories, low-residue foods only";
        guidance = i === 3 ? [
          `Day 1 of your 3-day gut cut. Switch ALL food sources to low-residue items while keeping total intake at ~${normalCals} kcal.`,
          "Formula: protein shakes + salted almonds (60% of calories), white rice / gummy bears / honey / white bread (40%). Near-zero gut weight.",
          "Do NOT reduce calories — weight loss comes from clearing GI residue (~1.5–2.5% BW), not eating less. Cutting calories now drains energy before the platform.",
          "Sodium stays normal (salted almonds). Hydrate normally.",
          "Expected: GI transit is 24–72h. By weigh-in most prior high-fiber residue will have cleared.",
        ] : i === 2 ? [
          "Gut cut day 2. Same foods as yesterday — protein shakes, almonds, white rice, zero-fiber carbs.",
          "Scale may be moving — that's gut residue clearing, not muscle loss.",
          `Hydrate normally (${normalWaterL}). You want full hydration at lift time.`,
          "Sodium normal — keep eating salted almonds.",
        ] : [
          "Final gut cut day. Continue low-residue protocol through weigh-in.",
          "GI tract has been clearing for 48+ hours. By weigh-in time you should be on weight or very close.",
          "Hydrate normally today — you'll be at full hydration for the platform.",
          "Lay out everything tonight: singlet, belt, wraps, attempt card, post-weigh-in food.",
        ];
        foods = ["Protein shakes (whey/casein)", "Salted almonds", "White rice / cream of rice", "Gummy bears / white bread / honey", "Low-fat Greek yogurt"];
        avoid = ["Oats / bran / whole grains", "Raw vegetables", "Beans / legumes", "High-fat foods", "Alcohol"];

      } else if (tier === 2) {
        // ── TIER 2: Load 2 (day 3), Sodium cut (day 2), Dry window (day 1)
        // Gut cut runs alongside ALL three days — low-residue carb sources only
        const loadWaterL = `${(weightKg * 0.055).toFixed(1)}–${(weightKg * 0.060).toFixed(1)} L`;
        const loadWaterTarget = weightKg * 0.057;

        if (i === 3) {
          // Load day 2 — high water + sodium, gut cut day 1
          // Calories stay at TDEE — only water/sodium and food SOURCES change (low-residue)
          phase = "Water load 2 + Gut cut day 1";
          const fatCalLoad3 = Math.round(bmr * 1.55 * 0.28);
          fatG   = Math.round(fatCalLoad3 / 9);
          carbsG = Math.round(Math.max(0, bmr * 1.55 - proteinG * 4 - fatCalLoad3) / 4);
          calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
          sodiumMg = 3250; waterL = loadWaterL; waterTargetL = loadWaterTarget;
          focus = `Load day 2: ${loadWaterL} water + 3,000–3,500mg sodium. Gut cut day 1 — low-residue foods only.`;
          guidance = [
            `Drink ${loadWaterL} consistently all day — sip every 30–60 min. High water + high sodium primes kidney excretion.`,
            `Sodium target: 3,000–3,500mg. This is intentional — loading both together primes the excretion mechanism for tomorrow's sharp cut.`,
            "GUT CUT DAY 1: All carbs must be low-residue — white rice, rice cakes, white bread, protein shakes, almonds. No oats, no vegetables, no beans.",
            "Carbs at normal levels (not a high carb day — save the carb load for after weigh-in).",
            "Note any overnight weight changes. The loading effect combined with the gut cut will start moving the scale.",
          ];
          foods = ["Protein shakes", "Salted almonds", "White rice", "Rice cakes + honey", "Lean chicken (unsalted)", "Banana"];
          avoid = ["Oats / bran / whole grains", "Raw vegetables", "Beans / legumes", "Processed/canned food (hidden sodium)"];
        } else if (i === 2) {
          // Sodium cut + moderate water, gut cut day 2
          // Calories stay at TDEE — only sodium/water change, not total food intake
          phase = "Sodium cut + Gut cut day 2";
          const fatCalCut = Math.round(bmr * 1.55 * 0.28);
          fatG   = Math.round(fatCalCut / 9);
          carbsG = Math.round(Math.max(0, bmr * 1.55 - proteinG * 4 - fatCalCut) / 4);
          calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
          sodiumMg = 700; waterL = "2–2.5 L"; waterTargetL = 2.25;
          focus = "Cut sodium sharply today. Moderate water. Gut cut day 2 — low-residue only.";
          guidance = [
            "CUT SODIUM sharply — target < 600–800mg total. No added salt, no processed food, no canned food, no sports drinks with sodium.",
            "Water drops to 2–2.5 L today. Your kidneys are still in high-excretion mode from the loading days — the sodium cut drives rapid water excretion.",
            "GUT CUT DAY 2: Continue low-residue foods — protein shakes, almonds, white rice, rice cakes, white bread only.",
            "This is the day the scale moves most. Weigh yourself morning and evening to track progress.",
            "Lay out your post weigh-in kit: electrolyte drink, rice cakes, banana, honey. Have it ready at the venue.",
          ];
          foods = ["Protein shakes", "Unsalted almonds", "White rice (plain)", "Rice cakes (unsalted)", "Egg whites", "Chicken breast (fresh, no seasoning)"];
          avoid = ["Any added salt", "Processed/canned food", "Restaurant food", "Sports drinks", "Oats / vegetables / beans"];
        } else {
          // Day 1 — dry window + gut cut day 3
          // Slight calorie reduction (~85% TDEE) — athlete can't eat much with restricted fluids
          phase = "Dry window + Gut cut day 3";
          const day1Cals = Math.round(bmr * 1.55 * 0.85);
          const fatCalDay1 = Math.round(day1Cals * 0.28);
          fatG   = Math.round(fatCalDay1 / 9);
          carbsG = Math.round(Math.max(0, day1Cals - proteinG * 4 - fatCalDay1) / 4);
          calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
          sodiumMg = 500; waterL = "1–1.5 L total, stop 10–12h before weigh-in"; waterTargetL = 1.25;
          focus = "Last fluids 10–12h before weigh-in. Gut cut day 3 — low-residue all day.";
          guidance = [
            "Drink 1–1.5 L total today, finishing 10–12 hours before your weigh-in. At a 4:30 PM weigh-in that means your last real drink is around 4–6 AM.",
            "GUT CUT DAY 3: Low-residue foods only — protein shakes, almonds, white rice, rice cakes. Keep portions smaller toward evening.",
            "Sodium under 400–600mg — trace amounts from food only. No added salt.",
            "If you're still slightly over in the morning: hot shower, light clothing, brief light activity (bike warmup). Do NOT extend your dry window — 10–12h is the limit for a 2-hour recovery.",
            "Post weigh-in (critical): 500–750ml electrolyte drink + 50g fast carbs immediately. Then 100–150g carbs every 60–90 min until lift. Prioritise carbs over just water.",
          ];
          foods = ["Protein shakes (small portions)", "Unsalted almonds", "White rice cakes", "Small banana"];
          avoid = ["Any added fluids after cutoff", "Salt", "High-fiber foods", "Alcohol"];
        }

      } else {
        // ── TIER 3+: Full depletion protocol — similar to Tier 2 but carb load days 3-2
        // Day 3: Carb load day 1 + gut cut day 1
        // Day 2: Carb load day 2 (peak) + gut cut day 2
        // Day 1: Moderate carbs, dry window, gut cut day 3
        if (i === 3) {
          phase = "Carb load day 1 + Gut cut day 1";
          carbsG = Math.round(weightKg * 6);
          fatG   = Math.round(weightKg * 0.5);
          calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
          sodiumMg = 3000; waterL = normalWaterL; waterTargetL = normalWaterTargetL;
          focus = `Carb load day 1 — ${carbsG}g carbs. Gut cut day 1. Sodium moderate-high for SGLT transport.`;
          guidance = [
            `Target ${carbsG}g carbs across 5–6 meals — ALL low-fiber: white rice, rice cakes, white bread, banana, honey. This is gut cut day 1 so no high-fiber foods regardless.`,
            `Sodium ${sodiumMg}mg — sodium is a co-transporter (SGLT) that drives glucose into muscle cells. High sodium = faster glycogen loading.`,
            "Fat under 50g — fat competes with glycogen synthesis. Keep meals almost fat-free.",
            "You may feel flat after depletion. The fullness arrives over the next 24–48h as glycogen loads.",
          ];
          foods = ["White rice (large portions)", "Rice cakes + honey/jam", "White bread", "Banana / dried mango", "Lean chicken (unsalted)", "Low-fat Greek yogurt"];
          avoid = ["Oats / brown rice", "Vegetables (gas/bloating)", "Cheese / nuts / avocado", "Alcohol"];
        } else if (i === 2) {
          phase = "Carb load day 2 + Gut cut day 2";
          carbsG = Math.round(weightKg * 7);
          fatG   = Math.round(weightKg * 0.5);
          calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
          sodiumMg = 2500; waterL = `${(normalWaterTargetL - 0.4).toFixed(1)}–${normalWaterTargetL.toFixed(1)} L`; waterTargetL = normalWaterTargetL - 0.4;
          focus = `Final carb load — ${carbsG}g carbs. Gut cut day 2. Muscles should feel full and firm.`;
          guidance = [
            `Target ${carbsG}g carbs — all low-fiber. Spread across 6 meals.`,
            "Muscles should feel noticeably full and firm tonight. That tightness is glycogen supercompensation working.",
            `Sodium ${sodiumMg}mg — still moderate-high for continued SGLT loading.`,
            "GUT CUT DAY 2: Same low-residue sources as yesterday — no raw vegetables, no oats, no beans.",
          ];
          foods = ["White rice (large portions)", "Rice cakes + honey", "White pasta", "Banana / dates", "Low-fat Greek yogurt", "White bread + turkey"];
          avoid = ["Oats / brown rice / quinoa", "Broccoli / leafy greens", "Cheese / nuts / avocado", "Alcohol"];
        } else {
          phase = "Final prep + Gut cut day 3";
          carbsG = Math.round(weightKg * 5);
          fatG   = Math.round(weightKg * 0.4);
          calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
          sodiumMg = 1200; waterL = "< 1 L (stop 12h before weigh-in)"; waterTargetL = 0.8;
          focus = "Stop water 12h before weigh-in. Gut cut day 3. Low sodium, low residue.";
          guidance = [
            "Stop all fluid intake 12 hours before weigh-in. Set a phone alarm for the exact cutoff.",
            "GUT CUT DAY 3: Low-residue foods only. Small portions, nothing heavy.",
            `Sodium under ${sodiumMg}mg — final subcutaneous water reduction.`,
            "Post weigh-in: 500–750ml electrolyte drink immediately, then 100–150g carbs every hour until lift.",
          ];
          foods = ["Rice cakes (small)", "Lean protein (small portion)", "Banana (half)"];
          avoid = ["Fluids after cutoff", "Salt", "High-fiber foods", "Alcohol"];
        }
      }

    // ── DAY 4: LOAD 1 (Tier 2+) or NORMAL (Tier 0-1) ─────────────────────────
    } else if (i === 4) {
      label = "4 days out"; isKeyDay = tier >= 2;
      const normalDay4 = computeDailyTargets(user, undefined, undefined);

      if (tier >= 2 && useWaterSodium) {
        // CORRECTED: Day 4 is now LOAD 1, not the cut day
        const loadWaterL = `${(weightKg * 0.055).toFixed(1)}–${(weightKg * 0.060).toFixed(1)} L`;
        const loadWaterTarget = weightKg * 0.057;
        // Calories stay at TDEE on load days — only water/sodium change, not food intake
        const fatCalLoad = Math.round(bmr * 1.55 * 0.28);
        fatG   = Math.round(fatCalLoad / 9);
        carbsG = Math.round(Math.max(0, bmr * 1.55 - proteinG * 4 - fatCalLoad) / 4);
        calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
        phase = "Water load 1";
        sodiumMg = 3250; waterL = loadWaterL; waterTargetL = loadWaterTarget;
        focus = `Load day 1: ${loadWaterL} water + 3,000–3,500mg sodium together`;
        guidance = [
          `Drink ${loadWaterL} consistently throughout the day — sip every 30–60 minutes, don't chug.`,
          "SODIUM must be HIGH (3,000–3,500mg). Loading water AND sodium together is what primes the excretion mechanism — loading water alone without sodium significantly blunts the effect.",
          "Normal eating today. Sodium comes from salted foods — you don't need to add table salt to everything, just eat normally salted food and track it.",
          useDepletion
            ? `Carbs at ${carbsG}g — glycogen depletion is active from prior days. Tomorrow is load day 2, same protocol.`
            : `Carbs at ${carbsG}g — normal level, no depletion needed at ${cutPct.toFixed(1)}%.`,
          "Take a potassium + magnesium supplement (no sodium) to prevent electrolyte imbalance at high water volumes.",
        ];
        foods = ["Lean proteins", "Rice", "Bread", "Salted nuts/snacks", "Vegetables", "Fruit"];
        avoid = ["Alcohol", "Diuretics (caffeine in excess)", "Low-sodium diet foods"];
      } else {
        // Tier 0-1: Normal day — gut cut starts tomorrow
        calories = normalDay4?.calories ?? Math.round(bmr * 1.4);
        carbsG = normalDay4?.carbsG ?? Math.round(weightKg * 3.0);
        fatG = normalDay4?.fatG ?? Math.round(weightKg * 1.0);
        phase = "Normal prep";
        sodiumMg = 2000; waterL = normalWaterL; waterTargetL = normalWaterTargetL;
        focus = "Normal eating — gut cut starts tomorrow (day 3 out)";
        guidance = [
          "Normal eating today. Gut cut begins tomorrow.",
          "Begin mentally preparing to switch food sources tomorrow — protein shakes, almonds, white rice, zero-fiber carbs.",
          "Hydrate well. Good baseline hydration makes the gut cut easier.",
          "Rest day. No heavy training.",
          "Mental prep: review openers, confirm rack heights, visualise attempts.",
        ];
        foods = ["Lean proteins", "Rice", "Oats (last day)", "Sweet potato", "Fruit", "Vegetables"];
        avoid = ["Heavy training", "Alcohol"];
      }

    // ── DAYS 5–6: NORMAL PREP for all tiers (except Tier 3+ depletion) ────────
    } else if (i <= 6) {
      label = `${i} days out`;
      isKeyDay = useDepletion; // only key for Tier 3+ depletion days
      const normalGut56 = computeDailyTargets(user, undefined, undefined);

      if (useDepletion && tier >= 3) {
        // Tier 3+: Glycogen depletion days 5-6
        carbsG = Math.round(weightKg * 0.8);
        fatG   = Math.round(weightKg * 0.8);
        calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
        phase = "Depletion";
        sodiumMg = 3500;
        const loadL = Math.round(weightKg * 0.1 * 10) / 10;
        waterL = `${loadL} L (100ml/kg)`; waterTargetL = loadL;
        focus = i === 6
          ? `Depletion day 1: low carb (${carbsG}g) + water load + high sodium`
          : `Depletion day 2: low carb + peak water load (${waterL})`;
        guidance = [
          `Carbs very low at ${carbsG}g to deplete glycogen stores. Protein and fat fill caloric needs.`,
          `Drink ${waterL} today + sodium at ${sodiumMg}mg — loading begins alongside depletion.`,
          "Glycogen depletion + carb load supercompensation: depletion group reaches 147% baseline glycogen vs 124% without (NIH glycogen study). You will be stronger than normal on meet day.",
          "Take potassium + magnesium supplement — high water volumes risk diluting electrolytes.",
          i === 5 ? "Loading continues tomorrow (Day 4). Stay consistent." : "Day 1 of depletion. You may feel flat and tired — this is normal and temporary.",
        ];
        foods = ["Chicken breast", "Egg whites", "Fish", "Low-fat cottage cheese", "Green vegetables", "Unsalted rice cakes (tiny amounts)"];
        avoid = ["Rice / bread / pasta / fruit (high carb)", "Sports drinks", "Sugary foods"];
      } else {
        // All other tiers: normal eating days
        calories = normalGut56?.calories ?? Math.round(bmr * 1.4);
        carbsG = normalGut56?.carbsG ?? Math.round(weightKg * 3.5);
        fatG = normalGut56?.fatG ?? Math.round(weightKg * 1.0);
        phase = "Normal prep";
        sodiumMg = 2500; waterL = normalWaterL; waterTargetL = normalWaterTargetL;
        focus = i === 6
          ? tier >= 2 ? "Normal eating — loading begins in 2 days (day 4 out)" : "Normal eating — gut cut begins in 3 days"
          : tier >= 2 ? "Normal eating — loading begins tomorrow (day 4 out)" : "Normal eating — gut cut begins in 2 days";
        guidance = [
          "Normal eating today. No restrictions yet.",
          tier >= 2
            ? `Water + sodium LOADING starts on Day 4 (${i === 6 ? "2 days from now" : "tomorrow"}). Until then keep sodium and hydration at your normal baseline — you need a stable baseline for loading to work.`
            : `Gut cut begins Day 3 (${i - 3} day${i - 3 > 1 ? "s" : ""} from now). Enjoy normal foods now — you'll switch to shakes and almonds soon.`,
          "Hydrate at your normal level. Good baseline hydration makes everything downstream easier.",
          "Focus on sleep quality. Growth hormone peaks during deep sleep.",
          "Light training only if planned. Save energy for the platform.",
        ];
        foods = ["Lean proteins", "Rice", "Oats", "Sweet potato", "Fruit", "Vegetables"];
        avoid = ["Alcohol", "Excess junk food"];
      }

    // ── DAY 7 (transition) ─────────────────────────────────────────────────────
    // ── DAY 7 (transition) ─────────────────────────────────────────────────────
    } else if (i === 7) {
      label = "7 days out"; phase = "Transition"; isKeyDay = true;
      const normal7 = computeDailyTargets(user, undefined, undefined);
      calories = normal7?.calories ?? Math.round(bmr * 1.4);
      carbsG = normal7?.carbsG ?? Math.round(weightKg * 2.5);
      fatG = normal7?.fatG ?? Math.round(weightKg * 1.0);
      sodiumMg = 2500; waterL = `${(normalWaterTargetL + 0.8).toFixed(1)}–${(normalWaterTargetL + 1.3).toFixed(1)} L`; waterTargetL = normalWaterTargetL + 1.0;
      focus = "Final heavy session — begin peak week mindset";
      guidance = [
        "Complete your last heavy training session today or tomorrow at the latest. After this, training tapers.",
        analysis && cutKg > 0
          ? `Your cut analysis: ${cutKg.toFixed(1)}kg (${cutPct.toFixed(1)}%) to reach ${user.targetWeightKg}kg — Tier ${tier} protocol. ${analysis.recommendation}`
          : "You're at or near your target weight — no cut needed. Full strength, full fuel.",
        "Begin logging your morning weight every day. That daily number drives your protocol adjustments in this app.",
        useGutCut ? "Start planning your low-fiber food sources for days 6–4. Identify protein shakes, white rice, and low-residue foods you'll use." : "Normal eating — no restrictions yet.",
        "Start drinking 4–5 L daily now. Consistent high intake is the foundation that makes water loading effective.",
      ];
      foods = ["Lean proteins", "Rice", "Oats", "Sweet potato", "Fruit", "Vegetables"];
      avoid = ["Alcohol", "Excess salt", "Junk food"];

    // ── DAYS 8–14: NORMAL PREP ─────────────────────────────────────────────────
    } else {
      label = `${i} days out`; phase = "Normal prep";
      const normal = computeDailyTargets(user, undefined, undefined);
      calories = normal?.calories ?? Math.round(bmr * 1.4);
      carbsG = normal?.carbsG ?? Math.round(weightKg * 3.5);
      fatG = normal?.fatG ?? Math.round(weightKg * 1.0);
      sodiumMg = 2500; waterL = normalWaterL; waterTargetL = normalWaterTargetL;
      focus = "Stay consistent — hit your macros, sleep 8 hours, reduce junk";
      guidance = [
        "Continue your normal deficit. Don't panic and crash diet — it's counterproductive this close to a meet.",
        "Focus on sleep quality. Growth hormone peaks during deep sleep and is critical for strength recovery.",
        "Keep training volume moderate. This is not the time for PRs in training.",
        "Begin winding down processed food and alcohol to give your gut a clean baseline before peak week.",
        "Log your weight every morning. The data from these days informs your peak week protocol.",
      ];
      foods = ["Lean proteins", "Complex carbs", "Fruits and vegetables", "Whole grains"];
      avoid = ["Alcohol", "Excess junk food"];
    }

    days.push({ daysOut: i, label, phase, isToday, calories, proteinG, carbsG, fatG, sodiumMg, waterL, waterTargetL, focus, guidance, foods, avoid, isKeyDay, tier });
  }

  return days;
}
