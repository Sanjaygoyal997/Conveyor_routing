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

function recipeRows() {
  const rank = (s) => (s.startsWith("NG") ? 0 : s.startsWith("WARN") ? 1 : 2);
  return [...(state.recipes?.rows || [])].sort((a, b) => rank(a.status) - rank(b.status) || (a.recipe_id ?? 0) - (b.recipe_id ?? 0));
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
  if (!rows.some((r) => recipeKey(r) === qf.recipe)) qf.recipe = recipeKey(rows[0]);
  $("#qfRecipe").innerHTML = rows.map((r) =>
    `<option value="${esc(recipeKey(r))}"${recipeKey(r) === qf.recipe ? " selected" : ""}>` +
    `Recipe ${esc(r.recipe_id ?? "—")} · material ${r.material_id} · ${r.wip_tires} tire${r.wip_tires == 1 ? "" : "s"} · ${esc(r.status)}</option>`).join("");
  await renderRecipePart();

  // ---- DBM form: every DBM machine, even without a rim
  try { QF_DBMS = isDbmArea() ? await api("/api/dbm-machines") : []; } catch { QF_DBMS = []; }
  const list = formMachines();
  const label = isDbmArea() ? "DBM" : "Machine";
  if (qf.eq !== "__other" && !list.some((m) => String(m.equipment_id) === qf.eq)) {
    const first = list.find((m) => (checkRow(m.equipment_id)?.status || "").match(/^(NG|WARN)/)) || list[0];
    qf.eq = String(first?.equipment_id ?? "");
  }
  $("#qfEq").innerHTML = list.map((m) => {
    const chk = checkRow(m.equipment_id);
    const flag = chk && chk.status !== "OK" ? ` · ${chk.status}` : !["ACTIVE", "UNIVERSAL"].includes(m.rim_status) ? ` · ${m.rim_status}` : "";
    return `<option value="${m.equipment_id}"${String(m.equipment_id) === qf.eq ? " selected" : ""}>` +
      `${label} ${m.equipment_id} · ${esc(m.running_rim ?? "no rim set")}${esc(flag)}</option>`;
  }).join("") + `<option value="__other"${qf.eq === "__other" ? " selected" : ""}>Other ${label} (enter number)…</option>`;
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
  const keep = $("#qfEqRim").dataset.want || "";
  $("#qfEqRim").innerHTML = rimOptions(activeRims(), m?.running_rim ?? null);
  if (keep) { $("#qfEqRim").value = keep; $("#qfEqRim").dataset.want = ""; }
  renderImpact();
  $("#qfSetRim").disabled = !CONFIG.writes_enabled || !/^\d+$/.test(id);
}

function renderImpact() {
  const rim = RIMS.find((r) => String(r.rim_id) === $("#qfEqRim").value);
  const id = currentEq();
  const m = formMachines().find((x) => String(x.equipment_id) === id);
  $("#qfImpact").textContent = rim && /^\d+$/.test(id)
    ? (m && rim.rim_key === m.running_rim ? "This is the rim it is running now." : changeoverImpact(id, rim.name))
    : "";
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
