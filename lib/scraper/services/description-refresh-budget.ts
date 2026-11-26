import { z } from "zod";

import type { ScrapeFetchStateStore } from "@/lib/scraper/infrastructure/fetch-state";

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_SESSION_DETAIL_REFRESH_LIMIT = 25;
const DEFAULT_COMPANY_DETAIL_REFRESH_COOLDOWN_MS = 6 * HOUR_MS;
const LEDGER_KEY = "description-refresh-ledger";
const ledgerSchema = z.object({
  sessions: z.record(z.string(), z.object({ used: z.number().int().nonnegative(), at: z.number() })),
  companies: z.record(z.string(), z.object({
    requested: z.number().int().nonnegative(), at: z.number(), lastServedAt: z.number().nullable(),
  })),
});
type RefreshLedger = z.infer<typeof ledgerSchema>;

/** Optional maintenance shares a durable, fair budget; discovery never uses it. */
export class DescriptionRefreshBudget {
  private memory: RefreshLedger = { sessions: {}, companies: {} };

  constructor(private readonly state?: ScrapeFetchStateStore) {}

  reserve(
    sessionId: string,
    companyId: number,
    requested: number,
    now: Date,
    sessionLimit = DEFAULT_SESSION_DETAIL_REFRESH_LIMIT,
    cooldownMs = DEFAULT_COMPANY_DETAIL_REFRESH_COOLDOWN_MS
  ): number {
    const limit = Number.isFinite(sessionLimit) ? Math.max(0, Math.floor(sessionLimit)) : DEFAULT_SESSION_DETAIL_REFRESH_LIMIT;
    if (limit === 0 || !Number.isFinite(requested)) return 0;
    requested = Math.max(0, Math.floor(requested));
    const cooldown = Number.isFinite(cooldownMs) ? Math.max(0, cooldownMs) : DEFAULT_COMPANY_DETAIL_REFRESH_COOLDOWN_MS;
    const timestamp = now.getTime();
    const expiresAt = new Date(timestamp + 7 * 24 * HOUR_MS);
    const readLedger = (value: unknown): RefreshLedger => ledgerSchema.safeParse(value).data ?? { sessions: {}, companies: {} };
    try {
      const previous = this.state ? this.state.get(LEDGER_KEY) : this.memory;
      const saved = readLedger(previous);
      if (requested === 0 && !saved.companies[companyId]?.requested) return 0;
      let accepted = 0;
      const reserve = (value: unknown): RefreshLedger => {
        const ledger = readLedger(value);
        for (const [id, entry] of Object.entries(ledger.sessions)) {
          if (timestamp - entry.at >= 24 * HOUR_MS) delete ledger.sessions[id];
        }
        for (const [id, entry] of Object.entries(ledger.companies)) {
          if (timestamp - entry.at >= 7 * 24 * HOUR_MS) delete ledger.companies[id];
        }
        const company = ledger.companies[companyId] ?? { requested: 0, at: timestamp, lastServedAt: null };
        ledger.companies[companyId] = company;
        company.requested = requested;
        company.at = timestamp;
        if (requested === 0 || (company.lastServedAt !== null && timestamp - company.lastServedAt < cooldown)) return ledger;
        const session = ledger.sessions[sessionId] ?? { used: 0, at: timestamp };
        ledger.sessions[sessionId] = session;
        const remaining = Math.max(0, limit - session.used);
        // Retain capacity for older unmet demand even when its company appears
        // later in the static queue. Otherwise the first few companies monopolize
        // every session. Unobserved demand expires after a day.
        let reservedForOlder = 0;
        for (const [id, other] of Object.entries(ledger.companies)) {
          if (Number(id) === companyId || timestamp - other.at >= 24 * HOUR_MS || other.requested === 0 ||
              (other.lastServedAt !== null && timestamp - other.lastServedAt < cooldown)) continue;
          const otherRank = other.lastServedAt ?? Number.NEGATIVE_INFINITY;
          const ownRank = company.lastServedAt ?? Number.NEGATIVE_INFINITY;
          if (otherRank < ownRank || (otherRank === ownRank && Number(id) < companyId)) reservedForOlder += other.requested;
        }
        accepted = Math.max(0, Math.min(requested, remaining - reservedForOlder));
        session.used += accepted;
        if (accepted > 0) {
          company.lastServedAt = timestamp;
          company.requested -= accepted;
        }
        return ledger;
      };
      if (this.state?.mutate) this.state.mutate(LEDGER_KEY, expiresAt, reserve);
      else {
        const next = reserve(previous);
        if (this.state) this.state.set(LEDGER_KEY, next, expiresAt);
        else this.memory = next;
      }
      return accepted;
    } catch (error) {
      console.warn("Could not reserve description refresh capacity; skipping optional maintenance:", error);
      return 0;
    }
  }
}
