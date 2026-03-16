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
    const kgToChange = user.targetWeightKg - user.weightKg;
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
