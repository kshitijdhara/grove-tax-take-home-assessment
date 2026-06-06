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
