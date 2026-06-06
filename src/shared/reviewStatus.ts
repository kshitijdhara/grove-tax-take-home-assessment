import type { ExtractionResult } from "@/shared/types";
import { META_KEYS, fieldKey } from "@/shared/extractionKeys";

export function reviewKeysForResult(result: ExtractionResult): string[] {
  const metaKeys = [
    META_KEYS.taxYear,
    META_KEYS.payerName,
    META_KEYS.payerEin,
    META_KEYS.recipientName,
    META_KEYS.recipientSsn,
  ];

  return [
    ...metaKeys,
    ...result.fields.map((field) => fieldKey(field)),
    ...(result.missingFields ?? []).map((field) => fieldKey(field)),
  ];
}

export function allFieldsVerified(result: ExtractionResult, verified: Record<string, boolean>): boolean {
  const keys = reviewKeysForResult(result);
  if (keys.length === 0) return true;
  return keys.every((key) => verified[key]);
}

export function verifiedCount(result: ExtractionResult, verified: Record<string, boolean>): number {
  return reviewKeysForResult(result).filter((key) => verified[key]).length;
}

export function unverifiedLowConfidenceCount(
  result: ExtractionResult,
  verified: Record<string, boolean>
): number {
  const lowConfidenceKeys = result.fields
    .filter((field) => field.confidence === "low" || result.disagreements?.some((d) => fieldKey(d) === fieldKey(field)))
    .map((field) => fieldKey(field));
  return lowConfidenceKeys.filter((key) => !verified[key]).length;
}
