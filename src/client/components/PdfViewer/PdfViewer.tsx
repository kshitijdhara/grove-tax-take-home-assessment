import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import "./PdfViewer.css";

GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

interface PdfViewerProps {
  file: File | null;
  highlightText?: string;
}

interface HighlightMatch {
  page: number;
  snippet: string;
}

async function findTextInPdf(file: File, searchText: string): Promise<HighlightMatch | null> {
  const normalized = searchText.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!normalized) return null;

  const data = await file.arrayBuffer();
  const pdf = await getDocument({ data }).promise;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .flatMap((item) => ("str" in item && typeof item.str === "string" ? [item.str] : []))
      .join(" ")
      .replace(/\s+/g, " ");

    if (pageText.toLowerCase().includes(normalized.toLowerCase())) {
      return { page: pageNum, snippet: normalized };
    }
  }

  return null;
}

export function PdfViewer({ file, highlightText }: PdfViewerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [match, setMatch] = useState<HighlightMatch | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const blobUrl = URL.createObjectURL(file);
    setUrl(blobUrl);
    return () => URL.revokeObjectURL(blobUrl);
  }, [file]);

  useEffect(() => {
    if (!file || !highlightText) {
      setMatch(null);
      return;
    }
    findTextInPdf(file, highlightText)
      .then(setMatch)
      .catch(() => setMatch(null));
  }, [file, highlightText]);

  useEffect(() => {
    if (!url || !match || !iframeRef.current) return;
    iframeRef.current.src = `${url}#page=${match.page}`;
  }, [url, match]);

  if (!file || !url) {
    return (
      <div className="pdf-viewer pdf-viewer--empty">
        <p className="pdf-viewer__empty-label">Source PDF unavailable</p>
        <p className="pdf-viewer__empty-hint">Re-upload the document to view it alongside extracted fields.</p>
      </div>
    );
  }

  return (
    <div className="pdf-viewer">
      <div className="pdf-viewer__header">
        <span className="pdf-viewer__title">Source document</span>
        <span className="pdf-viewer__filename">{file.name}</span>
      </div>
      {highlightText && (
        <div className="pdf-viewer__highlight-bar">
          <span className="pdf-viewer__highlight-label">Selected citation:</span>
          <span className="pdf-viewer__highlight-text">{highlightText}</span>
          {match && <span className="pdf-viewer__highlight-page">Page {match.page}</span>}
        </div>
      )}
      <iframe ref={iframeRef} className="pdf-viewer__frame" src={url} title={`Source PDF: ${file.name}`} />
    </div>
  );
}
