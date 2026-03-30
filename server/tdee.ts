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
  user: User, burnCalories?: number, date?: string
): DailyTargets | null {
  if (!user.weightKg || !user.heightCm || !user.dateOfBirth || !user.sex) return null;

  const age = calcAge(user.dateOfBirth);
  const bmr = calcBMR(user.weightKg, user.heightCm, age, user.sex as "male" | "female");
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
    const dietTargetKg = user.enableWaterCut && isLossGoal
      ? user.targetWeightKg + user.weightKg * 0.01
      : user.targetWeightKg;
    const kgToChange = dietTargetKg - user.weightKg;
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
  const proteinG = Math.round(user.weightKg * 2.0);
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

  if (cutPct < 1) {
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

  const plans: MeetPlan[] = [];
  for (let i = 7; i >= 1; i--) {
    let targetCalories: number, carbsG: number, waterIntake: string, notes: string;
    if (i === 7) { targetCalories = Math.round(bmr * 1.4); carbsG = Math.round((targetCalories * 0.45) / 4); waterIntake = "4–5 L"; notes = "Normal training week. Begin hydrating consistently."; }
    else if (i >= 5) { targetCalories = Math.round(bmr * 1.2); carbsG = Math.round((targetCalories * 0.35) / 4); waterIntake = i === 6 ? "5–6 L" : "6–7 L"; notes = i === 6 ? "Begin water + sodium loading together." : "Peak water + sodium loading (both high today)."; }
    else if (i >= 3) { targetCalories = Math.round(bmr * 1.0); carbsG = i === 4 ? Math.round(weightKg * 1.5) : 30; waterIntake = i === 4 ? "3–4 L (begin taper)" : "1–2 L"; notes = i === 4 ? "Cut both water AND sodium abruptly today." : "Very low water and sodium."; }
    else if (i === 2) { targetCalories = Math.round(bmr * 0.85); carbsG = 20; waterIntake = "< 1 L"; notes = "Minimal water and food. Stop all water 10–12h before weigh-in."; }
    else { targetCalories = Math.round(bmr * 0.75); carbsG = 0; waterIntake = "0 until after weigh-in"; notes = "Nothing until weigh-in. Post weigh-in: 500ml electrolyte drink immediately."; }
    plans.push({ daysOut: i, targetCalories, waterIntake, carbsG, notes });
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
      calories = Math.round(bmr * 1.5);
      carbsG = Math.round(weightKg * 4);
      fatG = Math.round(calories * 0.12 / 9);
      sodiumMg = 2500; waterL = "3–4 L"; waterTargetL = 3.5;
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
      calories = Math.round(bmr * 1.2);
      carbsG = Math.round(weightKg * 5);
      fatG = Math.round(calories * 0.08 / 9);
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

    // ── DAYS 2–3: Carb load (Tier 2+) OR Gut cut day 1–2 (Tier 1) OR Normal (Tier 0) ──────
    } else if (i <= 3) {
      label = `${i} days out`; isKeyDay = true;

      if (tier <= 1) {
        // ── TIER 0–1: Gut cut days 1–2 (days 3–2 out) — normal calories, low-residue foods
        // Research: gut cut is 3 days out to 1 day out. GI transit = 24–72h.
        // No carb loading needed — no depletion occurred, glycogen is intact.
        phase = "Gut cut";
        const normalGutLoad = computeDailyTargets(user, undefined, undefined);
        calories = normalGutLoad?.calories ?? Math.round(bmr * 1.4);
        carbsG = normalGutLoad?.carbsG ?? Math.round(weightKg * 3.0);
        fatG = normalGutLoad?.fatG ?? Math.round(weightKg * 1.0);
        sodiumMg = 2500; waterL = "3–4 L"; waterTargetL = 3.5;
        focus = i === 3
          ? tier === 0
            ? "Gut cut starts — switch to low-residue foods, same calories"
            : "Gut cut day 1 — switch to low-residue foods, same total calories"
          : "Gut cut day 2 — continue low-residue eating";
        guidance = i === 3
          ? [
              `Day 1 of your 3-day gut cut (days 3, 2, 1 before weigh-in). Switch all food sources to low-residue items while keeping your total calorie intake at ~${calories} kcal.`,
              "Formula: 60% of calories from protein shakes + almonds (half each), 40% from zero-fiber/sugary foods (white rice, gummy bears, honey, sugary cereal). This combination has essentially zero gut weight.",
              "Do NOT reduce calories. The weight loss comes from clearing GI residue (~1.5–2.5% BW), not from eating less. Cutting calories now would drain energy before competition.",
              "Sodium stays normal — salted almonds are recommended. Only cut sodium if combining with a water cut (not needed at your cut level).",
              "Expected result: GI transit time is 24–72 hours. By weigh-in day, most of the residue from your previous high-fiber eating will have cleared.",
            ]
          : [
              "Continue day 2 of gut cut. Same foods as yesterday: protein shakes, almonds, white rice, zero-fiber carbs.",
              "GI clearing is progressing. You may notice the scale moving without any strength loss — that's gut residue exiting, not muscle.",
              "Hydrate normally (3–4 L). You want full hydration heading into meet day.",
              "Sodium normal. Keep eating salted almonds rather than unsalted.",
              "Lay out your kit tonight: singlet, belt, wraps, attempt card, post-weigh-in food.",
            ];
        foods = ["Protein shakes (whey/casein)", "Salted almonds", "White rice / cream of rice", "Gummy bears / white bread / honey", "Low-fat Greek yogurt", "Bananas"];
        avoid = ["Oats / bran / whole grains", "Raw vegetables", "Beans / legumes", "High-fat foods", "Alcohol"];
      } else {
        // ── TIER 2+: Carb load — follows depletion phase
        phase = "Carb load";
        const carbPerKg = i === 3 ? 6 : 7;
        carbsG = Math.round(weightKg * carbPerKg);
        fatG = Math.round(weightKg * 0.5);
        calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
        // Sodium moderate-high: co-transports glucose into muscle via SGLT mechanism
        sodiumMg = i === 3 ? 3000 : 2500;
        waterL = tier >= 2 ? (i === 3 ? "3–4 L" : "2–3 L") : "3–4 L";
        waterTargetL = tier >= 2 ? (i === 3 ? 3.5 : 2.5) : 3.5;
        focus = i === 3
          ? `Carb load starts — ${carbsG}g carbs today (${carbPerKg}g/kg). Sodium stays moderate-high.`
          : `Final carb load day — ${carbsG}g carbs today. Muscles should feel full.`;
        guidance = [
          `Target ${carbsG}g carbohydrates across 5–6 meals (~${Math.round(carbsG / 5)}g per meal). This is a lot — spread it evenly.`,
          "LOW-FIBER carbs only: white rice, white bread, rice cakes, cream of rice, bananas, white pasta, honey. No oats, no brown rice.",
          `Sodium at ${sodiumMg}mg today. This is intentional — sodium acts as a co-transporter (SGLT) that drives glucose AND water into muscle cells. Higher glycogen storage = harder, fuller muscles.`,
          "Fat must be under 50g today. Fat slows digestion and competes with glycogen synthesis. Keep meals almost fat-free.",
          i === 2
            ? "Your muscles should feel noticeably full and firm by tonight. That tightness is glycogen supercompensation — you are now stronger than you were a week ago."
            : "You may feel flat after depletion days — this is normal. The fullness arrives over the next 48 hours as glycogen loads.",
        ];
        foods = ["White rice (large portions)", "Rice cakes + honey or jam", "White pasta (small fat)", "Cream of rice", "Bananas / dried mango", "Low-fat Greek yogurt", "White bread + turkey (no cheese)"];
        avoid = ["Oats / brown rice / quinoa (high fiber)", "Broccoli / leafy greens (gas, bloating)", "Cheese / nuts / avocado (fat)", "Alcohol"];
      }

    // ── WATER + SODIUM CUT (day 4) — Tier 2+ only ────────────────────────────
    } else if (i === 4) {
      label = "4 days out"; isKeyDay = tier >= 2;
      // Macros set per-branch below
      carbsG = 0; fatG = 0; calories = 0;

      if (tier >= 2 && useWaterSodium) {
        // Water/sodium cut day: low carb to support depletion or moderate
        carbsG = useDepletion ? Math.round(weightKg * 0.8) : Math.round(weightKg * 1.5);
        fatG = Math.round(weightKg * 0.7);
        calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
        phase = "Water load";
        sodiumMg = 600;
        waterL = "2–3 L (tapering)"; waterTargetL = 2.5;
        focus = "Cut both water AND sodium abruptly — kidneys still excreting at peak rate";
        guidance = [
          "Stop both water loading AND sodium loading today. Abrupt cessation is key — your kidneys are still in high-excretion mode from the loading days and will continue expelling water and sodium for hours.",
          `Limit water to 2–3 L total today, tapering toward evening. Sodium under ${sodiumMg}mg — no added salt, no processed food, no canned food.`,
          "This is the day the scale moves. You'll urinate frequently. Weigh yourself morning and evening.",
          useDepletion
            ? `Continue low carb (${carbsG}g) to maintain glycogen depletion. Tomorrow starts the carb load — the lower your glycogen is today, the higher the supercompensation ceiling.`
            : `Carbs moderate at ${carbsG}g — no depletion needed at your cut level.`,
          "Note any unusually large overnight weight drop — this confirms the loading phase worked and your kidneys are in high-excretion mode.",
        ];
        foods = ["Chicken breast (fresh, unsalted)", "Egg whites", "Fish (not canned)", "Cucumber", "Small amounts of green vegetables"];
        avoid = ["Any added salt", "Processed meats", "Canned/packaged food", "Restaurant food", "Sports drinks with sodium"];
      } else {
        // Tier 0–1: rest day before carb load — normal calories
        const normalDay4 = computeDailyTargets(user, undefined, undefined);
        calories = normalDay4?.calories ?? Math.round(bmr * 1.4);
        carbsG = normalDay4?.carbsG ?? Math.round(weightKg * 3.0);
        fatG = normalDay4?.fatG ?? Math.round(weightKg * 1.0);
        phase = "Transition";
        sodiumMg = 2000; waterL = "3–4 L"; waterTargetL = 3.5;
        focus = "Active rest — prepare mentally, eat clean, carb load starts tomorrow";
        guidance = [
          "Rest day. No training. Save all energy for the platform.",
          "Eat clean whole foods. Begin reducing fiber intake to start clearing GI residue before the carb load.",
          "Sodium stays at normal levels — no manipulation needed at your cut percentage.",
          "Hydrate well. You need water to effectively store tomorrow's carb load.",
          "Mental prep: review openers, confirm rack heights, visualise attempts.",
        ];
        foods = ["Lean protein", "White rice (moderate)", useGutCut ? "Protein shake, white bread (low fiber)" : "Vegetables", "Fruit"];
        avoid = ["Heavy training", "Salty junk food", "Alcohol"];
      }

    // ── WATER + SODIUM LOADING (days 5–6) — Tier 2+ only ─────────────────────
    } else if (i <= 6) {
      label = `${i} days out`;
      isKeyDay = useWaterSodium;
      // Macros set per-branch below — gut cut days use normal targets, loading days use protocol values
      carbsG = 0; fatG = 0; calories = 0; // will be overwritten below

      if (useWaterSodium) {
        // Loading days: macros set by protocol
        carbsG = useDepletion ? Math.round(weightKg * 0.8) : Math.round(weightKg * 2.5);
        fatG = Math.round(weightKg * 0.8);
        calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
        phase = useDepletion ? "Depletion" : "Water load";
        // HIGH sodium with HIGH water — primes both ADH and aldosterone
        sodiumMg = 3500;
        waterL = i === 6 ? "5–6 L" : "6–7 L";
        waterTargetL = i === 6 ? 5.5 : 6.5;
        focus = i === 6
          ? `Begin water + sodium loading simultaneously — drink ${waterL} with ${sodiumMg}mg sodium`
          : `Peak loading day — ${waterL} water + ${sodiumMg}mg sodium`;
        guidance = [
          `Drink ${waterL} today spread evenly — set a timer for every 2 hours as a reminder.`,
          `SODIUM MUST BE HIGH (${sodiumMg}mg). This is correct and intentional. Water + sodium loading together suppresses both ADH and aldosterone. When you cut both on Day 4, your kidneys keep excreting at the elevated rate — that's how you shed water quickly. Loading only water without sodium blunts this response.`,
          i === 5 ? "Peak loading day — after today both water AND sodium get cut simultaneously tomorrow." : "Start of the loading phase. Your body will begin adjusting kidney excretion rates.",
          useDepletion
            ? `Carbs very low (${carbsG}g/day). Glycogen depletion is active. On Day 3 you start the carb load — the emptier your glycogen is now, the more you can load (NIH glycogen supercompensation research: depletion group reached 147% baseline vs 124% without depletion).`
            : `Carbs moderate at ${carbsG}g — no depletion needed at your cut level (${cutPct.toFixed(1)}%).`,
          "Take a potassium + magnesium electrolyte supplement (no sodium). High water volumes can dilute electrolytes — hyponatremia is a real risk at these volumes.",
        ];
        foods = useDepletion
          ? ["Chicken breast", "Egg whites", "Fish", "Low-fat cottage cheese", "Green vegetables", "Unsalted rice cakes (small)"]
          : ["Lean proteins", "Rice", "Oats", "Vegetables", "Fruit"];
        avoid = useDepletion
          ? ["Rice / bread / pasta (high carb)", "Sports drinks", "Sugary food or drink"]
          : ["Alcohol", "Excess junk food"];
      } else {
        // Tier 0–1: days 5–6 are NORMAL PREP — gut cut doesn't start until day 3 out.
        // Research is unanimous: gut cut = 3 days out to weigh-in. Starting earlier is not
        // better and creates unnecessary dietary restriction before competition.
        const normalGut56 = computeDailyTargets(user, undefined, undefined);
        calories = normalGut56?.calories ?? Math.round(bmr * 1.4);
        carbsG = normalGut56?.carbsG ?? Math.round(weightKg * 3.5);
        fatG = normalGut56?.fatG ?? Math.round(weightKg * 1.0);
        phase = "Normal prep";
        sodiumMg = 2500; waterL = "3–4 L"; waterTargetL = 3.5;
        focus = i === 6
          ? "Normal eating — gut cut begins in 3 days, nothing to restrict yet"
          : "Continue normal eating — gut cut starts tomorrow";
        guidance = [
          `Normal eating today — no food restrictions yet. Your gut cut starts in ${i - 3} day${i - 3 > 1 ? "s" : ""}${i === 4 ? " (tomorrow)" : ""}.`,
          "Eat your normal whole foods: oats, vegetables, lean meats, rice. Enjoy them — you'll be switching to protein shakes and almonds soon enough.",
          "Hydrate consistently (3–4 L). Good baseline hydration in these days makes weigh-in easier.",
          "Focus on sleep quality. Growth hormone peaks during deep sleep and is critical for recovery and strength.",
          `Gut cut protocol begins ${i === 4 ? "tomorrow" : `in ${i - 3} days`} (3 days before weigh-in): switch to protein shakes, salted almonds, white rice, and zero-fiber carbs at normal calorie intake.`,
        ];
        foods = ["Lean proteins", "Rice", "Oats", "Sweet potato", "Fruit", "Vegetables"];
        avoid = ["Alcohol", "Excess junk food"];
      }

    // ── DAY 7 (transition) ─────────────────────────────────────────────────────
    } else if (i === 7) {
      label = "7 days out"; phase = "Transition"; isKeyDay = true;
      const normal7 = computeDailyTargets(user, undefined, undefined);
      calories = normal7?.calories ?? Math.round(bmr * 1.4);
      carbsG = normal7?.carbsG ?? Math.round(weightKg * 2.5);
      fatG = normal7?.fatG ?? Math.round(weightKg * 1.0);
      sodiumMg = 2500; waterL = "4–5 L"; waterTargetL = 4.5;
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
      sodiumMg = 2500; waterL = "3–4 L"; waterTargetL = 3.5;
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
