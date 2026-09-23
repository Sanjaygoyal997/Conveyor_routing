"use strict";
// Quick fix tab: two plain forms driven by dropdowns.
//   Recipe  -> allowed rims   (material_size_lookup, for the selected machine area)
//   DBM     -> running rim    (runningsize_lookup): pick the DBM first, then its rim
// Uses app.js (state, api, esc, fmt, $) and fixes.js (RIMS, RUNNING, loadLookups, activeRims, write, changeoverImpact, pillHtml).

const qf = { recipe: "", eq: "" };   // current selections survive refreshes
let QF_DBMS = [];                    // every DBM machine (/api/dbm-machines)

// DBM area selected? Then the machine list is every DBM machine; otherwise the machine-check rows.
const dbmAreaId = () => [...$("#areaId").options].find((o) => /^DBM\b/i.test(o.textContent))?.value;
const isDbmArea = () => $("#areaId").value === dbmAreaId();
function formMachines() {
  if (isDbmArea()) return QF_DBMS.map((d) => ({ equipment_id: d.equipment_id, running_rim: d.rim_name,
    rim_status: d.rim_status, last_balanced: d.last_balanced, tires_balanced: d.tires_balanced }));
  return (state.machines?.rows || []).map((m) => ({ equipment_id: m.equipment_id, running_rim: m.running_rim, rim_status: m.rim_status }));
}
const checkRow = (id) => (state.machines?.rows || []).find((m) => String(m.equipment_id) === String(id));
const currentEq = () => (qf.eq === "__other" ? $("#qfEqOther").value.trim() : qf.eq);

// sorted by recipe number (rows without a recipe last)
function recipeRows() {
  const n = (r) => (r.recipe_id == null ? Infinity : r.recipe_id);
  return [...(state.recipes?.rows || [])].sort((a, b) => n(a) - n(b) || a.material_id - b.material_id);
}
const recipeKey = (r) => `${r.recipe_id ?? ""}|${r.material_id}`;

async function renderQuickFix() {
  const rows = recipeRows();
  if (!rows.length) {
    $("#qfRecipe").innerHTML = `<option value="">Press Validate first</option>`;
    $("#qfEq").innerHTML = `<option value="">Press Validate first</option>`;
    return;
  }
  await loadLookups();

  // ---- recipe form
  if (!rows.some((r) => recipeKey(r) === qf.recipe)) qf.recipe = recipeKey(rows.find((r) => r.status.startsWith("NG")) || rows[0]);
  // plain names in the dropdown; the material is added only when a recipe has several
  const perRecipe = rows.reduce((m, r) => m.set(r.recipe_id, (m.get(r.recipe_id) || 0) + 1), new Map());
  $("#qfRecipe").innerHTML = rows.map((r) =>
    `<option value="${esc(recipeKey(r))}"${recipeKey(r) === qf.recipe ? " selected" : ""}>` +
    (r.recipe_id == null ? `Material ${r.material_id}`
      : `Recipe ${esc(r.recipe_id)}${perRecipe.get(r.recipe_id) > 1 ? ` (material ${r.material_id})` : ""}`) + `</option>`).join("");
  await renderRecipePart();

  // ---- DBM form: every DBM machine, even without a rim
  try { QF_DBMS = isDbmArea() ? await api("/api/dbm-machines") : []; } catch { QF_DBMS = []; }
  const list = formMachines();
  const label = isDbmArea() ? "DBM" : "Machine";
  if (qf.eq !== "__other" && !list.some((m) => String(m.equipment_id) === qf.eq)) {
    const first = list.find((m) => (checkRow(m.equipment_id)?.status || "").match(/^(NG|WARN)/)) || list[0];
    qf.eq = String(first?.equipment_id ?? "");
  }
  $("#qfEq").innerHTML = list.map((m) =>
    `<option value="${m.equipment_id}"${String(m.equipment_id) === qf.eq ? " selected" : ""}>${label} ${m.equipment_id}</option>`).join("")
    + `<option value="__other"${qf.eq === "__other" ? " selected" : ""}>Other ${label}…</option>`;
  $("#qfEqOtherWrap").hidden = qf.eq !== "__other";
  const sugg = (state.machines?.rows || []).filter((m) => m.suggested_rim);
  $("#qfSuggest").innerHTML = sugg.length
    ? `Suggested: ${sugg.map((m) => `<button class="sm fixbtn" data-qf-eq="${m.equipment_id}" data-qf-rim="${m.suggested_rim_id}">` +
        `${m.equipment_id} → ${esc(m.suggested_rim)} (frees ${m.unblocks_tires})</button>`).join(" ")}`
    : `<span class="hint">No changeover needed for the current WIP.</span>`;
  renderMachinePart();
}

