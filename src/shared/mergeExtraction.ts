import type { ExtractedData } from "@/shared/parseExtraction";
import { computeOverallConfidence } from "@/shared/confidence";
import { fieldKey } from "@/shared/extractionKeys";
import type { ExtractionResult, FieldDisagreement, TaxField } from "@/shared/types";

function normalizeValue(value: string): string {
  const n = parseFloat(value.replace(/[$,\s]/g, ""));
  if (!Number.isNaN(n)) return n.toFixed(2);
  return value.trim().toLowerCase();
}

function valuesAgree(a: string, b: string): boolean {
  const na = normalizeValue(a);
  const nb = normalizeValue(b);
  if (na === nb) return true;
  const fa = parseFloat(na);
  const fb = parseFloat(nb);
  if (!Number.isNaN(fa) && !Number.isNaN(fb)) return Math.abs(fa - fb) < 0.01;
  return false;
}

function pickRicherField(regexField: TaxField, aiField: TaxField): TaxField {
  const confidence = valuesAgree(regexField.value, aiField.value) ? "high" : "low";
  return {
    ...regexField,
    value: regexField.value,
    confidence,
    sourceText: regexField.sourceText ?? aiField.sourceText,
  };
}

export function mergeRegexAndAi(
  regexResult: ExtractionResult,
  aiData: ExtractedData
): ExtractionResult {
  const aiByKey = new Map(aiData.fields.map((field) => [fieldKey(field), field]));
  const disagreements: FieldDisagreement[] = [];
  const mergedFields: TaxField[] = regexResult.fields.map((regexField) => {
    const aiField = aiByKey.get(fieldKey(regexField));
    if (!aiField) return regexField;
    aiByKey.delete(fieldKey(regexField));
    if (!valuesAgree(regexField.value, aiField.value)) {
      disagreements.push({
        box: regexField.box,
        label: regexField.label,
        regexValue: regexField.value,
        aiValue: aiField.value,
      });
    }
    return pickRicherField(regexField, aiField);
  });

  const aiOnlyFields = [...aiByKey.values()].map((field) => ({
    ...field,
    confidence: "low" as const,
  }));

  const fields = [...mergedFields, ...aiOnlyFields];
  const payer = {
    name: regexResult.payer.name || aiData.payer.name,
    ein: regexResult.payer.ein || aiData.payer.ein,
  };
  const recipient = {
    name: regexResult.recipient.name || aiData.recipient.name,
    ssn_last4: regexResult.recipient.ssn_last4 || aiData.recipient.ssn_last4,
  };

  const base = {
    documentType: regexResult.documentType,
    taxYear: regexResult.taxYear || aiData.taxYear,
    payer,
    recipient,
    fields,
    missingFields: regexResult.missingFields,
    ...(disagreements.length > 0 ? { disagreements } : {}),
    extractionMethod: "validated" as const,
  };

  const warningParts: string[] = [];
  if (disagreements.length > 0) {
    warningParts.push(
      `${disagreements.length} field(s) disagree between pattern matching and AI — review highlighted rows.`
    );
  }

  return {
    ...base,
    overallConfidence: computeOverallConfidence(base),
    ...(warningParts.length > 0 ? { warning: warningParts.join(" ") } : {}),
  };
}
