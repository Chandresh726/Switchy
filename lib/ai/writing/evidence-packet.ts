import {
  artifactRepository,
  buildCandidateEvidence,
  buildJobEvidenceInput,
  buildJobFingerprint,
  type CandidateEvidence,
  type JobAnalysisEvidence,
} from "@/lib/ai/artifacts";
import { enrichCandidateEvidence } from "@/lib/ai/matcher/evidence/candidate";
import {
  buildDeterministicJobAnalysis,
  JOB_ANALYSIS_EXTRACTOR_VERSION,
} from "@/lib/ai/matcher/evidence/job-analysis";
import { getMatchPresentationsForJobIds, type MatchPresentation } from "@/lib/ai/matcher/presentation";
import { fetchJobsData, fetchMatchingPreferences, fetchProfileData } from "@/lib/ai/matcher/tracking";
import { fetchCandidateProfileSnapshot } from "@/lib/ai/profile/profile-snapshot";

import { fetchJobWithCompany } from "./utils";

const MAX_EVIDENCE_TEXT_CHARS = 2_000;
const MAX_EVIDENCE_ITEMS = 20;
const CANDIDATE_SNAPSHOT_VERSION = "candidate-evidence-v1";

function bounded(value: string | null | undefined, maxChars = MAX_EVIDENCE_TEXT_CHARS) {
  return value ? value.slice(0, maxChars) : null;
}

function allowedUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function compactCandidate(evidence: CandidateEvidence) {
  return {
    summary: bounded(evidence.summary),
    skills: evidence.skills.slice(0, MAX_EVIDENCE_ITEMS),
    experience: evidence.experience.slice(0, 8).map((item) => ({
      title: item.title,
      company: item.company,
      startDate: item.startDate,
      endDate: item.endDate,
      description: bounded(item.description, 800),
      highlights: item.highlights.slice(0, 8).map((value) => bounded(value, 500)),
    })),
    education: evidence.education.slice(0, 5),
    totalExperienceYears: evidence.totalExperienceYears,
    seniorityLevel: evidence.seniorityLevel,
    managementExperience: evidence.managementExperience,
    domainKeywords: evidence.domainKeywords.slice(0, MAX_EVIDENCE_ITEMS),
  };
}

function compactJobAnalysis(evidence: JobAnalysisEvidence) {
  return {
    mustHaveSkills: evidence.mustHaveSkills.slice(0, MAX_EVIDENCE_ITEMS),
    preferredSkills: evidence.preferredSkills.slice(0, MAX_EVIDENCE_ITEMS),
    minimumExperienceYears: evidence.minimumExperienceYears,
    seniorityLevel: evidence.seniorityLevel,
    managementTrack: evidence.managementTrack,
    educationRequirements: evidence.educationRequirements.slice(0, 10),
    locationConstraints: evidence.locationConstraints.slice(0, 10),
    employmentType: evidence.employmentType,
    domainKeywords: evidence.domainKeywords.slice(0, MAX_EVIDENCE_ITEMS),
    extractionConfidence: evidence.extractionConfidence,
    ambiguities: evidence.ambiguities.slice(0, 10),
  };
}

function compactMatch(match: MatchPresentation) {
  if (!match.matchResultId || match.matchStale) return null;
  return {
    score: match.matchScore,
    confidence: match.matchConfidence,
    breakdown: match.matchBreakdown,
    reasons: match.matchReasons.slice(0, 10).map((value) => bounded(value, 500)),
    matchedSkills: match.matchedSkills.slice(0, MAX_EVIDENCE_ITEMS),
    missingSkills: match.missingSkills.slice(0, MAX_EVIDENCE_ITEMS),
    recommendations: match.recommendations.slice(0, 10).map((value) => bounded(value, 500)),
  };
}

export interface WritingEvidencePacket {
  profileName: string;
  allowedLinks: string[];
  candidateFingerprint: string;
  jobFingerprint: string;
  evidenceText: string;
}

export async function buildWritingEvidencePacket(jobId: number): Promise<WritingEvidencePacket> {
  const [jobWithCompany, profileData, profileSnapshot, preferences, jobsMap, matchMap] = await Promise.all([
    fetchJobWithCompany(jobId),
    fetchProfileData(),
    fetchCandidateProfileSnapshot(),
    fetchMatchingPreferences(),
    fetchJobsData([jobId]),
    getMatchPresentationsForJobIds([jobId]),
  ]);
  const job = jobsMap.get(jobId);
  if (!jobWithCompany || !job) throw new Error("Job not found");
  if (!profileData || !profileSnapshot) {
    throw new Error("Profile not found. Please set up your profile first.");
  }

  const candidateEvidence = enrichCandidateEvidence(buildCandidateEvidence({
    ...profileData,
    preferences,
  }));
  const candidateArtifact = await artifactRepository.getOrCreateCandidateSnapshot({
    sourceProfileId: profileData.profile.id,
    snapshotVersion: CANDIDATE_SNAPSHOT_VERSION,
    evidence: candidateEvidence,
  });
  const jobEvidence = buildJobEvidenceInput(job);
  const jobFingerprint = buildJobFingerprint(jobEvidence);
  const cachedAnalysis = await artifactRepository.findJobAnalysis(
    jobFingerprint,
    JOB_ANALYSIS_EXTRACTOR_VERSION
  );
  const jobAnalysis = cachedAnalysis?.evidence ?? buildDeterministicJobAnalysis(job);
  const match = matchMap.get(jobId);
  const links = [
    allowedUrl(jobWithCompany.url),
    allowedUrl(profileSnapshot.profile.linkedinUrl),
    allowedUrl(profileSnapshot.profile.githubUrl),
    allowedUrl(profileSnapshot.profile.portfolioUrl),
  ].filter((value): value is string => value !== null);

  const evidenceText = JSON.stringify({
    job: {
      title: jobWithCompany.title,
      company: jobWithCompany.companyName,
      location: job.location,
      locationType: job.locationType,
      employmentType: job.employmentType,
    },
    candidate: compactCandidate(candidateArtifact.evidence),
    jobAnalysis: compactJobAnalysis(jobAnalysis),
    match: match ? compactMatch(match) : null,
    allowedLinks: Array.from(new Set(links)),
  });

  return {
    profileName: profileSnapshot.profile.name,
    allowedLinks: Array.from(new Set(links)),
    candidateFingerprint: candidateArtifact.fingerprint,
    jobFingerprint,
    evidenceText,
  };
}
