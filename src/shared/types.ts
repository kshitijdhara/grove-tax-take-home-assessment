export type DocumentType = "W-2" | "1099-NEC" | "1099-INT" | "1099-DIV";
export type ConfidenceLevel = "high" | "low";
export type ExtractionMethod = "regex" | "ai" | "validated";

export interface TaxField {
  box?: string;
  label: string;
  value: string;
  confidence: ConfidenceLevel;
  sourceText?: string;
}

export interface MissingField {
  box: string;
  label: string;
  reason: string;
}

export interface FieldDisagreement {
  box?: string;
  label: string;
  regexValue: string;
  aiValue: string;
}

export interface ExtractionResult {
  documentType: DocumentType;
  taxYear: string;
  payer: { name: string; ein: string };
  recipient: { name: string; ssn_last4: string };
  fields: TaxField[];
  missingFields?: MissingField[];
  disagreements?: FieldDisagreement[];
  warning?: string;
  corrected?: boolean;
  formTypeWarning?: string;
  aiValidationFailed?: boolean;
  extractionMethod: ExtractionMethod;
  overallConfidence: ConfidenceLevel;
}

export type ProgressStage = "parsing" | "identifying" | "extracting" | "validating" | "complete";

export interface ExtractionProgressEvent {
  stage: ProgressStage;
  result?: ExtractionResult;
  error?: string;
}
