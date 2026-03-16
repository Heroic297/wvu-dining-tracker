import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Dumbbell } from "lucide-react";

const loginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password required"),
});
const registerSchema = loginSchema.extend({
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().optional(),
});

type LoginForm = z.infer<typeof loginSchema>;
type RegisterForm = z.infer<typeof registerSchema>;

export default function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const { toast } = useToast();

  const form = useForm<RegisterForm>({
    resolver: zodResolver(isRegister ? registerSchema : loginSchema),
    defaultValues: { email: "", password: "", displayName: "" },
  });

  const onSubmit = async (data: RegisterForm) => {
    try {
      const resp = await (isRegister
        ? api.register(data.email, data.password, data.displayName)
        : api.login(data.email, data.password));
      const json = await resp.json();
      login(json.token, json.user);
      setLocation(json.user.onboardingComplete ? "/" : "/onboarding");
    } catch (err: any) {
      const msg = err.message?.includes(": ")
        ? err.message.split(": ").slice(1).join(": ")
        : err.message;
      let parsed = msg;
      try { parsed = JSON.parse(msg).error ?? msg; } catch {}
      toast({ title: isRegister ? "Registration failed" : "Login failed", description: parsed, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
            <Dumbbell className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground leading-none">WVU Dining</h1>
            <p className="text-xs text-muted-foreground">Tracker</p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-1">
            {isRegister ? "Create account" : "Welcome back"}
          </h2>
          <p className="text-sm text-muted-foreground mb-5">
            {isRegister ? "Start tracking your nutrition" : "Sign in to your account"}
          </p>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {isRegister && (
              <div className="space-y-1.5">
                <Label htmlFor="displayName">Name</Label>
                <Input
                  id="displayName"
                  placeholder="Your name"
                  data-testid="input-display-name"
                  {...form.register("displayName")}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                data-testid="input-email"
                {...form.register("email")}
              />
              {form.formState.errors.email && (
                <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder={isRegister ? "At least 8 characters" : "••••••••"}
                data-testid="input-password"
                {...form.register("password")}
              />
              {form.formState.errors.password && (
                <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={form.formState.isSubmitting}
              data-testid="button-submit"
            >
              {form.formState.isSubmitting
                ? "Please wait..."
                : isRegister
                ? "Create account"
                : "Sign in"}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => { setIsRegister(!isRegister); form.reset(); }}
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
              data-testid="button-toggle-auth"
            >
              {isRegister
                ? "Already have an account? Sign in"
                : "Don't have an account? Sign up"}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          West Virginia University · Dining Nutrition Tracker
        </p>
      </div>
    </div>
  );
}
