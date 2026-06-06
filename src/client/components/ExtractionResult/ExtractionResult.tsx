import "./ExtractionResult.css";
import { useState } from "react";
import type { ExtractionResult, MissingField } from "@/shared/types";
import { DocumentHeader } from "./DocumentHeader";
import { FieldRow } from "./FieldRow";
import { ExtractionBadge } from "./ExtractionBadge";

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

function MissingFieldRow({ field }: { field: MissingField }) {
  return (
    <div className="field-row field-row--missing">
      <span className="field-row__label">
        <span className="field-row__box">{field.box}</span>
        {field.label}
      </span>
      <span className="field-row__missing-value" title={field.reason}>—</span>
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

function DownloadCsvButton({ result }: { result: ExtractionResult }) {
  const handleDownload = () => {
    const rows: string[][] = [
      ["Document Type", result.documentType],
      ["Tax Year", result.taxYear],
      ["Payer Name", result.payer.name],
      ["Payer EIN", result.payer.ein],
      ["Recipient Name", result.recipient.name],
      ["Recipient SSN (last 4)", result.recipient.ssn_last4],
      [],
      ["Box", "Label", "Value", "Confidence"],
      ...result.fields.map(f => [f.box ?? "", f.label, f.value, f.confidence]),
    ];
    const csv = rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.documentType}_${result.taxYear}_${result.payer.name.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return <button className="download-csv-btn" onClick={handleDownload}>Download CSV</button>;
}

type ViewMode = "fields" | "json";

interface ExtractionResultViewProps {
  result: ExtractionResult;
}

export function ExtractionResultView({ result }: ExtractionResultViewProps) {
  const { documentType, taxYear, payer, recipient, fields, extractionMethod } = result;
  const [view, setView] = useState<ViewMode>("fields");

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
              {fields.map((field, i) => (
                <FieldRow key={i} field={field} />
              ))}
            </>
          )}

          {result.missingFields && result.missingFields.length > 0 && (
            <>
              <SectionHeader label="Not Found — Verify Manually" />
              {result.missingFields.map((f, i) => (
                <MissingFieldRow key={i} field={f} />
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
        <DownloadCsvButton result={result} />
        <ExtractionBadge method={extractionMethod} />
      </div>
    </div>
  );
}
