import type { TaxField } from "@/shared/types";
import type { RegexExtractionResult } from "./types";
import { MONEY, findMoney, findText, moneyField } from "./helpers";

const REQUIRED_COUNT = 4;

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

  const fields: TaxField[] = [
    moneyField(text, "Box 1a", "Total ordinary dividends", totalOrdinaryDiv),
    moneyField(text, "Box 1b", "Qualified dividends", qualifiedDiv),
    moneyField(text, "Box 2a", "Total capital gain distributions", totalCapGain),
    moneyField(text, "Box 2b", "Unrecaptured section 1250 gain", unrecapturedSec1250),
    moneyField(text, "Box 4", "Federal income tax withheld", fedTax),
    moneyField(text, "Box 5", "Section 199A dividends", section199A),
  ].filter((field): field is TaxField => field !== null);

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
