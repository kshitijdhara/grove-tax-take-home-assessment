import type { ConfidenceLevel, ExtractionResult } from "@/shared/types";

export function computeOverallConfidence(
  result: Pick<ExtractionResult, "fields" | "missingFields" | "disagreements">
): ConfidenceLevel {
  if (result.missingFields && result.missingFields.length > 0) return "low";
  if (result.disagreements && result.disagreements.length > 0) return "low";
  if (result.fields.some((field) => field.confidence === "low")) return "low";
  return "high";
}

export function needsReview(result: ExtractionResult): boolean {
  return computeOverallConfidence(result) === "low" || result.overallConfidence === "low";
}
