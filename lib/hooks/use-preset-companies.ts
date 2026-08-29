"use client";

import { useQuery } from "@tanstack/react-query";

import {
  parsePresetCompanies,
  type PresetCompany,
} from "@/lib/companies/preset-companies";
import { queryKeys } from "@/lib/query-keys";

async function fetchPresetCompanies(): Promise<PresetCompany[]> {
  const response = await fetch("/companies.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load preset companies");
  }

  const raw: unknown = await response.json();
  if (!Array.isArray(raw)) {
    throw new Error("Invalid companies.json format");
  }

  return parsePresetCompanies(raw);
}

export function usePresetCompanies() {
  return useQuery({
    queryKey: queryKeys.companies.presets(),
    queryFn: fetchPresetCompanies,
  });
}
