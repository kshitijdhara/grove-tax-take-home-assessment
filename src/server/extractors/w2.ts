import type { TaxField, MissingField } from "@/shared/types";
import type { RegexExtractionResult } from "./types";
import { MONEY, findMoney, findText, formatMoney, captureContext } from "./helpers";

// ─── Layout-agnostic helpers ──────────────────────────────────────────────────
//
// These helpers describe HOW to find a value given a particular PDF layout
// pattern, NOT which payroll processor produced the document. They are run
// unconditionally on every W-2. If a pattern doesn't match the document's
// layout it simply returns null and the next strategy is tried.
//
// Layout patterns that exist in the wild:
//   "sequential"    – label then value on the same or next line (Gusto, Workday, Ceridian…)
//   "reversed"      – value appears BEFORE its label (some ADP, Paychex multi-section)
//   "space-sep"     – amounts written as "14 194 65" not "14,194.65" (ADP multi-copy)
//   "interleaved"   – multi-copy W-2 repeats the same pair: A\nB\tA\tB\tA (ADP 3-up)
//   "psd"           – PSD locality code prefixed to city name "700102 PITTSBURGH" (PA)

// Amounts written as space-separated digits: "14 194 65" → "14,194.65"
// Common in multi-copy payroll layouts where commas would confuse column alignment.
function findSpaceSeparatedAmount(text: string, labelPattern: string): string | null {
  const re = new RegExp(
    `${labelPattern}[^\\d]{0,80}(\\d{1,3})\\s+(\\d{3})\\s+(\\d{2})(?!\\d)`,
    "i"
  );
  const m = text.match(re);
  if (m?.[1] && m[2] && m[3]) return `${m[1]},${m[2]}.${m[3]}`;
  return null;
}

// Finds the last monetary amount within `lookback` characters BEFORE a label.
// Used when a layout places totals above the label that describes them.
function findAmountBeforeLabel(text: string, labelPattern: RegExp, lookback = 200): string | null {
  const labelMatch = labelPattern.exec(text);
  if (!labelMatch) return null;
  const before = text.slice(Math.max(0, labelMatch.index - lookback), labelMatch.index);
  const amounts = [...before.matchAll(/(\d+(?:,\d{3})*\.\d{2})/g)];
  const last = amounts[amounts.length - 1];
  return last ? (last[1] ?? null) : null;
}

// Multi-copy W-2 interleaved pattern: A\nB \tA \tB \tA
// Three-way repetition identifies the pair — smaller value is tax, larger is wages.
function findInterleavedValues(text: string): { fedTax: string | null; wages: string | null } {
  const m = text.match(
    /(\d+(?:,\d{3})*\.\d{2})\n(\d+(?:,\d{3})*\.\d{2})\s+\1\s+\2\s+\1/
  );
  if (!m?.[1] || !m[2]) return { fedTax: null, wages: null };
  const a = parseFloat(m[1].replace(",", ""));
  const b = parseFloat(m[2].replace(",", ""));
  return a < b ? { fedTax: m[1], wages: m[2] } : { fedTax: m[2], wages: m[1] };
}

// ─── Box 12 label lookup ──────────────────────────────────────────────────────

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

function findBox12Codes(text: string): Array<{ code: string; amount: string }> {
  const knownCodes = [
    "AA", "BB", "DD", "EE", "FF", "GG", "HH", "II",
    "A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N",
    "P", "Q", "R", "S", "T", "V", "W", "Y", "Z",
  ];
  const results: Array<{ code: string; amount: string }> = [];
  for (const code of knownCodes) {
    const re = new RegExp(`\\b(${code})\\b[\\t ]+(\\d+(?:,\\d{3})*\\.\\d{2})`, "g");
    const match = re.exec(text);
    if (match !== null) {
      const amount = match[2] ?? "";
      if (amount && !results.some((r) => r.code === code && r.amount === amount)) {
        results.push({ code, amount });
      }
    }
  }
  return results;
}

