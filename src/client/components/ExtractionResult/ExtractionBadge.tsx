import type { ExtractionMethod } from "@/shared/types";

interface ExtractionBadgeProps {
  method: ExtractionMethod;
}

export function ExtractionBadge({ method }: ExtractionBadgeProps) {
  return (
    <span className={`extraction-badge extraction-badge--${method}`}>
      {method === "ai" ? "Needs review" : "Auto-verified"}
    </span>
  );
}
