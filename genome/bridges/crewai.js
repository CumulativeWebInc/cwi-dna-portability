/*
 * bridges/crewai.js — bidirectional converter between the CWI Expression
 * Genome v1 and CrewAI `agents.yaml` shape.
 *
 * CrewAI agents.yaml shape studied from the public CrewAI documentation:
 * a mapping of agent keys to { role, goal, backstory, llm, temperature,
 * memory, max_iter, ... }. Studied as studied: our own code, not endorsed
 * by or affiliated with CrewAI.
 *
 * URN invariant: converter output URN === input URN, always. The genome URN
 * rides in a `cwi_genome_urn` field so a round trip restores it byte-for-byte.
 * CWI sections with no CrewAI counterpart travel under `cwi_*` keys —
 * never dropped silently.
 *
 * YAML support: a minimal deterministic parser/emitter for the flat
 * agents.yaml subset (2-space indented maps, block scalars > / |, and plain
 * scalars). It is not a general YAML parser and does not try to be.
 */
import { signGenome, ATTITUDE_SCHEMA_URL, STATE_VOCABULARY } from "../validator.js";

export const CREWAI_BRIDGE_VERSION = "1.0.0";
export const CREWAI_FIELD_ORDER = ["role", "goal", "backstory", "llm", "temperature", "memory", "max_iter", "cwi_genome_urn"];

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "agent";
}

function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}

/* ---------------- minimal YAML subset (agents.yaml shape) ---------------- */

function parseScalar(raw) {
  const s = raw.trim();
  if (s === "" || s === "~" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
    return s.slice(1, -1);
  return s;
}

// Parse the flat agents.yaml subset:
//   agent_key:
//     role: >
//       folded text
//     goal: plain text
//     memory: true
function parseAgentsYaml(text) {
  const lines = String(text).split(/\r?\n/);
  const agents = {};
  let key = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
    const indent = line.match(/^ */)[0].length;
    const trimmed = line.trim();
    if (indent === 0) {
      const m = trimmed.match(/^([A-Za-z0-9_.-]+):\s*$/);
      if (!m) throw new Error(`crewai yaml: expected agent key at line ${i + 1}: ${trimmed}`);
      key = m[1];
      agents[key] = {};
      i++;
      continue;
    }
    if (key === null) throw new Error(`crewai yaml: field before any agent key at line ${i + 1}`);
    const fm = trimmed.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!fm) throw new Error(`crewai yaml: cannot parse line ${i + 1}: ${trimmed}`);
    const field = fm[1];
    let value = fm[2];
    if (value === ">" || value === ">-" || value === "|" || value === "|-") {
      // Block scalar: consume more-indented lines.
      const buf = [];
      i++;
      while (i < lines.length && (lines[i].trim() === "" || lines[i].match(/^ */)[0].length > indent)) {
        buf.push(lines[i].trim());
        i++;
      }
      const folded = value.startsWith(">");
      value = folded ? buf.filter(Boolean).join(" ") : buf.join("\n");
    } else {
      value = parseScalar(value);
      i++;
    }
    agents[key][field] = value;
  }
  return agents;
}

