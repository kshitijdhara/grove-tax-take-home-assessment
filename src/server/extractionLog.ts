import type { ExtractionResult } from "@/shared/types";

export interface ExtractionLogEntry {
  timestamp: string;
  documentType: ExtractionResult["documentType"];
  extractionMethod: ExtractionResult["extractionMethod"];
  fieldCount: number;
  disagreementCount: number;
  missingFieldCount: number;
  aiValidationFailed: boolean;
  durationMs: number;
}

export function logExtraction(entry: ExtractionLogEntry): void {
  console.info("[extraction]", JSON.stringify(entry));
}
