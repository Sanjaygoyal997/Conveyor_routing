"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmt = (v) => {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.replace("T", " ").slice(0, 19);
  return String(v);
};

function pillClass(status) {
  const s = String(status || "");
  if (s === "OK") return "ok";
  if (s.startsWith("NG") || s === "ERROR") return "ng";
  if (s.startsWith("WARN")) return "warn";
  return "info";
}
const isIssue = (status) => ["ng", "warn"].includes(pillClass(status));

// ---- table definitions ------------------------------------------------------
const TABLES = {
  recipes: {
    statusKey: "status",
    columns: [
      { key: "status", label: "Status", pill: true },
      { key: "recipe_id", label: "Recipe", num: true },
      { key: "material_id", label: "Material", num: true },
      { key: "wip_tires", label: "WIP tires", num: true },
      { key: "allowed_rim_sizes", label: "Allowed rims" },
      { key: "running_rim_sizes", label: "Rims running" },
      { key: "inactive_rim_sizes", label: "Inactive rims" },
      { key: "eligible_equipment", label: "Eligible equipment" },
      { key: "curing_presses", label: "Curing presses" },
      { key: "first_cured", label: "First cured" },
      { key: "last_cured", label: "Last cured" },
      { key: "message", label: "Message" },
      { key: "_fix", label: "", actions: true },
    ],
  },
  machines: {
    statusKey: "status",
    columns: [
      { key: "status", label: "Status", pill: true },
      { key: "equipment_id", label: "Machine", num: true },
      { key: "running_rim", label: "Running rim" },
      { key: "rim_status", label: "Rim", pill: true,
        pillMap: { ACTIVE: "ok", INACTIVE: "ng", "NOT SET": "ng", "NOT AVAILABLE": "warn", UNIVERSAL: "info" } },
      { key: "wip_tires_fit", label: "WIP tires fit", num: true },
      { key: "only_here_tires", label: "Only here", num: true },
      { key: "suggested_rim", label: "Suggested rim" },
      { key: "unblocks_tires", label: "Unblocks", num: true },
      { key: "blocks_tires", label: "Blocks", num: true },
      { key: "message", label: "Message" },
      { key: "_fix", label: "", actions: true },
    ],
  },
  rims: {
    statusKey: "status",
    columns: [
      { key: "status", label: "Status", pill: true },
      { key: "rim_size", label: "Rim size" },
      { key: "wip_tires", label: "WIP tires accepting", num: true },
      { key: "blocked_tires", label: "Blocked tires", num: true },
      { key: "recipes", label: "Recipes" },
      { key: "materials", label: "Materials" },
      { key: "equipment_running", label: "Equipment running" },
      { key: "_fix", label: "", actions: true },
    ],
  },
  gaps: {
    statusKey: "severity",
    issueFilter: (r) => r.severity === "ERROR",
    columns: [
      { key: "severity", label: "Severity", pill: true },
      { key: "check_code", label: "Check" },
      { key: "entity", label: "Table" },
      { key: "entity_ref", label: "Reference" },
      { key: "detail", label: "Detail" },
      { key: "_fix", label: "", actions: true },
    ],
  },
  running: {
    statusKey: "rim_master_status",
    columns: [
      { key: "equipment_id", label: "Equipment", num: true },
      { key: "rim_name", label: "Running rim" },
      { key: "rim_size", label: "rim_id" },
      { key: "rim_area", label: "Rim area" },
      { key: "rim_master_status", label: "Status", pill: true,
        pillMap: { ACTIVE: "ok", INACTIVE: "ng", "NOT SET": "ng", "NOT AVAILABLE": "warn", UNIVERSAL: "info" } },
      { key: "created_by", label: "Set by" },
      { key: "dtandtime", label: "Set at" },
      { key: "_fix", label: "", actions: true },
    ],
  },
};

const state = {}; // name -> { rows, sortKey, sortDir }

function cell(col, row, name, i) {
  if (col.actions) return `<td class="actions">${typeof fixActions === "function" ? fixActions(name, row, i) : ""}</td>`;
  const v = row[col.key];
  if (col.pill && v != null) {
    const cls = col.pillMap ? col.pillMap[v] || "info" : pillClass(v);
    return `<td><span class="pill ${cls}">${esc(v)}</span></td>`;
  }
  return `<td class="${col.num ? "num" : ""}">${esc(fmt(v))}</td>`;
}

function visibleRows(name) {
  const def = TABLES[name];
  const st = state[name];
  if (!st) return [];
  const q = ($(`.search[data-for=${name}]`)?.value || "").trim().toLowerCase();
  const issuesOnly = $(`.issuesOnly[data-for=${name}]`)?.checked;
  let rows = st.rows.filter((r) => {
    if (issuesOnly && !(def.issueFilter ? def.issueFilter(r) : isIssue(r[def.statusKey]))) return false;
    if (!q) return true;
    return def.columns.some((c) => !c.actions && fmt(r[c.key]).toLowerCase().includes(q));
  });
  if (st.sortKey) {
    const k = st.sortKey, d = st.sortDir === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const x = a[k], y = b[k];
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : fmt(x).localeCompare(fmt(y), undefined, { numeric: true })) * d;
    });
  }
  return rows;
}

