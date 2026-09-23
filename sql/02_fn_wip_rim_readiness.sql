-- Advance validation of WIP between Curing and DBM: before tires reach DBM,
-- check that every recipe/material in WIP has a usable rim size and that at
-- least one equipment is running it.
--
-- A material may be mapped to several rim sizes in material_size_lookup; the
-- tire can then run on any of them. It is routable when at least one of its
-- ACTIVE rim sizes is running on some equipment. Rims are compared by
-- rim_master name (rim_size stores rim_id; see 00_helpers.sql).
-- Equipment running UNIVERSALRIM takes any tire that has an active rim;
-- equipment running NONE is not available and takes no tires.
--
-- Area = machine type (master.area_master: 11 TUO, 12 DBM). p_area_id
-- defaults to the DBM area: only mappings of that area count, and only
-- equipment running a rim of that area is eligible. Pass another area (e.g.
-- master.fn_area_id('TUO')) to validate for that machine type.
--
-- WIP = latest record per barcode (production_id) in curing.o_production cured
-- in [p_from, p_to) (default: last 2 days), optionally filtered to the given
-- state / quality_status codes (NULL = no filter), and - when
-- p_exclude_at_dbm - whose barcode is not yet in dbm.o_production.

DROP FUNCTION IF EXISTS master.fn_wip_rim_demand(timestamp, timestamp, int[], int[], int);
DROP FUNCTION IF EXISTS master.fn_wip_rim_readiness(timestamp, timestamp, int[], int[], int);
DROP FUNCTION IF EXISTS master.fn_wip_rim_demand(timestamp, timestamp, int[], int[], int, boolean);
DROP FUNCTION IF EXISTS master.fn_wip_rim_readiness(timestamp, timestamp, int[], int[], int, boolean);

-- One row per recipe + material in WIP.
--   OK                       at least one allowed rim is active and running
--   WARN_SOME_RIMS_INACTIVE  routable, but some allowed rims are inactive in rim_master
--   NG_NO_MATERIAL_SIZE      material has no rim size mapped
--   NG_NO_ACTIVE_RIM         every allowed rim is inactive in rim_master
--   NG_NO_EQUIPMENT_RUNNING  no equipment runs any of the active allowed rims
CREATE FUNCTION master.fn_wip_rim_readiness(
    p_from           timestamp DEFAULT (now() - interval '2 days')::timestamp,
    p_to             timestamp DEFAULT now()::timestamp,
    p_wip_states     int[]     DEFAULT NULL,
    p_ok_quality     int[]     DEFAULT NULL,
    p_area_id        int       DEFAULT master.fn_area_id('DBM'),
    p_exclude_at_dbm boolean   DEFAULT true)
