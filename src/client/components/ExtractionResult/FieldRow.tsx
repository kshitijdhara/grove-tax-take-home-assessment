import { useState } from "react";
import type { FieldDisagreement, TaxField } from "@/shared/types";

interface FieldRowProps {
  field: TaxField;
  editedValue?: string;
  verified?: boolean;
  disagreement?: FieldDisagreement;
  onEdit?: (value: string) => void;
  onVerifiedChange?: (verified: boolean) => void;
  onSourceSelect?: (sourceText: string) => void;
  showDisagreement?: boolean;
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

function DisagreementPicker({
  disagreement,
  currentValue,
  onPick,
}: {
  disagreement: FieldDisagreement;
  currentValue: string;
  onPick: (value: string) => void;
}) {
  return (
    <div className="field-row__disagreement-picker" onClick={(e) => e.stopPropagation()}>
      <p className="field-row__disagreement-title">Pattern vs AI — choose value:</p>
      <div className="field-row__disagreement-options">
        <button
          type="button"
          className={`field-row__disagreement-option${currentValue === disagreement.regexValue ? " field-row__disagreement-option--active" : ""}`}
          onClick={() => onPick(disagreement.regexValue)}
        >
          <span className="field-row__disagreement-source">Pattern</span>
          <span className="field-row__disagreement-value">{disagreement.regexValue}</span>
        </button>
        <button
          type="button"
          className={`field-row__disagreement-option${currentValue === disagreement.aiValue ? " field-row__disagreement-option--active" : ""}`}
          onClick={() => onPick(disagreement.aiValue)}
        >
          <span className="field-row__disagreement-source">AI</span>
          <span className="field-row__disagreement-value">{disagreement.aiValue}</span>
        </button>
      </div>
    </div>
  );
}

export function FieldRow({
  field,
  editedValue,
  verified,
  disagreement,
  onEdit,
  onVerifiedChange,
  onSourceSelect,
  showDisagreement,
}: FieldRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const isLow = field.confidence === "low" || showDisagreement;
  const displayValue = editedValue ?? field.value;

  const handleRowClick = () => {
    if (editing) return;
    if (field.sourceText) {
      setExpanded((open) => !open);
      onSourceSelect?.(field.sourceText);
    }
  };

  return (
    <div className={`field-row-wrapper${isLow ? " field-row-wrapper--low" : ""}${verified ? " field-row-wrapper--verified" : ""}`}>
      <div
        className="field-row"
        onClick={handleRowClick}
        style={{ cursor: field.sourceText && !editing ? "pointer" : "default" }}
      >
        {onVerifiedChange && (
          <label className="field-row__verify" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={verified ?? false}
              onChange={(e) => onVerifiedChange(e.target.checked)}
              aria-label={`Mark ${field.label} as verified`}
            />
          </label>
        )}
        <span className="field-row__label">
          {field.box && <span className="field-row__box">{field.box}</span>}
          {field.label}
          {showDisagreement && <span className="field-row__disagreement-badge">AI mismatch</span>}
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
                setExpanded(false);
                setEditing(true);
              }}
            >
              {displayValue || (showDisagreement ? "Pick a value below" : "—")}
              {editedValue && <span className="field-row__edited-badge">edited</span>}
              {onEdit && !editedValue && <span className="field-row__edit-hint" aria-hidden="true">double-click to edit</span>}
            </span>
          )}
          {isLow && (
            <span className="field-row__dot" title="Needs review — verify against source" aria-label="Needs review">●</span>
          )}
          {field.sourceText && !editing && (
            <span className="field-row__chevron" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
          )}
        </span>
      </div>
      {showDisagreement && disagreement && onEdit && (
        <DisagreementPicker
          disagreement={disagreement}
          currentValue={displayValue}
          onPick={(value) => onEdit(value)}
        />
      )}
      {expanded && field.sourceText && (
        <div className="field-row__source">
          <span className="field-row__source-label">Found in:</span>
          <span className="field-row__source-text">{field.sourceText}</span>
        </div>
      )}
    </div>
  );
}
