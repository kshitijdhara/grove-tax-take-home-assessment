import type { DocumentType, ExtractionResult, ProgressStage } from "@/shared/types";
import { assertNever } from "@/shared/assertNever";
import { computeOverallConfidence } from "@/shared/confidence";
import { correctedFormWarning, detectCorrectedForm } from "@/shared/documentFlags";
import { mergeRegexAndAi } from "@/shared/mergeExtraction";
import { logExtraction } from "../extractionLog";
import { parsePdf, parsePdfSafe } from "./parsePdf";
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

interface ToResultOptions {
  warning?: string;
  corrected?: boolean;
  formTypeWarning?: string;
  aiValidationFailed?: boolean;
}

function toExtractionResult(
  r: RegexExtractionResult,
  method: ExtractionResult["extractionMethod"],
  options?: ToResultOptions
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
    ...(options?.formTypeWarning ? { formTypeWarning: options.formTypeWarning } : {}),
    ...(options?.aiValidationFailed ? { aiValidationFailed: true } : {}),
    extractionMethod: method,
  };
  return {
    ...base,
    overallConfidence: computeOverallConfidence(base),
  };
}

function finishLog(startMs: number, result: ExtractionResult, aiValidationFailed: boolean): ExtractionResult {
  logExtraction({
    timestamp: new Date().toISOString(),
    documentType: result.documentType,
    extractionMethod: result.extractionMethod,
    fieldCount: result.fields.length,
    disagreementCount: result.disagreements?.length ?? 0,
    missingFieldCount: result.missingFields?.length ?? 0,
    aiValidationFailed,
    durationMs: Date.now() - startMs,
  });
  return result;
}

export async function runExtractionPipeline(
  file: File,
  onProgress?: (stage: ProgressStage) => void
): Promise<ExtractionResult> {
  const startMs = Date.now();
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
    const partialText = await parsePdfSafe(file);
    const visionResult = await claudeVisionExtract(file, partialText);
    report("complete");
    return finishLog(startMs, {
      ...visionResult,
      ...(corrected ? { corrected: true, warning: appendWarning(visionResult.warning, correctedWarning!) } : {}),
    }, false);
  }

  report("identifying");
  const identified = identifyDocument(rawText);
  if (!identified) {
    throw new Error(
      "Could not identify the document type. Supported forms: W-2, 1099-NEC, 1099-INT, 1099-DIV."
    );
  }

  const { documentType: docType, formTypeWarning } = identified;

  report("extracting");
  const regexPromise = Promise.resolve(extractByDocumentType(docType, rawText));
  const aiPromise = process.env["ANTHROPIC_API_KEY"]
    ? claudeFallback(rawText, docType)
    : null;

  if (!aiPromise) {
    const regexResult = await regexPromise;
    report("complete");
    return finishLog(startMs, toExtractionResult(
      regexResult,
      "regex",
      {
        corrected: corrected || undefined,
        formTypeWarning,
        warning: appendWarning(
          correctedWarning,
          "AI validation unavailable — pattern matching only. Verify all fields manually."
        ),
      }
    ), false);
  }

  report("validating");
  try {
    const [regexResult, aiData] = await Promise.all([regexPromise, aiPromise]);
    const regexExtraction = toExtractionResult(regexResult, "regex", {
      corrected: corrected || undefined,
      formTypeWarning,
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
    return finishLog(startMs, {
      ...merged,
      formTypeWarning,
      ...(corrected ? { corrected: true, warning: appendWarning(merged.warning, correctedWarning!) } : {}),
    }, false);
  } catch (err) {
    const regexResult = await regexPromise;
    const reason = err instanceof Error ? err.message : "Unknown error";
    report("complete");
    return finishLog(startMs, toExtractionResult(
      regexResult,
      "regex",
      {
        corrected: corrected || undefined,
        formTypeWarning,
        aiValidationFailed: true,
        warning: appendWarning(
          correctedWarning,
          `AI validation failed (${reason}). Pattern matching only — verify every field manually before use.`
        ),
      }
    ), true);
  }
}

export { IMAGE_PDF_TEXT_THRESHOLD };
