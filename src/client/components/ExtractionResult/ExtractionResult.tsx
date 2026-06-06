import "./ExtractionResult.css";
import { useMemo, useState } from "react";
import type { DocumentType, ExtractionResult, FieldDisagreement, MissingField, TaxField } from "@/shared/types";
import { META_KEYS, fieldKey } from "@/shared/extractionKeys";
import { applyEditsToResult } from "@/shared/resolvedResult";
import {
  buildCopyAllText,
  buildDrakeW2Csv,
  buildRowCsv,
  buildVerticalCsv,
  downloadText,
  exportFilename,
  type ExportSignOff,
} from "@/shared/exportFormats";
import { allFieldsVerified, reviewKeysForResult, unverifiedFieldLabels, unverifiedLowConfidenceCount, verifiedCount } from "@/shared/reviewStatus";
import { w2ArithmeticChecks } from "@/shared/w2Arithmetic";
import { DocumentHeader } from "./DocumentHeader";
import { FieldRow } from "./FieldRow";
import { ExtractionBadge } from "./ExtractionBadge";
import { PdfViewer } from "../PdfViewer/PdfViewer";

type ViewMode = "fields" | "json";
type ExportPreset = "vertical" | "row" | "drake-w2" | "copy-all";

interface PartyLabels {
  payerSection: string;
  recipientSection: string;
  fieldsSection: string;
}

function partyLabels(documentType: DocumentType): PartyLabels {
  if (documentType === "W-2") {
    return {
      payerSection: "Employer",
      recipientSection: "Employee",
      fieldsSection: "Compensation & Taxes",
    };
  }
  return {
    payerSection: "Payer",
    recipientSection: "Recipient",
    fieldsSection: "Income & Withholding",
  };
}

function CopyButton({ json }: { json: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className={`copy-json-btn${copied ? " copy-json-btn--copied" : ""}`} onClick={handleCopy}>
      {copied ? "Copied!" : "Copy JSON"}
    </button>
  );
}

function SectionHeader({ label }: { label: string }) {
  return <div className="er-section-header">{label}</div>;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="field-row">
      <span className="field-row__label">{label}</span>
      <span className="field-row__value">{value}</span>
    </div>
  );
}

