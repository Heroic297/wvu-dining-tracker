import { createContext, useContext, type ReactNode } from "react";
import { useLocalModel } from "@/hooks/use-local-model";

type LocalModelContextType = ReturnType<typeof useLocalModel>;

const LocalModelContext = createContext<LocalModelContextType | null>(null);

export function LocalModelProvider({ children }: { children: ReactNode }) {
  const model = useLocalModel();
  return (
    <LocalModelContext.Provider value={model}>
      {children}
    </LocalModelContext.Provider>
  );
}

export function useLocalModelContext(): LocalModelContextType {
  const ctx = useContext(LocalModelContext);
  if (!ctx) throw new Error("useLocalModelContext must be used within LocalModelProvider");
  return ctx;
}
