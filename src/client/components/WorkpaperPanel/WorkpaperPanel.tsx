import "./WorkpaperPanel.css";
import type { HistoryEntry } from "@/shared/parseExtraction";
import { fieldKey } from "@/shared/extractionKeys";

interface ClientGroup {
  clientName: string;
  entries: HistoryEntry[];
  totalW2Wages: number;
  totalNecIncome: number;
}

function parseAmount(value: string): number {
  const n = parseFloat(value.replace(/[$,\s]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

function fieldAmount(entry: HistoryEntry, box: string, labelIncludes: string): number {
  const editOverride = entry.edits;
  const field = entry.result.fields.find(
    (f) => f.box === box && f.label.toLowerCase().includes(labelIncludes)
  );
  if (!field) return 0;
  const value = editOverride?.[fieldKey(field)] ?? field.value;
  return parseAmount(value);
}

function groupByClient(entries: HistoryEntry[]): ClientGroup[] {
  const groups = new Map<string, HistoryEntry[]>();

  for (const entry of entries) {
    const key = entry.clientName?.trim() || "Unassigned";
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }

  return [...groups.entries()].map(([clientName, clientEntries]) => ({
    clientName,
    entries: clientEntries,
    totalW2Wages: clientEntries
      .filter((e) => e.result.documentType === "W-2")
      .reduce((sum, e) => sum + fieldAmount(e, "Box 1", "wages"), 0),
    totalNecIncome: clientEntries
      .filter((e) => e.result.documentType === "1099-NEC")
      .reduce((sum, e) => sum + fieldAmount(e, "Box 1", "nonemployee"), 0),
  }));
}

interface WorkpaperPanelProps {
  entries: HistoryEntry[];
  activeId?: string | null;
  onSelectEntry?: (id: string) => void;
}

export function WorkpaperPanel({ entries, activeId, onSelectEntry }: WorkpaperPanelProps) {
  const groups = groupByClient(entries).filter((g) => g.entries.length > 0);

  if (groups.length === 0) {
    return (
      <section className="workpaper-panel workpaper-panel--empty">
        <h2 className="workpaper-panel__title">Client workpapers</h2>
        <p className="workpaper-panel__empty">Upload documents to build client workpapers with income roll-ups.</p>
      </section>
    );
  }

  return (
    <section className="workpaper-panel">
      <h2 className="workpaper-panel__title">Client workpapers</h2>
      <div className="workpaper-panel__grid">
        {groups.map((group) => (
          <article key={group.clientName} className="workpaper-card">
            <header className="workpaper-card__header">
              <h3 className="workpaper-card__name">{group.clientName}</h3>
              <span className="workpaper-card__count">{group.entries.length} doc{group.entries.length === 1 ? "" : "s"}</span>
            </header>
            <ul className="workpaper-card__docs">
              {group.entries.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={`workpaper-card__doc${activeId === entry.id ? " workpaper-card__doc--active" : ""}`}
                    onClick={() => onSelectEntry?.(entry.id)}
                  >
                    <span className="workpaper-card__badge">{entry.result.documentType}</span>
                    <span>{entry.result.taxYear || entry.filename}</span>
                  </button>
                </li>
              ))}
            </ul>
            <footer className="workpaper-card__totals">
              {group.totalW2Wages > 0 && (
                <div className="workpaper-card__total">
                  <span>W-2 wages</span>
                  <span>${group.totalW2Wages.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              )}
              {group.totalNecIncome > 0 && (
                <div className="workpaper-card__total">
                  <span>1099-NEC income</span>
                  <span>${group.totalNecIncome.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              )}
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}
