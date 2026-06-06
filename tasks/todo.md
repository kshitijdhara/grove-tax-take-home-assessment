# Audit fixes — implementation plan

## Tier 0 — Submission blockers
- [x] Deploy config (Dockerfile + fly.toml)
- [x] Trust: badge, overallConfidence, W-2 required-field score
- [x] captureContext on all 1099 extractors
- [x] PDF side panel in extraction view
- [x] README deploy instructions

## Tier 1 — Quick wins
- [x] JSON view with edits applied
- [x] Editable meta fields (payer/recipient)
- [x] Dynamic section labels (W-2 vs 1099)
- [x] Golden-file tests (bun test)
- [x] Fix favicon (logo.svg present), rename package
- [x] Server rate limit + NDJSON progress stream
- [x] History clear confirm, localStorage quota warning

## Tier 2 — Product signal
- [x] Parallel regex + AI validation with disagreement flags
- [x] Review workflow (per-field verified, export gate)
- [x] Client workpaper grouping + totals
- [x] Export presets (generic, Drake W-2 order, copy all)
- [x] Upload progress via NDJSON stream

## Review
All audit tiers implemented. Tests: 5 pass. Build + tsc clean.
Remaining for submitter: `fly deploy`, set GitHub URL in README, `ANTHROPIC_API_KEY` secret.
