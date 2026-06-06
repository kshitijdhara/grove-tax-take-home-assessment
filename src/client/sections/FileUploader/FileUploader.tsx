import { useState, useRef } from "react";
import type { DragEvent, ChangeEvent } from "react";
import type { ExtractionResult, ProgressStage } from "@/shared/types";
import { hashFileContent } from "@/shared/contentHash";
import { assertNever } from "@/shared/assertNever";
import { isNode } from "../../utils/dom";
import { streamExtraction } from "../../utils/extractUpload";
import { ExtractionResultView, progressLabel } from "../../components/ExtractionResult/ExtractionResult";
import "./FileUploader.css";
import { DropZone } from "../../components/DropZone/DropZone";
import { Button } from "../../components/Button/Button";
import { VscFilePdf } from "react-icons/vsc";
import { CiCircleCheck } from "react-icons/ci";
import { MdErrorOutline } from "react-icons/md";

type QueueStatus = "pending" | "processing" | "done" | "error";

interface QueueItem {
  id: string;
  file: File;
  status: QueueStatus;
  result: ExtractionResult | null;
  errorMessage: string;
  progressStage: ProgressStage | null;
}

type UploadStatus = "idle" | "queued" | "processing" | "success" | "error";

interface UploaderState {
  status: UploadStatus;
  queue: QueueItem[];
  activeIndex: number;
  errorMessage: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createQueueItem(file: File): QueueItem {
  return {
    id: crypto.randomUUID(),
    file,
    status: "pending",
    result: null,
    errorMessage: "",
    progressStage: null,
  };
}

interface FileUploaderProps {
  onSuccess?: (result: ExtractionResult, filename: string, file: File, contentHash: string) => void;
  onBatchStart?: () => void;
  onBatchComplete?: () => void;
  edits?: Record<string, string>;
  onEditsChange?: (edits: Record<string, string>) => void;
  verified?: Record<string, boolean>;
  onVerifiedChange?: (verified: Record<string, boolean>) => void;
  clientName?: string;
  onClientNameChange?: (name: string) => void;
  pdfFile?: File | null;
}

export function FileUploader({
  onSuccess,
  onBatchStart,
  onBatchComplete,
  edits,
  onEditsChange,
  verified,
  onVerifiedChange,
  clientName,
  onClientNameChange,
  pdfFile,
}: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [state, setState] = useState<UploaderState>({
    status: "idle",
    queue: [],
    activeIndex: 0,
    errorMessage: "",
  });
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptFiles = (files: FileList | File[]) => {
    const pdfFiles = [...files].filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (pdfFiles.length === 0) {
      setState({ status: "error", queue: [], activeIndex: 0, errorMessage: "Only PDF files are supported." });
      return;
    }
    const tooLarge = pdfFiles.find((f) => f.size > 25 * 1024 * 1024);
    if (tooLarge) {
      setState({ status: "error", queue: [], activeIndex: 0, errorMessage: `${tooLarge.name} exceeds 25 MB limit.` });
      return;
    }
    setState({
      status: "queued",
      queue: pdfFiles.map(createQueueItem),
      activeIndex: 0,
      errorMessage: "",
    });
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) acceptFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    const related = e.relatedTarget;
    if (!isNode(related) || !e.currentTarget.contains(related)) {
      setIsDragging(false);
    }
  };

