import type { TaxField } from "@/shared/types";
import type { RegexExtractionResult } from "./types";

const MONEY = `\\$?\\s*(\\d+(?:,\\d{3})*\\.\\d{2})`;
const REQUIRED_COUNT = 4;

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

export function extract1099DIV(text: string): RegexExtractionResult {
  const taxYear = findText(text,
    /(?:tax\s+year|calendar\s+year)\s*:?\s*(\d{4})/i,
    /\b(20(?:1[5-9]|2[0-9]))\b/
  ) ?? "";

  const payerEin = findText(text,
    /payer[''s]*\s+(?:tin|federal\s+identification|federal\s+id)[^a-z\d]*(\d{2}-\d{7})/i,
    /\bfein\b[^a-z\d]*(\d{2}-\d{7})/i,
    /\b(\d{2}-\d{7})\b/
  ) ?? "";

  const payerName = findText(text,
    /payer[''s]*\s+name[,\s]+street[^\n]*\n+([^\n]{2,80})/i,
    /payer[''s]*\s+name[^\n]*\n+([^\n]{2,80})/i
  ) ?? "";

  const recipientSsn4 = findText(text,
    /recipient[''s]*\s+(?:tin|ssn)[^a-z\d]*(?:\d{3}[- ]?\d{2}[- ]?|x+[- ]?x+[- ]?)(\d{4})/i,
    /\b(?:xxx|[*]+)[- ]?(?:xx|[*]+)[- ]?(\d{4})\b/i,
    /\b\d{3}-\d{2}-(\d{4})\b/
  ) ?? "";

  const recipientName = findText(text,
    /recipient[''s]*\s+name[^\n]*\n+([^\n]{2,60})/i
  ) ?? "";

  const totalOrdinaryDiv = findMoney(text,
    new RegExp(`1a\\s+total\\s+ordinary\\s+dividends[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`total\\s+ordinary\\s+dividends[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`box\\s*1a\\b[^\\d]{0,20}${MONEY}`, "i")
  );

  const qualifiedDiv = findMoney(text,
    new RegExp(`1b\\s+qualified\\s+dividends[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`qualified\\s+dividends[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`box\\s*1b\\b[^\\d]{0,20}${MONEY}`, "i")
  );

  const totalCapGain = findMoney(text,
    new RegExp(`2a\\s+total\\s+capital\\s+gain[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`total\\s+capital\\s+gain[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`box\\s*2a\\b[^\\d]{0,20}${MONEY}`, "i")
  );

  const unrecapturedSec1250 = findMoney(text,
    new RegExp(`2b\\s+unrecaptured[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`unrecaptured\\s+section\\s+1250[^\\d\\n]{0,60}${MONEY}`, "i")
  );

  const fedTax = findMoney(text,
    new RegExp(`4\\s+federal\\s+income\\s+tax\\s+withheld[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`federal\\s+income\\s+tax\\s+withheld[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`box\\s*4\\b[^\\d]{0,20}${MONEY}`, "i")
  );

  const section199A = findMoney(text,
    new RegExp(`5\\s+section\\s+199a[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`section\\s+199a\\s+dividends[^\\d\\n]{0,60}${MONEY}`, "i")
  );

  const required = [totalOrdinaryDiv, qualifiedDiv, totalCapGain, taxYear];
  const requiredFieldsFound = required.filter(Boolean).length;

  const fields: TaxField[] = [];
  if (totalOrdinaryDiv) fields.push({ box: "Box 1a", label: "Total ordinary dividends", value: totalOrdinaryDiv, confidence: "high" });
  if (qualifiedDiv) fields.push({ box: "Box 1b", label: "Qualified dividends", value: qualifiedDiv, confidence: "high" });
  if (totalCapGain) fields.push({ box: "Box 2a", label: "Total capital gain distributions", value: totalCapGain, confidence: "high" });
  if (unrecapturedSec1250) fields.push({ box: "Box 2b", label: "Unrecaptured section 1250 gain", value: unrecapturedSec1250, confidence: "high" });
  if (fedTax) fields.push({ box: "Box 4", label: "Federal income tax withheld", value: fedTax, confidence: "high" });
  if (section199A) fields.push({ box: "Box 5", label: "Section 199A dividends", value: section199A, confidence: "high" });

  return {
    documentType: "1099-DIV",
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
