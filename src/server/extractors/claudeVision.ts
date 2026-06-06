import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionResult } from "@/shared/types";
import { parseExtractedData } from "@/shared/parseExtraction";
import { EXTRACTION_TOOL } from "./claudeFallback";
import { redactPII } from "./helpers";

export async function claudeVisionExtract(file: File): Promise<ExtractionResult> {
  const anthropic = new Anthropic();
  if (file.size > 20 * 1024 * 1024) {
    throw new Error("PDF too large for vision extraction (max 20 MB).");
  }
  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");

  const pdfDocument = {
    type: "document",
    source: {
      type: "base64",
      media_type: "application/pdf",
      data: base64,
    },
  } satisfies Anthropic.Messages.DocumentBlockParam;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system:
      "You are a tax document data extraction assistant. The document is a scanned or photographed image. Carefully read all visible text and extract every tax field exactly as shown. For fields you cannot clearly read, set confidence to \"low\". Never fabricate values — if a value is not visible, omit the field entirely. For each field, set sourceText to a short verbatim quote (20–60 characters) from the document containing or immediately preceding the value, so the preparer can trace it to source.",
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "extract_tax_fields" },
    messages: [
      {
        role: "user",
        content: [
          pdfDocument,
          {
            type: "text",
            text: "This is a scanned or photographed tax document. Identify the document type (W-2, 1099-NEC, 1099-INT, or 1099-DIV) from the visible content, then extract every tax field including the payer name, payer EIN, recipient name, recipient SSN last 4 digits, tax year, and all numbered boxes.",
          },
        ],
      },
    ],
  }, { timeout: 30_000 });

  const toolBlock = response.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
  if (!toolBlock) {
    throw new Error("Claude Vision did not return a structured extraction");
  }

  if (typeof toolBlock.input !== "object" || toolBlock.input === null) {
    throw new Error("Claude returned malformed extraction data");
  }

  const data = parseExtractedData(toolBlock.input);
  // The source is an image — there is no text layer to string-verify against — but the model's
  // sourceText quotes still get displayed/persisted, so redact PII from them.
  for (const f of data.fields) {
    if (f.sourceText) f.sourceText = redactPII(f.sourceText);
  }
  return {
    ...data,
    extractionMethod: "ai",
    overallConfidence: "low",
  };
}
