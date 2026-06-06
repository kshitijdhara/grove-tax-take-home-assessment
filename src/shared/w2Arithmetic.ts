import type { ExtractionResult } from "@/shared/types";
import { fieldKey } from "@/shared/extractionKeys";

export interface W2ArithmeticCheck {
  label: string;
  expected: string;
  actual: string;
  ok: boolean;
}

function parseMoney(value: string): number {
  const n = parseFloat(value.replace(/[$,\s]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

function fieldValue(result: ExtractionResult, box: string, labelIncludes: string, edits: Record<string, string>): string {
  const field = result.fields.find(
    (f) => f.box === box && f.label.toLowerCase().includes(labelIncludes)
  );
  if (!field) return "";
  return edits[fieldKey(field)] ?? field.value;
}

export function w2ArithmeticChecks(result: ExtractionResult, edits: Record<string, string>): W2ArithmeticCheck[] {
  if (result.documentType !== "W-2") return [];

  const box1 = parseMoney(fieldValue(result, "Box 1", "wages", edits));
  const box3 = parseMoney(fieldValue(result, "Box 3", "social security", edits));
  const box4 = parseMoney(fieldValue(result, "Box 4", "social security tax", edits));
  const box5 = parseMoney(fieldValue(result, "Box 5", "medicare", edits));
  const box6 = parseMoney(fieldValue(result, "Box 6", "medicare tax", edits));

  const checks: W2ArithmeticCheck[] = [];

  if (box3 > 0 && box4 > 0) {
    const expected = box3 * 0.062;
    checks.push({
      label: "Box 4 ≈ Box 3 × 6.2%",
      expected: expected.toFixed(2),
      actual: box4.toFixed(2),
      ok: Math.abs(box4 - expected) / box3 <= 0.01,
    });
  }

  if (box5 > 0 && box6 > 0) {
    const expected = box5 * 0.0145;
    checks.push({
      label: "Box 6 ≈ Box 5 × 1.45%",
      expected: expected.toFixed(2),
      actual: box6.toFixed(2),
      ok: Math.abs(box6 - expected) / box5 <= 0.005,
    });
  }

  if (box1 > 0 && box3 > 0) {
    checks.push({
      label: "Box 1 ≈ Box 3 (wages alignment)",
      expected: box1.toFixed(2),
      actual: box3.toFixed(2),
      ok: Math.abs(box1 - box3) / Math.max(box1, box3) <= 0.001,
    });
  }

  return checks;
}
