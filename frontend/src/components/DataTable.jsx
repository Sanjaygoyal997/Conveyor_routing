import React, { useMemo, useState } from "react";
import Pill from "./Pill.jsx";
import { downloadCsv, fmt, isIssue } from "../util.js";

// Sortable, filterable table with CSV export. columns: {key, label, num?, pill?}; actions(row) renders the last cell.
export default function DataTable({
  name, rows, columns, statusKey = "status", issueFilter, actions, toolbarExtra, rimLabel = (k) => k,
  emptyText, issuesLabel = "Issues only", showIssues = true, placeholder = "Filter…",
}) {
  const [q, setQ] = useState("");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [sort, setSort] = useState({ key: null, dir: "asc" });
  // rim columns hold the stored rim key (e.g. UNIVERSALRIM); show the rim_master name instead
  const show = (c, v) => (c.rim && v != null ? (Array.isArray(v) ? v.map(rimLabel) : rimLabel(v)) : v);

  const visible = useMemo(() => {
    if (!rows) return [];
    const query = q.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (showIssues && issuesOnly && !(issueFilter ? issueFilter(r) : isIssue(r[statusKey]))) return false;
      return !query || columns.some((c) => fmt(show(c, r[c.key])).toLowerCase().includes(query));
    });
    if (sort.key) {
      const k = sort.key, d = sort.dir === "desc" ? -1 : 1;
      out = [...out].sort((a, b) => {
        const x = a[k], y = b[k];
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y
          : fmt(x).localeCompare(fmt(y), undefined, { numeric: true })) * d;
      });
    }
    return out;
  }, [rows, q, issuesOnly, sort, columns, statusKey, issueFilter, showIssues, rimLabel]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));

  let content;
  if (!rows) content = <p className="empty">{emptyText}</p>;
  else if (!rows.length) content = <p className="empty">No rows.</p>;
  else if (!visible.length) content = <p className="empty">No rows match the filter.</p>;
  else content = (
    <table>
      <thead><tr>
        {columns.map((c) => (
          <th key={c.key} onClick={() => sortBy(c.key)} data-dir={sort.key === c.key ? sort.dir : undefined}>{c.label}</th>
        ))}
        {actions && <th />}
      </tr></thead>
      <tbody>
        {visible.map((r, i) => (
          <tr key={i}>
            {columns.map((c) => c.pill
              ? <td key={c.key}><Pill status={r[c.key]} /></td>
              : <td key={c.key} className={c.num ? "num" : ""}>{fmt(show(c, r[c.key]))}</td>)}
            {actions && <td className="actions">{actions(r)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <div className="toolbar">
        <input type="search" className="search" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />
        {showIssues && (
          <label className="check">
            <input type="checkbox" checked={issuesOnly} onChange={(e) => setIssuesOnly(e.target.checked)} /> {issuesLabel}
          </label>
        )}
        {toolbarExtra}
        <button onClick={() => rows && downloadCsv(name, columns, visible.map((r) => Object.fromEntries(columns.map((c) => [c.key, show(c, r[c.key])]))))}>Export CSV</button>
      </div>
      <div className="table-wrap">{content}</div>
    </>
  );
}
