import type { ExtractionMethod } from "@/shared/types";

interface ExtractionBadgeProps {
  method: ExtractionMethod;
}

export function ExtractionBadge({ method }: ExtractionBadgeProps) {
  const title = method === "ai"
    ? "Extracted by AI — values may need manual verification against the source document"
    : "All required fields found by pattern matching — arithmetic consistency checked where applicable, but verify unusual values against the source document";
  return (
    <span className={`extraction-badge extraction-badge--${method}`} title={title}>
      {method === "ai" ? "Needs review" : "Auto-verified"}
    </span>
  );
}