function MetaFieldRow({
  label,
  value,
  editKeyName,
  edits,
  onEdit,
  verified,
  onVerifiedChange,
  monospace,
}: {
  label: string;
  value: string;
  editKeyName: string;
  edits: Record<string, string>;
  onEdit: (key: string, value: string) => void;
  verified?: boolean;
  onVerifiedChange?: (verified: boolean) => void;
  monospace?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const display = edits[editKeyName] ?? value;

  return (
    <div className={`field-row${verified ? " field-row--verified" : ""}`}>
      {onVerifiedChange && (
        <label className="field-row__verify">
          <input
            type="checkbox"
            checked={verified ?? false}
            onChange={(e) => onVerifiedChange(e.target.checked)}
            aria-label={`Mark ${label} as verified`}
          />
        </label>
      )}
      <span className="field-row__label">{label}</span>
      <span className="field-row__value">
        {editing ? (
          <input
            className="field-row__value-input"
            defaultValue={display}
            onBlur={(e) => { onEdit(editKeyName, e.target.value.trim()); setEditing(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { onEdit(editKeyName, e.currentTarget.value.trim()); setEditing(false); }
              if (e.key === "Escape") setEditing(false);
            }}
            autoFocus
          />
        ) : (
          <span
            className={`field-row__value-display${edits[editKeyName] ? " field-row__value-display--edited" : ""}${monospace ? " field-row__value-display--mono" : ""}`}
            onDoubleClick={() => setEditing(true)}
            title="Double-click to edit"
          >
            {display || "—"}
          </span>
        )}
      </span>
    </div>
  );
}

function MissingFieldRow({ field, value, verified, onEnter, onVerifiedChange }: {
  field: MissingField;
  value?: string;
  verified?: boolean;
  onEnter: (v: string) => void;
  onVerifiedChange?: (verified: boolean) => void;
}) {
  return (
    <div className={`field-row field-row--missing${value ? " field-row--filled" : ""}${verified ? " field-row--verified" : ""}`}>
      {onVerifiedChange && (
        <label className="field-row__verify">
          <input
            type="checkbox"
            checked={verified ?? false}
            onChange={(e) => onVerifiedChange(e.target.checked)}
            aria-label={`Mark ${field.label} as verified`}
          />
        </label>
      )}
      <span className="field-row__label">
        <span className="field-row__box">{field.box}</span>
        {field.label}
      </span>
      <input
        className="field-row__missing-input"
        defaultValue={value ?? ""}
        placeholder={field.reason}
        onBlur={(e) => onEnter(e.target.value.trim())}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      />
    </div>
  );
}

function WarningBanner({ message }: { message: string }) {
  return (
    <div className="extraction-result__warning">
      <span className="extraction-result__warning-icon" aria-hidden="true">⚠</span>
      <span>{message}</span>
    </div>
  );
}

function progressLabel(stage: string): string {
  switch (stage) {
    case "parsing": return "Parsing PDF…";
    case "identifying": return "Identifying document type…";
    case "extracting": return "Extracting fields…";
    case "validating": return "Running AI validation…";
    case "complete": return "Complete";
    default: return "Processing…";
  }
}

function ExportConfirmDialog({
  fields,
  onConfirm,
  onCancel,
}: {
  fields: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="export-confirm__backdrop" onClick={onCancel}>
      <div className="export-confirm__dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="export-confirm__title">Export without full verification?</h3>
        <p className="export-confirm__subtitle">The following items are unresolved or unverified:</p>
        <ul className="export-confirm__list">
          {fields.map((field) => <li key={field}>{field}</li>)}
        </ul>
        <div className="export-confirm__actions">
          <button type="button" className="export-confirm__cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="export-confirm__confirm" onClick={onConfirm}>Export unverified data</button>
        </div>
      </div>
    </div>
  );
}

function W2ArithmeticPanel({ checks }: { checks: ReturnType<typeof w2ArithmeticChecks> }) {
  if (checks.length === 0) return null;
  return (
    <div className="extraction-result__arithmetic">
      <SectionHeader label="W-2 arithmetic checks" />
      <ul className="arithmetic-checks">
        {checks.map((check) => (
          <li key={check.label} className={`arithmetic-check${check.ok ? " arithmetic-check--ok" : " arithmetic-check--fail"}`}>
            <span>{check.label}</span>
            <span>{check.actual} {check.ok ? "✓" : `(expected ~${check.expected})`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function canBulkVerifyAll(result: ExtractionResult): boolean {
  const hasDisagreements = (result.disagreements?.length ?? 0) > 0;
  const hasMissing = (result.missingFields?.length ?? 0) > 0;
  const hasLowConfidence = result.fields.some((field) => field.confidence === "low");
  return !hasDisagreements && !hasMissing && !hasLowConfidence;
}

interface ExtractionResultViewProps {
  result: ExtractionResult;
  pdfFile?: File | null;
  edits?: Record<string, string>;
  onEditsChange?: (edits: Record<string, string>) => void;
  verified?: Record<string, boolean>;
  onVerifiedChange?: (verified: Record<string, boolean>) => void;
  clientName?: string;
  onClientNameChange?: (name: string) => void;
  preparerName?: string;
  onPreparerChange?: (name: string) => void;
  onExportComplete?: (exportedAt: string) => void;
}

export function ExtractionResultView({
  result,
  pdfFile = null,
  edits: editsProp,
  onEditsChange,
  verified: verifiedProp,
  onVerifiedChange,
  clientName,
  onClientNameChange,
  preparerName: preparerNameProp,
  onPreparerChange,
  onExportComplete,
}: ExtractionResultViewProps) {
  const { documentType, taxYear, payer, recipient, fields } = result;
  const labels = partyLabels(documentType);
  const [view, setView] = useState<ViewMode>("fields");
  const [localEdits, setLocalEdits] = useState<Record<string, string>>({});
  const [localVerified, setLocalVerified] = useState<Record<string, boolean>>({});
  const [selectedSource, setSelectedSource] = useState<string | undefined>();
  const [exportPreset, setExportPreset] = useState<ExportPreset>("row");
  const [exportOverride, setExportOverride] = useState(false);
  const [showExportConfirm, setShowExportConfirm] = useState(false);
  const [localPreparerName, setLocalPreparerName] = useState("");

  const edits = editsProp ?? localEdits;
  const verified = verifiedProp ?? localVerified;
  const preparerName = preparerNameProp ?? localPreparerName;

  const setEdit = (key: string, value: string) => {
    const next = { ...edits };
    if (value) next[key] = value; else delete next[key];
    if (onEditsChange) onEditsChange(next); else setLocalEdits(next);
  };

  const setVerified = (key: string, value: boolean) => {
    const next = { ...verified, [key]: value };
    if (onVerifiedChange) onVerifiedChange(next); else setLocalVerified(next);
  };

  const disagreementByKey = useMemo(() => {
    const map = new Map<string, FieldDisagreement>();
    for (const disagreement of result.disagreements ?? []) {
      map.set(fieldKey(disagreement), disagreement);
    }
    return map;
  }, [result.disagreements]);

  const mergedJson = useMemo(() => JSON.stringify(applyEditsToResult(result, edits), null, 2), [result, edits]);
  const arithmeticChecks = useMemo(() => w2ArithmeticChecks(result, edits), [result, edits]);

  const reviewComplete = allFieldsVerified(result, edits, verified);
  const reviewTotal = reviewKeysForResult(result).length;
  const reviewDone = verifiedCount(result, verified);
  const lowConfidenceRemaining = unverifiedLowConfidenceCount(result, verified);
  const bulkVerifyAllowed = canBulkVerifyAll(result);
  const pendingExportIssues = useMemo(
    () => unverifiedFieldLabels(result, edits, verified),
    [result, edits, verified]
  );

  const maskedSsn = recipient.ssn_last4 === "APPLIED FOR"
    ? "Applied For"
    : recipient.ssn_last4
    ? `••• ••-${recipient.ssn_last4}`
    : "";

  const handleExport = async () => {
    if (!reviewComplete && !exportOverride) return;

    const exportedAt = new Date().toISOString();
    const signOff = buildSignOff(exportedAt);
    const ctx = { edits, verified, signOff };

    switch (exportPreset) {
      case "vertical":
        downloadText(buildVerticalCsv(result, ctx), exportFilename(result, ".csv"));
        break;
      case "row":
        downloadText(buildRowCsv(result, ctx), exportFilename(result, "_row.csv"));
        break;
      case "drake-w2":
        downloadText(buildDrakeW2Csv(result, ctx), exportFilename(result, "_drake_w2.csv"));
        break;
      case "copy-all":
        await navigator.clipboard.writeText(buildCopyAllText(result, ctx));
        break;
      default:
        break;
    }
    onExportComplete?.(exportedAt);
  };

  const buildSignOff = (exportedAt: string): ExportSignOff | undefined => {
    const name = preparerName.trim();
    if (!name) return undefined;
    return {
      preparerName: name,
      exportedAt,
      extractionMethod: result.extractionMethod,
    };
  };

  const requestExport = () => {
    if (reviewComplete) {
      handleExport();
      return;
    }
    setShowExportConfirm(true);
  };

  const confirmUnverifiedExport = async () => {
    setShowExportConfirm(false);
    setExportOverride(true);
    const exportedAt = new Date().toISOString();
    const signOff = buildSignOff(exportedAt);
    const ctx = { edits, verified, signOff };
    switch (exportPreset) {
      case "vertical":
        downloadText(buildVerticalCsv(result, ctx), exportFilename(result, ".csv"));
        break;
      case "row":
        downloadText(buildRowCsv(result, ctx), exportFilename(result, "_row.csv"));
        break;
      case "drake-w2":
        downloadText(buildDrakeW2Csv(result, ctx), exportFilename(result, "_drake_w2.csv"));
        break;
      case "copy-all":
        await navigator.clipboard.writeText(buildCopyAllText(result, ctx));
        break;
      default:
        break;
    }
    onExportComplete?.(exportedAt);
  };

  const renderField = (field: TaxField) => {
    const key = fieldKey(field);
    return (
      <FieldRow
        key={key}
        field={field}
        editedValue={edits[key]}
        verified={verified[key]}
        disagreement={disagreementByKey.get(key)}
        showDisagreement={disagreementByKey.has(key)}
        onEdit={(v) => setEdit(key, v)}
        onVerifiedChange={(v) => setVerified(key, v)}
        onSourceSelect={setSelectedSource}
      />
    );
  };

  return (
    <div className="extraction-result">
      <div className="extraction-result__header-row">
        <DocumentHeader documentType={documentType} taxYear={taxYear} payerName={payer.name} />
        <div className="extraction-result__view-toggle">
          <button
            className={`view-toggle__btn${view === "fields" ? " view-toggle__btn--active" : ""}`}
            onClick={() => setView("fields")}
          >
            Fields
          </button>
          <button
            className={`view-toggle__btn${view === "json" ? " view-toggle__btn--active" : ""}`}
            onClick={() => setView("json")}
          >
            JSON
          </button>
        </div>
      </div>

      {onClientNameChange && (
        <div className="extraction-result__client">
          <label className="extraction-result__client-label" htmlFor="client-name">Client / matter</label>
          <input
            id="client-name"
            className="extraction-result__client-input"
            defaultValue={clientName ?? ""}
            placeholder="e.g. Smith, John"
            onBlur={(e) => onClientNameChange(e.target.value.trim())}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          />
        </div>
      )}

      {result.formTypeWarning && <WarningBanner message={result.formTypeWarning} />}

      {result.aiValidationFailed && (
        <WarningBanner message="AI validation failed — showing pattern-matched values only. Verify every field manually." />
      )}

      {result.corrected && (
        <WarningBanner message="CORRECTED / VOID / AMENDED form detected — confirm you are using final amounts." />
      )}

      {result.warning && <WarningBanner message={result.warning} />}

      {result.disagreements && result.disagreements.length > 0 && (
        <WarningBanner
          message={`${result.disagreements.length} field(s) disagree between pattern matching and AI. Pick the correct value for each before export.`}
        />
      )}

      {reviewTotal > 0 && (
        <div className="extraction-result__review-bar">
          <span>Review progress: {reviewDone}/{reviewTotal} fields verified</span>
          {lowConfidenceRemaining > 0 && (
            <span className="extraction-result__review-hint">{lowConfidenceRemaining} need attention</span>
          )}
          {!reviewComplete && bulkVerifyAllowed && onVerifiedChange && (
            <button
              type="button"
              className="extraction-result__review-all"
              onClick={() => {
                const next = Object.fromEntries(reviewKeysForResult(result).map((key) => [key, true]));
                onVerifiedChange({ ...verified, ...next });
              }}
            >
              Mark all verified
            </button>
          )}
        </div>
      )}

      {view === "fields" ? (
        <div className="extraction-result__split">
          <PdfViewer file={pdfFile ?? null} highlightText={selectedSource} />
          <div className="extraction-result__panel">
            <div className="extraction-result__fields">
              <SectionHeader label="Document" />
              <MetaRow label="Document Type" value={documentType} />
              <MetaFieldRow
                label="Tax Year"
                value={taxYear}
                editKeyName={META_KEYS.taxYear}
                edits={edits}
                onEdit={setEdit}
                verified={verified[META_KEYS.taxYear]}
                onVerifiedChange={onVerifiedChange ? (v) => setVerified(META_KEYS.taxYear, v) : undefined}
              />

              <SectionHeader label={labels.payerSection} />
              <MetaFieldRow
                label="Name"
                value={payer.name}
                editKeyName={META_KEYS.payerName}
                edits={edits}
                onEdit={setEdit}
                verified={verified[META_KEYS.payerName]}
                onVerifiedChange={onVerifiedChange ? (v) => setVerified(META_KEYS.payerName, v) : undefined}
              />
              <MetaFieldRow
                label="EIN"
                value={payer.ein}
                editKeyName={META_KEYS.payerEin}
                edits={edits}
                onEdit={setEdit}
                verified={verified[META_KEYS.payerEin]}
                onVerifiedChange={onVerifiedChange ? (v) => setVerified(META_KEYS.payerEin, v) : undefined}
                monospace
              />

              <SectionHeader label={labels.recipientSection} />
              <MetaFieldRow
                label="Name"
                value={recipient.name}
                editKeyName={META_KEYS.recipientName}
                edits={edits}
                onEdit={setEdit}
                verified={verified[META_KEYS.recipientName]}
                onVerifiedChange={onVerifiedChange ? (v) => setVerified(META_KEYS.recipientName, v) : undefined}
              />
              <MetaFieldRow
                label="SSN (last 4)"
                value={maskedSsn}
                editKeyName={META_KEYS.recipientSsn}
                edits={edits}
                onEdit={setEdit}
                verified={verified[META_KEYS.recipientSsn]}
                onVerifiedChange={onVerifiedChange ? (v) => setVerified(META_KEYS.recipientSsn, v) : undefined}
                monospace
              />

              {fields.length > 0 && (
                <>
                  <SectionHeader label={labels.fieldsSection} />
                  <W2ArithmeticPanel checks={arithmeticChecks} />
                  {fields.map(renderField)}
                </>
              )}

              {result.missingFields && result.missingFields.length > 0 && (
                <>
                  <SectionHeader label="Not Found — Enter Manually" />
                  {result.missingFields.map((f) => (
                    <MissingFieldRow
                      key={fieldKey(f)}
                      field={f}
                      value={edits[fieldKey(f)]}
                      verified={verified[fieldKey(f)]}
                      onEnter={(v) => setEdit(fieldKey(f), v)}
                      onVerifiedChange={(v) => setVerified(fieldKey(f), v)}
                    />
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="extraction-result__json-wrapper">
          <CopyButton json={mergedJson} />
          <pre className="extraction-result__json">{mergedJson}</pre>
        </div>
      )}

      <div className="extraction-result__footer">
        <div className="extraction-result__export-group">
          <input
            className="export-preparer-input"
            value={preparerName}
            onChange={(e) => {
              const name = e.target.value;
              if (onPreparerChange) onPreparerChange(name);
              else setLocalPreparerName(name);
            }}
            placeholder="Preparer name (export sign-off)"
            aria-label="Preparer name for export sign-off"
          />
          <select
            className="export-preset-select"
            value={exportPreset}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "vertical" || value === "row" || value === "drake-w2" || value === "copy-all") {
                setExportPreset(value);
              }
            }}
            aria-label="Export format"
          >
            <option value="row">Export row (import mapping)</option>
            <option value="vertical">Download CSV (review sheet)</option>
            {documentType === "W-2" && <option value="drake-w2">Drake W-2 field order</option>}
            <option value="copy-all">Copy all (tab-separated)</option>
          </select>
          <button
            className="download-csv-btn"
            onClick={requestExport}
            disabled={!reviewComplete && exportOverride}
            title={reviewComplete ? "Export reviewed data" : "Verify all fields before export"}
          >
            Export
          </button>
          {!reviewComplete && !exportOverride && (
            <button
              type="button"
              className="download-csv-btn download-csv-btn--override"
              onClick={() => setShowExportConfirm(true)}
            >
              Export anyway
            </button>
          )}
          {exportOverride && !reviewComplete && (
            <span className="extraction-result__export-override-badge">Unverified export enabled</span>
          )}
        </div>
        <ExtractionBadge result={result} reviewComplete={reviewComplete} />
      </div>

      {showExportConfirm && (
        <ExportConfirmDialog
          fields={pendingExportIssues}
          onConfirm={confirmUnverifiedExport}
          onCancel={() => setShowExportConfirm(false)}
        />
      )}
    </div>
  );
}

export { progressLabel };
