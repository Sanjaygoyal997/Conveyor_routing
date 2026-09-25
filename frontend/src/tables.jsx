import React from "react";

// Column definitions for the result tabs, and the fix buttons per row.
export const TABLES = {
  recipes: {
    placeholder: "Filter material, rim, status…",
    columns: [
      { key: "status", label: "Status", pill: true },
      { key: "material_id", label: "Material", num: true },
      { key: "wip_tires", label: "WIP tires", num: true },
      { key: "allowed_rim_sizes", label: "Allowed rims", rim: true },
      { key: "running_rim_sizes", label: "Rims running", rim: true },
      { key: "inactive_rim_sizes", label: "Inactive rims", rim: true },
      { key: "eligible_equipment", label: "Eligible equipment" },
      { key: "curing_presses", label: "Curing presses" },
      { key: "first_cured", label: "First cured" },
      { key: "last_cured", label: "Last cured" },
      { key: "message", label: "Message" },
    ],
  },
  machines: {
    placeholder: "Filter machine, rim, status…",
    columns: [
      { key: "status", label: "Status", pill: true },
      { key: "equipment_id", label: "Machine", num: true },
      { key: "equipment_name", label: "Name" },
      { key: "running_rim", label: "Running rim", rim: true },
      { key: "rim_status", label: "Rim", pill: true },
      { key: "wip_tires_fit", label: "WIP tires fit", num: true },
      { key: "only_here_tires", label: "Only here", num: true },
      { key: "suggested_rim", label: "Suggested rim", rim: true },
      { key: "unblocks_tires", label: "Kept off exit", num: true },
      { key: "blocks_tires", label: "Blocks", num: true },
      { key: "message", label: "Message" },
    ],
  },
  rims: {
    placeholder: "Filter rim size, status…",
    columns: [
      { key: "status", label: "Status", pill: true },
      { key: "rim_size", label: "Rim size", rim: true },
      { key: "wip_tires", label: "WIP tires accepting", num: true },
      { key: "blocked_tires", label: "To exit conveyor", num: true },
      { key: "materials", label: "Materials" },
      { key: "equipment_running", label: "Equipment running" },
    ],
  },
  gaps: {
    placeholder: "Filter check, entity, detail…",
    statusKey: "severity",
    issueFilter: (r) => r.severity === "ERROR",
    issuesLabel: "Errors only",
    columns: [
      { key: "severity", label: "Severity", pill: true },
      { key: "check_code", label: "Check" },
      { key: "entity", label: "Table" },
      { key: "entity_ref", label: "Reference" },
      { key: "detail", label: "Detail" },
    ],
  },
  running: {
    placeholder: "Filter equipment, rim…",
    statusKey: "rim_master_status",
    columns: [
      { key: "equipment_id", label: "Equipment", num: true },
      { key: "equipment_name", label: "Name" },
      { key: "rim_name", label: "Running rim", rim: true },
      { key: "rim_area", label: "Rim area" },
      { key: "rim_master_status", label: "Status", pill: true },
      { key: "created_by", label: "Set by" },
      { key: "dtandtime", label: "Set at" },
    ],
  },
};

export const MATERIAL_CHECKS = ["MSL_RIM_INVALID", "MSL_NULL_AREA", "MSL_NONE_RIM", "MSL_RIM_WRONG_AREA",
  "MSL_RIM_INACTIVE", "MSL_MATERIAL_NOT_RUNNABLE", "MSL_BLANK_RIM", "PROD_MATERIAL_NO_SIZE"];
export const EQUIPMENT_CHECKS = ["RUN_RIM_WRONG_AREA", "RUN_RIM_INACTIVE", "RUN_BLANK_RIM", "DBM_NO_RUNNING_SIZE"];

const Btn = ({ primary, onClick, children }) => (
  <button className={`sm${primary ? " fixbtn" : ""}`} onClick={onClick}>{children}</button>
);

// ctx: the AppContext value
export function rowActions(table, row, ctx) {
  const { openQuickFix, openDialog, write, impact, eqLabel, rimLabel } = ctx;
  switch (table) {
    case "recipes":
      return <Btn primary={row.status !== "OK"} onClick={() => openQuickFix({ recipe: String(row.material_id) })}>
        {row.status === "OK" ? "Rims…" : "Fix…"}</Btn>;
    case "rims":
      if (row.status === "NG_UNRESOLVED") {
        return (row.materials || []).map((m) => (
          <React.Fragment key={m}><Btn primary onClick={() => openDialog({ kind: "material", materialId: m })}>Material {m}</Btn>{" "}</React.Fragment>));
      }
      return <Btn primary={row.status.startsWith("NG")} onClick={() => openDialog({ kind: "rim", rimKey: row.rim_size })}>
        {row.status.startsWith("NG") ? "Fix…" : "Change over…"}</Btn>;
    case "gaps": {
      const c = row.check_code, f = row.fix_ref || {};
      if (MATERIAL_CHECKS.includes(c)) {
        return <Btn primary={row.severity !== "INFO"}
          onClick={() => openDialog({ kind: "material", materialId: f.material_id, context: { status: c, message: row.detail } })}>Fix…</Btn>;
      }
      if (EQUIPMENT_CHECKS.includes(c)) {
        return <Btn primary={row.severity !== "INFO"} onClick={() => openDialog({ kind: "equipment", equipmentId: f.equipment_id })}>Fix…</Btn>;
      }
      if (c === "MSL_SIZE_NOT_RUNNING") {
        return <Btn primary={row.severity !== "INFO"} onClick={() => openDialog({ kind: "rim", rimKey: f.rim_size })}>Fix…</Btn>;
      }
      if (c === "MSL_DUPLICATE_ROW") {
        return <Btn primary onClick={() => write("POST", "/api/fix/material-rim/dedupe",
          { material_id: f.material_id, area_id: f.area_id, rim_size: f.rim_size },
          `Remove duplicate rows for material ${f.material_id}, rim ${rimLabel(f.rim_size)}?`,
          `Keeps row ${f.row_ids[0]} and deletes ${f.row_ids.slice(1).join(", ")}.`)}>Remove duplicates</Btn>;
      }
      return <span className="hint" title="Fix this in the source system">—</span>;
    }
    case "running":
      return <Btn onClick={() => openQuickFix({ eq: row.equipment_id })}>Set rim…</Btn>;
    case "machines":
      return <>
        {row.suggested_rim && <><Btn primary onClick={() => write("PUT", `/api/fix/running/${row.equipment_id}`,
          { rim_id: row.suggested_rim_id }, `Change ${eqLabel(row.equipment_id, "machine")} to rim ${rimLabel(row.suggested_rim)}?`,
          impact(row.equipment_id, row.suggested_rim))}>Apply → {rimLabel(row.suggested_rim)}</Btn>{" "}</>}
        <Btn onClick={() => openQuickFix({ eq: row.equipment_id })}>Set rim…</Btn>
      </>;
    default:
      return null;
  }
}
