import type { DocumentType, TaxField, MissingField } from "@/shared/types";

export interface RegexExtractionResult {
  documentType: DocumentType;
  taxYear: string;
  payerName: string;
  payerEin: string;
  recipientName: string;
  recipientSsn4: string;
  fields: TaxField[];
  missingFields?: MissingField[];
  requiredFieldsFound: number;
  totalRequiredFields: number;
}
