import { useState } from "react";
import type { ExtractionResult } from "@/shared/types";
import { parseHistoryEntry, type HistoryEntry } from "@/shared/parseExtraction";
import { savePdfBlob, deletePdfBlob, clearAllPdfBlobs } from "../storage/pdfStore";

const STORAGE_KEY = "grove_tax_history";
const MAX_ITEMS = 20;

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const entry = parseHistoryEntry(item);
      return entry ? [entry] : [];
    });
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    window.alert("Could not save history — browser storage may be full. Export your data before continuing.");
  }
}

function sameReturnIdentity(a: ExtractionResult, b: ExtractionResult): boolean {
  return (
    a.documentType === b.documentType &&
    a.taxYear === b.taxYear &&
    a.payer.ein === b.payer.ein &&
    a.recipient.ssn_last4 === b.recipient.ssn_last4
  );
}

export interface AddEntryResult {
  id: string;
  duplicate: boolean;
  superseded?: boolean;
}

export function useExtractionHistory(ephemeral: boolean) {
  const [history, setHistory] = useState<HistoryEntry[]>(() => (ephemeral ? [] : loadHistory()));

  const addEntry = (
    result: ExtractionResult,
    filename: string,
    file: File,
    contentHash: string
  ): AddEntryResult => {
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      filename,
      contentHash,
      returnYear: result.taxYear,
      result,
    };

    if (ephemeral) {
      setHistory((prev) => [entry, ...prev].slice(0, MAX_ITEMS));
      return { id: entry.id, duplicate: false };
    }

    const existingByHash = history.find((e) => e.contentHash === contentHash);
    if (existingByHash) {
      return { id: existingByHash.id, duplicate: true };
    }

    const supersededEntry = result.corrected
      ? history.find((e) => sameReturnIdentity(e.result, result))
      : undefined;

    setHistory((prev) => {
      const withoutSuperseded = supersededEntry
        ? prev.filter((e) => e.id !== supersededEntry.id)
        : prev;
      const nextEntry = supersededEntry
        ? { ...entry, supersedesId: supersededEntry.id }
        : entry;
      const next = [nextEntry, ...withoutSuperseded].slice(0, MAX_ITEMS);
      saveHistory(next);
      return next;
    });

    savePdfBlob(entry.id, file).catch(() => {
      window.alert("Could not store PDF for history replay. Re-upload to view source alongside fields.");
    });

    if (supersededEntry) {
      deletePdfBlob(supersededEntry.id).catch(() => undefined);
      return { id: entry.id, duplicate: false, superseded: true };
    }

    return { id: entry.id, duplicate: false };
  };

  const updateEntry = (
    id: string,
    patch: Partial<Pick<HistoryEntry, "edits" | "verified" | "clientName" | "preparerName" | "lastExportedAt" | "returnYear">>
  ) => {
    setHistory((prev) => {
      const next = prev.map((e) => (e.id === id ? { ...e, ...patch } : e));
      if (!ephemeral) saveHistory(next);
      return next;
    });
  };

  const clearHistory = () => {
    if (!ephemeral) localStorage.removeItem(STORAGE_KEY);
    if (!ephemeral) clearAllPdfBlobs().catch(() => undefined);
    setHistory([]);
  };

  const removeEntry = (id: string) => {
    if (!ephemeral) deletePdfBlob(id).catch(() => undefined);
    setHistory((prev) => {
      const next = prev.filter((e) => e.id !== id);
      if (!ephemeral) saveHistory(next);
      return next;
    });
  };

  return { history, addEntry, updateEntry, clearHistory, removeEntry };
}
