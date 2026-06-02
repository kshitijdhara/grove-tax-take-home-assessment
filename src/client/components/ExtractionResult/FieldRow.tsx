import type { TaxField } from "@/shared/types";

interface FieldRowProps {
  field: TaxField;
}

export function FieldRow({ field }: FieldRowProps) {
  const isLow = field.confidence === "low";
  return (
    <div className={`field-row${isLow ? " field-row--low-confidence" : ""}`}>
      <span className="field-row__label">
        {field.box && <span className="field-row__box">{field.box}</span>}
        {field.label}
      </span>
      <span className="field-row__value">
        {field.value}
        {isLow && (
          <span className="field-row__dot" title="Low confidence — consider verifying" aria-label="Low confidence">
            ●
          </span>
        )}
      </span>
    </div>
  );
}
