import { META_KEYS, fieldKey } from "@/shared/extractionKeys";
import type { ExtractionResult, TaxField } from "@/shared/types";

export function resolvedFieldValue(
  edits: Record<string, string>,
  field: TaxField
): string {
  return edits[fieldKey(field)] ?? field.value;
}

export function applyEditsToResult(
  result: ExtractionResult,
  edits: Record<string, string>
): ExtractionResult {
  return {
    ...result,
    taxYear: edits[META_KEYS.taxYear] ?? result.taxYear,
    payer: {
      name: edits[META_KEYS.payerName] ?? result.payer.name,
      ein: edits[META_KEYS.payerEin] ?? result.payer.ein,
    },
    recipient: {
      name: edits[META_KEYS.recipientName] ?? result.recipient.name,
      ssn_last4: edits[META_KEYS.recipientSsn] ?? result.recipient.ssn_last4,
    },
    fields: result.fields.map((field) => ({
      ...field,
      value: resolvedFieldValue(edits, field),
    })),
  };
}
