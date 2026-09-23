-- Advance validation of WIP: before tires reach the scanner, check that every
-- recipe/material currently in WIP has a usable rim size and that at least one
-- equipment is running it.
--
-- WIP = latest record per barcode (production_id) in curing.o_production cured
-- in [p_from, p_to), optionally filtered to the given state / quality_status
-- codes (NULL = no filter).

-- One row per recipe + material in WIP.
CREATE OR REPLACE FUNCTION master.fn_wip_rim_readiness(
    p_from         timestamp DEFAULT (now() - interval '24 hours')::timestamp,
    p_to           timestamp DEFAULT now()::timestamp,
    p_wip_states   int[]     DEFAULT NULL,
    p_ok_quality   int[]     DEFAULT NULL,
    p_area_id      int       DEFAULT NULL)
RETURNS TABLE(
    status             text,
    message            text,
    recipe_id          int,
    material_id        int,
    wip_tires          bigint,
    first_cured        timestamp,
    last_cured         timestamp,
    curing_presses     int[],
    required_rim_size  text,
    rim_master_status  text,
    eligible_equipment int[])
LANGUAGE sql STABLE AS $$
WITH latest AS (
    SELECT DISTINCT ON (o.production_id)
           o.production_id, o.recipe_id, o.material_id, o.equipment_id,
           o.state, o.quality_status, o.dtandtime
    FROM   curing.o_production o
    WHERE  o.dtandtime >= p_from AND o.dtandtime < p_to
    ORDER  BY o.production_id, o.dtandtime DESC, o.id DESC
),
wip AS (
    SELECT * FROM latest l
    WHERE  (p_wip_states IS NULL OR l.state = ANY (p_wip_states))
      AND  (p_ok_quality IS NULL OR l.quality_status = ANY (p_ok_quality))
),
grp AS (
    SELECT w.recipe_id, w.material_id,
           count(*)                                         AS wip_tires,
           min(w.dtandtime)                                 AS first_cured,
           max(w.dtandtime)                                 AS last_cured,
           array_agg(DISTINCT w.equipment_id ORDER BY w.equipment_id) AS presses
    FROM   wip w
    GROUP  BY w.recipe_id, w.material_id
),
msizes AS (
    SELECT m.material_id,
           array_agg(DISTINCT master.fn_rim_key(m.rim_size)) AS sizes
    FROM   master.material_size_lookup m
    WHERE  m.material_id IN (SELECT g.material_id FROM grp g)
      AND  master.fn_rim_key(m.rim_size) IS NOT NULL
      AND  (p_area_id IS NULL OR m.area_id = p_area_id OR m.area_id IS NULL)
    GROUP  BY m.material_id
),
running AS (
    SELECT master.fn_rim_key(r.rim_size) AS rim_key,
           array_agg(r.equipment_id ORDER BY r.equipment_id) AS equipment
    FROM   master.runningsize_lookup r
    WHERE  master.fn_rim_key(r.rim_size) IS NOT NULL
    GROUP  BY 1
),
resolved AS (
    SELECT g.*, s.sizes,
           CASE WHEN cardinality(s.sizes) = 1 THEN s.sizes[1] END AS rim_key
    FROM   grp g
    LEFT   JOIN msizes s ON s.material_id = g.material_id
),
checked AS (
    SELECT x.*,
           CASE WHEN x.rim_key IS NOT NULL THEN master.fn_rim_status(x.rim_key, p_area_id) END AS rim_status,
           r.equipment
    FROM   resolved x
    LEFT   JOIN running r ON r.rim_key = x.rim_key
),
final AS (
    SELECT CASE
             WHEN c.sizes IS NULL              THEN 'NG_NO_MATERIAL_SIZE'
             WHEN cardinality(c.sizes) > 1     THEN 'NG_AMBIGUOUS_SIZE'
             WHEN c.rim_status = 'MISSING'     THEN 'NG_RIM_NOT_IN_MASTER'
             WHEN c.rim_status = 'INACTIVE'    THEN 'NG_RIM_INACTIVE'
             WHEN c.equipment IS NULL          THEN 'NG_NO_EQUIPMENT_RUNNING'
             WHEN c.recipe_id IS NULL          THEN 'WARN_NO_RECIPE'
             ELSE 'OK'
           END AS status,
           c.*
    FROM   checked c
)
SELECT f.status,
       CASE f.status
         WHEN 'NG_NO_MATERIAL_SIZE'     THEN 'Material has no rim size in material_size_lookup'
         WHEN 'NG_AMBIGUOUS_SIZE'       THEN 'Material mapped to multiple rim sizes: ' || array_to_string(f.sizes, ',')
         WHEN 'NG_RIM_NOT_IN_MASTER'    THEN 'Rim ' || f.rim_key || ' not found in rim_master'
         WHEN 'NG_RIM_INACTIVE'         THEN 'Rim ' || f.rim_key || ' is inactive in rim_master'
         WHEN 'NG_NO_EQUIPMENT_RUNNING' THEN 'No equipment is running rim ' || f.rim_key
         WHEN 'WARN_NO_RECIPE'          THEN 'Production records have no recipe_id'
         ELSE 'Rim ' || f.rim_key || ' running on ' || cardinality(f.equipment) || ' equipment'
       END,
       f.recipe_id, f.material_id, f.wip_tires, f.first_cured, f.last_cured,
       f.presses, f.rim_key, f.rim_status, f.equipment
