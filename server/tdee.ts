/**
 * TDEE / BMR calculations and diet planning logic.
 *
 * BMR: Mifflin-St Jeor equation (most validated for general population)
 * TDEE: BMR × activity multiplier
 * Macro splits: evidence-based powerlifting-oriented defaults
 *   - Protein: 1.8–2.2 g/kg bodyweight
 *   - Fat: 25–30% of calories
 *   - Carbs: remainder
 */
import type { User } from "../shared/schema.js";

/** Activity level multipliers */
const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
  extra_active: 1.9,
};

/** Calculate age in years from date of birth string */
function calcAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

/** Mifflin-St Jeor BMR */
export function calcBMR(
  weightKg: number,
  heightCm: number,
  age: number,
  sex: "male" | "female"
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === "male" ? base + 5 : base - 161;
}

/** TDEE = BMR × activity multiplier */
export function calcTDEE(bmr: number, activityLevel: string): number {
  const mult = ACTIVITY_MULTIPLIERS[activityLevel] ?? 1.55;
  return Math.round(bmr * mult);
}

export interface DailyTargets {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  tdee: number;
  bmr: number;
  deficit: number; // negative = deficit, positive = surplus
  isTrainingDay?: boolean;
}

export interface PeakWeekDay {
  daysOut: number;         // days until meet (14 down to 0 = meet day)
  label: string;           // e.g. "14 days out", "Meet day"
  phase: string;           // e.g. "Normal training", "Depletion", "Carb load", "Meet day"
  isToday: boolean;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  sodiumMg: number;        // target sodium in mg
  waterL: string;          // e.g. "4–5 L"
  focus: string;           // one-line priority for the day
  guidance: string[];      // 3-5 bullet points of actionable advice
  foods: string[];         // specific food suggestions
  avoid: string[];         // foods/behaviours to avoid
  isKeyDay: boolean;       // highlight in UI (water load, carb load, weigh-in)
}

export interface MeetPlan {
  daysOut: number;
  targetCalories: number;
  waterIntake: string;
  carbsG: number;
  notes: string;
}

