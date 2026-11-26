export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly url: string,
    public readonly responseHeaders?: Headers
  ) {
    super(message);
    this.name = "HttpError";
  }

  get retryAfterMs(): number | undefined {
    const value = this.responseHeaders?.get("retry-after");
    if (!value) return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
  }

  get isBrowserChallenge(): boolean {
    return this.responseHeaders?.get("cf-mitigated") === "challenge";
  }

  get isRateLimited(): boolean {
    return this.status === 429 && !this.isBrowserChallenge;
  }

  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }
}
