"""API tests for the read and fix endpoints. Run by test/run_tests.sh against the throwaway DB."""
import os
import sys

os.environ.setdefault("ALLOW_WRITES", "true")
os.environ.setdefault("ADMIN_TOKEN", "secret")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient  # noqa: E402

from app import fixes  # noqa: E402
from app.main import app  # noqa: E402

c = TestClient(app)
H = {"X-User": "tester", "X-Admin-Token": "secret"}
failed = 0


def check(desc, got, expected):
    global failed
    ok = got == expected
    failed += not ok
    print(("PASS  " if ok else "FAIL  ") + desc + ("" if ok else f"\n  expected: {expected}\n  got:      {got}"))


def status_of(material_id):
    rows = c.get("/api/wip/readiness", params={"wip_states": "1"}).json()
    return next((r["status"] for r in rows if r["material_id"] == material_id), None)


def rim_id(name):
    return next(r["rim_id"] for r in c.get("/api/rims").json() if r["rim_key"] == name)


# -- guards
check("API: no operator name -> 422",
      c.post("/api/fix/material-rim", json={"material_id": 106, "rim_id": 1}, headers={"X-Admin-Token": "secret"}).status_code, 422)
check("API: wrong admin token -> 401",
      c.post("/api/fix/material-rim", json={"material_id": 106, "rim_id": 1}, headers={"X-User": "x", "X-Admin-Token": "bad"}).status_code, 401)
fixes.ALLOW_WRITES = False
check("API: writes switched off -> 403",
      c.post("/api/fix/material-rim", json={"material_id": 106, "rim_id": 1}, headers=H).status_code, 403)
fixes.ALLOW_WRITES = True

# -- NG_NO_MATERIAL_SIZE: map a rim
check("API: before fix material 106", status_of(106), "NG_NO_MATERIAL_SIZE")
r = c.post("/api/fix/material-rim", json={"material_id": 106, "rim_id": rim_id("15"), "area_id": 1}, headers=H)
check("API: map rim 15 to material 106", (r.status_code, status_of(106)), (200, "OK"))
check("API: mapping the same rim twice -> 409",
      c.post("/api/fix/material-rim", json={"material_id": 106, "rim_id": rim_id("15"), "area_id": 1}, headers=H).status_code, 409)
check("API: mapping an inactive rim -> 409",
      c.post("/api/fix/material-rim", json={"material_id": 106, "rim_id": rim_id("17")}, headers=H).status_code, 409)

# -- NG_NO_EQUIPMENT_RUNNING: change over equipment 504 (16) to 19
r = c.put("/api/fix/running/504", json={"rim_id": rim_id("19")}, headers=H)
check("API: change over 504 to rim 19 fixes material 104", (r.status_code, status_of(104)), (200, "OK"))
check("API: material 101 still routable on 15", status_of(101), "OK")

# -- DBM_NO_RUNNING_SIZE: equipment 506 appears as NOT SET, then gets a rim
run = {e["equipment_id"]: e for e in c.get("/api/running-sizes").json()}
check("API: DBM 506 listed as NOT SET", run[506]["rim_master_status"], "NOT SET")
c.put("/api/fix/running/506", json={"rim_id": rim_id("16")}, headers=H)
gaps = c.get("/api/gaps").json()
check("API: DBM_NO_RUNNING_SIZE cleared", any(g["check_code"] == "DBM_NO_RUNNING_SIZE" for g in gaps), False)

# -- NG_NO_ACTIVE_RIM: reactivate rim 17 (508 runs it) fixes material 102
r = c.post(f"/api/fix/rim/{rim_id('17')}/activate", headers=H)
check("API: reactivate rim 17 fixes material 102", (r.status_code, status_of(102)), (200, "OK"))

# -- MSL_DUPLICATE_ROW
dup = next(g for g in c.get("/api/gaps").json() if g["check_code"] == "MSL_DUPLICATE_ROW")
r = c.post("/api/fix/material-rim/dedupe", json={k: dup["fix_ref"][k] for k in ("material_id", "area_id", "rim_size")}, headers=H)
check("API: dedupe removes 1 row", r.json()["message"], "Removed 1 duplicate row(s)")

# -- MSL_NULL_AREA
null_area = next(g for g in c.get("/api/gaps").json() if g["check_code"] == "MSL_NULL_AREA")
r = c.patch(f"/api/fix/material-rim/{null_area['fix_ref']['row_id']}", json={"area_id": 1}, headers=H)
check("API: set area clears MSL_NULL_AREA",
      (r.status_code, any(g["check_code"] == "MSL_NULL_AREA" for g in c.get("/api/gaps").json())), (200, False))

# -- remove a mapping
row = next(m for m in c.get("/api/material/107").json() if m["rim_size"] == "17")
r = c.delete(f"/api/fix/material-rim/{row['id']}", headers=H)
check("API: remove mapping", (r.status_code, [m["rim_size"] for m in c.get("/api/material/107").json()]), (200, ["15"]))

# -- audit trail
log = c.get("/api/audit").json()
check("API: every write audited", [a["action"] for a in reversed(log)],
      ["map_rim", "set_running_rim", "set_running_rim", "activate_rim", "dedupe", "set_area", "unmap_rim"])
check("API: audit keeps before/after", (log[-2]["before"]["rim_size"], log[-2]["after"]["rim_size"]), ("16", "19"))

sys.exit(1 if failed else 0)
