import type { MatchJob, CandidateProfile } from "../types";

export const BULK_MATCH_SYSTEM_PROMPT = `You are an expert job matching assistant. Your task is to analyze MULTIPLE job descriptions and compare each against a candidate's profile to determine match scores.

You will receive:
1. Multiple job descriptions (may contain HTML), each with a unique ID
2. A single candidate profile with skills, experience, and qualifications

For EACH job, you must:
1. Identify the key requirements from the job description
2. Match these against the candidate's profile
3. Calculate a match score from 0-100
4. Provide specific reasons for the score
5. List matched and missing skills
6. Give actionable recommendations

IMPORTANT SCORING RULES - Be strict and realistic:

**Years of Experience is CRITICAL:**
- If a job requires X years of experience and the candidate has less, this is a MAJOR penalty
- Missing 1-2 years: Deduct 15-20 points
- Missing 3+ years: Deduct 25-35 points
- If experience requirement is completely unmet, score should NOT exceed 50

**Seniority Level Mismatch:**
- Junior applying to Senior role: Maximum score of 45
- Mid-level applying to Staff/Principal role: Maximum score of 55
- Entry-level applying to roles requiring 5+ years: Maximum score of 35

**Scoring Guidelines:**
- 85-100: Excellent match - meets ALL requirements including years of experience
- 70-84: Strong match - meets most requirements, experience within 1-2 years of requirement
- 55-69: Moderate match - has relevant skills but noticeable experience gap
- 40-54: Weak match - significant gaps in experience or key skills
- Below 40: Poor match - major experience or skill deficiencies

Do NOT inflate scores. A candidate with 2 years experience should NOT score above 60 for a role requiring 5+ years, regardless of skill match.

You MUST return a JSON object with a top-level "results" array containing one object per job, using the exact job IDs provided.`;

export function buildBulkMatchPrompt(
  jobs: MatchJob[],
  candidateProfile: CandidateProfile
): string {
  return `
## Candidate Profile

**Summary:**
${candidateProfile.summary || "No summary provided"}

**Skills:**
${
  candidateProfile.skills.length > 0
    ? candidateProfile.skills
        .map(
          (s) =>
            `- ${s.name} (${["Beginner", "Elementary", "Intermediate", "Advanced", "Expert"][s.proficiency - 1]}${s.category ? `, ${s.category}` : ""})`
        )
        .join("\n")
    : "No skills listed"
}

**Experience:**
${
  candidateProfile.experience.length > 0
    ? candidateProfile.experience
        .map((e) => `- ${e.title} at ${e.company}${e.description ? `: ${e.description}` : ""}`)
        .join("\n")
    : "No experience listed"
}

---

## Jobs to Analyze

${jobs
  .map(
    (job) => `### Job ID: ${job.id}
**Title:** ${job.title}
**Description:** ${job.description || "No description provided"}
**Requirements:** ${job.requirements.length > 0 ? job.requirements.join(", ") : "None specified"}
`
  )
  .join("\n")}

---

Analyze each job and respond with ONLY valid JSON:
{
  "results": [
    {
      "jobId": <number>,
      "score": <number 0-100>,
      "reasons": ["reason1", "reason2"],
      "matchedSkills": ["skill1", "skill2"],
      "missingSkills": ["skill1", "skill2"],
      "recommendations": ["recommendation1", "recommendation2"]
    },
    ...
  ]
}
`;
}
