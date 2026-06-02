import { serve } from "bun";
import index from "../client/index.html";

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },

    "/api/extract/pdf": {
      async POST(req) {
        const form = await req.formData();
        const file = form.get("file");
        return Response.json({
          filename: file instanceof File ? file.name : "unknown",
          pages: 4,
          extracted_fields: {
            taxpayer_name: "Jane Doe",
            ssn_last_four: "5678",
            tax_year: 2024,
            filing_status: "Single",
            total_income: 92450.00,
            adjusted_gross_income: 87320.00,
            taxable_income: 74820.00,
            total_tax: 12845.00,
            federal_tax_withheld: 14200.00,
            refund_amount: 1355.00,
          },
        });
      },
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
