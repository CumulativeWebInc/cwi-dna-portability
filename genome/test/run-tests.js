/*
 * Tests for the CWI Expression Genome v1.
 * Run: node --test genome/test/run-tests.js   (from repo root)
 * Zero dependencies beyond Node builtins. Deterministic, no network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { validateGenome, genomeHash, signGenome, canonicalize } from "../validator.js";
import { genomeToEliza, elizaToGenome } from "../bridges/eliza.js";
import { genomeToCrewai, crewaiToGenome, parseAgentsYaml, emitAgentsYaml } from "../bridges/crewai.js";
import shift from "../../identity-shift.js";
import * as cli from "../cli.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_PATH = join(HERE, "..", "examples", "muse-cwi.genome.json");

function loadExample() {
  return JSON.parse(readFileSync(EXAMPLE_PATH, "utf8"));
}
function codes(report) {
  return report.errors.map((e) => e.code);
}

test("reference genome validates clean", () => {
  const g = loadExample();
  const r = validateGenome(g);
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

test("missing identity fails with MISSING_IDENTITY", () => {
  const g = loadExample();
  delete g.identity;
  const r = validateGenome(g);
  assert.equal(r.valid, false);
  assert.ok(codes(r).includes("MISSING_IDENTITY"));
});

test("missing sponsor fails with MISSING_SPONSOR", () => {
  const g = loadExample();
  delete g.identity.sponsor;
  const r = validateGenome(g);
  assert.equal(r.valid, false);
  assert.ok(codes(r).includes("MISSING_SPONSOR"));
  // sponsor without contact is also an orphan
  const g2 = loadExample();
  g2.identity.sponsor = { name: "Nobody" };
  assert.ok(codes(validateGenome(g2)).includes("MISSING_SPONSOR"));
});

test("model as parent of identity fails with MODEL_AS_PARENT", () => {
  const g = loadExample();
  const identity = g.identity;
  g.model = { provider: "x", model: "y", identity };
  delete g.identity;
  const r = validateGenome(g);
  assert.equal(r.valid, false);
  assert.ok(codes(r).includes("MODEL_AS_PARENT"));
});

test("model nested under identity fails with MODEL_NESTED_UNDER_IDENTITY", () => {
  const g = loadExample();
  g.identity.model = { provider: "x", model: "y" };
  delete g.model;
  const r = validateGenome(g);
  assert.equal(r.valid, false);
  assert.ok(codes(r).includes("MODEL_NESTED_UNDER_IDENTITY"));
});

test("model is a sibling of identity on the valid genome", () => {
  const g = loadExample();
  assert.ok(g.model && typeof g.model === "object");
  assert.equal(g.identity.model, undefined);
  assert.equal(g.model.identity, undefined);
  assert.ok(g.model.provider && g.model.model);
});

test("unknown state vocabulary is rejected", () => {
  const g = loadExample();
  g.operational_state.vocabulary = "felt-emotions-v1";
  const r = validateGenome(signGenome(g, "test"));
  assert.equal(r.valid, false);
  assert.ok(codes(r).includes("UNKNOWN_STATE_VOCABULARY"));
});

test("felt-emotion state names are rejected without a telemetry source", () => {
  const g = loadExample();
  g.operational_state.states = ["executing", "happy"];
  const r = validateGenome(signGenome(g, "test"));
  assert.equal(r.valid, false);
  assert.ok(codes(r).includes("FELT_EMOTION_WITHOUT_SOURCE"));
});

test("runtime state in genome fails with RUNTIME_STATE_IN_GENOME", () => {
  const g = loadExample();
  g.annotations.memory_dump = [{ role: "user", text: "hello" }];
  const r = validateGenome(signGenome(g, "test"));
  assert.equal(r.valid, false);
  assert.ok(codes(r).includes("RUNTIME_STATE_IN_GENOME"));
  // wallet material is also runtime state
  const g2 = loadExample();
  g2.model.wallet_address = "0x1234567890abcdef1234567890abcdef12345678";
  const r2 = validateGenome(signGenome(g2, "test"));
  assert.ok(codes(r2).includes("RUNTIME_STATE_IN_GENOME"));
});

test("tampered genome fails with SIGNATURE_MISMATCH", () => {
  const g = loadExample();
  g.personality.vibe = "tampered";
  const r = validateGenome(g);
  assert.equal(r.valid, false);
  assert.ok(codes(r).includes("SIGNATURE_MISMATCH"));
});

test("validator is deterministic", () => {
  const g = loadExample();
  delete g.identity.sponsor;
  g.operational_state.states = ["sad"];
  const a = validateGenome(g);
  const b = validateGenome(JSON.parse(JSON.stringify(g)));
  assert.deepEqual(a, b);
  assert.equal(a.valid, false);
});

test("sha256 is deterministic and key-order independent", () => {
  const g = loadExample();
  const shuffled = JSON.parse(JSON.stringify(g));
  const keys = Object.keys(shuffled).reverse();
  const reordered = {};
  for (const k of keys) reordered[k] = shuffled[k];
  assert.equal(genomeHash(g), genomeHash(reordered));
  assert.equal(genomeHash(g).length, 64);
  assert.ok(/^[0-9a-f]{64}$/.test(genomeHash(g)));
  assert.equal(canonicalize({ b: 1, a: [2, { z: 3, y: 4 }] }), '{"a":[2,{"y":4,"z":3}],"b":1}');
});

test("eliza export→import round trip is lossless on name/adjectives/style/modelProvider", () => {
  const g1 = loadExample();
  const c1 = genomeToEliza(g1);
  assert.equal(c1.name, "KingCode");
  assert.deepEqual(c1.adjectives, g1.personality.adjectives);
  assert.equal(c1.modelProvider, "meta");
  assert.equal(c1.settings.modelProvider, "meta");
  const g2 = elizaToGenome(c1);
  assert.equal(g2.identity.urn, g1.identity.urn, "URN invariant");
  const c2 = genomeToEliza(g2);
  assert.equal(c2.name, c1.name);
  assert.deepEqual(c2.adjectives, c1.adjectives);
  assert.deepEqual(c2.style, c1.style);
  assert.equal(c2.modelProvider, c1.modelProvider);
  assert.equal(c2.settings.modelProvider, c1.settings.modelProvider);
});

test("eliza import of a foreign character file is honest about gaps", () => {
  const foreign = {
    name: "Stranger",
    modelProvider: "openai",
    adjectives: ["curious"],
    style: { all: ["witty"], chat: ["witty"], post: ["witty"] },
    settings: {},
  };
  const g = elizaToGenome(foreign);
  assert.ok(g.identity.urn.startsWith("urn:cwi:agent:"));
  const r = validateGenome(g);
  assert.equal(r.valid, false);
  assert.ok(codes(r).includes("MISSING_SPONSOR"));
  assert.ok(codes(r).includes("MISSING_EXPRESSION"));
});

test("crewai export→import round trip is lossless on role/goal/backstory/llm", () => {
  const g1 = loadExample();
  const a1 = genomeToCrewai(g1);
  const key = Object.keys(a1)[0];
  assert.equal(key, "muse_cwi");
  assert.equal(a1[key].role, g1.annotations.crewai.role);
  assert.equal(a1[key].llm, "meta/muse-spark");
  const g2 = crewaiToGenome(a1);
  assert.equal(g2.identity.urn, g1.identity.urn, "URN invariant");
  const a2 = genomeToCrewai(g2);
  const agent2 = a2[Object.keys(a2)[0]];
  assert.equal(agent2.role, a1[key].role);
  assert.equal(agent2.goal, a1[key].goal);
  assert.equal(agent2.backstory, a1[key].backstory);
  assert.equal(agent2.llm, a1[key].llm);
});

test("crewai yaml parse/emit round trip preserves native fields", () => {
  const g1 = loadExample();
  const agents = genomeToCrewai(g1);
  const yaml = emitAgentsYaml(agents);
  assert.ok(yaml.includes("muse_cwi:"));
  assert.ok(yaml.includes("role:"));
  const parsed = parseAgentsYaml(yaml);
  const key = Object.keys(parsed)[0];
  for (const f of ["role", "goal", "backstory", "llm", "temperature", "memory", "max_iter", "cwi_genome_urn"]) {
    assert.deepEqual(parsed[key][f], agents[key][f], `yaml field ${f}`);
  }
  // folded block scalars
  const folded = parseAgentsYaml("a:\n  role: >-\n    line one\n    line two\n  memory: true\n");
  assert.equal(folded.a.role, "line one line two");
  assert.equal(folded.a.memory, true);
});

test("identity-shift integration: resolveShift on the reference genome", () => {
  const g = loadExample();
  const night = shift.resolveShift(g.identity.urn, { at: new Date(2026, 0, 5, 22, 0, 0) });
  assert.equal(night.shift, "night");
  assert.equal(night.expression.displayName, "RogueCode");
  assert.equal(night.urn, g.identity.urn, "URN invariant");
  const day = shift.resolveShift(g.identity.urn, { at: new Date(2026, 0, 5, 10, 0, 0) });
  assert.equal(day.shift, "day");
  assert.equal(day.expression.displayName, "KingCode");
  assert.equal(day.urn, g.identity.urn, "URN invariant");
});

test("genome expression variants match identity-shift.js byte-for-byte", () => {
  const g = loadExample();
  assert.deepEqual(g.expression.day, shift.AGENTS["agent:MUSE_CWI"].day);
  assert.deepEqual(g.expression.night, shift.AGENTS["agent:MUSE_CWI"].night);
  assert.equal(g.expression.schedule.nightStartHour, shift.SHIFT_SCHEDULE.nightStartHour);
  assert.equal(g.expression.schedule.nightEndHour, shift.SHIFT_SCHEDULE.nightEndHour);
});

test("cli import guard: importing cli.js never runs main()", async () => {
  assert.equal(typeof cli.main, "function");
  assert.equal(typeof cli.validateGenome, "function");
  assert.equal(typeof cli.genomeHash, "function");
  // main() is callable directly and returns exit codes
  assert.equal(cli.main(["validate", EXAMPLE_PATH]), 0);
  const bad = loadExample();
  delete bad.identity;
  const tmp = join(HERE, "tmp-bad.genome.json");
  const { writeFileSync, unlinkSync } = await import("node:fs");
  writeFileSync(tmp, JSON.stringify(bad));
  try {
    assert.equal(cli.main(["validate", tmp]), 1);
    assert.equal(cli.main(["hash", EXAMPLE_PATH]), 0);
    assert.equal(cli.main(["bogus", EXAMPLE_PATH]), 2);
  } finally {
    unlinkSync(tmp);
  }
});

test("cli hash output matches validator hash", async () => {
  const g = loadExample();
  const expected = genomeHash(g);
  assert.equal(cli.genomeHash(g), expected);
  assert.equal(expected, g.signature.genome_hash);
});

/* ---- Department genomes (minted 2026-09-16) ---- */

