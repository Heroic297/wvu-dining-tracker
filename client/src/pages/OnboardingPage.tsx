import { useState } from "react";
import { useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { api, lbsToKg, kgToLbs } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ChevronRight, ChevronLeft } from "lucide-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const schema = z.object({
  sex: z.enum(["male", "female"]),
  dateOfBirth: z.string().min(1, "Required"),
  heightFt: z.number().min(3).max(8),
  heightIn: z.number().min(0).max(11),
  weightLbs: z.number().positive(),
  activityLevel: z.enum(["sedentary", "lightly_active", "moderately_active", "very_active", "extra_active"]),
  goalType: z.enum(["weight_loss", "weight_gain", "powerlifting_loss", "powerlifting_gain", "maintenance"]),
  targetWeightLbs: z.number().positive().optional(),
  targetDate: z.string().optional(),
  trainingDays: z.array(z.number()).optional(),
  meetDate: z.string().optional(),
  enableWaterCut: z.boolean().optional(),
});

type FormData = z.infer<typeof schema>;

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [, setLocation] = useHashLocation();
  const { updateUser } = useAuth();
  const { toast } = useToast();

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      sex: "male",
      activityLevel: "moderately_active",
      goalType: "maintenance",
      trainingDays: [1, 3, 5],
      enableWaterCut: false,
    },
  });

  const goalType = form.watch("goalType");
  const isPowerlifting = goalType?.includes("powerlifting");

  const steps = [
    { title: "Body stats", subtitle: "Used to calculate your calorie targets" },
    { title: "Goal setting", subtitle: "What are you working toward?" },
    ...(isPowerlifting ? [{ title: "Powerlifting", subtitle: "Configure your training and meet" }] : []),
  ];

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
        trainingDays: data.trainingDays ?? [],
        enableWaterCut: data.enableWaterCut ?? false,
        onboardingComplete: true,
        burnMode: "tdee",
        // Only include optional fields when they have a value —
        // the server schema rejects explicit null for targetDate
        ...(targetWeightKg !== undefined && { targetWeightKg }),
        ...(data.targetDate   ? { targetDate: data.targetDate }   : {}),
        meetDate: data.meetDate || null,  // meetDate allows null on the server
      };

      const resp = await api.updateProfile(payload);
      const updated = await resp.json();

      // Also log the starting weight so it appears on the dashboard chart
      try {
        await api.logWeight({
          date: new Date().toISOString().slice(0, 10),
          weightKg,
        });
      } catch {
        // Non-fatal — ignore if weight log fails
      }

      // Update auth context with the fully-saved profile from the server response
      updateUser({ ...updated, onboardingComplete: true });

      // Small delay to let React flush the state update before routing
      setTimeout(() => setLocation("/"), 50);
    } catch (err: any) {
      toast({ title: "Setup failed", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Steps indicator */}
        <div className="flex gap-2 mb-6">
          {steps.map((s, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? "bg-primary" : "bg-border"}`} />
          ))}
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          <div className="mb-6">
            <h2 className="text-xl font-bold">{steps[step]?.title}</h2>
            <p className="text-sm text-muted-foreground">{steps[step]?.subtitle}</p>
          </div>

          <form onSubmit={form.handleSubmit(onSubmit)}>
            {/* Step 0: Body stats */}
            {step === 0 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Sex</Label>
                    <Select onValueChange={(v) => form.setValue("sex", v as any)} defaultValue="male">
                      <SelectTrigger data-testid="select-sex">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Date of birth</Label>
                    <Input type="date" data-testid="input-dob" {...form.register("dateOfBirth")} />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Height</Label>
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <Input type="number" placeholder="5" data-testid="input-height-ft" {...form.register("heightFt", { valueAsNumber: true })} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">ft</span>
                    </div>
                    <div className="flex-1 relative">
                      <Input type="number" placeholder="10" data-testid="input-height-in" {...form.register("heightIn", { valueAsNumber: true })} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">in</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Body weight (lbs)</Label>
                  <Input type="number" placeholder="175" data-testid="input-weight" {...form.register("weightLbs", { valueAsNumber: true })} />
                </div>

                <div className="space-y-1.5">
                  <Label>Activity level</Label>
                  <Select onValueChange={(v) => form.setValue("activityLevel", v as any)} defaultValue="moderately_active">
                    <SelectTrigger data-testid="select-activity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sedentary">Sedentary (desk job, no exercise)</SelectItem>
                      <SelectItem value="lightly_active">Lightly active (1-3 days/week)</SelectItem>
                      <SelectItem value="moderately_active">Moderately active (3-5 days/week)</SelectItem>
                      <SelectItem value="very_active">Very active (6-7 days/week)</SelectItem>
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
                  <Label>Goal type</Label>
                  <Select onValueChange={(v) => form.setValue("goalType", v as any)} defaultValue="maintenance">
                    <SelectTrigger data-testid="select-goal">
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
                  <>
                    <div className="space-y-1.5">
                      <Label>Target weight (lbs)</Label>
                      <Input type="number" placeholder="165" data-testid="input-target-weight"
                        {...form.register("targetWeightLbs", { valueAsNumber: true })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Target date</Label>
                      <Input type="date" data-testid="input-target-date" {...form.register("targetDate")} />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Step 2: Powerlifting */}
            {step === 2 && isPowerlifting && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label>Training days</Label>
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
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                            checked
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-secondary text-secondary-foreground border-border hover:border-primary"
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Meet date (optional)</Label>
                  <Input type="date" data-testid="input-meet-date" {...form.register("meetDate")} />
                </div>

                <div className="flex items-center gap-3">
                  <Checkbox
                    id="watercut"
                    data-testid="checkbox-watercut"
                    checked={form.watch("enableWaterCut")}
                    onCheckedChange={(v) => form.setValue("enableWaterCut", !!v)}
                  />
                  <Label htmlFor="watercut" className="cursor-pointer">
                    Enable 7-day water cut guidance before meet
                  </Label>
                </div>
              </div>
            )}

            <div className="flex justify-between mt-8">
              {step > 0 ? (
                <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back
                </Button>
              ) : <div />}

              {step < steps.length - 1 ? (
                <Button type="button" onClick={() => setStep(step + 1)} data-testid="button-next">
                  Next <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              ) : (
                <Button type="submit" disabled={form.formState.isSubmitting} data-testid="button-finish">
                  {form.formState.isSubmitting ? "Saving..." : "Get started"}
                </Button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
