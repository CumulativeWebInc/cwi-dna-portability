/*
 * bridges/eliza.js — bidirectional converter between the CWI Expression
 * Genome v1 and ElizaOS character files.
 *
 * ElizaOS character interface studied from the public ElizaOS documentation
 * (docs.elizaos.ai) and the elizaOS/characterfile reference repo: name,
 * username, system, bio[], lore[], knowledge[], messageExamples, postExamples,
 * topics[], style {all, chat, post}, adjectives[], plugins[], clients[],
 * modelProvider (top level in ElizaOS; mirrored under settings here for
 * compatibility), settings {secrets, voice, ...}.
 * Studied as studied: this is our own code, not endorsed by or affiliated
 * with ElizaOS.
 *
 * URN invariant: converter output URN === input URN, always. The genome URN
 * rides in settings.cwi_genome_urn so a round trip restores it byte-for-byte.
 * CWI-specific sections with no ElizaOS counterpart (expression variants,
 * operational_state, sponsor, permissions) travel as documented passthrough
 * keys under settings.cwi_* — never dropped silently.
 */
import { signGenome, ATTITUDE_SCHEMA_URL, STATE_VOCABULARY } from "../validator.js";

export const ELIZA_BRIDGE_VERSION = "1.0.0";

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

// Derive an ElizaOS style block deterministically when the genome carries
// no explicit style annotation. tone_bounds.allowed drives `all`/`chat`.
function deriveStyle(genome) {
  const allowed = (genome.personality && genome.personality.tone_bounds && genome.personality.tone_bounds.allowed) || [];
  return { all: [...allowed], chat: [...allowed], post: ["announcement"] };
}

export function genomeToEliza(genome) {
  if (!genome || typeof genome !== "object") throw new Error("eliza bridge: genome must be an object");
  const identity = genome.identity || {};
  const personality = genome.personality || {};
  const model = genome.model || {};
  const annotations = genome.annotations || {};
  const elizaAnn = annotations.eliza || {};

  const style = elizaAnn.style ? deepClone(elizaAnn.style) : deriveStyle(genome);

  const bio = [];
  if (identity.description) bio.push(identity.description);
  if (identity.sponsor && identity.sponsor.name)
    bio.push(`Accountable sponsor: ${identity.sponsor.name} (${identity.sponsor.contact || "contact on file"}).`);

  const character = {
    name: identity.name || "unnamed",
    username: identity.handle || slug(identity.name),
    system: personality.vibe || "",
    bio,
    lore: [],
    knowledge: (genome.capabilities || []).map((c) => `Capability: ${c.name} — ${c.description}`),
    messageExamples: [],
    postExamples: [],
    topics: (genome.capabilities || []).map((c) => c.name),
    style,
    adjectives: [...(personality.adjectives || [])],
    plugins: [],
    clients: [],
    // ElizaOS reads modelProvider at the top level; we mirror it under
    // settings too (the field named in the CWI bridge spec).
    modelProvider: model.provider || "unknown",
    settings: {
      modelProvider: model.provider || "unknown",
      model: model.model || "unknown",
      temperature: model.temperature ?? null,
      secrets: {},
      // --- CWI passthrough: lossless round trip for genome-native sections ---
      cwi_bridge: `cwi-expression-genome/${ELIZA_BRIDGE_VERSION}`,
      cwi_genome_urn: identity.urn || null,
      cwi_genome_version: genome.genome_version || null,
      cwi_sponsor: identity.sponsor ? deepClone(identity.sponsor) : null,
      cwi_tone_bounds: personality.tone_bounds ? deepClone(personality.tone_bounds) : null,
      cwi_attitude: genome.attitude ? deepClone(genome.attitude) : null,
      cwi_expression: genome.expression ? deepClone(genome.expression) : null,
      cwi_operational_state: genome.operational_state ? deepClone(genome.operational_state) : null,
      cwi_capabilities: genome.capabilities ? deepClone(genome.capabilities) : null,
      cwi_memory_policy: genome.memory_policy ? deepClone(genome.memory_policy) : null,
      cwi_permissions: genome.permissions ? deepClone(genome.permissions) : null,
      cwi_model: deepClone(model),
      cwi_annotations: annotations && Object.keys(annotations).length ? deepClone(annotations) : null,
    },
  };
  return character;
}

export function elizaToGenome(character, opts = {}) {
  if (!character || typeof character !== "object") throw new Error("eliza bridge: character must be an object");
  const settings = character.settings || {};

  const urn = settings.cwi_genome_urn || `urn:cwi:agent:${slug(character.name)}`;
  const sponsor = settings.cwi_sponsor || {
    name: "UNCLAIMED",
    contact: "UNCLAIMED",
    role: "accountable-party",
    note: "PREVIEW — no sponsor declared in the source character file; set identity.sponsor before this genome validates.",
  };
  const toneBounds = settings.cwi_tone_bounds || {
    allowed: [...((character.style && character.style.all) || [])],
    forbidden: [],
  };
  // Restore genome-native annotations carried through the export, then layer
  // the eliza style block on top (it is authoritative for this bridge).
  const ann = settings.cwi_annotations ? deepClone(settings.cwi_annotations) : {};
  if (character.style) {
    ann.eliza = { ...(ann.eliza || {}), style: deepClone(character.style) };
  }

  const genome = {
    genome_version: settings.cwi_genome_version || "1.0.0",
    identity: {
      urn,
      name: character.name || "unnamed",
      handle: character.username || slug(character.name),
      description: (character.bio || []).join(" ") || undefined,
      sponsor,
    },
    personality: {
      vibe: character.system || (character.bio || [])[0] || "",
      adjectives: [...(character.adjectives || [])],
      tone_bounds: toneBounds,
    },
    attitude: settings.cwi_attitude || {
      schema: ATTITUDE_SCHEMA_URL,
      profile: null,
      status: "PREVIEW — attitude not carried by the ElizaOS character format; schema reference only.",
    },
    expression: settings.cwi_expression || null,
    operational_state: settings.cwi_operational_state || {
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
      rules: ["PREVIEW — no operational state declared in the source character file."],
    },
    capabilities: settings.cwi_capabilities || (character.topics || []).map((t) => ({
      name: String(t),
      description: "Imported from ElizaOS topics; describe explicitly before use.",
      requires_approval: true,
    })),
    memory_policy: settings.cwi_memory_policy || {
      retention: "unknown",
      scope: [],
      notes: "PREVIEW — not declared in the source character file.",
    },
    permissions: settings.cwi_permissions || {
      spending: false,
      wallet_signing: false,
      note: "PREVIEW — safe defaults; declare explicitly before use.",
    },
    model: {
      provider: character.modelProvider || settings.modelProvider || "unknown",
      model: (settings.cwi_model && settings.cwi_model.model) || settings.model || "unknown",
      temperature: settings.temperature ?? null,
      note: "Swappable pointer: re-point provider/model and the same agent runs elsewhere.",
    },
    signature: { algorithm: "sha256", genome_hash: "0".repeat(64), signed_by: "PENDING" },
  };
  if (genome.identity.description === undefined) delete genome.identity.description;
  if (Object.keys(ann).length) genome.annotations = ann;

  // Fresh integrity hash for the produced genome (content seal, not identity).
  const signed = signGenome(genome, opts.signedBy || "cwi-genome-bridge/eliza", null);
  signed.signature.note = "Integrity hash of the bridge-produced genome; re-sign after review.";
  return signed;
}
