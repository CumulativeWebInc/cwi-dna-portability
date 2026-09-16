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

## Expression Genome (E1) — portable agent-identity package

The genome is the portable form of an agent's identity: one JSON file that carries identity, personality, attitude (referencing the Attitude Engine schema), day/night expression variants, an honest operational-state vocabulary, capabilities, memory policy, permissions, a **swappable model pointer** (sibling of identity, never its parent — re-point it and the same agent runs on another model), and an integrity signature. 28/28 genome tests green; 53/53 with the harness suite.

What it is: a blueprint for moving one agent across models and runtimes — JSON Schema (`genome/cwi-expression-genome-v1.schema.json`), a deterministic stdlib-only validator (`genome/validator.js`), bidirectional bridges to ElizaOS character files and CrewAI `agents.yaml` (`genome/bridges/`), a CLI (`genome/cli.js`), and ten real genomes under `genome/examples/`: the reference genome for MUSE_CWI / KingCode (`muse-cwi.genome.json`) plus all nine department genomes (`cwi-aandr`, `cwi-marketing`, `cwi-sync`, `cwi-radio`, `cwi-press`, `cwi-studio`, `cwi-data`, `cwi-affairs`, `cwi-results`) — every expression variant built from `identity-shift.js`, never hand-copied; department names and personalities from the CWI agent roster (named 2026-09-15).

What it is **not**: not a new agent (KingCode/RogueCode are expression variants of one identity), not simulated emotion (`cwi-operational-v1` states are workload telemetry with a required source tag — felt-emotion terms are rejected), not a runtime dump (genomes must never contain memory dumps, keys, or wallet material). The ElizaOS character interface and the CrewAI `agents.yaml` shape were **studied** from their public docs — credited as studied, never as endorsement or affiliation. No fake counters, no invented adoption: anything not yet live is labeled PREVIEW.

```bash
node genome/cli.js validate genome/examples/muse-cwi.genome.json
node genome/cli.js hash genome/examples/muse-cwi.genome.json
node genome/cli.js eliza-export genome/examples/muse-cwi.genome.json
node genome/cli.js crewai-export genome/examples/muse-cwi.genome.json
node --test genome/test/run-tests.js   # 20 tests, all green
```

Named result: a third-party-compatible genome file validates against the schema **and** converts losslessly to an ElizaOS character file (measured by green CI + the live validator below). Kill rule: if zero inbound adoption/integration signals by 2026-10-16, E1 goes maintenance-only and the line pivots to the Expression SDK (E2).

Live: validator + reference genome viewer → https://cumulativewebinc.github.io/cwi-dna-portability/

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