/**
 * Compute macro targets for a given day.
 * @param user - user profile
 * @param burnCalories - optional wearable-derived burn; overrides TDEE if provided
 * @param date - YYYY-MM-DD of the day being planned
 */
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

  // Use wearable burn if available; otherwise TDEE
  const dailyBurn = burnCalories ?? tdee;

  // Determine if it's a training day
  let isTrainingDay = false;
  if (date && user.trainingDays) {
    const dow = new Date(date).getDay(); // 0=Sun
    isTrainingDay = (user.trainingDays as number[]).includes(dow);
  }

  // Calculate required deficit/surplus
  let targetCalories = dailyBurn;

  if (user.goalType && user.targetWeightKg && user.targetDate) {
    const daysLeft = Math.max(
      1,
      Math.round(
        (new Date(user.targetDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      )
    );
    // When water cut is enabled for a loss goal, reserve the final 1% of bodyweight
    // for the water cut — so the daily calorie deficit only targets down to
    // (targetWeightKg + 1% current bodyweight), not all the way to the weigh-in weight.
    const isLossGoal =
      user.goalType === "weight_loss" || user.goalType === "powerlifting_loss";
    const dietTargetKg =
      user.enableWaterCut && isLossGoal
        ? user.targetWeightKg + user.weightKg * 0.01
        : user.targetWeightKg;
    const kgToChange = dietTargetKg - user.weightKg;
    // 1 kg fat ≈ 7700 kcal
    const dailyAdjust = (kgToChange * 7700) / daysLeft;

    if (user.goalType === "weight_loss" || user.goalType === "powerlifting_loss") {
      // Cap daily deficit at -1000 kcal for safety
      targetCalories = Math.max(
        dailyBurn + Math.max(dailyAdjust, -1000),
        1200
      );
    } else if (user.goalType === "weight_gain" || user.goalType === "powerlifting_gain") {
      // Cap daily surplus at +700 kcal
      targetCalories = dailyBurn + Math.min(dailyAdjust, 700);
    }
  }

  // Powerlifting: adjust for training vs rest days
  if (
    (user.goalType === "powerlifting_loss" ||
      user.goalType === "powerlifting_gain") &&
    user.trainingDays &&
    date
  ) {
    const adjustment = isTrainingDay ? 150 : -100;
    targetCalories += adjustment;
  }

  targetCalories = Math.round(targetCalories);

  // Macros
  // Protein: 2.0 g/kg bodyweight (powerlifting standard)
  const proteinG = Math.round(user.weightKg * 2.0);
  const proteinCal = proteinG * 4;

  // Fat: 28% of total calories
  const fatCal = Math.round(targetCalories * 0.28);
  const fatG = Math.round(fatCal / 9);

  // Carbs: remainder
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

/**
 * Generate 7-day water cut plan for powerlifting meets.
 * Returns an array of 7 objects, index 0 = 7 days out, index 6 = meet day.
 */
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
    ? calcBMR(
        weightKg,
        user.heightCm,
        calcAge(user.dateOfBirth),
        user.sex as "male" | "female"
      )
    : 1800;

  const plans: MeetPlan[] = [];

  for (let i = 7; i >= 1; i--) {
    let targetCalories: number;
    let carbsG: number;
    let waterIntake: string;
    let notes: string;

    if (i === 7) {
      // 7 days out: normal intake, high water
      targetCalories = Math.round(bmr * 1.4);
      carbsG = Math.round((targetCalories * 0.45) / 4);
      waterIntake = "4–5 L";
      notes =
        "Normal training week. Load up on water to begin adaptation. No dietary restrictions yet.";
    } else if (i >= 5) {
      // 5-6 days: slight reduction
      targetCalories = Math.round(bmr * 1.2);
      carbsG = Math.round((targetCalories * 0.35) / 4);
      waterIntake = "3–4 L";
      notes =
        "Begin reducing sodium and processed foods. Keep protein high. Slightly reduce carbs.";
    } else if (i >= 3) {
      // 3-4 days: carb reduction, water loading
      targetCalories = Math.round(bmr * 1.1);
      carbsG = Math.round((targetCalories * 0.2) / 4);
      waterIntake = i === 4 ? "5–6 L (water load)" : "3–4 L";
      notes =
        i === 4
          ? "WATER LOADING DAY — drink maximum water to prime kidney excretion. Low carbs, no excess sodium."
          : "Continue low carb, moderate protein. Begin tapering water intake.";
    } else if (i === 2) {
      // 2 days out
      targetCalories = Math.round(bmr * 0.9);
      carbsG = 30;
      waterIntake = "2–3 L";
      notes =
        "Reduce water significantly. Very low carb. Avoid sodium. Light foods only.";
    } else {
      // 1 day out (final cut day)
      targetCalories = Math.round(bmr * 0.75);
      carbsG = 20;
      waterIntake = "< 1 L (sip only)";
      notes =
        "Minimal food and water. Weigh in as early as possible. After weigh-in: rehydrate immediately with electrolytes + carbs.";
    }

    plans.push({
      daysOut: i,
      targetCalories,
      waterIntake,
      carbsG,
      notes,
    });
  }

  return plans;
}

/**
 * Generate a 14-day peak week protocol.
 *
 * Science basis:
 *   Days 14–8: Normal training + slight taper. Maintain deficit but don’t add stress.
 *   Days 7–5:  Depletion phase. Low carb (<100g/day) to empty glycogen stores so
 *              the subsequent carb load fills them more completely (supercompensation).
 *   Day 4:     Water loading. Drink 6–7 L to prime kidneys for excretion later.
 *   Days 3–2:  Carb load. 6–8 g/kg bodyweight carbohydrates. Low fat, low fiber.
 *              Sodium moderate-high to drive glycogen into muscle cells with water.
 *   Day 1:     Rest + top-off carbs. Light meals, no new foods. Early bedtime.
 *   Meet day:  Weigh-in protocol + rehydration/refueling plan.
 *
 * Returns days from 14 down to 0 (meet day), each marked with isToday.
 */
export function generatePeakWeekPlan(
  user: User,
  meetDate: string
): PeakWeekDay[] {
  const target = new Date(meetDate + "T12:00:00");
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  const daysToMeet = Math.round(
    (target.getTime() - now.setHours(12, 0, 0, 0)) / (1000 * 60 * 60 * 24)
  );

  // Only generate when within 14 days of the meet
  if (daysToMeet > 14 || daysToMeet < 0) return [];

  const weightKg = user.weightKg ?? 80;
  const bmr = user.heightCm && user.dateOfBirth && user.sex
    ? calcBMR(weightKg, user.heightCm, calcAge(user.dateOfBirth), user.sex as "male" | "female")
    : 1800;

  // Protein stays high throughout: 2.2 g/kg (muscle preservation under deficit)
  const proteinG = Math.round(weightKg * 2.2);

  const days: PeakWeekDay[] = [];

  // Build days 14 down to 0
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
      calories = Math.round(bmr * 1.6);
      carbsG = Math.round(weightKg * 4);   // ~4 g/kg on meet day
      fatG = Math.round(calories * 0.15 / 9);
      sodiumMg = 2500;
      waterL = "3–4 L";
      isKeyDay = true;
      guidance = [
        "Eat a familiar pre-meet meal 2–3 hours before opening attempts: white rice, lean protein, banana.",
        "Between attempts sip water + electrolytes (Pedialyte, Liquid IV, or similar).",
        "After each flight eat 30–50g fast carbs: rice cakes, dates, gummy bears.",
        "Avoid anything high in fiber or fat on meet day — gastric distress kills attempts.",
        "If you did a water cut: immediately after weigh-in drink 500 mL electrolyte solution, then eat 100–150g carbs in the next 2 hours.",
      ];
      foods = ["White rice", "White bread / rice cakes", "Banana / dates", "Lean chicken or turkey", "Gatorade / Pedialyte", "Honey packets"];
      avoid = ["High-fiber vegetables", "Fatty meats", "New foods", "Alcohol", "Excess caffeine"];

    } else if (i === 1) {
      // ── DAY BEFORE MEET ──────────────────────────────────────────────────────
      label = "Meet day −1";
      phase = "Final prep";
      focus = "Rest, top-off glycogen, early bedtime";
      calories = Math.round(bmr * 1.3);
      carbsG = Math.round(weightKg * 5);   // top off glycogen
      fatG = Math.round(calories * 0.12 / 9);
      sodiumMg = 2000;
      waterL = user.enableWaterCut ? "< 1 L (sip only)" : "2–3 L";
      isKeyDay = true;
      guidance = [
        "Eat 4–5 small carb-dense meals throughout the day — no single large meal.",
        "Stick exclusively to foods you have eaten many times before. Zero experiment risk.",
        "Lay out your kit, singlet, belt, and food for tomorrow.",
        user.enableWaterCut
          ? "Water cut: sip water only to take supplements. Weigh in at first opportunity tomorrow."
          : "Keep water moderate — you should wake up feeling full and slightly heavy, that\'s normal.",
        "Sleep 8+ hours. Set two alarms. Melatonin (0.5–1 mg) is fine if needed.",
      ];
      foods = ["White rice", "Rice cakes with honey", "Banana", "White pasta", "Lean chicken breast", "Low-fat Greek yogurt"];
      avoid = ["High-fat foods", "High-fiber vegetables", "Beans / legumes", "New foods", "Alcohol"];

    } else if (i <= 3) {
      // ── CARB LOAD (days 2–3 out) ────────────────────────────────────────────
      label = `${i} days out`;
      phase = "Carb load";
      isKeyDay = true;
      const carbPerKg = i === 3 ? 6 : 7;  // ramp up: 6 g/kg on day 3, 7 g/kg on day 2
      carbsG = Math.round(weightKg * carbPerKg);
      fatG = Math.round(weightKg * 0.5);   // minimal fat to leave room for carbs
      calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
      sodiumMg = i === 3 ? 3000 : 2500;   // moderate-high sodium drives water into muscle
      waterL = i === 3 ? "4–5 L" : "3–4 L";
      focus = i === 3
        ? `Carb load begins — target ${carbsG}g carbs today (${carbPerKg} g/kg)`
        : `Continue carb load — ${carbsG}g carbs today (${carbPerKg} g/kg)`;
      guidance = [
        `Eat ${carbsG}g carbohydrates today spread across 5–6 meals — that\'s roughly ${Math.round(carbsG / 5)}g per meal.`,
        "Choose LOW-FIBER, easily digestible carbs only: white rice, white bread, rice cakes, pasta, cream of rice, bananas.",
        `Keep sodium at ~${sodiumMg}mg today — sodium helps shuttle glucose into muscle cells with water (a good kind of fullness).`,
        "Fat must be very low (<${fatG}g) so your body can store maximum glycogen without gut distress.",
        i === 2
          ? "Your muscles should feel noticeably full and hard by tonight — this is supercompensation working."
          : "You may feel flat after depletion — don\'t panic, the fullness comes by tomorrow.",
      ];
      foods = ["White rice (large portions)", "Rice cakes + honey/jam", "White pasta", "Cream of rice", "Banana / dried mango", "Low-fat Greek yogurt", "White bread + turkey"];
      avoid = ["Oats / brown rice / quinoa (too much fiber)", "Broccoli / leafy greens", "High-fat cheese", "Nuts", "Alcohol"];

    } else if (i === 4) {
      // ── WATER LOADING DAY ────────────────────────────────────────────────────
      label = "4 days out";
      phase = "Water load";
      isKeyDay = true;
      carbsG = Math.round(weightKg * 1.5);  // still low carb
      fatG = Math.round(calories * 0.25 / 9);
      calories = Math.round(bmr * 1.0);
      fatG = Math.round((calories - proteinG * 4 - carbsG * 4) / 9);
      if (fatG < 20) fatG = 20;
      sodiumMg = 1500;  // low sodium while water loading
      waterL = "6–7 L";
      focus = "Drink 6–7 L water today to prime kidney excretion for the cut";
      guidance = [
        "Drink 6–7 litres of water today spread evenly — roughly 1 litre every 2 waking hours.",
        "Keep sodium LOW today (~1500 mg) so high water intake doesn\'t raise sodium relative to volume.",
        "This large water load signals your kidneys to increase excretion rate. When you stop drinking tomorrow, your kidneys keep excreting at this elevated rate — that\'s how you shed water quickly.",
        "Continue low carb today to keep glycogen depleted for maximum carb load absorption on days 2–3.",
        "Take electrolytes (potassium, magnesium) to avoid hyponatremia from large water volume.",
      ];
      foods = ["Lean protein (chicken, fish, egg whites)", "Green vegetables", "Unsalted rice cakes", "Cucumber / celery", "Electrolyte tablets (no sugar)"];
      avoid = ["Salty foods", "Processed meats", "Restaurant food", "Pre-workout with high sodium"];

    } else if (i <= 6) {
      // ── DEPLETION (days 5–6 out) ─────────────────────────────────────────────
      label = `${i} days out`;
      phase = "Depletion";
      carbsG = Math.round(weightKg * 0.8);  // ~0.8 g/kg — very low
      fatG = Math.round(weightKg * 0.8);
      calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
      sodiumMg = 2000;
      waterL = "4–5 L";
      focus = "Deplete glycogen stores — low carb, high protein, normal water";
      guidance = [
        `Keep carbs under ${carbsG}g today. The goal is to empty muscle glycogen so the carb load (days 3–2) fills it beyond normal capacity — this is glycogen supercompensation.`,
        "Train normally if scheduled — training accelerates glycogen depletion and makes the load more effective.",
        "Protein should be high (${proteinG}g) to preserve muscle during depletion.",
        "Sodium should be moderate — around 2000 mg. No need to cut yet.",
        "You may feel flat, low energy, and irritable — this is expected and temporary. Trust the process.",
      ];
      foods = ["Chicken breast", "Egg whites", "Fish", "Low-fat cottage cheese", "Green vegetables", "Unsalted rice cakes (small amount)"];
      avoid = ["Rice", "Bread", "Pasta", "Fruit juice", "Sports drinks", "Any sugary food"];

    } else if (i === 7) {
      // ── DAY 7: LAST NORMAL DAY / TRANSITION ──────────────────────────────────
      label = "7 days out";
      phase = "Transition";
      carbsG = Math.round(weightKg * 2.5);  // taper down from normal
      fatG = Math.round(weightKg * 1.0);
      calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
      sodiumMg = 2500;
      waterL = "4–5 L";
      focus = "Last normal training day — begin transitioning mindset to meet prep";
      isKeyDay = true;
      guidance = [
        "Complete your last heavy training session today or tomorrow at the latest.",
        "Begin eating cleaner — whole foods only, minimize processed food and alcohol for the next 7 days.",
        "Start tracking sodium intake. Average American eats 3,400 mg/day — bring it to ~2,500 mg today.",
        "Hydrate well (4–5 L) today to begin the process of kidney adaptation.",
        "Review your meet schedule: flight times, attempts, and warm-up timing. Planning now reduces stress later.",
      ];
      foods = ["Lean proteins", "Rice", "Oats", "Sweet potato", "Fruit", "Vegetables"];
      avoid = ["Alcohol", "Excess salt", "Junk food"];

    } else {
      // ── DAYS 8–14: NORMAL DEFICIT PHASE ─────────────────────────────────────
      label = `${i} days out`;
      phase = "Normal prep";
      carbsG = Math.round(weightKg * 3.5);
      fatG = Math.round(weightKg * 1.0);
      calories = (proteinG * 4) + (carbsG * 4) + (fatG * 9);
      sodiumMg = 2500;
      waterL = "3–4 L";
      focus = "Stay consistent — hit your macros, sleep 8 hours, reduce junk";
      guidance = [
        "Continue your normal deficit — don't panic and crash diet this close to the meet.",
        "Focus on sleep quality. Growth hormone peaks during deep sleep and is critical for recovery.",
        "Keep training volume moderate — this is not the time for PRs in training.",
        "Begin winding down processed foods and alcohol to give your gut a clean slate before peak week.",
        "Log everything in Macro so you have accurate data heading into peak week.",
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
      focus,
      guidance,
      foods,
      avoid,
      isKeyDay,
    });
  }

  return days;
}
