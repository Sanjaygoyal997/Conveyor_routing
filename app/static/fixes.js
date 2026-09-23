"use strict";
// Fix actions for every validation case. Loaded after app.js (uses $, esc, fmt, api, state, validate, loadRunning).

let CONFIG = { writes_enabled: false, token_required: false };
let RIMS = [];               // master.rim_master rows
let RUNNING = [];            // runningsize_lookup rows (+ DBM without a row)
let currentDialog = null;    // () => Promise<void>, re-renders the open dialog

const store = {
  get(area, k) { try { return window[area].getItem(k) || ""; } catch { return ""; } },
  set(area, k, v) { try { window[area].setItem(k, v); } catch { /* storage blocked */ } },
};

// ---- edit mode --------------------------------------------------------------
async function loadConfig() {
  try { CONFIG = await api("/api/config"); } catch { CONFIG = { writes_enabled: false }; }
  const bar = $("#editBar");
  if (!CONFIG.writes_enabled) {
    bar.innerHTML = `<span class="mode ro" title="Set ALLOW_WRITES=true on the server to enable fixes">Read-only</span>`;
    return;
  }
  bar.innerHTML = `
    <span class="mode rw">Edit mode</span>
    <input id="opName" placeholder="Your name" maxlength="50" autocomplete="name" aria-label="Your name (recorded with every change)">
    ${CONFIG.token_required ? `<input id="opToken" type="password" placeholder="Admin token" autocomplete="off" aria-label="Admin token">` : ""}`;
  $("#opName").value = store.get("localStorage", "rimval.user");
  $("#opName").addEventListener("change", (e) => store.set("localStorage", "rimval.user", e.target.value.trim()));
  if (CONFIG.token_required) {
    $("#opToken").value = store.get("sessionStorage", "rimval.token");
    $("#opToken").addEventListener("change", (e) => store.set("sessionStorage", "rimval.token", e.target.value));
  }
}

async function loadLookups() {
  [RIMS, RUNNING] = await Promise.all([api("/api/rims"), api("/api/running-sizes", { hours: $("#hours").value })]);
}

const rimKey = (s) => (s == null ? null : String(s).trim().toUpperCase() || null);
// rims are defined per area (machine type): only offer rims of the selected area
const inArea = (r) => { const a = $("#areaId").value.trim(); return !a || String(r.local_area_id) === a; };
function rimFor(key, { activeOnly = true } = {}) {
  const hits = RIMS.filter((r) => (r.rim_key === key || String(r.rim_id) === key) && (!activeOnly || r.isactive));
  return hits.find(inArea) || null;
}
const activeRims = () => RIMS.filter((r) => r.isactive && inArea(r));
const demandOf = (key) => (state.rims?.rows || []).find((d) => d.rim_size === key);

// ---- write + confirm ----------------------------------------------------------
function confirmStep(title, detail) {
  const dlg = $("#confirmDialog");
  $("#confirmTitle").textContent = title;
  $("#confirmDetail").textContent = detail || "";
  dlg.showModal();
  return new Promise((resolve) => {
    const done = (v) => { dlg.close(); $("#confirmOk").onclick = $("#confirmCancel").onclick = null; resolve(v); };
    $("#confirmOk").onclick = () => done(true);
    $("#confirmCancel").onclick = () => done(false);
    dlg.oncancel = () => done(false);
  });
}

