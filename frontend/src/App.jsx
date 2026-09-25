import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppContext } from "./context.js";
import { api, request } from "./api.js";
import { changeoverImpact, fmt, isIssue, store } from "./util.js";
import { TABLES, rowActions } from "./tables.jsx";
import DataTable from "./components/DataTable.jsx";
import Summary from "./components/Summary.jsx";
import QuickFix from "./components/QuickFix.jsx";
import BarcodeCheck from "./components/BarcodeCheck.jsx";
import AuditLog from "./components/AuditLog.jsx";
import { ConfirmDialog, Modal, Toast } from "./components/Dialogs.jsx";
import { EquipmentDialog, MaterialDialog, RimDialog } from "./components/FixDialogs.jsx";

const HOURS = [["12", "Last 12 hours"], ["24", "Last 24 hours"], ["48", "Last 2 days"], ["72", "Last 3 days"], ["168", "Last 7 days"]];
const TABS = [
  ["quick", "Quick fix"], ["recipes", "WIP materials"], ["machines", "Machines"], ["rims", "Rim sizes"],
  ["gaps", "Master data gaps"], ["barcode", "Barcode check"], ["running", "Running sizes"], ["audit", "Change log"],
];
const EMPTY = {
  recipes: "Press Validate to check WIP materials.",
  machines: "Press Validate to check each machine's running rim against the WIP.",
  rims: "Press Validate to compare WIP rim demand with running equipment.",
  gaps: "Press Validate to run the master-data gap report.",
  running: "Loading…",
};