function yamlScalar(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  const s = String(v);
  if (s.includes("\n")) {
    return "|\n" + s.split("\n").map((l) => `      ${l}`).join("\n");
  }
  if (/[:#\n]/.test(s) || s !== s.trim() || s === "") return JSON.stringify(s);
  return s;
}

function emitAgentsYaml(agents) {
  // YAML carries the native CrewAI fields plus cwi_genome_urn (scalar).
  // Nested cwi_* passthrough objects are JSON-export only — CrewAI's
  // agents.yaml shape is flat scalars, and full-fidelity round trips
  // use the JSON form. Non-scalar values are skipped, never corrupted.
  const out = [];
  for (const key of Object.keys(agents)) {
    out.push(`${key}:`);
    const agent = agents[key];
    const isScalar = (v) => v === null || ["string", "number", "boolean"].includes(typeof v);
    const fields = [
      ...CREWAI_FIELD_ORDER.filter((f) => f in agent && isScalar(agent[f])),
      ...Object.keys(agent).filter((f) => !CREWAI_FIELD_ORDER.includes(f) && isScalar(agent[f])).sort(),
    ];
    for (const f of fields) {
      const v = agent[f];
      if (typeof v === "string" && v.length > 60 && !v.includes("\n")) {
        out.push(`  ${f}: >-`);
        // simple word wrap at ~80 cols
        const words = v.split(" ");
        let line = "    ";
        for (const w of words) {
          if ((line + w).length > 84 && line.trim()) { out.push(line.trimEnd()); line = "    "; }
          line += w + " ";
        }
        if (line.trim()) out.push(line.trimEnd());
      } else {
        out.push(`  ${f}: ${yamlScalar(v)}`);
      }
    }
  }
  return out.join("\n") + "\n";
}

export { parseAgentsYaml, emitAgentsYaml };

/* ------------------------------ converters ------------------------------ */

function llmString(model) {
  const provider = (model && model.provider) || "unknown";
  const name = (model && model.model) || "unknown";
  if (provider === "unknown") return name;
  return name.startsWith(provider + "/") ? name : `${provider}/${name}`;
}

function splitLlm(llm) {
  const s = String(llm || "unknown");
  const idx = s.indexOf("/");
  if (idx > 0) return { provider: s.slice(0, idx), model: s.slice(idx + 1) };
  return { provider: "unknown", model: s };
}

export function genomeToCrewai(genome) {
  if (!genome || typeof genome !== "object") throw new Error("crewai bridge: genome must be an object");
  const identity = genome.identity || {};
  const model = genome.model || {};
  const annotations = genome.annotations || {};
  const crewAnn = annotations.crewai || {};
  const key = slug(identity.handle || identity.name);

  const capabilities = genome.capabilities || [];
  const role = crewAnn.role || `${identity.name || "Agent"} — ${(capabilities[0] && capabilities[0].name) || "generalist"}`;
  const goal = crewAnn.goal || `Operate as ${identity.name || "the agent"} per its genome: ${identity.description || "no description"}.`;
  const backstory = crewAnn.backstory ||
    `${identity.name || "Agent"} (${identity.urn || "urn:cwi:agent:unknown"}) is the portable identity of ${identity.sponsor && identity.sponsor.name ? identity.sponsor.name : "its sponsor"}.`;

  const agent = {
    role,
    goal,
    backstory,
    llm: llmString(model),
    temperature: model.temperature ?? null,
    memory: crewAnn.memory ?? (genome.memory_policy ? true : false),
    max_iter: crewAnn.max_iter ?? 25,
    cwi_genome_urn: identity.urn || null,
  };
  // CWI passthrough: lossless round trip for genome-native sections.
  agent.cwi_bridge = `cwi-expression-genome/${CREWAI_BRIDGE_VERSION}`;
  agent.cwi_genome_version = genome.genome_version || null;
  agent.cwi_identity = { name: identity.name || null, handle: identity.handle || null, description: identity.description || null };
  agent.cwi_sponsor = identity.sponsor ? deepClone(identity.sponsor) : null;
  agent.cwi_personality = genome.personality ? deepClone(genome.personality) : null;
  agent.cwi_attitude = genome.attitude ? deepClone(genome.attitude) : null;
  agent.cwi_expression = genome.expression ? deepClone(genome.expression) : null;
  agent.cwi_operational_state = genome.operational_state ? deepClone(genome.operational_state) : null;
  agent.cwi_capabilities = capabilities.length ? deepClone(capabilities) : null;
  agent.cwi_memory_policy = genome.memory_policy ? deepClone(genome.memory_policy) : null;
  agent.cwi_permissions = genome.permissions ? deepClone(genome.permissions) : null;
  agent.cwi_model = deepClone(model);
  if (annotations && Object.keys(annotations).length) agent.cwi_annotations = deepClone(annotations);

  return { [key]: agent };
}

export function crewaiToGenome(agents, opts = {}) {
  if (!agents || typeof agents !== "object") throw new Error("crewai bridge: agents must be an object");
  const keys = Object.keys(agents);
  if (!keys.length) throw new Error("crewai bridge: no agents in input");
  const key = (opts.agentKey && agents[opts.agentKey]) ? opts.agentKey : keys[0];
  const a = agents[key] || {};

  const urn = a.cwi_genome_urn || `urn:cwi:agent:${slug(key)}`;
  const llm = splitLlm(a.llm);
  const ann = a.cwi_annotations ? deepClone(a.cwi_annotations) : {};
  ann.crewai = {
    ...(ann.crewai || {}),
    role: a.role || "",
    goal: a.goal || "",
    backstory: a.backstory || "",
    memory: a.memory ?? null,
    max_iter: a.max_iter ?? null,
  };

  const genome = {
    genome_version: a.cwi_genome_version || "1.0.0",
    identity: {
      urn,
      name: (a.cwi_identity && a.cwi_identity.name) || key,
      handle: (a.cwi_identity && a.cwi_identity.handle) || key,
      description: (a.cwi_identity && a.cwi_identity.description) || undefined,
      sponsor: a.cwi_sponsor || {
        name: "UNCLAIMED",
        contact: "UNCLAIMED",
        role: "accountable-party",
        note: "PREVIEW — no sponsor declared in the source agents.yaml; set identity.sponsor before this genome validates.",
      },
    },
    personality: a.cwi_personality || {
      vibe: a.backstory || "",
      adjectives: [],
      tone_bounds: { allowed: [], forbidden: [] },
    },
    attitude: a.cwi_attitude || {
      schema: ATTITUDE_SCHEMA_URL,
      profile: null,
      status: "PREVIEW — attitude not carried by the CrewAI agents.yaml format; schema reference only.",
    },
    expression: a.cwi_expression || null,
    operational_state: a.cwi_operational_state || {
      vocabulary: STATE_VOCABULARY,
      states: [],
      fields: {
        state: "operational state name",
        confidence: "0..1",
        task_pressure: "0..1",
        interaction_mode: "chat | build | broadcast | idle",
        source: "REQUIRED — telemetry source tag",
        vocabulary: STATE_VOCABULARY,
      },
      rules: ["PREVIEW — no operational state declared in the source agents.yaml."],
    },
    capabilities: a.cwi_capabilities || [{
      name: String(a.role || key),
      description: "Imported from CrewAI role; describe explicitly before use.",
      requires_approval: true,
    }],
    memory_policy: a.cwi_memory_policy || {
      retention: "unknown",
      scope: [],
      notes: "PREVIEW — not declared in the source agents.yaml.",
    },
    permissions: a.cwi_permissions || {
      spending: false,
      wallet_signing: false,
      note: "PREVIEW — safe defaults; declare explicitly before use.",
    },
    model: {
      provider: (a.cwi_model && a.cwi_model.provider) || llm.provider,
      model: (a.cwi_model && a.cwi_model.model) || llm.model,
      temperature: a.temperature ?? null,
      note: "Swappable pointer: re-point provider/model and the same agent runs elsewhere.",
    },
    annotations: ann,
    signature: { algorithm: "sha256", genome_hash: "0".repeat(64), signed_by: "PENDING" },
  };
  if (genome.identity.description === undefined) delete genome.identity.description;

  const signed = signGenome(genome, opts.signedBy || "cwi-genome-bridge/crewai", null);
  signed.signature.note = "Integrity hash of the bridge-produced genome; re-sign after review.";
  return signed;
}
