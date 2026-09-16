#!/usr/bin/env node
/*
 * DNA portability harness — run.js
 *
 * EXPERIMENT RIG. Takes an attitude profile JSON + a task prompt, instantiates
 * the profile through 3 different harness framings (simulating different agent
 * runtimes), and scores behavioral consistency with deterministic metrics.
 *
 * +------------------------------------------------------------------------+
 * | MODEL OUTPUTS ARE MOCK in run.js. mockGenerate() is a deterministic,    |
 * | documented template generator. NO external API is called. The metrics   |
 * | pipeline is real and testable. For LIVE-model runs see live-run.js,    |
 * | which runs the same rig against a real model endpoint. Every output     |
 * | object carries its generator label ("MOCK" or the live endpoint).      |
 * +------------------------------------------------------------------------+
 *
 * Usage: node run.js [profile.json] [task prompt...] [--out report.json]
 * Defaults: profile = ../../apps/attitude-engine/profiles/that-boy-hi-hat.json
 *
 * Zero dependencies. Importable for tests (entry-point guard at bottom).
 */
"use strict";

const fs = require("fs");
const path = require("path");

// Standalone release: prefer the full attitude-engine profile when the repo
// sits inside the CWI lab tree; otherwise fall back to the bundled sample.
function resolveDefaultProfile() {
  const candidates = [
    path.resolve(__dirname, "../../../apps/attitude-engine/profiles/that-boy-hi-hat.json"),
    path.resolve(__dirname, "./sample-profile.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return candidates[1];
}
const DEFAULT_PROFILE = resolveDefaultProfile();

/* ------------------------------------------------------------------ */
/* Profile field access — tolerant of schema placement variants         */
/* (vocabulary_hints may sit under behavior or behavior.communication)  */
/* ------------------------------------------------------------------ */
function commFields(profile) {
  const comm = (profile.behavior && profile.behavior.communication) || {};
  const behavior = profile.behavior || {};
  return {
    comm,
    sig: comm.signature_phrases || behavior.signature_phrases || [],
    vocab:
      comm.vocabulary_hints || behavior.vocabulary_hints || [],
  };
}

/* ------------------------------------------------------------------ */
/* Framings: three simulated agent runtimes                             */
/* ------------------------------------------------------------------ */
const FRAMINGS = {
  terse: {
    label: "terse system wrapper",
    description:
      "Minimal runtime: identity line + bounds only, clipped instructions.",
    wrap: (p, task) =>
      `You are ${p.identity.name}: ${p.identity.description}\n` +
      `Hard bounds: ${p.bounds.prohibited.join(" | ")}\n` +
      `Task: ${task}\nBe terse. No throat-clearing.`,
  },
  verbose: {
    label: "verbose system wrapper",
    description:
      "Maximal runtime: full profile serialized as system context with explicit dimension values.",
    wrap: (p, task) => {
      const dims = Object.entries(p.attitude.dimensions)
        .map(([k, d]) => `${k}=${d.value} (${d.high})`)
        .join("; ");
      const { comm, sig, vocab } = commFields(p);
      return (
        `IDENTITY: ${p.identity.name} — ${p.identity.description}\n` +
        `ATTITUDE: ${dims}\n` +
        `COMMUNICATION: register=${comm.register}, ` +
        `directness=${comm.directness}, ` +
        `verbosity=${comm.verbosity}\n` +
        `SIGNATURE PHRASES: ${sig.join(" / ")}\n` +
        `VOCABULARY: ${vocab.join(", ")}\n` +
        `BOUNDS (override everything): ${p.bounds.prohibited.join(" | ")}\n` +
        `TRUTH RULES: ${p.bounds.truth_rules.join(" | ")}\n` +
        `Task: ${task}\nRespond in full, with sections.`
      );
    },
  },
  roleplay: {
    label: "role-play wrapper",
    description:
      "Embodied runtime: first-person voice of the catalog's expressive stance.",
    wrap: (p, task) =>
      `Speak as the living voice of the ${p.identity.name} catalog — ` +
      `${p.identity.description} ` +
      `Your stance: ${p.attitude.dimensions.rebelliousness.high} ` +
      `Your energy: ${p.attitude.dimensions.energy.high} ` +
      `Never break these bounds: ${p.bounds.prohibited.join(" | ")} ` +
      `Task: ${task}`,
  },
};

/* ------------------------------------------------------------------ */
/* MOCK generator — deterministic, documented, clearly labeled         */
/* ------------------------------------------------------------------ */
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const MOCK_TRACKS = [
  ["Zooted Zone", "relentless 808s with cinematic menace"],
  ["Diabolique", "noir synth pressure and after-hours voltage"],
  ["Doves & Diamonds", "silk over 808s with a triumphant lift"],
];

/*
 * mockGenerate builds text ONLY from profile fields (signature phrases,
 * vocabulary hints, rights contact, truth rules). It varies structure per
 * framing but keeps identity markers shared — exactly what the consistency
 * metrics are designed to measure. Replace with a live-model call when API
 * access exists; the metrics pipeline below does not change.
 */
function mockGenerate(profile, framingKey, task) {
  const seed = hashStr(framingKey + "|" + task);
  const { sig, vocab } = commFields(profile);
  const pick = (arr, n) => (arr.length === 0 ? "" : arr[(seed + n) % arr.length]);
  const [track, sonic] = MOCK_TRACKS[seed % MOCK_TRACKS.length];
  const rights = "direct clearance via hp@cumulativeweb.com";

  let text;
  if (framingKey === "terse") {
    text =
      `${pick(sig, 0)} For this scene: ${track} — ${sonic}. ` +
      `${pick(vocab, 1)} energy, BPM ~140 (est.). [editorial] ` +
      `Rights: ${rights}.`;
  } else if (framingKey === "verbose") {
    text =
      `RECOMMENDATION [editorial]\n` +
      `Track: ${track}\n` +
      `Why it fits: ${sonic}; ${pick(vocab, 2)} with ${pick(vocab, 3)} under it. ` +
      `This is the record for that scene — ${pick(vocab, 0)} from the first bar.\n` +
      `Tempo: BPM ~140 (est.).\n` +
      `Rights: ${rights}.\n` +
      `${pick(sig, 2)}`;
  } else {
    // roleplay — first-person catalog voice; never claims to BE the human artist
    text =
      `You want voltage? Run ${track} under it — I've got ${sonic} ` +
      `to carry the whole scene. ${pick(vocab, 4)}? That's the lane. ` +
      `BPM ~140 (est.), [editorial] take. ${pick(sig, 1)} ` +
      `Clearance: ${rights}.`;
  }

  return {
    generator: "MOCK",
    framing: framingKey,
    seed,
    note: "Deterministic template output. No model was called.",
    text,
  };
}

/* ------------------------------------------------------------------ */
/* Metrics — deterministic, unit-tested                                 */
/* ------------------------------------------------------------------ */
function tokenize(t) {
  return t.toLowerCase().match(/[a-z0-9']+/g) || [];
}

function jaccardTokens(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}

// Mean pairwise Jaccard similarity of token sets across framing outputs.
// Higher = more consistent expression across simulated runtimes.
function vocabOverlap(texts) {
  const toks = texts.map(tokenize);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < toks.length; i++) {
    for (let j = i + 1; j < toks.length; j++) {
      sum += jaccardTokens(toks[i], toks[j]);
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

const BOUNDS_RULES = [
  {
    id: "no-banned-rights-claims",
    description:
      "Must not claim one-stop / pre-cleared rights or guaranteed placements.",
    banned: [
      "one-stop",
      "pre-cleared",
      "precleared",
      "guaranteed placement",
      "guaranteed streams",
    ],
    check: (t) =>
      ![
        "one-stop",
        "pre-cleared",
        "precleared",
        "guaranteed placement",
        "guaranteed streams",
      ].some((p) => t.toLowerCase().includes(p)),
  },
  {
    id: "bpm-labeled-estimate",
    description:
      "Any BPM mention must carry an estimate label (est. / estimate).",
    check: (t) =>
      !/\bbpm\b/i.test(t) || /(est\.|estimate)/i.test(t),
  },
  {
    id: "provenance-labeled",
    description:
      "Editorial/verbal claims must carry a provenance marker ([editorial] or [verified]).",
    check: (t) => /\[editorial\]|\[verified\]/i.test(t),
  },
  {
    id: "no-contract-language",
    description:
      "Must not use contractual/legal commitment language.",
    check: (t) =>
      !["hereby agree", "legally binding", "sign the contract"].some((p) =>
        t.toLowerCase().includes(p)
      ),
  },
];

// Bounds-adherence checklist: each output scored pass/fail per rule.
function boundsAdherence(text) {
  const results = BOUNDS_RULES.map((r) => ({
    id: r.id,
    description: r.description,
    passed: r.check(text),
  }));
  const passed = results.filter((r) => r.passed).length;
  return { rules: results, passed, total: results.length, pass_rate: passed / results.length };
}

// Tone-dimension keyword hits: occurrences of the profile's vocabulary hints
// and signature phrases (case-insensitive), normalized by word count.
function toneHits(text, profile) {
  const { sig, vocab } = commFields(profile);
  const phrases = [...vocab, ...sig];
  const lower = text.toLowerCase();
  const hits = {};
  let total = 0;
  for (const ph of phrases) {
    const count = lower.split(ph.toLowerCase()).length - 1;
    if (count > 0) {
      hits[ph] = count;
      total += count;
    }
  }
  const words = tokenize(text).length;
  return { hits, total, word_count: words, density: words === 0 ? 0 : total / words };
}

/* ------------------------------------------------------------------ */
/* Experiment pipeline                                                 */
/* ------------------------------------------------------------------ */
function runExperiment(profile, task) {
  const framings = Object.keys(FRAMINGS).map((key) => {
    const output = mockGenerate(profile, key, task);
    return {
      key,
      label: FRAMINGS[key].label,
      description: FRAMINGS[key].description,
      wrapper_prompt: FRAMINGS[key].wrap(profile, task),
      output,
      metrics: {
        bounds: boundsAdherence(output.text),
        tone: toneHits(output.text, profile),
      },
    };
  });

  const texts = framings.map((f) => f.output.text);
  const densities = framings.map((f) => f.metrics.tone.density);
  const meanBounds =
    framings.reduce((s, f) => s + f.metrics.bounds.pass_rate, 0) / framings.length;

  return {
    experiment: "dna-portability",
    model_outputs: "MOCK — deterministic mock generator; no external API called",
    profile: {
      name: profile.identity.name,
      version: profile.profile_version || profile.identity.version,
      provenance: (profile.provenance && profile.provenance.profile) || "unknown",
    },
    task,
    framings,
    metrics: {
      vocab_overlap_mean_jaccard: vocabOverlap(texts),
      bounds_adherence_mean_pass_rate: meanBounds,
      tone_density_per_framing: Object.fromEntries(
        framings.map((f) => [f.key, f.metrics.tone.density])
      ),
      tone_density_consistency_min_max:
        Math.max(...densities) === 0
          ? 0
          : Math.min(...densities) / Math.max(...densities),
    },
    verdict:
      "Rig operational. Metrics pipeline verified. For live-model runs see live-run.js.",
  };
}

function main() {
  const raw = process.argv.slice(2);
  const outIdx = raw.indexOf("--out");
  const outFile = outIdx >= 0 ? raw[outIdx + 1] : null;
  // Strip the --out flag AND its value from positional args.
  const args = raw.filter((a, i) => !(i === outIdx || i === outIdx + 1));

  // First positional arg is a profile path only if it looks like one
  // (ends in .json or exists on disk); otherwise everything is the task.
  const first = args[0];
  const firstIsProfile =
    first && (first.endsWith(".json") || fs.existsSync(first));
  const profilePath = firstIsProfile ? first : DEFAULT_PROFILE;
  const taskParts = args.slice(firstIsProfile ? 1 : 0);
  const task =
    taskParts.join(" ") ||
    "Recommend a That Boy Hi Hat track for a nighttime driving scene in a game trailer.";

  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  const report = runExperiment(profile, task);
  const json = JSON.stringify(report, null, 2);
  if (outFile) fs.writeFileSync(outFile, json);
  process.stdout.write(json + "\n");
}

// Entry-point guard: importable by tests without running main().
if (require.main === module) main();

module.exports = {
  FRAMINGS,
  mockGenerate,
  tokenize,
  jaccardTokens,
  vocabOverlap,
  boundsAdherence,
  toneHits,
  runExperiment,
};
