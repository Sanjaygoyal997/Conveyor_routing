import React from "react";
import { pillClass, tires } from "../util.js";

export default function Summary({ results }) {
  if (!results) return null;
  const { recipes, rims, gaps, machines } = results;
  const toChange = machines.filter((m) => pillClass(m.status) !== "ok" && !m.status.startsWith("INFO")).length;
  const ngRows = recipes.filter((r) => pillClass(r.status) === "ng");
  const ngTires = tires(ngRows);
  const rimsNotRunning = rims.filter((r) => r.status === "NG_NOT_RUNNING").length;
  const errors = gaps.filter((g) => g.severity === "ERROR").length;
  const tiles = [
    ["WIP tires (Curing → DBM)", tires(recipes), ""],
    ["Materials in WIP", recipes.length, ""],
    ["Materials with issues", ngRows.length, ngRows.length ? "ng" : "ok"],
    ["WIP tires → exit conveyor", ngTires, ngTires ? "ng" : "ok"],
    ["Rim sizes not running", rimsNotRunning, rimsNotRunning ? "ng" : "ok"],
    ["Machines to fix / change over", toChange, toChange ? "ng" : "ok"],
    ["Master data errors", errors, errors ? "ng" : "ok"],
  ];
  return (
    <section className="tiles">
      {tiles.map(([l, v, c]) => (
        <div key={l} className={`tile ${c}`}><div className="v">{v}</div><div className="l">{l}</div></div>
      ))}
    </section>
  );
}
