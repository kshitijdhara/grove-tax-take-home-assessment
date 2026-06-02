import type { DocumentType } from "@/shared/types";

export function identifyDocument(text: string): DocumentType | null {
  const t = text.toLowerCase();
  if (t.includes("w-2") || t.includes("wage and tax statement")) return "W-2";
  if (t.includes("1099-nec") || t.includes("nonemployee compensation")) return "1099-NEC";
  if (t.includes("1099-int") || t.includes("interest income")) return "1099-INT";
  if (t.includes("1099-div") || t.includes("dividends and distributions")) return "1099-DIV";
  return null;
}
