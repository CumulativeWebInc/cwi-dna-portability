/*
 * Tests for the Genome Gallery (docs/gallery/).
 * Run: node --test gallery/test/run-tests.js   (from repo root)
 * Zero dependencies beyond Node builtins.
 *
 * Covers: vendor freshness (gallery runs the REAL resolver + validator, not
 * re-implementations), the browser SHA-256 shim, day/night resolution for all
 * 10 genomes, validator passing all 10, the live genome URLs behind the
 * gallery, and honest page wiring (no placeholder text).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

import shift from "../../identity-shift.js";
import * as shiftEsm from "../../docs/gallery/vendor/identity-shift.esm.js";
import { validateGenome, sha256Hex, canonicalize } from "../../docs/gallery/vendor/validator.esm.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const GALLERY = join(ROOT, "docs", "gallery");
const EXAMPLES = join(ROOT, "genome", "examples");
const LIVE_BASE = "https://cumulativewebinc.github.io/cwi-dna-portability/genome/examples/";

function genomeFiles() {
  return readdirSync(EXAMPLES).filter((f) => f.endsWith(".genome.json")).sort();
}
function loadGenome(f) {
  return JSON.parse(readFileSync(join(EXAMPLES, f), "utf8"));
}
function urns() {
  return genomeFiles().map((f) => loadGenome(f).identity.urn);
}

test("gallery vendor files are fresh (regenerate byte-identical)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "gg-vendor-"));
  try {
    execFileSync(process.execPath, [join(GALLERY, "build-vendor.mjs"), tmp], {
      cwd: ROOT,
      stdio: "pipe",
    });
    for (const f of ["identity-shift.esm.js", "validator.esm.js"]) {
      const committed = readFileSync(join(GALLERY, "vendor", f), "utf8");
      const fresh = readFileSync(join(tmp, f), "utf8");
      assert.equal(fresh, committed, `${f} is stale — rerun docs/gallery/build-vendor.mjs`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("vendored SHA-256 shim matches known vector", () => {
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
  assert.equal(
    sha256Hex("The quick brown fox jumps over the lazy dog"),
    "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592"
  );
});

test("vendored identity-shift matches the canonical module for all genomes", () => {
  const at = new Date("2026-01-01T12:00:00");
  for (const urn of urns()) {
    for (const override of ["auto", "force-day", "force-night"]) {
      const a = shift.resolveShift(urn, { at, override });
      const b = shiftEsm.resolveShift(urn, { at, override });
      assert.deepEqual(b, a, `resolver drift for ${urn} @ ${override}`);
    }
  }
});

test("shift resolver: day at noon, night at 20:00, URN preserved, for all 10", () => {
  const files = genomeFiles();
  assert.equal(files.length, 10);
  for (const urn of urns()) {
    const day = shift.resolveShift(urn, { at: new Date("2026-01-01T12:00:00"), override: "auto" });
    const night = shift.resolveShift(urn, { at: new Date("2026-01-01T20:00:00"), override: "auto" });
    assert.equal(day.shift, "day", urn);
    assert.equal(night.shift, "night", urn);
    assert.equal(day.urn, urn);
    assert.equal(night.urn, urn);
    const forced = shift.resolveShift(urn, { at: new Date("2026-01-01T12:00:00"), override: "force-night" });
    assert.equal(forced.shift, "night", `${urn} force-night`);
  }
  const muse = shift.resolveShift("agent:MUSE_CWI", { at: new Date("2026-01-01T12:00:00") });
  assert.equal(muse.expression.displayName, "KingCode");
  const rogue = shift.resolveShift("agent:MUSE_CWI", { at: new Date("2026-01-01T20:00:00") });
  assert.equal(rogue.expression.displayName, "RogueCode");
});

test("vendored validator passes all 10 local genomes (exercises signature recompute)", () => {
  for (const f of genomeFiles()) {
    const r = validateGenome(loadGenome(f));
    assert.equal(r.valid, true, `${f}: ${JSON.stringify(r.errors)}`);
  }
});

test("resolver output matches each genome file's own expression block", () => {
  for (const f of genomeFiles()) {
    const g = loadGenome(f);
    for (const [override, want] of [["force-day", "day"], ["force-night", "night"]]) {
      const res = shiftEsm.resolveShift(g.identity.urn, {
        at: new Date("2026-01-01T12:00:00"),
        override,
      });
      assert.equal(
        canonicalize(res.expression),
        canonicalize(g.expression[want]),
        `${f} resolver vs file @ ${want}`
      );
    }
  }
});

test("all 10 live genome URLs return HTTP 200 with valid genomes", async (t) => {
  for (const f of genomeFiles()) {
    let r;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 15000);
      r = await fetch(LIVE_BASE + f, { signal: ctrl.signal });
      clearTimeout(to);
    } catch (e) {
      t.skip(`network unreachable for live check (${e.message})`);
      return;
    }
    assert.equal(r.status, 200, `${f} live status`);
    const g = await r.json();
    assert.ok(g.identity?.urn, `${f} has identity.urn`);
    const rep = validateGenome(g);
    assert.equal(rep.valid, true, `${f} live validates: ${JSON.stringify(rep.errors)}`);
  }
});

test("gallery page wires all 10 genome files with honest, non-placeholder copy", () => {
  const html = readFileSync(join(GALLERY, "index.html"), "utf8");
  const js = readFileSync(join(GALLERY, "app.js"), "utf8");
  assert.ok(html.includes('src="app.js"'), "index.html loads app.js");
  assert.ok(html.includes('href="styles.css"'), "index.html loads styles.css");
  for (const f of genomeFiles()) {
    assert.ok(js.includes(`"${f}"`), `app.js lists ${f}`);
  }
  assert.ok(js.includes("../genome/examples/"), "app.js fetches from the live examples dir");
  assert.ok(!/lorem ipsum/i.test(js + html), "no lorem ipsum");
  assert.ok(!/TODO|FIXME/i.test(js + html), "no TODO/FIXME markers");
  assert.ok(js.includes("unavailable"), "honest unavailable state exists");
  assert.ok(js.includes("identity-shift.esm.js"), "uses the real vendored resolver");
  assert.ok(js.includes("validator.esm.js"), "uses the real vendored validator");
});