function toast(msg, bad = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast ${bad ? "bad" : "good"}`;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 5000);
}

async function write(method, path, body, title, detail) {
  if (!CONFIG.writes_enabled) return toast("Editing is switched off on this server", true);
  const user = $("#opName")?.value.trim();
  if (!user) { toast("Enter your name at the top before making changes", true); $("#opName")?.focus(); return; }
  if (!(await confirmStep(title, detail))) return;
  const headers = { "Content-Type": "application/json", "X-User": user };
  if (CONFIG.token_required) headers["X-Admin-Token"] = $("#opToken").value;
  try {
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof out.detail === "string" ? out.detail : JSON.stringify(out.detail || out));
    toast(out.message || "Saved");
    await Promise.all([validate(), loadRunning(), loadLookups()]);
    if (!$("[data-panel=audit]").hidden) loadAudit();
    if (currentDialog) await currentDialog();
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  }
}

// What a changeover would do to the current WIP (from the last validation run).
function changeoverImpact(equipmentId, newRimName) {
  const eq = +equipmentId, newKey = rimKey(newRimName);
  const cur = RUNNING.find((e) => e.equipment_id === eq);
  const rows = state.recipes?.rows || [];
  const hasActive = (r) => !["NG_NO_MATERIAL_SIZE", "NG_NO_ACTIVE_RIM"].includes(r.status);
  const fits = (r) => newKey === "UNIVERSALRIM" ? hasActive(r)
    : newKey !== "NONE" && (r.allowed_rim_sizes || []).includes(newKey) && !(r.inactive_rim_sizes || []).includes(newKey);
  const lost = rows.filter((r) => (r.eligible_equipment || []).length === 1 && r.eligible_equipment[0] === eq && !fits(r));
  const gained = rows.filter((r) => !(r.eligible_equipment || []).length && fits(r));
  const n = (list) => list.reduce((s, r) => s + Number(r.wip_tires || 0), 0);
  const parts = [`Equipment ${eq} is running ${cur?.rim_name ?? "nothing"} now.`];
  if (gained.length) parts.push(`Unblocks ${n(gained)} WIP tire(s): material ${gained.map((r) => r.material_id).join(", ")}.`);
  parts.push(lost.length ? `Blocks ${n(lost)} WIP tire(s) that can only go to ${eq}: material ${lost.map((r) => r.material_id).join(", ")}.`
                         : "No WIP tire loses its only eligible equipment.");
  return parts.join(" ");
}

// ---- dialog shell -------------------------------------------------------------
async function openDialog(title, builder) {
  const dlg = $("#fixDialog");
  $("#fixTitle").textContent = title;
  currentDialog = async () => {
    $("#fixBody").innerHTML = `<p class="empty">Loading…</p>`;
    try { await loadLookups(); $("#fixBody").innerHTML = await builder(); }
    catch (e) { $("#fixBody").innerHTML = `<div class="error">${esc(e.message)}</div>`; }
  };
  if (!dlg.open) dlg.showModal();
  await currentDialog();
}
$("#fixClose").addEventListener("click", () => $("#fixDialog").close());
$("#fixDialog").addEventListener("close", () => (currentDialog = null));

const dis = () => (CONFIG.writes_enabled ? "" : " disabled title=\"Editing is switched off on this server\"");
const pillHtml = (s) => (s ? `<span class="pill ${pillClass(s === "ACTIVE" ? "OK" : s === "INACTIVE" || s === "NOT SET" ? "NG" : s)}">${esc(s)}</span>` : "");
// dropdown options show the rim name only; details are shown next to the dropdown
function rimOptions(rims, selectedKey) {
  return rims.map((r) =>
    `<option value="${r.rim_id}"${r.rim_key === selectedKey ? " selected" : ""}>${esc(r.name)}</option>`).join("");
}
function equipmentOptions(filter = () => true) {
  return RUNNING.filter(filter).map((e) =>
    `<option value="${e.equipment_id}">${e.equipment_id}</option>`).join("");
}

// ---- material: mapped rims, add rim, change over equipment --------------------
function materialDialog(materialId, context = {}) {
  openDialog(`Material ${materialId}${context.recipe_id ? ` · recipe ${context.recipe_id}` : ""}`, async () => {
    const maps = await api(`/api/material/${materialId}`);
    const selArea = $("#areaId").value.trim();
    const here = maps.filter((m) => !selArea || m.area_id == null || String(m.area_id) === selArea);  // mappings for this area
    const mapped = new Set(here.map((m) => m.rim_name));
    const addable = activeRims().filter((r) => !mapped.has(r.rim_key) && r.rim_key !== "NONE" && r.rim_key !== "UNIVERSALRIM");
    const usable = [...new Set(here.filter((m) => m.rim_master_status === "ACTIVE" && m.rim_name !== "NONE").map((m) => m.rim_name))]
      .map((k) => rimFor(k)).filter(Boolean);
    const areaDefault = $("#areaId").value.trim() || addable[0]?.local_area_id || "";
    const areaName = $("#areaId").selectedOptions[0]?.textContent || "all areas";
    // status from the latest validation run, so it updates after each fix
    const live = (state.recipes?.rows || []).find((r) => r.material_id === materialId && (!context.recipe_id || r.recipe_id === context.recipe_id));
    const status = live ? live.status : context.status, message = live ? live.message : context.message;
    const rows = maps.map((m) => `
      <tr><td class="m">${esc(m.rim_name)} <span class="hint">id ${esc(m.rim_size)}</span></td><td>${esc(m.area_id ?? "—")}</td><td>${pillHtml(m.rim_master_status)}</td>
        <td class="m">${esc(fmt(m.equipment_running) || "—")}</td>
        <td class="actions">
          ${m.rim_master_status !== "ACTIVE" && m.rim_id != null ? `<button class="sm" data-act="activate" data-rim="${m.rim_id}" data-name="${esc(m.rim_name)}"${dis()}>Reactivate rim</button>` : ""}
          ${m.area_id == null ? `<input class="sm num" type="number" id="area-${m.id}" placeholder="area" value="${esc(RIMS.find((r) => r.rim_id === m.rim_id)?.local_area_id ?? areaDefault)}"><button class="sm" data-act="area" data-id="${m.id}"${dis()}>Set area</button>` : ""}
          <button class="sm danger" data-act="unmap" data-id="${m.id}" data-name="${esc(m.rim_name)}"${dis()}>Remove</button>
        </td></tr>`).join("");
    return `
      ${status ? `<p class="dlg-status">${pillHtml(status)} ${esc(message || "")}</p>` : ""}
      <h4>Allowed rims <span class="hint">(all areas; validation uses ${esc(areaName)})</span></h4>
      ${maps.length ? `<div class="table-wrap"><table><thead><tr><th>Rim</th><th>Area</th><th>Rim master</th><th>Running on</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
                    : `<p class="empty">No rim mapped yet. Add one below.</p>`}
      <h4>Add an allowed rim for ${esc(areaName)}</h4>
      <div class="form-row">
        <select id="addRim" aria-label="Rim to add">${rimOptions(addable) || "<option disabled>No other active rims</option>"}</select>
        <input id="addArea" class="num" type="number" placeholder="area" value="${esc(areaDefault)}" aria-label="Area">
        <button class="primary" data-act="map" ${addable.length ? "" : "disabled"}${dis()}>Add rim</button>
      </div>
      <h4>Change over a DBM to one of these rims</h4>
      ${usable.length ? `<div class="form-row">
        <select id="coEq" aria-label="Equipment">${equipmentOptions((e) => !usable.some((r) => r.rim_key === e.rim_name))}</select>
        <span>→</span>
        <select id="coRim" aria-label="Rim">${rimOptions(usable)}</select>
        <button class="primary" data-act="changeover"${dis()}>Change over</button></div>`
      : `<p class="empty">Map or reactivate a rim first.</p>`}`;
  });
  $("#fixBody").onchange = (ev) => {
    if (ev.target.id !== "addRim") return;
    const rim = RIMS.find((r) => String(r.rim_id) === ev.target.value);
    if (rim?.local_area_id != null) $("#addArea").value = rim.local_area_id;
  };
  $("#fixBody").onclick = (ev) => {
    const b = ev.target.closest("button[data-act]");
    if (!b) return;
    const a = b.dataset.act;
    if (a === "map") {
      const rim = RIMS.find((r) => String(r.rim_id) === $("#addRim").value);
      const area = $("#addArea").value.trim();
      write("POST", "/api/fix/material-rim", { material_id: materialId, rim_id: rim.rim_id, area_id: area === "" ? null : +area },
        `Map rim ${rim.name} to material ${materialId}?`, `Adds a row to material_size_lookup${area ? ` for area ${area}` : " with no area"}.`);
    } else if (a === "unmap") {
      write("DELETE", `/api/fix/material-rim/${b.dataset.id}`, null,
        `Remove rim ${b.dataset.name} from material ${materialId}?`, `Deletes material_size_lookup row ${b.dataset.id}.`);
    } else if (a === "area") {
      const v = $(`#area-${b.dataset.id}`).value.trim();
      if (v === "") return toast("Enter an area id", true);
      write("PATCH", `/api/fix/material-rim/${b.dataset.id}`, { area_id: +v },
        `Set area ${v} on mapping ${b.dataset.id}?`, "Updates material_size_lookup.area_id.");
    } else if (a === "activate") {
      write("POST", `/api/fix/rim/${b.dataset.rim}/activate`, null,
        `Reactivate rim ${b.dataset.name}?`, "Sets rim_master.isactive = true. It affects every material and equipment using this rim.");
    } else if (a === "changeover") {
      const eq = $("#coEq").value, rim = RIMS.find((r) => String(r.rim_id) === $("#coRim").value);
      if (!eq) return toast("No other equipment to change over", true);
      write("PUT", `/api/fix/running/${eq}`, { rim_id: rim.rim_id },
        `Change equipment ${eq} to rim ${rim.name}?`, changeoverImpact(eq, rim.name));
    }
  };
}

