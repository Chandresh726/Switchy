import { backfillPersonSourceRecords } from "@/lib/people/source-records";

const result = backfillPersonSourceRecords();
if (result.inserted > 0) {
  console.log(`[People] Backfilled ${result.inserted} person source record(s).`);
}
