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

Load `sql/*.sql` into the database first. The UI only reads data: every query runs in a read-only transaction.

| Tab | What it shows |
|---|---|
| **Validate** button + summary | WIP tires, recipe/material groups, groups with issues, blocked tires, rim sizes not running, master-data errors |
| WIP recipes | `fn_wip_rim_readiness`: one row per recipe + material in WIP |
| Rim sizes | `fn_wip_rim_demand`: WIP demand per rim size vs equipment running it |
| Master data gaps | `fn_rim_master_data_gaps`: ERROR / WARN / INFO findings |
| Barcode check | Scan a barcode, optionally with a target equipment. Shows the result plus its curing and DBM history |
| Running sizes | `runningsize_lookup`, with each size's status in `rim_master` |

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

Rim sizes are compared after `UPPER(BTRIM())` (`master.fn_rim_key`), so `"15 "` matches `"15"`.

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

Load in file order. `01_indexes.sql` uses `CREATE INDEX CONCURRENTLY`, so run it outside a transaction.

## Usage

```sql
-- WIP (last 2 days, not yet at DBM). Replace {1} with your WIP state codes (NULL = all records).
SELECT * FROM master.fn_wip_rim_readiness(p_wip_states => '{1}');
SELECT * FROM master.fn_wip_rim_demand(p_wip_states => '{1}');

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

### Status codes

| Status | Meaning | Fix |
|---|---|---|
| `NG_NO_MATERIAL_SIZE` | Material has no row in `material_size_lookup` | Add the mapping |
| `NG_NO_ACTIVE_RIM` | None of the material's allowed rims is active in `rim_master` | Add or activate the rim in `rim_master` |
| `NG_NO_EQUIPMENT_RUNNING` | No equipment runs any of the material's active allowed rims | Change over equipment, or fix `runningsize_lookup` |
| `WARN_SOME_RIMS_INVALID` | Routable, but some allowed rims are missing or inactive in `rim_master` | Clean up the mapping |
| `NG_NOT_RUNNING` (rim sizes) | Rim not running, and some tires that accept it have no other running rim | Change over equipment to this rim |
| `INFO_NOT_RUNNING` (rim sizes) | Rim not running, but every tire that accepts it can use another rim that is running | None needed |
| `NG_UNRESOLVED` (rim sizes) | WIP tires with no active rim at all | See the rows above in `fn_wip_rim_readiness` |
| `INFO_NO_WIP` | Equipment is running a rim that no WIP accepts | Candidate for a changeover |
| `NG_SIZE_MISMATCH` (barcode) | The target equipment's rim is not one of the tire's allowed rims | Route the tire to another machine |

In the gap report, a missing or inactive rim is an **ERROR** only when the material has no other
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
```
