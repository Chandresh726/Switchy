"use client";

import { createContext, useContext, useMemo, useState } from "react";

import type { NoteSaveIndicatorState } from "./company-note-save-indicator";

interface CompanyNotesContextValue {
  noteSaveIndicator: NoteSaveIndicatorState;
  setNoteSaveIndicator: (state: NoteSaveIndicatorState) => void;
}

const CompanyNotesContext = createContext<CompanyNotesContextValue | null>(null);

export function CompanyNotesProvider({ children }: { children: React.ReactNode }) {
  const [noteSaveIndicator, setNoteSaveIndicator] = useState<NoteSaveIndicatorState>("hidden");

  const value = useMemo(
    () => ({
      noteSaveIndicator,
      setNoteSaveIndicator,
    }),
    [noteSaveIndicator]
  );

  return (
    <CompanyNotesContext.Provider value={value}>
      {children}
    </CompanyNotesContext.Provider>
  );
}

export function useCompanyNotesContext(): CompanyNotesContextValue {
  const context = useContext(CompanyNotesContext);

  if (!context) {
    throw new Error("useCompanyNotesContext must be used within CompanyNotesProvider");
  }

  return context;
}
