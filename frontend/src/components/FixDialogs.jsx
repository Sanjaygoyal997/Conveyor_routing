import React, { useEffect, useMemo, useState } from "react";
import { useApp } from "../context.js";
import { api } from "../api.js";
import { fmt } from "../util.js";
import Pill from "./Pill.jsx";

const NO_EDIT = "Editing is switched off on this server";
const RimOptions = ({ rims }) => rims.map((r) => <option key={r.rim_id} value={r.rim_id}>{r.name}</option>);
const reactivateDetail = "Sets rim_master.isactive = true. It affects every material and equipment using this rim.";

// ---- material: mapped rims, add rim, change over a DBM ---------------------------
export function MaterialDialog({ materialId, context = {} }) {
  const { version, filters, areaName, lookups, results, activeRims, rimFor, config, write, impact } = useApp();
  const [maps, setMaps] = useState(null);
  const [err, setErr] = useState("");
  const [areaInputs, setAreaInputs] = useState({});
  const [addRim, setAddRim] = useState("");
  const [addArea, setAddArea] = useState("");
  const [coEq, setCoEq] = useState("");
  const [coRim, setCoRim] = useState("");

  useEffect(() => {
    setErr("");
    api(`/api/material/${materialId}`).then(setMaps).catch((e) => setErr(e.message));
  }, [materialId, version]);

  const area = filters.areaId;
  const here = (maps || []).filter((m) => !area || m.area_id == null || String(m.area_id) === area);
  const mapped = new Set(here.map((m) => m.rim_name));
  const addable = activeRims.filter((r) => !mapped.has(r.rim_key) && r.rim_key !== "NONE" && r.rim_key !== "UNIVERSALRIM");
  const usable = [...new Set(here.filter((m) => m.rim_master_status === "ACTIVE" && m.rim_name !== "NONE").map((m) => m.rim_name))]
    .map((k) => rimFor(k)).filter(Boolean);
  const eqs = lookups.running.filter((e) => !usable.some((r) => r.rim_key === e.rim_name));
  const areaDefault = area || addable[0]?.local_area_id || "";

  // keep selections valid when the lists change
  const addSel = addable.some((r) => String(r.rim_id) === addRim) ? addRim : String(addable[0]?.rim_id ?? "");
  const coEqSel = eqs.some((e) => String(e.equipment_id) === coEq) ? coEq : String(eqs[0]?.equipment_id ?? "");
  const coRimSel = usable.some((r) => String(r.rim_id) === coRim) ? coRim : String(usable[0]?.rim_id ?? "");
  useEffect(() => { setAddArea(String(areaDefault)); }, [materialId, area]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = (results?.recipes || []).find((r) => r.material_id === materialId);
  const status = live ? live.status : context.status, message = live ? live.message : context.message;
  const dis = !config.writes_enabled;

  if (err) return <div className="error">{err}</div>;
  if (!maps) return <p className="empty">Loading…</p>;

  const pickAddRim = (v) => {
    setAddRim(v);
    const rim = lookups.rims.find((r) => String(r.rim_id) === v);
    if (rim?.local_area_id != null) setAddArea(String(rim.local_area_id));
  };
  const doMap = () => {
    const rim = lookups.rims.find((r) => String(r.rim_id) === addSel);
    if (!rim) return;
    const a = addArea.trim();
    write("POST", "/api/fix/material-rim", { material_id: materialId, rim_id: rim.rim_id, area_id: a === "" ? null : +a },
      `Map rim ${rim.name} to material ${materialId}?`, `Adds a row to material_size_lookup${a ? ` for area ${a}` : " with no area"}.`);
  };
  const doArea = (m) => {
    const v = String(areaInputs[m.id] ?? lookups.rims.find((r) => r.rim_id === m.rim_id)?.local_area_id ?? areaDefault).trim();
    if (v === "") return;
    write("PATCH", `/api/fix/material-rim/${m.id}`, { area_id: +v }, `Set area ${v} on mapping ${m.id}?`, "Updates material_size_lookup.area_id.");
  };
  const doChangeover = () => {
    const rim = lookups.rims.find((r) => String(r.rim_id) === coRimSel);
    if (!coEqSel || !rim) return;
    write("PUT", `/api/fix/running/${coEqSel}`, { rim_id: rim.rim_id }, `Change equipment ${coEqSel} to rim ${rim.name}?`, impact(coEqSel, rim.name));
  };

  return (
    <>
      {status && <p className="dlg-status"><Pill status={status} /> {message}</p>}
      <h4>Allowed rims <span className="hint">(all areas; validation uses {areaName})</span></h4>
      {maps.length ? (
        <div className="table-wrap"><table>
          <thead><tr><th>Rim</th><th>Area</th><th>Rim master</th><th>Running on</th><th /></tr></thead>
          <tbody>{maps.map((m) => (
            <tr key={m.id}>
              <td className="m">{m.rim_name} <span className="hint">id {m.rim_size}</span></td>
              <td>{m.area_id ?? "—"}</td>
              <td><Pill status={m.rim_master_status} /></td>
              <td className="m">{fmt(m.equipment_running) || "—"}</td>
              <td className="actions">
                {m.rim_master_status !== "ACTIVE" && m.rim_id != null &&
                  <button className="sm" disabled={dis} title={dis ? NO_EDIT : undefined}
                    onClick={() => write("POST", `/api/fix/rim/${m.rim_id}/activate`, null, `Reactivate rim ${m.rim_name}?`, reactivateDetail)}>
                    Reactivate rim</button>}
                {m.area_id == null && <>
                  <input className="sm num" type="number" placeholder="area" aria-label="Area"
                    value={areaInputs[m.id] ?? String(lookups.rims.find((r) => r.rim_id === m.rim_id)?.local_area_id ?? areaDefault)}
                    onChange={(e) => setAreaInputs({ ...areaInputs, [m.id]: e.target.value })} />
                  <button className="sm" disabled={dis} onClick={() => doArea(m)}>Set area</button>
                </>}
                <button className="sm danger" disabled={dis}
                  onClick={() => write("DELETE", `/api/fix/material-rim/${m.id}`, null, `Remove rim ${m.rim_name} from material ${materialId}?`,
                    `Deletes material_size_lookup row ${m.id}.`)}>Remove</button>
              </td>
            </tr>))}
          </tbody>
        </table></div>
      ) : <p className="empty">No rim mapped yet. Add one below.</p>}

      <h4>Add an allowed rim for {areaName}</h4>
      <div className="form-row">
        <select aria-label="Rim to add" value={addSel} onChange={(e) => pickAddRim(e.target.value)}>
          {addable.length ? <RimOptions rims={addable} /> : <option disabled value="">No other active rims</option>}
        </select>
        <input className="num" type="number" placeholder="area" aria-label="Area" value={addArea} onChange={(e) => setAddArea(e.target.value)} />
        <button className="primary" disabled={!addable.length || dis} onClick={doMap}>Add rim</button>
      </div>

      <h4>Change over a DBM to one of these rims</h4>
      {usable.length ? (
        <div className="form-row">
          <select aria-label="Equipment" value={coEqSel} onChange={(e) => setCoEq(e.target.value)}>
            {eqs.map((e) => <option key={e.equipment_id} value={e.equipment_id}>{e.equipment_id}</option>)}
          </select>
          <span>→</span>
          <select aria-label="Rim" value={coRimSel} onChange={(e) => setCoRim(e.target.value)}><RimOptions rims={usable} /></select>
          <button className="primary" disabled={dis} onClick={doChangeover}>Change over</button>
        </div>
      ) : <p className="empty">Map or reactivate a rim first.</p>}
    </>
  );
}

// ---- equipment: set running rim ---------------------------------------------------
export function EquipmentDialog({ equipmentId }) {
  const { lookups, results, activeRims, config, write, impact } = useApp();
  const e = lookups.running.find((x) => String(x.equipment_id) === String(equipmentId));
  const cur = e?.rim_name ?? null;
  const d = cur && (results?.rims || []).find((x) => x.rim_size === cur);
  const def = useMemo(() => String(activeRims.find((r) => r.rim_key === cur)?.rim_id ?? activeRims[0]?.rim_id ?? ""), [activeRims, cur]);
  const [sel, setSel] = useState(null);
  const value = sel ?? def;
  const save = () => {
    const rim = lookups.rims.find((r) => String(r.rim_id) === value);
    if (!rim) return;
    write("PUT", `/api/fix/running/${equipmentId}`, { rim_id: rim.rim_id }, `Set equipment ${equipmentId} to rim ${rim.name}?`,
      impact(equipmentId, rim.name));
  };
  return (
    <>
      <p className="dlg-status">Running rim <b className="m">{e?.rim_name ?? "not set"}</b> <Pill status={e?.rim_master_status || "NOT SET"} />
        {d ? ` · ${d.wip_tires} WIP tires accept this rim` : ""}</p>
      <h4>Set running rim</h4>
      <div className="form-row">
        <select aria-label="Running rim" value={value} onChange={(ev) => setSel(ev.target.value)}><RimOptions rims={activeRims} /></select>
        <button className="primary" disabled={!config.writes_enabled} onClick={save}>Set running rim</button>
      </div>
      <p className="hint">Only active rims from rim_master can be selected. UniversalRIM takes any tire; None marks the equipment as not available.</p>
    </>
  );
}

// ---- rim: who runs it, change over equipment to it ------------------------------------
export function RimDialog({ rimKey }) {
  const { lookups, results, rimFor, config, write, impact, openDialog } = useApp();
  const rim = rimFor(rimKey), anyRim = rimFor(rimKey, { activeOnly: false });
  const d = (results?.rims || []).find((x) => x.rim_size === rimKey);
  const runningOn = lookups.running.filter((e) => e.rim_name === rimKey);
  const others = lookups.running.filter((e) => e.rim_name !== rimKey);
  const [eq, setEq] = useState("");
  const eqSel = others.some((e) => String(e.equipment_id) === eq) ? eq : String(others[0]?.equipment_id ?? "");
  const dis = !config.writes_enabled;
  return (
    <>
      <p className="dlg-status"><Pill status={rim ? "ACTIVE" : "INACTIVE"} />
        {d ? ` ${d.wip_tires} WIP tires accept this rim, ${d.blocked_tires} to exit conveyor` : " No WIP tires accept this rim"}</p>
      {!rim && anyRim && <p><button className="sm" disabled={dis}
        onClick={() => write("POST", `/api/fix/rim/${anyRim.rim_id}/activate`, null, `Reactivate rim ${rimKey}?`, reactivateDetail)}>
        Reactivate rim {anyRim.name}</button></p>}
      {!!(d?.materials || []).length && <>
        <h4>Materials in WIP</h4>
        <div className="chips">{d.materials.map((m) =>
          <button key={m} className="sm" onClick={() => openDialog({ kind: "material", materialId: m })}>Material {m}</button>)}</div>
      </>}
      <h4>Running on</h4>
      {runningOn.length
        ? <div className="chips">{runningOn.map((e) =>
          <button key={e.equipment_id} className="sm" onClick={() => openDialog({ kind: "equipment", equipmentId: e.equipment_id })}>
            Equipment {e.equipment_id}</button>)}</div>
        : <p className="empty">No equipment is running this rim.</p>}
      {rim && <>
        <h4>Change over equipment to rim {rim.name}</h4>
        <div className="form-row">
          <select aria-label="Equipment" value={eqSel} onChange={(e) => setEq(e.target.value)}>
            {others.map((e) => <option key={e.equipment_id} value={e.equipment_id}>{e.equipment_id}</option>)}
          </select>
          <button className="primary" disabled={dis || !eqSel}
            onClick={() => write("PUT", `/api/fix/running/${eqSel}`, { rim_id: rim.rim_id }, `Change equipment ${eqSel} to rim ${rimKey}?`,
              impact(eqSel, rimKey))}>Change over</button>
        </div>
      </>}
    </>
  );
}
