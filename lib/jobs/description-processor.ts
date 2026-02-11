import sanitizeHtml from "sanitize-html";
import TurndownService from "turndown";

const turndownService = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

// Configure turndown to handle common HTML elements better
turndownService.addRule("lineBreaks", {
  filter: ["br"],
  replacement: () => "\n",
});

turndownService.addRule("paragraphs", {
  filter: "p",
  replacement: (content) => `\n\n${content}\n\n`,
});

/**
 * Decode HTML entities like &lt; &gt; &amp; to their actual characters
 */
export function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&"); // Handle double-encoded ampersands
}

/**
 * Sanitizes HTML content to remove potentially harmful tags and attributes
 */
export function sanitizeHtmlContent(html: string): string {
  // First decode any HTML entities
  const decoded = decodeHtmlEntities(html);

  return sanitizeHtml(decoded, {
    allowedTags: [
      "p",
      "br",
      "ul",
      "ol",
      "li",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "a",
      "code",
      "pre",
      "blockquote",
    ],
    allowedAttributes: {
      a: ["href"],
    },
    allowedSchemes: ["http", "https", "mailto"],
  });
}

/**
 * Converts sanitized HTML to Markdown
 */
export function htmlToMarkdown(html: string): string {
  const sanitized = sanitizeHtmlContent(html);
  return turndownService.turndown(sanitized);
}

/**
 * Process a job description from various source formats to a standardized format
 */
export function processDescription(
  content: string | null | undefined,
  sourceFormat: "html" | "plain"
): { text: string | null; format: "markdown" | "plain" } {
  if (!content || content.trim().length === 0) {
    return { text: null, format: "plain" };
  }

  // If sourceFormat is "html", convert to markdown
  if (sourceFormat === "html") {
    const markdown = htmlToMarkdown(content);
    return { text: markdown, format: "markdown" };
  }

  // For plain text, check if it contains markdown syntax
  // If it has markdown patterns, treat as markdown, otherwise plain
  const hasMarkdownPatterns = /^#{1,6}\s+/m.test(content) || // Headers
    /\*\*.*?\*\*/.test(content) || // Bold
    /\*.*?\*/.test(content) || // Italic
    /\[.*?\]\(.*?\)/.test(content) || // Links
    /^[-*+]\s+/m.test(content) || // Lists
    /^\d+\.\s+/m.test(content); // Numbered lists

  return { 
    text: content, 
    format: hasMarkdownPatterns ? "markdown" : "plain" 
  };
}

/**
 * Check if a string contains HTML tags
 */
export function containsHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text);
}
