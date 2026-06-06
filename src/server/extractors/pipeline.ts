import type { DocumentType, ExtractionResult, ProgressStage } from "@/shared/types";
import { assertNever } from "@/shared/assertNever";
import { computeOverallConfidence } from "@/shared/confidence";
import { correctedFormWarning, detectCorrectedForm } from "@/shared/documentFlags";
import { mergeRegexAndAi } from "@/shared/mergeExtraction";
import { parsePdf } from "./parsePdf";
import { identifyDocument } from "./identifyDocument";
import { extractW2 } from "./w2";
import { extract1099NEC } from "./1099nec";
import { extract1099INT } from "./1099int";
import { extract1099DIV } from "./1099div";
import { claudeFallback } from "./claudeFallback";
import { claudeVisionExtract } from "./claudeVision";
import type { RegexExtractionResult } from "./types";

const IMAGE_PDF_TEXT_THRESHOLD = 500;

function extractByDocumentType(docType: DocumentType, rawText: string): RegexExtractionResult {
  switch (docType) {
    case "W-2":      return extractW2(rawText);
    case "1099-NEC": return extract1099NEC(rawText);
    case "1099-INT": return extract1099INT(rawText);
    case "1099-DIV": return extract1099DIV(rawText);
    default:         return assertNever(docType);
  }
}

function appendWarning(existing: string | undefined, addition: string): string {
  return existing ? `${existing} ${addition}` : addition;
}

function toExtractionResult(
  r: RegexExtractionResult,
  method: ExtractionResult["extractionMethod"],
  options?: { warning?: string; corrected?: boolean }
): ExtractionResult {
  const base = {
    documentType: r.documentType,
    taxYear: r.taxYear,
    payer: { name: r.payerName, ein: r.payerEin },
    recipient: { name: r.recipientName, ssn_last4: r.recipientSsn4 },
    fields: r.fields,
    ...(r.missingFields && r.missingFields.length > 0 ? { missingFields: r.missingFields } : {}),
    ...(options?.warning ? { warning: options.warning } : {}),
    ...(options?.corrected ? { corrected: true } : {}),
    extractionMethod: method,
  };
  return {
    ...base,
    overallConfidence: computeOverallConfidence(base),
  };
}

export async function runExtractionPipeline(
  file: File,
  onProgress?: (stage: ProgressStage) => void
): Promise<ExtractionResult> {
  const report = (stage: ProgressStage) => onProgress?.(stage);

  report("parsing");
  const rawText = await parsePdf(file);
  const corrected = detectCorrectedForm(rawText);
  const correctedWarning = corrected ? correctedFormWarning() : undefined;

  const meaningfulChars = rawText.replace(/\s+/g, "").length;
  if (meaningfulChars < IMAGE_PDF_TEXT_THRESHOLD) {
    if (!process.env["ANTHROPIC_API_KEY"]) {
      throw new Error(
        "This appears to be a scanned or photographed document. AI-powered extraction is required but no API key is configured."
      );
    }
    report("validating");
    try {
      const result = await claudeVisionExtract(file);
      report("complete");
      return {
        ...result,
        ...(corrected ? { corrected: true, warning: appendWarning(result.warning, correctedWarning!) } : {}),
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      throw new Error(
        `AI vision extraction failed: ${reason}. Ensure the document is clearly photographed with all text visible and try again.`
      );
    }
  }

  report("identifying");
  const docType = identifyDocument(rawText);
  if (!docType) {
    throw new Error(
      "Could not identify the document type. Supported forms: W-2, 1099-NEC, 1099-INT, 1099-DIV."
    );
  }

  report("extracting");
  const regexPromise = Promise.resolve(extractByDocumentType(docType, rawText));
  const aiPromise = process.env["ANTHROPIC_API_KEY"]
    ? claudeFallback(rawText, docType)
    : null;

  if (!aiPromise) {
    const regexResult = await regexPromise;
    report("complete");
    return toExtractionResult(
      regexResult,
      "regex",
      {
        corrected: corrected || undefined,
        warning: appendWarning(
          correctedWarning,
          "AI validation unavailable — pattern matching only. Verify all fields manually."
        ),
      }
    );
  }

  report("validating");
  try {
    const [regexResult, aiData] = await Promise.all([regexPromise, aiPromise]);
    const regexExtraction = toExtractionResult(regexResult, "regex", {
      corrected: corrected || undefined,
      warning: correctedWarning,
    });
    const merged = mergeRegexAndAi(
      {
        ...regexExtraction,
        documentType: docType,
      },
      aiData
    );
    report("complete");
    return {
      ...merged,
      ...(corrected ? { corrected: true, warning: appendWarning(merged.warning, correctedWarning!) } : {}),
    };
  } catch (err) {
    const regexResult = await regexPromise;
    const reason = err instanceof Error ? err.message : "Unknown error";
    report("complete");
    return toExtractionResult(
      regexResult,
      "regex",
      {
        corrected: corrected || undefined,
        warning: appendWarning(
          correctedWarning,
          `AI validation failed (${reason}). Showing pattern-matched extraction — verify all fields manually before use.`
        ),
      }
    );
  }
}

export { IMAGE_PDF_TEXT_THRESHOLD };
