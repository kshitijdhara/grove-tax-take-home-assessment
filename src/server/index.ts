import { serve } from "bun";
import index from "../client/index.html";
import { runExtractionPipeline } from "./extractors/pipeline";

const server = serve({
  port: Number(process.env.PORT ?? 3100),
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/extract/pdf": {
      async POST(req) {
        const contentLength = Number(req.headers.get("content-length") ?? 0);
        if (contentLength > 25 * 1024 * 1024) {
          return Response.json({ error: "File too large. Maximum size is 25 MB." }, { status: 413 });
        }
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
          return Response.json({ error: "No file provided" }, { status: 400 });
        }
        if (file.type !== "application/pdf") {
          return Response.json({ error: "Only PDF files are accepted" }, { status: 422 });
        }
        // Content sniffing: a real PDF begins with the "%PDF-" magic bytes. The MIME type
        // is client-supplied and trivially spoofed, so verify the actual file header — a
        // renamed executable should never reach the parser.
        const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
        const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d;
        if (!isPdf) {
          return Response.json({ error: "File is not a valid PDF (bad header)." }, { status: 422 });
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
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
