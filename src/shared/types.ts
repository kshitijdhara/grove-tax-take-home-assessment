export type DocumentType = "W-2" | "1099-NEC" | "1099-INT" | "1099-DIV";
export type ConfidenceLevel = "high" | "low";
export type ExtractionMethod = "regex" | "ai";

export interface TaxField {
  box?: string;
  label: string;
  value: string;
  confidence: ConfidenceLevel;
}

export interface ExtractionResult {
  documentType: DocumentType;
  taxYear: string;
  payer: { name: string; ein: string };
  recipient: { name: string; ssn_last4: string };
  fields: TaxField[];
  extractionMethod: ExtractionMethod;
  overallConfidence: ConfidenceLevel;
}
