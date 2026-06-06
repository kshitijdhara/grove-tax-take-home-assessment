import type { TaxField, MissingField } from "@/shared/types";
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

// ADP amounts often appear BEFORE their box label in the earnings summary.
// e.g. "14194.65\nKSHITIJ DIBAKAR DHARA\n...\nBox 5 of W-2  Box 16 of W-2"
// Search backwards: find the last amount that appears within `lookback` chars before the label.
function findAdpAmountBeforeLabel(text: string, labelPattern: RegExp, lookback = 200): string | null {
  const labelMatch = labelPattern.exec(text);
  if (!labelMatch) return null;
  const before = text.slice(Math.max(0, labelMatch.index - lookback), labelMatch.index);
  const amounts = [...before.matchAll(/(\d+(?:,\d{3})*\.\d{2})/g)];
  if (!amounts.length) return null;
  const last = amounts[amounts.length - 1];
  return last ? (last[1] ?? null) : null;
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

const BOX_12_LABELS: Record<string, string> = {
  A: "Uncollected SS tax on tips",
  B: "Uncollected Medicare tax on tips",
  C: "Taxable group-term life insurance",
  D: "401(k) elective deferrals",
  E: "403(b) elective deferrals",
  F: "408(k)(6) SEP deferrals",
  G: "457(b) deferrals",
  H: "501(c)(18)(D) deferrals",
  J: "Nontaxable sick pay",
  K: "Excess golden parachute tax",
  L: "Business expense reimbursements",
  M: "Uncollected SS tax on GTL (former employee)",
  N: "Uncollected Medicare tax on GTL (former employee)",
  P: "Excludable moving expense reimbursements",
  Q: "Nontaxable combat pay",
  R: "Archer MSA employer contributions",
  S: "408(p) SIMPLE deferrals",
  T: "Adoption benefits",
  V: "Nonstatutory stock option income",
  W: "HSA employer contributions",
  Y: "409A nonqualified deferred compensation",
  Z: "409A income",
  AA: "Roth 401(k) contributions",
  BB: "Roth 403(b) contributions",
  DD: "Employer-sponsored health coverage cost",
  EE: "Roth 457(b) contributions",
  FF: "QSEHRA permitted benefits",
  GG: "Qualified equity grant income",
  HH: "Aggregate 83(i) deferrals",
  II: "Medicaid waiver payments",
};

// Extract all Box 12 codes from the document.
// ADP format: single-letter or two-letter code followed by tab/space then amount.
// Returns array of { code, amount } pairs.
function findBox12Codes(text: string): Array<{ code: string; amount: string }> {
  const knownCodes = [
    "AA", "BB", "DD", "EE", "FF", "GG", "HH", "II",
    "A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N",
    "P", "Q", "R", "S", "T", "V", "W", "Y", "Z",
  ];
  const results: Array<{ code: string; amount: string }> = [];
  for (const code of knownCodes) {
    const re = new RegExp(`\\b(${code})\\b[\\t ]+(\\d+(?:,\\d{3})*\\.\\d{2})`, "g");
    let m: RegExpExecArray | null;
    if ((m = re.exec(text)) !== null) {
      const amount = m[2] ?? "";
      if (amount && !results.some((r) => r.code === code && r.amount === amount)) {
        results.push({ code, amount });
      }
    }
  }
  return results;
}

// Extract Box 14 "Other" items: freeform employer notes like SUI, SDI, LST.
// ADP format: "9.94 SUI" or "SUI 9.94"
function findBox14Items(text: string): Array<{ label: string; amount: string }> {
  const results: Array<{ label: string; amount: string }> = [];
  // Known labels used in Box 14
  const labels = ["SUI", "SDI", "LST", "SIT", "PFML", "FLI", "VDI", "UI", "DI"];
  for (const label of labels) {
    // Amount before label: "9.94 SUI"
    const before = new RegExp(`(\\d+(?:,\\d{3})*\\.\\d{2})\\s+${label}\\b`, "gi");
    let m = before.exec(text);
    if (m?.[1]) { results.push({ label, amount: m[1] }); continue; }
    // Amount after label: "SUI 9.94"
    const after = new RegExp(`\\b${label}\\b[^\\d]{0,10}(\\d+(?:,\\d{3})*\\.\\d{2})`, "gi");
    m = after.exec(text);
    if (m?.[1]) results.push({ label, amount: m[1] });
  }
  return results;
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
  // Standard IRS label patterns first, then processor-specific (ADP/Paychex) fallbacks.
  const payerName =
    findText(
      text,
      /employer[''s]*\s+name[,\s]+address[^\n]*\n+([^\n]{2,80})/i,
      /c\s+employer[''s]*\s+name[^\n]*\n+([^\n]{2,80})/i,
      /company\s+name[:\s]+([^\n]{3,60})/i,
      /Batch\s*#?\s*\d+\s*\n([^\n\t]{3,60})/i
    ) ?? "";

  // --- Employee name ---
  // Standard IRS labeled patterns first (Gusto, Workday, Ceridian), then ADP all-caps fallback.
  const recipientName =
    findText(
      text,
      /employee[''s]*\s+first\s+name[^\n]*\n+([A-Z][a-zA-Z\-]+(?:\s+[A-Z][a-zA-Z\-]*){1,3})/i,
      /e\/f\s+employee[''s]*\s+name[^\n]*\n+([^\n]{2,60})/i,
      /([A-Z]{2,}(?:\s+[A-Z]{2,}){2,3})\n\d+\.\d{2}/,
      /(?!APPLIED\s+FOR\b)([A-Z]{3,}\s+[A-Z]{3,})\n\d+\.\d{2}/
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
  let wages: string | null = findMoney(
    text,
    /Reported\s+W-?2\s+Wages[^\d]*(?:0\.00\s+)?(\d+(?:,\d{3})*\.\d{2})/i
  );
  if (!wages) wages = findAdpBoxAmount(text, "Box\\s+1\\s+of\\s+W-?2");
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
  const ssWages =
    findAdpBoxAmount(text, "Box\\s+3\\s+of\\s+W-?2") ??
    findMoney(
      text,
      new RegExp(`3\\s+social\\s+security\\s+wages[^\\d\\n]{0,80}${MONEY}`, "i"),
      new RegExp(`social\\s+security\\s+wages[^\\d\\n]{0,80}${MONEY}`, "i")
    ) ?? wages;

  // --- SS tax withheld (Box 4) ---
  // Note: ADP multi-copy layouts often don't embed this value as parseable text.
  const ssTax = findMoney(
    text,
    new RegExp(`4\\s+social\\s+security\\s+tax\\s+withheld[^\\d\\n]{0,80}${MONEY}`, "i"),
    new RegExp(`social\\s+security\\s+tax\\s+withheld[^\\d\\n]{0,80}${MONEY}`, "i")
  );

  // --- Medicare wages (Box 5) ---
  // ADP: amount appears BEFORE "Box 5 of W-2" label in earnings summary
  const medicareWages =
    findAdpAmountBeforeLabel(text, /Box\s+5\s+of\s+W-?2/i) ??
    findAdpBoxAmount(text, "Box\\s+5\\s+of\\s+W-?2") ??
    findMoney(
      text,
      new RegExp(`5\\s+medicare\\s+wages[^\\d\\n]{0,80}${MONEY}`, "i"),
      new RegExp(`medicare\\s+wages\\s+and\\s+tips[^\\d\\n]{0,80}${MONEY}`, "i")
    ) ?? wages;

  // --- Medicare tax withheld (Box 6) ---
  // Note: ADP multi-copy layouts often don't embed this value as parseable text.
  const medicareTax = findMoney(
    text,
    new RegExp(`6\\s+medicare\\s+tax\\s+withheld[^\\d\\n]{0,80}${MONEY}`, "i"),
    new RegExp(`medicare\\s+tax\\s+withheld[^\\d\\n]{0,80}${MONEY}`, "i")
  );

  // --- Box 12 codes ---
  const box12Codes = findBox12Codes(text);

  // --- Box 13 checkboxes ---
  // ADP W-2 text includes these as form labels regardless of whether they're checked,
  // so we can't reliably detect checked state from the text layer.
  // Only flag "Retirement plan" if an explicit indicator (checkbox marker or X) appears nearby.
  const isRetirementPlan = /\bret(?:irement)?\s*plan\s*[xX✓✗]\b/i.test(text);

  // --- Box 14 Other ---
  const box14Items = findBox14Items(text);

  // --- State (Box 15) ---
  const ALL_STATES = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
  const state = findText(text, new RegExp(`\\b(${ALL_STATES})\\b`));

  // --- State wages (Box 16) ---
  // ADP: amount appears BEFORE "Box 16 of W-2" label in earnings summary
  const stateWages =
    findAdpAmountBeforeLabel(text, /Box\s+16\s+of\s+W-?2/i) ??
    findAdpBoxAmount(text, "Box\\s+16\\s+of\\s+W-?2") ??
    findMoney(
      text,
      new RegExp(`16\\s+state\\s+wages[^\\d]{0,80}${MONEY}`, "i"),
      new RegExp(`state\\s+wages[,\\s]+tips[^\\d]{0,80}${MONEY}`, "i")
    );

  // --- State income tax (Box 17) ---
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

  // --- Local wages (Box 18) ---
  // ADP: "Local Wages, <amount>" or amount before "Box 18 of W-2"
  const localWages =
    findAdpAmountBeforeLabel(text, /Box\s+18\s+of\s+W-?2/i) ??
    findMoney(
      text,
      new RegExp(`[Ll]ocal\\s+[Ww]ages[,\\s]+[Tt]ips[^\\d]{0,40}${MONEY}`),
      new RegExp(`[Ll]ocal\\s+[Ww]ages[^\\d]{0,40}${MONEY}`),
      new RegExp(`18\\s+local\\s+wages[^\\d]{0,80}${MONEY}`, "i")
    );

  // --- Local income tax (Box 19) & Locality name (Box 20) ---
  // ADP format: PSD code + city abbrev on one line, then local tax amount on the next.
  // e.g. "700102 PITTS\n425.84"
  let localTax: string | null = null;
  let localityName: string | null = null;
  // [ \t]+ (not \s+) so the separator cannot be a newline — prevents matching "700102\nEMPLOYEE NAME\n14194.65"
  const psdMatch = text.match(/(\d{6}[ \t]+[A-Z]{3,}[^\n]*)\n(\d+(?:,\d{3})*\.\d{2})/);
  if (psdMatch) {
    localityName = psdMatch[1]?.trim() ?? null;
    localTax = psdMatch[2] ?? null;
  }
  // Standard label-based fallbacks
  if (!localTax) {
    localTax = findMoney(
      text,
      new RegExp(`19\\s+local\\s+income\\s+tax[^\\d]{0,80}${MONEY}`, "i"),
      new RegExp(`[Ll]ocal\\s+income\\s+tax[^\\d]{0,80}${MONEY}`)
    );
  }
  if (!localityName) {
    localityName = findText(
      text,
      /[Ll]ocality\s+name[^\n]*\n+([^\n]{2,40})/,
      /20\s+[Ll]ocality[^\n]*\n+([^\n]{2,40})/
    );
  }

  // --- Confidence: 6 required fields ---
  const required = [wages, fedTax, ssTax ?? ssWages, payerEin, recipientName, taxYear];
  const requiredFieldsFound = required.filter(Boolean).length;

  // --- Build fields array ---
  const fields: TaxField[] = [];
  const add = (box: string, label: string, raw: string | null, confidence: TaxField["confidence"] = "high") => {
    const v = formatMoney(raw);
    if (v) fields.push({ box, label, value: v, confidence });
  };
  const addText = (box: string, label: string, value: string | null) => {
    if (value) fields.push({ box, label, value, confidence: "high" });
  };

  add("Box 1", "Wages, tips, other compensation", wages);
  add("Box 2", "Federal income tax withheld", fedTax);
  if (ssWages !== wages) add("Box 3", "Social security wages", ssWages);
  add("Box 4", "Social security tax withheld", ssTax);
  if (medicareWages !== wages) add("Box 5", "Medicare wages and tips", medicareWages);
  add("Box 6", "Medicare tax withheld", medicareTax);

  // Box 12 codes
  for (const { code, amount } of box12Codes) {
    const label = BOX_12_LABELS[code] ?? `Code ${code}`;
    add(`Box 12 – ${code}`, label, amount);
  }

  // Box 13 checkboxes (shown only when a clear indicator is found)
  if (isRetirementPlan) addText("Box 13", "Retirement plan", "Yes");

  // Box 14 Other
  for (const { label, amount } of box14Items) {
    add("Box 14", label, amount);
  }

  // State fields
  if (state && stateWages) add("Box 16", `State (${state}) wages`, stateWages);
  if (state && stateTax) add("Box 17", `State (${state}) income tax`, stateTax);

  // Local fields
  if (localWages) add("Box 18", "Local wages", localWages);
  if (localTax) add("Box 19", "Local income tax", localTax);
  if (localityName) addText("Box 20", "Locality name", localityName);

  // Track boxes that must exist on every W-2 but couldn't be extracted
  const missingFields: MissingField[] = [];
  if (!ssTax) missingFields.push({ box: "Box 4", label: "Social security tax withheld", reason: "Not found in document — verify manually" });
  if (!medicareTax) missingFields.push({ box: "Box 6", label: "Medicare tax withheld", reason: "Not found in document — verify manually" });

  return {
    documentType: "W-2",
    taxYear,
    payerName,
    payerEin,
    recipientName,
    recipientSsn4,
    fields,
    missingFields: missingFields.length > 0 ? missingFields : undefined,
    requiredFieldsFound,
    totalRequiredFields: REQUIRED_COUNT,
  };
}
