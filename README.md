# Tax Document Extractor — Grove Tax Take-Home

Upload W-2s and 1099s. Extract fields. **Prove** they're right. Export without lying to downstream software.

- **Live demo:** `[HOSTED_URL]`
- **Code:** `[GITHUB_URL]`
- **Time spent:** `[~18 hours across focused sessions]`

---

## TL;DR

I built a **hybrid extraction pipeline** (layout-aware regex + parallel Claude Haiku validation + Sonnet vision for scans) wrapped in a **trust-first review UI**. The north star is not "auto-fill a return" — it's **make wrongness loud before a preparer signs anything**.

Regex handles the boring, repeatable part (payroll PDFs are structurally insane but not magically random). AI handles ambiguity and scanned docs. Humans — for now — pick winners when the two disagree.

If I had six more months and a labeled PDF corpus the size of a small moon, I'd push verification **into an agent layer** so preparers supervise automation instead of checkboxing every Box 1. More on that below — the current app is deliberately built in that direction.

---

## Quickstart

```bash
bun install
```

`.env` (Bun loads it automatically):

```
ANTHROPIC_API_KEY=sk-ant-...   # optional but recommended
```

```bash
bun run dev      # http://localhost:3100
bun run start    # production
bun run build    # client bundle → dist/
bun test         # 12 extraction regression tests
```

No API key → regex-only extraction with an explicit banner. Scanned PDFs hard-fail without a key (by design — guessing is worse than refusing).

### Docker

```bash
docker build -t grove-tax-extractor .
docker run -p 3100:3100 -e ANTHROPIC_API_KEY=sk-ant-... grove-tax-extractor
```

---

## The problem (why this exists)

Tax prep software wants structured data. Clients send PDFs. PDFs lie — quietly.

The failure mode that keeps me up at night: **a confident wrong number on a signed return**. Not "low confidence." Not "needs review." Just… wrong, exported, filed.

So this project optimizes for **trust mechanics**, not demo sparkle:

1. **Extract** with deterministic patterns where possible.
2. **Validate** with AI in parallel — never as silent authority.
3. **Force explicit resolution** when sources disagree.
4. **Gate export** until a human says "I've checked this."
5. **Attach provenance** (source quotes, method, verification flags) to anything leaving the app.

Everything else — workpapers, batch upload, Drake column order — supports that core loop.

---

## Architecture

```
PDF upload
    │
    ▼
parsePdf (pdf-parse) ──▶ raw text
    │
    ├─ meaningful chars < 500 ──▶ Claude Sonnet VISION
    │                              └─ all fields low confidence
    │                              └─ citations cross-checked vs partial text when available
    │
    └─ text PDF ──▶ identifyDocument (regex heuristics)
                      │
                      ├─ regex extract (layout strategies) ──┐
                      └─ Claude Haiku validate (parallel) ─────┴─▶ mergeRegexAndAi
                                                                    └─ disagree? → value cleared, human picks
```

### Decision log — server / extraction

