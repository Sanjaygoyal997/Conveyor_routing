# Tire rim-size validation

SQL and a web UI for checking that every tire can be routed to equipment running the correct rim size.
It works in two ways:

- **In advance, on WIP between Curing and DBM:** checks each material in WIP, and the master data it relies on.
- **At scan time:** checks a single barcode.

**Routing rule (conveyor):** a scanned tire's `material_id` gives its allowed rims (`material_size_lookup`,
DBM area). The conveyor may send it to any DBM whose running rim (`runningsize_lookup`) is one of them, and
traffic decides which one. When no DBM fits, the tire goes to the **exit conveyor**. This tool runs the same
rule in advance on the WIP, so gaps are fixed before tires reach the exit conveyor. Changes made here update
the same tables the conveyor reads, so they apply to the next scanned tire.

**WIP** means tires cured in the last 2 days (`curing.o_production`) whose barcode is not yet in
`dbm.o_production`. `dbm.o_production.barcode` equals `curing.o_production.production_id` (confirmed by the plant).

## Web UI

The UI is a **React** app (`frontend/`, Vite) served by an **ASP.NET Core** API (`backend/ConveyorRouting.Api`).
The API follows the conventions of SmartMES_ReportAPI:
- the same platform (`net5.0`, Npgsql, Newtonsoft, Swagger)
- Controllers → Services → Repositories, with interfaces under `Interfaces/`
- `IDbOperations`
- the `OEMResponse {statusCode, data, message, error}` envelope
- JWT from `/api/Auth/getToken` using the same `JwtSecret:Key`
- the `AllowOrigin` CORS policy

```
backend/ConveyorRouting.Api/
  Controllers/    RimValidationController (reads), RimFixController (fixes), AuthController (getToken)
  Services/       RimValidationService, RimFixService (write guard), ServiceCall (-> OEMResponse)
  Repositories/   RimValidationRepository (calls master.fn_*), RimFixRepository (one transaction + audit row per fix)
  Data/           DbOperations (Npgsql; reads in READ ONLY transactions), Sql (typed parameters)
  Interfaces/     ICommon / IRepository / IServices
  wwwroot/        React build output (npm run build), served with a fallback to index.html
frontend/src/
  App.jsx         filters, summary, tabs, write/confirm flow
  components/     QuickFix, DataTable, FixDialogs (material / equipment / rim), BarcodeCheck, AuditLog, Dialogs
  tables.jsx      columns and Fix… buttons per tab
```

### Build and deploy

```bash
# 1. database: load sql/*.sql (05_audit.sql creates master.rim_validation_audit)
# 2. UI -> backend/ConveyorRouting.Api/wwwroot
cd frontend && npm ci && npm run build
# 3. API (+ UI), same hosting as SmartMES_ReportAPI (ASP.NET Core 5 runtime / IIS hosting bundle)
cd ../backend/ConveyorRouting.Api && dotnet publish -c Release -o ../../publish
#    on .NET 8 (LTS) instead:        dotnet publish -c Release -p:Tfm=net8.0 -o ../../publish
```

### Hosting on IIS

**Option A: separate IIS site for the UI** (like the SmartMES frontends)

1. **Build the UI:** `cd frontend && npm ci && npm run build:iis`. This creates `frontend/dist/`: `index.html`, `assets/`, `config.js` and `web.config`.
2. **Create the site:** in IIS Manager, add a website (e.g. port 8083) or an application under an existing site (e.g. `/rimvalidation`). Point it at a folder, and copy the contents of `dist/` into it. It is plain static files, so the app pool can be *No Managed Code*, and no extra IIS modules are needed.
3. **Point the UI at the API:** edit `config.js` in that folder and set `apiBase: "http://<api-server>:<port>"`. You don't need to rebuild; refresh the browser.
4. **Allow the UI's address on the API:** add it to `Cors:Origins` in the API's `appsettings.json` (e.g. `"http://10.200.233.14:8083"`), then restart the API.

