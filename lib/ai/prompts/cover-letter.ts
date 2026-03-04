export interface CoverLetterSettings {
  focus: string | string[];
  length: string;
  tone: string;
}

function toMarkdownLink(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return `[job posting](${normalized})`;
}

function getLengthInstruction(length: string): string {
  if (length === "short") return "about 145-185 words";
  if (length === "long") return "about 285-365 words";
  return "about 205-270 words";
}

function getFocusInstruction(focus: string | string[]): string {
  const selected = Array.isArray(focus) ? focus : [focus];
  const labels = selected
    .map((item) => {
      if (item === "skills") return "skills";
      if (item === "experience") return "experience";
      if (item === "cultural_fit") return "culture fit";
      return "";
    })
    .filter(Boolean);

  if (labels.length === 0) {
    return "Balance skills, experience, and culture fit.";
  }

  return `Prioritize: ${labels.join(", ")}.`;
}

function buildCandidateSnapshot(profileData: {
  education: Array<{ degree: string; institution: string; field: string | null }>;
  experience: Array<{ title: string; company: string; description: string | null }>;
  skills: Array<{ name: string; proficiency: number; category: string | null }>;
  summary: string | null;
}): string {
  const lines: string[] = [];

  if (profileData.summary) {
    lines.push(`Summary: ${profileData.summary.trim()}`);
  }

  const skills = profileData.skills.slice(0, 8).map((skill) => skill.name);
  if (skills.length > 0) {
    lines.push(`Skills: ${skills.join(", ")}`);
  }

  const experience = profileData.experience
    .slice(0, 3)
    .map((item) => `${item.title} at ${item.company}${item.description ? ` (${item.description.slice(0, 100)})` : ""}`);
  if (experience.length > 0) {
    lines.push(`Experience: ${experience.join("; ")}`);
  }

  const education = profileData.education
    .slice(0, 2)
    .map((item) => `${item.degree}${item.field ? ` in ${item.field}` : ""} at ${item.institution}`);
  if (education.length > 0) {
    lines.push(`Education: ${education.join("; ")}`);
  }

  return lines.length > 0 ? lines.join("\n") : "No additional candidate profile details available.";
}

export const COVER_LETTER_SYSTEM_PROMPT = `You write cover letters that sound simple, clean, and human.

Style requirements:
- Keep language natural and direct.
- No AI-sounding filler or buzzwords.
- Respect the requested {tone}.
- Use concrete evidence, not generic claims.
- Do not invent facts.

Output requirements:
1. Return Markdown only.
2. Allowed Markdown:
   - Paragraphs
   - **bold** for 0-3 short phrases only
   - Links as [text](https://...)
3. Do not use headings, lists, tables, or code blocks.
4. Do not include placeholders.
5. Return letter body only.`;

export function buildCoverLetterPromptFromProfileData(
  jobTitle: string,
  companyName: string,
  jobDescription: string,
  profileData: {
    education: Array<{ degree: string; institution: string; field: string | null }>;
    experience: Array<{ title: string; company: string; description: string | null }>;
    name?: string;
    skills: Array<{ name: string; proficiency: number; category: string | null }>;
    summary: string | null;
  },
  settings: CoverLetterSettings,
  jobUrl?: string | null,
  jobExternalId?: string | null
): string {
  const jobLink = toMarkdownLink(jobUrl);
  const linkInstruction = jobLink
    ? `If natural, include this link once: ${jobLink}.`
    : "Do not invent or fabricate links.";

  return `Task
Write a cover letter for this role.

Context
- Role: ${jobTitle}
- Company: ${companyName}
- Job ID: ${jobExternalId || "N/A"}
- Tone: ${settings.tone}
- Length: ${getLengthInstruction(settings.length)}
- Focus: ${getFocusInstruction(settings.focus)}

Job description (trimmed)
${jobDescription.slice(0, 1800)}

Candidate snapshot
${buildCandidateSnapshot(profileData)}

Directions
- Open with clear interest in the role and company.
- Match 2-3 relevant strengths from the candidate snapshot to the role.
- Keep claims specific and believable.
- Close with a polite, confident next-step line.
- Use **bold** for 1-2 short high-impact phrases.
- ${linkInstruction}
`;
}
