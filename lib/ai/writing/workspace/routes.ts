import type { AIContentType } from "@/lib/ai/contracts";

export function getWorkspacePath(jobId: number, type: AIContentType): string {
  if (type === "referral") {
    return `/jobs/${jobId}/referral-send`;
  }

  if (type === "recruiter_follow_up") {
    return `/jobs/${jobId}/recruiter-follow-up`;
  }

  return `/jobs/${jobId}/cover-letter`;
}

export function getWorkspacePathWithVariant(
  jobId: number,
  type: AIContentType,
  variantId?: number
): string {
  const basePath = getWorkspacePath(jobId, type);
  if (!variantId) {
    return basePath;
  }

  const params = new URLSearchParams();
  params.set("variantId", String(variantId));
  return `${basePath}?${params.toString()}`;
}

export function getContentTypeLabel(type: AIContentType): string {
  if (type === "referral") return "Referral Message";
  if (type === "recruiter_follow_up") return "Recruiter Follow-up";
  return "Cover Letter";
}
