export const fmt = (v) => {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.replace("T", " ").slice(0, 19);
  return String(v);
};

export function pillClass(status) {
  const s = String(status || "");
  if (s === "OK" || s === "ACTIVE") return "ok";
  if (s.startsWith("NG") || s === "ERROR" || s === "INACTIVE" || s === "NOT SET") return "ng";
  if (s.startsWith("WARN") || s === "NOT AVAILABLE" || s === "WRONG AREA") return "warn";
  return "info";
}
export const isIssue = (status) => ["ng", "warn"].includes(pillClass(status));

export const tires = (rows) => rows.reduce((s, r) => s + Number(r.wip_tires || 0), 0);

export function downloadCsv(name, columns, rows) {
  const q = (v) => `"${fmt(v).replace(/"/g, '""')}"`;
  const csv = [columns.map((c) => q(c.label)).join(","), ...rows.map((r) => columns.map((c) => q(r[c.key])).join(","))].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `rim-validation-${name}-${new Date().toISOString().slice(0, 16).replace(":", "")}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const store = {
  get(area, k) { try { return window[area].getItem(k) || ""; } catch { return ""; } },
  set(area, k, v) { try { window[area].setItem(k, v); } catch { /* storage blocked */ } },
};

// What a changeover would do to the current WIP (from the last validation run).
export function changeoverImpact(equipmentId, newRimName, running, recipes) {
  const eq = +equipmentId, newKey = newRimName == null ? null : String(newRimName).trim().toUpperCase();
  const cur = running.find((e) => e.equipment_id === eq);
  const hasActive = (r) => !["NG_NO_MATERIAL_SIZE", "NG_NO_ACTIVE_RIM"].includes(r.status);
  const fits = (r) => newKey === "UNIVERSALRIM" ? hasActive(r)
    : newKey !== "NONE" && (r.allowed_rim_sizes || []).includes(newKey) && !(r.inactive_rim_sizes || []).includes(newKey);
  const lost = recipes.filter((r) => (r.eligible_equipment || []).length === 1 && r.eligible_equipment[0] === eq && !fits(r));
  const gained = recipes.filter((r) => !(r.eligible_equipment || []).length && fits(r));
  const parts = [`Equipment ${eq} is running ${cur?.rim_name ?? "nothing"} now.`];
  if (gained.length) parts.push(`Keeps ${tires(gained)} WIP tire(s) off the exit conveyor: material ${gained.map((r) => r.material_id).join(", ")}.`);
  parts.push(lost.length
    ? `Sends ${tires(lost)} WIP tire(s) to the exit conveyor (they can only go to ${eq}): material ${lost.map((r) => r.material_id).join(", ")}.`
    : "No WIP tire goes to the exit conveyor because of this change.");
  return parts.join(" ");
}
