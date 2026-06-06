import { PDFParse } from "pdf-parse";

export async function parsePdf(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return result.text;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown parse error";
    throw new Error(`Could not read PDF text layer: ${reason}. If this is a scanned document, ensure an API key is configured for vision extraction.`);
  } finally {
    await parser.destroy();
  }
}

export async function parsePdfSafe(file: File): Promise<string> {
  try {
    return await parsePdf(file);
  } catch {
    return "";
  }
}
