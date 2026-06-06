// Shared extraction helpers used by all form extractors.

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
    return text.slice(start, end).replace(/[\t\n\r]+/g, " · ").trim();
  }
  return "";
}
