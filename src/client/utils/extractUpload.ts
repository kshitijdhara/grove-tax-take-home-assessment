import type { ExtractionProgressEvent, ExtractionResult } from "@/shared/types";
import { parseApiErrorBody, parseExtractionResult } from "@/shared/parseExtraction";

const UPLOAD_TIMEOUT_MS = 45_000;

function isProgressStage(value: string): value is ExtractionProgressEvent["stage"] {
  return value === "parsing" || value === "identifying" || value === "extracting" || value === "validating" || value === "complete";
}

function parseProgressLine(line: string): ExtractionProgressEvent | null {
  try {
    const parsed = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null || !("stage" in parsed)) return null;
    if (typeof parsed.stage !== "string" || !isProgressStage(parsed.stage)) return null;

    const event: ExtractionProgressEvent = { stage: parsed.stage };
    if ("error" in parsed && typeof parsed.error === "string") event.error = parsed.error;
    if ("result" in parsed && typeof parsed.result === "object" && parsed.result !== null) {
      event.result = parseExtractionResult(parsed.result);
    }
    return event;
  } catch {
    return null;
  }
}

export interface StreamExtractionOptions {
  file: File;
  onProgress: (stage: ExtractionProgressEvent["stage"]) => void;
  signal?: AbortSignal;
}

export async function streamExtraction({
  file,
  onProgress,
  signal,
}: StreamExtractionOptions): Promise<ExtractionResult> {
  const form = new FormData();
  form.append("file", file);

  const timeout = AbortSignal.timeout(UPLOAD_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const res = await fetch("/api/extract/pdf", {
    method: "POST",
    body: form,
    headers: { Accept: "application/x-ndjson" },
    signal: combined,
  });

  if (!res.ok) {
    const rawBody = await res.json().catch(() => ({}));
    const body = typeof rawBody === "object" && rawBody !== null ? parseApiErrorBody(rawBody) : {};
    throw new Error(body.error ?? `Server error ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("Server returned an empty response");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = parseProgressLine(line);
      if (!event) continue;
      onProgress(event.stage);
      if (event.error) throw new Error(event.error);
      if (event.stage === "complete" && event.result) {
        return event.result;
      }
    }
  }

  throw new Error("Extraction stream ended without a result");
}
