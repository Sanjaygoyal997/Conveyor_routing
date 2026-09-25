"""HTTP tests for the ASP.NET Core API (backend/ConveyorRouting.Api). Run by test/run_tests.sh.

Starts two API instances against the throwaway DB: one with writes on (admin token "secret", JWT
required) and one with the default settings (writes off). Only needs the Python standard library.
Usage: API_DLL=<path to ConveyorRouting.Api.dll> DB=<database> python3 test/test_api.py
"""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DLL = os.environ["API_DLL"]
CONN = "Host={};Port={};Database={};Username={};Password={}".format(
    os.environ.get("PGHOST", "localhost"), os.environ.get("PGPORT", "5432"), os.environ["DB"],
    os.environ.get("PGUSER", "postgres"), os.environ.get("PGPASSWORD", ""))
JWT_KEY = "test-key-test-key-test-key-test-key-0123"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_api(**settings):
    port = free_port()
    env = dict(os.environ, ASPNETCORE_URLS=f"http://127.0.0.1:{port}", ASPNETCORE_ENVIRONMENT="Production",
               ConnectionStrings__SmartMes=CONN, JwtSecret__Key=JWT_KEY, Logging__LogLevel__Default="Warning")
    env.update({f"RimValidation__{k}": str(v) for k, v in settings.items()})
    proc = subprocess.Popen(["dotnet", DLL], env=env, cwd=os.path.dirname(DLL),
                            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            urllib.request.urlopen(base + "/api/Auth/getToken", timeout=1)
            return proc, base
        except (urllib.error.URLError, ConnectionError):
            if proc.poll() is not None:
                sys.exit("API failed to start:\n" + proc.stderr.read().decode())
            time.sleep(0.2)
    proc.kill()
    sys.exit("API did not start in time")


class Resp:
    def __init__(self, status, body):
        self.status_code = status
        self.body = body

    def json(self):
        """The OEMResponse Data (or the whole body when it is not an OEMResponse)."""
        return self.body.get("data") if isinstance(self.body, dict) and "statusCode" in self.body else self.body


class Client:
    def __init__(self, base, token=None):
        self.base, self.token = base, token

    def request(self, method, path, params=None, json_body=None, headers=None):
        url = self.base + path + ("?" + urllib.parse.urlencode(params) if params else "")
        h = dict(headers or {})
        if self.token:
            h["Authorization"] = "Bearer " + self.token
        data = None
        if json_body is not None:
            data = json.dumps(json_body).encode()
            h["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                status, raw = r.status, r.read()
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read()
        return Resp(status, json.loads(raw) if raw else None)

    def get(self, path, params=None, headers=None):
        return self.request("GET", path, params=params, headers=headers)

    def post(self, path, json=None, headers=None):
        return self.request("POST", path, json_body=json, headers=headers)

    def put(self, path, json=None, headers=None):
        return self.request("PUT", path, json_body=json, headers=headers)

    def patch(self, path, json=None, headers=None):
        return self.request("PATCH", path, json_body=json, headers=headers)

    def delete(self, path, headers=None):
        return self.request("DELETE", path, headers=headers)


failed = 0


def check(desc, got, expected):
    global failed
    ok = got == expected
    failed += not ok
    print(("PASS  " if ok else "FAIL  ") + desc + ("" if ok else f"\n  expected: {expected}\n  got:      {got}"))


api, BASE = start_api(AllowWrites="true", AdminToken="secret", RequireJwt="true")
ro_api, RO_BASE = start_api()
try:
    anon = Client(BASE)
    check("API: JWT required -> 401 without a token", anon.get("/api/health").status_code, 401)
    token = anon.get("/api/Auth/getToken").json()["token"]
    c = Client(BASE, token)
    r = c.get("/api/health")
    check("API: health wrapped in OEMResponse", (r.status_code, r.body["statusCode"], r.json()["ok"]), (200, 200, True))
    check("API: config", c.get("/api/config").json(),
          {"writes_enabled": True, "token_required": True, "rim_size_value": "rim_id"})
    r = c.get("/api/wip/readiness", params={"wip_states": "1,x"})
    check("API: bad int list -> 422 OEMResponse", (r.status_code, r.body["message"]),
          (422, "wip_states must be a comma-separated list of integers"))
    check("API: hours out of range -> 422", c.get("/api/gaps", params={"hours": 0}).status_code, 422)
    check("API: unknown /api path -> 404", c.get("/api/nope").status_code, 404)

    def status_of(material_id):
        rows = c.get("/api/wip/readiness", params={"wip_states": "1"}).json()
        return next((r["status"] for r in rows if r["material_id"] == material_id), None)

    # -- barcode check
    bc = c.get("/api/barcode/T0001", params={"equipment_id": 504}).json()
    check("API: barcode check", (bc["validation"][0]["status"], len(bc["curing"]) > 0), ("NG_SIZE_MISMATCH", True))
    check("API: blank barcode -> 422", c.get("/api/barcode/%20").status_code, 422)

    H = {"X-User": "tester", "X-Admin-Token": "secret"}
    BODY = {"material_id": 106, "rim_id": 1, "area_id": 12}

    # -- guards
    check("API: no operator name -> 422",
          c.post("/api/fix/material-rim", json=BODY, headers={"X-Admin-Token": "secret"}).status_code, 422)
    check("API: wrong admin token -> 401",
          c.post("/api/fix/material-rim", json=BODY, headers={"X-User": "x", "X-Admin-Token": "bad"}).status_code, 401)
    ro = Client(RO_BASE, token)
    r = ro.post("/api/fix/material-rim", json=BODY, headers=H)
    check("API: writes switched off -> 403", (r.status_code, r.body["message"]),
          (403, "Editing is switched off on this server (set RimValidation:AllowWrites=true)"))

    # rim_master ids (see test/seed.sql): 1 R20225/12, 2 R195225/12, 4 R24/12 (inactive), 6 UniversalRIM/12,
    # 7 None/12, 8 R225245/12, 9 R17520/12 (inactive), 13 R20225/11

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
    dbm_rows = {m["equipment_id"]: m for m in c.get("/api/dbm-machines").json()}
    dbms = {k: m["rim_status"] for k, m in dbm_rows.items()}
    check("API: DBM list = equipment_master DBMs (507 idle, 511 inactive left out) + DBM-rim / balancing machines, no TUO",
          sorted(dbms), [501, 502, 503, 504, 505, 506, 507, 508, 509, 510])
    check("API: DBM list statuses", (dbms[506], dbms[507], dbms[509], dbms[510]), ("NOT SET", "NOT SET", "NOT AVAILABLE", "WRONG AREA"))
    check("API: DBM list names from equipment_master",
          (dbm_rows[501]["equipment_name"], dbm_rows[510]["equipment_name"], dbm_rows[510]["in_master"]), ("DBM-01", None, False))
    eqs = {e["equipment_id"]: e for e in c.get("/api/equipment").json()}
    check("API: equipment names and areas", (eqs[601]["name"], eqs[601]["area_name"], eqs[511]["is_active"]), ("TUO-01", "TUO", False))
    r = c.put("/api/fix/running/601", json={"rim_id": 1}, headers=H)
    check("API: DBM rim on a TUO machine (equipment_master) -> 409", (r.status_code, "TUO machine" in r.body["message"]), (409, True))
    r = c.put("/api/fix/running/507", json={"rim_id": 1}, headers=H)
    check("API: rim on idle DBM 507 from equipment_master", r.json()["message"], "DBM-07 now running rim R20225")

    # -- machine check: after 504 went to R225245 nothing is blocked any more -> no suggestions
    machines = {m["equipment_id"]: m for m in c.get("/api/wip/machines", params={"wip_states": "1"}).json()}
    check("API: machine check lists DBM machines only", sorted(machines), [501, 502, 503, 504, 505, 506, 507, 508, 509])
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
          ["map_rim", "set_running_rim", "set_running_rim", "set_running_rim", "set_running_rim", "set_running_rim",
           "activate_rim", "dedupe", "set_area", "change_rim", "unmap_rim"])
    e504 = next(a for a in log if a["row_ref"] == "equipment_id=504")
    check("API: audit keeps before/after", (e504["before"]["rim_size"], e504["after"]["rim_size"]), ("2", "8"))


finally:
    for p in (api, ro_api):
        p.terminate()
        p.wait(10)

sys.exit(1 if failed else 0)
