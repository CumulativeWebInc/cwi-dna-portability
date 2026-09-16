/*
 * validator.js — deterministic validator for the CWI Expression Genome v1.
 *
 * validateGenome(obj) -> { valid, errors[] } with named error codes.
 * Zero dependencies: Node stdlib only (node:crypto for the integrity hash).
 * Deterministic: identical input always yields the identical, identically
 * ordered errors array. No network, no randomness, no Date.now().
 *
 * Canonical form for the integrity hash: JSON with object keys sorted
 * recursively, no whitespace, UTF-8, sha256 hex. The signature section is
 * excluded before hashing (a file cannot contain its own hash).
 */
import { createHash } from "node:crypto";

export const GENOME_VERSION = "1.0.0";
export const STATE_VOCABULARY = "cwi-operational-v1";
export const ATTITUDE_SCHEMA_URL =
  "https://cumulativewebinc.github.io/cwi-attitude-engine/attitude-schema.json";
export const URN_PATTERN = /^(urn:cwi:)?agent:[A-Za-z0-9_.-]+$/;
export const HEX64_PATTERN = /^[0-9a-f]{64}$/;
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

// Felt-emotion terms are never valid operational states: a genome asserting
// "happy" / "anxious" / ... without a telemetry source is rejected. These
// words may appear in prose (tone bounds, descriptions) — never as state names.
const FELT_EMOTION_WORDS = new Set([
  "happy", "sad", "angry", "anxious", "excited", "lonely", "afraid",
  "jealous", "proud", "ashamed", "depressed", "euphoric", "elated",
  "miserable", "furious", "terrified", "ecstatic", "gloomy", "irritated",
  "content", "bored", "hopeful", "hopeless", "loving", "hateful",
]);

// Blueprint vs instance rule: a genome file must NEVER contain runtime state.
// Key names that always indicate secret material (tier 1) fail on sight.
// "wallet" is allowed only as the boolean permission flag `wallet_signing`;
// any other wallet key, credential/token/session/cookie key whose value looks
// like material (object, or a long spaceless string) also fails (tier 2).
const TIER1_RUNTIME_KEYS = [
  "private_key", "privatekey", "api_key", "apikey", "secret", "password",
  "passwd", "mnemonic", "seed_phrase", "seedphrase", "memory_dump",
  "memorydump", "auth_token", "access_token", "bearer", "session_key",
];
const TIER2_WALLET_MATERIAL_KEYS = [
  "wallet_address", "wallet_private_key", "wallet_seed", "wallet_mnemonic", "wallet_secret",
];

function valueLooksLikeMaterial(v) {
  if (v !== null && typeof v === "object") return true;
  if (typeof v !== "string" || !v) return false;
  if (/\s/.test(v)) return false; // prose/policy notes have spaces
  return v.length >= 16 || /^0x[0-9a-fA-F]{40,}$/.test(v);
}

function runtimeStateHit(key, value) {
  const k = key.toLowerCase();
  if (TIER1_RUNTIME_KEYS.some((kw) => k.includes(kw))) return true;
  if (TIER2_WALLET_MATERIAL_KEYS.some((kw) => k.includes(kw))) return true;
  if (k.includes("wallet") && k !== "wallet_signing" && valueLooksLikeMaterial(value)) return true;
  if ((k.includes("credential") || k.includes("token") || k.includes("cookie") || k.includes("session")) && valueLooksLikeMaterial(value)) return true;
  // A bare "memories" array/object is a memory dump, not a policy.
  if ((k === "memories" || k === "memory") && valueLooksLikeMaterial(value)) return true;
  return false;
}

export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Hash of the canonical genome with the signature section removed.
export function genomeHash(genome) {
  const { signature: _sig, ...rest } = genome;
  return sha256Hex(canonicalize(rest));
}

// Return a signed copy: signature.genome_hash filled from the content.
export function signGenome(genome, signedBy, anchor = null) {
  const copy = JSON.parse(JSON.stringify(genome));
  copy.signature = {
    algorithm: "sha256",
    genome_hash: genomeHash(copy),
    signed_by: signedBy,
    anchor,
  };
  return copy;
}

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function err(code, path, message) {
  return { code, path, message };
}

