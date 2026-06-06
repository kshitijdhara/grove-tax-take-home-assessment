import type { DocumentType } from "@/shared/types";

export function identifyDocument(text: string): DocumentType | null {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  if (/\bw-?2\b/.test(t) || t.includes("wage and tax statement") || t.includes("wage & tax")) return "W-2";
  if (/1099[\s-]*nec\b/.test(t) || t.includes("nonemployee compensation") || t.includes("non-employee compensation")) return "1099-NEC";
  // 1099-MISC maps to NEC extractor (pre-2020 forms, same core fields)
  if (/1099[\s-]*misc\b/.test(t) || t.includes("miscellaneous income") || t.includes("miscellaneous information")) return "1099-NEC";
  if (/1099[\s-]*int\b/.test(t) || t.includes("interest income")) return "1099-INT";
  if (/1099[\s-]*div\b/.test(t) || t.includes("dividends and distributions") || t.includes("dividend income")) return "1099-DIV";
  return null;
}