RETURNS TABLE(
    status              text,
    message             text,
    recipe_id           int,
    material_id         int,
    wip_tires           bigint,
    first_cured         timestamp,
    last_cured          timestamp,
    curing_presses      int[],
    allowed_rim_sizes   text[],   -- every size mapped to the material
    inactive_rim_sizes  text[],   -- mapped but inactive in rim_master
    running_rim_sizes   text[],   -- active allowed sizes some equipment is running
    eligible_equipment  int[])
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
      AND  NOT (p_exclude_at_dbm AND EXISTS (
                  SELECT 1 FROM dbm.o_production d WHERE d.barcode = l.production_id))
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
-- one row per (material, allowed rim name); active if any mapped rim_id with that name is active
msize AS (
    SELECT m.material_id,
           master.fn_rim_name(m.rim_size)                                         AS rim_key,
           bool_or(master.fn_rim_status(m.rim_size, p_area_id) = 'ACTIVE')         AS is_active
    FROM   master.material_size_lookup m
    WHERE  m.material_id IN (SELECT g.material_id FROM grp g)
      AND  master.fn_rim_key(m.rim_size) IS NOT NULL
      AND  (p_area_id IS NULL OR m.area_id = p_area_id OR m.area_id IS NULL)
    GROUP  BY m.material_id, master.fn_rim_name(m.rim_size)
),
running AS (
    SELECT r.equipment_id, master.fn_rim_name(r.rim_size) AS rim_key
    FROM   master.runningsize_lookup r
    WHERE  master.fn_rim_key(r.rim_size) IS NOT NULL
      AND  master.fn_rim_name(r.rim_size) <> 'NONE'
      -- equipment of this machine type = running a rim of this area
      AND  (p_area_id IS NULL OR COALESCE(master.fn_rim_area(r.rim_size), p_area_id) = p_area_id)
),
universal AS (
    SELECT array_agg(u.equipment_id ORDER BY u.equipment_id) AS equipment
    FROM   running u WHERE u.rim_key = 'UNIVERSALRIM'
),
msize_checked AS (
    SELECT s.material_id, s.rim_key, s.is_active,
           (SELECT array_agg(r.equipment_id ORDER BY r.equipment_id)
            FROM   running r WHERE r.rim_key = s.rim_key) AS equipment
    FROM   msize s
),
per_material_own AS (
    SELECT c.material_id,
           array_agg(c.rim_key ORDER BY c.rim_key)                                        AS allowed,
           array_agg(c.rim_key ORDER BY c.rim_key) FILTER (WHERE NOT c.is_active)          AS inactive,
           array_agg(c.rim_key ORDER BY c.rim_key) FILTER (WHERE c.is_active AND c.equipment IS NOT NULL) AS running,
           bool_or(c.is_active)                                                            AS has_active,
           (SELECT array_agg(DISTINCT e ORDER BY e)
            FROM   msize_checked c2, unnest(c2.equipment) e
            WHERE  c2.material_id = c.material_id AND c2.is_active)                        AS eligible
    FROM   msize_checked c
    GROUP  BY c.material_id
),
-- add UNIVERSALRIM equipment for every material that has an active rim
per_material AS (
    SELECT o.material_id, o.allowed, o.inactive,
           CASE WHEN o.has_active AND u.equipment IS NOT NULL
                     AND NOT ('UNIVERSALRIM' = ANY (COALESCE(o.running, '{}')))
                THEN COALESCE(o.running, '{}') || 'UNIVERSALRIM'::text
                ELSE o.running END AS running,
           CASE WHEN o.has_active AND u.equipment IS NOT NULL
                THEN (SELECT array_agg(DISTINCT e ORDER BY e) FROM unnest(COALESCE(o.eligible, '{}') || u.equipment) e)
                ELSE o.eligible END AS eligible
    FROM   per_material_own o CROSS JOIN universal u
),
final AS (
    SELECT CASE
             WHEN pm.allowed IS NULL                                  THEN 'NG_NO_MATERIAL_SIZE'
             WHEN cardinality(pm.allowed) = COALESCE(cardinality(pm.inactive), 0) THEN 'NG_NO_ACTIVE_RIM'
             WHEN pm.eligible IS NULL                                 THEN 'NG_NO_EQUIPMENT_RUNNING'
             WHEN pm.inactive IS NOT NULL                             THEN 'WARN_SOME_RIMS_INACTIVE'
             ELSE 'OK'
           END AS status,
           g.*, pm.allowed, pm.inactive, pm.running, pm.eligible
    FROM   grp g
    LEFT   JOIN per_material pm ON pm.material_id = g.material_id
)
SELECT f.status,
       CASE f.status
         WHEN 'NG_NO_MATERIAL_SIZE'     THEN 'Material has no rim size in material_size_lookup'
         WHEN 'NG_NO_ACTIVE_RIM'        THEN 'All allowed rims are inactive in rim_master: ' || array_to_string(f.inactive, ',')
         WHEN 'NG_NO_EQUIPMENT_RUNNING' THEN 'No equipment is running any allowed rim: ' || array_to_string(f.allowed, ',')
         WHEN 'WARN_SOME_RIMS_INACTIVE' THEN 'Routable on rim ' || array_to_string(f.running, ',')
                                             || '; inactive in rim_master: ' || array_to_string(f.inactive, ',')
         ELSE 'Routable on rim ' || array_to_string(f.running, ',') || ' (' || cardinality(f.eligible) || ' equipment)'
       END,
       f.recipe_id, f.material_id, f.wip_tires, f.first_cured, f.last_cured,
       f.presses, f.allowed, f.inactive, f.running, f.eligible
FROM   final f
ORDER  BY (f.status LIKE 'NG%') DESC, (f.status LIKE 'WARN%') DESC,
          f.wip_tires DESC, f.recipe_id, f.material_id
$$;

