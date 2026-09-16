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

/* ------------------------------------------------------------------ */
/* identity-shift tests                                                 */
/* ------------------------------------------------------------------ */
const {
  SHIFT_SCHEDULE,
  OVERRIDE,
  AGENTS,
  listAgentUrns,
  shiftAt,
  validateExpression,
  resolveShift,
} = require("../identity-shift.js");

// Local-time constructors: TZ-independent boundary probes.
const atLocal = (h, m) => new Date(2026, 2, 10, h, m, 0, 0);

test("shiftAt: schedule boundaries (night = 18:00–06:00 local)", () => {
  assert.strictEqual(shiftAt(atLocal(5, 59)), "night");
  assert.strictEqual(shiftAt(atLocal(6, 0)), "day");
  assert.strictEqual(shiftAt(atLocal(17, 59)), "day");
  assert.strictEqual(shiftAt(atLocal(18, 0)), "night");
  assert.strictEqual(shiftAt(atLocal(0, 0)), "night");
  assert.strictEqual(shiftAt(atLocal(12, 0)), "day");
  assert.strictEqual(SHIFT_SCHEDULE.nightStartHour, 18);
  assert.strictEqual(SHIFT_SCHEDULE.nightEndHour, 6);
});

test("resolveShift: manual override beats the clock both ways", () => {
  const nightTime = atLocal(22, 0);
  const dayTime = atLocal(10, 0);
  assert.strictEqual(
    resolveShift("agent:MUSE_CWI", { at: nightTime, override: OVERRIDE.DAY }).shift,
    "day"
  );
  assert.strictEqual(
    resolveShift("agent:MUSE_CWI", { at: dayTime, override: OVERRIDE.NIGHT }).shift,
    "night"
  );
  assert.strictEqual(
    resolveShift("agent:MUSE_CWI", { at: nightTime }).override,
    OVERRIDE.AUTO
  );
  assert.strictEqual(
    resolveShift("agent:MUSE_CWI", { at: nightTime }).shift,
    "night"
  );
});

test("resolveShift: output urn always equals input urn (never invents identity)", () => {
  const urns = listAgentUrns();
  assert.strictEqual(urns.length, 10);
  for (const urn of urns) {
    for (const shift of ["day", "night"]) {
      const override = shift === "day" ? OVERRIDE.DAY : OVERRIDE.NIGHT;
      const r = resolveShift(urn, { at: atLocal(12, 0), override });
      assert.strictEqual(r.urn, urn, `identity drift for ${urn}`);
      assert.strictEqual(r.shift, shift);
    }
  }
});

test("resolveShift: MUSE_CWI day = KingCode (crowned), night = RogueCode (no crown)", () => {
  const day = resolveShift("agent:MUSE_CWI", { override: OVERRIDE.DAY });
  assert.strictEqual(day.expression.displayName, "KingCode");
  assert.ok(day.expression.marks.includes("crown-gold"));
  assert.ok(day.expression.gear.includes("crown"));

  const night = resolveShift("agent:MUSE_CWI", { override: OVERRIDE.NIGHT });
  assert.strictEqual(night.expression.displayName, "RogueCode");
  assert.ok(night.expression.marks.includes("crescent-moon"));
  for (const mark of night.expression.marks.concat(night.expression.gear)) {
    assert.ok(!mark.includes("crown"), `night mark must be crownless: ${mark}`);
  }
  assert.ok(
    night.expression.lighting.sun < day.expression.lighting.sun,
    "night lighting is dimmer"
  );
});

test("resolveShift: the nine departments keep one identity across shifts (no alter egos)", () => {
  for (const urn of listAgentUrns()) {
    if (urn === "agent:MUSE_CWI") continue;
    const day = resolveShift(urn, { override: OVERRIDE.DAY });
    const night = resolveShift(urn, { override: OVERRIDE.NIGHT });
    assert.strictEqual(
      day.expression.displayName,
      night.expression.displayName,
      `${urn} must not gain an alter ego`
    );
    assert.notStrictEqual(
      day.expression.palette.primary,
      night.expression.palette.primary,
      `${urn} night palette must differ from day`
    );
  }
});

test("resolveShift: deterministic — identical inputs give identical outputs", () => {
  const opts = { at: atLocal(21, 30), override: OVERRIDE.AUTO };
  const a = resolveShift("agent:CWI_Data", opts);
  const b = resolveShift("agent:CWI_Data", opts);
  assert.deepStrictEqual(a, b);
});

test("resolveShift: rejects unknown urn, unknown override, bad timestamp", () => {
  assert.throws(() => resolveShift("agent:INVENTED", { at: atLocal(12, 0) }));
  assert.throws(() =>
    resolveShift("agent:MUSE_CWI", { at: atLocal(12, 0), override: "sometimes" })
  );
  assert.throws(() => resolveShift("agent:MUSE_CWI", { at: "not-a-date" }));
});

test("identity-shift: every spec variant passes expression validation", () => {
  for (const urn of listAgentUrns()) {
    const spec = AGENTS[urn];
    assert.deepStrictEqual(Object.keys(spec).sort(), ["day", "night"]);
    for (const variant of ["day", "night"]) {
      const problems = validateExpression(spec[variant]);
      assert.strictEqual(
        problems.length,
        0,
        `${urn}/${variant}: ${problems.join("; ")}`
      );
    }
  }
});

test("validateExpression: catches malformed expressions", () => {
  assert.ok(
    validateExpression({ ...AGENTS["agent:MUSE_CWI"].day, accentGlow: "red" })
      .length > 0
  );
  assert.ok(
    validateExpression({
      ...AGENTS["agent:MUSE_CWI"].day,
      lighting: { fog: 2, sun: 1 },
    }).length > 0
  );
  assert.ok(validateExpression(null).length > 0);
});
