-- Helpers shared by all rim-size validation objects.
--
-- material_size_lookup.rim_size and runningsize_lookup.rim_size hold
-- master.rim_master.rim_id (as text). rim_master has one row per rim per area
-- (e.g. rim_id 1 = R20225 in area 12, rim_id 13 = R20225 in area 11), so rims
-- are compared by NAME via master.fn_rim_name(); activity is checked on the
-- exact rim_master row via master.fn_rim_status().
--
-- Special rim names (running on equipment):
--   UNIVERSALRIM  the equipment can take any tire
--   NONE          the equipment is not available (no rim / stopped)

-- Normalise free text: trim, upper-case, blank -> NULL.
CREATE OR REPLACE FUNCTION master.fn_rim_key(p_rim text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT NULLIF(UPPER(BTRIM(p_rim)), '')
$$;

-- Canonical rim name for a stored rim_size: the rim_master name of that
-- rim_id; falls back to the value itself when it is already a name.
CREATE OR REPLACE FUNCTION master.fn_rim_name(p_rim_size text)
RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT master.fn_rim_key(rm.name)
         FROM   master.rim_master rm
         WHERE  rm.rim_id::text = master.fn_rim_key(p_rim_size)
         LIMIT  1),
        master.fn_rim_key(p_rim_size))
$$;

-- Status of a stored rim_size in master.rim_master: ACTIVE / INACTIVE.
-- Matches the exact rim_id, or the name when a name is stored. Rim sizes are
-- always created in rim_master before they can be mapped, so the only failure
-- case is a rim made inactive after mapping (a blank value is not usable).
CREATE OR REPLACE FUNCTION master.fn_rim_status(p_rim_size text, p_area_id int DEFAULT NULL)
RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT CASE
             WHEN master.fn_rim_key(p_rim_size) IS NOT NULL AND bool_or(rm.isactive) THEN 'ACTIVE'
             ELSE 'INACTIVE'
           END
    FROM   master.rim_master rm
    WHERE  (rm.rim_id::text = master.fn_rim_key(p_rim_size) OR master.fn_rim_key(rm.name) = master.fn_rim_key(p_rim_size))
      AND  (p_area_id IS NULL OR rm.local_area_id = p_area_id OR rm.local_area_id IS NULL)
$$;

-- Area (rim_master.local_area_id) of a stored rim_size (rim_id); NULL when the
-- value is a name rather than a rim_id.
CREATE OR REPLACE FUNCTION master.fn_rim_area(p_rim_size text)
RETURNS int
LANGUAGE sql STABLE AS $$
    SELECT rm.local_area_id
    FROM   master.rim_master rm
    WHERE  rm.rim_id::text = master.fn_rim_key(p_rim_size)
    LIMIT  1
$$;

-- local_area_id of an area by name from master.area_master (e.g. 'DBM' -> 12,
-- 'TUO' -> 11). Rims in rim_master are defined per area = per machine type.
CREATE OR REPLACE FUNCTION master.fn_area_id(p_name text)
RETURNS int
LANGUAGE sql STABLE AS $$
    SELECT a.local_area_id
    FROM   master.area_master a
    WHERE  UPPER(BTRIM(a.name)) = UPPER(BTRIM(p_name))
    ORDER  BY a.local_area_id
    LIMIT  1
$$;