function renderTable(name) {
  const def = TABLES[name];
  const st = state[name];
  const wrap = $(`#table-${name}`);
  const rows = visibleRows(name);
  if (!st.rows.length) { wrap.innerHTML = `<p class="empty">No rows.</p>`; return; }
  if (!rows.length) { wrap.innerHTML = `<p class="empty">No rows match the filter.</p>`; return; }
  st.visible = rows;
  const head = def.columns.map((c) => c.actions ? "<th></th>" :
    `<th data-key="${c.key}"${st.sortKey === c.key ? ` data-dir="${st.sortDir}"` : ""}>${esc(c.label)}</th>`).join("");
  const body = rows.map((r, i) => `<tr>${def.columns.map((c) => cell(c, r, name, i)).join("")}</tr>`).join("");
  wrap.innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  wrap.onclick = (ev) => {
    const b = ev.target.closest("button[data-fix]");
    if (b && typeof onFix === "function") onFix(name, st.visible[+b.dataset.fix], b);
  };
  $$("th[data-key]", wrap).forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.key;
    st.sortDir = st.sortKey === k && st.sortDir === "asc" ? "desc" : "asc";
    st.sortKey = k;
    renderTable(name);
  }));
}

function setRows(name, rows) {
  state[name] = { rows, sortKey: null, sortDir: "asc" };
  renderTable(name);
  const issues = rows.filter((r) => (TABLES[name].issueFilter || ((x) => isIssue(x[TABLES[name].statusKey])))(r)).length;
  const tab = $(`.tabs button[data-tab=${name}]`);
  $(".count", tab)?.remove();
  if (issues && name !== "running") tab.insertAdjacentHTML("beforeend", `<span class="count">${issues}</span>`);
}

function exportCsv(name) {
  const def = TABLES[name];
  const cols = def.columns.filter((c) => !c.actions);
  const rows = visibleRows(name);
  const q = (v) => `"${fmt(v).replace(/"/g, '""')}"`;
  const csv = [cols.map((c) => q(c.label)).join(","), ...rows.map((r) => cols.map((c) => q(r[c.key])).join(","))].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `rim-validation-${name}-${new Date().toISOString().slice(0, 16).replace(":", "")}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---- API --------------------------------------------------------------------
async function api(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null));
  const res = await fetch(`${path}${qs.toString() ? "?" + qs : ""}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail || body));
  return body;
}

function filterParams() {
  return {
    hours: $("#hours").value,
    wip_states: $("#wipStates").value.trim(),
    ok_quality: $("#okQuality").value.trim(),
    area_id: $("#areaId").value.trim(),
    exclude_at_dbm: $("#excludeDbm").checked,
  };
}

function showError(msg) {
  const el = $("#error");
  el.hidden = !msg;
  el.textContent = msg || "";
}

function renderSummary(recipes, rims, gaps, machines = []) {
  const toChange = machines.filter((m) => pillClass(m.status) !== "ok" && !m.status.startsWith("INFO")).length;
  const tires = recipes.reduce((s, r) => s + Number(r.wip_tires || 0), 0);
  const ngRows = recipes.filter((r) => pillClass(r.status) === "ng");
  const ngTires = ngRows.reduce((s, r) => s + Number(r.wip_tires || 0), 0);
  const rimsNotRunning = rims.filter((r) => r.status === "NG_NOT_RUNNING").length;
  const errors = gaps.filter((g) => g.severity === "ERROR").length;
  const tiles = [
    ["WIP tires (Curing → DBM)", tires, ""],
    ["Recipe / material groups", recipes.length, ""],
    ["Groups with issues", ngRows.length, ngRows.length ? "ng" : "ok"],
    ["WIP tires blocked", ngTires, ngTires ? "ng" : "ok"],
    ["Rim sizes not running", rimsNotRunning, rimsNotRunning ? "ng" : "ok"],
    ["Machines to fix / change over", toChange, toChange ? "ng" : "ok"],
    ["Master data errors", errors, errors ? "ng" : "ok"],
  ];
  const el = $("#summary");
  el.innerHTML = tiles.map(([l, v, c]) => `<div class="tile ${c}"><div class="v">${v}</div><div class="l">${esc(l)}</div></div>`).join("");
  el.hidden = false;
}

