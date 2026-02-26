export interface CoverLetterSettings {
  tone: string;
  length: string;
  focus: string | string[];
}

const PROFICIENCY_LEVELS = ["Beginner", "Elementary", "Intermediate", "Advanced", "Expert"] as const;

function getProficiencyLabel(proficiency: number): string {
  return PROFICIENCY_LEVELS[proficiency - 1] ?? "Intermediate";
}

export const COVER_LETTER_SYSTEM_PROMPT = `You are an expert at writing cover letters. Your task is to help candidates craft compelling, personalized cover letters for job applications.

Guidelines:
- Write exactly like a human naturally would in a real, authentic email.
- Keep it extremely simple, conversational, and direct. Do NOT overcomplicate.
- AVOID classic AI corporate speak completely (e.g., "leverage", "testament", "delve", "dynamic", "spearheaded", "thrilled", "innovative").
- State facts clearly without excessive adjectives or fluff.
- Use a {tone} tone (professional/formal/casual/flexible)
- Address the hiring manager or team if possible
- Hook the reader with a simple, genuine opening
- Connect the candidate's experience to the job requirements directly
- Show enthusiasm for the company without sounding overly dramatic or sycophantic
- End with a simple, clear call to action
- NEVER fabricate or hallucinate experiences or skills

CRITICAL RULES:
1. NEVER use placeholders like [Your Name], [Hiring Manager Name], [Date], or any bracketed text. Always use actual values provided in the context. If a name is not provided, use a professional generic salutation.
2. RETURN PLAIN TEXT ONLY - NO MARKDOWN FORMATTING. Do NOT use:
   - Bold (**text**) or italics (*text*)
   - Headers (# or ##)
   - Bullet points (- or *)
   - Tables
   - Code blocks
   - Links [text](url)
   - Any other markdown syntax
3. You MAY use:
   - Regular paragraphs separated by blank lines
   - Line breaks within paragraphs where appropriate

Length guidelines:
- short: ~100 words (concise and direct)
- medium: ~200 words (standard length)
- long: ~300 words (detailed)

Focus areas:
- skills: Emphasize how the candidate's skills match the job requirements
- experience: Focus on relevant work history and achievements
- cultural_fit: Highlight soft skills and alignment with company values

The cover letter should be ready to submit with a job application.`;

export function buildCoverLetterPromptFromProfileData(
  jobTitle: string,
  companyName: string,
  jobDescription: string,
  profileData: {
    name?: string;
    summary: string | null;
    skills: Array<{ name: string; proficiency: number; category: string | null }>;
    experience: Array<{ title: string; company: string; description: string | null }>;
    education: Array<{ degree: string; institution: string; field: string | null }>;
  },
  settings: CoverLetterSettings,
  jobUrl?: string | null,
  jobExternalId?: string | null
): string {
  const lengthGuidance = {
    short: "Keep it concise, around 100 words.",
    medium: "Provide a complete letter, around 200 words.",
    long: "Provide a detailed letter, around 300 words.",
  };

  const focusGuidance = {
    skills: "Focus on how the candidate's skills match the job requirements.",
    experience: "Focus on the candidate's relevant work experience and achievements.",
    cultural_fit: "Highlight soft skills and alignment with company values.",
  };

  const focusArray = Array.isArray(settings.focus) ? settings.focus : [settings.focus];
  const focusText = focusArray.map(f => focusGuidance[f as keyof typeof focusGuidance] || "").filter(Boolean).join(" ");

  const profileInfo: string[] = [];

  if (profileData.name) {
    profileInfo.push(`**Name:** ${profileData.name}`);
  }

  if (profileData.summary) {
    profileInfo.push(`**Summary:** ${profileData.summary}`);
  }

  if (profileData.skills.length > 0) {
    const skillList = profileData.skills
      .map((s) => `${s.name} (${getProficiencyLabel(s.proficiency)})`)
      .join(", ");
    profileInfo.push(`**Skills:** ${skillList}`);
  }

  if (profileData.experience.length > 0) {
    const expList = profileData.experience
      .map((e) => `${e.title} at ${e.company}${e.description ? `: ${e.description}` : ""}`)
      .join("\n");
    profileInfo.push(`**Experience:**\n${expList}`);
  }

  if (profileData.education.length > 0) {
    const eduList = profileData.education
      .map((e) => `${e.degree}${e.field ? ` in ${e.field}` : ""} at ${e.institution}`)
      .join("\n");
    profileInfo.push(`**Education:**\n${eduList}`);
  }

  let jobContext = `## Job Details
- **Position:** ${jobTitle}
- **Company:** ${companyName}`;

  if (jobUrl) {
    jobContext += `\n- **Job URL:** ${jobUrl}`;
  }
  if (jobExternalId) {
    jobContext += `\n- **Platform Job ID:** ${jobExternalId}`;
  }
  jobContext += `\n- **Job Description:** ${jobDescription.slice(0, 2000)}${jobDescription.length > 2000 ? "..." : ""}`;

  return `
${jobContext}

## Candidate Profile
${profileInfo.length > 0 ? profileInfo.join("\n\n") : "No profile information available."}

## Settings
- **Tone:** ${settings.tone}
- **Length:** ${lengthGuidance[settings.length as keyof typeof lengthGuidance] || lengthGuidance.medium}
- **Focus:** ${focusText}

Please write a professional cover letter for this job application. The letter should be ready to submit. NEVER use any placeholders like [Your Name] or [Date] - use actual values or omit if not available.
`;
}
