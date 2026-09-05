export type ResumeFileFormat = "pdf" | "docx" | "text";

export async function extractResumeText(file: File): Promise<{
  text: string;
  format: ResumeFileFormat;
}> {
  const fileName = file.name.toLowerCase();
  if (fileName.endsWith(".pdf")) {
    const { extractText } = await import("unpdf");
    const result = await extractText(await file.arrayBuffer());
    return {
      text: Array.isArray(result.text) ? result.text.join("\n\n") : String(result.text || ""),
      format: "pdf",
    };
  }
  if (fileName.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(await file.arrayBuffer()),
    });
    return { text: result.value, format: "docx" };
  }
  if (fileName.endsWith(".txt") || fileName.endsWith(".md")) {
    return { text: await file.text(), format: "text" };
  }
  throw new Error("Autofill supports PDF, DOCX, TXT, or MD files.");
}
