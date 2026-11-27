import { z } from "zod";

import type { ScrapeFetchStateStore } from "@/lib/scraper/infrastructure/fetch-state";

const MAX_AGE_MS = 30 * 60_000;
const metadataSchema = z.object({
  createdAt: z.number(), total: z.number().int().nonnegative(),
  firstIds: z.array(z.string()), offsets: z.array(z.number().int().positive()),
});

/** Public listing pages only. Cookie/session state never belongs in checkpoints. */
export class ListingCheckpoint<T> {
  readonly pages = new Map<number, T[]>();
  readonly resumed: boolean;
  private readonly createdAt: number;
  private readonly expiresAt: Date;
  private readonly firstIds: string[];

  constructor(
    private readonly state: ScrapeFetchStateStore | undefined,
    private readonly key: string,
    private readonly total: number,
    first: T[],
    schema: z.ZodType<T>,
    private readonly getId: (item: T) => string,
    private readonly pageSize: number
  ) {
    const now = Date.now();
    this.firstIds = first.map(getId);
    let createdAt = now;
    try {
      const saved = metadataSchema.safeParse(state?.get(key));
      if (saved.success && saved.data.total === total && now >= saved.data.createdAt &&
          now - saved.data.createdAt < MAX_AGE_MS &&
          JSON.stringify(saved.data.firstIds) === JSON.stringify(this.firstIds)) {
        createdAt = saved.data.createdAt;
        const pageSchema = z.object({ createdAt: z.literal(createdAt), items: z.array(schema) });
        for (const offset of new Set(saved.data.offsets)) {
          if (offset % pageSize !== 0 || offset >= total) continue;
          const page = pageSchema.safeParse(state?.get(`${key}:${offset}`));
          if (page.success && this.exactPage(offset, page.data.items)) this.pages.set(offset, page.data.items);
        }
      }
    } catch { /* An unavailable checkpoint causes extra fetching, never false completeness. */ }
    this.createdAt = createdAt;
    this.expiresAt = new Date(createdAt + MAX_AGE_MS);
    this.resumed = this.pages.size > 0;
    this.pages.set(0, first);
  }

  private exactPage(offset: number, items: T[]): boolean {
    return items.length === Math.min(this.pageSize, this.total - offset) &&
      new Set(items.map(this.getId)).size === items.length;
  }

  save(offset: number, items: T[]): void {
    if (offset === 0 || !this.exactPage(offset, items)) return;
    this.pages.set(offset, items);
    if (!this.state) return;
    try {
      // Separate page records keep writes proportional to fetched data.
      this.state.set(`${this.key}:${offset}`, { createdAt: this.createdAt, items }, this.expiresAt);
      this.state.set(this.key, { createdAt: this.createdAt, total: this.total,
        firstIds: this.firstIds, offsets: [...this.pages.keys()].filter((value) => value > 0) }, this.expiresAt);
    } catch (error) { console.warn("Could not save listing checkpoint", error); }
  }

  clear(): void {
    try {
      this.state?.delete(this.key);
      for (const offset of this.pages.keys()) if (offset > 0) this.state?.delete(`${this.key}:${offset}`);
    } catch (error) { console.warn("Could not clear listing checkpoint", error); }
  }
}
