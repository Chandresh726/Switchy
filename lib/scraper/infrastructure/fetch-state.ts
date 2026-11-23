export interface ScrapeFetchStateStore {
  get(key: string): unknown;
  set(key: string, value: unknown, expiresAt: Date): void;
  delete(key: string): void;
}