// ---- equipment: set running rim ----------------------------------------------
function equipmentDialog(equipmentId) {
  $("#fixBody").onchange = null;
  openDialog(`Equipment ${equipmentId}`, async () => {
    const e = RUNNING.find((x) => String(x.equipment_id) === String(equipmentId));
    const cur = e?.rim_name ?? null;
    const d = cur && demandOf(cur);
    return `
      <p class="dlg-status">Running rim <b class="m">${esc(e?.rim_name ?? "not set")}</b> ${pillHtml(e?.rim_master_status || "NOT SET")}
        ${d ? ` · ${d.wip_tires} WIP tires accept this rim` : ""}</p>
      <h4>Set running rim</h4>
      <div class="form-row">
        <select id="eqRim" aria-label="Running rim">${rimOptions(activeRims(), cur)}</select>
        <button class="primary" data-act="setrun"${dis()}>Set running rim</button>
      </div>
      <p class="hint">Only active rims from rim_master can be selected. UniversalRIM takes any tire; None marks the equipment as not available. The hint shows how many WIP tires accept each rim.</p>`;
  });
  $("#fixBody").onclick = (ev) => {
    if (!ev.target.closest("button[data-act=setrun]")) return;
    const rim = RIMS.find((r) => String(r.rim_id) === $("#eqRim").value);
    write("PUT", `/api/fix/running/${equipmentId}`, { rim_id: rim.rim_id },
      `Set equipment ${equipmentId} to rim ${rim.name}?`, changeoverImpact(equipmentId, rim.name));
  };
}

