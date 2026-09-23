#!/usr/bin/env bash
# Builds a throwaway database, loads sql/*.sql and checks the expected results.
# Usage: test/run_tests.sh   (needs a local PostgreSQL; PG* env vars respected)
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-rim_validation_test}

dropdb --if-exists "$DB" && createdb "$DB"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")
"${PSQL[@]}" -f test/schema.sql -f test/seed.sql
for f in sql/*.sql; do "${PSQL[@]}" -f "$f"; done

fail=0
check() {  # check <description> <sql returning text> <expected>
    local got
    got=$("${PSQL[@]}" -tA -c "$2")
    if [[ "$got" == "$3" ]]; then echo "PASS  $1"; else echo "FAIL  $1"; echo "  expected: $3"; echo "  got:      $got"; fail=1; fi
}

check "WIP readiness per recipe/material (state 1, not yet at DBM)" \
  "SELECT string_agg(material_id || ':' || status || ':' || wip_tires, ' ' ORDER BY material_id)
   FROM master.fn_wip_rim_readiness(p_wip_states => '{1}')" \
  "100:OK:1 101:OK:2 102:NG_NO_ACTIVE_RIM:1 103:NG_NO_ACTIVE_RIM:1 104:NG_NO_EQUIPMENT_RUNNING:1 105:OK:1 106:NG_NO_MATERIAL_SIZE:1 107:WARN_SOME_RIMS_INVALID:1 108:OK:1"

check "Including tires already at DBM" \
  "SELECT wip_tires FROM master.fn_wip_rim_readiness(p_wip_states => '{1}', p_exclude_at_dbm => false) WHERE material_id = 100" \
  "2"

check "Multi-rim material: eligible on every running allowed rim" \
  "SELECT running_rim_sizes::text || ' ' || eligible_equipment::text FROM master.fn_wip_rim_readiness(p_wip_states => '{1}') WHERE material_id = 101" \
  "{15,16} {501,502,504}"

check "Multi-rim material with one inactive rim" \
  "SELECT invalid_rim_sizes::text || ' ' || eligible_equipment::text FROM master.fn_wip_rim_readiness(p_wip_states => '{1}') WHERE material_id = 107" \
  "{17} {501,502}"

check "WIP rim demand vs running equipment" \
  "SELECT string_agg(COALESCE(rim_size,'?') || ':' || status || ':' || wip_tires || '/' || blocked_tires, ' ' ORDER BY rim_size NULLS FIRST)
   FROM master.fn_wip_rim_demand(p_wip_states => '{1}')" \
  "?:NG_UNRESOLVED:3/3 15:OK:4/0 16:OK:3/0 18:OK:1/0 19:NG_NOT_RUNNING:2/1 21:INFO_NO_WIP:0/0"

check "Master data gap codes" \
  "SELECT string_agg(DISTINCT check_code, ' ') FROM master.fn_rim_master_data_gaps()" \
  "DBM_NO_RUNNING_SIZE FORMAT_DRIFT MSL_DUPLICATE_ROW MSL_MATERIAL_NOT_RUNNABLE MSL_MULTI_RIM MSL_NULL_AREA MSL_RIM_INACTIVE MSL_RIM_MISSING MSL_SIZE_NOT_RUNNING PROD_DUPLICATE_BARCODE PROD_MATERIAL_NO_SIZE PROD_NO_RECIPE RUN_RIM_MISSING"

check "Inactive rim is ERROR only when no other active rim" \
  "SELECT string_agg(severity || ':' || split_part(detail, ' ', 1), ' ' ORDER BY severity) FROM master.fn_rim_master_data_gaps() WHERE check_code = 'MSL_RIM_INACTIVE'" \
  "ERROR:material_id=102 WARN:material_id=107"

check "Barcode OK on matching equipment" \
  "SELECT status FROM master.fn_validate_tire_barcode('T0001', 502)" "OK"
check "Barcode mismatch on other equipment" \
  "SELECT message FROM master.fn_validate_tire_barcode('T0001', 504)" "Tire accepts 15, equipment running 16"
check "Multi-rim barcode OK on either rim" \
  "SELECT string_agg(status || ':' || rim_size, ' ') FROM (SELECT * FROM master.fn_validate_tire_barcode('T0003', 504) UNION ALL SELECT * FROM master.fn_validate_tire_barcode('T0003', 501)) x" \
  "OK:16 OK:15"
check "Multi-rim barcode routing candidates" \
  "SELECT string_agg(equipment_id || '=' || rim_size, ',' ORDER BY equipment_id) FROM master.fn_validate_tire_barcode('T0003')" "501=15,502=15,504=16"
check "No active rim" \
  "SELECT status FROM master.fn_validate_tire_barcode('T0004')" "NG_NO_ACTIVE_RIM"
check "Barcode routing candidates" \
  "SELECT string_agg(equipment_id::text, ',') FROM master.fn_validate_tire_barcode(' T0007 ')" "503"
check "Duplicate barcode" \
  "SELECT status FROM master.fn_validate_tire_barcode('T0010')" "NG_DUPLICATE_BARCODE"
check "Unknown barcode" \
  "SELECT status FROM master.fn_validate_tire_barcode('NOPE')" "NG_BARCODE_NOT_FOUND"
check "Quality hold" \
  "SELECT status FROM master.fn_validate_tire_barcode('T0009', 501, NULL, '{1}')" "NG_QUALITY_HOLD"

dropdb "$DB"
exit $fail