async function renderRecipePart() {
  const r = recipeRows().find((x) => recipeKey(x) === qf.recipe);
  if (!r) return;
  const area = $("#areaId").value.trim();
  const maps = (await api(`/api/material/${r.material_id}`))
    .filter((m) => !area || m.area_id == null || String(m.area_id) === area);
  const chips = maps.map((m) => {
    const bad = m.rim_master_status !== "ACTIVE";
    return `<span class="chip${bad ? " bad" : ""}" title="${bad ? "Inactive in rim_master" : "Active"}">${esc(m.rim_name)}` +
      (bad && m.rim_id != null ? ` <button class="link" data-qf-activate="${m.rim_id}" data-name="${esc(m.rim_name)}">reactivate</button>` : "") +
      ` <button class="link" aria-label="Remove ${esc(m.rim_name)}" data-qf-unmap="${m.id}" data-name="${esc(m.rim_name)}">✕</button></span>`;
  }).join(" ");
  $("#qfRecipeInfo").innerHTML = `
    <p>${pillHtml(r.status)} ${esc(r.message)}</p>
    <p class="qf-label">Allowed rims</p>
    <div class="chips">${chips || `<span class="hint">None yet — add one below.</span>`}</div>`;
  const mapped = new Set(maps.map((m) => m.rim_name));
  const addable = activeRims().filter((x) => !mapped.has(x.rim_key) && !["NONE", "UNIVERSALRIM"].includes(x.rim_key));
  $("#qfRecipeRim").innerHTML = rimOptions(addable) || `<option value="">No other active rims</option>`;
  $("#qfAddRim").disabled = !addable.length || !CONFIG.writes_enabled;
}

function renderMachinePart() {
  $("#qfEqOtherWrap").hidden = qf.eq !== "__other";
  const id = currentEq();
  const m = formMachines().find((x) => String(x.equipment_id) === id);
  const chk = checkRow(id);
  $("#qfEqInfo").innerHTML = !id ? `<p class="hint">Enter the DBM number.</p>`
    : chk ? `<p>${pillHtml(chk.status)} ${esc(chk.message)}</p>`
    : m ? `<p>${pillHtml(m.rim_status)} Running ${esc(m.running_rim ?? "no rim")}.` +
          (m.last_balanced ? ` Last balanced ${esc(fmt(m.last_balanced))} (${m.tires_balanced} tires in 30 days).` : "") + `</p>`
    : `<p class="hint">New DBM ${esc(id)}: no rim set yet.</p>`;
  // no rim yet: start on the suggested rim, or on an empty choice (never silently on the first rim)
  const keep = $("#qfEqRim").dataset.want || (!m?.running_rim && chk?.suggested_rim_id ? String(chk.suggested_rim_id) : "");
  $("#qfEqRim").innerHTML = (m?.running_rim ? "" : `<option value="">Select rim…</option>`) + rimOptions(activeRims(), m?.running_rim ?? null);
  if (keep) { $("#qfEqRim").value = keep; $("#qfEqRim").dataset.want = ""; }
  renderImpact();
  $("#qfSetRim").disabled = !CONFIG.writes_enabled || !/^\d+$/.test(id);
}

// Overview of every DBM and its current rim; the selected one is highlighted and shows the pending change.
const rimLabel = (key) => (key == null ? null : RIMS.find((r) => r.rim_key === key)?.name ?? key);
function renderOverview() {
  const list = formMachines();
  const id = currentEq();
  const newRim = RIMS.find((r) => String(r.rim_id) === $("#qfEqRim").value);
  const rows = [...list];
  if (/^\d+$/.test(id) && !rows.some((m) => String(m.equipment_id) === id)) rows.push({ equipment_id: +id, running_rim: null, rim_status: "NOT SET", isNew: true });
  const label = isDbmArea() ? "DBM" : "Machine";
  $("#qfOverview").innerHTML = rows.length ? `<table><thead><tr><th>${label}</th><th>Rim</th><th>Status</th><th class="num">WIP tires fit</th></tr></thead><tbody>${
    rows.map((m) => {
      const chk = checkRow(m.equipment_id);
      const sel = String(m.equipment_id) === id;
      const changing = sel && newRim && newRim.rim_key !== m.running_rim;
      const cur = rimLabel(m.running_rim) ?? "—";
      const rim = changing ? `${esc(cur)} → <b>${esc(newRim.name)}</b>` : esc(cur);
      const status = chk ? chk.status : m.rim_status;
      return `<tr class="${sel ? "qf-sel" : ""}" data-qf-pick="${m.equipment_id}"><td>${label} ${m.equipment_id}${m.isNew ? " (new)" : ""}</td>` +
        `<td class="m">${rim}</td><td>${pillHtml(status)}</td><td class="num">${chk ? chk.wip_tires_fit : ""}</td></tr>`;
    }).join("")}</tbody></table>` : `<p class="empty">No DBMs found.</p>`;
}

