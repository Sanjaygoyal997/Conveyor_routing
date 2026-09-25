import React, { useRef, useState } from "react";
import { useApp } from "../context.js";
import { api } from "../api.js";
import { fmt } from "../util.js";

function MiniTable({ rows, cols }) {
  if (!rows.length) return <p className="empty">No records.</p>;
  return (
    <div className="table-wrap"><table>
      <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{fmt(r[c])}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

export default function BarcodeCheck() {
  const { filters, rimLabel } = useApp();
  const [code, setCode] = useState("");
  const [equipment, setEquipment] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);

  const submit = async (ev) => {
    ev.preventDefault();
    const c = code.trim();
    if (!c) return;
    setBusy(true);
    try {
      const r = await api(`/api/barcode/${encodeURIComponent(c)}`,
        { equipment_id: equipment.trim(), area_id: filters.areaId, ok_quality: filters.okQuality.trim() });
      setResult({ r, targeted: !!equipment.trim() });
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setBusy(false);
      input.current?.select();
    }
  };

  let out = <p className="empty">Checks the barcode against curing, rim master and running sizes, and shows its DBM history.</p>;
  if (busy) out = <p className="empty">Checking…</p>;
  else if (result?.error) out = <div className="error">{result.error}</div>;
  else if (result) {
    const { r, targeted } = result;
    const v = r.validation;
    const ok = v.length > 0 && v.every((x) => x.status === "OK");
    const first = v[0] || {};
    const equipmentOk = v.filter((x) => x.status === "OK" && x.equipment_id != null).map((x) => x.equipment_id);
    const rims = [...new Set(v.map((x) => x.rim_size).filter(Boolean))].map(rimLabel).join(", ");
    // no DBM fits -> the conveyor sends the tire to the exit conveyor (with a target DBM, NG only means "not this one")
    const headline = ok ? (equipmentOk.length ? `OK: can go to equipment ${equipmentOk.join(", ")}` : "OK")
      : `${first.status}${targeted ? " (not this DBM)" : " → exit conveyor"}`;
    const atDbm = r.dbm.length ? `Already balanced at DBM ${r.dbm[0].equipment_id} on ${fmt(r.dbm[0].dtandtime)}` : "Not yet at DBM (in WIP)";
    out = (
      <>
        <div className={`result-banner ${ok ? "ok" : "ng"}`}>{headline}
          <small>{first.message || ""} · material {first.material_id ?? "–"} · rim {rims || "–"} · {atDbm}</small>
        </div>
        <h3>Curing records</h3>
        <MiniTable rows={r.curing} cols={["dtandtime", "equipment_id", "recipe_id", "material_id", "mould_code", "side", "quality_status", "state"]} />
        <h3>DBM records</h3>
        <MiniTable rows={r.dbm} cols={["dtandtime", "equipment_id", "model", "code", "total_rank", "ro_total"]} />
      </>
    );
  }

  return (
    <>
      <form className="toolbar" onSubmit={submit}>
        <input id="barcode" ref={input} autoFocus placeholder="Scan or type tire barcode" autoComplete="off" required
          value={code} onChange={(e) => setCode(e.target.value)} />
        <input placeholder="Target equipment (optional)" inputMode="numeric" value={equipment} onChange={(e) => setEquipment(e.target.value)} />
        <button className="primary" type="submit" disabled={busy}>Check barcode</button>
      </form>
      <div>{out}</div>
    </>
  );
}
