import { useState } from "react";
import type { TaxField } from "@/shared/types";

interface FieldRowProps {
  field: TaxField;
  editedValue?: string;
  onEdit?: (value: string) => void;
}

function CopyValueButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={`field-row__copy${copied ? " field-row__copy--done" : ""}`}
      onClick={async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title="Copy value"
    >
      {copied ? "✓" : "⎘"}
    </button>
  );
}

export function FieldRow({ field, editedValue, onEdit }: FieldRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const isLow = field.confidence === "low";
  const displayValue = editedValue ?? field.value;

  return (
    <div className={`field-row-wrapper${isLow ? " field-row-wrapper--low" : ""}`}>
      <div
        className="field-row"
        onClick={() => !editing && field.sourceText && setExpanded(e => !e)}
        style={{ cursor: field.sourceText && !editing ? "pointer" : "default" }}
      >
        <span className="field-row__label">
          {field.box && <span className="field-row__box">{field.box}</span>}
          {field.label}
        </span>
        <span className="field-row__value">
          <CopyValueButton value={displayValue} />
          {editing ? (
            <input
              className="field-row__value-input"
              defaultValue={displayValue}
              onBlur={(e) => { onEdit?.(e.target.value); setEditing(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { onEdit?.(e.currentTarget.value); setEditing(false); }
                if (e.key === "Escape") setEditing(false);
              }}
              autoFocus
            />
          ) : (
            <span
              className={`field-row__value-display${editedValue ? " field-row__value-display--edited" : ""}`}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setExpanded(false); // collapse source panel when entering edit mode
                setEditing(true);
              }}
            >
              {displayValue}
              {editedValue && <span className="field-row__edited-badge">edited</span>}
              {onEdit && !editedValue && <span className="field-row__edit-hint" aria-hidden="true">✎</span>}
            </span>
          )}
          {isLow && (
            <span className="field-row__dot" title="Low confidence — verify" aria-label="Low confidence">●</span>
          )}
          {field.sourceText && !editing && (
            <span className="field-row__chevron" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          )}
        </span>
      </div>
      {expanded && field.sourceText && (
        <div className="field-row__source">
          <span className="field-row__source-label">Found in:</span>
          <span className="field-row__source-text">{field.sourceText}</span>
        </div>
      )}
    </div>
  );
}
