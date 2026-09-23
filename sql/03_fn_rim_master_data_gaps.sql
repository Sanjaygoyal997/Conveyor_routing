-- Master-data gap report for rim-size routing. One row per finding.
--   severity: ERROR (tires will fail validation) / WARN (risky data) / INFO
-- Production checks (PROD_*) only look at curing.o_production in [p_from, p_to).
CREATE OR REPLACE FUNCTION master.fn_rim_master_data_gaps(
    p_from     timestamp DEFAULT (now() - interval '7 days')::timestamp,
    p_to       timestamp DEFAULT now()::timestamp,
    p_area_id  int       DEFAULT NULL)
RETURNS TABLE(severity text, check_code text, entity text, entity_ref text, detail text)
LANGUAGE sql STABLE AS $$
WITH msl AS (
    SELECT m.*, master.fn_rim_key(m.rim_size) AS rim_key
    FROM   master.material_size_lookup m
    WHERE  p_area_id IS NULL OR m.area_id = p_area_id OR m.area_id IS NULL
),
run AS (
    SELECT r.*, master.fn_rim_key(r.rim_size) AS rim_key
    FROM   master.runningsize_lookup r
),
prod AS (
    SELECT o.production_id, o.recipe_id, o.material_id, o.equipment_id, o.dtandtime
    FROM   curing.o_production o
    WHERE  o.dtandtime >= p_from AND o.dtandtime < p_to
),
findings AS (
    -- material_size_lookup ---------------------------------------------------
    SELECT 'ERROR', 'MSL_CONFLICTING_SIZE', 'material_size_lookup',
           'material_id=' || material_id || ', area_id=' || COALESCE(area_id::text, 'NULL'),
           'Rim sizes: ' || string_agg(DISTINCT rim_key, ',')
    FROM   msl GROUP BY material_id, area_id
    HAVING count(DISTINCT rim_key) > 1

    UNION ALL
    SELECT 'WARN', 'MSL_DUPLICATE_ROW', 'material_size_lookup',
           'material_id=' || material_id || ', area_id=' || COALESCE(area_id::text, 'NULL'),
           count(*) || ' rows for rim ' || rim_key || ' (ids ' || string_agg(id::text, ',' ORDER BY id) || ')'
    FROM   msl GROUP BY material_id, area_id, rim_key
    HAVING count(*) > 1

    UNION ALL
    SELECT 'ERROR', 'MSL_BLANK_RIM', 'material_size_lookup', 'id=' || id,
           'material_id=' || material_id || ' has blank rim_size'
    FROM   msl WHERE rim_key IS NULL

    UNION ALL
    SELECT 'WARN', 'MSL_NULL_AREA', 'material_size_lookup', 'id=' || id,
           'material_id=' || material_id || ' has no area_id'
    FROM   msl WHERE area_id IS NULL

    UNION ALL
    SELECT 'ERROR', 'MSL_RIM_' || st, 'material_size_lookup', 'id=' || id,
           'material_id=' || material_id || ' rim ' || rim_key || ' is ' || lower(st) || ' in rim_master'
    FROM  (SELECT msl.*, master.fn_rim_status(rim_key, area_id) AS st FROM msl WHERE rim_key IS NOT NULL) x
    WHERE  st <> 'ACTIVE'

    UNION ALL
    SELECT 'WARN', 'MSL_SIZE_NOT_RUNNING', 'material_size_lookup', 'rim=' || m.rim_key,
           count(DISTINCT m.material_id) || ' material(s) need rim ' || m.rim_key || ' but no equipment is running it'
    FROM   msl m
    WHERE  m.rim_key IS NOT NULL
      AND  NOT EXISTS (SELECT 1 FROM run r WHERE r.rim_key = m.rim_key)
    GROUP  BY m.rim_key

    -- runningsize_lookup -----------------------------------------------------
    UNION ALL
    SELECT 'ERROR', 'RUN_BLANK_RIM', 'runningsize_lookup', 'equipment_id=' || equipment_id,
           'Equipment has blank running rim_size'
    FROM   run WHERE rim_key IS NULL

    UNION ALL
    SELECT 'ERROR', 'RUN_RIM_' || st, 'runningsize_lookup', 'equipment_id=' || equipment_id,
           'Running rim ' || rim_key || ' is ' || lower(st) || ' in rim_master'
    FROM  (SELECT run.*, master.fn_rim_status(rim_key, p_area_id) AS st FROM run WHERE rim_key IS NOT NULL) x
    WHERE  st <> 'ACTIVE'

    -- rim_master -------------------------------------------------------------
    UNION ALL
    SELECT 'WARN', 'RIM_DUPLICATE_NAME', 'rim_master',
           'area_id=' || COALESCE(local_area_id::text, 'NULL') || ', name=' || master.fn_rim_key(name),
           'rim_ids ' || string_agg(rim_id::text, ',' ORDER BY rim_id)
    FROM   master.rim_master
    WHERE  p_area_id IS NULL OR local_area_id = p_area_id
    GROUP  BY local_area_id, master.fn_rim_key(name)
    HAVING count(*) > 1

    UNION ALL
    SELECT 'WARN', 'RIM_INCOMPLETE', 'rim_master', 'rim_id=' || rim_id,
           concat_ws('; ',
               CASE WHEN master.fn_rim_key(name) IS NULL THEN 'name is blank' END,
               CASE WHEN isactive IS NULL THEN 'isactive is NULL' END,
               CASE WHEN local_area_id IS NULL THEN 'local_area_id is NULL' END)
    FROM   master.rim_master
    WHERE  (p_area_id IS NULL OR local_area_id = p_area_id OR local_area_id IS NULL)
      AND  (master.fn_rim_key(name) IS NULL OR isactive IS NULL OR local_area_id IS NULL)

    -- formatting drift (not an error today, breaks exact-match code) ---------
    UNION ALL
    SELECT 'INFO', 'FORMAT_DRIFT', src, ref, 'Value ''' || val || ''' is not trimmed/upper-case'
    FROM  (SELECT 'material_size_lookup' src, 'id=' || id ref, rim_size val FROM msl
           UNION ALL SELECT 'runningsize_lookup', 'equipment_id=' || equipment_id, rim_size FROM run
           UNION ALL SELECT 'rim_master', 'rim_id=' || rim_id, name FROM master.rim_master) x
    WHERE  val IS DISTINCT FROM UPPER(BTRIM(val)) AND val IS NOT NULL

    -- production (o_production) ---------------------------------------------
    UNION ALL
    SELECT 'ERROR', 'PROD_MATERIAL_NO_SIZE', 'o_production', 'material_id=' || p.material_id,
           count(*) || ' tire(s) produced, last ' || date_trunc('second', max(p.dtandtime)) || ', no rim size mapped'
    FROM   prod p
    WHERE  NOT EXISTS (SELECT 1 FROM msl m WHERE m.material_id = p.material_id AND m.rim_key IS NOT NULL)
    GROUP  BY p.material_id

    UNION ALL
    SELECT 'ERROR', 'PROD_DUPLICATE_BARCODE', 'o_production', 'production_id=' || production_id,
           count(*) || ' records, materials ' || string_agg(DISTINCT material_id::text, ',')
    FROM   prod GROUP BY production_id
    HAVING count(DISTINCT material_id) > 1

    UNION ALL
    SELECT 'WARN', 'PROD_REPEATED_BARCODE', 'o_production', 'production_id=' || production_id,
           count(*) || ' records for the same material'
    FROM   prod GROUP BY production_id
    HAVING count(*) > 1 AND count(DISTINCT material_id) = 1

    UNION ALL
    SELECT 'WARN', 'PROD_RECIPE_MULTI_MATERIAL', 'o_production', 'recipe_id=' || recipe_id,
           'Recipe produced materials ' || string_agg(DISTINCT material_id::text, ',')
    FROM   prod WHERE recipe_id IS NOT NULL
    GROUP  BY recipe_id HAVING count(DISTINCT material_id) > 1

    UNION ALL
    SELECT 'WARN', 'PROD_NO_RECIPE', 'o_production', 'equipment_id=' || equipment_id,
           count(*) || ' record(s) with NULL recipe_id'
    FROM   prod WHERE recipe_id IS NULL
    GROUP  BY equipment_id
)
SELECT * FROM findings f(severity, check_code, entity, entity_ref, detail)
ORDER  BY CASE f.severity WHEN 'ERROR' THEN 1 WHEN 'WARN' THEN 2 ELSE 3 END,
          f.check_code, f.entity_ref
$$;
