/* Genome Gallery app — real data only.
 * Fetches the ten live genome files from ../genome/examples/, resolves
 * day/night expression with the REAL identity-shift.js resolver, and validates
 * with the REAL genome/validator.js. A genome that fails to load renders an
 * honest "unavailable" card — never fake data.
 */
import { resolveShift } from "./vendor/identity-shift.esm.js";
import { validateGenome, canonicalize } from "./vendor/validator.esm.js";

const FILES = [
  "muse-cwi.genome.json",
  "cwi-aandr.genome.json",
  "cwi-marketing.genome.json",
  "cwi-sync.genome.json",
  "cwi-radio.genome.json",
  "cwi-press.genome.json",
  "cwi-studio.genome.json",
  "cwi-data.genome.json",
  "cwi-affairs.genome.json",
  "cwi-results.genome.json",
];
const BASE = new URL("../genome/examples/", import.meta.url);

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

const store = new Map(); // file -> { genome } | { error }

function validationOf(genome) {
  try {
    return validateGenome(genome);
  } catch (e) {
    return { valid: false, errors: [{ code: "VALIDATOR_THREW", message: e.message }] };
  }
}

function swatches(palette) {
  return ["primary", "secondary", "accent"]
    .map((k) => `<span class="swatch" title="${esc(k)} ${esc(palette?.[k])}" style="background:${esc(palette?.[k] ?? "transparent")}"></span>`)
    .join("");
}

function shiftAtNow() {
  return resolveShift("agent:MUSE_CWI", { at: new Date(), override: "auto" }).shift;
}

function renderTopBar() {
  const now = new Date();
  const shift = shiftAtNow();
  $("shift-now-text").textContent =
    `${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} local → ${shift.toUpperCase()} shift active`;
}

async function loadAll() {
  const grid = $("grid");
  grid.innerHTML = `<div class="loading">Loading ten live genomes…</div>`;
  const results = await Promise.all(
    FILES.map(async (file) => {
      try {
        const r = await fetch(new URL(file, BASE));
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const genome = await r.json();
        if (!genome?.identity?.urn) throw new Error("not a genome: missing identity.urn");
        return [file, { genome }];
      } catch (e) {
        return [file, { error: e.message }];
      }
    })
  );
  results.forEach(([file, entry]) => store.set(file, entry));
  renderGrid();
  renderTopBar();
}

function cardHTML(file, entry) {
  if (entry.error) {
    return `<div class="card unavailable" aria-label="${esc(file)} unavailable">
      <h3>${esc(file.replace(".genome.json", ""))}</h3>
      <p class="urn">unavailable — ${esc(entry.error)}</p>
      <p class="vibe">This genome could not be loaded from the live site. No placeholder data is shown.</p>
    </div>`;
  }
  const g = entry.genome;
  const id = g.identity, ex = g.expression.day, per = g.personality;
  const nowExpr = resolveShift(id.urn, { at: new Date(), override: "auto" });
  const rep = validationOf(g);
  return `<button class="card" data-file="${esc(file)}">
    ${swatches(ex.palette)}
    <h3>${esc(id.name)}</h3>
    <p class="urn">${esc(id.urn)}</p>
    <div class="marks">${(ex.marks || []).map((m) => `<span class="chip">${esc(m)}</span>`).join("")}</div>
    <p class="vibe">${esc(per.vibe)}</p>
    <div class="nowline">
      <span>now: <strong>${esc(nowExpr.expression.displayName)}</strong></span>
      <span class="badge ${rep.valid ? "ok" : "bad"}">${rep.valid ? "VALID" : "INVALID"}</span>
    </div>
  </button>`;
}

function renderGrid() {
  const grid = $("grid");
  grid.innerHTML = FILES.map((f) => cardHTML(f, store.get(f))).join("");
  grid.querySelectorAll(".card[data-file]").forEach((el) =>
    el.addEventListener("click", () => openDetail(el.dataset.file))
  );
}

let current = null; // { file, genome, override }

