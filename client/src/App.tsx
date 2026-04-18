import { Route, Router, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import ErrorBoundary from "@/components/ErrorBoundary";
import Layout from "@/components/Layout";
import LoginPage from "@/pages/LoginPage";
import OnboardingPage from "@/pages/OnboardingPage";
import DashboardPage from "@/pages/DashboardPage";
import LogMealPage from "@/pages/LogMealPage";
import HistoryPage from "@/pages/HistoryPage";
import DietPlanPage from "@/pages/DietPlanPage";
import SettingsPage from "@/pages/SettingsPage";
import InvitePage from "@/pages/InvitePage";
import CoachPage from "@/pages/CoachPage";
import WearablesPage from "@/pages/WearablesPage";
import PhysiquePage from "@/pages/PhysiquePage";
import TrainingPage from "@/pages/TrainingPage";
import NotFoundPage from "@/pages/not-found";
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
    return <LoginPage />;
  }

  if (!user.onboardingComplete) {
    return <OnboardingPage />;
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/log" component={LogMealPage} />
        <Route path="/history" component={HistoryPage} />
        <Route path="/plan" component={DietPlanPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/wearables" component={WearablesPage} />
        <Route path="/invites" component={InvitePage} />
        <Route path="/coach" component={CoachPage} />
        <Route path="/physique" component={PhysiquePage} />
        <Route path="/train" component={TrainingPage} />
        <Route component={NotFoundPage} />
      </Switch>
    </Layout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router hook={useHashLocation}>
          <ErrorBoundary>
            <AppRoutes />
          </ErrorBoundary>
          <Toaster />
        </Router>
      </AuthProvider>
    </QueryClientProvider>
  );
}
