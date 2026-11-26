export interface ScrapeFetchStateStore {
  get(key: string): unknown;
  set(key: string, value: unknown, expiresAt: Date): void;
  delete(key: string): void;
  mutate?<T>(key: string, expiresAt: Date, update: (previous: unknown) => T): T;
}