function exprHTML(urn, override) {
  const res = resolveShift(urn, { at: new Date(), override });
  const e = res.expression;
  const lighting = e.lighting
    ? Object.entries(e.lighting).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(" · ")
    : "—";
  return `<p class="ename">${esc(e.displayName)} <span class="badge info">${esc(res.shift.toUpperCase())}</span></p>
    ${swatches(e.palette)}
    <div class="meta">
      <div><dt>palette</dt><dd>${esc(e.palette.primary)} · ${esc(e.palette.secondary)} · ${esc(e.palette.accent)}</dd></div>
      <div><dt>marks</dt><dd>${esc((e.marks || []).join(", ") || "—")}</dd></div>
      <div><dt>visor</dt><dd>${esc(e.visor || "—")}</dd></div>
      <div><dt>gear</dt><dd>${esc((e.gear || []).join(", ") || "—")}</dd></div>
      <div><dt>accent glow</dt><dd>${esc(e.accentGlow || "—")}</dd></div>
      <div><dt>lighting</dt><dd>${lighting}</dd></div>
    </div>
    <p style="color:var(--dim);font-size:.8rem;margin:.8rem 0 0">resolved by the real
    <code>identity-shift.js</code> resolver · override: <code>${esc(override)}</code> · URN preserved: <code>${esc(res.urn)}</code></p>`;
}

function openDetail(file) {
  const entry = store.get(file);
  if (!entry || entry.error) return;
  const g = entry.genome;
  current = { file, genome: g, override: "auto" };

  $("d-name").textContent = g.identity.name;
  $("d-urn").textContent = g.identity.urn;
  $("d-json").textContent = JSON.stringify(g, null, 2);

  const rep = validationOf(g);
  const vb = $("d-valid");
  vb.className = `badge ${rep.valid ? "ok" : "bad"}`;
  vb.textContent = rep.valid ? "VALIDATOR ✓" : `INVALID (${rep.errors.length})`;
  if (!rep.valid) {
    const list = document.createElement("div");
    list.className = "errlist";
    list.innerHTML = rep.errors.map((e) => `<div><code>${esc(e.code)}</code> ${esc(e.message || "")}</div>`).join("");
    vb.after(list);
  }

  document.querySelectorAll(".shift-toggle button").forEach((b) => {
    b.classList.toggle("on", b.dataset.override === "auto");
    b.onclick = () => {
      current.override = b.dataset.override;
      document.querySelectorAll(".shift-toggle button").forEach((x) =>
        x.classList.toggle("on", x === b));
      refreshExpr();
    };
  });
  refreshExpr();

  $("grid").hidden = true;
  document.querySelector(".intro").hidden = true;
  $("detail").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function refreshExpr() {
  const { genome, override } = current;
  $("d-expr").innerHTML = exprHTML(genome.identity.urn, override);
  const res = resolveShift(genome.identity.urn, { at: new Date(), override });
  const mb = $("d-match");
  const matches =
    canonicalize(res.expression) === canonicalize(genome.expression[res.shift]);
  mb.className = `badge ${matches ? "ok" : "warn"}`;
  mb.textContent = matches ? "MATCHES GENOME FILE ✓" : "DIFFERS FROM GENOME FILE";
}

$("back").addEventListener("click", () => {
  $("detail").hidden = true;
  $("grid").hidden = false;
  document.querySelector(".intro").hidden = false;
});

$("copy-json").addEventListener("click", async () => {
  if (!current) return;
  const text = JSON.stringify(current.genome, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    $("copy-json").textContent = "Copied ✓";
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove();
    $("copy-json").textContent = "Copied ✓";
  }
  setTimeout(() => ($("copy-json").textContent = "Copy JSON"), 1500);
});

$("download-json").addEventListener("click", () => {
  if (!current) return;
  const blob = new Blob([JSON.stringify(current.genome, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = current.file;
  a.click();
  URL.revokeObjectURL(a.href);
});

loadAll();
setInterval(renderTopBar, 60000);
