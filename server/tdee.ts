/**
 * TDEE / BMR calculations and meet-prep planning logic.
 *
 * BMR: Mifflin-St Jeor equation
 * Water cut protocol: evidence-based from powerliftingtowin.com, NIH PMC 2025, RP Strength
 *
 * Key science for water/sodium protocol:
 *  - Water loading + SODIUM LOADING together prime excretion hormones (ADH + aldosterone)
 *  - Sodium loading on water load day is CORRECT — not low sodium
 *  - Both are cut simultaneously 1-2 days before weigh-in
 *  - Glycogen depletion releases 3-4g water per gram glycogen = 2-4kg additional loss
 *  - 2-hour weigh-in: avoid heavy glycogen depletion (not enough time to reload)
 *  - 24-hour weigh-in: full depletion + reload is appropriate
 *
 * Water cut thresholds (% of bodyweight to cut):
 *  ≤3%: Water/sodium manipulation only (safest, minimal performance impact)
 *  ≤6%: Add glycogen depletion + water/sodium
 *  ≤8%: Full protocol (glycogen + water + sodium + food residue)
 *  >8%: Advise against — focus on long-term diet instead
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
  weightKg: number,
  heightCm: number,
  age: number,
  sex: "male" | "female"
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === "male" ? base + 5 : base - 161;
}

export function calcTDEE(bmr: number, activityLevel: string): number {
  const mult = ACTIVITY_MULTIPLIERS[activityLevel] ?? 1.55;
  return Math.round(bmr * mult);
}

// ── Interfaces ─────────────────────────────────────────────────────────────────

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
  waterTargetL: number;     // numeric target in litres for water tracker
  focus: string;
  guidance: string[];
  foods: string[];
  avoid: string[];
  isKeyDay: boolean;
}

export interface MeetPlan {
  daysOut: number;
  targetCalories: number;
  waterIntake: string;
  carbsG: number;
  notes: string;
}

/** Result of automatic water cut analysis */
export interface WaterCutAnalysis {
  currentWeightKg: number;
  targetWeightKg: number;
  cutKg: number;
  cutPct: number;           // % of bodyweight
  needsWaterCut: boolean;
  cutCategory: "none" | "minimal" | "moderate" | "aggressive" | "unsafe";
  useGlycogenDepletion: boolean;
  weeksToMeet: number;
  recommendation: string;
}

// ── computeDailyTargets ────────────────────────────────────────────────────────

