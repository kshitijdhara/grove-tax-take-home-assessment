import type { TaxField } from "@/shared/types";
import type { RegexExtractionResult } from "./types";
import { MONEY, findMoney, findText, moneyField } from "./helpers";

const REQUIRED_COUNT = 4;

export function extract1099INT(text: string): RegexExtractionResult {
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

  const interestIncome = findMoney(text,
    new RegExp(`1\\s+interest\\s+income[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`interest\\s+income[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`box\\s*1\\b[^\\d]{0,20}${MONEY}`, "i")
  );

  const earlyWithdrawal = findMoney(text,
    new RegExp(`2\\s+early\\s+withdrawal\\s+penalty[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`early\\s+withdrawal\\s+penalty[^\\d\\n]{0,60}${MONEY}`, "i")
  );

  const usBondInterest = findMoney(text,
    new RegExp(`3\\s+interest\\s+on\\s+u\\.?s\\.?[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`u\\.?s\\.?\\s+savings\\s+bonds?[^\\d\\n]{0,60}${MONEY}`, "i")
  );

  const fedTax = findMoney(text,
    new RegExp(`4\\s+federal\\s+income\\s+tax\\s+withheld[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`federal\\s+income\\s+tax\\s+withheld[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`box\\s*4\\b[^\\d]{0,20}${MONEY}`, "i")
  );

  const taxExemptInterest = findMoney(text,
    new RegExp(`8\\s+tax[- ]exempt\\s+interest[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`tax[- ]exempt\\s+interest[^\\d\\n]{0,60}${MONEY}`, "i")
  );

  const required = [interestIncome, fedTax, payerEin, taxYear];
  const requiredFieldsFound = required.filter(Boolean).length;

  const fields: TaxField[] = [
    moneyField(text, "Box 1", "Interest income", interestIncome),
    moneyField(text, "Box 2", "Early withdrawal penalty", earlyWithdrawal),
    moneyField(text, "Box 3", "Interest on U.S. Savings Bonds", usBondInterest),
    moneyField(text, "Box 4", "Federal income tax withheld", fedTax),
    moneyField(text, "Box 8", "Tax-exempt interest", taxExemptInterest),
  ].filter((field): field is TaxField => field !== null);

  return {
    documentType: "1099-INT",
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
