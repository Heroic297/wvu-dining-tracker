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
import { Loader2 } from "lucide-react";

const loginSchema = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password required"),
});
const registerSchema = loginSchema.extend({
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().optional(),
});

type RegisterForm = z.infer<typeof registerSchema>;

/** Inline logo mark — same as Layout */
function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-label="Macro logo">
      <rect width="32" height="32" rx="8" fill="hsl(var(--primary))" opacity="0.12" />
      <path
        d="M5 22V11l5.5 7.5L16 11l5.5 7.5L27 11v11"
        stroke="hsl(var(--primary))"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
      <div className="w-full max-w-[360px] fade-up">

        {/* Brand header */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <LogoMark size={48} />
          <div className="text-center">
            <h1
              className="text-2xl font-bold text-foreground leading-none tracking-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Macro
            </h1>
            <p className="text-xs text-muted-foreground mt-1">Nutrition &amp; Performance Tracker</p>
          </div>
        </div>

        {/* Auth card */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
          <h2 className="text-base font-semibold mb-0.5">
            {isRegister ? "Create account" : "Welcome back"}
          </h2>
          <p className="text-sm text-muted-foreground mb-5">
            {isRegister ? "Start tracking your nutrition today" : "Sign in to continue"}
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
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Please wait</>
                : isRegister ? "Create account" : "Sign in"}
            </Button>
          </form>

          <div className="mt-5 pt-4 border-t border-border text-center">
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

        <p className="text-center text-xs text-muted-foreground mt-5">
          <a href="https://www.perplexity.ai/computer" target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
            Created with Perplexity Computer
          </a>
        </p>
      </div>
    </div>
  );
}