const DEPARTMENT_FILES = [
  ["agent:CWI_AandR", "cwi-aandr.genome.json", "Needle"],
  ["agent:CWI_Marketing", "cwi-marketing.genome.json", "Marquee"],
  ["agent:CWI_Sync", "cwi-sync.genome.json", "Seal"],
  ["agent:CWI_Radio", "cwi-radio.genome.json", "Dial"],
  ["agent:CWI_Press", "cwi-press.genome.json", "Dateline"],
  ["agent:CWI_Studio", "cwi-studio.genome.json", "Fader"],
  ["agent:CWI_Data", "cwi-data.genome.json", "Ledger"],
  ["agent:CWI_Affairs", "cwi-affairs.genome.json", "Charter"],
  ["agent:CWI_Results", "cwi-results.genome.json", "Receipt"],
];

function loadDepartment(file) {
  return JSON.parse(readFileSync(join(HERE, "..", "examples", file), "utf8"));
}

test("all nine department genomes validate clean", () => {
  for (const [urn, file] of DEPARTMENT_FILES) {
    const g = loadDepartment(file);
    const r = validateGenome(g);
    assert.equal(r.valid, true, `${file} must validate clean: ${JSON.stringify(r.errors)}`);
    assert.equal(g.identity.urn, urn, `${file} URN must be ${urn}`);
  }
});

