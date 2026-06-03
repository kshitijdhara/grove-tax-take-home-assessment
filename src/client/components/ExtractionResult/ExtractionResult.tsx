import "./ExtractionResult.css";
import { useState } from "react";
import type { ExtractionResult } from "@/shared/types";

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
import { DocumentHeader } from "./DocumentHeader";
import { FieldRow } from "./FieldRow";
import { ExtractionBadge } from "./ExtractionBadge";

type ViewMode = "fields" | "json";

interface ExtractionResultViewProps {
  result: ExtractionResult;
}

export function ExtractionResultView({ result }: ExtractionResultViewProps) {
  const { documentType, taxYear, payer, recipient, fields, extractionMethod } = result;
  const [view, setView] = useState<ViewMode>("fields");

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
          {fields.map((field, i) => (
            <FieldRow key={i} field={field} />
          ))}
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
        <span className="extraction-result__recipient">
          {recipient.name && `${recipient.name}`}
          {recipient.ssn_last4 && ` · SSN ••• ${recipient.ssn_last4}`}
        </span>
        <ExtractionBadge method={extractionMethod} />
      </div>
    </div>
  );
}