function renderImpact() {
  const rim = RIMS.find((r) => String(r.rim_id) === $("#qfEqRim").value);
  const id = currentEq();
  const m = formMachines().find((x) => String(x.equipment_id) === id);
  $("#qfImpact").textContent = rim && /^\d+$/.test(id)
    ? (m && rim.rim_key === m.running_rim ? "This is the rim it is running now." : changeoverImpact(id, rim.name))
    : "";
  renderOverview();
}

// Open the Quick fix tab with a recipe or machine preselected (used by the Fix… buttons).
function openQuickFix({ recipe, eq } = {}) {
  if (recipe) qf.recipe = recipe;
  if (eq != null) qf.eq = String(eq);
  selectTab("quick");
  renderQuickFix();
}

// ---- events
$("#qfRecipe").addEventListener("change", (e) => { qf.recipe = e.target.value; renderRecipePart(); });
$("#qfEq").addEventListener("change", (e) => { qf.eq = e.target.value; renderMachinePart(); });
$("#qfEqOther").addEventListener("input", renderMachinePart);
$("#qfOverview").addEventListener("click", (ev) => {
  const tr = ev.target.closest("[data-qf-pick]");
  if (!tr) return;
  qf.eq = tr.dataset.qfPick;
  if (![...$("#qfEq").options].some((o) => o.value === qf.eq)) { qf.eq = "__other"; $("#qfEqOther").value = tr.dataset.qfPick; }
  $("#qfEq").value = qf.eq;
  renderMachinePart();
});
$("#qfEqRim").addEventListener("change", renderImpact);

$("#qfAddRim").addEventListener("click", () => {
  const r = recipeRows().find((x) => recipeKey(x) === qf.recipe);
  const rim = RIMS.find((x) => String(x.rim_id) === $("#qfRecipeRim").value);
  if (!r || !rim) return;
  const area = $("#areaId").value.trim();
  write("POST", "/api/fix/material-rim", { material_id: r.material_id, rim_id: rim.rim_id, area_id: area === "" ? null : +area },
    `Add rim ${rim.name} to recipe ${r.recipe_id ?? "—"} (material ${r.material_id})?`,
    `Tires of this recipe will be able to run on ${rim.name}.`);
});

$("#qfRecipeInfo").addEventListener("click", (ev) => {
  const un = ev.target.closest("[data-qf-unmap]");
  const act = ev.target.closest("[data-qf-activate]");
  const r = recipeRows().find((x) => recipeKey(x) === qf.recipe);
  if (un) {
    write("DELETE", `/api/fix/material-rim/${un.dataset.qfUnmap}`, null,
      `Remove rim ${un.dataset.name} from material ${r?.material_id}?`, `Deletes material_size_lookup row ${un.dataset.qfUnmap}.`);
  } else if (act) {
    write("POST", `/api/fix/rim/${act.dataset.qfActivate}/activate`, null, `Reactivate rim ${act.dataset.name}?`,
      "Sets rim_master.isactive = true. It affects every material and machine using this rim.");
  }
});

$("#qfSetRim").addEventListener("click", () => {
  const rim = RIMS.find((x) => String(x.rim_id) === $("#qfEqRim").value);
  const id = currentEq();
  if (!/^\d+$/.test(id) || !rim) return;
  const label = isDbmArea() ? "DBM" : "machine";
  write("PUT", `/api/fix/running/${id}`, { rim_id: rim.rim_id },
    `Map rim ${rim.name} to ${label} ${id}?`, changeoverImpact(id, rim.name))
    .then((ok) => { if (ok && qf.eq === "__other") { qf.eq = id; $("#qfEqOther").value = ""; renderQuickFix(); } });
});

$("#qfSuggest").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-qf-eq]");
  if (!b) return;
  qf.eq = b.dataset.qfEq;
  $("#qfEq").value = qf.eq;
  $("#qfEqRim").dataset.want = b.dataset.qfRim;
  renderMachinePart();
});
