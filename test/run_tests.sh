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

R="master.fn_wip_rim_readiness(p_wip_states => '{1}')"

check "WIP readiness per recipe/material (state 1, not yet at DBM)" \
  "SELECT string_agg(material_id || ':' || status || ':' || wip_tires, ' ' ORDER BY material_id) FROM $R" \
  "100:OK:1 101:OK:2 102:NG_NO_ACTIVE_RIM:1 103:NG_NO_ACTIVE_RIM:1 104:NG_NO_EQUIPMENT_RUNNING:1 105:OK:1 106:NG_NO_MATERIAL_SIZE:1 107:WARN_SOME_RIMS_INACTIVE:1 108:OK:1 109:NG_NO_MATERIAL_SIZE:1"

check "Including tires already at DBM" \
  "SELECT wip_tires FROM master.fn_wip_rim_readiness(p_wip_states => '{1}', p_exclude_at_dbm => false) WHERE material_id = 100" \
  "2"

check "Multi-rim material: eligible on every running allowed rim (by rim name)" \
  "SELECT running_rim_sizes::text || ' ' || eligible_equipment::text FROM $R WHERE material_id = 101" \
  "{R195225,R20225} {501,502,504}"

check "Multi-rim material with one inactive rim" \
  "SELECT inactive_rim_sizes::text || ' ' || eligible_equipment::text FROM $R WHERE material_id = 107" \
  "{R17520} {501,502}"

check "Default area is DBM (12) from area_master" "SELECT master.fn_area_id('DBM') || ',' || master.fn_area_id('TUO')" "12,11"

check "TUO-only mapping is not valid for DBM" \
  "SELECT status FROM $R WHERE material_id = 109" "NG_NO_MATERIAL_SIZE"

check "TUO machine is not eligible for DBM tires" \
  "SELECT count(*) FROM $R WHERE 601 = ANY (eligible_equipment) OR 510 = ANY (eligible_equipment)" "0"

check "Validate for TUO area instead" \
  "SELECT status || ' ' || eligible_equipment::text FROM master.fn_wip_rim_readiness(p_wip_states => '{1}', p_area_id => 11) WHERE material_id = 109" \
  "OK {601}"

check "Equipment running None is never eligible" \
  "SELECT count(*) FROM $R WHERE 509 = ANY (eligible_equipment)" "0"

check "WIP rim demand vs running equipment (None left out)" \
  "SELECT string_agg(COALESCE(rim_size,'?') || ':' || status || ':' || wip_tires || '/' || blocked_tires, ' ' ORDER BY rim_size NULLS FIRST)
   FROM master.fn_wip_rim_demand(p_wip_states => '{1}')" \
  "?:NG_UNRESOLVED:4/4 R175195:INFO_NO_WIP:0/0 R195225:OK:3/0 R20225:OK:4/0 R22524:OK:1/0 R225245:NG_NOT_RUNNING:2/1 R24:INFO_NO_WIP:0/0"

check "Master data gap codes" \
  "SELECT string_agg(DISTINCT check_code, ' ') FROM master.fn_rim_master_data_gaps()" \
  "DBM_NO_RUNNING_SIZE FORMAT_DRIFT MSL_DUPLICATE_ROW MSL_MATERIAL_NOT_RUNNABLE MSL_MULTI_RIM MSL_NONE_RIM MSL_NULL_AREA MSL_RIM_INACTIVE MSL_RIM_WRONG_AREA MSL_SIZE_NOT_RUNNING PROD_DUPLICATE_BARCODE PROD_MATERIAL_NO_SIZE PROD_NO_RECIPE RUN_RIM_INACTIVE RUN_RIM_WRONG_AREA"

check "Wrong-area findings" \
  "SELECT string_agg(check_code || ':' || entity_ref, ' ' ORDER BY check_code) FROM master.fn_rim_master_data_gaps() WHERE check_code LIKE '%WRONG_AREA'" \
  "MSL_RIM_WRONG_AREA:id=14 RUN_RIM_WRONG_AREA:equipment_id=510"

check "Inactive rim is ERROR only when no other active rim" \
  "SELECT string_agg(severity || ':' || split_part(detail, ' ', 1), ' ' ORDER BY severity, detail) FROM master.fn_rim_master_data_gaps() WHERE check_code = 'MSL_RIM_INACTIVE'" \
  "ERROR:material_id=102 ERROR:material_id=103 WARN:material_id=107"

check "Same rim name in areas 11 and 12 is not a duplicate" \
  "SELECT count(*) FROM master.fn_rim_master_data_gaps() WHERE check_code = 'RIM_DUPLICATE_NAME'" "0"

check "Barcode OK on matching equipment" \
  "SELECT status FROM master.fn_validate_tire_barcode('T0001', 502)" "OK"
check "Barcode mismatch on other equipment" \
  "SELECT message FROM master.fn_validate_tire_barcode('T0001', 504)" "Tire accepts R20225, equipment running R195225"
check "Multi-rim barcode OK on either rim" \
  "SELECT string_agg(status || ':' || rim_size, ' ') FROM (SELECT * FROM master.fn_validate_tire_barcode('T0003', 504) UNION ALL SELECT * FROM master.fn_validate_tire_barcode('T0003', 501)) x" \
  "OK:R195225 OK:R20225"
check "Multi-rim barcode routing candidates" \
  "SELECT string_agg(equipment_id || '=' || rim_size, ',' ORDER BY equipment_id) FROM master.fn_validate_tire_barcode('T0003')" "501=R20225,502=R20225,504=R195225"
check "TUO-mapped tire at a DBM: no DBM mapping" \
  "SELECT status FROM master.fn_validate_tire_barcode('T0014', 501)" "NG_NO_MATERIAL_SIZE"
check "TUO-mapped tire validated for TUO area" \
  "SELECT status FROM master.fn_validate_tire_barcode('T0014', 601, 11)" "OK"
check "DBM tire at a TUO machine" \
  "SELECT status FROM master.fn_validate_tire_barcode('T0001', 601)" "NG_WRONG_AREA_EQUIPMENT"
check "Barcode on equipment running None" \
  "SELECT status FROM master.fn_validate_tire_barcode('T0001', 509)" "NG_EQUIPMENT_NOT_AVAILABLE"
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

# UniversalRIM: switch 505 to UniversalRIM, check, then switch back
"${PSQL[@]}" -c "UPDATE master.runningsize_lookup SET rim_size = '6' WHERE equipment_id = 505"
check "UniversalRIM equipment takes tires with no running rim" \
  "SELECT status || ' ' || eligible_equipment::text FROM $R WHERE material_id = 104" "OK {505}"
check "UniversalRIM does not fix materials without an active rim" \
  "SELECT status FROM $R WHERE material_id = 102" "NG_NO_ACTIVE_RIM"
check "UniversalRIM barcode check" \
  "SELECT status FROM master.fn_validate_tire_barcode('T0006', 505)" "OK"
check "UniversalRIM row in rim demand" \
  "SELECT status || ':' || wip_tires FROM master.fn_wip_rim_demand(p_wip_states => '{1}') WHERE rim_size = 'UNIVERSALRIM'" "INFO_UNIVERSAL:7"
"${PSQL[@]}" -c "UPDATE master.runningsize_lookup SET rim_size = '5' WHERE equipment_id = 505"

if python3 -c "import fastapi, psycopg, httpx" 2>/dev/null; then
    DATABASE_URL="dbname=$DB" python3 test/test_api.py || fail=1
else
    echo "SKIP  API tests (pip install -r requirements.txt httpx)"
fi

dropdb "$DB"
exit $fail
