import "./ExtractionResult.css";
import { useState } from "react";
import type { ExtractionResult, MissingField, TaxField } from "@/shared/types";
import { DocumentHeader } from "./DocumentHeader";
import { FieldRow } from "./FieldRow";
import { ExtractionBadge } from "./ExtractionBadge";

// A field-like shape used to key both extracted and missing fields uniformly.
interface Keyable { box?: string; label: string; }
// Null byte separator avoids collisions with box/label values containing "-".
const editKey = (f: Keyable) => `${f.box ?? ""}\x00${f.label}`;

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

function SsnRow({ ssn }: { ssn: string }) {
  return (
    <div className="field-row">
      <span className="field-row__label">SSN</span>
      <span className={`field-row__value${!ssn ? " field-row__value--absent" : ""}`}>{ssn || "Not present on document"}</span>
    </div>
  );
}

// Missing fields are known-to-exist boxes regex couldn't find. Let the preparer key the
// value in directly from their paper copy — it flows into both CSV exports.
function MissingFieldRow({ field, value, onEnter }: {
  field: MissingField;
  value?: string;
  onEnter: (v: string) => void;
}) {
  return (
    <div className={`field-row field-row--missing${value ? " field-row--filled" : ""}`}>
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

// Resolves the value to export for a field: preparer edit wins over the extracted value.
function resolved(result: ExtractionResult, edits: Record<string, string>, f: TaxField): string {
  return edits[editKey(f)] ?? f.value;
}

function csvEscape(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

function triggerDownload(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function baseFilename(result: ExtractionResult): string {
  return `${result.documentType}_${result.taxYear}_${result.payer.name.replace(/\s+/g, "_") || "document"}`;
}

// Human-readable vertical CSV: one row per field, with an Edited flag and manual entries.
function DownloadCsvButton({ result, edits }: { result: ExtractionResult; edits: Record<string, string> }) {
  const handleDownload = () => {
    const missingRows = (result.missingFields ?? [])
      .map((mf) => {
        const v = edits[editKey(mf)];
        return v ? [mf.box, mf.label, v, "manual", "yes"] : null;
      })
      .filter((r): r is string[] => r !== null);

    const rows: string[][] = [
      ["Document Type", result.documentType],
      ["Tax Year", result.taxYear],
      ["Payer Name", result.payer.name],
      ["Payer EIN", result.payer.ein],
      ["Recipient Name", result.recipient.name],
      ["Recipient SSN (last 4)", result.recipient.ssn_last4],
      [],
      ["Box", "Label", "Value", "Confidence", "Edited"],
      ...result.fields.map((f) => {
        const override = edits[editKey(f)];
        return [f.box ?? "", f.label, override ?? f.value, f.confidence, override ? "yes" : ""];
      }),
      ...missingRows,
    ];
    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    triggerDownload(csv, `${baseFilename(result)}.csv`);
  };
  return <button className="download-csv-btn" onClick={handleDownload}>Download CSV</button>;
}

// Import-friendly "one row per form" CSV: header is column names, single data row.
// This is the shape downstream tax software import mappers expect (columns = fields).
function ExportRowButton({ result, edits }: { result: ExtractionResult; edits: Record<string, string> }) {
  const handleDownload = () => {
    const header = [
      "Document Type", "Tax Year", "Payer Name", "Payer EIN", "Recipient Name", "Recipient SSN",
      ...result.fields.map((f) => (f.box ? `${f.box} ${f.label}` : f.label)),
      ...(result.missingFields ?? [])
        .filter((mf) => edits[editKey(mf)])
        .map((mf) => `${mf.box} ${mf.label}`),
    ];
    const row = [
      result.documentType, result.taxYear, result.payer.name, result.payer.ein,
      result.recipient.name, result.recipient.ssn_last4,
      ...result.fields.map((f) => resolved(result, edits, f)),
      ...(result.missingFields ?? [])
        .map((mf) => edits[editKey(mf)])
        .filter((v): v is string => Boolean(v)),
    ];
    const csv = [header.map(csvEscape).join(","), row.map(csvEscape).join(",")].join("\n");
    triggerDownload(csv, `${baseFilename(result)}_row.csv`);
  };
  return (
    <button className="download-csv-btn" onClick={handleDownload} title="One row per form — columns are fields, ready for import mapping">
      Export row
    </button>
  );
}

type ViewMode = "fields" | "json";

interface ExtractionResultViewProps {
  result: ExtractionResult;
  edits?: Record<string, string>;
  onEditsChange?: (edits: Record<string, string>) => void;
  clientName?: string;
  onClientNameChange?: (name: string) => void;
}

export function ExtractionResultView({
  result,
  edits: editsProp,
  onEditsChange,
  clientName,
  onClientNameChange,
}: ExtractionResultViewProps) {
  const { documentType, taxYear, payer, recipient, fields, extractionMethod } = result;
  const [view, setView] = useState<ViewMode>("fields");
  const [localEdits, setLocalEdits] = useState<Record<string, string>>({});

  // Controlled when a parent supplies edits (persisted to history); local otherwise.
  const edits = editsProp ?? localEdits;
  const setEdit = (key: string, value: string) => {
    const next = { ...edits };
    if (value) next[key] = value; else delete next[key];
    if (onEditsChange) onEditsChange(next); else setLocalEdits(next);
  };

  const maskedSsn = recipient.ssn_last4 === "APPLIED FOR"
    ? "Applied For"
    : recipient.ssn_last4
    ? `••• ••-${recipient.ssn_last4}`
    : "";

  return (
    <div className="extraction-result">
      <div className="extraction-result__header-row">
        <DocumentHeader
          documentType={documentType}
          taxYear={taxYear}
          payerName={payer.name}
        />
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

      {result.warning && <WarningBanner message={result.warning} />}

      {view === "fields" ? (
        <div className="extraction-result__fields">
          <SectionHeader label="Document" />
          <MetaRow label="Document Type" value={documentType} />
          <MetaRow label="Tax Year" value={taxYear} />

          <SectionHeader label="Employer" />
          <MetaRow label="Name" value={payer.name} />
          <MetaRow label="EIN" value={payer.ein} />

          <SectionHeader label="Employee" />
          <MetaRow label="Name" value={recipient.name} />
          <SsnRow ssn={maskedSsn} />

          {fields.length > 0 && (
            <>
              <SectionHeader label="Compensation & Taxes" />
              {fields.map((field) => (
                <FieldRow
                  key={editKey(field)}
                  field={field}
                  editedValue={edits[editKey(field)]}
                  onEdit={(v) => setEdit(editKey(field), v)}
                />
              ))}
            </>
          )}

          {result.missingFields && result.missingFields.length > 0 && (
            <>
              <SectionHeader label="Not Found — Enter Manually" />
              {result.missingFields.map((f) => (
                <MissingFieldRow
                  key={editKey(f)}
                  field={f}
                  value={edits[editKey(f)]}
                  onEnter={(v) => setEdit(editKey(f), v)}
                />
              ))}
            </>
          )}
        </div>
      ) : (
        <div className="extraction-result__json-wrapper">
          <CopyButton json={JSON.stringify(result, null, 2)} />
          <pre className="extraction-result__json">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}

      <div className="extraction-result__footer">
        <div className="extraction-result__export-group">
          <DownloadCsvButton result={result} edits={edits} />
          <ExportRowButton result={result} edits={edits} />
        </div>
        <ExtractionBadge method={extractionMethod} />
      </div>
    </div>
  );
}
