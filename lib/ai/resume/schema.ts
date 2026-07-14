import { BlockList, isIP } from "node:net";

import { z } from "zod";

const OPTIONAL_TEXT = z.string().max(10_000).nullable().optional();

export const ResumeDataSchema = z.object({
  name: z.string().max(300),
  email: z.string().max(500).nullable().optional(),
  phone: z.string().max(100).nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  linkedinUrl: z.string().max(2_000).nullable().optional(),
  githubUrl: z.string().max(2_000).nullable().optional(),
  portfolioUrl: z.string().max(2_000).nullable().optional(),
  summary: OPTIONAL_TEXT,
  skills: z.array(z.object({
    name: z.string().max(300),
    category: z.string().max(300).optional(),
  })).max(500),
  experience: z.array(z.object({
    company: z.string().max(500),
    title: z.string().max(500),
    location: z.string().max(500).nullable().optional(),
    startDate: z.string().max(100),
    endDate: z.string().max(100).nullable().optional(),
    description: OPTIONAL_TEXT,
    highlights: z.array(z.string().max(2_000)).max(100).optional(),
  })).max(100),
  education: z.array(z.object({
    institution: z.string().max(500),
    degree: z.string().max(500),
    field: z.string().max(500).nullable().optional(),
    startDate: z.string().max(100).nullable().optional(),
    endDate: z.string().max(100).nullable().optional(),
    gpa: z.string().max(100).nullable().optional(),
    honors: z.string().max(1_000).nullable().optional(),
  })).max(100).optional(),
});

export const ResumeValidationWarningSchema = z.object({
  code: z.enum([
    "duplicate_skill",
    "empty_required_field",
    "malformed_date",
    "suspicious_url",
  ]),
  path: z.string().min(1).max(500),
  message: z.string().min(1).max(1_000),
});

export const ResumeValidationWarningsSchema = z.array(ResumeValidationWarningSchema).max(1_000);

export type ResumeData = z.infer<typeof ResumeDataSchema>;
export type ResumeValidationWarning = z.infer<typeof ResumeValidationWarningSchema>;

const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const NON_PUBLIC_IPS = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) NON_PUBLIC_IPS.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) NON_PUBLIC_IPS.addSubnet(address, prefix, "ipv6");

function cleanOptional(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  return value.trim();
}

function warning(
  code: ResumeValidationWarning["code"],
  path: string,
  message: string
): ResumeValidationWarning {
  return { code, path, message };
}

function validateDate(
  value: string | null | undefined,
  path: string,
  warnings: ResumeValidationWarning[]
): void {
  if (value && !DATE_PATTERN.test(value)) {
    warnings.push(warning("malformed_date", path, "Date should use YYYY-MM format."));
  }
}

function isSuspiciousUrl(value: string, expectedHost?: string): boolean {
  if (value.length > 2_000) return true;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
    if (parsed.username || parsed.password) return true;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
    const ipVersion = isIP(host);
    if (ipVersion && NON_PUBLIC_IPS.check(host, ipVersion === 4 ? "ipv4" : "ipv6")) return true;
    return expectedHost ? !(host === expectedHost || host.endsWith(`.${expectedHost}`)) : false;
  } catch {
    return true;
  }
}

export function normalizeResumeData(input: ResumeData): {
  parsedData: ResumeData;
  warnings: ResumeValidationWarning[];
} {
  const warnings: ResumeValidationWarning[] = [];
  const skills: ResumeData["skills"] = [];
  const seenSkills = new Set<string>();
  for (const [index, skill] of input.skills.entries()) {
    const name = skill.name.trim();
    const key = name.toLocaleLowerCase("en-US");
    if (!name) {
      warnings.push(warning("empty_required_field", `skills.${index}.name`, "Skill name is empty."));
      continue;
    }
    if (seenSkills.has(key)) {
      warnings.push(warning("duplicate_skill", `skills.${index}.name`, `Duplicate skill removed: ${name}.`));
      continue;
    }
    seenSkills.add(key);
    skills.push({ name, ...(skill.category?.trim() ? { category: skill.category.trim() } : {}) });
  }

  const experience = input.experience.map((item, index) => {
    const normalized = {
      ...item,
      company: item.company.trim(),
      title: item.title.trim(),
      startDate: item.startDate.trim(),
      endDate: cleanOptional(item.endDate),
      location: cleanOptional(item.location),
      description: cleanOptional(item.description),
      highlights: item.highlights?.map((value) => value.trim()).filter(Boolean),
    };
    for (const field of ["company", "title", "startDate"] as const) {
      if (!normalized[field]) warnings.push(warning(
        "empty_required_field",
        `experience.${index}.${field}`,
        `${field} is empty.`
      ));
    }
    validateDate(normalized.startDate, `experience.${index}.startDate`, warnings);
    validateDate(normalized.endDate, `experience.${index}.endDate`, warnings);
    return normalized;
  });

  const education = input.education?.map((item, index) => {
    const normalized = {
      ...item,
      institution: item.institution.trim(),
      degree: item.degree.trim(),
      field: cleanOptional(item.field),
      startDate: cleanOptional(item.startDate),
      endDate: cleanOptional(item.endDate),
      gpa: cleanOptional(item.gpa),
      honors: cleanOptional(item.honors),
    };
    for (const field of ["institution", "degree"] as const) {
      if (!normalized[field]) warnings.push(warning(
        "empty_required_field",
        `education.${index}.${field}`,
        `${field} is empty.`
      ));
    }
    validateDate(normalized.startDate, `education.${index}.startDate`, warnings);
    validateDate(normalized.endDate, `education.${index}.endDate`, warnings);
    return normalized;
  });

  const urls = [
    ["linkedinUrl", input.linkedinUrl, "linkedin.com"],
    ["githubUrl", input.githubUrl, "github.com"],
    ["portfolioUrl", input.portfolioUrl, undefined],
  ] as const;
  for (const [path, value, expectedHost] of urls) {
    if (value?.trim() && isSuspiciousUrl(value.trim(), expectedHost)) {
      warnings.push(warning(
        "suspicious_url",
        path,
        "URL is malformed, private, or does not match the expected service."
      ));
    }
  }

  const name = input.name.trim();
  if (!name) warnings.push(warning("empty_required_field", "name", "Candidate name is empty."));
  return {
    parsedData: {
      ...input,
      name,
      email: cleanOptional(input.email),
      phone: cleanOptional(input.phone),
      location: cleanOptional(input.location),
      linkedinUrl: cleanOptional(input.linkedinUrl),
      githubUrl: cleanOptional(input.githubUrl),
      portfolioUrl: cleanOptional(input.portfolioUrl),
      summary: cleanOptional(input.summary),
      skills,
      experience,
      education,
    },
    warnings: ResumeValidationWarningsSchema.parse(warnings.slice(0, 1_000)),
  };
}
