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


# rim_master ids (see test/seed.sql): 1 R20225/12, 2 R195225/12, 4 R24/12 (inactive), 6 UniversalRIM/12,
# 7 None/12, 8 R225245/12, 9 R17520/12 (inactive), 13 R20225/11
BODY = {"material_id": 106, "rim_id": 1, "area_id": 12}

# -- guards
check("API: no operator name -> 422",
      c.post("/api/fix/material-rim", json=BODY, headers={"X-Admin-Token": "secret"}).status_code, 422)
check("API: wrong admin token -> 401",
      c.post("/api/fix/material-rim", json=BODY, headers={"X-User": "x", "X-Admin-Token": "bad"}).status_code, 401)
fixes.ALLOW_WRITES = False
check("API: writes switched off -> 403", c.post("/api/fix/material-rim", json=BODY, headers=H).status_code, 403)
fixes.ALLOW_WRITES = True

# -- NG_NO_MATERIAL_SIZE: map a rim (stored as rim_id)
check("API: before fix material 106", status_of(106), "NG_NO_MATERIAL_SIZE")
r = c.post("/api/fix/material-rim", json=BODY, headers=H)
check("API: map R20225 to material 106", (r.status_code, status_of(106)), (200, "OK"))
check("API: stored as rim_id", [m["rim_size"] for m in c.get("/api/material/106").json()], ["1"])
check("API: mapping the same rim twice -> 409", c.post("/api/fix/material-rim", json=BODY, headers=H).status_code, 409)
check("API: mapping an inactive rim -> 409",
      c.post("/api/fix/material-rim", json={"material_id": 106, "rim_id": 9, "area_id": 12}, headers=H).status_code, 409)
check("API: mapping a rim from another area -> 409",
      c.post("/api/fix/material-rim", json={"material_id": 106, "rim_id": 13, "area_id": 12}, headers=H).status_code, 409)
check("API: mapping rim None -> 409",
      c.post("/api/fix/material-rim", json={"material_id": 106, "rim_id": 7, "area_id": 12}, headers=H).status_code, 409)

# -- UniversalRIM / None on equipment
c.put("/api/fix/running/505", json={"rim_id": 6}, headers=H)
check("API: 505 on UniversalRIM makes material 104 routable", status_of(104), "OK")
c.put("/api/fix/running/505", json={"rim_id": 7}, headers=H)
check("API: 505 on None is not available", status_of(104), "NG_NO_EQUIPMENT_RUNNING")
run = {e["equipment_id"]: e for e in c.get("/api/running-sizes").json()}
check("API: running sizes show None as NOT AVAILABLE", run[505]["rim_master_status"], "NOT AVAILABLE")

# -- NG_NO_EQUIPMENT_RUNNING: change over equipment 504 (R195225) to R225245
r = c.put("/api/fix/running/504", json={"rim_id": 8}, headers=H)
check("API: change over 504 to R225245 fixes material 104", (r.status_code, status_of(104)), (200, "OK"))
check("API: material 101 still routable on R20225", status_of(101), "OK")

# -- DBM machine list for "pick DBM, then rim": DBM rims + balanced at DBM (incl. no rim / wrong-area rim)
dbms = {m["equipment_id"]: m["rim_status"] for m in c.get("/api/dbm-machines").json()}
check("API: DBM list = DBM-rim machines + machines seen at DBM, no TUO machine",
      sorted(dbms), [501, 502, 503, 504, 505, 506, 508, 509, 510])
check("API: DBM list statuses", (dbms[506], dbms[509], dbms[510]), ("NOT SET", "NOT AVAILABLE", "WRONG AREA"))

# -- machine check: after 504 went to R225245 nothing is blocked any more -> no suggestions
machines = {m["equipment_id"]: m for m in c.get("/api/wip/machines", params={"wip_states": "1"}).json()}
check("API: machine check lists DBM machines only", sorted(machines), [501, 502, 503, 504, 505, 506, 508, 509])
check("API: 504 now fits the R225245 tires", (machines[504]["running_rim"], machines[504]["status"]), ("R225245", "OK"))

