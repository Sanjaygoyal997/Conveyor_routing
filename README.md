# Tire rim-size validation

SQL and a web UI for checking that every tire can be routed to equipment running the correct rim size.
It works in two ways:

- **In advance, on WIP between Curing and DBM:** checks each recipe/material in WIP, and the master data it relies on.
- **At scan time:** checks a single barcode.

**WIP** means tires cured in the last 2 days (`curing.o_production`) whose barcode is not yet in
`dbm.o_production`. It assumes `dbm.o_production.barcode` equals `curing.o_production.production_id`.

## Web UI

```bash
pip install -r requirements.txt
export DATABASE_URL="postgresql://user:password@dbhost:5432/dbname"   # or PGHOST/PGUSER/...
uvicorn app.main:app --host 0.0.0.0 --port 8000
# open http://<server>:8000
```

Load `sql/*.sql` into the database first (`05_audit.sql` creates `master.rim_validation_audit`).
Validation queries run in read-only transactions. Fixes are **off unless you switch them on**:

| Env var | Default | Meaning |
|---|---|---|
| `ALLOW_WRITES` | `false` | `true` lets the **Fix…** dialogs change master data (otherwise they are view-only) |
| `ADMIN_TOKEN` | *(unset)* | If set, every change must send this token (the UI asks for it once per browser session) |
| `RIM_SIZE_VALUE` | `rim_id` | What is written into `rim_size` columns: `rim_master.rim_id`, or `name` |

Every change asks for the operator's name and a confirmation. The confirmation for a changeover lists
the WIP tires it would unblock or block. Each change runs in one transaction together with a row in
`master.rim_validation_audit` (who, when, before/after), shown in the **Change log** tab.
Only rims that are active in `rim_master` can be picked.

### Fix actions per case

| Case | Fix… opens | Changes available |
|---|---|---|
| `NG_NO_MATERIAL_SIZE`, `PROD_MATERIAL_NO_SIZE` | Material | Add an allowed rim (`material_size_lookup` insert) |
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
| **Quick fix** (opens first) | Two simple forms. **DBM rim**: 1. select the DBM, 2. select the rim fitted on it, see how many WIP tires it frees or blocks, then save. The list holds every DBM (DBM-rim machines in `runningsize_lookup` plus every machine that balanced tires in the last 30 days, even without a rim), and **Other DBM** lets you type a new one. **Recipe rims**: pick a recipe (issues first), see its allowed rims, add one from a dropdown or remove one. Suggested changeovers are buttons that fill in the form. The Fix… buttons on recipes and machines open this tab with the row selected. |
| **Validate** button + summary | WIP tires, recipe/material groups, groups with issues, blocked tires, rim sizes not running, master-data errors |
| WIP recipes | `fn_wip_rim_readiness`: one row per recipe + material in WIP |
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
| `sql/02_fn_wip_rim_readiness.sql` | `fn_wip_rim_readiness(...)` | **WIP check per recipe + material**: tire count, required rim, rim status, eligible equipment |
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
                    # also runs test/test_api.py (fix endpoints) when fastapi, psycopg and httpx are installed
```
