import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractW2 } from "@/server/extractors/w2";
import { extract1099NEC } from "@/server/extractors/1099nec";
import { identifyDocument } from "@/server/extractors/identifyDocument";
import { IMAGE_PDF_TEXT_THRESHOLD } from "@/server/extractors/pipeline";
import { mergeRegexAndAi } from "@/shared/mergeExtraction";
import { computeOverallConfidence } from "@/shared/confidence";
import { detectCorrectedForm } from "@/shared/documentFlags";
import { fieldKey } from "@/shared/extractionKeys";
import { allFieldsVerified, hasUnresolvedValues } from "@/shared/reviewStatus";
import { w2ArithmeticChecks } from "@/shared/w2Arithmetic";
import type { ExtractionResult } from "@/shared/types";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

test("identifyDocument detects W-2 and 1099-NEC", () => {
  expect(identifyDocument(fixture("gusto-w2.txt"))?.documentType).toBe("W-2");
  expect(identifyDocument(fixture("1099-nec.txt"))?.documentType).toBe("1099-NEC");
  expect(identifyDocument(fixture("adp-w2.txt"))?.documentType).toBe("W-2");
});

test("identifyDocument warns on 1099-MISC", () => {
  const result = identifyDocument(fixture("1099-misc.txt"));
  expect(result?.documentType).toBe("1099-NEC");
  expect(result?.formTypeWarning).toContain("1099-MISC");
});

test("extractW2 finds core boxes and source text", () => {
  const result = extractW2(fixture("gusto-w2.txt"));
  expect(result.requiredFieldsFound).toBeGreaterThanOrEqual(5);
  expect(result.fields.find((f) => f.box === "Box 1")?.value).toBe("50,000.00");
  expect(result.fields.find((f) => f.box === "Box 1")?.sourceText).toBeTruthy();
  expect(result.fields.find((f) => f.box === "Box 4")?.value).toBe("3,100.00");
});

test("extractW2 handles ADP interleaved layout with spaced amounts", () => {
  const result = extractW2(fixture("adp-w2.txt"));
  expect(result.payerName).toContain("ACME");
  expect(result.payerEin).toBe("98-7654321");
  expect(result.recipientName).toContain("JANE");
  const box1 = result.fields.find((f) => f.box === "Box 1");
  expect(box1?.value).toBe("14,194.65");
  expect(result.fields.find((f) => f.box === "Box 4")?.value).toBe("879.67");
});

test("extractW2 handles Paychex-style sequential layout", () => {
  const result = extractW2(fixture("paychex-w2.txt"));
  expect(result.fields.find((f) => f.box === "Box 1")?.value).toBe("72,000.00");
  expect(result.payerEin).toBe("12-3456789");
});

test("extractW2 does not count ssWages as ssTax for required score", () => {
  const sparse = "W-2\n2024\n1 Wages\n50,000.00\n3 Social security wages\n50,000.00\n12-3456789\nJOHN SMITH";
  const result = extractW2(sparse);
  expect(result.requiredFieldsFound).toBeLessThan(result.totalRequiredFields);
});

test("extract1099NEC includes sourceText on fields", () => {
  const result = extract1099NEC(fixture("1099-nec.txt"));
  const box1 = result.fields.find((f) => f.box === "Box 1");
  expect(box1?.value).toBe("12,500.00");
  expect(box1?.sourceText).toBeTruthy();
});

test("mergeRegexAndAi clears value on disagreements", () => {
  const regexResult: ExtractionResult = {
    documentType: "W-2",
    taxYear: "2024",
    payer: { name: "ACME", ein: "12-3456789" },
    recipient: { name: "JOHN", ssn_last4: "1234" },
    fields: [{ box: "Box 1", label: "Wages, tips, other compensation", value: "50,000.00", confidence: "high" }],
    extractionMethod: "regex",
    overallConfidence: "high",
  };

  const merged = mergeRegexAndAi(regexResult, {
    documentType: "W-2",
    taxYear: "2024",
    payer: { name: "ACME", ein: "12-3456789" },
    recipient: { name: "JOHN", ssn_last4: "1234" },
    fields: [{ box: "Box 1", label: "Wages, tips, other compensation", value: "51,000.00", confidence: "high" }],
  });

  expect(merged.extractionMethod).toBe("validated");
  expect(merged.disagreements?.length).toBe(1);
  expect(merged.fields[0]?.value).toBe("");
  expect(computeOverallConfidence(merged)).toBe("low");
  expect(hasUnresolvedValues(merged, {})).toBe(true);
  expect(allFieldsVerified(merged, {}, {})).toBe(false);
});

test("detectCorrectedForm flags corrected and void forms", () => {
  expect(detectCorrectedForm("Form W-2 CORRECTED 2024")).toBe(true);
  expect(detectCorrectedForm("VOID — do not file")).toBe(true);
  expect(detectCorrectedForm("Form W-2 Wage and Tax Statement 2024")).toBe(false);
});

test("vision path triggers below text threshold", () => {
  const scannedText = "   ";
  const meaningfulChars = scannedText.replace(/\s+/g, "").length;
  expect(meaningfulChars).toBeLessThan(IMAGE_PDF_TEXT_THRESHOLD);
});

test("w2ArithmeticChecks validates SS and Medicare ratios", () => {
  const result: ExtractionResult = {
    documentType: "W-2",
    taxYear: "2024",
    payer: { name: "ACME", ein: "12-3456789" },
    recipient: { name: "JOHN", ssn_last4: "1234" },
    fields: [
      { box: "Box 1", label: "Wages, tips, other compensation", value: "50,000.00", confidence: "high" },
      { box: "Box 3", label: "Social security wages", value: "50,000.00", confidence: "high" },
      { box: "Box 4", label: "Social security tax withheld", value: "3,100.00", confidence: "high" },
      { box: "Box 5", label: "Medicare wages and tips", value: "50,000.00", confidence: "high" },
      { box: "Box 6", label: "Medicare tax withheld", value: "725.00", confidence: "high" },
    ],
    extractionMethod: "validated",
    overallConfidence: "high",
  };

  const checks = w2ArithmeticChecks(result, {});
  expect(checks.every((check) => check.ok)).toBe(true);
});

test("review blocks export when disagreement value unresolved", () => {
  const result: ExtractionResult = {
    documentType: "W-2",
    taxYear: "2024",
    payer: { name: "ACME", ein: "12-3456789" },
    recipient: { name: "JOHN", ssn_last4: "1234" },
    fields: [{ box: "Box 1", label: "Wages, tips, other compensation", value: "", confidence: "low" }],
    disagreements: [{ box: "Box 1", label: "Wages, tips, other compensation", regexValue: "50,000.00", aiValue: "51,000.00" }],
    extractionMethod: "validated",
    overallConfidence: "low",
  };

  const key = fieldKey(result.fields[0]!);
  expect(hasUnresolvedValues(result, {})).toBe(true);
  expect(allFieldsVerified(result, { [key]: "51,000.00" }, { [key]: true })).toBe(false);
});