function findBox14Items(text: string): Array<{ label: string; amount: string }> {
  const results: Array<{ label: string; amount: string }> = [];
  const labels = ["SUI", "SDI", "LST", "SIT", "PFML", "FLI", "VDI", "UI", "DI"];
  for (const label of labels) {
    const before = new RegExp(`(\\d+(?:,\\d{3})*\\.\\d{2})\\s+${label}\\b`, "gi");
    const beforeMatch = before.exec(text);
    if (beforeMatch?.[1]) { results.push({ label, amount: beforeMatch[1] }); continue; }
    const after = new RegExp(`\\b${label}\\b[^\\d]{0,10}(\\d+(?:,\\d{3})*\\.\\d{2})`, "gi");
    const afterMatch = after.exec(text);
    if (afterMatch?.[1]) results.push({ label, amount: afterMatch[1] });
  }
  return results;
}

function resolveLocalityName(text: string, localityCode: string, baseName: string): string {
  if (baseName.replace(/\s/g, "").length > 8) return baseName;
  return text.match(
    new RegExp(`\\b${localityCode}\\n([A-Z][A-Z ]+[A-Z])\\s+[A-Z]{2}\\s+\\d{5}`)
  )?.[1]?.trim() ?? baseName;
}

function extractPsdLocality(text: string): {
  localTax: string | null;
  localityCode: string | null;
  localityName: string | null;
} | null {
  const psdMatch = text.match(/(\d{6})[ \t]+([A-Z]{3,}[^\n]*)(?:\n([A-Z]{2,12}))?\n(\d+(?:,\d{3})*\.\d{2})/);
  if (!psdMatch) return null;

  const localityCode = psdMatch[1] ?? null;
  const part1 = psdMatch[2]?.trim() ?? "";
  const part2 = psdMatch[3]?.trim() ?? "";
  const baseName = part2 ? `${part1}${part2}` : part1 || null;
  const localTax = psdMatch[4] ?? null;

  const localityName =
    localityCode && baseName
      ? resolveLocalityName(text, localityCode, baseName)
      : baseName;

  return { localTax, localityCode, localityName };
}

// ─── Main extractor ───────────────────────────────────────────────────────────

const REQUIRED_COUNT = 6;

