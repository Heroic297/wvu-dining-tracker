import { useState } from "react";
import { useHashLocation } from "wouter/use-hash-location";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { api, lbsToKg } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/DateInput";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ChevronRight, ChevronLeft, User, Target, Droplets, Camera, Dumbbell } from "lucide-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const schema = z.object({
  sex: z.enum(["male", "female"]),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
  heightFt: z.number({ invalid_type_error: "Required" }).min(3).max(8),
  heightIn: z.number({ invalid_type_error: "Required" }).min(0).max(11),
  weightLbs: z.number({ invalid_type_error: "Required" }).positive("Weight is required"),
  activityLevel: z.enum(["sedentary", "lightly_active", "moderately_active", "very_active", "extra_active"]),
  goalType: z.enum(["weight_loss", "weight_gain", "powerlifting_loss", "powerlifting_gain", "maintenance"]),
  targetWeightLbs: z.number().positive().optional(),
  targetDate: z.string().optional(),
  enableWaterTracking: z.boolean().optional(),
  waterUnit: z.enum(["oz", "ml", "L"]).optional(),
  waterBottleName: z.string().optional(),
  waterBottleMl: z.number().optional(),
  enablePhysiqueTracking: z.boolean().optional(),
  trainingDays: z.array(z.number()).optional(),
  meetDate: z.string().optional(),
  enableWaterCut: z.boolean().optional(),
});

type FormData = z.infer<typeof schema>;

const STEP_FIELDS: Record<number, (keyof FormData)[]> = {
  0: ["sex", "dateOfBirth", "heightFt", "heightIn", "weightLbs", "activityLevel"],
  1: ["goalType"],
  2: [],
  3: [],
  4: [],
};

const STEP_META = [
  { title: "Body stats",        subtitle: "Used to calculate your calorie targets",    icon: User     },
  { title: "Goal setting",      subtitle: "What are you working toward?",              icon: Target   },
  { title: "Hydration",         subtitle: "Optional water intake tracking",            icon: Droplets },
  { title: "Physique tracking", subtitle: "Optional progress photo tracking",          icon: Camera   },
  { title: "Powerlifting",      subtitle: "Configure your training and meet",          icon: Dumbbell },
];

const slideVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 28 : -28 }),
  center: { opacity: 1, x: 0 },
  exit:  (dir: number) => ({ opacity: 0, x: dir > 0 ? -28 : 28 }),
};

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [, setLocation] = useHashLocation();
  const { updateUser, logout } = useAuth();
  const { toast } = useToast();

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      sex: "male",
      activityLevel: "moderately_active",
      goalType: "maintenance",
      enableWaterTracking: false,
      waterUnit: "oz",
      enablePhysiqueTracking: false,
      trainingDays: [1, 3, 5],
      enableWaterCut: false,
    },
  });

  const goalType = form.watch("goalType");
  const isPowerlifting = goalType?.includes("powerlifting");

  const steps = [
    ...STEP_META.slice(0, 4),
    ...(isPowerlifting ? [STEP_META[4]] : []),
  ];

  const handleNext = async () => {
    const fields = STEP_FIELDS[step] ?? [];
    const valid = fields.length === 0 || await form.trigger(fields);
    if (!valid) return;
    setDirection(1);
    setStep(s => s + 1);
  };

  const handleBack = () => {
    setDirection(-1);
    setStep(s => s - 1);
  };

  const onSubmit = async (data: FormData) => {
    try {
      const heightCm = (data.heightFt * 12 + data.heightIn) * 2.54;
      const weightKg = lbsToKg(data.weightLbs);
      const targetWeightKg = data.targetWeightLbs ? lbsToKg(data.targetWeightLbs) : undefined;

      const payload: Record<string, any> = {
        sex: data.sex,
        dateOfBirth: data.dateOfBirth,
        heightCm,
        weightKg,
        activityLevel: data.activityLevel,
        goalType: data.goalType,
        enableWaterTracking: data.enableWaterTracking ?? false,
        enablePhysiqueTracking: data.enablePhysiqueTracking ?? false,
        onboardingComplete: true,
        burnMode: "tdee",
        ...(targetWeightKg !== undefined && { targetWeightKg }),
        ...(data.targetDate ? { targetDate: data.targetDate } : {}),
        ...(isPowerlifting && {
          trainingDays: data.trainingDays ?? [],
          meetDate: data.meetDate || null,
          enableWaterCut: data.enableWaterCut ?? false,
        }),
      };

      if (data.enableWaterTracking) {
        payload.waterUnit = data.waterUnit ?? "oz";
        if (data.waterBottleName && data.waterBottleMl) {
          payload.waterBottles = [{ id: crypto.randomUUID(), name: data.waterBottleName, mlSize: data.waterBottleMl }];
        }
      }

      const resp = await api.updateProfile(payload);
      const updated = await resp.json();

      try {
        await api.logWeight({ date: new Date().toISOString().slice(0, 10), weightKg });
      } catch { /* non-fatal */ }

      updateUser({ ...updated, onboardingComplete: true });
      setLocation("/");
    } catch (err: any) {
      toast({ title: "Setup failed", description: err.message, variant: "destructive" });
    }
  };

  const currentStep = steps[step];
  const StepIcon = currentStep?.icon ?? User;

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 w-64 h-64 rounded-full bg-primary/8 blur-3xl" />
      </div>

      <div className="relative w-full max-w-lg">
        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8">
          {steps.map((s, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <div key={i} className="flex items-center gap-2 flex-1">
                <div className={`relative flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-bold border transition-all duration-300 flex-shrink-0 ${
                  done
                    ? "bg-primary border-primary text-primary-foreground"
                    : active
                    ? "border-primary text-primary shadow-[0_0_12px_hsl(var(--primary)/0.5)]"
                    : "border-white/15 text-white/30"
                }`}>
                  {done ? "✓" : i + 1}
                </div>
                {i < steps.length - 1 && (
                  <div className={`h-px flex-1 rounded-full transition-all duration-500 ${done ? "bg-primary" : "bg-white/10"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Card */}
        <div className="bg-slate-900/60 backdrop-blur-xl border border-white/8 rounded-2xl shadow-2xl overflow-hidden">
          {/* Step header */}
          <div className="px-6 pt-6 pb-4 border-b border-white/5">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/15 border border-primary/25">
                <StepIcon className="w-4.5 h-4.5 text-primary" style={{ width: 18, height: 18 }} />
              </div>
              <div>
                <h2 className="text-base font-bold text-white leading-none">{currentStep?.title}</h2>
                <p className="text-xs text-white/45 mt-0.5">{currentStep?.subtitle}</p>
              </div>
            </div>
          </div>

          {/* Step content with animation */}
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="px-6 py-5 min-h-[280px]">
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={step}
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  {/* Step 0: Body stats */}
                  {step === 0 && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-white/70 text-xs">Sex <span className="text-destructive">*</span></Label>
                          <Select value={form.watch("sex")} onValueChange={(v) => form.setValue("sex", v as any)}>
                            <SelectTrigger data-testid="select-sex" className="bg-white/5 border-white/10 text-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="male">Male</SelectItem>
                              <SelectItem value="female">Female</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-white/70 text-xs">Date of birth <span className="text-destructive">*</span></Label>
                          <DateInput
                            value={form.watch("dateOfBirth") ?? ""}
                            onChange={(v) => form.setValue("dateOfBirth", v)}
                            testId="input-dob"
                          />
                          {form.formState.errors.dateOfBirth && (
                            <p className="text-xs text-destructive">{form.formState.errors.dateOfBirth.message}</p>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-white/70 text-xs">Height <span className="text-destructive">*</span></Label>
                        <div className="flex gap-2">
                          <div className="flex-1 relative">
                            <Input type="number" placeholder="5" data-testid="input-height-ft"
                              className="bg-white/5 border-white/10 text-white placeholder:text-white/25 pr-8"
                              {...form.register("heightFt", { valueAsNumber: true })} />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/35">ft</span>
                          </div>
                          <div className="flex-1 relative">
                            <Input type="number" placeholder="10" data-testid="input-height-in"
                              className="bg-white/5 border-white/10 text-white placeholder:text-white/25 pr-8"
                              {...form.register("heightIn", { valueAsNumber: true })} />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/35">in</span>
                          </div>
                        </div>
                        {(form.formState.errors.heightFt || form.formState.errors.heightIn) && (
                          <p className="text-xs text-destructive">Valid height required</p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-white/70 text-xs">Body weight <span className="text-destructive">*</span></Label>
                        <div className="relative">
                          <Input type="number" placeholder="175" data-testid="input-weight"
                            className="bg-white/5 border-white/10 text-white placeholder:text-white/25 pr-10"
                            {...form.register("weightLbs", { valueAsNumber: true })} />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/35">lbs</span>
                        </div>
                        {form.formState.errors.weightLbs && (
                          <p className="text-xs text-destructive">{form.formState.errors.weightLbs.message}</p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-white/70 text-xs">Activity level <span className="text-destructive">*</span></Label>
                        <Select value={form.watch("activityLevel")} onValueChange={(v) => form.setValue("activityLevel", v as any)}>
                          <SelectTrigger data-testid="select-activity" className="bg-white/5 border-white/10 text-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sedentary">Sedentary (desk job, no exercise)</SelectItem>
                            <SelectItem value="lightly_active">Lightly active (1–3 days/week)</SelectItem>
                            <SelectItem value="moderately_active">Moderately active (3–5 days/week)</SelectItem>
                            <SelectItem value="very_active">Very active (6–7 days/week)</SelectItem>
                            <SelectItem value="extra_active">Extra active (athlete, physical job)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}

                  {/* Step 1: Goals */}
                  {step === 1 && (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <Label className="text-white/70 text-xs">Goal type <span className="text-destructive">*</span></Label>
                        <Select value={form.watch("goalType")} onValueChange={(v) => form.setValue("goalType", v as any)}>
                          <SelectTrigger data-testid="select-goal" className="bg-white/5 border-white/10 text-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="weight_loss">Weight loss</SelectItem>
                            <SelectItem value="weight_gain">Weight gain / bulk</SelectItem>
                            <SelectItem value="powerlifting_loss">Powerlifting — cut to weight class</SelectItem>
                            <SelectItem value="powerlifting_gain">Powerlifting — gain strength</SelectItem>
                            <SelectItem value="maintenance">Maintenance</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {goalType !== "maintenance" && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="space-y-4 overflow-hidden"
                        >
                          <div className="space-y-1.5">
                            <Label className="text-white/70 text-xs">Target weight (lbs)</Label>
                            <div className="relative">
                              <Input type="number" placeholder="165" data-testid="input-target-weight"
                                className="bg-white/5 border-white/10 text-white placeholder:text-white/25 pr-10"
                                {...form.register("targetWeightLbs", { valueAsNumber: true })} />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/35">lbs</span>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-white/70 text-xs">Target date</Label>
                            <DateInput
                              value={form.watch("targetDate") ?? ""}
                              onChange={(v) => form.setValue("targetDate", v)}
                              testId="input-target-date"
                            />
                          </div>
                        </motion.div>
                      )}
                    </div>
                  )}

                  {/* Step 2: Hydration */}
                  {step === 2 && (
                    <div className="space-y-4">
                      <p className="text-sm text-white/50">
                        Track your daily water intake. Optional — you can enable it anytime in Settings.
                      </p>
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/8">
                        <Checkbox
                          id="enableWater"
                          checked={form.watch("enableWaterTracking")}
                          onCheckedChange={(v) => form.setValue("enableWaterTracking", !!v)}
                        />
                        <Label htmlFor="enableWater" className="cursor-pointer font-medium text-white/80">
                          Enable water tracking
                        </Label>
                      </div>
                      {form.watch("enableWaterTracking") && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          className="space-y-4 overflow-hidden"
                        >
                          <div className="space-y-1.5">
                            <Label className="text-white/70 text-xs">Preferred unit</Label>
                            <Select
                              value={form.watch("waterUnit") ?? "oz"}
                              onValueChange={(v) => form.setValue("waterUnit", v as any)}
                            >
                              <SelectTrigger className="bg-white/5 border-white/10 text-white"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="oz">oz (fluid ounces)</SelectItem>
                                <SelectItem value="ml">ml</SelectItem>
                                <SelectItem value="L">L (liters)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-white/70 text-xs">Add a water bottle (optional)</Label>
                            <p className="text-xs text-white/35">
                              Save a bottle so you can log with one tap.
                            </p>
                            <div className="flex gap-2">
                              <Input
                                placeholder="e.g. Nalgene 32oz"
                                className="bg-white/5 border-white/10 text-white placeholder:text-white/25"
                                value={form.watch("waterBottleName") ?? ""}
                                onChange={(e) => form.setValue("waterBottleName", e.target.value)}
                              />
                              <div className="relative w-28">
                                <Input
                                  type="number"
                                  placeholder="946"
                                  className="bg-white/5 border-white/10 text-white placeholder:text-white/25 pr-8"
                                  value={form.watch("waterBottleMl") ?? ""}
                                  onChange={(e) => form.setValue("waterBottleMl", Number(e.target.value))}
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/35">ml</span>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  )}

                  {/* Step 3: Physique Tracking */}
                  {step === 3 && (
                    <div className="space-y-4">
                      <p className="text-sm text-white/50">
                        Upload progress photos over time. Stored privately, only visible to you.
                      </p>
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/8">
                        <Checkbox
                          id="enablePhysique"
                          checked={form.watch("enablePhysiqueTracking")}
                          onCheckedChange={(v) => form.setValue("enablePhysiqueTracking", !!v)}
                        />
                        <Label htmlFor="enablePhysique" className="cursor-pointer font-medium text-white/80">
                          Enable physique tracking
                        </Label>
                      </div>
                      {form.watch("enablePhysiqueTracking") && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          className="space-y-1.5 overflow-hidden"
                        >
                          <div className="p-3 rounded-xl bg-primary/8 border border-primary/20 text-sm text-white/60 space-y-1">
                            <p>A <strong className="text-white/80">Physique</strong> tab will appear in the app</p>
                            <p>Upload front/side/back photos with date and weight</p>
                            <p>AI-powered comparison notes included</p>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  )}

                  {/* Step 4: Powerlifting */}
                  {step === 4 && isPowerlifting && (
                    <div className="space-y-5">
                      <div className="space-y-2">
                        <Label className="text-white/70 text-xs">Training days</Label>
                        <div className="flex gap-2 flex-wrap">
                          {DAYS.map((day, i) => {
                            const checked = (form.watch("trainingDays") ?? []).includes(i);
                            return (
                              <button
                                key={i}
                                type="button"
                                data-testid={`button-day-${i}`}
                                onClick={() => {
                                  const current = form.getValues("trainingDays") ?? [];
                                  form.setValue("trainingDays",
                                    checked ? current.filter((d) => d !== i) : [...current, i]
                                  );
                                }}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                                  checked
                                    ? "bg-primary text-primary-foreground border-primary shadow-[0_0_8px_hsl(var(--primary)/0.4)]"
                                    : "bg-white/5 text-white/50 border-white/10 hover:border-primary/50 hover:text-white/80"
                                }`}
                              >
                                {day}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-white/70 text-xs">Meet date (optional)</Label>
                        <DateInput
                          value={form.watch("meetDate") ?? ""}
                          onChange={(v) => form.setValue("meetDate", v)}
                          testId="input-meet-date"
                        />
                      </div>

                      <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/8">
                        <Checkbox
                          id="watercut"
                          data-testid="checkbox-watercut"
                          checked={form.watch("enableWaterCut")}
                          onCheckedChange={(v) => form.setValue("enableWaterCut", !!v)}
                        />
                        <Label htmlFor="watercut" className="cursor-pointer text-white/80">
                          Enable 7-day water cut guidance before meet
                        </Label>
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Footer buttons */}
            <div className="flex justify-between items-center px-6 pb-6 pt-2 border-t border-white/5">
              {step > 0 ? (
                <Button type="button" variant="ghost"
                  className="text-white/50 hover:text-white/80 hover:bg-white/8"
                  onClick={handleBack}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back
                </Button>
              ) : (
                <button
                  type="button"
                  onClick={() => logout()}
                  className="text-xs text-white/30 hover:text-white/60 transition-colors"
                >
                  ← Back to login
                </button>
              )}

              {step < steps.length - 1 ? (
                <Button
                  type="button"
                  onClick={handleNext}
                  data-testid="button-next"
                  className="bg-primary hover:bg-primary/90 shadow-[0_0_12px_hsl(var(--primary)/0.35)] hover:shadow-[0_0_16px_hsl(var(--primary)/0.5)] transition-all"
                >
                  Next <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={form.formState.isSubmitting}
                  data-testid="button-finish"
                  className="bg-primary hover:bg-primary/90 shadow-[0_0_12px_hsl(var(--primary)/0.35)] hover:shadow-[0_0_16px_hsl(var(--primary)/0.5)] transition-all"
                >
                  {form.formState.isSubmitting ? "Saving..." : "Get started"}
                </Button>
              )}
            </div>
          </form>
        </div>

        <p className="text-center text-xs text-white/20 mt-5">
          Macro · Nutrition &amp; Performance Tracker
        </p>
      </div>
    </div>
  );
}
