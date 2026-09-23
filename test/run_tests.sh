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

check "WIP readiness per recipe/material (state 1 = WIP)" \
  "SELECT string_agg(material_id || ':' || status || ':' || wip_tires, ' ' ORDER BY material_id)
   FROM master.fn_wip_rim_readiness(p_wip_states => '{1}')" \
  "100:OK:2 101:NG_AMBIGUOUS_SIZE:2 102:NG_RIM_INACTIVE:1 103:NG_RIM_NOT_IN_MASTER:1 104:NG_NO_EQUIPMENT_RUNNING:1 105:OK:1 106:NG_NO_MATERIAL_SIZE:1"

check "Eligible equipment for material 100" \
  "SELECT eligible_equipment FROM master.fn_wip_rim_readiness(p_wip_states => '{1}') WHERE material_id = 100" \
  "{501,502}"

check "WIP rim demand vs running equipment" \
  "SELECT string_agg(COALESCE(rim_size,'?') || ':' || status || ':' || wip_tires, ' ' ORDER BY rim_size NULLS FIRST)
   FROM master.fn_wip_rim_demand(p_wip_states => '{1}')" \
  "?:NG_UNRESOLVED:3 15:OK:2 16:INFO_NO_WIP:0 17:NG_NOT_RUNNING:1 18:OK:1 19:NG_NOT_RUNNING:1 20:NG_NOT_RUNNING:1 21:INFO_NO_WIP:0"

check "Master data gap codes" \
  "SELECT string_agg(DISTINCT check_code, ' ') FROM master.fn_rim_master_data_gaps()" \
  "FORMAT_DRIFT MSL_CONFLICTING_SIZE MSL_DUPLICATE_ROW MSL_NULL_AREA MSL_RIM_INACTIVE MSL_RIM_MISSING MSL_SIZE_NOT_RUNNING PROD_DUPLICATE_BARCODE PROD_MATERIAL_NO_SIZE PROD_NO_RECIPE RUN_RIM_MISSING"

check "Barcode OK on matching equipment" \
  "SELECT status FROM master.fn_validate_tire_barcode('T0001', 502)" "OK"
check "Barcode mismatch on other equipment" \
  "SELECT message FROM master.fn_validate_tire_barcode('T0001', 504)" "Tire needs 15, equipment running 16"
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