async function validate() {
  const btn = $("#validateBtn");
  btn.disabled = true;
  btn.textContent = "Validating…";
  showError("");
  try {
    const p = filterParams();
    const [recipes, rims, gaps, machines] = await Promise.all([
      api("/api/wip/readiness", p),
      api("/api/wip/demand", p),
      api("/api/gaps", { hours: p.hours, area_id: p.area_id }),
      api("/api/wip/machines", p),
    ]);
    setRows("recipes", recipes);
    setRows("machines", machines);
    setRows("rims", rims);
    setRows("gaps", gaps);
    renderSummary(recipes, rims, gaps, machines);
    if (typeof renderQuickFix === "function") renderQuickFix();
  } catch (e) {
    showError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Validate";
  }
}

async function loadRunning() {
  try {
    setRows("running", await api("/api/running-sizes", { area_id: $("#areaId").value.trim(), hours: $("#hours").value }));
  } catch (e) {
    $("#table-running").innerHTML = `<p class="empty">${esc(e.message)}</p>`;
  }
}

function miniTable(rows, cols) {
  if (!rows.length) return `<p class="empty">No records.</p>`;
  return `<div class="table-wrap"><table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${
    rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(fmt(r[c]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

async function checkBarcode(ev) {
  ev.preventDefault();
  const out = $("#barcodeResult");
  const code = $("#barcode").value.trim();
  if (!code) return;
  out.innerHTML = `<p class="empty">Checking…</p>`;
  try {
    const r = await api(`/api/barcode/${encodeURIComponent(code)}`, {
      equipment_id: $("#equipmentId").value.trim(),
      area_id: $("#areaId").value.trim(),
      ok_quality: $("#okQuality").value.trim(),
    });
    const v = r.validation;
    const ok = v.length && v.every((x) => x.status === "OK");
    const first = v[0] || {};
    const equipment = v.filter((x) => x.status === "OK" && x.equipment_id != null).map((x) => x.equipment_id);
    const rims = [...new Set(v.map((x) => x.rim_size).filter(Boolean))].join(", ");
    const headline = ok
      ? (equipment.length ? `OK: can go to equipment ${equipment.join(", ")}` : "OK")
      : `${first.status}`;
    const atDbm = r.dbm.length ? `Already balanced at DBM ${r.dbm[0].equipment_id} on ${fmt(r.dbm[0].dtandtime)}` : "Not yet at DBM (in WIP)";
    out.innerHTML = `
      <div class="result-banner ${ok ? "ok" : "ng"}">${esc(headline)}
        <small>${esc(first.message || "")} · material ${esc(first.material_id ?? "–")} · recipe ${esc(first.recipe_id ?? "–")} · rim ${esc(rims || "–")} · ${esc(atDbm)}</small>
      </div>
      <h3>Curing records</h3>${miniTable(r.curing, ["dtandtime", "equipment_id", "recipe_id", "material_id", "mould_code", "side", "quality_status", "state"])}
      <h3>DBM records</h3>${miniTable(r.dbm, ["dtandtime", "equipment_id", "model", "code", "total_rank", "ro_total"])}`;
  } catch (e) {
    out.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
  $("#barcode").select();
}

// ---- wiring -----------------------------------------------------------------
function selectTab(name) {
  $$(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  $$(".panel").forEach((p) => (p.hidden = p.dataset.panel !== name));
  if (name === "barcode") $("#barcode").focus();
}

$$(".tabs button").forEach((b) => b.addEventListener("click", () => selectTab(b.dataset.tab)));
$("#validateBtn").addEventListener("click", validate);
$("#loadRunning").addEventListener("click", loadRunning);
$("#barcodeForm").addEventListener("submit", checkBarcode);
$$(".search, .issuesOnly").forEach((el) => el.addEventListener("input", () => state[el.dataset.for] && renderTable(el.dataset.for)));
$$(".exportBtn").forEach((b) => b.addEventListener("click", () => state[b.dataset.for] && exportCsv(b.dataset.for)));

// machine areas (TUO / DBM ...) from area_master; DBM is the default
async function loadAreas() {
  try {
    const areas = await api("/api/areas");
    $("#areaId").innerHTML = areas.map((a) =>
      `<option value="${a.local_area_id}"${a.is_default ? " selected" : ""}>${esc(a.name)} (area ${a.local_area_id})</option>`).join("")
      || `<option value="">All areas</option>`;
  } catch {
    $("#areaId").innerHTML = `<option value="">All areas</option>`;
  }
}
loadAreas().then(() => Promise.all([loadRunning(), validate()]));
$("#areaId").addEventListener("change", () => { loadRunning(); if (state.recipes) validate(); });

api("/api/health")
  .then((h) => { const el = $("#dbStatus"); el.textContent = `${h.database} · DB time ${fmt(h.db_time)}`; el.className = "db-status ok"; })
  .catch((e) => { const el = $("#dbStatus"); el.textContent = "Database unreachable"; el.className = "db-status bad"; showError(e.message); });