// ---- rim: who runs it, change over equipment to it ----------------------------
function rimDialog(key) {
  $("#fixBody").onchange = null;
  openDialog(`Rim ${key}`, async () => {
    const rim = rimFor(key), anyRim = rimFor(key, { activeOnly: false });
    const d = demandOf(key);
    const runningOn = RUNNING.filter((e) => e.rim_name === key);
    const mats = d?.materials || [];
    return `
      <p class="dlg-status">${rim ? pillHtml("ACTIVE") : pillHtml("INACTIVE")}
        ${d ? ` ${d.wip_tires} WIP tires accept this rim, ${d.blocked_tires} blocked` : " No WIP tires accept this rim"}</p>
      ${!rim && anyRim ? `<p><button class="sm" data-act="activate" data-rim="${anyRim.rim_id}"${dis()}>Reactivate rim ${esc(anyRim.name)}</button></p>` : ""}
      ${mats.length ? `<h4>Materials in WIP</h4><div class="chips">${mats.map((m) => `<button class="sm" data-act="material" data-id="${m}">Material ${m}</button>`).join("")}</div>` : ""}
      <h4>Running on</h4>
      ${runningOn.length ? `<div class="chips">${runningOn.map((e) => `<button class="sm" data-act="equipment" data-id="${e.equipment_id}">Equipment ${e.equipment_id}</button>`).join("")}</div>`
                         : `<p class="empty">No equipment is running this rim.</p>`}
      ${rim ? `<h4>Change over equipment to rim ${esc(rim.name)}</h4>
      <div class="form-row">
        <select id="rimEq" aria-label="Equipment">${equipmentOptions((e) => e.rim_name !== key)}</select>
        <button class="primary" data-act="changeover" data-rim="${rim.rim_id}"${dis()}>Change over</button>
      </div>` : ""}`;
  });
  $("#fixBody").onclick = (ev) => {
    const b = ev.target.closest("button[data-act]");
    if (!b) return;
    if (b.dataset.act === "material") return materialDialog(+b.dataset.id);
    if (b.dataset.act === "equipment") return equipmentDialog(+b.dataset.id);
    if (b.dataset.act === "activate") {
      return write("POST", `/api/fix/rim/${b.dataset.rim}/activate`, null, `Reactivate rim ${key}?`,
        "Sets rim_master.isactive = true. It affects every material and equipment using this rim.");
    }
    if (b.dataset.act === "changeover") {
      const eq = $("#rimEq").value;
      if (!eq) return toast("No other equipment to change over", true);
      write("PUT", `/api/fix/running/${eq}`, { rim_id: +b.dataset.rim },
        `Change equipment ${eq} to rim ${key}?`, changeoverImpact(eq, key));
    }
  };
}

// ---- action buttons per table row ---------------------------------------------
const MATERIAL_CHECKS = ["MSL_RIM_INVALID", "MSL_MULTI_RIM", "MSL_NULL_AREA", "MSL_NONE_RIM", "MSL_RIM_WRONG_AREA", "MSL_RIM_INACTIVE", "MSL_MATERIAL_NOT_RUNNABLE", "MSL_BLANK_RIM", "PROD_MATERIAL_NO_SIZE"];
const EQUIPMENT_CHECKS = ["RUN_RIM_WRONG_AREA", "RUN_RIM_INACTIVE", "RUN_BLANK_RIM", "DBM_NO_RUNNING_SIZE"];