function checkExpressionVariant(variant, path, errors) {
  if (!isObj(variant)) {
    errors.push(err("EXPRESSION_VARIANT_INVALID", path, "variant must be an object"));
    return;
  }
  if (typeof variant.displayName !== "string" || !variant.displayName)
    errors.push(err("EXPRESSION_VARIANT_INVALID", `${path}.displayName`, "displayName must be a non-empty string"));
  for (const k of ["primary", "secondary", "accent"]) {
    const c = variant.palette && variant.palette[k];
    if (typeof c !== "string" || !HEX_COLOR_PATTERN.test(c))
      errors.push(err("EXPRESSION_VARIANT_INVALID", `${path}.palette.${k}`, `must be a #RRGGBB hex color, got ${JSON.stringify(c)}`));
  }
  if (!Array.isArray(variant.marks))
    errors.push(err("EXPRESSION_VARIANT_INVALID", `${path}.marks`, "marks must be an array"));
  if (typeof variant.visor !== "string" || !variant.visor)
    errors.push(err("EXPRESSION_VARIANT_INVALID", `${path}.visor`, "visor must be a non-empty string"));
  if (typeof variant.accentGlow !== "string" || !HEX_COLOR_PATTERN.test(variant.accentGlow))
    errors.push(err("EXPRESSION_VARIANT_INVALID", `${path}.accentGlow`, `must be a #RRGGBB hex color, got ${JSON.stringify(variant.accentGlow)}`));
  if (!Array.isArray(variant.gear))
    errors.push(err("EXPRESSION_VARIANT_INVALID", `${path}.gear`, "gear must be an array"));
  const fog = variant.lighting && variant.lighting.fog;
  const sun = variant.lighting && variant.lighting.sun;
  if (typeof fog !== "number" || fog < 0 || fog > 1)
    errors.push(err("EXPRESSION_VARIANT_INVALID", `${path}.lighting.fog`, `must be a number in [0,1], got ${JSON.stringify(fog)}`));
  if (typeof sun !== "number" || sun < 0 || sun > 1)
    errors.push(err("EXPRESSION_VARIANT_INVALID", `${path}.lighting.sun`, `must be a number in [0,1], got ${JSON.stringify(sun)}`));
}

function scanRuntimeState(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => scanRuntimeState(v, `${path}[${i}]`, errors));
    return;
  }
  if (!isObj(value)) return;
  for (const key of Object.keys(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (runtimeStateHit(key, value[key])) {
      errors.push(
        err(
          "RUNTIME_STATE_IN_GENOME",
          childPath,
          `blueprint vs instance rule: genome files must never contain runtime state (key "${key}"). Strip memory dumps, keys, secrets, and wallet material.`
        )
      );
    }
    scanRuntimeState(value[key], childPath, errors);
  }
}