| Decision | Why | Tradeoff |
|----------|-----|----------|
| **Bun.serve, no Express** | Single runtime, native HTML imports, fast dev. I read [Bun's server docs](https://bun.sh/docs) and committed. | Smaller hire pool than Node+Express; fine for a take-home, would wrap in K8s either way in prod. |
| **pdf-parse for text** | Battle-tested text layer extraction; I read how PDF text streams work (coordinate-less but fast). | No bounding boxes from pdf-parse — citations are string quotes, PDF overlay uses pdf.js separately on client. |
| **500-char threshold for vision** | Scanned docs yield garbage text; below threshold → don't pretend regex works. | Threshold is heuristic; would tune with labeled set. |
| **Parallel regex + Haiku** | Latency = max(regex, AI), not sum. Preparer waits once. | 2× API cost per doc; worth it for validation signal. |
| **Disagreement → empty value** | Never silently pick regex *or* AI. Empty forces UI picker. | More clicks; fewer silent wrong exports. |
| **AI failure → regex-only + flag** | Outage shouldn't block work; must not look like success. | `aiValidationFailed` banner; preparer verifies everything. |
| **Layout strategies, not vendor detection** | ADP/Gusto/Paychex differ in *layout*, not mystical vendor APIs. `w2.ts` runs sequential, reversed, spaced-amount, interleaved strategies unconditionally. | More regex code; adding a layout = adding patterns, not `if (vendor === 'adp')`. |
| **captureContext + lastIndexOf** | Same dollar amount appears twice on multi-section payroll PDFs; last occurrence ≈ W-2 box section. | Heuristic; wrong on exotic layouts → low confidence + human review. |
| **1099-MISC → NEC + warning** | MISC is common mis-upload; extract what we can, scream about form type. | Not a MISC extractor; honest scope boundary. |
| **NDJSON progress stream** | Batch uploads need liveness; `{stage}` events beat a spinner. | Custom protocol; not SSE, but simple to parse. |
| **In-memory rate limit (20/min/IP)** | Demo abuse protection; zero infra. | Resets on restart; prod needs Redis + auth. |
| **Structured extraction logging** | `extractionLog.ts` JSON lines: method, disagreements, duration. | stdout only; prod → Datadog/BigQuery. |

### Decision log — shared / trust layer

| Decision | Why | Tradeoff |
|----------|-----|----------|
| **`mergeExtraction.ts` in shared/** | Same merge semantics client + server could use; single source of truth. | Slight over-sharing for a monolith; pays off if you add worker queue. |
| **`reviewStatus.ts` export gate** | Export blocked until every key verified AND no unresolved disagreement values. | Friction by design; override requires named confirmation dialog. |
| **`overallConfidence` computed** | Any low field, missing field, or disagreement → low. Badges can't gaslight. | Conservative; more yellow badges, fewer false "all good." |
| **W-2 arithmetic checks** | SS wages ≈ SS tax × 50, Medicare similar, Box 1/3 ratio. Catches OCR/regex disasters. | US W-2 only; ratios fail on weird corrections — flags, doesn't block. |
| **Content-hash dedup** | Same PDF uploaded twice shouldn't duplicate workpapers. | Hash collision theoretically possible; SHA-256 is fine. |
| **Corrected form supersedes prior** | CORRECTED/VOID/AMENDED detected in text; new upload replaces old history entry. | Text heuristic; wouldn't trust for compliance without IRS pub rules engine. |

### Decision log — client / UX

| Decision | Why | Tradeoff |
|----------|-----|----------|
| **Split pane: PDF + fields** | Preparer workflow is *look at source, look at number*. Side-by-side is non-negotiable. | Horizontal space; collapses on mobile (acceptable — preparers use desktops). |
| **Click field → citation highlight** | `sourceText` quote drives pdf.js search; iframe jumps to page + overlay rect. | Iframe overlay is approximate; canvas + viewport coords is the upgrade path (see below). |
| **Per-field verify checkbox** | Export gate needs granular state, not one "I swear" button. | Tedious today — intentional until agent verification exists. |
| **Disagreement picker (Pattern vs AI)** | Two buttons, two values, zero hidden defaults. | UI clutter on messy docs; clarity > cleanliness. |
| **IndexedDB PDF storage** | Re-open history with source doc; local-first demo. | Browser quota; ephemeral mode skips persistence for PII paranoia. |
| **Client workpapers** | Real firms think in clients, not individual uploads. Roll-ups (W-2 wages, 1099-NEC totals) + per-doc status. | Not a full GL tie-out; staging area, not sub-ledger. |
| **Export formats (row, vertical, Drake order, TSV)** | Honest staging for downstream — copy/paste + CSV, not fake Lacerte API. | Vendor field codes need vendor docs; I didn't invent them. |
| **Preparer name + export timestamp** | Audit trail starts somewhere. Persisted on history entry. | Not legally binding e-sign; foundation for one. |
| **Ephemeral mode toggle** | "Don't persist PII" for demos on shared machines. | User must remember to toggle; prod uses encrypted server storage anyway. |

---

## PDF ↔ field linking (current + where I'd take it)

**Today:** Click a field row with a `sourceText` citation → PDF viewer searches the quote via pdf.js, jumps to the page, draws a highlight overlay. Meta fields (Tax Year, EIN, etc.) search by value when no quote exists.

**Next (and what I'd demo with more time):** **Hover-to-outline** — preparer mouses over "Tax Year" in the field list, and a box draws directly on the PDF at the extracted coordinates (canvas-rendered pdf.js page + viewport-aligned rects from text-item transforms). Click pins the highlight. No textual "you are hovering over…" bar — the document *is* the UI.

Why canvas over iframe? Because percentage-based overlays on an iframe lie. pdf.js gives you transform matrices; use them.

**Product philosophy (where Grove should go, IMO):**

The hover-outline feature serves a **transitional** UX: preparers verifying extraction output field-by-field. That's the right MVP for trust-building.

But it's not where I'd bet the company long-term.

I'd steer toward **an agent that verifies its own extraction** — cross-field arithmetic, duplicate detection, form-type consistency, citation confidence scoring — so the preparer's job shrinks to **supervising agents**, not checkboxing Box 7 forty times. The UI becomes: "here's what the agent verified, here's what it's unsure about, here's the audit log."

This app is wired for that handoff: structured disagreements, provenance quotes, verification metadata on export, extraction logging. The per-field checkbox is scaffolding, not destiny.

---

## Trust rules (enforced in code, not marketing)

- Pattern vs AI disagreement → **field value cleared** until preparer picks
- Badge says **"Pattern + AI agree"**, not "Validated" or "Correct"
- Vision path → **all fields low confidence**
- AI validation failure → **`aiValidationFailed`**, pattern-only, banner
- Export override → **modal lists every unverified/unresolved field by name**
- Missing fields → **"Not Found — Enter Manually"**, never invented
- `bun test` locks merge, review gate, and arithmetic invariants

Run the tests if you don't believe me. They're the spec.

---

## Extraction engine (deep cut)

### W-2 layout strategies

Payroll vendors don't agree on how to serialize a W-2 into PDF text. ADP interleaves copies. Paychex goes sequential. Someone at Gusto made it almost readable (bless them).

Instead of `detectVendor()`, `w2.ts` runs **all strategies** and scores results. Fixtures in `tests/fixtures/`:

- `gusto-w2.txt` — clean
- `adp-w2.txt` — interleaved + spaced amounts (`14 194 65`)
- `paychex-w2.txt` — sequential

Adding a new layout = new regex strategy, not a fork.

### AI's role (production, not vibe-check)

- **Haiku:** structured JSON validation pass on text PDFs — cheap, fast, parallel
- **Sonnet vision:** scanned/image PDFs — expensive, all-low-confidence by policy
- **Citation verification:** AI-provided `sourceText` stripped if quote doesn't appear in source (helpers.ts) — LLMs love to confabulate quotes

### Confidence model

`computeOverallConfidence`: any low field, missing required field, or disagreement → overall low. W-2 ratio failures downgrade specific boxes. Badges map to honest states — see `ExtractionBadge.tsx`.

---

## What's in the app

| Feature | What it does |
|---------|--------------|
| **Split review UI** | PDF + editable fields; citation → highlight |
| **Verification gate** | Meta + box fields must be checked before export |
| **Disagreement picker** | Pattern vs AI — pick one, no default |
| **W-2 arithmetic panel** | SS/Medicare ratio sanity checks |
| **Client workpapers** | Group by client/matter; wage + NEC roll-ups |
| **Batch upload** | Multi-file queue; stays on uploader until done |
| **History + PDF replay** | IndexedDB blobs; dedup by SHA-256 |
| **Corrected forms** | Detect CORRECTED/VOID; supersede prior entry |
| **Ephemeral mode** | Skip localStorage/IndexedDB |
| **Export presets** | Vertical audit CSV, row CSV w/ Verified cols, Drake W-2 order, TSV |
| **Export sign-off** | Preparer name + timestamp on history |

---

## Downstream export (honest positioning)

This ships **staging formats**, not verified Lacerte/UltraTax API integration. I don't have vendor field specs and I won't fake them.

| Format | Purpose |
|--------|---------|
| **Row CSV** | Generic import mapping + per-field Verified columns |
| **Vertical CSV** | Audit workpaper: Verified, Edited, SourceMethod |
| **Drake W-2 order** | Common column layout — **verify against your Drake import spec** |
| **Client CSV** | All docs for one client, one file |
| **Copy TSV** | Fastest path into manual data entry screens |

---

## Code map

```
src/
├── shared/              types, merge, review, export, confidence, w2Arithmetic
├── server/
│   ├── index.ts         Bun.serve, rate limit, NDJSON stream, pdf.worker route
│   ├── extractionLog.ts structured stdout logging
│   └── extractors/      pipeline, w2, 1099*, claudeFallback, claudeVision, parsePdf
└── client/
    ├── pages/Home/              workpaper-primary layout
    ├── sections/FileUploader/   batch queue
    ├── components/
    │   ├── ExtractionResult/    review + export + disagreement UI
    │   ├── PdfViewer/           pdf.js citation search + highlight
    │   └── WorkpaperPanel/      client grouping + CSV export
    ├── hooks/                   history, settings (ephemeral)
    └── storage/pdfStore.ts      IndexedDB PDF blobs

tests/
├── extraction.test.ts    12 tests — merge, identify, W-2 layouts, review gate
└── fixtures/             gusto, adp, paychex, 1099-nec, 1099-misc, corrected-w2
```

---

## How this was built (tools + AI + human)

I'm not going to pretend I typed every line between coffee refills. Here's the honest stack:

| Layer | What I used |
|-------|-------------|
| **Runtime / server** | [Bun docs](https://bun.sh/docs) — `Bun.serve`, HTML imports, native test runner. No Webpack cosplay. |
| **PDF text extraction** | Read pdf-parse + PDF text stream basics; learned why payroll PDFs are character soup |
| **PDF client rendering** | pdf.js docs — text content items, viewport transforms, worker setup |
| **AI (production)** | Anthropic SDK — Haiku validation, Sonnet vision; Claude API docs for structured output |
| **AI (building the app)** | Claude + Cursor for **planning, architecture, boilerplate** — React components, export helpers, test scaffolds. Agents are fast at typing; they're bad at ADP layout debugging. |
| **Human (non-delegable)** | Trust semantics, merge-on-disagree policy, ADP `repr(text)` debugging, badge wording, export gate logic, W-2 strategy design |

**Split:** ~60% of lines AI-assisted; **100% of "what happens when regex and AI disagree"** human-owned. Regex on real ADP output required reading raw character streams — not promptable, not negotiable.

If you're evaluating whether I can ship: read `mergeExtraction.ts`, `reviewStatus.ts`, and `w2.ts`. That's the brain. The button CSS is replaceable.

---

## What "complete" looks like (more time, context, test cases)

Given six weeks, a firm sponsor, and a folder of 2,000 real PDFs:

### Extraction
- [ ] **Labeled evaluation set** with per-field F1, not vibes — CI fails on regression
- [ ] **Real PDF fixtures** in tests (not just text dumps) — pdf-parse golden files
- [ ] **Bounding-box citations** stored at extraction time (pdf.js text items server-side or client cache)
- [ ] **Hover + click PDF outlines** on canvas (viewport-accurate, stable scroll)
- [ ] **1099-MISC first-class extractor** (not routed-through-NEC)
- [ ] **1099-B, K-1 stubs** — scope expansion with explicit unsupported boundaries

### Product
- [ ] **Agent verification layer** — automated cross-field checks, citation confidence, auto-verify high-confidence agreements
- [ ] **Preparer dashboard** — "agents handled 847/900 fields; review these 53"
- [ ] **Return-level entity** — tie W-2 Box 1 to 1040 wages line; cross-doc reconciliation
- [ ] **One verified vendor import** (Drake *or* Lacerte) against official field spec
- [ ] **Firm-wide audit log** — who verified what, when, on which doc hash

### Infra
- [ ] **Auth + multi-tenant** — firm → preparer → client hierarchy
- [ ] **Encrypted PII at rest** — server-side doc storage, not IndexedDB
- [ ] **Job queue** for batch — SQS/BullMQ, parallel extraction workers
- [ ] **Webhook export** to practice management system

---

## Production readiness (perf, security, scale)

### Performance
- **Today:** Single Bun process, sync extraction in request handler, parallel regex+AI per doc
- **Prod:** Extract endpoint → queue → worker pool. Regex is CPU-cheap; AI is I/O-bound — scale workers horizontally, cap concurrent Anthropic calls per firm
- **PDF client:** Cache pdf.js document proxy; debounce hover highlights; render pages lazily
- **Batch:** Already streams NDJSON progress; add job IDs + polling/WebSocket for long batches

### Security
- **Today:** Rate limit, PDF magic-byte check, 25MB cap, PII redaction in `sourceText` quotes, ephemeral mode
- **Prod:** AuthN (SSO), AuthZ (firm scoping), encrypt blobs at rest (KMS), TLS everywhere, **never log raw SSN/EIN** (structured log scrubs), SOC2-aware retention policies, CSP headers, audit trail immutability
- **AI:** Prompt injection via PDF text is real — treat extracted text as untrusted input; schema-validate all model output (`parseExtraction.ts`)

### Scalability
- **Stateless API** + object storage for PDFs + Postgres for metadata/extractions
- **Idempotent extraction** keyed by content hash — re-upload doesn't re-bill AI
- **Multi-region** only when customers are; extraction is embarrassingly parallel

### Observability
- **Today:** `extractionLog.ts` JSON to stdout
- **Prod:** OpenTelemetry traces (parse → identify → regex → AI → merge), disagreement rate dashboards, p95 latency by doc type, AI failure alerts

---

## What I chose not to build (on purpose)

- Auth, multi-tenant DB, firm audit log (foundation only)
- Fake Lacerte/UltraTax API integrations
- Full return entity with trial-balance tie-out
- Server-side encrypted PII storage (IndexedDB demo is not a vault)
- Auto-file with IRS (lol)

Scope is a feature. A half-built auth system is worse than honest "local demo."

---

## Assumptions

- User is a **professional tax preparer**, not a consumer filing on their phone
- US federal forms: W-2, 1099-NEC/INT/DIV (1099-MISC detected + warned)
- Tax years 2015–2029 for year heuristics
- **Missing values are surfaced, never guessed**
- Single-browser demo; production is server-authoritative

---

## Trust: the whole point

The worst failure mode isn't "couldn't extract." It's **confidently wrong**.

This tool makes wrongness loud:

- Disagreements don't default to regex
- Badges don't overclaim
- Missing fields say "Not Found"
- Export override makes you read what's unverified
- AI failures are labeled, not hidden

The long game is agents that earn verification — so preparers stop being human OCR and start being **quality engineers for automation**. This codebase is step one: get the data out, prove where it came from, and never silently lie.

---

## Tests

```bash
bun test
```

12 tests. Merge invariants, W-2 layout fixtures, 1099-MISC warning, review gate, arithmetic checks. If you're reviewing this repo, **start here** — then click around the UI, then read `pipeline.ts`.

---

*Built with Bun, TypeScript, React, pdf-parse, pdf.js, and Anthropic Claude. Documented like I mean it.*
