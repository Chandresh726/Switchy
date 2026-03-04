import TurndownService from "turndown";
import sanitizeHtml from "sanitize-html";

const ALLOWED_HTML_TAGS = ["p", "br", "strong", "b", "em", "a"];
const ALLOWED_HTML_ATTRIBUTES: sanitizeHtml.IOptions["allowedAttributes"] = {
  a: ["href", "target", "rel"],
};

const turndownService = new TurndownService({
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "_",
  headingStyle: "atx",
  hr: "---",
});

turndownService.remove(["script", "style"]);

turndownService.addRule("lineBreak", {
  filter: "br",
  replacement: () => "  \n",
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function renderInlineMarkdown(markdownText: string): string {
  const escaped = escapeHtml(markdownText);

  const withLinks = escaped.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, label, url) =>
      `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );

  const withBold = withLinks.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  return withBold.replace(/\n/g, "<br>");
}

function normalizeParagraphs(value: string): string[] {
  return value
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function markdownToRichHtml(markdown: string): string {
  const normalized = markdown.trim();
  if (!normalized) {
    return "<p><br></p>";
  }

  const paragraphs = normalizeParagraphs(normalized);
  if (paragraphs.length === 0) {
    return "<p><br></p>";
  }

  const html = paragraphs
    .map((paragraph) => `<p>${renderInlineMarkdown(paragraph)}</p>`)
    .join("");

  return sanitizeRichHtml(html);
}

export function sanitizeRichHtml(value: string): string {
  return sanitizeHtml(value, {
    allowedAttributes: ALLOWED_HTML_ATTRIBUTES,
    allowedSchemes: ["http", "https", "mailto"],
    allowedTags: ALLOWED_HTML_TAGS,
    disallowedTagsMode: "discard",
  });
}

export function richHtmlToMarkdown(html: string): string {
  const sanitized = sanitizeRichHtml(html);
  const markdown = turndownService.turndown(sanitized);
  return markdown
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function canonicalizeMarkdown(markdown: string): string {
  return richHtmlToMarkdown(markdownToRichHtml(markdown));
}

export function markdownToPlainText(markdown: string): string {
  const html = markdownToRichHtml(markdown);
  if (typeof window === "undefined") {
    return markdown
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .trim();
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return (doc.body.textContent || "").trim();
}

export async function copyMarkdownToClipboard(markdown: string): Promise<void> {
  const html = markdownToRichHtml(markdown);
  const plainText = markdownToPlainText(markdown);

  if (typeof window !== "undefined" && "ClipboardItem" in window) {
    const item = new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plainText], { type: "text/plain" }),
    });
    await navigator.clipboard.write([item]);
    return;
  }

  await navigator.clipboard.writeText(plainText);
}

export function markdownSupportsRichFormatting(markdown: string): boolean {
  return /\*\*[^*]+\*\*/.test(markdown) || /\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/.test(markdown);
}

export function toMarkdownLink(label: string, url?: string | null): string | null {
  if (!url) return null;
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return null;
  return `[${label}](${normalizedUrl})`;
}
