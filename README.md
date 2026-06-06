# Tax Document Extractor — Grove Tax Take-Home

A full-stack application that extracts structured tax data from uploaded PDF documents (W-2, 1099-NEC, 1099-INT, 1099-DIV) using a hybrid regex + AI pipeline.

---

## Running the app

```bash
bun install
```

Create a `.env` file in the project root:

```
ANTHROPIC_API_KEY=sk-ant-...
```

The API key is optional — the app falls back to regex-only extraction when it's absent, with a lower confidence rating.

```bash
bun run dev      # development with HMR at http://localhost:3100
bun run start    # production
```

---

## What was built

### Extraction pipeline (`src/server/extractors/`)

The core problem is that tax PDFs vary enormously in how their text is embedded — a digitally generated Gusto W-2, a scanned W-2 from the mail, and an ADP multi-copy W-2 are three completely different extraction challenges.

The pipeline has three stages, each progressively more expensive:

```
PDF upload
  │
  ├─ pdf-parse → extract text
  │
  ├─ text < 500 meaningful chars?
  │     └─ Claude Vision (Sonnet) ← scanned / photographed docs
  │
  ├─ Identify document type (fuzzy IRS label matching)
  │
  ├─ Regex extractor (free, <10ms)
  │     └─ confidence = found / required fields
  │
  ├─ score ≥ 0.70 → return "Auto-verified"
  │
  └─ score < 0.70 → Claude Haiku fallback → return "Needs review"
```

**Why regex first, not pure AI?**
At Grove Tax's likely volume — even a few thousand W-2s per filing season — calling Claude for every document would cost ~$0.50–2.00 per document depending on length. Regex is free and handles ~80% of digitally-generated PDFs with high accuracy. The AI stages exist for the documents regex can't handle cleanly, not as the default path.

### W-2 extractor (`src/server/extractors/w2.ts`)

The W-2 extractor works without knowing which payroll processor generated the document. Rather than branching on "ADP vs Gusto vs Workday", it layers three layout strategies that describe how values relate to their labels in the extracted text:

- **Sequential** — label then value (Gusto, Workday, Ceridian, most standard PDFs)
- **Reversed** — value appears before its label (`findAmountBeforeLabel`) — common in ADP multi-section earnings summaries
- **Space-separated** — amounts written as `"14 194 65"` instead of `"14,194.65"` (`findSpaceSeparatedAmount`) — ADP multi-copy format

Each field tries strategies in order. If a strategy doesn't match the document's layout it returns null and the next one is tried. Adding support for a new payroll processor means adding a new pattern, not a new branch. 

**Coverage:** All 20 W-2 boxes (1–20, a–f, d), Box 12 codes (all IRS-defined), Box 14 SUI/SDI/LST, locality name full-text resolution from address context (e.g. "PITTS" → "PITTSBURGH" via PSD code lookup in address section), "Applied For" SSN detection.

### 1099 extractors

1099-NEC, 1099-INT, and 1099-DIV use IRS standard label patterns that work across all processors without modification. Unlike W-2, 1099 PDFs don't exhibit the multi-column layout problems that make W-2 extraction hard.

### Trust signals

The biggest footgun in automated tax data extraction is silent failure — returning a value that looks plausible but is wrong. Three mechanisms address this:

1. **Confidence badge** — "Auto-verified" (regex found all required fields) vs "Needs review" (AI was needed, preparer should cross-check)
2. **Missing fields section** — when required boxes like Box 4 (SS tax withheld) and Box 6 (Medicare tax withheld) aren't present in the PDF's text layer (common in ADP multi-copy format), they appear explicitly as "Not Found — Verify Manually" rather than being silently absent
3. **Warning banner** — if the AI fallback was attempted but failed, the UI shows the partial regex result with a visible warning rather than either hiding the data or throwing a generic error

### Persistence

Extractions are stored in `localStorage` (last 20 documents) with timestamp and filename. Clicking any history entry reopens the full result in a modal. There's no backend persistence or user accounts.

In production this would be an `extractions` table keyed on `user_id`, added once auth is in place. The client-side approach works for a demo because there's no user mapping problem to solve yet — everything is anonymous and single-browser.

---

## What's missing / next steps

**Multi-file extraction and aggregation.** The app handles one document at a time. A real tax preparation workflow needs two things the current version doesn't do:

1. *Batch extraction* — upload a folder of W-2s and 1099s, get back one `ExtractionResult` per document. This is straightforward to add: accept `multipart/form-data` with multiple files, run the pipeline on each in parallel, return an array.

2. *Aggregation across a taxpayer's documents* — sum Box 1 wages across multiple W-2s, add 1099-NEC income, produce a total gross income figure. This is the meaningful product feature, and it has design questions that aren't resolved yet: which fields aggregate, how do you handle different document types with incompatible schemas, where does state apportionment live. Deliberate next step, not an oversight.

**Per-field audit trail.** The current `TaxField` type has a `confidence` property but it's binary (high/low). In production you'd want to know *why* a field got low confidence — which pattern matched, what the raw text looked like. This feeds a correction UI where a preparer can override a value and that correction improves future extractions.

**Auth and multi-user.** Anonymous single-browser works for a demo but the real product needs user accounts so extractions persist across devices and can be linked to client records. Adding auth unlocks the extractions table, the correction feedback loop, and a preparer dashboard.

**Extraction accuracy feedback loop.** Today, when a regex fails and Claude is called, Claude's result is returned as-is. A better architecture runs both in parallel (Claude validates regex results), uses discrepancies to flag fields for human review, and routes confirmed corrections back to improve the regex patterns. This brings Claude's role closer to validation than fallback.

**Broader form support.** The current type system supports W-2, 1099-NEC, 1099-INT, 1099-DIV. Adding 1099-MISC (pre-2020, already routed to the NEC extractor), 1099-B (brokerage), Schedule K-1, and state forms would cover most individual filer use cases.

---

## Technical decisions

| Decision | Why |
|---|---|
| Bun instead of Node | Single runtime for server + bundler + test runner. No webpack config, no ts-node, no separate dev server. `Bun.serve()` handles routing, HMR, and TypeScript natively. |
| Regex before AI | Cost and latency. Regex is free and sub-10ms. Claude costs real money per call. The hybrid model keeps AI spend proportional to document complexity. |
| `pdf-parse` v2 | Class-based API works well with Bun. Handles both embedded-text and metadata extraction. Vision path handles everything it can't. |
| No processor detection | Early versions gated ADP-specific patterns behind `detectProcessor()`. This was wrong — it meant unknown processors got fewer strategies. The current approach runs all layout strategies unconditionally; patterns that don't match a document's layout return null silently. |
| `localStorage` for history | No backend required, no user mapping problem. Honest about what production needs (a real database) without over-engineering the demo. |
| `warning?` on ExtractionResult | AI fallback failures previously produced a generic error. The field lets the server communicate partial-success state to the UI without throwing, so preparers see what was extracted plus an explicit caution. |

---

## Stack

- **Runtime:** Bun 1.x
- **Frontend:** React 19, TypeScript strict
- **Styling:** CSS custom properties (token-based design system, Apple glassmorphism dark theme)
- **AI:** Anthropic SDK — `claude-haiku-4-5` for text fallback, `claude-sonnet-4-6` for Vision
- **PDF parsing:** `pdf-parse` v2
- **No framework:** no Express, no Vite, no Webpack — Bun's built-in server and bundler handle everything