export function validateGenome(genome) {
  const errors = [];
  if (!isObj(genome)) {
    return { valid: false, errors: [err("NOT_AN_OBJECT", "", "genome must be a JSON object")] };
  }

  if (genome.genome_version !== GENOME_VERSION) {
    errors.push(
      err(
        genome.genome_version === undefined ? "MISSING_GENOME_VERSION" : "BAD_GENOME_VERSION",
        "genome_version",
        `genome_version must be exactly ${JSON.stringify(GENOME_VERSION)}`
      )
    );
  }

  // ---- identity (sponsor is the accountable party: required) ----
  const id = genome.identity;
  if (!isObj(id)) {
    errors.push(err("MISSING_IDENTITY", "identity", "identity section is required"));
  } else {
    if (typeof id.urn !== "string" || !URN_PATTERN.test(id.urn))
      errors.push(err("IDENTITY_URN_INVALID", "identity.urn", 'urn must match ^(urn:cwi:)?agent:[A-Za-z0-9_.-]+$ ("agent:" is the identity-shift form; "urn:cwi:agent:" the fully-qualified form)'));
    if (typeof id.name !== "string" || !id.name)
      errors.push(err("MISSING_IDENTITY_FIELD", "identity.name", "identity.name is required"));
    if (typeof id.handle !== "string" || !id.handle)
      errors.push(err("MISSING_IDENTITY_FIELD", "identity.handle", "identity.handle is required"));
    if (!isObj(id.sponsor) || typeof id.sponsor.name !== "string" || !id.sponsor.name || typeof id.sponsor.contact !== "string" || !id.sponsor.contact)
      errors.push(err("MISSING_SPONSOR", "identity.sponsor", "identity.sponsor with name + contact (the accountable party) is required"));
    else if (id.sponsor.name === "UNCLAIMED" || id.sponsor.contact === "UNCLAIMED")
      errors.push(err("MISSING_SPONSOR", "identity.sponsor", 'identity.sponsor is the UNCLAIMED bridge placeholder — declare the accountable party'));
    // model must never live under identity (it is a sibling, not a child)
    if (id.model !== undefined)
      errors.push(err("MODEL_NESTED_UNDER_IDENTITY", "identity.model", "model must be a sibling of identity, never nested under it"));
  }

  // ---- personality ----
  const p = genome.personality;
  if (!isObj(p)) {
    errors.push(err("MISSING_PERSONALITY", "personality", "personality section is required"));
  } else {
    if (typeof p.vibe !== "string" || !p.vibe)
      errors.push(err("MISSING_PERSONALITY_FIELD", "personality.vibe", "personality.vibe is required"));
    if (!Array.isArray(p.adjectives) || p.adjectives.length === 0 || p.adjectives.some((a) => typeof a !== "string" || !a))
      errors.push(err("MISSING_PERSONALITY_FIELD", "personality.adjectives", "personality.adjectives must be a non-empty string array"));
    if (!isObj(p.tone_bounds) || !Array.isArray(p.tone_bounds.allowed) || !Array.isArray(p.tone_bounds.forbidden))
      errors.push(err("MISSING_PERSONALITY_FIELD", "personality.tone_bounds", "personality.tone_bounds {allowed[], forbidden[]} is required"));
  }

  // ---- attitude: reference to the Attitude Engine schema ----
  const a = genome.attitude;
  if (!isObj(a)) {
    errors.push(err("MISSING_ATTITUDE", "attitude", "attitude section is required"));
  } else if (typeof a.schema !== "string" || !a.schema) {
    errors.push(err("ATTITUDE_SCHEMA_MISSING", "attitude.schema", "attitude.schema (Attitude Engine schema URL) is required"));
  }

  // ---- expression: day/night variants, identity-shift.js spec shape ----
  const ex = genome.expression;
  if (!isObj(ex)) {
    errors.push(err("MISSING_EXPRESSION", "expression", "expression section is required"));
  } else {
    const sched = ex.schedule;
    if (!isObj(sched) || typeof sched.nightStartHour !== "number" || typeof sched.nightEndHour !== "number")
      errors.push(err("EXPRESSION_SCHEDULE_INVALID", "expression.schedule", "expression.schedule {nightStartHour, nightEndHour} is required"));
    checkExpressionVariant(ex.day, "expression.day", errors);
    checkExpressionVariant(ex.night, "expression.night", errors);
  }

  // ---- operational_state: honest telemetry, never felt emotions ----
  const os = genome.operational_state;
  if (!isObj(os)) {
    errors.push(err("MISSING_OPERATIONAL_STATE", "operational_state", "operational_state section is required"));
  } else {
    if (os.vocabulary !== STATE_VOCABULARY) {
      errors.push(
        err(
          "UNKNOWN_STATE_VOCABULARY",
          "operational_state.vocabulary",
          `only ${JSON.stringify(STATE_VOCABULARY)} is accepted; vocabularies that assert felt emotions without a telemetry source are rejected`
        )
      );
    }
    if (!Array.isArray(os.states) || os.states.length === 0) {
      errors.push(err("MISSING_OPERATIONAL_STATE_FIELD", "operational_state.states", "operational_state.states must be a non-empty array"));
    } else {
      for (let i = 0; i < os.states.length; i++) {
        const s = os.states[i];
        if (typeof s !== "string" || !s) {
          errors.push(err("OPERATIONAL_STATE_INVALID", `operational_state.states[${i}]`, "state names must be non-empty strings"));
        } else if (FELT_EMOTION_WORDS.has(s.toLowerCase())) {
          errors.push(
            err(
              "FELT_EMOTION_WITHOUT_SOURCE",
              `operational_state.states[${i}]`,
              `state ${JSON.stringify(s)} asserts a felt emotion without a telemetry source — operational states describe workload/availability only`
            )
          );
        }
      }
    }
    if (!isObj(os.fields) || typeof os.fields.source !== "string" || !os.fields.source) {
      errors.push(err("MISSING_OPERATIONAL_STATE_FIELD", "operational_state.fields.source", "operational_state.fields.source (telemetry source tag) is required"));
    }
  }

  // ---- capabilities ----
  if (!Array.isArray(genome.capabilities) || genome.capabilities.length === 0) {
    errors.push(err("MISSING_CAPABILITIES", "capabilities", "capabilities must be a non-empty array"));
  } else {
    genome.capabilities.forEach((c, i) => {
      if (!isObj(c) || typeof c.name !== "string" || !c.name || typeof c.description !== "string" || !c.description)
        errors.push(err("CAPABILITY_INVALID", `capabilities[${i}]`, "each capability needs name + description"));
    });
  }

  // ---- memory_policy ----
  const mp = genome.memory_policy;
  if (!isObj(mp) || typeof mp.retention !== "string" || !mp.retention || !Array.isArray(mp.scope))
    errors.push(err("MISSING_MEMORY_POLICY", "memory_policy", "memory_policy {retention, scope[]} is required"));

  // ---- permissions ----
  const pm = genome.permissions;
  if (!isObj(pm) || typeof pm.spending !== "boolean" || typeof pm.wallet_signing !== "boolean")
    errors.push(err("MISSING_PERMISSIONS", "permissions", "permissions {spending: bool, wallet_signing: bool} is required"));

  // ---- model: sibling of identity, never its parent ----
  const m = genome.model;
  if (!isObj(m)) {
    errors.push(err("MISSING_MODEL", "model", "model (swappable provider pointer) is required as a sibling of identity"));
  } else {
    if (typeof m.provider !== "string" || !m.provider || typeof m.model !== "string" || !m.model)
      errors.push(err("MODEL_POINTER_INVALID", "model", "model needs provider + model (the swappable pointer)"));
    if (m.identity !== undefined)
      errors.push(err("MODEL_AS_PARENT", "model.identity", "model must be a sibling of identity, never its parent"));
  }

  // ---- signature ----
  const sig = genome.signature;
  if (!isObj(sig)) {
    errors.push(err("MISSING_SIGNATURE", "signature", "signature section is required"));
  } else {
    if (sig.algorithm !== "sha256")
      errors.push(err("SIGNATURE_ALGORITHM_INVALID", "signature.algorithm", 'signature.algorithm must be "sha256"'));
    if (typeof sig.genome_hash !== "string" || !HEX64_PATTERN.test(sig.genome_hash))
      errors.push(err("SIGNATURE_HASH_MALFORMED", "signature.genome_hash", "signature.genome_hash must be 64 lowercase hex chars"));
    if (typeof sig.signed_by !== "string" || !sig.signed_by)
      errors.push(err("MISSING_SIGNED_BY", "signature.signed_by", "signature.signed_by is required"));
  }

  // ---- blueprint vs instance: no runtime state anywhere ----
  scanRuntimeState(genome, "", errors);

  // Deterministic order: sort by path, then code.
  errors.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : x.code < y.code ? -1 : x.code > y.code ? 1 : 0));

  // Integrity check last: recompute the canonical hash and compare.
  if (isObj(sig) && typeof sig.genome_hash === "string" && HEX64_PATTERN.test(sig.genome_hash)) {
    const recomputed = genomeHash(genome);
    if (recomputed !== sig.genome_hash) {
      errors.push(err("SIGNATURE_MISMATCH", "signature.genome_hash", `integrity hash mismatch: file claims ${sig.genome_hash}, recomputed ${recomputed}`));
    }
  }

  return { valid: errors.length === 0, errors };
}
