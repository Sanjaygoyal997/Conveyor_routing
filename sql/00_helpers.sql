-- Helpers shared by all rim-size validation objects.
--
-- rim_size is free text in material_size_lookup and runningsize_lookup, so
-- every comparison goes through master.fn_rim_key() to ignore case and
-- surrounding spaces ("r15 " = "R15").

CREATE OR REPLACE FUNCTION master.fn_rim_key(p_rim text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT NULLIF(UPPER(BTRIM(p_rim)), '')
$$;

-- Status of a rim size in master.rim_master: ACTIVE / INACTIVE.
-- A rim_size is matched against rim_master.name, or against rim_id when the
-- lookup tables store the id as text. Rim sizes are always created in
-- rim_master before they can be mapped, so the only failure case is a rim that
-- was deactivated after mapping (a blank key is also treated as not usable).
CREATE OR REPLACE FUNCTION master.fn_rim_status(p_rim_key text, p_area_id int DEFAULT NULL)
RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT CASE
             WHEN p_rim_key IS NOT NULL AND bool_or(rm.isactive) THEN 'ACTIVE'
             ELSE 'INACTIVE'
           END
    FROM   master.rim_master rm
    WHERE  (master.fn_rim_key(rm.name) = p_rim_key OR rm.rim_id::text = p_rim_key)
      AND  (p_area_id IS NULL OR rm.local_area_id = p_area_id OR rm.local_area_id IS NULL)
$$;
