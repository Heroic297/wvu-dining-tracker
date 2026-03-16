import { Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import Layout from "@/components/Layout";
import LoginPage from "@/pages/LoginPage";
import OnboardingPage from "@/pages/OnboardingPage";
import DashboardPage from "@/pages/DashboardPage";
import LogMealPage from "@/pages/LogMealPage";
import HistoryPage from "@/pages/HistoryPage";
import DietPlanPage from "@/pages/DietPlanPage";
import SettingsPage from "@/pages/SettingsPage";
import { Loader2 } from "lucide-react";

function AppRoutes() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <Router hook={useHashLocation}>
        <Route path="/login" component={LoginPage} />
        <Route component={LoginPage} />
      </Router>
    );
  }

  if (!user.onboardingComplete) {
    return (
      <Router hook={useHashLocation}>
        <Route component={OnboardingPage} />
      </Router>
    );
  }

  return (
    <Layout>
      <Router hook={useHashLocation}>
        <Route path="/" component={DashboardPage} />
        <Route path="/log" component={LogMealPage} />
        <Route path="/history" component={HistoryPage} />
        <Route path="/plan" component={DietPlanPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={DashboardPage} />
      </Router>
    </Layout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppRoutes />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}
