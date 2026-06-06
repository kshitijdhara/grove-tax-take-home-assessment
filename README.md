# Tax Document Extractor — Grove Tax Take-Home

Upload a tax document (W-2, 1099-NEC, 1099-INT, 1099-DIV), get back structured, **source-traceable, correctable** data that a preparer can actually push into downstream software — not just a pretty JSON dump.

- **Live demo:** `[HOSTED_URL]`
- **Code:** `[GITHUB_URL]`
- **Time spent:** `[~16 hours across a few focused sessions]` — extraction engine ate ~60% of it, which is exactly where the hard part lives.

---

## TL;DR for the person with 90 seconds

I built a hybrid extraction pipeline: **regex first (free, ~10ms), Claude as a fallback (paid, slower), and arithmetic sanity checks on top.** Then I spent most of my energy on the thing the brief actually cares about — **trust**: every value is traceable to the source text, every value is editable before it leaves the tool, and nothing fails silently. The badges don't lie, the missing fields aren't hidden, and the AI is treated like a brilliant intern whose work you still check.

What I consciously did **not** build: multi-document client workpapers with income roll-ups, auth, and a real database. Those are the next layer, and I'll tell you exactly how I'd build them rather than pretend a weekend closes them.

If you read one section, read **[Trust: the whole point](#trust-the-whole-point)**.

---

## Quickstart

```bash
bun install
```

Create a `.env` (Bun loads it automatically — no `dotenv`):

```
ANTHROPIC_API_KEY=sk-ant-...   # optional
```

The key is **optional by design**. No key → the app runs regex-only and labels its own lower confidence honestly. It degrades; it doesn't break.

```bash
bun run dev      # HMR dev server at http://localhost:3100
bun run start    # production
bun run build    # static client bundle → dist/
```

---

## The problem, stated honestly

Tax-document extraction sounds like a solved problem until you open the actual PDFs. Then you discover that "the text layer" is a polite fiction:

- A **Gusto** W-2 is clean, sequential, digitally generated. Lovely. Rare.
- An **ADP** multi-copy W-2 interleaves three copies of the form, scatters amounts *before* their labels, writes `14,194.65` as `14 194 65` to dodge column alignment, and prints the same number four times so you can't tell Box 3 from Box 5 from Box 16 by value alone.
- A **photo of a W-2 someone took on their phone** and "saved as PDF" has no text layer at all.

So the real problem isn't parsing — it's **parsing untrustworthy input for a user who is legally liable for the output.** A preparer signs the return. If Box 1 is wrong and they didn't catch it, that's their license, not ours. That single fact drove every decision below.

---

## Architecture & data flow

```
        ┌─────────────┐
PDF ───▶│  parsePdf   │  pdf-parse v2 → raw text
        └──────┬──────┘
               │
        meaningful chars < 500 ?  ──── yes ───▶ Claude Vision (Sonnet)   [scanned / photo]
               │ no
               ▼
        ┌─────────────┐
        │ identifyDoc │  fuzzy IRS-label matching → W-2 | 1099-NEC | INT | DIV
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │ regex extract│  layout-strategy engine, ~10ms, free
        └──────┬──────┘
               │  confidence = required fields found / total
               │
      score ≥ 0.70 ──▶ "Auto-verified"  (then arithmetic checks may downgrade individual boxes)
               │
      score < 0.70 ──▶ Claude Haiku fallback ──▶ "Needs review"
                              │ on failure
                              ▼
                       partial regex result + visible warning banner
```

The shape of this matters: **cost and risk both increase as you move down.** Regex is free and runs always. Haiku is cheap and runs sometimes. Sonnet Vision is expensive and runs only when there's literally no text to read. The pipeline spends money in proportion to how hard the document is.

---

## Every decision, and why

### 1. Bun over Node
One runtime for server, bundler, test runner, and `.env` loading. `Bun.serve()` does routing + HMR + native TypeScript with zero config. No webpack, no Vite, no ts-node, no `dotenv`. The whole toolchain is one binary, which means the "works on my machine" surface area is tiny. **Tradeoff:** Bun is younger than Node; some libraries assume Node internals. I hit zero of those here, but in production I'd pin the Bun version and keep a Node escape hatch in mind. I leaned on the Bun docs heavily for `Bun.serve` routes and the HTML-import bundling — it's genuinely well-documented.

### 2. Regex first, AI second — the hybrid
This is the load-bearing decision, so here's the actual math. At a firm's volume — say a few thousand W-2s a season — calling an LLM for *every* document is **$0.50–$2.00 each** depending on length. Regex is **$0.00 and ~10ms**, and it nails ~80% of clean digital PDFs. So:

- **Regex handles the common case** for free.
- **Claude handles the long tail** — messy layouts, scanned images — where regex's confidence drops below 0.70.
- **AI spend scales with document difficulty, not document count.** That's the whole game.

**Tradeoff:** regex's failure mode is nasty. It doesn't fail loudly — it confidently returns a *plausible-but-wrong* value. Which is exactly why the next two decisions exist.

### 3. Layout strategies, not processor detection
My first instinct (and the AI's first suggestion) was `detectProcessor()` — sniff out "this is ADP" and run ADP-specific patterns. **I threw that out.** It's the wrong abstraction: it means every new payroll provider is a code change, and an unrecognized provider gets *fewer* strategies and worse results — the opposite of what you want.

The correct invariant is that **a W-2 is a W-2** — the IRS mandates the boxes. What varies is *layout*, not identity. So `w2.ts` runs a small set of layout strategies unconditionally:

- **Sequential** — label then value (most clean PDFs)
- **Reversed** — value *before* its label (`findAmountBeforeLabel`; ADP earnings summaries)
- **Space-separated** — `14 194 65` → `14,194.65` (`findSpaceSeparatedAmount`)
- **Interleaved** — three-copy repetition disambiguated by structure

A strategy that doesn't match the document's layout returns `null` and the next one tries. A new provider with a new layout quirk is **one new pattern**, not a new branch. The processor's name never appears in the code.

### 4. Confidence is coverage — so I added accuracy checks
Here's a thing I want to be honest about because a reviewer will catch it otherwise: the 0.70 confidence score measures **coverage** (did we find the required fields?), not **accuracy** (are the values right?). A W-2 that finds all six required fields but misreads Box 1 still scores 1.0.

You can't fully fix that with regex. But you *can* exploit the fact that tax forms have **known arithmetic relationships**:

- Box 4 (SS tax) ≈ Box 3 (SS wages) × 6.2%
- Box 6 (Medicare tax) ≈ Box 5 (Medicare wages) × 1.45%

So after extraction, `w2.ts` checks those ratios. If Box 4 isn't ~6.2% of Box 3, that field gets **downgraded to low confidence** and rendered with a red row + warning dot. This is the first check in the whole pipeline that validates *correctness* rather than *presence*, and it's exactly the kind of domain logic a tax tool should have. **Tradeoff / honest gap:** it only covers the boxes with arithmetic siblings. Box 1 and Box 2 have no such relationship, so a wrong-but-plausible value there still reads green. The real fix is parallel AI validation (see [What "complete" looks like](#what-complete-actually-looks-like)).

### 5. Source traceability — Grove's actual north star
Grove's pitch is "every extracted value traceable to source." So every field carries a `sourceText`:

- **Regex path:** `captureContext()` grabs ~100 chars around the matched value. Crucially it uses **`lastIndexOf`, not `indexOf`** — because on an ADP form the same number appears in the earnings summary *and* the real box section, and the box section comes later. First-occurrence would point the preparer at the wrong line and quietly destroy the trust we're trying to build. This was a real bug I caught and fixed.
- **AI path:** the Claude tool schema and both system prompts require a short verbatim `sourceText` quote per field, and on the text path the server **verifies every quote actually appears in the source** (`verifySourceText`) — a citation we can't find in the document gets dropped rather than shown, because a fabricated provenance claim is worse than none. So AI-extracted values are traceable too, not just the regex ones.

Click any field in the UI → the source snippet expands. **Known ceiling (stated plainly):** the snippet is raw PDF-layer text, which is correct but not always *legible* to someone who's never seen what `pdf-parse` output looks like. True source traceability wants a rendered PDF with a bounding-box highlight. That's a real feature, deliberately out of scope, named here so it's a decision and not an oversight.

### 6. Trust: the whole point
The single worst outcome for this product is a **silent wrong value**. Everything here exists to make wrongness *loud*:

- **Honest badges.** "Auto-verified" / "Needs review" — and they carry tooltips that say what they actually mean ("found by pattern matching — not arithmetically verified"). The badge makes no claim the system can't back up.
- **Missing fields are visible, not absent.** When ADP's multi-copy layout doesn't embed Box 4/6 as text, they appear in a **"Not Found — Enter Manually"** section with an input, so the preparer keys the value from their paper copy and it flows straight into the exports. The tool never pretends a field doesn't exist just because it couldn't read it.
- **Failures degrade, not crash.** If the AI fallback errors out, you get the partial regex result plus a yellow warning banner — never a blank screen or a lie.
- **30-second API timeouts** on both Claude calls so a slow upstream becomes a clear error, not an infinite spinner.

### 7. Correction loop — edit before export, and it persists
A preparer who spots a wrong value needs to fix it *here*, not download-edit-in-Excel-reupload. So values are **double-click-editable inline**, edited values are visually marked, and — the part that matters — **edits persist to `localStorage`** alongside the extraction. Reload the page, reopen from history, your corrections are still there. An edit feature that silently loses edits is worse than no edit feature; this one doesn't.

### 8. Downstream: two exports, zero fabrication
The brief says "get that data into tax software downstream," so there are two export shapes:

- **Download CSV** — human-readable vertical sheet with an `Edited` column and any manually-entered missing fields. Good for archive and review.
- **Export row** — **one row per form, columns are fields.** This is the shape import mappers actually consume.

I deliberately **did not invent proprietary Drake/Lacerte field codes** I couldn't verify, because shipping a confidently-wrong import format to a tax tool is the exact sin this whole project is fighting. The row-per-form CSV is the honest, standard answer. And the highest-bandwidth path today is even simpler: every field has a **one-click copy button**, because the real-world preparer workflow is "copy value, paste into the software's W-2 screen."

### 9. Client/matter naming — a nod to the real workflow
After extraction you can label the document with a client name. The history panel then reads as a **workpaper list** ("Smith, John — W-2 2024 — 2 edited") instead of a pile of filenames. This is a deliberate gesture toward Grove's collect → workpapers loop without pretending I built the whole multi-document workpaper system (I didn't — see below).

### 10. `localStorage`, not a database
No backend persistence, no auth. **On purpose.** There's no user to key data to yet, so a database would be ceremony without substance. `localStorage` gives history + persisted edits with zero infra, and the README is honest that production wants an `extractions` table keyed on `user_id`. **Tradeoff:** single-browser, ~5MB cap, and the save path swallows `QuotaExceededError` silently (fine for 20 small entries, acknowledged as a rough edge).

---

## Current state of the code

```
src/
├── shared/types.ts            # ExtractionResult, TaxField (+sourceText), MissingField — the contract
├── server/
│   ├── index.ts               # Bun.serve routes; 25MB upload guard; /api/extract/pdf
│   └── extractors/
│       ├── pipeline.ts        # orchestration: vision-vs-text, confidence gate, AI fallback, timeouts
│       ├── parsePdf.ts        # pdf-parse v2 wrapper
│       ├── identifyDocument.ts# fuzzy IRS-label doc-type detection (incl. 1099-MISC → NEC)
│       ├── helpers.ts         # MONEY regex, findMoney/findText, formatMoney, captureContext
│       ├── w2.ts              # the hard one: layout strategies, all 20 boxes, ratio validation
│       ├── 1099nec|int|div.ts # IRS-label extractors (share helpers.ts)
│       ├── claudeFallback.ts  # Haiku text extraction via tool-use; shape-validated; 30s timeout
│       └── claudeVision.ts    # Sonnet vision for scanned PDFs; 20MB guard; 30s timeout
└── client/
    ├── pages/Home             # owns history + active-entry wiring
    ├── sections/FileUploader  # upload state machine; 25MB client guard; threads edit/client props
    ├── components/
    │   ├── ExtractionResult   # the result view: fields/JSON toggle, editing, exports, traceability
    │   ├── HistoryPanel       # workpaper list + modal (reads live entry so edits reflect instantly)
    │   └── DropZone, Button   # primitives
    └── hooks/useExtractionHistory.ts  # localStorage CRUD: addEntry/updateEntry/clearHistory
```

Type-checks clean (`bunx tsc --noEmit`), builds clean (`bun run build`), TypeScript strict throughout. Dead code from earlier iterations (six unused component dirs, a `detectProcessor` module, stray API routes) was removed rather than left to rot.

---

## Tradeoffs, ruthlessly

| Decision | What I gained | What I gave up |
|---|---|---|
| Regex-first hybrid | ~free, ~10ms on the 80% case | regex can be confidently wrong; needs the arithmetic checks to compensate |
| Layout strategies vs processor detection | new providers = one pattern, not a branch | slightly more patterns running per field (negligible cost) |
| Coverage-based confidence | dead simple, transparent | doesn't measure accuracy; only ratio-checked boxes catch bad values |
| `captureContext` text snippet | traceability with zero extra infra | raw PDF text isn't fully preparer-legible; wants bbox highlighting |
| AI `sourceText` | AI values traceable too, and **server-verified against source** (text path) | vision path can't be string-verified (no text layer), only PII-redacted |
| `localStorage` persistence | zero infra, edits survive reload | single-browser, 5MB cap, silent quota failure |
| Row CSV instead of Drake codes | honest, standard, no fabricated formats | not a turnkey import for a specific vendor yet |
| Single-document tool | shipped a solid primitive | no client-level multi-doc workpaper / roll-up |

---

## What "complete" actually looks like

Given more time, more context (real Grove import targets, a corpus of real forms), and more test cases, here's what I'd build, in priority order:

1. **Parallel validation instead of fallback.** Run regex and Claude *together* on every document; where they agree, confidence is real; where they disagree, flag the field for human review. This kills the "confidently wrong Box 1" failure mode that the arithmetic checks can't reach. Claude becomes a *validator*, not just a rescuer. This is the single biggest accuracy lever left.
3. **Multi-document client workpapers.** The honest big one. A taxpayer is a W-2 + three 1099s + a mortgage statement. I'd group documents under a client, run extraction in parallel, and roll up totals (sum Box 1 across W-2s, add NEC income → gross income). This is Grove's actual loop and the thing I most consciously scoped out. The `clientName` field is the seam I left for it.
4. **Deduplication.** Grove lists it explicitly. Hash document content; if the same W-2 lands twice, merge instead of duplicating.
5. **Rendered-PDF source highlighting.** Replace the raw-text snippet with a bounding-box highlight on a rendered page. This needs positional data from the parser (e.g. `pdfjs` text-item coordinates), which is why it's a real project, not a tweak.
6. **A real test corpus.** Right now correctness is validated against the handful of real forms I had. "Complete" means a labeled fixture set per provider × form type, with golden-file assertions in `bun test`, so a regex change that fixes ADP and breaks Gusto fails CI instead of a demo.
7. **Vendor-specific exports** (Drake, Lacerte, UltraTax) once I can verify the actual field-code schemas — not before.

---

## Production readiness: performance, security, scale

**Performance**
- Regex path is ~10ms; the user-perceived latency is almost entirely the PDF parse + (if invoked) the Claude round-trip. I'd stream a progress state for the AI path and cache parsed text so a re-run of the same upload skips parsing.
- `pdf-parse` is synchronous-ish CPU work; under load I'd move parsing to a worker pool so a 40-page PDF doesn't block the event loop.
- The client bundle is ~420KB; fine for a tool, but code-splitting the JSON/vision-only paths would trim first paint.

**Security** (this one's load-bearing for tax data — PII everywhere)
- **Never persist SSNs in full.** The pipeline keeps only `ssn_last4`, and every source-text snippet (regex *and* AI) runs through `redactPII` before it can be shown or stored — full SSNs and bare 9-digit runs are masked to their last four. EINs are left intact (employer identifiers, not taxpayer PII, and the preparer needs them).
- Uploads are size-guarded (25MB at the edge + client), MIME-checked, **and content-sniffed** — the handler verifies the `%PDF-` magic bytes so a renamed `.exe` can't masquerade as a PDF and reach the parser. Next step: run parsing in a sandboxed worker, since PDF parsers are a classic exploit surface.
- API key lives server-side only; the client never sees Anthropic credentials. In production: secrets manager, not `.env`.
- Add rate limiting + auth before this touches a real network; right now the endpoint is open by design for a local demo.
- `localStorage` is the wrong place for PII long-term — production moves to an encrypted-at-rest DB with per-user access control and an audit log of who viewed/edited what (tax firms need that trail).

**Scalability**
- The extraction pipeline is stateless and pure (`text in → result out`), so it scales horizontally trivially — put it behind a queue, fan out workers. The only shared state is `localStorage`, which becomes a database the moment there's auth.
- Claude calls are the cost/throughput bottleneck; batching, caching by document hash, and the regex-first gate already keep that spend bounded.
- Document-type extractors are independent modules, so adding forms is additive, not a rewrite.

**Observability** (what I'd add day one in prod)
- Per-field extraction-method + confidence logging, so you can answer "what's our Box 1 accuracy on ADP forms this month?"
- Track regex-vs-AI hit rate and AI spend per document type — that's the dashboard that tells you where to write the next regex pattern.

---

## Tools & AI stack — how this actually got made

**Research & references.** I leaned on primary docs rather than vibes: the **Bun docs** for `Bun.serve` routing and HTML-import bundling, the **`pdf-parse` v2** API for the class-based extraction interface, and the **Anthropic SDK** docs for tool-use and the document (vision) content block. I also read up on **how PDF text extraction actually works** — that text layers carry no reliable geometry, that extraction order ≠ visual order — which is the entire reason the layout-strategy engine exists instead of a naive top-to-bottom parse.

**AI for planning & architecture.** I used Claude (via Claude Code) as a thinking partner for the pipeline shape, the type contracts, and the component decomposition — then pressure-tested its proposals instead of accepting them. I deployed agents to generate the boring boilerplate (component scaffolds, the CSS token system, the glassmorphism styling, initial regex candidates) so I could spend human time on the parts that needed judgment.

**Where I overrode the AI.** The first architecture it proposed gated extraction behind `detectProcessor()` — "is this ADP?" I reversed it. The right invariant is *layout pattern*, not *processor identity*, because a W-2 is a W-2 and the IRS mandates the boxes; branching on the vendor means every new provider is a code change and unknown providers get worse results. That insight came from reasoning about the domain, not from a prompt.

**Where I refused to use AI — and why it mattered most.** Regex debugging on real documents. Two examples that no prompt would have surfaced:
- The state-detection pattern `\bstate[ \t]+(ALL_STATES)\b` matched **"Employer's state ID no."** — because "state" followed by "ID" (Idaho is a valid state code) is a perfectly legal match. The fix required anchoring to line starts.
- **"Box 18 of W-2"** has its actual value sitting ~400 characters *before* the label in the extracted text, not next to it.

Both required printing `repr(text)` of the real ADP PDF and reading the raw character stream with my own eyes. AI is great at "write me a regex for a date"; it is useless at "here is 8KB of garbled multi-copy PDF text, find where Pittsburgh's local tax hid." That part is empirical, and it's where the accuracy actually came from.

**Honest split:** AI wrote ~60% of the lines (scaffolding, styling, types, first-draft patterns). The other 40% — the layout engine, the trust model, the bugs you only find by staring at real output — was human. The 60% is the part that's easy; the 40% is the part that makes it correct.

---

## Assumptions I made

- **The user is a professional preparer, not a consumer** — so the UI optimizes for verification speed and getting data *out*, not hand-holding.
- **Individual-filer forms first** (W-2, the common 1099s). Business returns, K-1s, brokerage 1099-Bs are out of scope but additive.
- **One document at a time** is an acceptable demo scope; the multi-document workpaper is the named next layer.
- **A missing value should be surfaced, never guessed.** I'd rather show "couldn't read Box 4, enter it" than fabricate a plausible number — for this user, a confident wrong value is the cardinal sin.
- **US federal forms, 2015–2029 tax years** for the year-detection heuristics.

---

## What I deliberately cut (and why that's a feature)

Multi-document workpapers, auth, a real database, vendor-specific imports, rendered-PDF highlighting, a test fixture corpus, dedup. Each is named above with how I'd build it. I cut them not because I ran out of steam but because the brief said "an experience a preparer can use and trust," and **trust is depth, not breadth.** I'd rather ship a single-document flow that never lies to you than five half-built features that each might. A founding engineer's job is choosing what *not* to build yet — so I'm telling you my choices out loud.
