export const AI_MODEL_FEATURES = {
  job_analysis: {
    label: "Job Analysis",
    provider: "job_analysis_provider_id",
    model: "job_analysis_model",
    reasoning: "job_analysis_reasoning_effort",
  },
  matcher: {
    label: "Matcher",
    provider: "matcher_provider_id",
    model: "matcher_model",
    reasoning: "matcher_reasoning_effort",
  },
  resume_parser: {
    label: "Resume Parser",
    provider: "resume_parser_provider_id",
    model: "resume_parser_model",
    reasoning: "resume_parser_reasoning_effort",
  },
  ai_writing: {
    label: "AI Writing",
    provider: "ai_writing_provider_id",
    model: "ai_writing_model",
    reasoning: "ai_writing_reasoning_effort",
  },
} as const;

export const AI_REASONING_SETTINGS = [
  ...Object.values(AI_MODEL_FEATURES).map(({ provider, model, reasoning }) => ({
    provider, model, effort: reasoning, enabled: undefined,
  })),
  ...(["job_analysis", "matcher"] as const).map((stage) => ({
    provider: `${stage}_fallback_provider_id` as const,
    model: `${stage}_fallback_model` as const,
    effort: `${stage}_fallback_reasoning_effort` as const,
    enabled: `${stage}_fallback_enabled` as const,
  })),
];
