import "./Home.css";
import { useEffect, useState } from "react";
import { FileUploader } from "../../sections/FileUploader/FileUploader";
import { HistoryPanel } from "../../components/HistoryPanel/HistoryPanel";
import { WorkpaperPanel } from "../../components/WorkpaperPanel/WorkpaperPanel";
import { ExtractionResultView } from "../../components/ExtractionResult/ExtractionResult";
import { useExtractionHistory } from "../../hooks/useExtractionHistory";
import { useSettings } from "../../hooks/useSettings";
import { loadPdfBlob } from "../../storage/pdfStore";
import type { ExtractionResult } from "@/shared/types";

export function Home() {
  const { ephemeral, setEphemeral } = useSettings();
  const { history, addEntry, updateEntry, clearHistory } = useExtractionHistory(ephemeral);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activePdf, setActivePdf] = useState<File | null>(null);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const [showUploader, setShowUploader] = useState(true);

  const activeEntry = history.find((e) => e.id === activeId);

  useEffect(() => {
    if (!activeId || ephemeral) {
      setActivePdf(null);
      return;
    }
    loadPdfBlob(activeId)
      .then(setActivePdf)
      .catch(() => setActivePdf(null));
  }, [activeId, ephemeral]);

  const handleSuccess = (result: ExtractionResult, filename: string, file: File, contentHash: string) => {
    const { id, duplicate } = addEntry(result, filename, file, contentHash);
    setActiveId(id);
    setActivePdf(file);
    setShowUploader(false);
    setDuplicateNotice(duplicate ? "This PDF was already extracted — opened existing entry." : null);
  };

  const handleSelectEntry = (id: string) => {
    setActiveId(id);
    setShowUploader(false);
    setDuplicateNotice(null);
  };

  return (
    <main className="home">
      <header className="home__header">
        <div className="home__header-top">
          <div>
            <h1 className="home__title">Tax Document Extractor</h1>
            <p className="home__subtitle">Upload PDFs, verify extracted fields against the source, and export to downstream tax software</p>
          </div>
          <label className="home__ephemeral-toggle">
            <input
              type="checkbox"
              checked={ephemeral}
              onChange={(e) => setEphemeral(e.target.checked)}
            />
            <span>Don&apos;t persist PII (ephemeral session)</span>
          </label>
        </div>
      </header>

      {duplicateNotice && (
        <div className="home__notice" role="status">{duplicateNotice}</div>
      )}

      <div className="home__layout">
        <aside className="home__sidebar">
          <WorkpaperPanel
            entries={history}
            activeId={activeId}
            onSelectEntry={handleSelectEntry}
          />
          <button
            type="button"
            className="home__upload-toggle"
            onClick={() => setShowUploader(true)}
          >
            + Upload document{history.length > 0 ? "s" : ""}
          </button>
          {!ephemeral && (
            <HistoryPanel entries={history} onClear={clearHistory} onUpdateEntry={updateEntry} onSelectEntry={handleSelectEntry} />
          )}
        </aside>

        <section className="home__main">
          {showUploader || !activeEntry ? (
            <FileUploader
              onSuccess={handleSuccess}
              edits={activeEntry?.edits}
              onEditsChange={(edits) => activeId && updateEntry(activeId, { edits })}
              verified={activeEntry?.verified}
              onVerifiedChange={(verified) => activeId && updateEntry(activeId, { verified })}
              clientName={activeEntry?.clientName}
              onClientNameChange={(clientName) => activeId && updateEntry(activeId, { clientName })}
              pdfFile={activePdf}
            />
          ) : (
            <div className="home__detail">
              <div className="home__detail-header">
                <h2>{activeEntry.clientName || activeEntry.filename}</h2>
                <button type="button" className="home__detail-back" onClick={() => setShowUploader(true)}>
                  Upload more
                </button>
              </div>
              <ExtractionResultView
                result={activeEntry.result}
                pdfFile={activePdf}
                edits={activeEntry.edits}
                onEditsChange={(edits) => updateEntry(activeEntry.id, { edits })}
                verified={activeEntry.verified}
                onVerifiedChange={(verified) => updateEntry(activeEntry.id, { verified })}
                clientName={activeEntry.clientName}
                onClientNameChange={(clientName) => updateEntry(activeEntry.id, { clientName })}
              />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