-- One row per rim size: WIP tires that can use it vs equipment running it.
-- A tire that accepts several rims is counted under each of them.
--   NG_UNRESOLVED       WIP tires with no active rim size at all
--   NG_NOT_RUNNING      not running, and some tires accepting it have no
--                       running alternative (blocked_tires > 0)
--   INFO_NOT_RUNNING    not running, but every tire accepting it can use
--                       another rim that is running
--   INFO_NO_WIP         equipment runs this rim but nothing in WIP accepts it
--                       (changeover candidate)
--   INFO_UNIVERSAL      UNIVERSALRIM equipment; wip_tires = tires it can take
-- Equipment running NONE is not available and is left out.
CREATE FUNCTION master.fn_wip_rim_demand(
    p_from           timestamp DEFAULT (now() - interval '2 days')::timestamp,
    p_to             timestamp DEFAULT now()::timestamp,
    p_wip_states     int[]     DEFAULT NULL,
    p_ok_quality     int[]     DEFAULT NULL,
    p_area_id        int       DEFAULT master.fn_area_id('DBM'),
    p_exclude_at_dbm boolean   DEFAULT true)
RETURNS TABLE(
    status              text,
    rim_size            text,
    wip_tires           bigint,   -- WIP tires that can use this rim
    blocked_tires       bigint,   -- of those, tires with no eligible equipment at all
    recipes             int[],
    materials           int[],
    equipment_running   int[])
LANGUAGE sql STABLE AS $$
WITH readiness AS (
    SELECT * FROM master.fn_wip_rim_readiness(p_from, p_to, p_wip_states, p_ok_quality, p_area_id, p_exclude_at_dbm)
),
by_rim AS (
    -- active allowed rims per group (NULL when the group has none)
    SELECT r.*, a.rim_key
    FROM   readiness r
    LEFT   JOIN LATERAL (
        SELECT x AS rim_key FROM unnest(r.allowed_rim_sizes) x
        WHERE  NOT (x = ANY (COALESCE(r.inactive_rim_sizes, '{}')))
    ) a ON true
),
demand AS (
    SELECT b.rim_key,
           sum(b.wip_tires)::bigint                                              AS wip_tires,
           COALESCE(sum(b.wip_tires) FILTER (WHERE b.eligible_equipment IS NULL), 0)::bigint AS blocked_tires,
           array_agg(DISTINCT b.recipe_id)   FILTER (WHERE b.recipe_id IS NOT NULL) AS recipes,
           array_agg(DISTINCT b.material_id)                                     AS materials
    FROM   by_rim b
    GROUP  BY b.rim_key
),
running AS (
    SELECT master.fn_rim_name(r.rim_size) AS rim_key,
           array_agg(r.equipment_id ORDER BY r.equipment_id) AS equipment
    FROM   master.runningsize_lookup r
    WHERE  master.fn_rim_key(r.rim_size) IS NOT NULL
      AND  master.fn_rim_name(r.rim_size) <> 'NONE'        -- not available
      AND  (p_area_id IS NULL OR COALESCE(master.fn_rim_area(r.rim_size), p_area_id) = p_area_id)
    GROUP  BY 1
),
-- tires a UNIVERSALRIM equipment can take: every tire with an active rim
universal_wip AS (
    SELECT COALESCE(sum(r.wip_tires), 0)::bigint AS wip_tires
    FROM   readiness r
    WHERE  r.status NOT IN ('NG_NO_MATERIAL_SIZE', 'NG_NO_ACTIVE_RIM')
)
SELECT x.* FROM (
    SELECT CASE
             WHEN rn.rim_key = 'UNIVERSALRIM'                    THEN 'INFO_UNIVERSAL'
             WHEN d.rim_key IS NULL AND d.wip_tires IS NOT NULL THEN 'NG_UNRESOLVED'
             WHEN rn.equipment IS NULL AND d.blocked_tires > 0   THEN 'NG_NOT_RUNNING'
             WHEN rn.equipment IS NULL                           THEN 'INFO_NOT_RUNNING'
             WHEN d.wip_tires IS NULL                            THEN 'INFO_NO_WIP'
             ELSE 'OK'
           END                              AS status,
           COALESCE(d.rim_key, rn.rim_key)  AS rim_size,
           CASE WHEN rn.rim_key = 'UNIVERSALRIM' THEN (SELECT uw.wip_tires FROM universal_wip uw)
                ELSE COALESCE(d.wip_tires, 0) END AS wip_tires,
           COALESCE(d.blocked_tires, 0)     AS blocked_tires,
           d.recipes, d.materials,
           rn.equipment                     AS equipment_running
    FROM   demand d
    FULL   JOIN running rn ON rn.rim_key = d.rim_key
) x
ORDER  BY (x.status LIKE 'NG%') DESC, x.blocked_tires DESC, x.wip_tires DESC, x.rim_size
$$;
