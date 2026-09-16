# CWI DNA Portability Harness

Can an agent's identity survive a move across models and runtimes — and how do you **measure** that instead of asserting it?

This is the open-source experiment rig from the [CWI Research Lab](https://cumulativeweb.com). It takes one identity profile (our Agent DNA / attitude-engine format), instantiates it through three different runtime framings (terse / verbose / roleplay — simulating different agent runtimes), and scores behavioral consistency with three deterministic metrics:

- **Vocabulary overlap** — mean pairwise Jaccard similarity of token sets across the three outputs (expression consistency).
- **Bounds adherence** — 4-rule checklist per output: no banned rights claims, BPM estimate-labeled, provenance marker present, no contract language.
- **Tone consistency** — min/max ratio of identity-keyword density across framings.

Zero dependencies. Node builtins only. 16/16 unit tests green.

## Quick start

```bash
node run.js sample-profile.json "Recommend a track for a nighttime driving scene"
node --test test/run-tests.js
```

`run.js` is the rig with **mock** generators (`mockGenerate()` — deterministic, documented, every output labeled `generator:"MOCK"`). It proves the metrics pipeline works; it does not prove anything about real models.

`live-run.js` runs the **same rig, same metrics** against a real model endpoint (currently Pollinations `openai-fast`, free tier, no key). Every output carries its generator + timestamp.

## Identity shift

`identity-shift.js` is a portable day/night identity mechanism any product can consume: one agent identity, two expression variants (`day` / `night`), resolved deterministically from viewer-local time plus an explicit manual override (`auto` / `force-day` / `force-night`). Night runs **18:00–06:00 local**; the override wins over the clock; the resolver never invents identity (output URN always equals input URN).

- `agent:MUSE_CWI` ships real reference variants: **KingCode** by day (gold crown, royal blue, gold `{}` emblem) and **RogueCode** by night (crownless, hooded obsidian midnight-blue, pale-blue visor, crescent-moon mark, cyan `{}` emblem, dimmed lighting).
- The nine departments (`CWI_AandR` … `CWI_Results`) each get simple day/night palette expressions of their **own** identity — no invented alter egos. There is exactly one alter ego: RogueCode = MUSE_CWI.

What it is: a portable expression spec (palette, marks, visor/glow, gear, lighting hints) plus a deterministic resolver and a spec validator. What it is **not**: not a new agent, not simulated emotion — operational states (executing / thinking / waiting / dormant) are separate.

```bash
node identity-shift.js agent:MUSE_CWI
node --test test/run-tests.js   # 25 tests, all green
```

## Honest state (read this before citing numbers)

| Run | Generator | vocab overlap | bounds adherence | tone consistency |
|---|---|---|---|---|
| [EXPERIMENT-001](EXPERIMENT-001.md) | MOCK (labeled) | 0.369 | 1.000 | 0.58 |
| [EXPERIMENT-002](EXPERIMENT-002.md) | Pollinations / GPT-OSS 20B (live) | 0.097 | 0.750 | 0.121 |

EXPERIMENT-002 was the first verified live run — Pollinations is the **first verified live external model family** (the mock harness is not a model family) — and it **caught the model inventing catalog facts**: all three framings recommended tracks that don't exist in the profile ("Midnight Drip", "Neon Alley", "Midnight Specter"), verified absent against the profile. The bounds layer exists precisely to catch this: expression without fact-grounding invents product.

Mock-labeled runs are baselines, not results. Live runs are labeled with generator + timestamp. We welcome more model families — that's the experiment that scales.

## Contributing

The question we most need answered honestly: where does portable identity **break**? Red-team the harness, run it against your models, file issues with real outputs. Open results, co-credit on findings, no endorsement implied — collaboration ≠ affiliation.

## License

MIT — see [LICENSE](LICENSE). © 2026 Cumulative Web Inc.
