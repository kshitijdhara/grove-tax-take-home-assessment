import { useState } from "react";
import type { ExtractionResult } from "@/shared/types";

const STORAGE_KEY = "grove_tax_history";
const MAX_ITEMS = 20;

export interface HistoryEntry {
  id: string;
  timestamp: number;
  filename: string;
  result: ExtractionResult;
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage quota exceeded — silently drop
  }
}

export function useExtractionHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());

  const addEntry = (result: ExtractionResult, filename: string) => {
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      filename,
      result,
    };
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, MAX_ITEMS);
      saveHistory(next);
      return next;
    });
  };

  const clearHistory = () => {
    localStorage.removeItem(STORAGE_KEY);
    setHistory([]);
  };

  return { history, addEntry, clearHistory };
}