export function extractW2(text: string): RegexExtractionResult {

  // --- Tax year ---
  const taxYear =
    findText(
      text,
      /(?:tax\s+year|calendar\s+year)\s*:?\s*(\d{4})/i,
      /\b(20(?:1[5-9]|2[0-9]))\b/
    ) ?? "";

  // --- Control number (Box d) ---
  // Only extract when the value is clearly alphanumeric and not a label line.
  // ADP W-2s place "d Control number" in the same label row as other headers,
  // so the following line is often another label, not an actual control number.
  const controlNumber = findText(text,
    /\bd\s+control\s+number[^\n]*\n+([A-Z0-9]{3,20})\s*\n/i
  );

  // --- Employer EIN (Box b) ---
  const payerEin =
    findText(
      text,
      /(?:employer|payer)[''s]*\s+(?:fed\s+id|federal\s+id|identification|ein)[^a-z\d]*(\d{2}-\d{7})/i,
      /\b(\d{2}-\d{7})\b/
    ) ?? "";

  // --- Employer name (Box c) ---
  // Strategies ordered most-to-least reliable.
  // The "Batch #NNNNN" anchor is not ADP-specific gating — it is simply the last
  // resort for any layout where the employer section has that header structure.
  const payerName =
    findText(
      text,
      /employer[''s]*\s+name[,\s]+address[^\n]*\n+([^\n]{2,80})/i,   // IRS standard label
      /c\s+employer[''s]*\s+name[^\n]*\n+([^\n]{2,80})/i,             // Box c short label
      /company\s+name[:\s]+([^\n]{3,60})/i,                            // "Company name:" style
      /Batch\s*#?\s*\d+\s*\n([^\n\t]{3,60})/i                         // batch-header layout
    ) ?? "";

  // --- Employer address (Box c, continuation) ---
  // Must be a line that looks like a street address (starts with a number).
  // Strips tab-duplicated values produced by multi-copy PDF layouts.
  const payerAddressRaw = findText(text,
    /employer[''s]*\s+name[,\s]+address[^\n]*\n+[^\n]{2,80}\n+(\d+[^\n]{5,70})/i,
    /Batch\s*#?\s*\d+\s*\n[^\n]+\n(\d+[^\n]{5,70})/i
  );
  const payerAddress = payerAddressRaw ? payerAddressRaw.split(/\t/)[0]?.trim() ?? null : null;

  // --- Employee name (Box e) ---
  // Standard labeled patterns first, then positional heuristics for unlabeled layouts.
  // The all-caps + trailing-amount heuristic works for any layout where the employee
  // name appears immediately above a dollar amount — not just ADP.
  const recipientName =
    findText(
      text,
      /employee[''s]*\s+first\s+name[^\n]*\n+([A-Z][a-zA-Z\-]+(?:\s+[A-Z][a-zA-Z\-]*){1,3})/i,
      /e\/f\s+employee[''s]*\s+name[^\n]*\n+([^\n]{2,60})/i,
      /([A-Z]{2,}(?:\s+[A-Z]{2,}){2,3})\n\d+\.\d{2}/,
      /(?!APPLIED\s+FOR\b)([A-Z]{3,}\s+[A-Z]{3,})\n\d+\.\d{2}/
    ) ?? "";

  // --- Employee address (Box f) ---
  // Only use the explicit IRS label pattern — the positional heuristic (name above street)
  // was matching the employer's address, not the employee's.
  const recipientAddressRaw = findText(text,
    /employee[''s]*\s+address[^\n]*\n+([^\n]{5,80})/i
  );
  const recipientAddress = recipientAddressRaw ? recipientAddressRaw.split(/\t/)[0]?.trim() ?? null : null;

  // --- SSN last 4 ---
  // "APPLIED FOR" is a valid W-2 state when the employee hasn't been issued an SSN yet.
  const ssnAppliedFor = /\bapplied\s+for\b/i.test(text);
  const recipientSsn4 =
    findText(
      text,
      /employee[''s]*\s+(?:ssn|social\s+security)[^a-z\d]*(?:xxx|[•●*]+)[^a-z\d]*(\d{4})/i,
      /\b(?:xxx|[•●*]+)[- ]?(?:xx|[•●*]+)[- ]?(\d{4})\b/i,
      /\b\d{3}-\d{2}-(\d{4})\b/,
      /\b0{3}-0{2}-(\d{4})\b/
    ) ?? (ssnAppliedFor ? "APPLIED FOR" : "");

  // --- Wages (Box 1) ---
  // Strategy order: reversed-layout marker → space-separated format → IRS label → box number
  const wagesFromPatterns =
    findMoney(text, /Reported\s+W-?2\s+Wages[^\d]*(?:0\.00\s+)?(\d+(?:,\d{3})*\.\d{2})/i) ??
    findSpaceSeparatedAmount(text, "Box\\s+1\\s+of\\s+W-?2") ??
    findMoney(
      text,
      new RegExp(`1\\s+wages[,\\s]+tips[,\\s]+other\\s+comp\\w*[^\\d\\n]{0,80}${MONEY}`, "i"),
      new RegExp(`wages[,\\s]+tips[,\\s]+other\\s+comp\\w*[^\\d\\n]{0,80}${MONEY}`, "i"),
      new RegExp(`box\\s*1\\b[^a-z\\d]{0,30}${MONEY}`, "i")
    );

  const fedTaxFromPatterns = findMoney(
    text,
    new RegExp(`2\\s+federal\\s+income\\s+tax\\s+withheld[^\\d\\n]{0,80}${MONEY}`, "i"),
    new RegExp(`federal\\s+income\\s+tax\\s+withheld[^\\d\\n]{0,80}${MONEY}`, "i"),
    new RegExp(`box\\s*2\\b[^a-z\\d]{0,20}${MONEY}`, "i")
  );

  const interleavedPair =
    wagesFromPatterns && fedTaxFromPatterns ? null : findInterleavedValues(text);

  const wages = wagesFromPatterns ?? interleavedPair?.wages ?? null;
  const fedTax = fedTaxFromPatterns ?? interleavedPair?.fedTax ?? null;

  // --- SS wages (Box 3) ---
  const ssWages =
    findSpaceSeparatedAmount(text, "Box\\s+3\\s+of\\s+W-?2") ??
    findMoney(
      text,
      new RegExp(`3\\s+social\\s+security\\s+wages[^\\d\\n]{0,80}${MONEY}`, "i"),
      new RegExp(`social\\s+security\\s+wages[^\\d\\n]{0,80}${MONEY}`, "i")
    );

  // --- SS tax withheld (Box 4) ---
  const ssTax =
    findAmountBeforeLabel(text, /Box\s+4\s+of\s+W-?2/i) ??
    findMoney(
      text,
      new RegExp(`4\\s+social\\s+security\\s+tax\\s+withheld[^\\d\\n]{0,80}${MONEY}`, "i"),
      new RegExp(`social\\s+security\\s+tax\\s+withheld[^\\d\\n]{0,80}${MONEY}`, "i")
    );

  // --- Medicare wages (Box 5) ---
  const medicareWages =
    findAmountBeforeLabel(text, /Box\s+5\s+of\s+W-?2/i) ??
    findSpaceSeparatedAmount(text, "Box\\s+5\\s+of\\s+W-?2") ??
    findMoney(
      text,
      new RegExp(`5\\s+medicare\\s+wages[^\\d\\n]{0,80}${MONEY}`, "i"),
      new RegExp(`medicare\\s+wages\\s+and\\s+tips[^\\d\\n]{0,80}${MONEY}`, "i")
    );

  // --- Medicare tax withheld (Box 6) ---
  const medicareTax =
    findAmountBeforeLabel(text, /Box\s+6\s+of\s+W-?2/i) ??
    findMoney(
      text,
      new RegExp(`6\\s+medicare\\s+tax\\s+withheld[^\\d\\n]{0,80}${MONEY}`, "i"),
      new RegExp(`medicare\\s+tax\\s+withheld[^\\d\\n]{0,80}${MONEY}`, "i")
    );

  // --- Dependent care benefits (Box 10) ---
  const dependentCare = findMoney(text,
    new RegExp(`10\\s+dependent\\s+care[^\\d\\n]{0,80}${MONEY}`, "i"),
    new RegExp(`dependent\\s+care\\s+benefits[^\\d\\n]{0,80}${MONEY}`, "i")
  );

  // --- Nonqualified plans (Box 11) ---
  const nonqualifiedPlans = findMoney(text,
    new RegExp(`11\\s+nonqualified[^\\d\\n]{0,80}${MONEY}`, "i"),
    new RegExp(`nonqualified\\s+(?:deferred|plans)[^\\d\\n]{0,80}${MONEY}`, "i")
  );

  // --- Box 12 codes ---
  const box12Codes = findBox12Codes(text);

  // --- Box 13 checkboxes ---
  // Only flag "Retirement plan" if an explicit checked indicator (X / checkmark) is present.
  const isRetirementPlan = /\bret(?:irement)?\s*plan\s*[xX✓✗]\b/i.test(text);

  // --- Box 14 Other ---
  const box14Items = findBox14Items(text);

  // --- State (Box 15) ---
  // Priority: state-section anchor > Box 15 inline > state wages label > ZIP-anchored address.
  // ZIP-anchored is last — it matches the employer's address state (e.g. CA) which differs
  // from the employee's work state (e.g. PA) on remote-worker W-2s.
  // NOTE: "\bstate[ \t]+(STATE)" is intentionally absent — it matches "state ID no." labels.
  const ALL_STATES = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";

  // State code as a Box 15 value always starts its own line in payroll PDFs.
  // "ID" inside "Employer's state ID no." is mid-line and never matches ^.
  // Using multiline flag (m) so ^ anchors to any line start.
  const state = findText(text,
    new RegExp(`^(${ALL_STATES})[ \\t]+\\d{2}-\\d{5,}`, "m"),             // line-start: "PA  77-0332939-000"
    new RegExp(`^(${ALL_STATES})[ \\t]*$`, "m"),                           // line-start: "PA" alone
    new RegExp(`\\b15[ \\t]+(${ALL_STATES})\\b`),                          // "15 PA" inline
    new RegExp(`state\\s+wages[^\\n]{0,80}\\b(${ALL_STATES})\\b`, "i"),   // state on wages label line
    new RegExp(`\\b(${ALL_STATES})[ \\t]+\\d{5}(?:-\\d{4})?\\b`)          // last resort: ZIP-anchored
  );

  // --- Employer state ID (Box 15, second field) ---
  // Require at least 5 characters to avoid matching "no", "id", abbreviations from labels.
  const employerStateId = findText(text,
    /employer[''s]*\s+state\s+id(?:\s+(?:number|no\.?))?[^\n]*\n+([A-Za-z0-9\-]{5,20})/i
  );

  // --- State wages (Box 16) ---
  const stateWages =
    findAmountBeforeLabel(text, /Box\s+16\s+of\s+W-?2/i) ??
    findSpaceSeparatedAmount(text, "Box\\s+16\\s+of\\s+W-?2") ??
    findMoney(
      text,
      new RegExp(`16\\s+state\\s+wages[^\\d]{0,80}${MONEY}`, "i"),
      new RegExp(`state\\s+wages[,\\s]+tips[^\\d]{0,80}${MONEY}`, "i")
    );

  // --- State income tax (Box 17) ---
  // Deliberately omitting the "${state}[^\d]{0,40}" pattern — a 2-letter abbreviation
  // appears too frequently in W-2 text (EIN labels, addresses, acronyms) and causes
  // false matches. The IRS label patterns are reliable enough without it.
  const stateTax = findMoney(
    text,
    new RegExp(`17\\s+state\\s+income\\s+tax[^\\d]{0,80}${MONEY}`, "i"),
    new RegExp(`state\\s+income\\s+tax\\s+withheld[^\\d]{0,80}${MONEY}`, "i"),
    new RegExp(`state\\s+income\\s+tax[^\\d]{0,80}${MONEY}`, "i")
  );

  // --- Local wages (Box 18) ---
  // The "Local Wages," text pattern is intentionally omitted — it matches the ADP earnings
  // summary at the top of the document (gross local wages), not the W-2 box value.
  // findAmountBeforeLabel with 500-char lookback correctly finds the last decimal amount
  // before "Box 18 of W-2", which is the actual box value (~400 chars before the label).
  const localWages =
    findAmountBeforeLabel(text, /Box\s+18\s+of\s+W-?2/i, 500) ??
    findMoney(text, new RegExp(`18\\s+local\\s+wages[^\\d]{0,80}${MONEY}`, "i"));

  // --- Local income tax (Box 19) & Locality name/code (Box 20) ---
  // PSD codes (6-digit locality codes) appear in Pennsylvania W-2s from multiple processors.
  // Some PDF renderers split locality names mid-word (e.g. "PITTS\nBURGH") — the optional
  // continuation group joins them without a space.
  const psdLocality = extractPsdLocality(text);
  const localTax =
    psdLocality?.localTax ??
    findMoney(
      text,
      new RegExp(`19\\s+local\\s+income\\s+tax[^\\d]{0,80}${MONEY}`, "i"),
      new RegExp(`[Ll]ocal\\s+income\\s+tax[^\\d]{0,80}${MONEY}`)
    );
  const localityCode = psdLocality?.localityCode ?? null;
  const localityName =
    psdLocality?.localityName ??
    findText(
      text,
      /[Ll]ocality\s+name[^\n]*\n+([^\n]{2,40})/,
      /20\s+[Ll]ocality[^\n]*\n+([^\n]{2,40})/
    );

  // --- Confidence: 6 required fields ---
  const required = [wages, fedTax, ssTax ?? ssWages, payerEin, recipientName, taxYear];
  const requiredFieldsFound = required.filter(Boolean).length;

  // --- Build fields array ---
  const fields: TaxField[] = [];
  const add = (box: string, label: string, raw: string | null, confidence: TaxField["confidence"] = "high") => {
    const v = formatMoney(raw);
    if (v) fields.push({ box, label, value: v, confidence,
      sourceText: raw ? captureContext(text, raw) : undefined });
  };
  const addText = (box: string, label: string, value: string | null) => {
    if (value) fields.push({ box, label, value, confidence: "high",
      sourceText: captureContext(text, value) });
  };

  if (controlNumber)    addText("Box d", "Control number",   controlNumber);
  if (payerAddress)     addText("Box c", "Employer address", payerAddress);
  if (recipientAddress) addText("Box f", "Employee address", recipientAddress);

  add("Box 1",  "Wages, tips, other compensation", wages);
  add("Box 2",  "Federal income tax withheld",     fedTax);
  add("Box 3",  "Social security wages",           ssWages);
  add("Box 4",  "Social security tax withheld",    ssTax);
  add("Box 5",  "Medicare wages and tips",         medicareWages);
  add("Box 6",  "Medicare tax withheld",           medicareTax);
  add("Box 10", "Dependent care benefits",         dependentCare);
  add("Box 11", "Nonqualified plans",              nonqualifiedPlans);

  for (const { code, amount } of box12Codes) {
    add(`Box 12 – ${code}`, BOX_12_LABELS[code] ?? `Code ${code}`, amount);
  }

  if (isRetirementPlan) addText("Box 13", "Retirement plan", "Yes");

  for (const { label, amount } of box14Items) {
    add("Box 14", label, amount);
  }

  if (state)           addText("Box 15", "State",             state);
  if (employerStateId) addText("Box 15", "Employer state ID", employerStateId);
  if (stateWages)      add("Box 16", state ? `State (${state}) wages`      : "State wages",      stateWages);
  if (stateTax)        add("Box 17", state ? `State (${state}) income tax` : "State income tax", stateTax);
  if (localWages)      add("Box 18", "Local wages",       localWages);
  if (localTax)        add("Box 19", "Local income tax",  localTax);
  if (localityCode)    addText("Box 20", "Locality code", localityCode);
  if (localityName)    addText("Box 20", "Locality name", localityName);

  // IRS rate validation: Box 4 = Box 3 × 6.2%, Box 6 = Box 5 × 1.45%
  // If a found value is implausible, downgrade confidence rather than trust it silently.
  const box3f = fields.find(f => f.box === "Box 3");
  const box4f = fields.find(f => f.box === "Box 4");
  if (box3f && box4f) {
    const r = parseFloat(box4f.value.replace(/,/g, "")) / parseFloat(box3f.value.replace(/,/g, ""));
    if (Math.abs(r - 0.062) > 0.01) box4f.confidence = "low";
  }
  const box5f = fields.find(f => f.box === "Box 5");
  const box6f = fields.find(f => f.box === "Box 6");
  if (box5f && box6f) {
    const r = parseFloat(box6f.value.replace(/,/g, "")) / parseFloat(box5f.value.replace(/,/g, ""));
    if (Math.abs(r - 0.0145) > 0.005) box6f.confidence = "low";
  }

  const missingFields: MissingField[] = [];
  if (!ssTax)       missingFields.push({ box: "Box 4", label: "Social security tax withheld", reason: "Not found in document — verify manually" });
  if (!medicareTax) missingFields.push({ box: "Box 6", label: "Medicare tax withheld",        reason: "Not found in document — verify manually" });

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