test("all ten example genomes (chief + departments) validate clean", () => {
  const files = ["muse-cwi.genome.json", ...DEPARTMENT_FILES.map(([, f]) => f)];
  assert.equal(files.length, 10);
  const urns = new Set();
  for (const file of files) {
    const g = JSON.parse(readFileSync(join(HERE, "..", "examples", file), "utf8"));
    assert.equal(validateGenome(g).valid, true, file);
    assert.ok(!urns.has(g.identity.urn), `duplicate URN ${g.identity.urn}`);
    urns.add(g.identity.urn);
  }
  assert.equal(urns.size, 10);
});

test("department genome expressions match identity-shift.js byte-for-byte", () => {
  for (const [urn, file] of DEPARTMENT_FILES) {
    const g = loadDepartment(file);
    assert.deepEqual(g.expression.day, shift.AGENTS[urn].day, `${file} day`);
    assert.deepEqual(g.expression.night, shift.AGENTS[urn].night, `${file} night`);
    assert.equal(g.expression.schedule.nightStartHour, shift.SHIFT_SCHEDULE.nightStartHour, `${file} schedule`);
  }
});

test("department genomes carry truth-rule tone bounds", () => {
  for (const [, file] of DEPARTMENT_FILES) {
    const g = loadDepartment(file);
    const forbidden = g.personality.tone_bounds.forbidden;
    assert.ok(forbidden.includes("simulated-emotion"), `${file} must forbid simulated-emotion`);
    assert.ok(forbidden.includes("invented-metrics"), `${file} must forbid invented-metrics`);
  }
});

