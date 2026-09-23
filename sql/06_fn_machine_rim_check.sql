-- Validate the running rim of every machine against the current WIP.
--
-- For each machine of the area (default DBM) - i.e. equipment running a rim of
-- that area, plus DBM equipment seen in dbm.o_production without a running
-- rim - report:
--   wip_tires_fit     WIP tires it can take with its current rim
--   only_here_tires   WIP tires that can go ONLY to this machine (a changeover
--                     would block them)
--   suggested_rim     a changeover that unblocks WIP tires (tires with an
--                     active rim but no eligible machine) with a net gain:
--                     unblocks_tires - blocks_tires > 0
-- Suggestions are made per rim: when several machines could take the same
-- rim, only the best one gets it (idle / broken machines first). Re-validate
-- after each changeover.
--
-- Status:
--   OK                          rim active and WIP tires fit
--   INFO_NO_WIP                 rim active but no WIP tire fits (idle)
--   INFO_NOT_AVAILABLE          running None
--   NG_NO_RUNNING_RIM           DBM machine without a running rim
--   NG_RIM_INACTIVE             running rim is inactive in rim_master
--   NG_CHANGEOVER_NEEDED        idle while WIP tires are blocked; suggestion given
--   WARN_CHANGEOVER_SUGGESTED   has WIP, but a changeover would unblock more
DROP FUNCTION IF EXISTS master.fn_machine_rim_check(timestamp, timestamp, int[], int[], int, boolean);

CREATE FUNCTION master.fn_machine_rim_check(
    p_from           timestamp DEFAULT (now() - interval '2 days')::timestamp,
    p_to             timestamp DEFAULT now()::timestamp,
    p_wip_states     int[]     DEFAULT NULL,
    p_ok_quality     int[]     DEFAULT NULL,
    p_area_id        int       DEFAULT master.fn_area_id('DBM'),
    p_exclude_at_dbm boolean   DEFAULT true)
RETURNS TABLE(
    status            text,
    message           text,
    equipment_id      int,
    running_rim       text,
    rim_status        text,
    wip_tires_fit     bigint,
    only_here_tires   bigint,
    suggested_rim     text,
    suggested_rim_id  int,
    unblocks_tires    bigint,
    blocks_tires      bigint)
