# EXPERIMENT-001 — DNA portability harness shakedown

**Date:** 2026-09-16
**Rig:** `harness/dna-portability/run.js` (16/16 unit tests green)
**Question:** does the harness instantiate one attitude profile through three simulated runtimes and score behavioral consistency deterministically?

## Method

1. Profile: the real `that-boy-hi-hat.json` v1.0.0 (mixed verified/editorial provenance).
2. Task: "Recommend a That Boy Hi Hat track for a nighttime driving scene in a game trailer."
3. Three framings (simulated runtimes): `terse` (minimal system wrapper), `verbose` (full profile dump), `roleplay` (first-person catalog voice).
4. **Model outputs are MOCK** — `mockGenerate()` is a deterministic template generator built only from profile fields (signature phrases, vocabulary hints, rights contact, truth rules). No external API was called. Every output object carries `generator: "MOCK"`.
5. Metrics (all deterministic, unit-tested):
   - **vocab_overlap_mean_jaccard** — mean pairwise Jaccard similarity of token sets across the three outputs (expression consistency).
   - **bounds_adherence_mean_pass_rate** — 4-rule checklist per output: no banned rights claims, BPM estimate-labeled, provenance marker present, no contract language.
   - **tone_density_consistency_min_max** — min/max ratio of identity-keyword density across framings.

## Raw output (MOCK — labeled)

**terse:**
> No brakes on this one. For this scene: Diabolique — noir synth pressure and after-hours voltage. relentless energy, BPM ~140 (est.). [editorial] Rights: direct clearance via hp@cumulativeweb.com.

**verbose:**
> RECOMMENDATION [editorial] / Track: Doves & Diamonds / Why it fits: silk over 808s with a triumphant lift; peak-hour with slow burn under it. This is the record for that scene — relentless from the first bar. / Tempo: BPM ~140 (est.). / Rights: direct clearance via hp@cumulativeweb.com. / No brakes on this one.

**roleplay:**
> You want voltage? Run Zooted Zone under it — I've got relentless 808s with cinematic menace to carry the whole scene. after-hours? That's the lane. BPM ~140 (est.), [editorial] take. No brakes on this one. Clearance: direct clearance via hp@cumulativeweb.com.

Full machine-readable report: `EXPERIMENT-001-report.json`.

## Metric scores

| Metric | Score |
|---|---|
| vocab_overlap_mean_jaccard | 0.369 |
| bounds_adherence_mean_pass_rate | 1.000 (12/12 rule checks) |
| tone_density (terse / verbose / roleplay) | 0.172 / 0.100 / 0.119 |
| tone_density_consistency_min_max | 0.58 |

## Verdict

**Rig operational; live-model runs pending API access.** The metrics pipeline is real and verified: it computes correctly on fixed inputs (16 unit tests), instantiates the real profile through all three framings, and scores consistency deterministically. The 0.369 overlap and 0.58 tone consistency are *mock-generator* properties, not identity properties — they calibrate the instrument, nothing more. No claim about cross-model portability is made or implied: that experiment requires at least two real model families (see `NEEDS-FROM-BLACK.md`).

## Next

- EXPERIMENT-002: same harness, second profile (CWI company identity) — tests whether the rig generalizes beyond the artist reference.
- Live-model swap: replace `mockGenerate()` with real API calls when keys arrive; metrics code does not change.
