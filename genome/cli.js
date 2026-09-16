#!/usr/bin/env node
/*
 * cli.js — command line for the CWI Expression Genome v1.
 *
 *   node genome/cli.js validate <genome.json>
 *   node genome/cli.js hash <genome.json>
 *   node genome/cli.js eliza-export <genome.json> [out.character.json]
 *   node genome/cli.js eliza-import <character.json> [out.genome.json]
 *   node genome/cli.js crewai-export <genome.json> [out.agents.yaml]
 *   node genome/cli.js crewai-import <agents.yaml|json> [out.genome.json] [--agent KEY]
 *
 * Exports print to stdout when no output path is given (pipe-friendly).
 * Importable by tests: the entry-point guard below means importing this
 * module never runs main().
 */
import { readFileSync, writeFileSync } from "node:fs";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateGenome, genomeHash, signGenome } from "./validator.js";
import { genomeToEliza, elizaToGenome } from "./bridges/eliza.js";
import { genomeToCrewai, crewaiToGenome, parseAgentsYaml, emitAgentsYaml } from "./bridges/crewai.js";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function emit(target, text) {
  if (target) writeFileSync(target, text);
  else process.stdout.write(text + (text.endsWith("\n") ? "" : "\n"));
}

function cmdValidate(file) {
  const report = validateGenome(readJson(file));
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  return report.valid ? 0 : 1;
}

function cmdHash(file) {
  process.stdout.write(genomeHash(readJson(file)) + "\n");
  return 0;
}

function cmdElizaExport(file, out) {
  const character = genomeToEliza(readJson(file));
  emit(out, JSON.stringify(character, null, 2));
  return 0;
}

function cmdElizaImport(file, out) {
  const genome = elizaToGenome(readJson(file));
  const report = validateGenome(genome);
  if (!report.valid) {
    process.stderr.write(
      `note: imported genome is incomplete — ${report.errors.map((e) => e.code).join(", ")}\n`
    );
  }
  emit(out, JSON.stringify(genome, null, 2));
  return 0;
}

function cmdCrewaiExport(file, out) {
  const agents = genomeToCrewai(readJson(file));
  const text = out && (out.endsWith(".yaml") || out.endsWith(".yml"))
    ? emitAgentsYaml(agents)
    : JSON.stringify(agents, null, 2);
  // Default (stdout) is YAML — the native agents.yaml shape.
  emit(out, out ? text : emitAgentsYaml(agents));
  return 0;
}

function cmdCrewaiImport(file, out, agentKey) {
  const raw = readFileSync(file, "utf8");
  const agents = (file.endsWith(".yaml") || file.endsWith(".yml")) ? parseAgentsYaml(raw) : JSON.parse(raw);
  const genome = crewaiToGenome(agents, agentKey ? { agentKey } : {});
  const report = validateGenome(genome);
  if (!report.valid) {
    process.stderr.write(
      `note: imported genome is incomplete — ${report.errors.map((e) => e.code).join(", ")}\n`
    );
  }
  emit(out, JSON.stringify(genome, null, 2));
  return 0;
}

function usage() {
  return `usage:
  genome/cli.js validate <genome.json>
  genome/cli.js hash <genome.json>
  genome/cli.js eliza-export <genome.json> [out.character.json]
  genome/cli.js eliza-import <character.json> [out.genome.json]
  genome/cli.js crewai-export <genome.json> [out.agents.yaml]
  genome/cli.js crewai-import <agents.yaml|json> [out.genome.json] [--agent KEY]`;
}

export function main(argv = process.argv.slice(2)) {
  const [cmd, file, out, ...rest] = argv;
  if (!cmd || !file) {
    process.stderr.write(usage() + "\n");
    return 2;
  }
  switch (cmd) {
    case "validate": return cmdValidate(file);
    case "hash": return cmdHash(file);
    case "eliza-export": return cmdElizaExport(file, out);
    case "eliza-import": return cmdElizaImport(file, out);
    case "crewai-export": return cmdCrewaiExport(file, out);
    case "crewai-import": {
      const keyFlag = rest.indexOf("--agent");
      return cmdCrewaiImport(file, out, keyFlag >= 0 ? rest[keyFlag + 1] : undefined);
    }
    default:
      process.stderr.write(`unknown command: ${cmd}\n${usage()}\n`);
      return 2;
  }
}

// Entry-point guard: importable by tests without running main().
// realpathSync on both sides so symlinked checkouts still match.
const __filename = fileURLToPath(import.meta.url);
const invokedAsMain = (() => {
  try {
    const a1 = process.argv[1];
    if (!a1) return false;
    return realpathSync(a1) === realpathSync(__filename);
  } catch {
    return false;
  }
})();
if (invokedAsMain) {
  process.exitCode = main();
}

export { validateGenome, genomeHash, signGenome };
