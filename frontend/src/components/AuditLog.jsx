import React, { useCallback, useEffect, useState } from "react";
import { useApp } from "../context.js";
import { api } from "../api.js";
import { fmt } from "../util.js";

const SKIP = ["created_by", "dtandtime"];

export default function AuditLog() {
  const { version, lookups } = useApp();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    api("/api/audit", { limit: 200 }).then((r) => { setRows(r); setErr(""); }).catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load, version]);

  // rim_size holds a rim_id: show the rim name
  const showVal = (k, v) => {
    if (k !== "rim_size" || v == null) return v;
    const r = lookups.rims.find((x) => String(x.rim_id) === String(v).trim());
    return r ? r.name : v;
  };
  const diff = (before, after) => {
    const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
      .filter((k) => !SKIP.includes(k) && JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
    if (!before) return "added: " + keys.map((k) => `${k}=${showVal(k, after[k])}`).join(", ");
    if (!after) return "deleted: " + Object.entries(before).filter(([k]) => !SKIP.includes(k)).map(([k, v]) => `${k}=${showVal(k, v)}`).join(", ");
    return keys.map((k) => `${k}: ${showVal(k, before[k])} → ${showVal(k, after[k])}`).join(", ");
  };

  return (
    <>
      <div className="toolbar"><button onClick={load}>Refresh</button></div>
      <div className="table-wrap">
        {err ? <p className="empty">{err}. Run sql/05_audit.sql to create the audit table.</p>
          : !rows ? <p className="empty">Loading…</p>
          : !rows.length ? <p className="empty">No changes made from this UI yet.</p>
          : (
            <table>
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Table</th><th>Row</th><th>Change</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmt(r.dtandtime)}</td><td>{r.user_name}</td><td>{r.action}</td><td>{r.table_name}</td>
                  <td className="m">{r.row_ref}</td><td>{diff(r.before, r.after)}</td>
                </tr>))}
              </tbody>
            </table>
          )}
      </div>
    </>
  );
}