LANGUAGE sql STABLE AS $$
WITH rd AS (
    SELECT r.*,
           ARRAY(SELECT x FROM unnest(r.allowed_rim_sizes) x
                 WHERE NOT (x = ANY (COALESCE(r.inactive_rim_sizes, '{}')))) AS active
    FROM   master.fn_wip_rim_readiness(p_from, p_to, p_wip_states, p_ok_quality, p_area_id, p_exclude_at_dbm) r
),
machines AS (
    SELECT r.equipment_id,
           master.fn_rim_name(r.rim_size) AS rim,
           CASE WHEN master.fn_rim_name(r.rim_size) = 'NONE' THEN 'NOT AVAILABLE'
                WHEN master.fn_rim_name(r.rim_size) = 'UNIVERSALRIM' THEN 'UNIVERSAL'
                ELSE master.fn_rim_status(r.rim_size) END AS st
    FROM   master.runningsize_lookup r
    WHERE  master.fn_rim_key(r.rim_size) IS NOT NULL
      AND  (p_area_id IS NULL OR COALESCE(master.fn_rim_area(r.rim_size), p_area_id) = p_area_id)
    UNION
    SELECT DISTINCT d.equipment_id, NULL, 'NOT SET'
    FROM   dbm.o_production d
    WHERE  p_area_id IS NOT DISTINCT FROM master.fn_area_id('DBM')
      AND  d.dtandtime >= p_from AND d.dtandtime < p_to
      AND  d.equipment_id IS NOT NULL
      AND  NOT EXISTS (SELECT 1 FROM master.runningsize_lookup r
                       WHERE r.equipment_id = d.equipment_id AND master.fn_rim_key(r.rim_size) IS NOT NULL)
),
per_machine AS (
    SELECT m.*,
           (SELECT COALESCE(sum(x.wip_tires), 0) FROM rd x
            WHERE  m.equipment_id = ANY (COALESCE(x.eligible_equipment, '{}')))::bigint AS fit,
           (SELECT COALESCE(sum(x.wip_tires), 0) FROM rd x
            WHERE  x.eligible_equipment = ARRAY[m.equipment_id])::bigint           AS only_here
    FROM   machines m
),
-- active rims of the area that a machine could be changed over to
candidates AS (
    SELECT master.fn_rim_key(rm.name) AS rim, min(rm.rim_id) AS rim_id
    FROM   master.rim_master rm
    WHERE  rm.isactive
      AND  (p_area_id IS NULL OR rm.local_area_id = p_area_id)
      AND  master.fn_rim_key(rm.name) NOT IN ('NONE', 'UNIVERSALRIM')
    GROUP  BY 1
),
scored AS (
    SELECT pm.equipment_id, pm.fit, pm.st, c.rim, c.rim_id,
           (SELECT COALESCE(sum(x.wip_tires), 0) FROM rd x
            WHERE  x.eligible_equipment IS NULL AND c.rim = ANY (x.active))::bigint AS gain,
           (SELECT COALESCE(sum(x.wip_tires), 0) FROM rd x
            WHERE  x.eligible_equipment = ARRAY[pm.equipment_id]
              AND  NOT (c.rim = ANY (x.active)))::bigint AS loss
    FROM   per_machine pm
    CROSS  JOIN candidates c
    WHERE  pm.st <> 'NOT AVAILABLE'
      AND  c.rim IS DISTINCT FROM pm.rim
),
best_per_machine AS (
    SELECT DISTINCT ON (s.equipment_id) s.*
    FROM   scored s
    WHERE  s.gain - s.loss > 0
    ORDER  BY s.equipment_id, s.gain - s.loss DESC, s.gain DESC, s.rim
),
-- one machine per suggested rim: prefer idle / broken machines
best AS (
    SELECT DISTINCT ON (b.rim) b.*
    FROM   best_per_machine b
    ORDER  BY b.rim, b.gain - b.loss DESC, b.fit, (b.st IN ('NOT SET', 'INACTIVE')) DESC, b.equipment_id
),
final AS (
    SELECT CASE
             WHEN pm.st = 'NOT AVAILABLE'             THEN 'INFO_NOT_AVAILABLE'
             WHEN pm.st = 'NOT SET'                   THEN 'NG_NO_RUNNING_RIM'
             WHEN pm.st = 'INACTIVE'                  THEN 'NG_RIM_INACTIVE'
             WHEN b.rim IS NOT NULL AND pm.fit = 0    THEN 'NG_CHANGEOVER_NEEDED'
             WHEN b.rim IS NOT NULL                   THEN 'WARN_CHANGEOVER_SUGGESTED'
             WHEN pm.fit = 0                          THEN 'INFO_NO_WIP'
             ELSE 'OK'
           END AS status,
           pm.*, b.rim AS s_rim, b.rim_id AS s_rim_id, b.gain, b.loss
    FROM   per_machine pm
    LEFT   JOIN best b ON b.equipment_id = pm.equipment_id
)
SELECT f.status,
       concat_ws(' ',
         CASE f.status
           WHEN 'INFO_NOT_AVAILABLE' THEN 'Running None (not available).'
           WHEN 'NG_NO_RUNNING_RIM'  THEN 'No running rim set.'
           WHEN 'NG_RIM_INACTIVE'    THEN 'Running rim ' || f.rim || ' is inactive in rim_master.'
           WHEN 'INFO_NO_WIP'        THEN 'No WIP tire fits rim ' || f.rim || '.'
           ELSE f.fit || ' WIP tire(s) fit rim ' || f.rim || '.'
         END,
         CASE WHEN f.only_here > 0 THEN f.only_here || ' can only go here.' END,
         CASE WHEN f.s_rim IS NOT NULL THEN
              'Change over to ' || f.s_rim || ': unblocks ' || f.gain || ' tire(s)'
              || CASE WHEN f.loss > 0 THEN ', blocks ' || f.loss ELSE '' END || '.' END),
       f.equipment_id, f.rim, f.st, f.fit, f.only_here, f.s_rim, f.s_rim_id, f.gain, f.loss
FROM   final f
ORDER  BY CASE WHEN f.status LIKE 'NG%' THEN 0 WHEN f.status LIKE 'WARN%' THEN 1 ELSE 2 END, f.equipment_id
$$;
