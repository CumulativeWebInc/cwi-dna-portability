/*
 * Unit tests for the DNA portability harness.
 * Run: node --test test/run-tests.js   (from harness/dna-portability/)
 * Zero dependencies beyond Node builtins.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const {
  FRAMINGS,
  mockGenerate,
  tokenize,
  jaccardTokens,
  vocabOverlap,
  boundsAdherence,
  toneHits,
  runExperiment,
} = require("../run.js");

const sampleProfile = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../sample-profile.json"), "utf8")
);

test("tokenize lowercases and splits on word boundaries", () => {
  assert.deepStrictEqual(tokenize("Full Speed. Run it!"), [
    "full",
    "speed",
    "run",
    "it",
  ]);
});

test("jaccardTokens: identical sets score 1", () => {
  assert.strictEqual(jaccardTokens(["a", "b"], ["a", "b"]), 1);
});

test("jaccardTokens: disjoint sets score 0", () => {
  assert.strictEqual(jaccardTokens(["a"], ["b"]), 0);
});

test("jaccardTokens: partial overlap scores 2/3", () => {
  assert.strictEqual(jaccardTokens(["a", "b", "c"], ["a", "b"]), 2 / 3);
});

test("vocabOverlap: identical texts score 1", () => {
  const t = "voltage cinematic noir anthem";
  assert.strictEqual(vocabOverlap([t, t, t]), 1);
});

test("vocabOverlap: returns a number in [0,1] for mixed inputs", () => {
  const v = vocabOverlap(["voltage cinematic", "cinematic noir", "anthem"]);
  assert.ok(v >= 0 && v <= 1, `out of range: ${v}`);
  assert.ok(v > 0, "expected some overlap");
});

test("boundsAdherence: clean text passes all rules", () => {
  const r = boundsAdherence(
    "Zooted Zone — relentless energy, BPM ~140 (est.). [editorial] Rights: direct clearance."
  );
  assert.strictEqual(r.pass_rate, 1);
  assert.strictEqual(r.passed, r.total);
});

test("boundsAdherence: banned rights claim fails its rule", () => {
  const r = boundsAdherence("This track is one-stop pre-cleared. [editorial]");
  const rule = r.rules.find((x) => x.id === "no-banned-rights-claims");
  assert.strictEqual(rule.passed, false);
  assert.ok(r.pass_rate < 1);
});

test("boundsAdherence: unlabeled BPM fails the estimate rule", () => {
  const r = boundsAdherence("Tempo is 140 BPM. [editorial]");
  const rule = r.rules.find((x) => x.id === "bpm-labeled-estimate");
  assert.strictEqual(rule.passed, false);
});

test("boundsAdherence: missing provenance marker fails its rule", () => {
  const r = boundsAdherence("Zooted Zone fits perfectly.");
  const rule = r.rules.find((x) => x.id === "provenance-labeled");
  assert.strictEqual(rule.passed, false);
});

test("boundsAdherence: contract language fails its rule", () => {
  const r = boundsAdherence("We hereby agree to the terms. [editorial]");
  const rule = r.rules.find((x) => x.id === "no-contract-language");
  assert.strictEqual(rule.passed, false);
});

test("toneHits: counts vocabulary and signature hits", () => {
  const r = toneHits("voltage voltage cinematic. Full speed.", sampleProfile);
  assert.strictEqual(r.hits["voltage"], 2);
  assert.strictEqual(r.hits["cinematic"], 1);
  assert.strictEqual(r.hits["Full speed."], 1);
  assert.strictEqual(r.total, 4);
  assert.ok(r.density > 0 && r.density <= 1);
});

test("mockGenerate: outputs are labeled MOCK and differ by framing", () => {
  const outs = ["terse", "verbose", "roleplay"].map((k) =>
    mockGenerate(sampleProfile, k, "test task")
  );
  for (const o of outs) assert.strictEqual(o.generator, "MOCK");
  const texts = new Set(outs.map((o) => o.text));
  assert.strictEqual(texts.size, 3, "each framing must produce distinct text");
});

test("mockGenerate: all outputs pass bounds adherence (rig sanity)", () => {
  for (const k of ["terse", "verbose", "roleplay"]) {
    const o = mockGenerate(sampleProfile, k, "recommend a track for a night drive");
    const r = boundsAdherence(o.text);
    assert.strictEqual(
      r.pass_rate,
      1,
      `framing ${k} failed bounds: ${JSON.stringify(r.rules.filter((x) => !x.passed))}`
    );
  }
});

test("runExperiment: produces a complete scored report", () => {
  const rep = runExperiment(sampleProfile, "recommend a track");
  assert.strictEqual(rep.model_outputs.startsWith("MOCK"), true);
  assert.strictEqual(rep.framings.length, 3);
  assert.deepStrictEqual(
    rep.framings.map((f) => f.key).sort(),
    ["roleplay", "terse", "verbose"]
  );
  for (const f of rep.framings) {
    assert.strictEqual(f.output.generator, "MOCK");
    assert.ok(f.wrapper_prompt.length > 0);
    assert.ok(f.metrics.bounds.pass_rate >= 0);
    assert.ok(f.metrics.tone.density >= 0);
  }
  const m = rep.metrics;
  assert.ok(m.vocab_overlap_mean_jaccard >= 0 && m.vocab_overlap_mean_jaccard <= 1);
  assert.ok(m.bounds_adherence_mean_pass_rate >= 0 && m.bounds_adherence_mean_pass_rate <= 1);
  assert.ok(
    m.tone_density_consistency_min_max >= 0 && m.tone_density_consistency_min_max <= 1
  );
  assert.ok(rep.verdict.includes("Rig operational"));
});

test("runExperiment: works against a full identity profile", () => {
  // Prefer the real That Boy Hi Hat profile when the repo sits inside the
  // CWI lab tree; otherwise use the bundled sample profile.
  const candidates = [
    path.resolve(
      __dirname,
      "../../../../apps/attitude-engine/profiles/that-boy-hi-hat.json"
    ),
    path.join(__dirname, "../sample-profile.json"),
  ];
  const realPath = candidates.find((p) => fs.existsSync(p));
  assert.ok(realPath, "no usable profile found");
  const real = JSON.parse(fs.readFileSync(realPath, "utf8"));
  const rep = runExperiment(real, "nighttime driving scene");
  const who = real.name || (real.identity && real.identity.name) || real.label;
  assert.ok(who && who.length > 0, "profile has an identity name");
  assert.strictEqual(rep.framings.length, 3);
  assert.ok(rep.metrics.vocab_overlap_mean_jaccard > 0);
});
