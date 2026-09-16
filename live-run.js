#!/usr/bin/env node
/*
 * DNA portability harness — LIVE run via Pollinations (free, no key).
 *
 * Same 3 framings + same deterministic metrics as run.js, but the outputs
 * come from a REAL second model family (Pollinations "openai-fast",
 * GPT-OSS 20B) instead of the MOCK generator. Every output carries
 * generator:"pollinations/openai-fast" + timestamp. Failures are recorded
 * in the report, never silently dropped.
 *
 * Usage: node live-run.js [profile.json] [task prompt...] [--out report.json]
 * Zero dependencies (pure Node https).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const {
  FRAMINGS,
  vocabOverlap,
  boundsAdherence,
  toneHits,
} = require("./run.js");

// Standalone release: prefer the full attitude-engine profile when the rig
// sits inside the CWI lab tree; otherwise fall back to the bundled sample.
let DEFAULT_PROFILE = path.resolve(
  __dirname,
  "../../../apps/attitude-engine/profiles/that-boy-hi-hat.json"
);
try {
  if (!fs.existsSync(DEFAULT_PROFILE)) {
    DEFAULT_PROFILE = path.resolve(__dirname, "./sample-profile.json");
  }
} catch (_) {}

const POLLINATIONS_URL = "https://text.pollinations.ai/openai";
const MODEL = "openai-fast";

function postChat(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 350,
      temperature: 0.7,
    });
    const req = https.request(
      POLLINATIONS_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": "cwi-lab/1.0",
        },
        timeout: 120000,
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 200)}`));
            return;
          }
          try {
            const j = JSON.parse(d);
            const text =
              (j.choices && j.choices[0] && j.choices[0].message &&
                j.choices[0].message.content) || "";
            resolve(text.trim());
          } catch (e) {
            reject(new Error("bad JSON: " + d.slice(0, 200)));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(new Error("request timeout")); });
    req.end(body);
  });
}

async function runLiveExperiment(profile, task) {
  const framings = [];
  for (const key of Object.keys(FRAMINGS)) {
    const wrapper = FRAMINGS[key].wrap(profile, task);
    let output;
    try {
      const text = await postChat(wrapper);
      output = {
        generator: `pollinations/${MODEL}`,
        framing: key,
        at: new Date().toISOString(),
        note: "Live model output via Pollinations free tier (no key).",
        text,
      };
    } catch (e) {
      output = {
        generator: `pollinations/${MODEL}`,
        framing: key,
        at: new Date().toISOString(),
        note: "CALL FAILED: " + e.message,
        text: "",
        failed: true,
      };
    }
    framings.push({
      key,
      label: FRAMINGS[key].label,
      description: FRAMINGS[key].description,
      wrapper_prompt: wrapper,
      output,
      metrics: {
        bounds: boundsAdherence(output.text),
        tone: toneHits(output.text, profile),
      },
    });
  }

  const texts = framings.map((f) => f.output.text).filter(Boolean);
  const densities = framings.map((f) => f.metrics.tone.density);
  const meanBounds =
    framings.reduce((s, f) => s + f.metrics.bounds.pass_rate, 0) / framings.length;
  const failures = framings.filter((f) => f.output.failed).map((f) => f.key);

  return {
    experiment: "dna-portability-live",
    model_outputs: `LIVE — Pollinations ${MODEL} (free tier, no key). Second model family after the lab's own runtime.`,
    profile: {
      name: profile.identity.name,
      version: profile.profile_version || profile.identity.version,
      provenance: (profile.provenance && profile.provenance.profile) || "unknown",
    },
    task,
    framings,
    metrics: {
      vocab_overlap_mean_jaccard: texts.length > 1 ? vocabOverlap(texts) : 0,
      bounds_adherence_mean_pass_rate: meanBounds,
      tone_density_per_framing: Object.fromEntries(
        framings.map((f) => [f.key, f.metrics.tone.density])
      ),
      tone_density_consistency_min_max:
        Math.max(...densities) === 0 ? 0 : Math.min(...densities) / Math.max(...densities),
    },
    failed_framings: failures,
    verdict:
      failures.length === 0
        ? "First live cross-runtime run complete on a second model family. Compare with EXPERIMENT-001 (mock) for rig validation."
        : `Completed with ${failures.length} failed framing(s): ${failures.join(", ")}. Failures recorded, not hidden.`,
  };
}

async function main() {
  const raw = process.argv.slice(2);
  const outIdx = raw.indexOf("--out");
  const outFile = outIdx >= 0 ? raw[outIdx + 1] : null;
  const args = raw.filter((a, i) => !(i === outIdx || i === outIdx + 1));
  const first = args[0];
  const firstIsProfile = first && (first.endsWith(".json") || fs.existsSync(first));
  const profilePath = firstIsProfile ? first : DEFAULT_PROFILE;
  const taskParts = args.slice(firstIsProfile ? 1 : 0);
  const task =
    taskParts.join(" ") ||
    "Recommend a That Boy Hi Hat track for a nighttime driving scene in a game trailer.";

  const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  const report = await runLiveExperiment(profile, task);
  const json = JSON.stringify(report, null, 2);
  if (outFile) fs.writeFileSync(outFile, json);
  process.stdout.write(json + "\n");
}

if (require.main === module) main().catch((e) => { console.error("LIVE_FAIL:", e.message); process.exit(1); });

module.exports = { runLiveExperiment, MODEL };
