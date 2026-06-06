import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionResult } from "@/shared/types";
import { parseExtractedData } from "@/shared/parseExtraction";
import { EXTRACTION_TOOL } from "./claudeFallback";
import { verifySourceText } from "./helpers";

export async function claudeVisionExtract(file: File, partialText = ""): Promise<ExtractionResult> {
  const anthropic = new Anthropic();
  if (file.size > 25 * 1024 * 1024) {
    throw new Error("PDF too large for vision extraction (max 25 MB).");
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
      "You are a tax document data extraction assistant. The document is a scanned or photographed image. Carefully read all visible text and extract every tax field exactly as shown. Never fabricate values — if a value is not visible, omit the field entirely.",
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

  if (partialText.replace(/\s+/g, "").length > 0) {
    verifySourceText(partialText, data.fields);
  } else {
    for (const field of data.fields) {
      delete field.sourceText;
    }
  }

  const fields = data.fields.map((field) => ({
    ...field,
    confidence: "low" as const,
  }));

  return {
    ...data,
    fields,
    extractionMethod: "ai",
    overallConfidence: "low",
    warning: partialText.replace(/\s+/g, "").length > 0
      ? "Scanned document — values verified against partial text where possible. Confirm every field against the source."
      : "Scanned document — no text layer for citation verification. Confirm every field against the source.",
  };
}
