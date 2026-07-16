import { removeObsoleteMatchData } from "@/lib/ai/artifacts/obsolete-match-data";

const result = removeObsoleteMatchData();
if (
  result.deletedMatchResults > 0 ||
  result.deletedMatchHistorySessions > 0 ||
  result.deletedMatchHistoryLogs > 0 ||
  result.clearedLegacyJobs > 0
) {
  console.log(
    `[AI artifacts] Removed ${result.deletedMatchResults} obsolete match result(s); ` +
    `${result.deletedMatchHistorySessions} obsolete match session(s); ` +
    `${result.deletedMatchHistoryLogs} obsolete match log(s); ` +
    `cleared legacy match data from ${result.clearedLegacyJobs} job(s).`
  );
}
