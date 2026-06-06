export function detectCorrectedForm(rawText: string): boolean {
  return /\b(corrected|void|amended)\b/i.test(rawText);
}

export function correctedFormWarning(): string {
  return "This document appears to be CORRECTED, VOID, or AMENDED — verify you are using the final amounts.";
}
