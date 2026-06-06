import "./FileUploader.css";
import { useState, useRef } from "react";
import type { DragEvent, ChangeEvent } from "react";
import type { ExtractionResult } from "@/shared/types";
import { DropZone } from "../../components/DropZone/DropZone";
import { Button } from "../../components/Button/Button";
import { ExtractionResultView } from "../../components/ExtractionResult/ExtractionResult";
import { VscFilePdf } from "react-icons/vsc";
import { CiCircleCheck } from "react-icons/ci";
import { MdErrorOutline } from "react-icons/md";

type UploadStatus = "idle" | "selected" | "uploading" | "success" | "error";

interface UploaderState {
  status: UploadStatus;
  file: File | null;
  result: ExtractionResult | null;
  errorMessage: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileUploaderProps {
  onSuccess?: (result: ExtractionResult, filename: string) => void;
}

export function FileUploader({ onSuccess }: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [state, setState] = useState<UploaderState>({
    status: "idle",
    file: null,
    result: null,
    errorMessage: "",
  });
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptFile = (file: File) => {
    if (file.size > 25 * 1024 * 1024) {
      setState({ status: "error", file: null, result: null, errorMessage: "File is too large (max 25 MB). Please compress the PDF and try again." });
      return;
    }
    if (file.type !== "application/pdf") {
      setState({ status: "error", file: null, result: null, errorMessage: "Only PDF files are supported. Please drop a .pdf file." });
      return;
    }
    setState({ status: "selected", file, result: null, errorMessage: "" });
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) acceptFile(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const handleBrowseClick = () => inputRef.current?.click();

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) acceptFile(file);
    e.target.value = "";
  };

  const handleUpload = async () => {
    if (!state.file) return;
    setState((s) => ({ ...s, status: "uploading" }));
    try {
      const form = new FormData();
      form.append("file", state.file);
      const res = await fetch("/api/extract/pdf", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Server error ${res.status}`);
      }
      const result = await res.json() as ExtractionResult;
      setState((s) => ({ ...s, status: "success", result }));
      onSuccess?.(result, state.file?.name ?? "document.pdf");
    } catch (err) {
      setState((s) => ({ ...s, status: "error", errorMessage: String(err) }));
    }
  };

  const handleReset = () => {
    setState({ status: "idle", file: null, result: null, errorMessage: "" });
    setIsDragging(false);
  };

  const { status, file, result, errorMessage } = state;

  return (
    <div className={`file-uploader${status === "success" && result ? " file-uploader--wide" : ""}`}>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="file-uploader__hidden-input"
        onChange={handleInputChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      {status === "idle" && (
        <DropZone
          isDragging={isDragging}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={handleBrowseClick}
        />
      )}

      {status === "selected" && file && (
        <div className="file-uploader__panel file-uploader__selected">
          <div className="file-uploader__file-row">
            <div className="file-uploader__pdf-badge" aria-hidden="true">
              <VscFilePdf size={32} color="#E53E3E" />
            </div>
            <div className="file-uploader__file-meta">
              <p className="file-uploader__file-name">{file.name}</p>
              <p className="file-uploader__file-size">{formatBytes(file.size)}</p>
            </div>
          </div>
          <div className="file-uploader__actions">
            <Button variant="ghost" onClick={handleReset}>Change file</Button>
            <Button variant="primary" onClick={handleUpload}>Extract data</Button>
          </div>
        </div>
      )}

      {status === "uploading" && (
        <div className="file-uploader__panel file-uploader__uploading">
          <div className="file-uploader__spinner" role="status" aria-label="Extracting data" />
          <p className="file-uploader__uploading-label">Extracting data…</p>
          {file && <p className="file-uploader__uploading-filename">{file.name}</p>}
        </div>
      )}

      {status === "success" && result && (
        <div className="file-uploader__panel file-uploader__success">
          <div className="file-uploader__success-header">
            <div className="file-uploader__status-icon" aria-hidden="true">
              <CiCircleCheck size={28} color="var(--success)" />
            </div>
            <p className="file-uploader__status-title">Extraction complete</p>
          </div>
          <ExtractionResultView result={result} />
          <div className="file-uploader__success-footer">
            <Button variant="ghost" onClick={handleReset}>Upload another file</Button>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="file-uploader__panel file-uploader__error-view">
          <div className="file-uploader__status-icon" aria-hidden="true">
            <MdErrorOutline size={36} color="var(--error)" />
          </div>
          <p className="file-uploader__status-title">Something went wrong</p>
          <p className="file-uploader__error-message">{errorMessage}</p>
          <Button variant="ghost" onClick={handleReset}>Try again</Button>
        </div>
      )}
    </div>
  );
}
