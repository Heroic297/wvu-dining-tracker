import { useState } from "react";
import { useHashLocation } from "wouter/use-hash-location";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
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
  inviteCode: z.string().min(1, "Invite code is required"),
});

type RegisterForm = z.infer<typeof registerSchema>;

function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-label="Macro logo">
      <rect width="32" height="32" rx="8" fill="hsl(var(--primary))" opacity="0.18" />
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
  const [, setLocation] = useHashLocation();
  const { login } = useAuth();
  const { toast } = useToast();

  const form = useForm<RegisterForm>({
    resolver: zodResolver(isRegister ? registerSchema : loginSchema),
    defaultValues: { email: "", password: "", displayName: "", inviteCode: "" },
  });

  const onSubmit = async (data: RegisterForm) => {
    try {
      const resp = await (isRegister
        ? api.register(data.email, data.password, data.displayName, data.inviteCode)
        : api.login(data.email, data.password));
      const json = await resp.json();
      login(json.token, json.user);
      setLocation(json.user.onboardingComplete ? "/" : "/onboarding");
    } catch (err: any) {
      // Extract clean message from "STATUS: message" format that throwIfResNotOk produces
      const match = err.message?.match(/^\d+:\s*(.*)/);
      const msg = match ? match[1] : (err.message ?? "An error occurred");
      let parsed = msg;
      try { parsed = JSON.parse(msg).error ?? msg; } catch {}
      toast({ title: isRegister ? "Registration failed" : "Login failed", description: parsed, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
      {/* Ambient background orbs */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/4 left-1/3 w-80 h-80 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-56 h-56 rounded-full bg-primary/7 blur-3xl" />
        <div className="absolute top-2/3 left-1/5 w-40 h-40 rounded-full bg-emerald-800/10 blur-2xl" />
      </div>

      <div className="relative w-full max-w-[360px]">
        {/* Brand header */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="flex flex-col items-center gap-3 mb-8"
        >
          <div style={{ filter: "drop-shadow(0 0 12px hsl(158 64% 42% / 0.5))" }}>
            <LogoMark size={52} />
          </div>
          <div className="text-center">
            <h1
              className="text-2xl font-bold leading-none tracking-tight"
              style={{
                fontFamily: "var(--font-display)",
                background: "linear-gradient(135deg, hsl(158 64% 65%), hsl(158 64% 42%))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Macro
            </h1>
            <p className="text-xs text-white/35 mt-1">Nutrition &amp; Performance Tracker</p>
          </div>
        </motion.div>

        {/* Auth card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08, ease: "easeOut" }}
          className="bg-slate-900/70 backdrop-blur-xl border border-white/8 border-t-primary/25 rounded-2xl p-6 shadow-2xl shadow-black/50"
          style={{ borderTopColor: "hsl(158 64% 42% / 0.25)" }}
        >
          <h2 className="text-base font-semibold mb-0.5 text-white">
            {isRegister ? "Create account" : "Welcome back"}
          </h2>
          <p className="text-sm text-white/40 mb-5">
            {isRegister ? "Start tracking your nutrition today" : "Sign in to continue"}
          </p>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {isRegister && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="displayName" className="text-white/70 text-xs">Name</Label>
                  <Input
                    id="displayName"
                    placeholder="Your name"
                    data-testid="input-display-name"
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-primary/50"
                    {...form.register("displayName")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inviteCode" className="text-white/70 text-xs">Invite code</Label>
                  <Input
                    id="inviteCode"
                    placeholder="XXXXXXXX"
                    autoCapitalize="characters"
                    autoComplete="off"
                    data-testid="input-invite-code"
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-primary/50 font-mono tracking-widest"
                    {...form.register("inviteCode", {
                      onChange: (e) => {
                        e.target.value = e.target.value.toUpperCase();
                      },
                    })}
                  />
                  {form.formState.errors.inviteCode && (
                    <p className="text-xs text-destructive">{form.formState.errors.inviteCode.message}</p>
                  )}
                  <p className="text-xs text-white/30">Access is invite-only. Contact the owner to request a code.</p>
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-white/70 text-xs">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                data-testid="input-email"
                className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-primary/50"
                {...form.register("email")}
              />
              {form.formState.errors.email && (
                <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-white/70 text-xs">Password</Label>
                {!isRegister && (
                  <button
                    type="button"
                    onClick={() => toast({ title: "Password reset", description: "Contact the app owner to reset your password." })}
                    className="text-xs text-white/30 hover:text-primary transition-colors"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <Input
                id="password"
                type="password"
                placeholder={isRegister ? "At least 8 characters" : "••••••••"}
                data-testid="input-password"
                className="bg-white/5 border-white/10 text-white placeholder:text-white/25 focus:border-primary/50"
                {...form.register("password")}
              />
              {form.formState.errors.password && (
                <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-medium shadow-[0_0_16px_hsl(158_64%_42%/0.35)] hover:shadow-[0_0_20px_hsl(158_64%_42%/0.5)] transition-all"
              disabled={form.formState.isSubmitting}
              data-testid="button-submit"
            >
              {form.formState.isSubmitting
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Please wait</>
                : isRegister ? "Create account" : "Sign in"}
            </Button>
          </form>

          <div className="mt-5 pt-4 border-t border-white/8 text-center">
            <button
              type="button"
              onClick={() => { setIsRegister(!isRegister); form.reset(); }}
              className="text-sm text-white/35 hover:text-primary transition-colors"
              data-testid="button-toggle-auth"
            >
              {isRegister
                ? "Already have an account? Sign in"
                : "Don't have an account? Sign up"}
            </button>
          </div>
        </motion.div>

        <p className="text-center text-xs text-white/15 mt-5">
          Macro · WVU Nutrition &amp; Performance
        </p>
      </div>
    </div>
  );
}
