import "./HistoryPanel.css";
import type { HistoryEntry } from "../../hooks/useExtractionHistory";
import { ExtractionResultView } from "../ExtractionResult/ExtractionResult";
import { useState } from "react";

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

function HistoryModal({ entry, onClose }: { entry: HistoryEntry; onClose: () => void }) {
  return (
    <div className="history-modal__backdrop" onClick={onClose}>
      <div className="history-modal__content" onClick={(e) => e.stopPropagation()}>
        <div className="history-modal__header">
          <span className="history-modal__filename">{entry.filename}</span>
          <button className="history-modal__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <ExtractionResultView result={entry.result} />
      </div>
    </div>
  );
}

interface HistoryPanelProps {
  entries: HistoryEntry[];
  onClear: () => void;
}

export function HistoryPanel({ entries, onClear }: HistoryPanelProps) {
  const [selected, setSelected] = useState<HistoryEntry | null>(null);

  if (entries.length === 0) return null;

  return (
    <>
      <section className="history-panel">
        <div className="history-panel__header">
          <h2 className="history-panel__title">Recent extractions</h2>
          <button className="history-panel__clear" onClick={onClear}>Clear</button>
        </div>
        <ul className="history-panel__list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                className="history-card"
                onClick={() => setSelected(entry)}
              >
                <span className="history-card__badge">{entry.result.documentType}</span>
                <div className="history-card__meta">
                  <span className="history-card__payer">{entry.result.payer.name || entry.filename}</span>
                  <span className="history-card__detail">
                    {entry.result.taxYear && <span>{entry.result.taxYear}</span>}
                    <span className="history-card__dot">·</span>
                    <span>{relativeTime(entry.timestamp)}</span>
                  </span>
                </div>
                <span className="history-card__chevron">›</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {selected && (
        <HistoryModal entry={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
