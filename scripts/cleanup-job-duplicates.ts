import Database from "better-sqlite3";

import { getDbPath } from "../lib/state/paths";

interface DuplicateGroup {
  company_id: number;
  external_id?: string | null;
  url?: string | null;
  count: number;
}

function removeDuplicatesByExternalId(db: Database.Database): number {
  const groups = db
    .prepare(
      `
      SELECT company_id, external_id, COUNT(*) as count
      FROM jobs
      WHERE external_id IS NOT NULL
      GROUP BY company_id, external_id
      HAVING COUNT(*) > 1
      `
    )
    .all() as DuplicateGroup[];

  const selectIds = db.prepare(
    `
    SELECT id
    FROM jobs
    WHERE company_id = ? AND external_id = ?
    ORDER BY COALESCE(updated_at, discovered_at) DESC, id DESC
    `
  );

  const deleteById = db.prepare(`DELETE FROM jobs WHERE id = ?`);

  let deleted = 0;

  for (const group of groups) {
    const rows = selectIds.all(group.company_id, group.external_id) as Array<{ id: number }>;
    const idsToDelete = rows.slice(1).map((row) => row.id);

    for (const id of idsToDelete) {
      deleteById.run(id);
      deleted++;
    }
  }

  return deleted;
}

function removeDuplicatesByUrl(db: Database.Database): number {
  const groups = db
    .prepare(
      `
      SELECT company_id, url, COUNT(*) as count
      FROM jobs
      GROUP BY company_id, url
      HAVING COUNT(*) > 1
      `
    )
    .all() as DuplicateGroup[];

  const selectIds = db.prepare(
    `
    SELECT id
    FROM jobs
    WHERE company_id = ? AND url = ?
    ORDER BY COALESCE(updated_at, discovered_at) DESC, id DESC
    `
  );

  const deleteById = db.prepare(`DELETE FROM jobs WHERE id = ?`);

  let deleted = 0;

  for (const group of groups) {
    const rows = selectIds.all(group.company_id, group.url) as Array<{ id: number }>;
    const idsToDelete = rows.slice(1).map((row) => row.id);

    for (const id of idsToDelete) {
      deleteById.run(id);
      deleted++;
    }
  }

  return deleted;
}

function main(): void {
  const dbPath = getDbPath();
  const sqlite = new Database(dbPath);

  try {
    const tx = sqlite.transaction(() => {
      const deletedByExternalId = removeDuplicatesByExternalId(sqlite);
      const deletedByUrl = removeDuplicatesByUrl(sqlite);
      return { deletedByExternalId, deletedByUrl };
    });

    const { deletedByExternalId, deletedByUrl } = tx();
    const totalDeleted = deletedByExternalId + deletedByUrl;

    console.log(
      `[Cleanup] Removed ${totalDeleted} duplicate jobs (${deletedByExternalId} by externalId, ${deletedByUrl} by URL)`
    );
  } finally {
    sqlite.close();
  }
}

main();
