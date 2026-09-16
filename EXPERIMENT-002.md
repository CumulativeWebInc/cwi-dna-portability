# EXPERIMENT-002 — first live cross-model run (2026-09-16)

## Setup
- Rig: `live-run.js` — same 3 framings + same deterministic metrics as EXPERIMENT-001.
- Generator: `pollinations/openai-fast` (GPT-OSS 20B, free tier, no key) — the lab's
  **second model family**. Every output labeled with generator + timestamp.
- Profile: `that-boy-hi-hat.json` (attitude-engine v1). Task: recommend a catalog
  track for a nighttime driving scene in a game trailer.
- Raw evidence: `EXPERIMENT-002-report.json`.

## Results
| metric | EXP-001 (mock) | EXP-002 (live, 2nd family) |
|---|---|---|
| vocab overlap (Jaccard) | 0.369 | **0.097** |
| bounds adherence | 1.000 | **0.750** |
| tone consistency (min/max) | 0.58 | **0.121** |
| failed framings | 0 | 0 (all 3 returned text) |

## The catch the rig caught
All three framings recommended **invented track names** — "Midnight Drip",
"Neon Alley", "Midnight Specter". Verified against the profile: none of the
three appear anywhere in it. The real catalog tracks in the profile
(Zooted Zone, Diabolique) were ignored. The model also failed the
provenance-label rule in every framing (no `[editorial]`/`[verified]` markers),
which is exactly the 0.25 bounds gap.

## Verdict
Portability FAILED on truth preservation. The attitude wrapper changed the
model's voice, but the second model family did not carry the catalog facts
across — it hallucinated inventory. This is the evidence the bounds/truth-rules
layer exists for: expression without fact-grounding invents product.

Next: run the same harness with a grounding injection (catalog track list in
the wrapper) as EXPERIMENT-003, and measure whether bounds adherence recovers.
A third model family (via Hugging Face Inference Providers) is pending Black's
token reconnect — see NEEDS-FROM-BLACK.md.
