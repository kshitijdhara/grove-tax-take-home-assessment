import "./ExtractionResult.css";
import { useState } from "react";
import type { ExtractionResult } from "@/shared/types";
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

type ViewMode = "fields" | "json";

interface ExtractionResultViewProps {
  result: ExtractionResult;
}

export function ExtractionResultView({ result }: ExtractionResultViewProps) {
  const { documentType, taxYear, payer, recipient, fields, extractionMethod } = result;
  const [view, setView] = useState<ViewMode>("fields");

  const maskedSsn = recipient.ssn_last4 ? `••• ••-${recipient.ssn_last4}` : "";

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
          <MetaRow label="SSN" value={maskedSsn} />

          {fields.length > 0 && (
            <>
              <SectionHeader label="Compensation & Taxes" />
              {fields.map((field, i) => (
                <FieldRow key={i} field={field} />
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
        <ExtractionBadge method={extractionMethod} />
      </div>
    </div>
  );
}
