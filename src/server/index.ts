import { serve } from "bun";
import index from "../client/index.html";
import { runExtractionPipeline } from "./extractors/pipeline";

const server = serve({
  port: 3100,
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/extract/pdf": {
      async POST(req) {
        const form = await req.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
          return Response.json({ error: "No file provided" }, { status: 400 });
        }
        if (file.type !== "application/pdf") {
          return Response.json({ error: "Only PDF files are accepted" }, { status: 422 });
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
