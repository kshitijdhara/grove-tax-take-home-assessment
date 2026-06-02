import type { ExtractionResult } from "@/shared/types";
import { parsePdf } from "./parsePdf";
import { identifyDocument } from "./identifyDocument";
import { extractW2 } from "./w2";
import { extract1099NEC } from "./1099nec";
import { extract1099INT } from "./1099int";
import { extract1099DIV } from "./1099div";
import { claudeFallback } from "./claudeFallback";
import type { RegexExtractionResult } from "./types";

const CONFIDENCE_THRESHOLD = 0.7;

function toExtractionResult(
  r: RegexExtractionResult,
  method: ExtractionResult["extractionMethod"],
  overallConfidence: ExtractionResult["overallConfidence"]
): ExtractionResult {
  return {
    documentType: r.documentType,
    taxYear: r.taxYear,
    payer: { name: r.payerName, ein: r.payerEin },
    recipient: { name: r.recipientName, ssn_last4: r.recipientSsn4 },
    fields: r.fields,
    extractionMethod: method,
    overallConfidence,
  };
}

export async function runExtractionPipeline(file: File): Promise<ExtractionResult> {
  const rawText = await parsePdf(file);

  const docType = identifyDocument(rawText);
  if (!docType) {
    throw new Error(
      "Could not identify the document type. Supported forms: W-2, 1099-NEC, 1099-INT, 1099-DIV."
    );
  }

  let regexResult: RegexExtractionResult;
  switch (docType) {
    case "W-2":      regexResult = extractW2(rawText); break;
    case "1099-NEC": regexResult = extract1099NEC(rawText); break;
    case "1099-INT": regexResult = extract1099INT(rawText); break;
    case "1099-DIV": regexResult = extract1099DIV(rawText); break;
  }

  const score = regexResult.requiredFieldsFound / regexResult.totalRequiredFields;

  if (score >= CONFIDENCE_THRESHOLD) {
    return toExtractionResult(regexResult, "regex", "high");
  }

  if (!process.env["ANTHROPIC_API_KEY"]) {
    return toExtractionResult(regexResult, "regex", "low");
  }

  try {
    const aiData = await claudeFallback(rawText, docType);
    return {
      ...aiData,
      documentType: docType,
      extractionMethod: "ai",
      overallConfidence: "low",
    };
  } catch {
    return toExtractionResult(regexResult, "regex", "low");
  }
}