function fixActions(table, row, i) {
  const btn = (label, kind, extra = "") => `<button class="sm${kind === "primary" ? " fixbtn" : ""}" data-fix="${i}" ${extra}>${esc(label)}</button>`;
  if (table === "recipes") return btn(row.status === "OK" ? "Rims…" : "Fix…", row.status === "OK" ? "" : "primary", `data-quick="1"`);
  if (table === "rims") {
    if (row.status === "NG_UNRESOLVED") return (row.materials || []).map((m) => btn(`Material ${m}`, "primary", `data-material="${m}"`)).join(" ");
    return btn(row.status.startsWith("NG") ? "Fix…" : "Change over…", row.status.startsWith("NG") ? "primary" : "");
  }
  if (table === "gaps") {
    const c = row.check_code;
    if (MATERIAL_CHECKS.includes(c) || EQUIPMENT_CHECKS.includes(c) || c === "MSL_SIZE_NOT_RUNNING") return btn("Fix…", row.severity === "INFO" ? "" : "primary");
    if (c === "MSL_DUPLICATE_ROW") return btn("Remove duplicates", "primary");
    return `<span class="hint" title="Fix this in the source system">—</span>`;
  }
  if (table === "running") return btn("Set rim…", "", `data-quick="1"`);
  if (table === "machines") {
    const apply = row.suggested_rim ? btn(`Apply → ${row.suggested_rim}`, "primary", `data-apply="1"`) + " " : "";
    return apply + btn("Set rim…", "", `data-quick="1"`);
  }
  return "";
}

function onFix(table, row, el) {
  if (table === "recipes") return openQuickFix({ recipe: `${row.recipe_id ?? ""}|${row.material_id}` });
  if (table === "rims") return el.dataset.material ? materialDialog(+el.dataset.material) : rimDialog(row.rim_size);
  if (table === "running") return openQuickFix({ eq: row.equipment_id });
  if (table === "machines") {
    if (el.dataset.apply) {
      return loadLookups().then(() => write("PUT", `/api/fix/running/${row.equipment_id}`, { rim_id: row.suggested_rim_id },
        `Change machine ${row.equipment_id} to rim ${row.suggested_rim}?`, changeoverImpact(row.equipment_id, row.suggested_rim)));
    }
    return openQuickFix({ eq: row.equipment_id });
  }
  if (table === "gaps") {
    const f = row.fix_ref || {};
    if (MATERIAL_CHECKS.includes(row.check_code)) return materialDialog(f.material_id, { status: row.check_code, message: row.detail });
    if (EQUIPMENT_CHECKS.includes(row.check_code)) return equipmentDialog(f.equipment_id);
    if (row.check_code === "MSL_SIZE_NOT_RUNNING") return rimDialog(f.rim_size);
    if (row.check_code === "MSL_DUPLICATE_ROW") {
      return write("POST", "/api/fix/material-rim/dedupe", { material_id: f.material_id, area_id: f.area_id, rim_size: f.rim_size },
        `Remove duplicate rows for material ${f.material_id}, rim ${f.rim_size}?`,
        `Keeps row ${f.row_ids[0]} and deletes ${f.row_ids.slice(1).join(", ")}.`);
    }
  }
}

// ---- audit log ----------------------------------------------------------------
function diff(before, after) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
    .filter((k) => !["created_by", "dtandtime"].includes(k) && JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
  if (!before) return "added: " + keys.map((k) => `${k}=${after[k]}`).join(", ");
  if (!after) return "deleted: " + Object.entries(before).filter(([k]) => !["created_by", "dtandtime"].includes(k)).map(([k, v]) => `${k}=${v}`).join(", ");
  return keys.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(", ");
}
async function loadAudit() {
  try {
    const rows = await api("/api/audit", { limit: 200 });
    $("#table-audit").innerHTML = rows.length ? `<table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Table</th><th>Row</th><th>Change</th></tr></thead><tbody>${
      rows.map((r) => `<tr><td>${esc(fmt(r.dtandtime))}</td><td>${esc(r.user_name)}</td><td>${esc(r.action)}</td><td>${esc(r.table_name)}</td>
        <td class="m">${esc(r.row_ref)}</td><td>${esc(diff(r.before, r.after))}</td></tr>`).join("")}</tbody></table>`
      : `<p class="empty">No changes made from this UI yet.</p>`;
  } catch (e) {
    $("#table-audit").innerHTML = `<p class="empty">${esc(e.message)}. Run sql/05_audit.sql to create the audit table.</p>`;
  }
}
$("#loadAudit").addEventListener("click", loadAudit);
$(".tabs button[data-tab=audit]").addEventListener("click", loadAudit);

loadConfig();