export default function App() {
  const [config, setConfig] = useState({ writes_enabled: false, token_required: false });
  const [health, setHealth] = useState(null);
  const [areas, setAreas] = useState(null);
  const [filters, setFilters] = useState({ hours: "48", wipStates: "", okQuality: "", areaId: "", excludeDbm: true });
  const [results, setResults] = useState(null);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState("");
  const [areaError, setAreaError] = useState("");
  const [running, setRunning] = useState(null);
  const [lookups, setLookups] = useState({ rims: [], running: [] });
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState("quick");
  const [dialog, setDialog] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState(null);
  const [operator, setOperator] = useState({ name: store.get("localStorage", "rimval.user"), token: store.get("sessionStorage", "rimval.token") });
  const [qfSel, setQfSel] = useState({ recipe: "", eq: "", eqOther: "", wantRim: "", fromRim: null });

  // latest values for async callbacks
  const live = useRef({});
  live.current = { filters, config, operator };
  const nameInput = useRef(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((msg, bad = false) => {
    setToast({ msg, bad });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const validate = useCallback(async () => {
    const f = live.current.filters;
    const p = { hours: f.hours, wip_states: f.wipStates.trim(), ok_quality: f.okQuality.trim(), area_id: f.areaId, exclude_at_dbm: f.excludeDbm };
    setValidating(true);
    setError("");
    try {
      const [recipes, rims, gaps, machines] = await Promise.all([
        api("/api/wip/readiness", p), api("/api/wip/demand", p),
        api("/api/gaps", { hours: p.hours, area_id: p.area_id }), api("/api/wip/machines", p),
      ]);
      setResults({ recipes, rims, gaps, machines });
    } catch (e) {
      setError(e.message);
    } finally {
      setValidating(false);
    }
  }, []);

  const loadRunning = useCallback(async () => {
    const f = live.current.filters;
    try { setRunning(await api("/api/running-sizes", { area_id: f.areaId, hours: f.hours })); }
    catch (e) { setRunning([]); setError(e.message); }
  }, []);

  const loadLookups = useCallback(async () => {
    const [rims, run] = await Promise.all([api("/api/rims"), api("/api/running-sizes", { hours: live.current.filters.hours })]);
    setLookups({ rims, running: run });
  }, []);

  // startup: health, config, areas (DBM is the default), then validate
  useEffect(() => {
    api("/api/health").then(setHealth).catch((e) => { setHealth({ error: true }); setError(e.message); });
    api("/api/config").then(setConfig).catch(() => {});
    api("/api/areas").then((a) => {
      setAreas(a);
      const def = a.find((x) => x.is_default);
      setFilters((f) => ({ ...f, areaId: def ? String(def.local_area_id) : "" }));
    }).catch((e) => { setAreas([]); setAreaError(`Could not load the machine areas (${e.message}); validating for DBM.`); });
  }, []);

  // area changed (or loaded): reload running sizes and lookups, re-validate
  useEffect(() => {
    if (areas === null) return;
    loadRunning();
    loadLookups().catch(() => {});
    validate();
  }, [areas, filters.areaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const askConfirm = (title, detail) => new Promise((resolve) => setConfirm({ title, detail, resolve }));

  // every change: confirm, send with operator name (+ admin token), then refresh everything
  const write = useCallback(async (method, path, body, title, detail) => {
    const { config: cfg, operator: op } = live.current;
    if (!cfg.writes_enabled) { showToast("Editing is switched off on this server", true); return false; }
    const user = op.name.trim();
    if (!user) { showToast("Enter your name at the top before making changes", true); nameInput.current?.focus(); return false; }
    if (!(await askConfirm(title, detail))) return false;
    const headers = { "X-User": user };
    if (cfg.token_required) headers["X-Admin-Token"] = op.token;
    try {
      const out = await request(method, path, { body: body ?? undefined, headers });
      // refresh first, so the tables are up to date when the confirmation shows
      await Promise.all([validate(), loadRunning(), loadLookups()]).catch(() => {});
      setVersion((v) => v + 1);
      showToast(out?.message || "Saved");
      return true;
    } catch (e) {
      showToast(e.message, true);
      return false;
    }
  }, [showToast, validate, loadRunning, loadLookups]);

  // no area selected -> DBM (its id from the rim list), the same default the API uses
  const dbmFromRims = lookups.rims.find((r) => /^DBM\b/i.test(r.area_name || ""))?.local_area_id;
  const areaId = filters.areaId || (dbmFromRims != null ? String(dbmFromRims) : "");
  const area = (areas || []).find((a) => String(a.local_area_id) === areaId);
  const inArea = useCallback((r) => !areaId || String(r.local_area_id) === areaId, [areaId]);
  const activeRims = useMemo(() => lookups.rims.filter((r) => r.isactive && inArea(r)), [lookups.rims, inArea]);

  const ctx = {
    // no area selected (area list empty or not loaded): the API validates for DBM, so the page does too
    config, filters: { ...filters, areaId }, areaName: area ? `${area.name} (area ${area.local_area_id})` : "DBM",
    isDbmArea: area ? /^DBM\b/i.test(area.name) : true,
    hoursLabel: HOURS.find(([v]) => v === filters.hours)?.[1] || "look-back",
    results, lookups, version, activeRims,
    rimFor: (key, { activeOnly = true } = {}) =>
      lookups.rims.filter((r) => (r.rim_key === key || String(r.rim_id) === key) && (!activeOnly || r.isactive)).find(inArea) || null,
    rimLabel: (key) => (key == null ? null : lookups.rims.find((r) => r.rim_key === key)?.name ?? key),
    impact: (eq, rimName) => changeoverImpact(eq, rimName, lookups.running, results?.recipes || []),
    write,
    openDialog: (d) => { loadLookups().catch(() => {}); setDialog(d); },
    openQuickFix: ({ recipe, eq } = {}) => {
      setQfSel((s) => ({ ...s, ...(recipe ? { recipe } : {}), ...(eq != null ? { eq: String(eq) } : {}) }));
      setTab("quick");
    },
    qfSel, setQfSel,
  };

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const setOp = (k, v) => setOperator((o) => ({ ...o, [k]: v }));

  const counts = {};
  if (results) {
    for (const t of ["recipes", "machines", "rims", "gaps"]) {
      const def = TABLES[t];
      counts[t] = results[t].filter((r) => (def.issueFilter ? def.issueFilter(r) : isIssue(r[def.statusKey || "status"]))).length;
    }
  }

  const table = (name, extra = {}) => {
    const def = TABLES[name];
    return (
      <DataTable key={name} name={name} rows={name === "running" ? running : results?.[name]} columns={def.columns}
        statusKey={def.statusKey} issueFilter={def.issueFilter} issuesLabel={def.issuesLabel} placeholder={def.placeholder}
        emptyText={EMPTY[name]} actions={(row) => rowActions(name, row, ctx)} {...extra} />
    );
  };

  const dialogTitle = dialog && (dialog.kind === "material" ? `Material ${dialog.materialId}`
    : dialog.kind === "equipment" ? `Equipment ${dialog.equipmentId}` : `Rim ${dialog.rimKey}`);

  return (
    <AppContext.Provider value={ctx}>
      <header className="topbar">
        <div>
          <h1>Rim Size Validation</h1>
          <p className="sub">WIP between Curing and DBM · material → rim size → running DBM</p>
        </div>
        <div className="top-right">
          <div className="edit-bar">
            {config.writes_enabled ? <>
              <span className="mode rw">Edit mode</span>
              <input ref={nameInput} placeholder="Your name" maxLength={50} autoComplete="name" aria-label="Your name (recorded with every change)"
                value={operator.name} onChange={(e) => setOp("name", e.target.value)}
                onBlur={(e) => store.set("localStorage", "rimval.user", e.target.value.trim())} />
              {config.token_required && <input type="password" placeholder="Admin token" autoComplete="off" aria-label="Admin token"
                value={operator.token} onChange={(e) => { setOp("token", e.target.value); store.set("sessionStorage", "rimval.token", e.target.value); }} />}
            </> : <span className="mode ro" title="Set RimValidation:AllowWrites=true on the server to enable fixes">Read-only</span>}
          </div>
          <div className={`db-status ${health ? (health.error ? "bad" : "ok") : ""}`}>
            {!health ? "Connecting…" : health.error ? "Database unreachable" : `${health.database} · DB time ${fmt(health.db_time)}`}
          </div>
        </div>
      </header>

      <main>
        <section className="filters" aria-label="Validation options">
          <label>Look-back
            <select value={filters.hours} onChange={(e) => setFilter("hours", e.target.value)}>
              {HOURS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>WIP state codes
            <input placeholder="all" inputMode="numeric" title="Comma-separated curing state codes; blank = all"
              value={filters.wipStates} onChange={(e) => setFilter("wipStates", e.target.value)} />
          </label>
          <label>OK quality codes
            <input placeholder="all" inputMode="numeric" title="Comma-separated quality_status codes that may be routed; blank = all"
              value={filters.okQuality} onChange={(e) => setFilter("okQuality", e.target.value)} />
          </label>
          <label>Machine area
            <select value={filters.areaId} onChange={(e) => setFilter("areaId", e.target.value)}
              title="Rims and mappings are defined per area (machine type). WIP to DBM uses the DBM area.">
              {areas && areas.length ? areas.map((a) => <option key={a.local_area_id} value={String(a.local_area_id)}>{a.name} (area {a.local_area_id})</option>)
                : <option value="">DBM (default)</option>}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={filters.excludeDbm} onChange={(e) => setFilter("excludeDbm", e.target.checked)} /> Exclude tires already at DBM
          </label>
          <button className="primary" disabled={validating} onClick={() => { validate(); loadRunning(); }}>
            {validating ? "Validating…" : "Validate"}</button>
        </section>

        <Summary results={results} />
        {error && <div className="error" role="alert">{error}</div>}
        {areaError && <div className="error" role="alert">{areaError}</div>}

        <nav className="tabs" role="tablist">
          {TABS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {l}{counts[k] ? <span className="count">{counts[k]}</span> : null}
            </button>
          ))}
        </nav>

        <section className="panel">
          {tab === "quick" && <QuickFix />}
          {tab === "recipes" && table("recipes")}
          {tab === "machines" && <>
            <p className="hint">Running rim of each machine checked against the WIP. A suggested changeover keeps WIP tires off the exit
              conveyor that no machine can take today, and never strands more tires than it frees. Only one machine is suggested per rim;
              validate again after each changeover.</p>
            {table("machines")}
          </>}
          {tab === "rims" && table("rims")}
          {tab === "gaps" && table("gaps")}
          {tab === "barcode" && <BarcodeCheck />}
          {tab === "running" && table("running", { showIssues: false, toolbarExtra: <button onClick={loadRunning}>Refresh</button> })}
          {tab === "audit" && <AuditLog />}
        </section>
      </main>

      {dialog && (
        <Modal key={JSON.stringify(dialog)} title={dialogTitle} onClose={() => setDialog(null)}>
          {dialog.kind === "material" && <MaterialDialog materialId={dialog.materialId} context={dialog.context} />}
          {dialog.kind === "equipment" && <EquipmentDialog equipmentId={dialog.equipmentId} />}
          {dialog.kind === "rim" && <RimDialog rimKey={dialog.rimKey} />}
        </Modal>
      )}
      {confirm && <ConfirmDialog title={confirm.title} detail={confirm.detail}
        onAnswer={(v) => { confirm.resolve(v); setConfirm(null); }} />}
      <Toast toast={toast} />
    </AppContext.Provider>
  );
}
