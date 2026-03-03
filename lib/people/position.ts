const RECRUITER_POSITION_KEYWORDS = [
  "recruiter",
  "talent acquisition",
  "talent partner",
  "sourcer",
  "people operations",
  "human resources",
  "hrbp",
] as const;

export function isRecruiterPosition(position: string | null | undefined): boolean {
  if (!position) return false;
  const normalized = position.toLowerCase();
  return RECRUITER_POSITION_KEYWORDS.some((keyword) => normalized.includes(keyword));
}
