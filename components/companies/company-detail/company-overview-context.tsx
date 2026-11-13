"use client";

import { createContext, useContext } from "react";

import type { CompanyOverviewResponse } from "@/lib/api/contracts/companies";

export const CompanyOverviewContext =
  createContext<CompanyOverviewResponse | null>(null);

export const useCompanyOverview = () => {
  const overview = useContext(CompanyOverviewContext);
  if (!overview)
    throw new Error("Company tabs must render inside the company layout");
  return overview;
};
