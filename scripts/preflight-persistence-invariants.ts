import { db } from "@/lib/db";
import { runPersistencePreflight } from "@/lib/db/persistence-preflight";

const report = runPersistencePreflight(db);
console.log("Persistence preflight passed", report);
