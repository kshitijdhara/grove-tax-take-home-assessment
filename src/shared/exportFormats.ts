import { META_KEYS, fieldKey } from "@/shared/extractionKeys";
import { resolvedFieldValue } from "@/shared/resolvedResult";
import type { ExtractionResult, TaxField } from "@/shared/types";

export interface ExportSignOff {
  preparerName: string;
  exportedAt: string;
  extractionMethod: ExtractionResult["extractionMethod"];
}

export interface ExportContext {
  edits: Record<string, string>;
  verified: Record<string, boolean>;
  signOff?: ExportSignOff;
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function baseFilename(result: ExtractionResult): string {
  return `${result.documentType}_${result.taxYear}_${result.payer.name.replace(/\s+/g, "_") || "document"}`;
}

function metaValue(result: ExtractionResult, edits: Record<string, string>, key: string, fallback: string): string {
  return edits[key] ?? fallback;
}

function sourceMethod(result: ExtractionResult, field: TaxField): string {
  const hasDisagreement = result.disagreements?.some((d) => fieldKey(d) === fieldKey(field));
  if (hasDisagreement) return "disputed";
  return field.confidence === "high" ? result.extractionMethod : "manual-review";
}

function signOffHeader(signOff: ExportSignOff | undefined): string[] {
  if (!signOff) return [];
  return [
    `# Export sign-off: preparer=${signOff.preparerName}, exportedAt=${signOff.exportedAt}, method=${signOff.extractionMethod}`,
  ];
}

const DRAKE_W2_COLUMNS: Array<{ box: string; label: string; header: string }> = [
  { box: "Box 1", label: "Wages, tips, other compensation", header: "Wages" },
  { box: "Box 2", label: "Federal income tax withheld", header: "Federal WH" },
  { box: "Box 3", label: "Social security wages", header: "SS Wages" },
  { box: "Box 4", label: "Social security tax withheld", header: "SS Tax" },
  { box: "Box 5", label: "Medicare wages and tips", header: "Medicare Wages" },
  { box: "Box 6", label: "Medicare tax withheld", header: "Medicare Tax" },
  { box: "Box 16", label: "State wages", header: "State Wages" },
  { box: "Box 17", label: "State income tax", header: "State Tax" },
];

function findFieldByBox(result: ExtractionResult, edits: Record<string, string>, box: string): string {
  const match = result.fields.find((field) => field.box === box || field.box?.startsWith(`${box} `));
  return match ? resolvedFieldValue(edits, match) : "";
}

export function buildVerticalCsv(result: ExtractionResult, ctx: ExportContext): string {
  const { edits, verified, signOff } = ctx;
  const metaRows: string[][] = [
    ["Document Type", result.documentType, "", "", "", ""],
    ["Tax Year", metaValue(result, edits, META_KEYS.taxYear, result.taxYear), "", verified[META_KEYS.taxYear] ? "yes" : "", edits[META_KEYS.taxYear] ? "yes" : "", "meta"],
    ["Payer Name", metaValue(result, edits, META_KEYS.payerName, result.payer.name), "", verified[META_KEYS.payerName] ? "yes" : "", edits[META_KEYS.payerName] ? "yes" : "", "meta"],
    ["Payer EIN", metaValue(result, edits, META_KEYS.payerEin, result.payer.ein), "", verified[META_KEYS.payerEin] ? "yes" : "", edits[META_KEYS.payerEin] ? "yes" : "", "meta"],
    ["Recipient Name", metaValue(result, edits, META_KEYS.recipientName, result.recipient.name), "", verified[META_KEYS.recipientName] ? "yes" : "", edits[META_KEYS.recipientName] ? "yes" : "", "meta"],
    ["Recipient SSN (last 4)", metaValue(result, edits, META_KEYS.recipientSsn, result.recipient.ssn_last4), "", verified[META_KEYS.recipientSsn] ? "yes" : "", edits[META_KEYS.recipientSsn] ? "yes" : "", "meta"],
  ];

  const missingRows = (result.missingFields ?? [])
    .flatMap((mf) => {
      const value = edits[fieldKey(mf)];
      const key = fieldKey(mf);
      return value ? [[mf.box, mf.label, value, "manual", verified[key] ? "yes" : "", edits[key] ? "yes" : "", "manual"]] : [];
    });

  const rows: string[][] = [
    ...signOffHeader(signOff).map((line): string[] => [line]),
    [],
    ["Box", "Label", "Value", "Confidence", "Verified", "Edited", "SourceMethod"],
    ...metaRows,
    ...result.fields.map((field) => {
      const key = fieldKey(field);
      const override = edits[key];
      return [
        field.box ?? "",
        field.label,
        override ?? field.value,
        field.confidence,
        verified[key] ? "yes" : "",
        override ? "yes" : "",
        sourceMethod(result, field),
      ];
    }),
    ...missingRows,
  ];
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

export function buildRowCsv(result: ExtractionResult, ctx: ExportContext): string {
  const { edits, signOff } = ctx;
  const header = [
    "Document Type", "Tax Year", "Payer Name", "Payer EIN", "Recipient Name", "Recipient SSN",
    "ExtractionMethod", "Preparer", "ExportedAt",
    ...result.fields.map((field) => (field.box ? `${field.box} ${field.label}` : field.label)),
    ...(result.missingFields ?? [])
      .filter((mf) => edits[fieldKey(mf)])
      .map((mf) => `${mf.box} ${mf.label}`),
  ];
  const row = [
    result.documentType,
    metaValue(result, edits, META_KEYS.taxYear, result.taxYear),
    metaValue(result, edits, META_KEYS.payerName, result.payer.name),
    metaValue(result, edits, META_KEYS.payerEin, result.payer.ein),
    metaValue(result, edits, META_KEYS.recipientName, result.recipient.name),
    metaValue(result, edits, META_KEYS.recipientSsn, result.recipient.ssn_last4),
    result.extractionMethod,
    signOff?.preparerName ?? "",
    signOff?.exportedAt ?? "",
    ...result.fields.map((field) => resolvedFieldValue(edits, field)),
    ...(result.missingFields ?? [])
      .map((mf) => edits[fieldKey(mf)])
      .filter((value): value is string => Boolean(value)),
  ];
  const lines = [...signOffHeader(signOff), header.map(csvEscape).join(","), row.map(csvEscape).join(",")];
  return lines.join("\n");
}

/** Drake W-2 import: employer/recipient header + boxes 1–6, 16–17 in common import order. */
export function buildDrakeW2Csv(result: ExtractionResult, ctx: ExportContext): string {
  const { edits, signOff } = ctx;
  const header = [
    "Employer EIN", "Employer Name", "Employee Name", "SSN Last 4", "Tax Year",
    ...DRAKE_W2_COLUMNS.map((col) => col.header),
    "Preparer", "ExportedAt",
  ];
  const row = [
    metaValue(result, edits, META_KEYS.payerEin, result.payer.ein),
    metaValue(result, edits, META_KEYS.payerName, result.payer.name),
    metaValue(result, edits, META_KEYS.recipientName, result.recipient.name),
    metaValue(result, edits, META_KEYS.recipientSsn, result.recipient.ssn_last4),
    metaValue(result, edits, META_KEYS.taxYear, result.taxYear),
    ...DRAKE_W2_COLUMNS.map((col) => findFieldByBox(result, edits, col.box)),
    signOff?.preparerName ?? "",
    signOff?.exportedAt ?? "",
  ];
  const lines = [...signOffHeader(signOff), header.map(csvEscape).join(","), row.map(csvEscape).join(",")];
  return lines.join("\n");
}

export function buildCopyAllText(result: ExtractionResult, ctx: ExportContext): string {
  const { edits, signOff } = ctx;
  const lines = [
    ...(signOff ? [`Sign-off: ${signOff.preparerName} @ ${signOff.exportedAt} (${signOff.extractionMethod})`] : []),
    `Document: ${result.documentType}`,
    `Tax Year: ${metaValue(result, edits, META_KEYS.taxYear, result.taxYear)}`,
    `Payer: ${metaValue(result, edits, META_KEYS.payerName, result.payer.name)}`,
    `EIN: ${metaValue(result, edits, META_KEYS.payerEin, result.payer.ein)}`,
    `Recipient: ${metaValue(result, edits, META_KEYS.recipientName, result.recipient.name)}`,
    `SSN Last 4: ${metaValue(result, edits, META_KEYS.recipientSsn, result.recipient.ssn_last4)}`,
    "",
    ...result.fields.map((field) => `${field.box ?? field.label}\t${resolvedFieldValue(edits, field)}`),
    ...(result.missingFields ?? [])
      .flatMap((mf) => {
        const value = edits[fieldKey(mf)];
        return value ? [`${mf.box} ${mf.label}\t${value}`] : [];
      }),
  ];
  return lines.join("\n");
}

export function downloadText(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportFilename(result: ExtractionResult, suffix: string): string {
  return `${baseFilename(result)}${suffix}`;
}

export function orderedFields(result: ExtractionResult): TaxField[] {
  return [...result.fields];
}
