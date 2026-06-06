import type { DocumentType } from "@/shared/types";

export interface DocumentIdentification {
  documentType: DocumentType;
  formTypeWarning?: string;
}

export function identifyDocument(text: string): DocumentIdentification | null {
  const t = text.toLowerCase().replace(/\s+/g, " ");

  if (/\bw-?2\b/.test(t) || t.includes("wage and tax statement") || t.includes("wage & tax")) {
    return { documentType: "W-2" };
  }

  const isMisc = /1099[\s-]*misc\b/.test(t) || t.includes("miscellaneous income") || t.includes("miscellaneous information");
  const isNec = /1099[\s-]*nec\b/.test(t) || t.includes("nonemployee compensation") || t.includes("non-employee compensation");

  if (isNec) {
    return { documentType: "1099-NEC" };
  }
  if (isMisc) {
    return {
      documentType: "1099-NEC",
      formTypeWarning: "Document appears to be 1099-MISC — extracted with NEC fields. Verify form type and box labels before export.",
    };
  }

  if (/1099[\s-]*int\b/.test(t) || t.includes("interest income")) {
    return { documentType: "1099-INT" };
  }
  if (/1099[\s-]*div\b/.test(t) || t.includes("dividends and distributions") || t.includes("dividend income")) {
    return { documentType: "1099-DIV" };
  }

  return null;
}
