import type { AIContentType } from "@/lib/ai/contracts";

const MAX_WRITING_OUTPUT_CHARS = 20_000;
const LOW_SIGNAL_OUTPUTS = new Set(["test", "testing", "ntg", "none", "n/a", "na", "placeholder"]);

function normalizeUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function containsOnlyAllowedUrls(text: string, allowedLinks: string[]): boolean {
  const allowed = new Set(allowedLinks.flatMap((value) => {
    const normalized = normalizeUrl(value);
    return normalized ? [normalized] : [];
  }));
  const markdownDestinations = Array.from(
    text.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g),
    (match) => match[1]
  );
  if (markdownDestinations.some((destination) => {
    const normalized = normalizeUrl(destination);
    return normalized === null || !allowed.has(normalized);
  })) return false;

  const withoutMarkdownLinks = text.replace(/(?<!!)\[[^\]]*\]\([^)]+\)/g, "");
  const urls = withoutMarkdownLinks.match(/https?:\/\/[^\s)>\]}]+/gi) ?? [];
  return urls.every((value) => {
    const normalized = normalizeUrl(value.replace(/[.,;:!?]+$/, ""));
    return normalized !== null && allowed.has(normalized);
  });
}

function hasInvalidMarkdown(text: string): boolean {
  return /```|!\[[^\]]*\]\(|<\/?[a-z][^>]*>/i.test(text) ||
    /^\s*(?:#{1,6}\s|[-+*]\s|\d+[.)]\s|>\s|\|.*\|\s*$)/m.test(text);
}

function hasInvalidPlaceholder(type: AIContentType, text: string): boolean {
  const placeholders = text.match(/\{\{[^{}]+\}\}/g) ?? [];
  const allowed = type === "cover_letter" ? [] : ["{{connection_first_name}}"];
  if (placeholders.some((placeholder) => !allowed.includes(placeholder))) return true;
  return type !== "cover_letter" && !text.includes("{{connection_first_name}}");
}

function hasInvalidRecruiterPerspective(text: string, profileName: string): boolean {
  const normalized = text.toLowerCase();
  if (/\b(the candidate|this candidate|he|she)\b/.test(normalized)) return true;
  if (/\bthey have applied\b/.test(normalized)) return true;
  const name = profileName.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (name && new RegExp(`${name}\\s+has\\s+applied`).test(normalized)) return true;
  return !/\b(i|me|my)\b/.test(normalized);
}

export function isValidWritingOutput(input: {
  type: AIContentType;
  text: string;
  profileName: string;
  allowedLinks: string[];
}): boolean {
  const text = input.text.trim();
  const normalized = text.toLowerCase();
  if (!text || text.length > MAX_WRITING_OUTPUT_CHARS) return false;
  if (LOW_SIGNAL_OUTPUTS.has(normalized.replace(/[.!?,;:]/g, ""))) return false;
  if (!/[a-z]{3}/.test(normalized)) return false;
  const minimumWords: Record<AIContentType, number> = {
    cover_letter: 35,
    recruiter_follow_up: 10,
    referral: 10,
  };
  if (normalized.split(/\s+/).filter(Boolean).length < minimumWords[input.type]) return false;
  if (hasInvalidMarkdown(text) || hasInvalidPlaceholder(input.type, text)) return false;
  if (!containsOnlyAllowedUrls(text, input.allowedLinks)) return false;
  return input.type !== "recruiter_follow_up" ||
    !hasInvalidRecruiterPerspective(text, input.profileName);
}
