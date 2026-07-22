import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { people, personSourceRecords } from "@/lib/db/schema";
import type { PersonSource } from "@/lib/people/types";

interface SourceIdentityInput {
  source: PersonSource;
  sourceRecordKey: string;
  profileUrlNormalized?: string | null;
  email?: string | null;
}

export function normalizePersonEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

export function getStableSourceIdentity(input: SourceIdentityInput): {
  stableIdentityKey: string | null;
  identityKind: "linkedin_url" | "email" | "composite" | "manual" | null;
} {
  if (input.profileUrlNormalized) {
    return {
      stableIdentityKey: `linkedin:${input.profileUrlNormalized}`,
      identityKind: "linkedin_url",
    };
  }

  const email = normalizePersonEmail(input.email);
  if (email) {
    return { stableIdentityKey: `email:${email}`, identityKind: "email" };
  }

  if (input.source === "manual") {
    return { stableIdentityKey: `manual:${input.sourceRecordKey}`, identityKind: "manual" };
  }

  const composite = input.sourceRecordKey.replace(/\|row:\d+$/, "");
  if (input.source === "linkedin" && composite.includes("|")) {
    return { stableIdentityKey: `composite:${composite}`, identityKind: "composite" };
  }

  return { stableIdentityKey: null, identityKind: null };
}

export function backfillPersonSourceRecords(database: typeof db = db): { inserted: number } {
  const missingPeople = database
    .select({ person: people })
    .from(people)
    .leftJoin(personSourceRecords, eq(personSourceRecords.personId, people.id))
    .where(sql`${personSourceRecords.id} IS NULL`)
    .all();

  if (missingPeople.length === 0) return { inserted: 0 };

  const inserted = database.transaction((tx) => {
    let count = 0;
    for (const { person } of missingPeople) {
      const source = person.source as PersonSource;
      const sourceRecordKey = person.sourceRecordKey
        || (person.identityKey.startsWith(`${source}:`)
          ? person.identityKey.slice(source.length + 1)
          : person.identityKey);
      const identity = getStableSourceIdentity({
        source,
        sourceRecordKey,
        profileUrlNormalized: person.profileUrlNormalized,
        email: person.email,
      });
      const result = tx.insert(personSourceRecords).values({
        personId: person.id,
        source,
        sourceRecordKey,
        ...identity,
        firstName: person.firstName,
        lastName: person.lastName,
        fullName: person.fullName,
        profileUrl: person.profileUrl,
        profileUrlNormalized: person.profileUrlNormalized || null,
        email: person.email,
        emailNormalized: normalizePersonEmail(person.email),
        companyRaw: person.companyRaw,
        companyNormalized: person.companyNormalized,
        position: person.position,
        connectedOn: person.connectedOn,
        sourceNotes: person.notes,
        isActive: person.isActive,
        firstSeenAt: person.createdAt || person.lastSeenAt,
        lastSeenAt: person.lastSeenAt,
        createdAt: person.createdAt,
        updatedAt: person.updatedAt,
      }).onConflictDoNothing().run();
      count += result.changes;
    }
    return count;
  }, { behavior: "immediate" });

  return { inserted };
}
