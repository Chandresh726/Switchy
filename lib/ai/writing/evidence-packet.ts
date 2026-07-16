import {
  artifactRepository,
  buildCandidateEvidence,
  buildJobEvidenceInput,
  buildJobFingerprint,
  type CandidateEvidence,
  type JobAnalysisEvidence,
} from "@/lib/ai/artifacts";
import { enrichCandidateEvidence } from "@/lib/ai/matcher/evidence/candidate";
import { getMatcherConfig } from "@/lib/ai/matcher/config";
import {
  analyzeJobsForMatching,
  buildJobAnalysisVersion,
} from "@/lib/ai/matcher/evidence/job-analysis";
import { getMatchPresentationsForJobIds, type MatchPresentation } from "@/lib/ai/matcher/presentation";
import { fetchJobsData, fetchProfileData } from "@/lib/ai/matcher/tracking";
import { fetchCandidateProfileSnapshot } from "@/lib/ai/profile/profile-snapshot";

import { fetchJobWithCompany } from "./utils";

const MAX_EVIDENCE_TEXT_CHARS = 2_000;
const MAX_EVIDENCE_ITEMS = 20;
const CANDIDATE_SNAPSHOT_VERSION = "candidate-facts-v2";

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
  };
}

function compactJobAnalysis(evidence: JobAnalysisEvidence) {
  return {
    summary: bounded(evidence.summary, 1_000),
    requirements: evidence.requirements.slice(0, 20),
  };
}

function compactMatch(match: MatchPresentation) {
  if (!match.matchResultId || match.matchStale) return null;
  return {
    score: match.matchScore,
    breakdown: match.matchBreakdown,
    reasons: match.matchReasons.slice(0, 10).map((value) => bounded(value, 500)),
    matchedSkills: match.matchedSkills.slice(0, MAX_EVIDENCE_ITEMS),
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
  const [
    jobWithCompany,
    profileData,
    profileSnapshot,
    jobsMap,
    matchMap,
    matcherConfig,
  ] = await Promise.all([
    fetchJobWithCompany(jobId),
    fetchProfileData(),
    fetchCandidateProfileSnapshot(),
    fetchJobsData([jobId]),
    getMatchPresentationsForJobIds([jobId]),
    getMatcherConfig(),
  ]);
  const job = jobsMap.get(jobId);
  if (!jobWithCompany || !job) throw new Error("Job not found");
  if (!profileData || !profileSnapshot) {
    throw new Error("Profile not found. Please set up your profile first.");
  }

  const candidateEvidence = enrichCandidateEvidence(buildCandidateEvidence(profileData));
  const candidateArtifact = await artifactRepository.getOrCreateCandidateSnapshot({
    sourceProfileId: profileData.profile.id,
    snapshotVersion: CANDIDATE_SNAPSHOT_VERSION,
    evidence: candidateEvidence,
  });
  const jobEvidence = buildJobEvidenceInput(job);
  const jobFingerprint = buildJobFingerprint(jobEvidence);
  const cachedAnalysis = await artifactRepository.findJobAnalysis(
    jobFingerprint,
    buildJobAnalysisVersion(matcherConfig)
  );
  let jobAnalysis: JobAnalysisEvidence | undefined = cachedAnalysis?.evidence;
  if (!jobAnalysis) {
    const analyzed = await analyzeJobsForMatching([job], matcherConfig);
    jobAnalysis = analyzed.get(jobId)?.analysis;
  }
  if (!jobAnalysis) {
    throw new Error(
      "AI job analysis is required before generating grounded writing. Check the Job Analysis provider and try again."
    );
  }
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
