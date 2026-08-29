export function formatCompanyUrl(url: string, maxLength: number = 30): string {
  try {
    const parsed = new URL(url);
    const display = parsed.hostname + parsed.pathname;
    if (display.length > maxLength) {
      return `${display.substring(0, maxLength - 3)}...`;
    }
    return display;
  } catch {
    return url.length > maxLength
      ? `${url.substring(0, maxLength - 3)}...`
      : url;
  }
}
