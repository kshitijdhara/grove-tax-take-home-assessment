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

interface TextHighlightRect {
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

async function findTextHighlight(file: File, searchText: string): Promise<{ match: HighlightMatch | null; rect: TextHighlightRect | null }> {
  const normalized = searchText.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!normalized) return { match: null, rect: null };

  const data = await file.arrayBuffer();
  const pdf = await getDocument({ data }).promise;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });

    const items = textContent.items.flatMap((item) => {
      if (!("str" in item) || typeof item.str !== "string") return [];
      if (!("transform" in item) || !Array.isArray(item.transform)) return [];
      return [{ str: item.str, transform: item.transform }];
    });

    const pageText = items.map((item) => item.str).join(" ").replace(/\s+/g, " ");
    if (!pageText.toLowerCase().includes(normalized.toLowerCase())) continue;

    const needle = normalized.split(" ").find((part) => part.length >= 4) ?? normalized;
    const hit = items.find((item) => item.str.toLowerCase().includes(needle.toLowerCase()));
    if (hit) {
      const x = hit.transform[4] ?? 0;
      const y = hit.transform[5] ?? 0;
      const height = Math.abs(hit.transform[3] ?? 12);
      return {
        match: { page: pageNum, snippet: normalized },
        rect: {
          page: pageNum,
          left: (x / viewport.width) * 100,
          top: (1 - (y / viewport.height)) * 100,
          width: 20,
          height: (height / viewport.height) * 100,
        },
      };
    }

    return { match: { page: pageNum, snippet: normalized }, rect: null };
  }

  return { match: null, rect: null };
}

export function PdfViewer({ file, highlightText }: PdfViewerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [match, setMatch] = useState<HighlightMatch | null>(null);
  const [rect, setRect] = useState<TextHighlightRect | null>(null);
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
      setRect(null);
      return;
    }
    findTextHighlight(file, highlightText)
      .then(({ match: m, rect: r }) => {
        setMatch(m);
        setRect(r);
      })
      .catch(() => {
        setMatch(null);
        setRect(null);
      });
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
      <div className="pdf-viewer__frame-wrap">
        <iframe ref={iframeRef} className="pdf-viewer__frame" src={url} title={`Source PDF: ${file.name}`} />
        {rect && (
          <div
            className="pdf-viewer__highlight-rect"
            style={{
              left: `${rect.left}%`,
              top: `${rect.top}%`,
              width: `${rect.width}%`,
              height: `${Math.max(rect.height, 2)}%`,
            }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}
