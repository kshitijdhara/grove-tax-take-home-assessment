import "./HistoryPanel.css";
import type { HistoryEntry } from "@/shared/parseExtraction";
import { ExtractionResultView } from "../ExtractionResult/ExtractionResult";
import { loadPdfBlob } from "../../storage/pdfStore";
import { useEffect, useState } from "react";

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

function HistoryModal({ entry, onClose, onUpdateEntry }: {
  entry: HistoryEntry;
  onClose: () => void;
  onUpdateEntry: (id: string, patch: Partial<Pick<HistoryEntry, "edits" | "verified" | "clientName">>) => void;
}) {
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  useEffect(() => {
    loadPdfBlob(entry.id)
      .then(setPdfFile)
      .catch(() => setPdfFile(null));
  }, [entry.id]);

  return (
    <div className="history-modal__backdrop" onClick={onClose}>
      <div className="history-modal__content" onClick={(e) => e.stopPropagation()}>
        <div className="history-modal__header">
          <span className="history-modal__filename">{entry.clientName || entry.filename}</span>
          <button className="history-modal__close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <ExtractionResultView
          result={entry.result}
          pdfFile={pdfFile}
          edits={entry.edits}
          onEditsChange={(edits) => onUpdateEntry(entry.id, { edits })}
          verified={entry.verified}
          onVerifiedChange={(verified) => onUpdateEntry(entry.id, { verified })}
          clientName={entry.clientName}
          onClientNameChange={(clientName) => onUpdateEntry(entry.id, { clientName })}
        />
      </div>
    </div>
  );
}

interface HistoryPanelProps {
  entries: HistoryEntry[];
  onClear: () => void;
  onUpdateEntry: (id: string, patch: Partial<Pick<HistoryEntry, "edits" | "verified" | "clientName">>) => void;
  onSelectEntry?: (id: string) => void;
}

export function HistoryPanel({ entries, onClear, onUpdateEntry, onSelectEntry }: HistoryPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (entries.length === 0) return null;

  const selected = entries.find((e) => e.id === selectedId) ?? null;

  const openEntry = (id: string) => {
    if (onSelectEntry) onSelectEntry(id);
    else setSelectedId(id);
  };

  return (
    <>
      <section className="history-panel">
        <div className="history-panel__header">
          <h2 className="history-panel__title">Recent</h2>
          <button
            className="history-panel__clear"
            onClick={() => {
              if (window.confirm("Clear all extraction history? This cannot be undone.")) onClear();
            }}
          >
            Clear
          </button>
        </div>
        <ul className="history-panel__list">
          {entries.map((entry) => {
            const editCount = entry.edits ? Object.keys(entry.edits).length : 0;
            const primaryLabel = entry.clientName || entry.result.payer.name || entry.filename;
            return (
              <li key={entry.id}>
                <button className="history-card" onClick={() => openEntry(entry.id)}>
                  <span className="history-card__badge">{entry.result.documentType}</span>
                  <div className="history-card__meta">
                    <span className="history-card__payer">{primaryLabel}</span>
                    <span className="history-card__detail">
                      {entry.result.taxYear && <span>{entry.result.taxYear}</span>}
                      <span className="history-card__dot">·</span>
                      <span>{relativeTime(entry.timestamp)}</span>
                      {editCount > 0 && (
                        <>
                          <span className="history-card__dot">·</span>
                          <span className="history-card__edited">{editCount} edited</span>
                        </>
                      )}
                    </span>
                  </div>
                  <span className="history-card__chevron">›</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {selected && !onSelectEntry && (
        <HistoryModal entry={selected} onClose={() => setSelectedId(null)} onUpdateEntry={onUpdateEntry} />
      )}
    </>
  );
}
