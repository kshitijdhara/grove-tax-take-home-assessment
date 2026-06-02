interface DocumentHeaderProps {
  documentType: string;
  taxYear: string;
  payerName: string;
}

export function DocumentHeader({ documentType, taxYear, payerName }: DocumentHeaderProps) {
  return (
    <div className="doc-header">
      <span className="doc-header__badge">{documentType}</span>
      <div className="doc-header__meta">
        {taxYear && <span className="doc-header__year">Tax Year {taxYear}</span>}
        {payerName && <span className="doc-header__payer">{payerName}</span>}
      </div>
    </div>
  );
}
