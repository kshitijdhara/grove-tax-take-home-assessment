import "./Home.css";
import { useState } from "react";
import { FileUploader } from "../../sections/FileUploader/FileUploader";
import { HistoryPanel } from "../../components/HistoryPanel/HistoryPanel";
import { useExtractionHistory } from "../../hooks/useExtractionHistory";
import type { ExtractionResult } from "@/shared/types";

export function Home() {
  const { history, addEntry, updateEntry, clearHistory } = useExtractionHistory();
  const [activeId, setActiveId] = useState<string | null>(null);

  const handleSuccess = (result: ExtractionResult, filename: string) => {
    setActiveId(addEntry(result, filename));
  };

  const activeEntry = history.find((e) => e.id === activeId);

  return (
    <main className="home">
      <header className="home__header">
        <h1 className="home__title">Tax Document Extractor</h1>
        <p className="home__subtitle">Upload a PDF to extract tax fields automatically</p>
      </header>
      <FileUploader
        onSuccess={handleSuccess}
        edits={activeEntry?.edits}
        onEditsChange={(edits) => activeId && updateEntry(activeId, { edits })}
        clientName={activeEntry?.clientName}
        onClientNameChange={(clientName) => activeId && updateEntry(activeId, { clientName })}
      />
      <HistoryPanel entries={history} onClear={clearHistory} onUpdateEntry={updateEntry} />
    </main>
  );
}
