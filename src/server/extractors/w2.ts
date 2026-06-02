import type { TaxField } from "@/shared/types";
import type { RegexExtractionResult } from "./types";

// ADP W-2 (and similar payroll processors) produce multi-column layouts where
// labels and values appear far apart in extracted text. We handle three strategies:
//   1. ADP-specific markers ("Batch #", "Reported W-2 Wages")
//   2. Interleaved-value pattern (fedTax\nwages\tfedTax\twages\tfedTax repeating)
//   3. Standard single-column fallback

const REQUIRED_COUNT = 6;

// IMPORTANT: use \d+ (not \d{1,3}) — ADP PDFs emit amounts like "1216.19" without
// comma separators, so \d{1,3} only matches up to 3 leading digits and silently fails
// on anything ≥ $1,000.
const MONEY = `(\\d+(?:,\\d{3})*\\.\\d{2})`;

function findMoney(text: string, ...patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

function findText(text: string, ...patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    const v = m?.[1]?.trim();
    if (v) return v;
  }
  return null;
}

// Converts ADP space-separated format "14 194 65" → "14,194.65"
function parseAdpAmount(m1: string, m2: string, m3: string): string {
  return `${m1},${m2}.${m3}`;
}

// ADP "Box N of W-2" labels use space-separated amounts e.g. "14 194 65"
function findAdpBoxAmount(text: string, boxLabel: string): string | null {
  const re = new RegExp(
    `${boxLabel}[^\\d]{0,80}(\\d{1,3})\\s+(\\d{3})\\s+(\\d{2})(?!\\d)`,
    "i"
  );
  const m = text.match(re);
  if (m?.[1] && m[2] && m[3]) return parseAdpAmount(m[1], m[2], m[3]);
  return null;
}

// ADP multi-copy W-2 interleaved pattern:
// extracted text contains:  <fedTax>\n<wages> \t<fedTax> \t<wages> \t<fedTax>
// We detect the repeating pair and identify smaller=fedTax, larger=wages.
function findAdpInterleavedValues(
  text: string
): { fedTax: string | null; wages: string | null } {
  // Three-way repetition: A\nB \tA \tB \tA  (where A=fedTax, B=wages)
  const m = text.match(
    /(\d+(?:,\d{3})*\.\d{2})\n(\d+(?:,\d{3})*\.\d{2})\s+\1\s+\2\s+\1/
  );
  if (!m?.[1] || !m[2]) return { fedTax: null, wages: null };
  const a = parseFloat(m[1].replace(",", ""));
  const b = parseFloat(m[2].replace(",", ""));
  return a < b
    ? { fedTax: m[1], wages: m[2] }
    : { fedTax: m[2], wages: m[1] };
}

