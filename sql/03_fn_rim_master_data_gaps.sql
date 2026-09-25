-- Master-data gap report for rim-size routing. One row per finding.
--   severity: ERROR (tires will fail validation) / WARN (risky data) / INFO
--   fix_ref:  the keys a fix needs (material_id, row_id, equipment_id, rim_size, ...)
-- Rims are grouped/compared by rim_master name (rim_key); activity is checked
-- on the stored rim_id. Equipment running NONE is not available;
-- UNIVERSALRIM equipment can take any tire.
-- Production checks (PROD_*, DBM_*) only look at the window [p_from, p_to).
-- p_area_id NULL = all areas (machine types); otherwise only that area's
-- mappings and equipment running that area's rims.
DROP FUNCTION IF EXISTS master.fn_rim_master_data_gaps(timestamp, timestamp, int);

CREATE FUNCTION master.fn_rim_master_data_gaps(
    p_from     timestamp DEFAULT (now() - interval '2 days')::timestamp,
    p_to       timestamp DEFAULT now()::timestamp,
    p_area_id  int       DEFAULT NULL)
RETURNS TABLE(severity text, check_code text, entity text, entity_ref text, detail text, fix_ref jsonb)
LANGUAGE sql STABLE AS $$
WITH msl AS (
    SELECT m.*, master.fn_rim_name(m.rim_size) AS rim_key
    FROM   master.material_size_lookup m
    WHERE  p_area_id IS NULL OR m.area_id = p_area_id OR m.area_id IS NULL
),
run AS (
    SELECT r.*, master.fn_rim_name(r.rim_size) AS rim_key
    FROM   master.runningsize_lookup r
),
-- equipment that can actually take tires
avail AS (
    SELECT * FROM run
    WHERE  rim_key IS NOT NULL AND rim_key <> 'NONE'
      AND  (p_area_id IS NULL OR COALESCE(master.fn_rim_area(rim_size), p_area_id) = p_area_id)
),
prod AS (
    SELECT o.production_id, o.material_id, o.equipment_id, o.dtandtime
    FROM   curing.o_production o
    WHERE  o.dtandtime >= p_from AND o.dtandtime < p_to
),
findings AS (
    -- material_size_lookup ---------------------------------------------------
    -- (several rim sizes per material are allowed and not listed; only real defects are flagged)
    SELECT 'WARN', 'MSL_DUPLICATE_ROW', 'material_size_lookup',
           'material_id=' || material_id || ', area_id=' || COALESCE(area_id::text, 'NULL'),
           count(*) || ' rows for rim ' || rim_key || ' (ids ' || string_agg(id::text, ',' ORDER BY id) || ')',
           jsonb_build_object('material_id', material_id, 'area_id', area_id, 'rim_size', rim_key,
                              'row_ids', array_agg(id ORDER BY id))
    FROM   msl GROUP BY material_id, area_id, rim_key
    HAVING count(*) > 1

    UNION ALL
    SELECT 'ERROR', 'MSL_BLANK_RIM', 'material_size_lookup', 'id=' || id,
           'material_id=' || material_id || ' has blank rim_size',
           jsonb_build_object('material_id', material_id, 'row_id', id)
    FROM   msl WHERE rim_key IS NULL

    UNION ALL
    SELECT 'ERROR', 'MSL_RIM_WRONG_AREA', 'material_size_lookup', 'id=' || id,
           'material_id=' || material_id || ' mapping for area ' || area_id || ' uses rim ' || rim_key
           || ' of area ' || master.fn_rim_area(rim_size),
           jsonb_build_object('material_id', material_id, 'row_id', id)
    FROM   msl
    WHERE  area_id IS NOT NULL AND master.fn_rim_area(rim_size) IS NOT NULL
      AND  master.fn_rim_area(rim_size) <> area_id

    UNION ALL
    SELECT 'WARN', 'MSL_NULL_AREA', 'material_size_lookup', 'id=' || id,
           'material_id=' || material_id || ' has no area_id',
           jsonb_build_object('material_id', material_id, 'row_id', id)
    FROM   msl WHERE area_id IS NULL

    UNION ALL
    -- Rim deactivated after mapping (or a value that is no rim at all, e.g. '-'):
    -- ERROR when the material has no other active rim, WARN when it still has one
    SELECT CASE WHEN x.has_active THEN 'WARN' ELSE 'ERROR' END,
           CASE WHEN x.known THEN 'MSL_RIM_INACTIVE' ELSE 'MSL_RIM_INVALID' END,
           'material_size_lookup', 'id=' || x.id,
           'material_id=' || x.material_id || ' rim ' || x.rim_key
           || CASE WHEN x.known THEN ' is inactive in rim_master' ELSE ' is not a rim_id in rim_master' END
           || CASE WHEN x.has_active THEN ' (other allowed rims are active)' ELSE ' (no active rim left)' END,
           jsonb_build_object('material_id', x.material_id, 'row_id', x.id, 'rim_size', x.rim_key, 'area_id', x.area_id)
    FROM  (SELECT m.*, master.fn_rim_status(m.rim_size) AS st,
                  EXISTS (SELECT 1 FROM master.rim_master rm
                          WHERE rm.rim_id::text = master.fn_rim_key(m.rim_size)
                             OR master.fn_rim_key(rm.name) = master.fn_rim_key(m.rim_size)) AS known,
                  EXISTS (SELECT 1 FROM msl m2
                          WHERE  m2.material_id = m.material_id AND m2.rim_key IS NOT NULL
                            AND  m2.area_id IS NOT DISTINCT FROM m.area_id      -- same machine area
                            AND  m2.rim_key <> m.rim_key
                            AND  master.fn_rim_status(m2.rim_size) = 'ACTIVE') AS has_active
           FROM   msl m WHERE m.rim_key IS NOT NULL) x
    WHERE  x.st <> 'ACTIVE'

    UNION ALL
    SELECT 'INFO', 'MSL_SIZE_NOT_RUNNING', 'material_size_lookup', 'rim=' || m.rim_key,
           count(DISTINCT m.material_id) || ' material(s) accept rim ' || m.rim_key || ' but no equipment is running it',
           jsonb_build_object('rim_size', m.rim_key)
    FROM   msl m
    WHERE  m.rim_key IS NOT NULL
      AND  m.rim_key NOT IN ('NONE', 'UNIVERSALRIM')
      AND  NOT EXISTS (SELECT 1 FROM avail r WHERE r.rim_key = m.rim_key)
    GROUP  BY m.rim_key

    UNION ALL
    SELECT 'WARN', 'MSL_NONE_RIM', 'material_size_lookup', 'id=' || m.id,
           'material_id=' || m.material_id || ' is mapped to rim None',
           jsonb_build_object('material_id', m.material_id, 'row_id', m.id)
    FROM   msl m
    WHERE  m.rim_key = 'NONE'

    UNION ALL
    SELECT 'WARN', 'MSL_MATERIAL_NOT_RUNNABLE', 'material_size_lookup', 'material_id=' || m.material_id,
           'None of the allowed rims (' || string_agg(DISTINCT m.rim_key, ',') || ') is running on any equipment',
           jsonb_build_object('material_id', m.material_id)
    FROM   msl m
    WHERE  m.rim_key IS NOT NULL
    GROUP  BY m.material_id
    HAVING NOT bool_or(EXISTS (SELECT 1 FROM avail r WHERE r.rim_key = m.rim_key))
       AND NOT EXISTS (SELECT 1 FROM avail r WHERE r.rim_key = 'UNIVERSALRIM')

    -- runningsize_lookup -----------------------------------------------------
    UNION ALL
    SELECT 'ERROR', 'RUN_BLANK_RIM', 'runningsize_lookup', 'equipment_id=' || equipment_id,
           'Equipment has blank running rim_size',
           jsonb_build_object('equipment_id', equipment_id)
    FROM   run WHERE rim_key IS NULL

    UNION ALL
    SELECT 'ERROR', 'RUN_RIM_INACTIVE', 'runningsize_lookup', 'equipment_id=' || equipment_id,
           'Running rim ' || rim_key || ' is inactive in rim_master',
           jsonb_build_object('equipment_id', equipment_id, 'rim_size', rim_key)
    FROM  (SELECT run.*, master.fn_rim_status(rim_size) AS st FROM run WHERE rim_key IS NOT NULL) x
    WHERE  st <> 'ACTIVE'

    -- rim_master -------------------------------------------------------------
    UNION ALL
    SELECT 'WARN', 'RIM_DUPLICATE_NAME', 'rim_master',
           'area_id=' || COALESCE(local_area_id::text, 'NULL') || ', name=' || master.fn_rim_key(name),
           'rim_ids ' || string_agg(rim_id::text, ',' ORDER BY rim_id),
           jsonb_build_object('area_id', local_area_id, 'rim_size', master.fn_rim_key(name),
                              'rim_ids', array_agg(rim_id ORDER BY rim_id))
    FROM   master.rim_master
    WHERE  p_area_id IS NULL OR local_area_id = p_area_id
    GROUP  BY local_area_id, master.fn_rim_key(name)
    HAVING count(*) > 1

    UNION ALL
    SELECT 'WARN', 'RIM_INCOMPLETE', 'rim_master', 'rim_id=' || rim_id,
           concat_ws('; ',
               CASE WHEN master.fn_rim_key(name) IS NULL THEN 'name is blank' END,
               CASE WHEN isactive IS NULL THEN 'isactive is NULL' END,
               CASE WHEN local_area_id IS NULL THEN 'local_area_id is NULL' END),
           jsonb_build_object('rim_id', rim_id)
    FROM   master.rim_master
    WHERE  (p_area_id IS NULL OR local_area_id = p_area_id OR local_area_id IS NULL)
      AND  (master.fn_rim_key(name) IS NULL OR isactive IS NULL OR local_area_id IS NULL)

    -- stored rim_size with surrounding spaces (breaks exact-match code) ------
    UNION ALL
    SELECT 'INFO', 'FORMAT_DRIFT', src, ref, 'Value ''' || val || ''' has leading/trailing spaces', '{}'::jsonb
    FROM  (SELECT 'material_size_lookup' src, 'id=' || id ref, rim_size val FROM msl
           UNION ALL SELECT 'runningsize_lookup', 'equipment_id=' || equipment_id, rim_size FROM run) x
    WHERE  val <> BTRIM(val)

    -- production (o_production) ---------------------------------------------
    UNION ALL
    SELECT 'ERROR', 'PROD_MATERIAL_NO_SIZE', 'o_production', 'material_id=' || p.material_id,
           count(*) || ' tire(s) produced, last ' || date_trunc('second', max(p.dtandtime)) || ', no rim size mapped',
           jsonb_build_object('material_id', p.material_id)
    FROM   prod p
    WHERE  NOT EXISTS (SELECT 1 FROM msl m WHERE m.material_id = p.material_id AND m.rim_key IS NOT NULL)
    GROUP  BY p.material_id

    UNION ALL
    SELECT 'ERROR', 'PROD_DUPLICATE_BARCODE', 'o_production', 'production_id=' || production_id,
           count(*) || ' records, materials ' || string_agg(DISTINCT material_id::text, ','),
           jsonb_build_object('production_id', production_id)
    FROM   prod GROUP BY production_id
    HAVING count(DISTINCT material_id) > 1

    UNION ALL
    SELECT 'WARN', 'PROD_REPEATED_BARCODE', 'o_production', 'production_id=' || production_id,
           count(*) || ' records for the same material',
           jsonb_build_object('production_id', production_id)
    FROM   prod GROUP BY production_id
    HAVING count(*) > 1 AND count(DISTINCT material_id) = 1

    -- DBM equipment running a rim that belongs to another area (e.g. a TUO rim)
    UNION ALL
    SELECT 'ERROR', 'RUN_RIM_WRONG_AREA', 'runningsize_lookup', 'equipment_id=' || r.equipment_id,
           'DBM equipment runs rim ' || r.rim_key || ' of area ' || master.fn_rim_area(r.rim_size)
           || ' instead of a DBM (area ' || master.fn_area_id('DBM') || ') rim',
           jsonb_build_object('equipment_id', r.equipment_id)
    FROM   run r
    WHERE  master.fn_rim_area(r.rim_size) <> master.fn_area_id('DBM')
      AND  EXISTS (SELECT 1 FROM dbm.o_production d
                   WHERE d.equipment_id = r.equipment_id AND d.dtandtime >= p_from AND d.dtandtime < p_to)

    -- DBM equipment active in the window with no running rim size
    UNION ALL
    SELECT 'ERROR', 'DBM_NO_RUNNING_SIZE', 'runningsize_lookup', 'equipment_id=' || d.equipment_id,
           'DBM equipment balanced ' || count(*) || ' tire(s) in the window but has no running rim size',
           jsonb_build_object('equipment_id', d.equipment_id)
    FROM   dbm.o_production d
    WHERE  d.dtandtime >= p_from AND d.dtandtime < p_to
      AND  d.equipment_id IS NOT NULL
      AND  NOT EXISTS (SELECT 1 FROM run r WHERE r.equipment_id = d.equipment_id AND r.rim_key IS NOT NULL)
    GROUP  BY d.equipment_id

    -- equipment balancing at DBM that equipment_master does not list as a DBM (local_equipment_id, DBM area)
    UNION ALL
    SELECT 'WARN', 'DBM_EQUIPMENT_NOT_IN_MASTER', 'equipment_master', 'equipment_id=' || d.equipment_id,
           'Equipment ' || d.equipment_id || ' balanced ' || count(*) || ' tire(s) at DBM in the window but is '
           || COALESCE('registered in equipment_master as "' || max(e.name) || '" of area ' || max(e.local_area_id),
                       'not in equipment_master'),
           jsonb_build_object('equipment_id', d.equipment_id)
    FROM   dbm.o_production d
    LEFT   JOIN master.equipment_master e ON e.local_equipment_id = d.equipment_id
    WHERE  d.dtandtime >= p_from AND d.dtandtime < p_to
      AND  d.equipment_id IS NOT NULL
      AND  e.local_area_id IS DISTINCT FROM master.fn_area_id('DBM')
    GROUP  BY d.equipment_id
)
SELECT * FROM findings f(severity, check_code, entity, entity_ref, detail, fix_ref)
ORDER  BY CASE f.severity WHEN 'ERROR' THEN 1 WHEN 'WARN' THEN 2 ELSE 3 END,
          f.check_code, f.entity_ref
$$;
