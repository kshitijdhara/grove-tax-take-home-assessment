import type { ExtractionResult } from "@/shared/types";
import { META_KEYS, fieldKey } from "@/shared/extractionKeys";
import { resolvedFieldValue } from "@/shared/resolvedResult";

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

export function fieldDisplayValue(
  result: ExtractionResult,
  key: string,
  edits: Record<string, string>
): string {
  const metaDefaults: Record<string, string> = {
    [META_KEYS.taxYear]: result.taxYear,
    [META_KEYS.payerName]: result.payer.name,
    [META_KEYS.payerEin]: result.payer.ein,
    [META_KEYS.recipientName]: result.recipient.name,
    [META_KEYS.recipientSsn]: result.recipient.ssn_last4,
  };
  if (key in metaDefaults) return edits[key] ?? metaDefaults[key] ?? "";

  const field = result.fields.find((f) => fieldKey(f) === key);
  if (field) return resolvedFieldValue(edits, field);

  const missing = result.missingFields?.find((f) => fieldKey(f) === key);
  if (missing) return edits[key] ?? "";

  return edits[key] ?? "";
}

export function hasUnresolvedValues(result: ExtractionResult, edits: Record<string, string>): boolean {
  return reviewKeysForResult(result).some((key) => !fieldDisplayValue(result, key, edits).trim());
}

export function unverifiedFieldLabels(
  result: ExtractionResult,
  edits: Record<string, string>,
  verified: Record<string, boolean>
): string[] {
  return reviewKeysForResult(result).flatMap((key) => {
    const value = fieldDisplayValue(result, key, edits);
    if (!value.trim()) return [`Unresolved: ${keyLabel(result, key)}`];
    if (!verified[key]) return [keyLabel(result, key)];
    return [];
  });
}

function keyLabel(result: ExtractionResult, key: string): string {
  const field = result.fields.find((f) => fieldKey(f) === key);
  if (field) return field.box ? `${field.box} ${field.label}` : field.label;
  const missing = result.missingFields?.find((f) => fieldKey(f) === key);
  if (missing) return `${missing.box} ${missing.label}`;
  switch (key) {
    case META_KEYS.taxYear: return "Tax Year";
    case META_KEYS.payerName: return "Payer Name";
    case META_KEYS.payerEin: return "Payer EIN";
    case META_KEYS.recipientName: return "Recipient Name";
    case META_KEYS.recipientSsn: return "Recipient SSN";
    default: return key;
  }
}

export function allFieldsVerified(
  result: ExtractionResult,
  edits: Record<string, string>,
  verified: Record<string, boolean>
): boolean {
  if (hasUnresolvedValues(result, edits)) return false;
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

export function entryVerificationSummary(
  result: ExtractionResult,
  edits: Record<string, string>,
  verified: Record<string, boolean>
): { done: number; total: number } {
  const keys = reviewKeysForResult(result);
  const done = keys.filter((key) => verified[key] && fieldDisplayValue(result, key, edits).trim()).length;
  return { done, total: keys.length };
}
