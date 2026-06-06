import type { TaxField } from "@/shared/types";
import type { RegexExtractionResult } from "./types";
import { MONEY, findMoney, findText } from "./helpers";

const REQUIRED_COUNT = 5;

export function extract1099NEC(text: string): RegexExtractionResult {
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
    /payer[''s]*\s+name[^\n]*\n+([^\n]{2,80})/i,
    /from[:\s]+([^\n]{2,80})/i
  ) ?? "";

  const recipientSsn4 = findText(text,
    /recipient[''s]*\s+(?:tin|ssn)[^a-z\d]*(?:\d{3}[- ]?\d{2}[- ]?|x+[- ]?x+[- ]?)(\d{4})/i,
    /\b(?:xxx|[*]+)[- ]?(?:xx|[*]+)[- ]?(\d{4})\b/i,
    /\b\d{3}-\d{2}-(\d{4})\b/
  ) ?? "";

  const recipientName = findText(text,
    /recipient[''s]*\s+name[^\n]*\n+([^\n]{2,60})/i
  ) ?? "";

  const nonemployeeComp = findMoney(text,
    new RegExp(`1\\s+nonemployee\\s+compensation[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`nonemployee\\s+compensation[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`box\\s*1\\b[^\\d]{0,20}${MONEY}`, "i")
  );

  const fedTax = findMoney(text,
    new RegExp(`4\\s+federal\\s+income\\s+tax\\s+withheld[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`federal\\s+income\\s+tax\\s+withheld[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`box\\s*4\\b[^\\d]{0,20}${MONEY}`, "i")
  );

  const stateTax = findMoney(text,
    new RegExp(`5\\s+state\\s+income\\s+tax\\s+withheld[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`state\\s+income\\s+tax\\s+withheld[^\\d\\n]{0,60}${MONEY}`, "i")
  );

  const stateIncome = findMoney(text,
    new RegExp(`6\\s+state\\s+income[^\\d\\n]{0,60}${MONEY}`, "i"),
    new RegExp(`state\\s+income[^\\d\\n]{0,60}${MONEY}`, "i")
  );

  const required = [nonemployeeComp, fedTax, payerEin, recipientSsn4, taxYear];
  const requiredFieldsFound = required.filter(Boolean).length;

  const fields: TaxField[] = [];
  if (nonemployeeComp) fields.push({ box: "Box 1", label: "Nonemployee compensation", value: nonemployeeComp, confidence: "high" });
  if (fedTax) fields.push({ box: "Box 4", label: "Federal income tax withheld", value: fedTax, confidence: "high" });
  if (stateTax) fields.push({ box: "Box 5", label: "State income tax withheld", value: stateTax, confidence: "high" });
  if (stateIncome) fields.push({ box: "Box 6", label: "State income", value: stateIncome, confidence: "high" });

  return {
    documentType: "1099-NEC",
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
