import { serve } from "bun";
import index from "../client/index.html";
import { runExtractionPipeline } from "./extractors/pipeline";
import type { ExtractionProgressEvent } from "@/shared/types";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

const requestLog = new Map<string, number[]>();

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (requestLog.get(ip) ?? []).filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) return true;
  recent.push(now);
  requestLog.set(ip, recent);
  return false;
}

async function validatePdfFile(file: File): Promise<void> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("File too large. Maximum size is 25 MB.");
  }
  if (file.type !== "application/pdf") {
    throw new Error("Only PDF files are accepted");
  }
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d;
  if (!isPdf) {
    throw new Error("File is not a valid PDF (bad header).");
  }
}

function ndjsonLine(event: ExtractionProgressEvent): string {
  return `${JSON.stringify(event)}\n`;
}

async function extractWithStream(file: File): Promise<Response> {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: ExtractionProgressEvent) => {
        controller.enqueue(encoder.encode(ndjsonLine(event)));
      };
      try {
        const result = await runExtractionPipeline(file, (stage) => send({ stage }));
        send({ stage: "complete", result });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Extraction failed";
        send({ stage: "complete", error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    },
  });
}

const pdfWorkerFile = Bun.file(
  new URL("../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)
);

const server = serve({
  port: Number(process.env.PORT ?? 3100),
  routes: {
    "/pdf.worker.min.mjs": () =>
      new Response(pdfWorkerFile, { headers: { "Content-Type": "application/javascript" } }),

    "/health": {
      GET: () =>
        Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } }),
    },

    "/api/extract/pdf": {
      async POST(req) {
        const ip = clientIp(req);
        if (isRateLimited(ip)) {
          return Response.json({ error: "Too many requests. Please wait a minute and try again." }, { status: 429 });
        }

        const contentLength = Number(req.headers.get("content-length") ?? 0);
        if (contentLength > MAX_UPLOAD_BYTES) {
          return Response.json({ error: "File too large. Maximum size is 25 MB." }, { status: 413 });
        }

        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
          return Response.json({ error: "No file provided" }, { status: 400 });
        }

        try {
          await validatePdfFile(file);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Invalid file";
          return Response.json({ error: message }, { status: 422 });
        }

        const wantsStream = req.headers.get("accept")?.includes("application/x-ndjson");
        if (wantsStream) {
          return extractWithStream(file);
        }

        try {
          const result = await runExtractionPipeline(file);
          return Response.json(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Extraction failed";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },

    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
