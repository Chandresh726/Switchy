import { artifactRepository } from "@/lib/ai/artifacts";

async function main(): Promise<void> {
  const imported = await artifactRepository.importLegacyMatchResults();
  if (imported > 0) {
    console.log(`[AI artifacts] Preserved ${imported} legacy match result(s) as stale history.`);
  }
}

main().catch((error: unknown) => {
  console.error("[AI artifacts] Failed to preserve legacy match results.", error);
  process.exitCode = 1;
});
