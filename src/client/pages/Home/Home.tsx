import "./Home.css";
import { FileUploader } from "../../sections/FileUploader/FileUploader";
import { HistoryPanel } from "../../components/HistoryPanel/HistoryPanel";
import { useExtractionHistory } from "../../hooks/useExtractionHistory";
import type { ExtractionResult } from "@/shared/types";

export function Home() {
  const { history, addEntry, clearHistory } = useExtractionHistory();

  const handleSuccess = (result: ExtractionResult, filename: string) => {
    addEntry(result, filename);
  };

  return (
    <main className="home">
      <header className="home__header">
        <h1 className="home__title">Tax Document Extractor</h1>
        <p className="home__subtitle">Upload a PDF to extract tax fields automatically</p>
      </header>
      <FileUploader onSuccess={handleSuccess} />
      <HistoryPanel entries={history} onClear={clearHistory} />
    </main>
  );
}
