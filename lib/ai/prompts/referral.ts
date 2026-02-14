export interface ReferralSettings {
  tone: string;
  length: string;
}

export const REFERRAL_SYSTEM_PROMPT = `You are an expert at writing professional referral request messages. Your task is to help candidates craft compelling messages to request referrals from their network.

Guidelines:
- Keep the message concise and impactful
- Use a {tone} tone (professional/casual/friendly/flexible)
- Focus on the value the person can provide
- Be specific about the role and company
- Include a clear call to action
- Always be respectful of the recipient's time

CRITICAL RULES:
1. NEVER use placeholders like [Your Name], [Connection's Name], or any bracketed text. Always use actual values provided in the context. If a name is not available, use a professional generic salutation.
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
- short: ~50 words
- medium: ~100 words  
- long: ~200 words

The message should NOT include a subject line - just the body of the email/message.`;

export function buildReferralPromptFromProfileData(
  jobTitle: string,
  companyName: string,
  profileData: {
    name?: string;
    summary: string | null;
    skills: Array<{ name: string; proficiency: number; category: string | null }>;
    experience: Array<{ title: string; company: string; description: string | null }>;
    education: Array<{ degree: string; institution: string; field: string | null }>;
  },
  settings: ReferralSettings,
  jobUrl?: string | null,
  jobExternalId?: string | null
): string {
  const lengthGuidance = {
    short: "Keep it very brief, around 50 words.",
    medium: "Provide a moderate length, around 100 words.",
    long: "Provide more detail, around 200 words.",
  };

  const profileInfo: string[] = [];
  
  if (profileData.name) {
    profileInfo.push(`**Name:** ${profileData.name}`);
  }
  
  if (profileData.summary) {
    profileInfo.push(`**Summary:** ${profileData.summary}`);
  }
  
  if (profileData.skills.length > 0) {
    const skillList = profileData.skills
      .slice(0, 10)
      .map((s) => s.name)
      .join(", ");
    profileInfo.push(`**Key Skills:** ${skillList}`);
  }
  
  if (profileData.experience.length > 0) {
    const expList = profileData.experience
      .slice(0, 3)
      .map((e) => `${e.title} at ${e.company}`)
      .join("; ");
    profileInfo.push(`**Experience:** ${expList}`);
  }

  if (profileData.education.length > 0) {
    const eduList = profileData.education
      .slice(0, 2)
      .map((e) => `${e.degree}${e.field ? ` in ${e.field}` : ""} at ${e.institution}`)
      .join("; ");
    profileInfo.push(`**Education:** ${eduList}`);
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

  return `
${jobContext}

## Candidate Profile
${profileInfo.length > 0 ? profileInfo.join("\n") : "No profile information available."}

## Settings
- **Tone:** ${settings.tone}
- **Length:** ${lengthGuidance[settings.length as keyof typeof lengthGuidance] || lengthGuidance.medium}

Please write a referral request message that the candidate can send to their connection at ${companyName}. The message should be ready to copy and paste. NEVER use any placeholders like [Your Name] - use actual values or omit if not available.
`;
}
