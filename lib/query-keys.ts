export const companyKeys = {
  all: ["companies"] as const,
  list: () => [...companyKeys.all] as const,
  detail: (id: number) => [...companyKeys.all, id] as const,
  overview: (id: number) => ["company-overview", id] as const,
};

export const jobKeys = {
  all: ["jobs"] as const,
  list: () => [...jobKeys.all] as const,
  listWithParams: (params: Record<string, unknown>) => [...jobKeys.all, params] as const,
  detail: (id: number) => ["job", id] as const,
  topMatches: () => [...jobKeys.all, "top-matches"] as const,
  highMatch: () => [...jobKeys.all, "high-match"] as const,
  recent: () => [...jobKeys.all, "recent"] as const,
  appliedRecent: () => [...jobKeys.all, "applied-recent"] as const,
  appliedCount: () => [...jobKeys.all, "applied-count"] as const,
  savedCount: () => [...jobKeys.all, "saved-count"] as const,
  archivedCount: () => [...jobKeys.all, "archived-count"] as const,
};

export const connectionKeys = {
  all: ["connections"] as const,
  list: () => [...connectionKeys.all] as const,
  listWithParams: (params: Record<string, unknown>) => [...connectionKeys.all, params] as const,
  totalCount: () => [...connectionKeys.all, "total-count"] as const,
  byCompany: (companyId: number) => [...connectionKeys.all, "company", companyId] as const,
  importSessions: () => ["connection-import-sessions"] as const,
  unmatchedCompanies: {
    all: () => ["unmatched-linkedin-companies"] as const,
    summary: () => [...connectionKeys.unmatchedCompanies.all(), "summary"] as const,
    list: (mode: string, search: string, page: number, pageSize: number) =>
      [`${mode}-linkedin-companies`, search, page, pageSize] as const,
    connections: (companyNormalized: string, page: number, pageSize: number) =>
      ["unmatched-company-connections", companyNormalized, page, pageSize] as const,
  },
  ignoredCompanies: () => ["ignored-linkedin-companies"] as const,
};

export const profileKeys = {
  all: ["profile"] as const,
  detail: () => [...profileKeys.all] as const,
  education: (profileId: string) => ["education", profileId] as const,
};

export const statsKeys = {
  all: ["stats"] as const,
  detail: () => [...statsKeys.all] as const,
};

export const scrapeHistoryKeys = {
  all: ["scrape-history"] as const,
  list: () => [...scrapeHistoryKeys.all] as const,
  detail: (id: string) => [...scrapeHistoryKeys.all, id] as const,
};

export const matchHistoryKeys = {
  all: ["match-history"] as const,
  list: () => [...matchHistoryKeys.all] as const,
  detail: (id: string) => [...matchHistoryKeys.all, id] as const,
};

export const aiHistoryKeys = {
  all: ["ai-history-all"] as const,
};

export const presetCompaniesKeys = {
  all: ["preset-companies"] as const,
};