function formatMoney(raw: string | null): string | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/,/g, ""));
  if (isNaN(n)) return raw;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function extractW2(text: string): RegexExtractionResult {
  // --- Tax year ---
  const taxYear =
    findText(
      text,
      /(?:tax\s+year|calendar\s+year)\s*:?\s*(\d{4})/i,
      /\b(20(?:1[5-9]|2[0-9]))\b/
    ) ?? "";

  // --- Employer EIN ---
  const payerEin =
    findText(
      text,
      /(?:employer|payer)[''s]*\s+(?:fed\s+id|federal\s+id|identification|ein)[^a-z\d]*(\d{2}-\d{7})/i,
      /\b(\d{2}-\d{7})\b/
    ) ?? "";

  // --- Employer name ---
  // ADP: company name is the first non-blank line after "Batch #NNNNN"
  const payerName =
    findText(
      text,
      /Batch\s*#?\s*\d+\s*\n([^\n\t]{3,60})/i,
      /employer[''s]*\s+name[,\s]+address[^\n]*\n+([^\n]{2,80})/i,
      /employer[''s]*\s+name[^\n]*\n+([^\n]{2,80})/i
    ) ?? "";

  // --- Employee name ---
  // ADP all-caps layout: personal names have 3+ words (FIRST MIDDLE LAST), which
  // distinguishes them from placeholders like "APPLIED FOR" (only 2 words).
  // Additional anchor: the name is followed immediately by a decimal amount line.
  const recipientName =
    findText(
      text,
      // 3–4 all-caps words then \n then a decimal amount (not a street number)
      /([A-Z]{2,}(?:\s+[A-Z]{2,}){2,3})\n\d+\.\d{2}/,
      // 2-word fallback excluding known IRS placeholders
      /(?!APPLIED\s+FOR\b)([A-Z]{3,}\s+[A-Z]{3,})\n\d+\.\d{2}/,
      // Standard mixed-case patterns
      /employee[''s]*\s+(?:first\s+name\b[^\n]*\n+|name[^\n]*\n+)([A-Z][a-zA-Z]+(?:[\s,]+[A-Z][a-zA-Z]*){1,3})/i,
      /employee[''s]*\s+name[^\n]*\n+([^\n]{2,60})/i
    ) ?? "";

  // --- SSN last 4 ---
  const recipientSsn4 =
    findText(
      text,
      /employee[''s]*\s+(?:ssn|social\s+security)[^a-z\d]*(?:xxx|[*]+)[^a-z\d]*(\d{4})/i,
      /\b(?:xxx|[*]+)[- ]?(?:xx|[*]+)[- ]?(\d{4})\b/i,
      /\b\d{3}-\d{2}-(\d{4})\b/
    ) ?? "";

  // --- Wages (Box 1) ---
  // Priority 1: ADP "Reported W-2 Wages" summary (most reliable for ADP format)
  let wages: string | null = findMoney(
    text,
    /Reported\s+W-?2\s+Wages[^\d]*(?:0\.00\s+)?(\d+(?:,\d{3})*\.\d{2})/i
  );
  // Priority 2: ADP "Box 1 of W-2" with space-separated amount
  if (!wages) wages = findAdpBoxAmount(text, "Box\\s+1\\s+of\\s+W-?2");
  // Priority 3: standard label → value (single-column W-2 forms)
  if (!wages)
    wages = findMoney(
      text,
      new RegExp(`1\\s+wages[,\\s]+tips[,\\s]+other\\s+comp\\w*[^\\d\\n]{0,80}${MONEY}`, "i"),
      new RegExp(`wages[,\\s]+tips[,\\s]+other\\s+comp\\w*[^\\d\\n]{0,80}${MONEY}`, "i"),
      new RegExp(`box\\s*1\\b[^a-z\\d]{0,30}${MONEY}`, "i")
    );

  // --- Federal income tax withheld (Box 2) ---
  let fedTax: string | null = findMoney(
    text,
    new RegExp(`2\\s+federal\\s+income\\s+tax\\s+withheld[^\\d\\n]{0,80}${MONEY}`, "i"),
    new RegExp(`federal\\s+income\\s+tax\\s+withheld[^\\d\\n]{0,80}${MONEY}`, "i"),
    new RegExp(`box\\s*2\\b[^a-z\\d]{0,20}${MONEY}`, "i")
  );

  // --- ADP interleaved fallback (resolves both wages & fedTax together) ---
  if (!wages || !fedTax) {
    const adp = findAdpInterleavedValues(text);
    if (!wages && adp.wages) wages = adp.wages;
    if (!fedTax && adp.fedTax) fedTax = adp.fedTax;
  }

  // --- SS wages (Box 3) ---
  // Note: avoid ADP "Box 3 of W-2" from the earnings summary — it shows pre-GTL
  // base wages, not the IRS-reported amount. Fall back to Box 1 wages instead.
  const ssWages =
    findMoney(
      text,
      new RegExp(`3\\s+social\\s+security\\s+wages[^\\d\\n]{0,80}${MONEY}`, "i"),
      new RegExp(`social\\s+security\\s+wages[^\\d\\n]{0,80}${MONEY}`, "i")
    ) ?? wages;

  // --- SS tax withheld (Box 4) ---
  const ssTax = findMoney(
    text,
    new RegExp(`4\\s+social\\s+security\\s+tax\\s+withheld[^\\d\\n]{0,80}${MONEY}`, "i"),
    new RegExp(`social\\s+security\\s+tax\\s+withheld[^\\d\\n]{0,80}${MONEY}`, "i")
  );

  // --- Medicare wages (Box 5) ---
  const medicareWages =
    findMoney(
      text,
      new RegExp(`5\\s+medicare\\s+wages[^\\d\\n]{0,80}${MONEY}`, "i"),
      new RegExp(`medicare\\s+wages\\s+and\\s+tips[^\\d\\n]{0,80}${MONEY}`, "i")
    ) ?? wages;

  // --- Medicare tax withheld (Box 6) ---
  const medicareTax = findMoney(
    text,
    new RegExp(`6\\s+medicare\\s+tax\\s+withheld[^\\d\\n]{0,80}${MONEY}`, "i"),
    new RegExp(`medicare\\s+tax\\s+withheld[^\\d\\n]{0,80}${MONEY}`, "i")
  );

  // --- Box 12 Code C (group-term life insurance imputed income) ---
  const gtl = findMoney(
    text,
    /\bC\b[\t ]+([\d]+\.\d{2})/,
    /code\s*C[^\d]{0,10}(\d+\.\d{2})/i
  );

  // --- State (Box 15) ---
  const state = findText(text, /\b(PA|CA|NY|TX|FL|IL|OH|WA|CO|GA|MA|AZ|NC|MI|NJ)\b/);

  // --- State wages (Box 16) ---
  const stateWages =
    findAdpBoxAmount(text, "Box\\s+16\\s+of\\s+W-?2") ??
    findMoney(
      text,
      new RegExp(`16\\s+state\\s+wages[^\\d]{0,80}${MONEY}`, "i"),
      new RegExp(`state\\s+wages[,\\s]+tips[^\\d]{0,80}${MONEY}`, "i")
    );

  // --- State income tax (Box 17) ---
  // Allow newlines between state code and amount ("PA\n435.77")
  const stateTax = state
    ? findMoney(
        text,
        new RegExp(`${state}[^\\d]{0,40}${MONEY}`, "i"),
        new RegExp(`17\\s+state\\s+income\\s+tax[^\\d]{0,80}${MONEY}`, "i"),
        new RegExp(`state\\s+income\\s+tax[^\\d]{0,80}${MONEY}`, "i")
      )
    : findMoney(
        text,
        new RegExp(`17\\s+state\\s+income\\s+tax[^\\d]{0,80}${MONEY}`, "i"),
        new RegExp(`state\\s+income\\s+tax[^\\d]{0,80}${MONEY}`, "i")
      );

  // --- Confidence: 6 required fields ---
  const required = [wages, fedTax, ssTax ?? ssWages, payerEin, recipientName, taxYear];
  const requiredFieldsFound = required.filter(Boolean).length;

  // --- Build fields array (only emit non-null, non-duplicate values) ---
  const fields: TaxField[] = [];
  const add = (box: string, label: string, raw: string | null) => {
    const v = formatMoney(raw);
    if (v) fields.push({ box, label, value: v, confidence: "high" });
  };

  add("Box 1", "Wages, tips, other compensation", wages);
  add("Box 2", "Federal income tax withheld", fedTax);
  if (ssWages !== wages) add("Box 3", "Social security wages", ssWages);
  add("Box 4", "Social security tax withheld", ssTax);
  if (medicareWages !== wages) add("Box 5", "Medicare wages and tips", medicareWages);
  add("Box 6", "Medicare tax withheld", medicareTax);
  if (gtl) add("Box 12c", "Code C — Group-term life insurance", gtl);
  if (state && stateWages) add("Box 15–16", `State (${state}) wages`, stateWages);
  if (state && stateTax) add("Box 17", `State (${state}) income tax`, stateTax);

  return {
    documentType: "W-2",
    taxYear,
    payerName,
    payerEin,
    recipientName,
    recipientSsn4,
    fields,
    requiredFieldsFound,
    totalRequiredFields: REQUIRED_COUNT,
  };
}
