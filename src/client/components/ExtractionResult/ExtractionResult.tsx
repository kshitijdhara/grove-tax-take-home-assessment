import "./ExtractionResult.css";
import type { ExtractionResult } from "@/shared/types";
import { DocumentHeader } from "./DocumentHeader";
import { FieldRow } from "./FieldRow";
import { ExtractionBadge } from "./ExtractionBadge";

interface ExtractionResultViewProps {
  result: ExtractionResult;
}

export function ExtractionResultView({ result }: ExtractionResultViewProps) {
  const { documentType, taxYear, payer, recipient, fields, extractionMethod } = result;

  return (
    <div className="extraction-result">
      <DocumentHeader
        documentType={documentType}
        taxYear={taxYear}
        payerName={payer.name}
      />
      <div className="extraction-result__fields">
        {fields.map((field, i) => (
          <FieldRow key={i} field={field} />
        ))}
      </div>
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
