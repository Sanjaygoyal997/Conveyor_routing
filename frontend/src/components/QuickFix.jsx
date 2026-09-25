import React, { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../context.js";
import { api } from "../api.js";
import { fmt } from "../util.js";
import Pill from "./Pill.jsx";

// Quick fix tab: two plain forms driven by dropdowns.
//   DBM      -> running rim   (runningsize_lookup): pick the DBM first, then its rim
//   Material -> allowed rims  (material_size_lookup, for the selected machine area)
// The selection (qfSel) lives in App so the "Fix…" buttons of other tabs can preselect a material or machine.
export default function QuickFix() {
  const ctx = useApp();
  const { results } = ctx;
  if (!results) return <p className="empty">Press <b>Validate</b> first.</p>;
  return (
    <div className="qf-grid">
      <MachineCard />
      <MaterialCard />
    </div>
  );
}

const RimOptions = ({ rims }) => rims.map((r) => <option key={r.rim_id} value={r.rim_id}>{r.name}</option>);

// ---- DBM rim ----------------------------------------------------------------------
function MachineCard() {
  const { results, lookups, isDbmArea, version, activeRims, rimLabel, config, write, impact, qfSel, setQfSel, eqLabel } = useApp();
  const [dbms, setDbms] = useState([]);
  const [rimSel, setRimSel] = useState("");
  const checks = results.machines;
  const checkRow = (id) => checks.find((m) => String(m.equipment_id) === String(id));
  const label = isDbmArea ? "DBM" : "Machine";

  useEffect(() => {
    if (!isDbmArea) { setDbms([]); return; }
    api("/api/dbm-machines").then(setDbms).catch(() => setDbms([]));
  }, [isDbmArea, version, results]);

  // DBM area: every DBM machine (even without a rim); other areas: the machine-check rows
  const list = useMemo(() => (isDbmArea
    ? dbms.map((d) => ({ equipment_id: d.equipment_id, running_rim: d.rim_name, rim_status: d.rim_status,
      last_balanced: d.last_balanced, tires_balanced: d.tires_balanced, in_master: d.in_master, master_area: d.master_area }))
    : checks.map((m) => ({ equipment_id: m.equipment_id, running_rim: m.running_rim, rim_status: m.rim_status }))), [isDbmArea, dbms, checks]);

  // selected machine: keep it while it exists, else the first one with an issue
  let eq = qfSel.eq;
  if (eq !== "__other" && !list.some((m) => String(m.equipment_id) === eq)) {
    const first = list.find((m) => /^(NG|WARN)/.test(checkRow(m.equipment_id)?.status || "")) || list[0];
    eq = String(first?.equipment_id ?? "");
  }
  const id = eq === "__other" ? qfSel.eqOther.trim() : eq;
  const validId = /^\d+$/.test(id);
  const m = list.find((x) => String(x.equipment_id) === id);
  const chk = checkRow(id);

  // exact rim_master row of the running rim (rim_size holds the rim_id)
  const runId = String(lookups.running.find((e) => String(e.equipment_id) === id)?.rim_size ?? "").trim();
  const cur = m?.running_rim
    ? lookups.rims.find((r) => String(r.rim_id) === runId) || lookups.rims.find((r) => r.rim_key === m.running_rim) : null;
  const curOutside = cur && !activeRims.some((r) => r.rim_id === cur.rim_id);

  // current rim comes up automatically; no rim yet -> suggested rim or "Select rim…" (never silently the first rim).
  // Only on a new machine / running rim: a refresh after some other change must not undo the user's pick.
  useEffect(() => {
    setRimSel(qfSel.wantRim || (cur ? String(cur.rim_id) : chk?.suggested_rim_id ? String(chk.suggested_rim_id) : ""));
    if (qfSel.wantRim) setQfSel((s) => ({ ...s, wantRim: "" }));
  }, [id, cur?.rim_id, qfSel.wantRim]); // eslint-disable-line react-hooks/exhaustive-deps

  const newRim = lookups.rims.find((r) => String(r.rim_id) === rimSel);
  const same = newRim && String(newRim.rim_id) === String(cur?.rim_id ?? runId);
  const impactText = newRim && validId ? (same ? "This is the rim it is running now." : impact(id, newRim.name)) : "";

  const pickEq = (v) => setQfSel((s) => ({ ...s, eq: v }));
  const save = async () => {
    if (!validId || !newRim) return;
    const ok = await write("PUT", `/api/fix/running/${id}`, { rim_id: newRim.rim_id },
      `Map rim ${newRim.name} to ${eqLabel(id, label)}?`, impact(id, newRim.name));
    if (ok && eq === "__other") setQfSel((s) => ({ ...s, eq: id, eqOther: "" }));
  };

  const rows = [...list];
  if (validId && !rows.some((x) => String(x.equipment_id) === id)) rows.push({ equipment_id: +id, running_rim: null, rim_status: "NOT SET", isNew: true });
  const sugg = checks.filter((x) => x.suggested_rim);

  return (
    <div className="qf-card">
      <h3>DBM rim</h3>
      <p className="hint">Map a rim to a DBM: first choose the DBM, then the rim fitted on it.</p>
      <div className="qf-suggest">
        {sugg.length ? <>Suggested: {sugg.map((x) => (
          <button key={x.equipment_id} className="sm fixbtn"
            onClick={() => setQfSel((s) => ({ ...s, eq: String(x.equipment_id), wantRim: String(x.suggested_rim_id) }))}>
            {eqLabel(x.equipment_id, label)} → {x.suggested_rim} (keeps {x.unblocks_tires} off exit)</button>))}</>
          : <span className="hint">No changeover needed for the current WIP.</span>}
      </div>
      <label className="qf-field">1. Select DBM
        <select value={eq} onChange={(e) => pickEq(e.target.value)}>
          {list.map((x) => <option key={x.equipment_id} value={String(x.equipment_id)}>{eqLabel(x.equipment_id, label)}</option>)}
          <option value="__other">Other {label}…</option>
        </select>
      </label>
      {eq === "__other" && (
        <label className="qf-field">DBM number
          <input type="number" min="1" placeholder="e.g. 507" value={qfSel.eqOther}
            onChange={(e) => setQfSel((s) => ({ ...s, eqOther: e.target.value }))} />
        </label>
      )}
      <div>
        {m && m.in_master === false && <p className="hint">Not listed as a DBM in equipment_master
          {m.master_area ? ` (registered there as ${m.master_area})` : ""}.</p>}
        {!id ? <p className="hint">Enter the DBM number.</p>
          : chk ? <p><Pill status={chk.status} /> {chk.message}</p>
          : m ? <p><Pill status={m.rim_status} /> Running {m.running_rim ?? "no rim"}.
              {m.last_balanced ? ` Last balanced ${fmt(m.last_balanced)} (${m.tires_balanced} tires in 30 days).` : ""}</p>
          : <p className="hint">New DBM {id}: no rim set yet.</p>}
      </div>
      <label className="qf-field">2. Select rim
        <select value={rimSel} onChange={(e) => setRimSel(e.target.value)}>
          {!m?.running_rim && <option value="">Select rim…</option>}
          {curOutside && <option value={cur.rim_id}>{cur.name} (current, {!cur.isactive ? "inactive" : `area ${cur.area_name || cur.local_area_id}`})</option>}
          <RimOptions rims={activeRims} />
        </select>
      </label>
      {impactText && <p className="qf-impact">{impactText}</p>}
      <button className="primary" disabled={!config.writes_enabled || !validId || !newRim || same} onClick={save}>Save rim for this DBM</button>
      <p className="qf-label">All DBMs: current rim mapping</p>
      <div className="table-wrap qf-overview">
        {rows.length ? (
          <table>
            <thead><tr><th>{label}</th><th>Rim</th><th>Status</th><th className="num">WIP tires fit</th></tr></thead>
            <tbody>{rows.map((x) => {
              const c = checkRow(x.equipment_id);
              const sel = String(x.equipment_id) === id;
              const changing = sel && newRim && newRim.rim_key !== x.running_rim;
              const curName = rimLabel(x.running_rim) ?? "—";
              return (
                <tr key={x.equipment_id} className={sel ? "qf-sel" : ""} onClick={() => {
                  const v = String(x.equipment_id);
                  if (list.some((l) => String(l.equipment_id) === v)) pickEq(v);
                  else setQfSel((s) => ({ ...s, eq: "__other", eqOther: v }));
                }}>
                  <td>{eqLabel(x.equipment_id, label)}{x.isNew ? " (new)" : ""}</td>
                  <td className="m">{changing ? <>{curName} → <b>{newRim.name}</b></> : curName}</td>
                  <td><Pill status={c ? c.status : x.rim_status} /></td>
                  <td className="num">{c ? c.wip_tires_fit : ""}</td>
                </tr>
              );
            })}</tbody>
          </table>
        ) : <p className="empty">No DBMs found.</p>}
      </div>
    </div>
  );
}

// ---- Material rims -------------------------------------------------------------------
function MaterialCard() {
  const { results, filters, hoursLabel, version, activeRims, rimLabel, config, write, qfSel, setQfSel } = useApp();
  const recipes = useMemo(() => [...results.recipes].sort((a, b) => a.material_id - b.material_id), [results]);
  const [maps, setMaps] = useState([]);
  const [addSel, setAddSel] = useState("");
  const [fromSel, setFromSel] = useState("");
  const [toSel, setToSel] = useState("");
  const loadedKey = useRef(null);

  let key = qfSel.recipe;
  if (!recipes.some((r) => String(r.material_id) === key)) {
    key = String((recipes.find((r) => r.status.startsWith("NG")) || recipes[0])?.material_id ?? "");
  }
  const r = recipes.find((x) => String(x.material_id) === key);
  const area = filters.areaId;

  useEffect(() => {
    if (!r) { setMaps([]); loadedKey.current = null; return; }
    let live = true;
    const sameMaterial = loadedKey.current === key && !qfSel.fromRim;
    if (loadedKey.current !== key) setMaps(null);   // loading another material: nothing to pick yet
    api(`/api/material/${r.material_id}`).then((rows) => {
      if (!live) return;
      const here = rows.filter((m) => !area || m.area_id == null || String(m.area_id) === area);
      setMaps(here);
      loadedKey.current = key;
      // refresh of the same material (after any change): keep the picks that are still valid
      if (sameMaterial && (fromSel === "" || here.some((m) => String(m.id) === fromSel))) return;
      setAddSel("");
      setToSel("");
      // current rim comes up automatically: the clicked one, else an inactive one, else the first
      const want = qfSel.fromRim && here.find((m) => m.rim_name === qfSel.fromRim);
      const current = want || here.find((m) => m.rim_master_status !== "ACTIVE") || here[0];
      setFromSel(current ? String(current.id) : "");
      if (qfSel.fromRim) setQfSel((s) => ({ ...s, fromRim: null }));
    }).catch(() => live && setMaps([]));
    return () => { live = false; };
  }, [key, version, area, qfSel.fromRim]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!r) return <div className="qf-card"><h3>Material rims</h3><p className="empty">No materials in WIP for this selection.</p></div>;

  const loading = maps === null;
  const mapped = new Set((maps || []).map((m) => m.rim_name));
  const addable = loading ? [] : activeRims.filter((x) => !mapped.has(x.rim_key) && !["NONE", "UNIVERSALRIM"].includes(x.rim_key));
  // picks are only valid while the rim is still addable (after a save it is mapped)
  const pending = addable.find((x) => String(x.rim_id) === addSel);
  const chFrom = (maps || []).find((m) => String(m.id) === fromSel);
  const chTo = addable.find((x) => String(x.rim_id) === toSel);
  const dis = !config.writes_enabled;
  const pick = (id, rimName = null) => setQfSel((s) => ({ ...s, recipe: id, fromRim: rimName }));

  const add = () => pending && write("POST", "/api/fix/material-rim",
    { material_id: r.material_id, rim_id: pending.rim_id, area_id: area === "" ? null : +area },
    `Add rim ${pending.name} to material ${r.material_id}?`, `Tires of this material will be able to run on ${pending.name}.`);
  const change = () => chFrom && chTo && write("PUT", `/api/fix/material-rim/${chFrom.id}/rim`, { rim_id: chTo.rim_id },
    `Change rim ${rimLabel(chFrom.rim_name)} to ${chTo.name} for material ${r.material_id}?`,
    `Updates material_size_lookup row ${chFrom.id}. Tires of this material will run on ${chTo.name} instead of ${rimLabel(chFrom.rim_name)}.`);

  return (
    <div className="qf-card">
      <h3>Material rims</h3>
      <p className="hint">Which rims can this material's tires run on (for the selected machine area)?</p>
      <label className="qf-field">Material
        <select value={key} onChange={(e) => pick(e.target.value)}>
          {recipes.map((x) => <option key={x.material_id} value={String(x.material_id)}>Material {x.material_id}</option>)}
        </select>
      </label>
      <div>
        <p><Pill status={r.status} /> {r.message}</p>
        <p className="qf-label">Allowed rims</p>
        <div className="chips">
          {loading ? <span className="hint">Loading…</span> : maps.length ? maps.map((m) => {
            const bad = m.rim_master_status !== "ACTIVE";
            return (
              <span key={m.id} className={`chip${bad ? " bad" : ""}`} title={bad ? "Inactive in rim_master" : "Active"}>
                <button className="link chip-name" title="Change this rim" onClick={() => setFromSel(String(m.id))}>{rimLabel(m.rim_name)}</button>
                {bad && m.rim_id != null && <button className="link" disabled={dis}
                  onClick={() => write("POST", `/api/fix/rim/${m.rim_id}/activate`, null, `Reactivate rim ${m.rim_name}?`,
                    "Sets rim_master.isactive = true. It affects every material and machine using this rim.")}>reactivate</button>}
                <button className="link" aria-label={`Remove ${m.rim_name}`} disabled={dis}
                  onClick={() => write("DELETE", `/api/fix/material-rim/${m.id}`, null, `Remove rim ${m.rim_name} from material ${r.material_id}?`,
                    `Deletes material_size_lookup row ${m.id}.`)}>✕</button>
              </span>
            );
          }) : <span className="hint">None yet — add one below.</span>}
        </div>
      </div>
      <div className="qf-field">Change rim
        <div className="qf-row">
          <select aria-label="Current rim" disabled={loading} value={chFrom ? fromSel : ""} onChange={(e) => setFromSel(e.target.value)}>
            {maps?.length ? <><option value="">Current rim…</option>
              {maps.map((m) => <option key={m.id} value={String(m.id)}>{rimLabel(m.rim_name)}</option>)}</>
              : <option value="">No rim to change</option>}
          </select>
          <span>→</span>
          <select aria-label="New rim" disabled={loading} value={chTo ? toSel : ""} onChange={(e) => setToSel(e.target.value)}>
            <option value="">New rim…</option><RimOptions rims={addable} />
          </select>
          <button className="primary" disabled={!(chFrom && chTo) || dis} onClick={change}>Change rim</button>
        </div>
      </div>
      <div className="qf-field">Add rim
        <div className="qf-row">
          <select aria-label="Rim to add" disabled={loading} value={pending ? addSel : ""} onChange={(e) => setAddSel(e.target.value)}>
            {addable.length ? <><option value="">Select rim…</option><RimOptions rims={addable} /></> : <option value="">No other active rims</option>}
          </select>
          <button className="primary" disabled={!pending || dis} onClick={add}>Add rim to material</button>
        </div>
      </div>
      <p className="qf-label">Materials in WIP ({hoursLabel.toLowerCase()}): current rim mapping</p>
      <div className="table-wrap qf-overview">
        <table>
          <thead><tr><th>Material</th><th className="num">WIP tires</th><th>Rims</th><th>Status</th><th>DBMs</th></tr></thead>
          <tbody>{recipes.map((x) => {
            const sel = String(x.material_id) === key;
            const rims = (x.allowed_rim_sizes || []).map((k, i) => {
              const bad = (x.inactive_rim_sizes || []).includes(k);
              const name = bad ? <s title="inactive">{rimLabel(k)}</s> : rimLabel(k);
              return (
                <React.Fragment key={k}>
                  {i > 0 && ", "}
                  <span className="rim-pick" title="Change this rim"
                    onClick={(e) => { e.stopPropagation(); pick(String(x.material_id), k); }}>{name}</span>
                  {sel && chFrom && chTo && chFrom.rim_name === k && <> → <b>{chTo.name}</b></>}
                </React.Fragment>
              );
            });
            return (
              <tr key={x.material_id} className={sel ? "qf-sel" : ""} onClick={() => pick(String(x.material_id))}>
                <td>Material {x.material_id}</td>
                <td className="num">{x.wip_tires}</td>
                <td className="m">{rims.length ? rims : "—"}{sel && pending && <> <b>+ {pending.name}</b></>}</td>
                <td><Pill status={x.status} /></td>
                <td className="m">{fmt(x.eligible_equipment) || "—"}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}
