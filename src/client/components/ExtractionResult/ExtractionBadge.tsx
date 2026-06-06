import type { ExtractionResult } from "@/shared/types";
import { assertNever } from "@/shared/assertNever";
import { needsReview } from "@/shared/confidence";

interface ExtractionBadgeProps {
  result: ExtractionResult;
  reviewComplete?: boolean;
}

export function ExtractionBadge({ result, reviewComplete = false }: ExtractionBadgeProps) {
  if (reviewComplete) {
    return (
      <span
        className="extraction-badge extraction-badge--validated"
        title="All fields verified by preparer."
      >
        Review complete
      </span>
    );
  }

  const review = needsReview(result);

  const title = (() => {
    if (result.aiValidationFailed) {
      return "AI validation failed — pattern matching only. Verify every field manually.";
    }
    if (result.disagreements?.length) {
      return "Pattern matching and AI disagree — pick a value for each highlighted field.";
    }
    switch (result.extractionMethod) {
      case "ai":
        return "Extracted by AI vision — verify every value against the source document.";
      case "validated":
        return review
          ? "Pattern matching and AI validation completed — one or more fields need review."
          : "Pattern matching and AI agree on all extracted fields — still verify against source.";
      case "regex":
        return review
          ? "Pattern matching only — one or more fields need review or manual entry."
          : "Pattern matching found fields — verify unusual values against the source.";
      default:
        return assertNever(result.extractionMethod);
    }
  })();

  const label = (() => {
    if (result.aiValidationFailed) return "AI validation failed";
    if (review) return "Needs review";
    switch (result.extractionMethod) {
      case "ai": return "AI extracted";
      case "validated": return "Pattern + AI agree";
      case "regex": return "Pattern matched";
      default: return assertNever(result.extractionMethod);
    }
  })();

  const className = review || result.aiValidationFailed
    ? "extraction-badge extraction-badge--review"
    : `extraction-badge extraction-badge--${result.extractionMethod}`;

  return (
    <span className={className} title={title}>
      {label}
    </span>
  );
}
