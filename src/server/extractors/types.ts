import type { DocumentType, TaxField } from "@/shared/types";

export interface RegexExtractionResult {
  documentType: DocumentType;
  taxYear: string;
  payerName: string;
  payerEin: string;
  recipientName: string;
  recipientSsn4: string;
  fields: TaxField[];
  requiredFieldsFound: number;
  totalRequiredFields: number;
}