test("department genomes carry PREVIEW attitude and honest operational state", () => {
  for (const [, file] of DEPARTMENT_FILES) {
    const g = loadDepartment(file);
    assert.equal(g.attitude.profile, null, `${file} attitude.profile must be null (PREVIEW)`);
    assert.ok(String(g.attitude.status).startsWith("PREVIEW"), `${file} attitude.status must be PREVIEW`);
    assert.equal(g.operational_state.vocabulary, "cwi-operational-v1", file);
    assert.ok(!g.identity.sponsor || g.identity.sponsor.name === "Cumulative Web Inc", `${file} sponsor`);
  }
});

test("department genome signatures verify (integrity hash matches content)", () => {
  for (const [, file] of DEPARTMENT_FILES) {
    const g = loadDepartment(file);
    assert.equal(genomeHash(g), g.signature.genome_hash, `${file} signature mismatch`);
    assert.equal(g.signature.signed_by, "Cumulative Web Inc", file);
  }
});

test("docs mirrors are byte-identical to genome/examples copies", () => {
  const { readFileSync: rfs } = { readFileSync };
  for (const [, file] of DEPARTMENT_FILES) {
    const a = rfs(join(HERE, "..", "examples", file), "utf8");
    const b = rfs(join(HERE, "..", "..", "docs", "genome", "examples", file), "utf8");
    assert.equal(a, b, `${file} docs mirror must be byte-identical`);
  }
});

test("department genome names match the roster", () => {
  for (const [, file, name] of DEPARTMENT_FILES) {
    const g = loadDepartment(file);
    assert.equal(g.identity.name, name, `${file} name must be ${name}`);
  }
});