FROM   final f
ORDER  BY (f.status LIKE 'NG%') DESC, (f.status LIKE 'WARN%') DESC,
          f.wip_tires DESC, f.recipe_id, f.material_id
$$;

-- One row per rim size: WIP demand vs equipment currently running it.
--   NG_NOT_RUNNING       WIP needs this rim but no equipment runs it
--   NG_UNRESOLVED        WIP tires whose rim size cannot be determined
--   INFO_NO_WIP          equipment runs this rim but nothing in WIP needs it
--                        (changeover candidate)
CREATE OR REPLACE FUNCTION master.fn_wip_rim_demand(
    p_from         timestamp DEFAULT (now() - interval '24 hours')::timestamp,
    p_to           timestamp DEFAULT now()::timestamp,
    p_wip_states   int[]     DEFAULT NULL,
    p_ok_quality   int[]     DEFAULT NULL,
    p_area_id      int       DEFAULT NULL)
RETURNS TABLE(
    status              text,
    rim_size            text,
    wip_tires           bigint,
    recipes             int[],
    materials           int[],
    equipment_running   int[])
LANGUAGE sql STABLE AS $$
WITH readiness AS (
    SELECT * FROM master.fn_wip_rim_readiness(p_from, p_to, p_wip_states, p_ok_quality, p_area_id)
),
demand AS (
    SELECT CASE WHEN r.status IN ('NG_NO_MATERIAL_SIZE', 'NG_AMBIGUOUS_SIZE')
                THEN NULL ELSE r.required_rim_size END AS rim_key,
           sum(r.wip_tires)::bigint AS wip_tires,
           array_agg(DISTINCT r.recipe_id)   FILTER (WHERE r.recipe_id IS NOT NULL) AS recipes,
           array_agg(DISTINCT r.material_id) AS materials
    FROM   readiness r
    GROUP  BY 1
),
running AS (
    SELECT master.fn_rim_key(r.rim_size) AS rim_key,
           array_agg(r.equipment_id ORDER BY r.equipment_id) AS equipment
    FROM   master.runningsize_lookup r
    WHERE  master.fn_rim_key(r.rim_size) IS NOT NULL
    GROUP  BY 1
)
SELECT x.* FROM (
    SELECT CASE
             WHEN d.rim_key IS NULL AND d.wip_tires IS NOT NULL THEN 'NG_UNRESOLVED'
             WHEN rn.equipment IS NULL                           THEN 'NG_NOT_RUNNING'
             WHEN d.wip_tires IS NULL                            THEN 'INFO_NO_WIP'
             ELSE 'OK'
           END                              AS status,
           COALESCE(d.rim_key, rn.rim_key)  AS rim_size,
           COALESCE(d.wip_tires, 0)         AS wip_tires,
           d.recipes, d.materials,
           rn.equipment                     AS equipment_running
    FROM   demand d
    FULL   JOIN running rn ON rn.rim_key = d.rim_key
) x
ORDER  BY (x.status LIKE 'NG%') DESC, x.wip_tires DESC, x.rim_size
$$;
