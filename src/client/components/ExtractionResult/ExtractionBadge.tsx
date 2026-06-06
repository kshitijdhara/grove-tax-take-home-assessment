import type { ExtractionResult } from "@/shared/types";
import { assertNever } from "@/shared/assertNever";
import { needsReview } from "@/shared/confidence";

interface ExtractionBadgeProps {
  result: ExtractionResult;
}

export function ExtractionBadge({ result }: ExtractionBadgeProps) {
  const review = needsReview(result);

  const title = (() => {
    if (result.disagreements?.length) {
      return "Pattern matching and AI disagree on one or more fields — verify against the source document.";
    }
    switch (result.extractionMethod) {
      case "ai":
        return "Extracted by AI vision — verify every value against the source document.";
      case "validated":
        return review
          ? "Pattern matching and AI validation completed — one or more fields need review."
          : "Pattern matching and AI validation agree on all extracted fields.";
      case "regex":
        return review
          ? "Pattern matching only — one or more fields need review or manual entry."
          : "Pattern matching found all required fields — verify unusual values against the source.";
      default:
        return assertNever(result.extractionMethod);
    }
  })();

  const label = (() => {
    if (review) return "Needs review";
    switch (result.extractionMethod) {
      case "ai": return "AI extracted";
      case "validated": return "Validated";
      case "regex": return "Pattern matched";
      default: return assertNever(result.extractionMethod);
    }
  })();

  const className = review
    ? "extraction-badge extraction-badge--review"
    : `extraction-badge extraction-badge--${result.extractionMethod}`;

  return (
    <span className={className} title={title}>
      {label}
    </span>
  );
}