Use the same scheme for both. A UI on `https` can't call an API on `http`, because the browser blocks it.

**Option B: one IIS site for API and UI.** Run `npm run build`, then `dotnet publish`. The API serves the UI from `wwwroot`, and `config.js` keeps `apiBase: ""`. Nothing to set for CORS.

**API on IIS (both options):** host it like SmartMES_ReportAPI: install the ASP.NET Core Hosting Bundle (5.0, or 8.0 if published with `-p:Tfm=net8.0`) and use an app pool with *No Managed Code*. The API's `web.config` turns WebDAV off for this site, because IIS WebDAV answers PUT / PATCH / DELETE with *405 Method Not Allowed* and the fix buttons use them. If you see 405 on a fix, check that this `web.config` was deployed.

Updating the UI: copy the new `index.html` and `assets/` over the old ones, and **keep your edited `config.js`**. `index.html` and `config.js` are sent with no-cache headers, so users get the new version on their next page load.

Development: run the API (`dotnet run` in `backend/ConveyorRouting.Api`, http://localhost:5080) and the UI
(`npm run dev` in `frontend`, http://localhost:3000). Vite forwards `/api` to the API. Swagger is at `/swagger`.

### Settings (`appsettings.json`, or environment variables such as `RimValidation__AllowWrites=true`)

| Setting | Default | Meaning |
|---|---|---|
| `ConnectionStrings:SmartMes` | – | PostgreSQL connection string. Don't commit the real password; set it on the server |
| `JwtSecret:Key` | – | Same key as SmartMES_ReportAPI (32+ characters), so tokens from either API work |
| `RimValidation:RequireJwt` | `true` | Require a JWT on every `/api` call (the UI gets one from `/api/Auth/getToken`) |
| `RimValidation:AllowWrites` | `false` | `true` lets the **Fix…** dialogs change master data (otherwise they are view-only) |
| `RimValidation:AdminToken` | *(empty)* | If set, every change must send this token (the UI asks for it once per browser session) |
| `RimValidation:RimSizeValue` | `rim_id` | What is written into `rim_size` columns: `rim_master.rim_id`, or `name` |
| `RimValidation:StatementTimeoutSeconds` | `60` | Timeout per SQL statement |
| `Cors:Origins` | `http://localhost:3000` | Origins allowed to call the API from another host |

`/api/Auth/getToken` works the same way as in SmartMES_ReportAPI: it gives a token to anyone who can reach the API.
So the JWT doesn't make the API safe on its own. Changes are also protected by `AllowWrites`, the operator
name, the optional admin token, and the audit log.

Every change asks for the operator's name and a confirmation. The confirmation for a changeover lists
the WIP tires it would unblock or block. Each change runs in one transaction together with a row in
`master.rim_validation_audit` (who, when, before/after), shown in the **Change log** tab.
Only rims that are active in `rim_master` can be picked.

### Fix actions per case

| Case | Fix… opens | Changes available |
|---|---|---|
| `NG_NO_MATERIAL_SIZE`, `PROD_MATERIAL_NO_SIZE` | Material | Add an allowed rim (`material_size_lookup` insert) |
| Any material rim (Quick fix) | Material rims | Change a mapped rim to another active rim of the same area (`material_size_lookup` update, audited as `change_rim`) |
| `NG_NO_ACTIVE_RIM`, `WARN_SOME_RIMS_INACTIVE`, `MSL_RIM_INACTIVE` | Material | Reactivate the rim (`rim_master.isactive`), remove the mapping, or add another rim |
| `NG_NO_EQUIPMENT_RUNNING`, `MSL_MATERIAL_NOT_RUNNABLE` | Material | Change over a DBM to one of the material's rims, or add a rim that is running |
| `NG_NOT_RUNNING`, `INFO_NOT_RUNNING`, `INFO_NO_WIP`, `MSL_SIZE_NOT_RUNNING` | Rim | Change over equipment to this rim; open the affected materials or equipment |
| `NG_UNRESOLVED` | Material (one button per material) | As above |
| `RUN_RIM_INACTIVE`, `RUN_BLANK_RIM`, `DBM_NO_RUNNING_SIZE`, Running sizes tab | Equipment | Set the running rim (`runningsize_lookup` upsert) |
| `MSL_DUPLICATE_ROW` | Confirm | Keep the oldest row, delete the duplicates |
| `MSL_NULL_AREA` | Material | Set the area on the mapping |
| `MSL_NONE_RIM` | Material | Remove the `None` mapping and add a real rim |
| `MSL_RIM_WRONG_AREA` | Material | Remove the mapping and add the rim of the right area |
| `RUN_RIM_WRONG_AREA` | Equipment | Set a rim of the DBM area |
| `PROD_*` (production records), `RIM_*`, `FORMAT_DRIFT` | – | Not editable here: fix these in the source system |

| Tab | What it shows |
|---|---|
| **Quick fix** (opens first) | Two simple forms. **DBM rim**: 1. select the DBM, 2. select the rim fitted on it, see how many WIP tires it frees or blocks, then save. The list holds every DBM (DBM-rim machines in `runningsize_lookup` plus every machine that balanced tires in the last 30 days, even without a rim), and **Other DBM** lets you type a new one. Under the form, an **All DBMs** table shows every DBM's current rim, status and the WIP tires that fit. The DBM being edited is highlighted with the pending change (`R20225 → R225245`), and clicking a row selects it. **Material rims**: pick a material, see its allowed rims, **change** one to another rim (the mapping row is updated in place), add one from a dropdown, or remove one. Under it, a **Materials in WIP** table lists every material in the current WIP selection (the look-back window and filters, 2 days by default) with WIP tires, current rims (inactive ones struck through), status and eligible DBMs. The selected material shows the pending rim (`+ R20225`), and clicking a row selects it. Suggested changeovers are buttons that fill in the form. The Fix… buttons on materials and machines open this tab with the row selected. |
| **Validate** button + summary | WIP tires, materials in WIP, materials with issues, blocked tires, rim sizes not running, master-data errors |
| WIP materials | `fn_wip_rim_readiness`: one row per material in WIP |
| Machines | `fn_machine_rim_check`: per machine, the WIP tires it can take, tires that can only go there, and a suggested changeover (**Apply** button) |
| Rim sizes | `fn_wip_rim_demand`: WIP demand per rim size vs equipment running it |
| Master data gaps | `fn_rim_master_data_gaps`: ERROR / WARN / INFO findings |
| Barcode check | Scan a barcode, optionally with a target equipment. Shows the result plus its curing and DBM history |
| Running sizes | `runningsize_lookup`, with each size's status in `rim_master` |
| Change log | Every fix made from the UI: who, when, what changed |

Each table has a text filter, an issues-only toggle, sortable columns and CSV export.
Options: look-back window, WIP `state` codes, OK `quality_status` codes, area, and whether to include tires already at DBM.

## Data flow

```
Tire barcode (scanned) = curing.o_production.production_id
   -> o_production.material_id
   -> master.material_size_lookup (material_id, area_id) -> required rim_size
         must be ACTIVE in master.rim_master (name or rim_id)
   -> master.runningsize_lookup (equipment_id) -> running rim_size
         = equipment the tire is routed to (PCI / uniformity / final-finish lane)
```

### Rim model

- **Identity: material.** WIP is grouped by `curing.o_production.material_id`, and rims are mapped per
  material in `material_size_lookup`. `recipe_id` is not used.

- **`rim_size` stores `rim_master.rim_id`.** `rim_master` has one row per rim per area, so rim_id 1
  (`R20225`, area 12) and rim_id 13 (`R20225`, area 11) are the same rim. Rims are compared by **name**
  (`master.fn_rim_name`). Active or inactive is checked on the exact `rim_id` (`master.fn_rim_status`).
- **Area = machine type** (`master.area_master`: 11 = TUO, 12 = DBM). Validation is done for one area,
  **DBM by default** (`master.fn_area_id('DBM')`). Only mappings with that `area_id` count, and only
  equipment running a rim of that area is eligible. Pass `p_area_id => master.fn_area_id('TUO')`
  (or pick TUO in the UI) to validate for TUO. `MSL_RIM_WRONG_AREA` flags a mapping whose rim belongs
  to another area. `RUN_RIM_WRONG_AREA` flags a DBM machine running a rim of another area.
- **`UniversalRIM`:** equipment running it can take **any** tire whose material has an active rim.
- **`None`:** equipment running it is **not available** and takes no tires. This isn't an error.
  A material mapped to `None` is flagged `MSL_NONE_RIM`, and the UI won't map `None` to a material.

**A material can accept more than one rim size.** Every row in `material_size_lookup` for a
material/area is an allowed rim. A tire passes when the equipment runs **any** of its allowed
rims that is active in `rim_master`.

## Objects

| File | Object | Use |
|---|---|---|
| `sql/00_helpers.sql` | `fn_rim_key`, `fn_rim_status` | Normalise rim sizes and look them up in `rim_master` |
| `sql/01_indexes.sql` | index on `o_production(production_id)` | Barcode lookups; `production_id` has no index today |
| `sql/02_fn_wip_rim_readiness.sql` | `fn_wip_rim_readiness(...)` | **WIP check per material**: tire count, allowed rims, rim status, eligible equipment |
| | `fn_wip_rim_demand(...)` | **WIP check per rim size**: tires needing each rim vs the equipment running it |
| `sql/03_fn_rim_master_data_gaps.sql` | `fn_rim_master_data_gaps(...)` | Full master-data gap report (ERROR / WARN / INFO) |
| `sql/04_fn_validate_tire_barcode.sql` | `fn_validate_tire_barcode(...)` | Scan-time check of one barcode |
| `sql/05_audit.sql` | `master.rim_validation_audit` | Log of every fix made from the UI |
| `sql/06_fn_machine_rim_check.sql` | `fn_machine_rim_check(...)` | **Machine check**: each machine's running rim against the WIP, with suggested changeovers |

Load in file order. `01_indexes.sql` uses `CREATE INDEX CONCURRENTLY`, so run it outside a transaction.

## Usage

```sql
-- WIP (last 2 days, not yet at DBM). Replace {1} with your WIP state codes (NULL = all records).
SELECT * FROM master.fn_wip_rim_readiness(p_wip_states => '{1}');
SELECT * FROM master.fn_wip_rim_demand(p_wip_states => '{1}');
SELECT * FROM master.fn_machine_rim_check(p_wip_states => '{1}');   -- running rim per machine vs WIP

-- Custom window, OK quality codes only, one area
SELECT * FROM master.fn_wip_rim_readiness(
    p_from => now()::timestamp - interval '8 hours', p_to => now()::timestamp,
    p_wip_states => '{1}', p_ok_quality => '{1}', p_area_id => 1);

-- Master-data gaps (production and DBM checks use the last 2 days by default)
SELECT * FROM master.fn_rim_master_data_gaps() WHERE severity = 'ERROR';

-- Scan time
SELECT * FROM master.fn_validate_tire_barcode('T0001', 502);  -- check for one equipment
SELECT * FROM master.fn_validate_tire_barcode('T0001');       -- list eligible equipment
```

### Machine check (running rim vs WIP)

For every machine of the area (DBM by default): the machines running a rim of that area, plus DBM
machines seen in `dbm.o_production` with no running rim.

| Status | Meaning |
|---|---|
| `OK` | Rim active and WIP tires fit it |
| `INFO_NO_WIP` | Rim active but no WIP tire fits: idle |
| `INFO_NOT_AVAILABLE` | Running `None` |
| `NG_NO_RUNNING_RIM` | DBM machine with no running rim |
| `NG_RIM_INACTIVE` | Running rim is inactive in `rim_master` |
| `NG_CHANGEOVER_NEEDED` | Idle while WIP tires are blocked; a changeover is suggested |
| `WARN_CHANGEOVER_SUGGESTED` | Has WIP, but a changeover would unblock more tires than it blocks |

A suggestion picks the active rim of the area that **unblocks** the most WIP tires (tires with an active
rim but no eligible machine), minus the tires it would **block** (tires that can only go to this machine).
It is made only when that net gain is positive. Only one machine is suggested per rim: machines with no rim
or an inactive rim come first, then the machine with the fewest WIP tires that fit. Validate again after
each changeover.

### Status codes

| Status | Meaning | Fix |
|---|---|---|
| `NG_NO_MATERIAL_SIZE` | Material has no row in `material_size_lookup` | Add the mapping |
| `NG_NO_ACTIVE_RIM` | Every allowed rim of the material has been made inactive in `rim_master` | Reactivate the rim, or map an active one |
| `NG_NO_EQUIPMENT_RUNNING` | No equipment runs any of the material's active allowed rims | Change over equipment, or fix `runningsize_lookup` |
| `WARN_SOME_RIMS_INACTIVE` | Routable, but some allowed rims are inactive in `rim_master` | Remove or reactivate those rims |
| `NG_NOT_RUNNING` (rim sizes) | Rim not running, and some tires that accept it have no other running rim | Change over equipment to this rim |
| `INFO_NOT_RUNNING` (rim sizes) | Rim not running, but every tire that accepts it can use another rim that is running | None needed |
| `NG_UNRESOLVED` (rim sizes) | WIP tires with no active rim at all | See the rows above in `fn_wip_rim_readiness` |
| `INFO_NO_WIP` | Equipment is running a rim that no WIP accepts | Candidate for a changeover |
| `NG_SIZE_MISMATCH` (barcode) | The target equipment's rim is not one of the tire's allowed rims | Route the tire to another machine |
| `NG_EQUIPMENT_NOT_AVAILABLE` (barcode) | The target equipment is running `None` | Route the tire to another machine |
| `NG_WRONG_AREA_EQUIPMENT` (barcode) | The target equipment runs a rim of another area (e.g. a TUO machine) | Pick equipment of this area |
| `INFO_UNIVERSAL` (rim sizes) | Equipment running `UniversalRIM`; the count is the WIP tires it can take | None needed |

Rim sizes are always created in `rim_master` before they can be mapped, so a rim can't be missing from it;
the only case checked is a rim made **inactive** after it was mapped.

In the gap report, an inactive rim is an **ERROR** only when the material has no other
active rim; otherwise it is a **WARN**. `MSL_MULTI_RIM` (INFO) lists materials that accept several rims.

## Assumptions / open points

- WIP = the latest record per `production_id` in the time window, excluding barcodes already in
  `dbm.o_production` (turn this off with `p_exclude_at_dbm => false`). `state` / `quality_status` are filtered only by the codes you pass in.
- `DBM_NO_RUNNING_SIZE` flags DBM equipment that balanced tires in the window but has no row in `runningsize_lookup`.
- There is no equipment-to-area table yet, so equipment isn't filtered by area.
- `runningsize_lookup.spare` is ignored.

## Tests

```bash
test/run_tests.sh   # needs a local PostgreSQL; creates and drops a throwaway DB
                    # when dotnet is installed it also builds the API and runs test/test_api.py:
                    # HTTP tests of every endpoint, JWT, the write guards and the audit log
                    # (the API is built for net8.0 by default; API_TFM=net5.0 needs the .NET 5 runtime)
```