  const handleBrowseClick = () => inputRef.current?.click();

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) acceptFiles(e.target.files);
    e.target.value = "";
  };

  const processQueue = async () => {
    onBatchStart?.();
    setState((s) => ({ ...s, status: "processing" }));

    const items = await new Promise<QueueItem[]>((resolve) => {
      setState((s) => {
        resolve(s.queue);
        return s;
      });
    });

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!item) continue;
      setState((s) => ({
        ...s,
        activeIndex: index,
        queue: s.queue.map((q, i) => (i === index ? { ...q, status: "processing", progressStage: "parsing" } : q)),
      }));

      try {
        const result = await streamExtraction({
          file: item.file,
          onProgress: (stage) => {
            setState((s) => ({
              ...s,
              queue: s.queue.map((q, i) => (i === index ? { ...q, progressStage: stage } : q)),
            }));
          },
        });
        const contentHash = await hashFileContent(item.file);
        onSuccess?.(result, item.file.name, item.file, contentHash);
        setState((s) => ({
          ...s,
          queue: s.queue.map((q, i) =>
            i === index ? { ...q, status: "done", result, progressStage: "complete" } : q
          ),
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        setState((s) => ({
          ...s,
          queue: s.queue.map((q, i) =>
            i === index ? { ...q, status: "error", errorMessage: message, progressStage: null } : q
          ),
        }));
      }
    }

    setState((s) => ({ ...s, status: "success", activeIndex: items.length - 1 }));
    onBatchComplete?.();
  };

  const handleReset = () => {
    setState({ status: "idle", queue: [], activeIndex: 0, errorMessage: "" });
    setIsDragging(false);
  };

  const { status, queue, activeIndex, errorMessage } = state;
  const activeItem = queue[activeIndex] ?? null;
  const activeResult = activeItem?.result ?? null;

  const renderPanel = () => {
    switch (status) {
      case "idle":
        return (
          <DropZone
            isDragging={isDragging}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={handleBrowseClick}
          />
        );
      case "queued":
        return (
          <div className="file-uploader__panel file-uploader__selected">
            <p className="file-uploader__queue-title">{queue.length} PDF{queue.length === 1 ? "" : "s"} ready</p>
            <ul className="file-uploader__queue-list">
              {queue.map((item) => (
                <li key={item.id} className="file-uploader__queue-item">
                  <VscFilePdf size={20} color="#E53E3E" />
                  <span>{item.file.name}</span>
                  <span className="file-uploader__file-size">{formatBytes(item.file.size)}</span>
                </li>
              ))}
            </ul>
            <div className="file-uploader__actions">
              <Button variant="ghost" onClick={handleReset}>Clear</Button>
              <Button variant="primary" onClick={processQueue}>Extract all</Button>
            </div>
          </div>
        );
      case "processing":
        return (
          <div className="file-uploader__panel file-uploader__uploading">
            <div className="file-uploader__spinner" role="status" aria-label="Extracting data" />
            <p className="file-uploader__uploading-label">
              {activeItem?.progressStage ? progressLabel(activeItem.progressStage) : "Extracting…"}
            </p>
            {activeItem && (
              <p className="file-uploader__uploading-filename">
                {activeIndex + 1}/{queue.length}: {activeItem.file.name}
              </p>
            )}
            <ul className="file-uploader__queue-list file-uploader__queue-list--compact">
              {queue.map((item) => (
                <li key={item.id} className={`file-uploader__queue-item file-uploader__queue-item--${item.status}`}>
                  {item.file.name} — {item.status}
                </li>
              ))}
            </ul>
          </div>
        );
      case "success":
        return activeResult ? (
          <div className="file-uploader__panel file-uploader__success">
            <div className="file-uploader__success-header">
              <div className="file-uploader__status-icon" aria-hidden="true">
                <CiCircleCheck size={28} color="var(--success)" />
              </div>
              <p className="file-uploader__status-title">
                Extraction complete ({queue.filter((q) => q.status === "done").length}/{queue.length})
              </p>
            </div>
            {queue.length > 1 && (
              <div className="file-uploader__queue-tabs">
                {queue.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`file-uploader__queue-tab${index === activeIndex ? " file-uploader__queue-tab--active" : ""}`}
                    onClick={() => setState((s) => ({ ...s, activeIndex: index }))}
                  >
                    {item.file.name}
                  </button>
                ))}
              </div>
            )}
            <ExtractionResultView
              result={activeResult}
              pdfFile={activeItem?.file ?? pdfFile ?? null}
              edits={edits}
              onEditsChange={onEditsChange}
              verified={verified}
              onVerifiedChange={onVerifiedChange}
              clientName={clientName}
              onClientNameChange={onClientNameChange}
            />
            <div className="file-uploader__success-footer">
              <Button variant="ghost" onClick={handleReset}>Upload more</Button>
            </div>
          </div>
        ) : null;
      case "error":
        return (
          <div className="file-uploader__panel file-uploader__error-view">
            <div className="file-uploader__status-icon" aria-hidden="true">
              <MdErrorOutline size={36} color="var(--error)" />
            </div>
            <p className="file-uploader__status-title">Something went wrong</p>
            <p className="file-uploader__error-message">{errorMessage}</p>
            <Button variant="ghost" onClick={handleReset}>Try again</Button>
          </div>
        );
      default:
        return assertNever(status);
    }
  };

  return (
    <div className={`file-uploader${status === "success" && activeResult ? " file-uploader--wide" : ""}`}>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="file-uploader__hidden-input"
        onChange={handleInputChange}
        aria-hidden="true"
        tabIndex={-1}
      />
      {renderPanel()}
    </div>
  );
}
