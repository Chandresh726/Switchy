export interface ReferralSettings {
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

function getCandidateSignal(profileData: {
  experience: Array<{ title: string; company: string; description: string | null }>;
  skills: Array<{ name: string; proficiency: number; category: string | null }>;
  summary: string | null;
}): string {
  const signals: string[] = [];

  if (profileData.summary) {
    signals.push(`Summary: ${profileData.summary.trim()}`);
  }

  const topSkills = profileData.skills.slice(0, 5).map((skill) => skill.name);
  if (topSkills.length > 0) {
    signals.push(`Top skills: ${topSkills.join(", ")}`);
  }

  const recentRoles = profileData.experience
    .slice(0, 2)
    .map((experience) => `${experience.title} at ${experience.company}`);
  if (recentRoles.length > 0) {
    signals.push(`Recent roles: ${recentRoles.join("; ")}`);
  }

  return signals.length > 0 ? signals.join("\n") : "No additional candidate signal available.";
}

export const REFERRAL_SYSTEM_PROMPT = `You write outreach messages that sound simple, clean, and human.

Style requirements:
- Keep language plain and direct.
- No hype, no buzzwords, no exaggerated claims.
- Respect the requested {tone}.
- Keep the message concise.

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

export function buildReferralPromptFromProfileData(
  jobTitle: string,
  companyName: string,
  profileData: {
    education: Array<{ degree: string; institution: string; field: string | null }>;
    experience: Array<{ title: string; company: string; description: string | null }>;
    name?: string;
    skills: Array<{ name: string; proficiency: number; category: string | null }>;
    summary: string | null;
  },
  settings: ReferralSettings,
  jobUrl?: string | null,
  jobExternalId?: string | null
): string {
  const jobLink = toMarkdownLink(jobUrl);
  const linkInstruction = jobLink
    ? `If natural, include this link once: ${jobLink}.`
    : "Do not invent or fabricate links.";

  return `Task
Write a referral request message to a connection.

Context
- Role: ${jobTitle}
- Company: ${companyName}
- Job ID: ${jobExternalId || "N/A"}
- Tone: ${settings.tone}
- Length: ${getLengthInstruction(settings.length)}

Candidate signal (for relevance only)
${getCandidateSignal(profileData)}

Directions
- Start with: Hi {{connection_first_name}},
- Mention interest in the role.
- Add one short, concrete line on fit from candidate signal.
- Politely ask for a referral.
- Keep it low-pressure and natural.
- Use **bold** once for a key phrase (role or fit).
- ${linkInstruction}
`;
}
