import Anthropic from "@anthropic-ai/sdk";
import type { DocumentType } from "@/shared/types";
import { parseExtractedData, type ExtractedData } from "@/shared/parseExtraction";
import { verifySourceText } from "./helpers";

export interface ClaudeExtractedData extends ExtractedData {}

export const EXTRACTION_TOOL: Anthropic.Messages.Tool = {
  name: "extract_tax_fields",
  description: "Extract all structured fields from a tax document",
  input_schema: {
    type: "object",
    properties: {
      documentType: {
        type: "string",
        enum: ["W-2", "1099-NEC", "1099-INT", "1099-DIV"],
      },
      taxYear: { type: "string", description: "4-digit year, e.g. 2024" },
      payer: {
        type: "object",
        properties: {
          name: { type: "string" },
          ein: { type: "string", description: "Format XX-XXXXXXX" },
        },
        required: ["name", "ein"],
      },
      recipient: {
        type: "object",
        properties: {
          name: { type: "string" },
          ssn_last4: { type: "string", description: "Last 4 digits of SSN" },
        },
        required: ["name", "ssn_last4"],
      },
      fields: {
        type: "array",
        items: {
          type: "object",
          properties: {
            box: { type: "string" },
            label: { type: "string" },
            value: { type: "string" },
            confidence: { type: "string", enum: ["high", "low"] },
            sourceText: { type: "string", description: "Short verbatim quote (20-60 chars) from the document text where this value appears, for source traceability" },
          },
          required: ["label", "value", "confidence"],
        },
      },
    },
    required: ["documentType", "taxYear", "payer", "recipient", "fields"],
  },
};

export async function claudeFallback(
  rawText: string,
  docType: DocumentType
): Promise<ClaudeExtractedData> {
  const anthropic = new Anthropic();

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system:
      "You are a tax document data extraction assistant. Extract all fields exactly as they appear on the document. For fields you cannot find or are uncertain about, set confidence to \"low\". Never fabricate values — if a value is not present, omit the field entirely. For each field, set sourceText to a short verbatim quote (20–60 characters) from the document that contains or immediately precedes the value — this enables source traceability for the preparer.",
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "extract_tax_fields" },
    messages: [
      {
        role: "user",
        content: `Extract all fields from this ${docType} tax document:\n\n<document>\n${rawText}\n</document>`,
      },
    ],
  }, { timeout: 30_000 });

  const toolBlock = response.content.find((b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use");
  if (!toolBlock) {
    throw new Error("Claude did not return a structured tool_use block");
  }

  if (typeof toolBlock.input !== "object" || toolBlock.input === null) {
    throw new Error("Claude returned malformed extraction data");
  }

  const data = parseExtractedData(toolBlock.input);
  // We have the ground-truth text here, so verify every AI citation against it and redact PII.
  verifySourceText(rawText, data.fields);
  return data;
}
