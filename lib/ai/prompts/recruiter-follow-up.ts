export interface RecruiterFollowUpSettings {
  length: string;
  tone: string;
}

function toMarkdownLink(url?: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return `[${normalized}](${normalized})`;
}

function getLengthInstruction(length: string): string {
  if (length === "short") return "about 55-70 words";
  if (length === "long") return "about 105-135 words";
  return "about 75-95 words";
}

function getRecruiterFacingJobReference(jobExternalId?: string | null): string | null {
  if (!jobExternalId) return null;
  const trimmed = jobExternalId.trim();
  if (!trimmed) return null;

  // Ignore obvious internal/import identifiers that should never be sent to recruiters.
  if (/^(lever|greenhouse|ashby|workday|eightfold)-/i.test(trimmed)) return null;
  if (/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(trimmed)) return null;
  if (trimmed.length > 40) return null;

  return trimmed;
}

export const RECRUITER_FOLLOW_UP_SYSTEM_PROMPT = `You write recruiter follow-up messages that sound simple, clean, and human.

Critical voice requirements:
- Write from my first-person point of view only.
- Use "I", "my", and "me".
- Never use third-person phrasing like "the candidate" or "{name} has applied".

Style requirements:
- Keep language plain and direct.
- No hype, no buzzwords, no over-selling.
- Respect the requested {tone}.

Output requirements:
1. Return Markdown only.
2. Allowed Markdown:
   - Paragraphs
   - **bold** for 0-2 short phrases only
   - Links as [text](https://...)
3. Do not use headings, lists, tables, or code blocks.
4. Do not use placeholders except {{connection_first_name}}.
5. Return message body only (no subject line).
6. If you include a link, use the full URL as the link text and put it in its own sentence.`;

export function buildRecruiterFollowUpPromptFromProfileData(
  jobTitle: string,
  companyName: string,
  _profileData: {
    education: Array<{ degree: string; institution: string; field: string | null }>;
    experience: Array<{ title: string; company: string; description: string | null }>;
    name?: string;
    skills: Array<{ name: string; proficiency: number; category: string | null }>;
    summary: string | null;
  },
  settings: RecruiterFollowUpSettings,
  jobUrl?: string | null,
  jobExternalId?: string | null
): string {
  const link = toMarkdownLink(jobUrl);
  const recruiterFacingJobReference = getRecruiterFacingJobReference(jobExternalId);
  const linkInstruction = link
    ? `If natural, include this link once: ${link}.`
    : "Do not invent or fabricate links.";

  return `Task
Write a short recruiter follow-up message after I have already applied.

Context
- Role: ${jobTitle}
- Company: ${companyName}
- Tone: ${settings.tone}
- Length: ${getLengthInstruction(settings.length)}
${recruiterFacingJobReference ? `- Recruiter-facing Job Reference: ${recruiterFacingJobReference}` : ""}

Directions
- Start with: Hi {{connection_first_name}},
- Mention clearly that I already applied for this role.
- Ask politely for a quick review/check of my application.
- Keep it respectful and low-pressure.
- Keep the full message in first-person voice.
- Use **bold** once for a key phrase when natural.
- Do not mention any internal tracking IDs or system codes.
- Mention a job reference only if the recruiter-facing reference above is provided.
- ${linkInstruction}
`;
}
