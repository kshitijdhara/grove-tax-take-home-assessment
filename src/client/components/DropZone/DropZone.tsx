import "./DropZone.css";
import type { DragEvent } from "react";
import { TfiCloudUp } from "react-icons/tfi";


interface DropZoneProps {
  isDragging: boolean;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  onClick: () => void;
}

export function DropZone({ isDragging, onDrop, onDragOver, onDragLeave, onClick }: DropZoneProps) {
  return (
    <div
      className={`drop-zone${isDragging ? " drop-zone--dragging" : ""}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label="Drop a PDF file here, or press Enter to browse"
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
    >
      <div className="drop-zone__icon" aria-hidden="true">
        <TfiCloudUp size={48} />
      </div>
      <p className="drop-zone__title">
        {isDragging ? "Release to upload" : "Drop your PDF here"}
      </p>
      <p className="drop-zone__subtitle">W-2 · 1099-NEC · 1099-INT · 1099-DIV</p>
    </div>
  );
}
