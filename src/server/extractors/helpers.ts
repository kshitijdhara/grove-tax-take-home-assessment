// Shared extraction helpers used by all form extractors.

import type { TaxField } from "@/shared/types";

// Redact full SSNs (and bare 9-digit runs that are almost certainly SSNs) from any text
// that may be shown in the UI or persisted to localStorage. Keep the last 4 so the snippet
// is still useful for the preparer without exposing PII. EINs (XX-XXXXXXX) are intentionally
// left intact — they are employer identifiers, not taxpayer PII, and the preparer needs them.
export function redactPII(text: string): string {
  return text
    .replace(/\b\d{3}-\d{2}-(\d{4})\b/g, "•••-••-$1")
    .replace(/\b\d{5}(\d{4})\b/g, "•••••$1");
}

// Verify each field's AI-provided sourceText actually appears in the source text, and redact
// PII from the ones that do. A citation we can't find in the document is worse than none —
// it's a fabricated provenance claim — so we drop it rather than show it.
export function verifySourceText(rawText: string, fields: TaxField[]): void {
  const haystack = rawText.replace(/\s+/g, " ").trim().toLowerCase();
  for (const f of fields) {
    if (!f.sourceText) continue;
    const quote = f.sourceText.replace(/\s+/g, " ").trim().toLowerCase();
    // Too short to be a meaningful, low-false-positive citation → drop.
    if (quote.length < 6 || !haystack.includes(quote)) {
      delete f.sourceText;
    } else {
      f.sourceText = redactPII(f.sourceText);
    }
  }
}

// Matches monetary amounts, optionally preceded by a $ sign.
// W-2 amounts typically omit $; 1099 amounts may include it.
export const MONEY = `\\$?\\s*(\\d+(?:,\\d{3})*\\.\\d{2})`;

export function findMoney(text: string, ...patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function findText(text: string, ...patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    const v = m?.[1]?.trim();
    if (v) return v;
  }
  return null;
}

export function formatMoney(raw: string | null): string | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/,/g, ""));
  if (isNaN(n)) return raw;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function captureContext(text: string, rawValue: string, windowChars = 100): string {
  const searches = [rawValue, rawValue.replace(/,/g, "")].filter(Boolean);
  for (const needle of searches) {
    // Use lastIndexOf: on multi-section payroll PDFs (e.g. ADP) the same value often
    // appears in an earnings summary earlier in the text and again in the actual W-2 box
    // section later. The later (last) occurrence is the one that corresponds to the box.
    const idx = text.lastIndexOf(needle);
    if (idx === -1) continue;
    const start = Math.max(0, idx - windowChars);
    const end   = Math.min(text.length, idx + needle.length + windowChars);
    return redactPII(text.slice(start, end).replace(/[\t\n\r]+/g, " · ").trim());
  }
  return "";
}
