export async function copyTextToClipboard(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}
