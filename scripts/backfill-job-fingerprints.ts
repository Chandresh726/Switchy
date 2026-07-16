import { ensureJobFingerprintProjection } from "@/lib/ai/artifacts/job-fingerprint-projection";

const result = ensureJobFingerprintProjection();
if (result.updated > 0 || result.skipped > 0) {
  console.log(
    `[AI artifacts] Job fingerprints updated: ${result.updated}; skipped: ${result.skipped}`
  );
}