# -- DBM_NO_RUNNING_SIZE: equipment 506 appears as NOT SET, then gets a rim
check("API: DBM 506 listed as NOT SET", run[506]["rim_master_status"], "NOT SET")
c.put("/api/fix/running/506", json={"rim_id": 2}, headers=H)
gaps = c.get("/api/gaps").json()
check("API: DBM_NO_RUNNING_SIZE cleared", any(g["check_code"] == "DBM_NO_RUNNING_SIZE" for g in gaps), False)

# -- NG_NO_ACTIVE_RIM: reactivate R24 (508 runs it) fixes material 103
r = c.post("/api/fix/rim/4/activate", headers=H)
check("API: reactivate R24 fixes material 103", (r.status_code, status_of(103)), (200, "OK"))

# -- MSL_DUPLICATE_ROW
dup = next(g for g in c.get("/api/gaps").json() if g["check_code"] == "MSL_DUPLICATE_ROW")
r = c.post("/api/fix/material-rim/dedupe", json={k: dup["fix_ref"][k] for k in ("material_id", "area_id", "rim_size")}, headers=H)
check("API: dedupe removes 1 row", r.json()["message"], "Removed 1 duplicate row(s)")

# -- MSL_NULL_AREA
null_area = next(g for g in c.get("/api/gaps").json() if g["check_code"] == "MSL_NULL_AREA")
r = c.patch(f"/api/fix/material-rim/{null_area['fix_ref']['row_id']}", json={"area_id": 12}, headers=H)
check("API: set area clears MSL_NULL_AREA",
      (r.status_code, any(g["check_code"] == "MSL_NULL_AREA" for g in c.get("/api/gaps").json())), (200, False))

# -- change an existing mapping in place: material 108 R225245 (rim 8) -> R22524 (rim 3)
row = next(m for m in c.get("/api/material/108").json() if m["rim_name"] == "R225245")
r = c.put(f"/api/fix/material-rim/{row['id']}/rim", json={"rim_id": 3}, headers=H)
check("API: change rim in place",
      (r.json()["message"], sorted(m["rim_name"] for m in c.get("/api/material/108").json()), row["id"] in [m["id"] for m in c.get("/api/material/108").json()]),
      ("Material 108: rim R225245 changed to R22524", ["R195225", "R22524"], True))
check("API: change to a rim it already has -> 409",
      c.put(f"/api/fix/material-rim/{row['id']}/rim", json={"rim_id": 2}, headers=H).status_code, 409)
check("API: change to an inactive rim -> 409",
      c.put(f"/api/fix/material-rim/{row['id']}/rim", json={"rim_id": 9}, headers=H).status_code, 409)
check("API: change to a rim of another area -> 409",
      c.put(f"/api/fix/material-rim/{row['id']}/rim", json={"rim_id": 13}, headers=H).status_code, 409)

# -- remove a mapping
row = next(m for m in c.get("/api/material/107").json() if m["rim_name"] == "R17520")
r = c.delete(f"/api/fix/material-rim/{row['id']}", headers=H)
check("API: remove mapping", (r.json()["message"], [m["rim_name"] for m in c.get("/api/material/107").json()]),
      ("Removed rim R17520 from material 107", ["R20225"]))

# -- audit trail
log = c.get("/api/audit").json()
check("API: every write audited", [a["action"] for a in reversed(log)],
      ["map_rim", "set_running_rim", "set_running_rim", "set_running_rim", "set_running_rim",
       "activate_rim", "dedupe", "set_area", "change_rim", "unmap_rim"])
e504 = next(a for a in log if a["row_ref"] == "equipment_id=504")
check("API: audit keeps before/after", (e504["before"]["rim_size"], e504["after"]["rim_size"]), ("2", "8"))

sys.exit(1 if failed else 0)