export function computeDailyTargets(
  user: User,
  burnCalories?: number,
  date?: string
): DailyTargets | null {
  if (!user.weightKg || !user.heightCm || !user.dateOfBirth || !user.sex) {
    return null;
  }

  const age = calcAge(user.dateOfBirth);
  const bmr = calcBMR(
    user.weightKg,
    user.heightCm,
    age,
    user.sex as "male" | "female"
  );
  const tdee = calcTDEE(bmr, user.activityLevel ?? "moderately_active");
  const dailyBurn = burnCalories ?? tdee;

  let isTrainingDay = false;
  if (date && user.trainingDays) {
    const dow = new Date(date).getDay();
    isTrainingDay = (user.trainingDays as number[]).includes(dow);
  }

  let targetCalories = dailyBurn;

  if (user.goalType && user.targetWeightKg && user.targetDate) {
    const daysLeft = Math.max(
      1,
      Math.round(
        (new Date(user.targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      )
    );
    const isLossGoal =
      user.goalType === "weight_loss" || user.goalType === "powerlifting_loss";
    const dietTargetKg =
      user.enableWaterCut && isLossGoal
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
    const adjustment = isTrainingDay ? 150 : -100;
    targetCalories += adjustment;
  }

  targetCalories = Math.round(targetCalories);

  const proteinG = Math.round(user.weightKg * 2.0);
  const proteinCal = proteinG * 4;
  const fatCal = Math.round(targetCalories * 0.28);
  const fatG = Math.round(fatCal / 9);
  const carbsCal = Math.max(0, targetCalories - proteinCal - fatCal);
  const carbsG = Math.round(carbsCal / 4);

  return {
    calories: targetCalories,
    proteinG,
    carbsG,
    fatG,
    tdee,
    bmr: Math.round(bmr),
    deficit: Math.round(targetCalories - dailyBurn),
    isTrainingDay,
  };
}

// ── Water cut analysis ─────────────────────────────────────────────────────────

/**
 * Automatically determines if a water cut is needed and what protocol to use.
 * Uses the athlete's most recent logged weight if available.
 */
export function analyzeWaterCut(
  user: User,
  recentWeightKg?: number
): WaterCutAnalysis | null {
  if (!user.targetWeightKg || !user.meetDate) return null;

  const currentWeightKg = recentWeightKg ?? user.weightKg ?? 0;
  if (!currentWeightKg) return null;

  const cutKg = currentWeightKg - user.targetWeightKg;
  const cutPct = (cutKg / currentWeightKg) * 100;

  const meetDate = new Date(user.meetDate + "T12:00:00");
  const weeksToMeet = Math.max(0, (meetDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 7));

  let cutCategory: WaterCutAnalysis["cutCategory"];
  let needsWaterCut = true;
  let useGlycogenDepletion = false;
  let recommendation = "";

  if (cutKg <= 0) {
    cutCategory = "none";
    needsWaterCut = false;
    recommendation = `You're already at or below your target weight class (${user.targetWeightKg}kg). Focus on staying fueled and performing your best.`;
  } else if (cutPct <= 3) {
    cutCategory = "minimal";
    useGlycogenDepletion = false;
    recommendation = `A ${cutPct.toFixed(1)}% cut (${cutKg.toFixed(1)}kg) is minimal and manageable. Water and sodium manipulation alone (no glycogen depletion) will get you there with minimal performance impact.`;
  } else if (cutPct <= 6) {
    cutCategory = "moderate";
    useGlycogenDepletion = true;
    recommendation = `A ${cutPct.toFixed(1)}% cut (${cutKg.toFixed(1)}kg) is moderate. This requires glycogen depletion + water/sodium manipulation. With a 24-hour weigh-in you'll have time to reload fully.`;
  } else if (cutPct <= 8) {
    cutCategory = "aggressive";
    useGlycogenDepletion = true;
    recommendation = `A ${cutPct.toFixed(1)}% cut (${cutKg.toFixed(1)}kg) is aggressive. This is at the upper limit of what's safe for performance. Full protocol required. Strongly consider competing at a higher weight class instead.`;
  } else {
    cutCategory = "unsafe";
    needsWaterCut = false;
    recommendation = `A ${cutPct.toFixed(1)}% cut (${cutKg.toFixed(1)}kg) is unsafe and will significantly impair performance. Focus on long-term diet to reach your target weight class — you need more time on the scale to make this work safely.`;
  }

  return {
    currentWeightKg,
    targetWeightKg: user.targetWeightKg,
    cutKg,
    cutPct,
    needsWaterCut,
    cutCategory,
    useGlycogenDepletion,
    weeksToMeet,
    recommendation,
  };
}

// ── Daily water target calculation ─────────────────────────────────────────────

/**
 * Calculate the recommended daily water intake in ml for non-peak-week users.
 * Based on: EFSA recommendations (~35ml/kg for adults), adjusted for sex and age.
 * Men: 38ml/kg | Women: 32ml/kg | Reduce 5% per decade after age 50
 */
export function calcDailyWaterMl(user: User): number {
  if (!user.weightKg) return 3000;
  const sex = user.sex ?? "male";
  const age = user.dateOfBirth ? calcAge(user.dateOfBirth) : 30;
  const baseMlPerKg = sex === "male" ? 38 : 32;
  const ageReduction = age > 50 ? Math.min(0.20, ((age - 50) / 10) * 0.05) : 0;
  const mlPerKg = baseMlPerKg * (1 - ageReduction);
  return Math.round(user.weightKg * mlPerKg / 100) * 100; // round to nearest 100ml
}

// ── generateWaterCutPlan ───────────────────────────────────────────────────────

export function generateWaterCutPlan(
  user: User,
  meetDate: string
): MeetPlan[] {
  const target = new Date(meetDate);
  const today = new Date();
  const daysToMeet = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysToMeet > 7 || daysToMeet < 0) return [];

  const weightKg = user.weightKg ?? 80;
  const bmr = user.heightCm && user.dateOfBirth && user.sex
    ? calcBMR(weightKg, user.heightCm, calcAge(user.dateOfBirth), user.sex as "male" | "female")
    : 1800;

  const plans: MeetPlan[] = [];

  for (let i = 7; i >= 1; i--) {
    let targetCalories: number;
    let carbsG: number;
    let waterIntake: string;
    let notes: string;

    if (i === 7) {
      targetCalories = Math.round(bmr * 1.4);
      carbsG = Math.round((targetCalories * 0.45) / 4);
      waterIntake = "4–5 L";
      notes = "Normal training week. Begin hydrating consistently. No dietary restrictions yet.";
    } else if (i >= 5) {
      targetCalories = Math.round(bmr * 1.2);
      carbsG = Math.round((targetCalories * 0.35) / 4);
      waterIntake = i === 6 ? "5–6 L (begin water load)" : "6–7 L (water + sodium load)";
      notes = i === 6
        ? "Begin water loading. Increase sodium intake to 3,000–4,000mg today to prime aldosterone response."
        : "Continue high water + sodium loading. Both water AND sodium high today — this maximises the excretion response when you cut both on day 3.";
    } else if (i >= 3) {
      targetCalories = Math.round(bmr * 1.0);
      carbsG = i === 4 ? Math.round(weightKg * 1.5) : 30;
      waterIntake = i === 4 ? "3–4 L (begin taper)" : "1–2 L";
      notes = i === 4
        ? "Begin cutting water AND sodium simultaneously. Drop both abruptly — your body is still in high-excretion mode from loading days."
        : "Very low water and sodium. Low carb. Light, easy-to-digest foods only.";
    } else if (i === 2) {
      targetCalories = Math.round(bmr * 0.85);
      carbsG = 20;
      waterIntake = "< 1 L (sip only)";
      notes = "Minimal water and food. Weigh yourself frequently. Stop all water 10–12 hours before weigh-in time.";
    } else {
      targetCalories = Math.round(bmr * 0.75);
      carbsG = 0;
      waterIntake = "0 until after weigh-in";
      notes = "Nothing until weigh-in. Post weigh-in: 500ml electrolyte drink immediately, then 100–150g carbs every 2 hours.";
    }

    plans.push({ daysOut: i, targetCalories, waterIntake, carbsG, notes });
  }

  return plans;
}

// ── generatePeakWeekPlan ───────────────────────────────────────────────────────

/**
 * Evidence-based 14-day peak week protocol for powerlifting.
 *
 * CORRECTED from previous version:
 *  - Water load day: HIGH sodium (3,000–4,000mg) + high water — this is correct.
 *    Water + sodium are loaded TOGETHER, then cut TOGETHER abruptly.
 *    Low sodium on water load day was incorrect and blunted the hormonal response.
 *  - Glycogen depletion is now gated by cutCategory (≤3% cut skips it entirely)
 *  - Daily weigh-ins feed into a real-time cutPct calculation
 *
 * Sources: powerliftingtowin.com, RP Strength, NIH PMC 2025, Ideal Nutrition dietitian guide
 */
export function generatePeakWeekPlan(
  user: User,
  meetDate: string,
  recentWeightKg?: number   // most recent weigh-in — used for dynamic adjustments
): PeakWeekDay[] {
  const target = new Date(meetDate + "T12:00:00");
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);

  const daysToMeet = Math.round(
    (target.getTime() - now.setHours(12, 0, 0, 0)) / (1000 * 60 * 60 * 24)
  );

  if (daysToMeet > 14 || daysToMeet < 0) return [];

  const weightKg = recentWeightKg ?? user.weightKg ?? 80;
  const bmr = user.heightCm && user.dateOfBirth && user.sex
    ? calcBMR(weightKg, user.heightCm, calcAge(user.dateOfBirth), user.sex as "male" | "female")
    : 1800;

  // Protein stays high: 2.2g/kg throughout (muscle preservation)
  const proteinG = Math.round(weightKg * 2.2);

  // Analyse cut to determine protocol intensity
  const analysis = analyzeWaterCut(user, recentWeightKg);
  const useGlycogen = analysis?.useGlycogenDepletion ?? (user.enableWaterCut ?? false);
  const cutKg = analysis?.cutKg ?? 0;
  const cutPct = analysis?.cutPct ?? 0;

  const days: PeakWeekDay[] = [];

  for (let i = 14; i >= 0; i--) {
    const dayDate = new Date(target);
    dayDate.setDate(dayDate.getDate() - i);
    const dayStr = dayDate.toISOString().slice(0, 10);
    const isToday = dayStr === todayStr;

    let phase: string;
    let focus: string;
    let calories: number;
    let carbsG: number;
    let fatG: number;
    let sodiumMg: number;
    let waterL: string;
    let waterTargetL: number;
    let guidance: string[];
    let foods: string[];
    let avoid: string[];
    let isKeyDay = false;
    let label: string;

    if (i === 0) {
      // ── MEET DAY ────────────────────────────────────────────────────────────
      label = "Meet day";
      phase = "Competition";
      focus = "Execute your plan — fuel between attempts, stay hydrated";
      calories = Math.round(bmr * 1.5);
      carbsG = Math.round(weightKg * 4);
      fatG = Math.round(calories * 0.15 / 9);
      sodiumMg = 2500;
      waterL = "3–4 L";
      waterTargetL = 3.5;
      isKeyDay = true;
      guidance = [
        "Pre-meet meal 2–3 hours before opening: white rice, lean protein, banana. Keep it familiar.",
        "Between attempts: sip 200–300ml electrolyte drink (Pedialyte, Liquid IV). Do NOT chug water.",
        "After each flight: 30–50g fast carbs — rice cakes, dates, gummy bears, white bread with honey.",
        "Avoid anything high in fiber or fat — GI distress ruins attempts.",
        cutKg > 0
          ? `Post weigh-in rehydration: drink 500ml electrolyte solution immediately, then eat 100–150g carbs every 2 hours until attempts. You have ${Math.round(daysToMeet * 0)} hours — prioritise carbs over water.`
          : "You didn't cut weight — you have a massive advantage. Stay fuelled and trust your prep.",
      ];
      foods = ["White rice", "Rice cakes + honey", "Banana / dates", "Lean chicken or turkey", "Pedialyte / Liquid IV", "Gummy bears / gels"];
      avoid = ["High-fiber vegetables", "Fatty meats", "New foods you haven't eaten before", "Alcohol", "Excess caffeine"];

    } else if (i === 1) {
      // ── DAY BEFORE MEET ──────────────────────────────────────────────────────
      label = "1 day out";
      phase = "Final prep";
      focus = user.enableWaterCut
        ? cutPct > 3 ? "Final water cut — stop fluids 10–12 hours before weigh-in" : "Stop water 10–12 hours before weigh-in, rest and carb top-off"
        : "Rest, top-off glycogen, early bedtime";
      calories = Math.round(bmr * 1.2);
      carbsG = Math.round(weightKg * 5);
      fatG = Math.round(calories * 0.10 / 9);
      sodiumMg = 1500; // LOW sodium now — both sodium and water are cut together
      waterL = user.enableWaterCut ? "< 1 L (stop 10–12h before weigh-in)" : "2–3 L";
      waterTargetL = user.enableWaterCut ? 0.8 : 2.5;
      isKeyDay = true;
      guidance = [
        "Eat 4–6 small carb-dense meals throughout the day — white rice, rice cakes, banana, white bread.",
        "Sodium must be very low today (~1,500mg) — no added salt, no processed foods.",
        user.enableWaterCut
          ? `Stop all water intake 10–12 hours before your weigh-in time tomorrow. Set an alarm.`
          : "Keep water moderate. Wake up feeling full and slightly heavy — that's glycogen and it's exactly what you want.",
        "Lay out everything for tomorrow: singlet, belt, wraps, attempt spreadsheet, food for post weigh-in.",
        "Sleep 8+ hours. Your body rebuilds overnight. Melatonin 0.5mg is fine if needed.",
      ];
      foods = ["White rice", "Rice cakes + honey/jam", "Banana", "White pasta", "Lean chicken breast"];
      avoid = ["Salt / sodium", "High-fat foods", "High-fiber vegetables", "Beans / legumes", "New foods", "Alcohol"];

    } else if (i <= 3) {
      // ── CARB LOAD (days 2–3 out) ─────────────────────────────────────────────
      label = `${i} days out`;
      phase = "Carb load";
      isKeyDay = true;
      const carbPerKg = i === 3 ? 6 : 7;
      carbsG = Math.round(weightKg * carbPerKg);
      fatG = Math.round(weightKg * 0.5);
      calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
      // Sodium is moderate-high on carb load days — sodium drives glucose and water INTO muscle cells
      sodiumMg = i === 3 ? 3000 : 2500;
      waterL = i === 3 ? "3–4 L" : "2–3 L";
      waterTargetL = i === 3 ? 3.5 : 2.5;
      focus = i === 3
        ? `Carb load begins — ${carbsG}g carbs today (${carbPerKg} g/kg). Sodium stays moderate.`
        : `Continue carb load — ${carbsG}g carbs today. Keep sodium ~2,500mg.`;
      guidance = [
        `Target ${carbsG}g carbohydrates spread across 5–6 meals — approximately ${Math.round(carbsG / 5)}g per meal.`,
        "Choose LOW-FIBER easily-digested carbs only: white rice, white bread, rice cakes, cream of rice, bananas, white pasta.",
        i === 3
          ? `Sodium at ${sodiumMg}mg today — sodium helps shuttle glucose AND water into muscle cells, creating fullness and hardness. This is intentional.`
          : `Sodium at ${sodiumMg}mg today — slightly lower as you approach weigh-in, but still not zero. Sodium is still helping glycogen storage.`,
        "Fat must be very low (under 50g) — fat blunts glycogen synthesis and causes GI distress at these carb levels.",
        i === 2
          ? "Muscles should feel noticeably full and firm by tonight. That fullness is glycogen supercompensation — you are now stronger than you were a week ago."
          : "You may feel flat after depletion days — don't panic. The fullness arrives tomorrow.",
      ];
      foods = ["White rice (large portions)", "Rice cakes + honey or jam", "White pasta", "Cream of rice", "Banana / dried mango", "Low-fat Greek yogurt", "White bread + turkey"];
      avoid = ["Oats / brown rice / quinoa (high fiber)", "Broccoli / leafy greens", "Cheese / nuts", "High-fat sauces", "Alcohol"];

    } else if (i === 4) {
      // ── WATER + SODIUM CUT DAY ───────────────────────────────────────────────
      // This is where you STOP the loading, not continue it.
      // Both water and sodium are dropped abruptly to maximise excretion.
      label = "4 days out";
      phase = user.enableWaterCut ? "Water + sodium cut begins" : "Pre-carb load rest";
      isKeyDay = user.enableWaterCut;
      carbsG = Math.round(weightKg * 1.0);
      fatG = Math.round(weightKg * 0.7);
      calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
      sodiumMg = user.enableWaterCut ? 800 : 2000;  // DROP sodium abruptly
      waterL = user.enableWaterCut ? "2–3 L (tapering)" : "3–4 L";
      waterTargetL = user.enableWaterCut ? 2.5 : 3.5;
      focus = user.enableWaterCut
        ? "CUT water + sodium abruptly today — your kidneys are still in high-excretion mode"
        : "Active rest day — stay off your feet, eat clean, prepare mentally";
      guidance = user.enableWaterCut
        ? [
            "STOP both water loading and sodium simultaneously today. Abrupt cessation is key — your kidneys will continue excreting at the accelerated rate from loading days.",
            `Limit water to 2–3 L today, tapering down. Sodium under ${sodiumMg}mg — avoid all added salt and processed food.`,
            "This is the day where the weight comes off. You may urinate frequently throughout the day.",
            "Continue low carb to keep glycogen depleted for the carb load starting tomorrow.",
            "Weigh yourself morning and evening to track progress. Log it in the app.",
          ]
        : [
            "Rest day — no training. You're fully tapered. Save your energy.",
            "Eat clean whole foods. Keep carbs moderate and fiber low to begin clearing GI residue.",
            "Sodium stays moderate (~2,000mg) — no need to cut yet if you're not doing a water cut.",
            "Hydrate well. You need water to store tomorrow's carbs effectively.",
            "Mental preparation: review your openers, visualise your attempts, confirm your rack heights.",
          ];
      foods = user.enableWaterCut
        ? ["Chicken breast (unsalted)", "Egg whites", "Fish (fresh, not canned)", "Cucumber", "Green vegetables (small amounts)"]
        : ["Lean protein", "White rice (moderate)", "Vegetables", "Fruit"];
      avoid = user.enableWaterCut
        ? ["Any added salt", "Processed meats", "Canned foods", "Restaurant food", "Sports drinks with sodium"]
        : ["Heavy training", "Salty processed foods", "Alcohol"];

    } else if (i <= 6) {
      // ── WATER + SODIUM LOADING (days 5–6 out) ───────────────────────────────
      // CORRECTED: Both water AND sodium are loaded together.
      // High sodium with high water primes both ADH and aldosterone suppression.
      label = `${i} days out`;
      phase = useGlycogen ? "Depletion + water/sodium load" : "Water/sodium load";
      isKeyDay = user.enableWaterCut;
      carbsG = useGlycogen ? Math.round(weightKg * 0.8) : Math.round(weightKg * 2.5);
      fatG = Math.round(weightKg * 0.8);
      calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
      // HIGH sodium on loading days — this is the correct protocol
      sodiumMg = 3500;
      waterL = i === 6 ? "5–6 L" : "6–7 L";
      waterTargetL = i === 6 ? 5.5 : 6.5;
      focus = i === 6
        ? `Begin water + sodium loading — drink ${waterL} and eat ${sodiumMg}mg sodium today`
        : `Peak water + sodium load — drink ${waterL} with ${sodiumMg}mg sodium`;
      guidance = user.enableWaterCut
        ? [
            `Drink ${waterL} of water spread throughout the day — roughly ${Math.round((i === 6 ? 5.5 : 6.5) / 14 * 10) / 10} L per waking hour.`,
            `SODIUM MUST BE HIGH TODAY (${sodiumMg}mg). This is intentional and correct. Sodium loading alongside water loading suppresses aldosterone, priming your kidneys to excrete both water and sodium rapidly when you cut them on day 4.`,
            "Common mistake: athletes use low sodium on water load day. This is wrong — it reduces the hormonal response. Load both together, cut both together.",
            useGlycogen
              ? `Keep carbs very low (${carbsG}g) today to continue glycogen depletion. The combination of low glycogen + water/sodium priming maximises total weight loss at weigh-in.`
              : "Carbs are moderate since you're not doing glycogen depletion. Focus on the water and sodium loading.",
            "Take an electrolyte supplement with potassium and magnesium today — large water volumes can dilute electrolytes (hyponatremia risk is real at these volumes).",
          ]
        : [
            `Drink ${waterL} to stay well-hydrated during the training taper.`,
            "Sodium is normal — no manipulation needed.",
            useGlycogen
              ? `Keep carbs low (${carbsG}g) to begin glycogen tapering.`
              : "Maintain normal carb intake.",
            "Continue training per your normal schedule.",
            "Focus on sleep quality and reducing life stress in the final week.",
          ];
      foods = useGlycogen
        ? ["Chicken breast", "Egg whites", "Fish", "Low-fat cottage cheese", "Green vegetables", "Unsalted rice cakes (small)"]
        : ["Lean proteins", "Rice", "Oats", "Vegetables", "Fruit"];
      avoid = useGlycogen
        ? ["Rice / bread / pasta / fruit juice", "Sports drinks", "Any sugary food or drink"]
        : ["Alcohol", "Excess junk food"];

    } else if (i === 7) {
      // ── DAY 7: TRANSITION ────────────────────────────────────────────────────
      // Mirror normal daily targets — consistent baseline entering peak week
      label = "7 days out";
      phase = "Transition";
      const normalTargets7 = computeDailyTargets(user, undefined, undefined);
      calories = normalTargets7?.calories ?? Math.round(bmr * 1.4);
      carbsG = normalTargets7?.carbsG ?? Math.round(weightKg * 2.5);
      fatG = normalTargets7?.fatG ?? Math.round(weightKg * 1.0);
      sodiumMg = 2500;
      waterL = "4–5 L";
      waterTargetL = 4.5;
      focus = "Last heavy training session — begin prep mindset";
      isKeyDay = true;
      guidance = [
        "Complete your final heavy training session today or in the next 24 hours.",
        "Begin eating clean — whole foods only, minimise processed food and alcohol for the next 7 days.",
        analysis && cutKg > 0
          ? `You need to drop ${cutKg.toFixed(1)}kg (${cutPct.toFixed(1)}% of bodyweight) to hit ${user.targetWeightKg}kg. ${analysis.recommendation}`
          : "Review your weight class and confirm your game plan for the week.",
        "Start tracking daily morning weight. Log it in the app every morning — this data drives your protocol adjustments.",
        "Begin drinking 4–5 L of water daily to establish the baseline your loading phase will build from.",
      ];
      foods = ["Lean proteins", "Rice", "Oats", "Sweet potato", "Fruit", "Vegetables"];
      avoid = ["Alcohol", "Excess salt", "Junk food"];

    } else {
      // ── DAYS 8–14: NORMAL DEFICIT PHASE ─────────────────────────────────────
      // Use the user's actual TDEE-based daily target rather than a fixed formula.
      // This ensures the peak week display matches the Daily Targets section exactly.
      label = `${i} days out`;
      phase = "Normal prep";
      const tdee = calcTDEE(bmr, user.activityLevel ?? "moderately_active");
      const normalTargets = computeDailyTargets(user, undefined, undefined);
      // Fall back to macro formula only if profile incomplete
      calories = normalTargets?.calories ?? Math.round(tdee * 0.9);
      carbsG = normalTargets?.carbsG ?? Math.round(weightKg * 3.5);
      fatG = normalTargets?.fatG ?? Math.round(weightKg * 1.0);
      sodiumMg = 2500;
      waterL = "3–4 L";
      waterTargetL = 3.5;
      focus = "Stay consistent — hit your macros, sleep 8 hours, reduce junk";
      guidance = [
        "Continue your normal deficit. Don't panic and crash diet this close to the meet.",
        "Focus on sleep quality. Growth hormone peaks during deep sleep and is critical for recovery.",
        "Keep training volume moderate — this is not the time for PRs in training.",
        "Begin winding down processed foods and alcohol to give your gut a clean slate before peak week.",
        "Log your weight every morning and every food entry in Macro. The data from these days informs your peak week protocol.",
      ];
      foods = ["Lean proteins", "Complex carbs", "Fruits and vegetables", "Whole grains"];
      avoid = ["Alcohol", "Excess junk food"];
    }

    days.push({
      daysOut: i,
      label,
      phase,
      isToday,
      calories,
      proteinG,
      carbsG,
      fatG,
      sodiumMg,
      waterL,
      waterTargetL,
      focus,
      guidance,
      foods,
      avoid,
      isKeyDay,
    });
  }

  return days;
}
