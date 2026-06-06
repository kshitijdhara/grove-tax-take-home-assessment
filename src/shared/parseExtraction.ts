import type {
  ConfidenceLevel,
  DocumentType,
  ExtractionMethod,
  ExtractionResult,
  MissingField,
  TaxField,
} from "@/shared/types";

export interface ExtractedData extends Omit<ExtractionResult, "extractionMethod" | "overallConfidence"> {}

const DOCUMENT_TYPES: readonly DocumentType[] = ["W-2", "1099-NEC", "1099-INT", "1099-DIV"];

function isDocumentType(value: string): value is DocumentType {
  return DOCUMENT_TYPES.some((documentType) => documentType === value);
}

function isConfidenceLevel(value: string): value is ConfidenceLevel {
  return value === "high" || value === "low";
}

function isExtractionMethod(value: string): value is ExtractionMethod {
  return value === "regex" || value === "ai";
}

function parseTaxField(value: object): TaxField | null {
  if (!("label" in value) || typeof value.label !== "string") return null;
  if (!("value" in value) || typeof value.value !== "string") return null;
  if (!("confidence" in value) || typeof value.confidence !== "string" || !isConfidenceLevel(value.confidence)) {
    return null;
  }

  const field: TaxField = {
    label: value.label,
    value: value.value,
    confidence: value.confidence,
  };
  if ("box" in value && typeof value.box === "string") field.box = value.box;
  if ("sourceText" in value && typeof value.sourceText === "string") field.sourceText = value.sourceText;
  return field;
}

function parseMissingField(value: object): MissingField | null {
  if (!("box" in value) || typeof value.box !== "string") return null;
  if (!("label" in value) || typeof value.label !== "string") return null;
  if (!("reason" in value) || typeof value.reason !== "string") return null;
  return { box: value.box, label: value.label, reason: value.reason };
}

function parsePayer(value: object): ExtractedData["payer"] | null {
  if (!("name" in value) || typeof value.name !== "string") return null;
  if (!("ein" in value) || typeof value.ein !== "string") return null;
  return { name: value.name, ein: value.ein };
}

function parseRecipient(value: object): ExtractedData["recipient"] | null {
  if (!("name" in value) || typeof value.name !== "string") return null;
  if (!("ssn_last4" in value) || typeof value.ssn_last4 !== "string") return null;
  return { name: value.name, ssn_last4: value.ssn_last4 };
}

function parseStringRecord(value: object): Record<string, string> | null {
  const entries = Object.entries(value);
  if (entries.some(([, v]) => typeof v !== "string")) return null;
  return Object.fromEntries(entries);
}

export function parseExtractedData(input: object): ExtractedData {
  if (!("documentType" in input) || typeof input.documentType !== "string" || !isDocumentType(input.documentType)) {
    throw new Error("Malformed extraction data");
  }
  if (!("taxYear" in input) || typeof input.taxYear !== "string") {
    throw new Error("Malformed extraction data");
  }
  if (!("payer" in input) || typeof input.payer !== "object" || input.payer === null) {
    throw new Error("Malformed extraction data");
  }
  if (!("recipient" in input) || typeof input.recipient !== "object" || input.recipient === null) {
    throw new Error("Malformed extraction data");
  }
  if (!("fields" in input) || !Array.isArray(input.fields)) {
    throw new Error("Malformed extraction data");
  }

  const payer = parsePayer(input.payer);
  const recipient = parseRecipient(input.recipient);
  if (!payer || !recipient) {
    throw new Error("Malformed extraction data");
  }

  const fields = input.fields.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const field = parseTaxField(item);
    return field ? [field] : [];
  });

  const data: ExtractedData = {
    documentType: input.documentType,
    taxYear: input.taxYear,
    payer,
    recipient,
    fields,
  };

  if ("missingFields" in input && Array.isArray(input.missingFields)) {
    const missingFields = input.missingFields.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const missing = parseMissingField(item);
      return missing ? [missing] : [];
    });
    if (missingFields.length > 0) data.missingFields = missingFields;
  }

  if ("warning" in input && typeof input.warning === "string") {
    data.warning = input.warning;
  }

  return data;
}

export function parseExtractionResult(input: object): ExtractionResult {
  const data = parseExtractedData(input);

  if (!("extractionMethod" in input) || typeof input.extractionMethod !== "string" || !isExtractionMethod(input.extractionMethod)) {
    throw new Error("Malformed extraction data");
  }
  if (!("overallConfidence" in input) || typeof input.overallConfidence !== "string" || !isConfidenceLevel(input.overallConfidence)) {
    throw new Error("Malformed extraction data");
  }

  return {
    ...data,
    extractionMethod: input.extractionMethod,
    overallConfidence: input.overallConfidence,
  };
}

export function parseApiErrorBody(input: object): { error?: string } {
  if ("error" in input && typeof input.error === "string") {
    return { error: input.error };
  }
  return {};
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  filename: string;
  result: ExtractionResult;
  edits?: Record<string, string>;
  clientName?: string;
}

export function parseHistoryEntry(input: object): HistoryEntry | null {
  if (!("id" in input) || typeof input.id !== "string") return null;
  if (!("timestamp" in input) || typeof input.timestamp !== "number") return null;
  if (!("filename" in input) || typeof input.filename !== "string") return null;
  if (!("result" in input) || typeof input.result !== "object" || input.result === null) return null;

  try {
    const result = parseExtractionResult(input.result);
    const entry: HistoryEntry = {
      id: input.id,
      timestamp: input.timestamp,
      filename: input.filename,
      result,
    };

    if ("edits" in input && typeof input.edits === "object" && input.edits !== null) {
      const edits = parseStringRecord(input.edits);
      if (edits && Object.keys(edits).length > 0) entry.edits = edits;
    }

    if ("clientName" in input && typeof input.clientName === "string") {
      entry.clientName = input.clientName;
    }

    return entry;
  } catch {
    return null;
  }
}
