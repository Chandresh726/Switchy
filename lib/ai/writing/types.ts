export interface HistoryVariant {
  id: number;
  variant: string;
  userPrompt: string | null;
  createdAt: string;
}

export interface GeneratedContent {
  id: number;
  jobId: number;
  type: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  history: HistoryVariant[];
  jobTitle?: string | null;
  companyName?: string | null;
  companyLogoUrl?: string | null;
}

export interface ContentResponse {
  id: number;
  jobId: number;
  type: string;
  content: string;
  settingsSnapshot: string | null;
  createdAt: string;
  updatedAt: string;
  history: HistoryVariant[];
  jobTitle?: string | null;
  companyName?: string | null;
  companyLogoUrl?: string | null;
}
