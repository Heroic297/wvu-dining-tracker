import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { setToken } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";

interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
  onboardingComplete?: boolean;
  [key: string]: any;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  updateUser: (data: Partial<AuthUser>) => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = "wvu_token";
const USER_KEY = "wvu_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Note: sessionStorage is blocked in some iframe contexts.
    // We use a module-level variable in api.ts and also try sessionStorage.
    try {
      const storedToken = sessionStorage.getItem(TOKEN_KEY);
      const storedUser = sessionStorage.getItem(USER_KEY);
      if (storedToken && storedUser) {
        const u = JSON.parse(storedUser);
        setTokenState(storedToken);
        setUser(u);
        setToken(storedToken);
      }
    } catch {
      // sessionStorage blocked (iframe), rely on in-memory token only
    }
    setIsLoading(false);
  }, []);

  const login = (t: string, u: AuthUser) => {
    setTokenState(t);
    setUser(u);
    setToken(t);
    try {
      sessionStorage.setItem(TOKEN_KEY, t);
      sessionStorage.setItem(USER_KEY, JSON.stringify(u));
    } catch { /* ignore */ }
    queryClient.clear();
  };

  const logout = () => {
    setTokenState(null);
    setUser(null);
    setToken(null);
    try {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
    } catch { /* ignore */ }
    queryClient.clear();
  };

  const updateUser = (data: Partial<AuthUser>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...data };
      try {
        sessionStorage.setItem(USER_KEY, JSON.stringify(updated));
      } catch { /* ignore */ }
      return updated;
    });
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, updateUser, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
