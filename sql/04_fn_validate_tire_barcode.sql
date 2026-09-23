-- Scan-time validation of one tire barcode (= curing.o_production.production_id).
--   p_equipment_id given -> one row: OK / NG_* for that equipment
--   p_equipment_id NULL  -> one row per eligible equipment (routing candidates)
CREATE OR REPLACE FUNCTION master.fn_validate_tire_barcode(
    p_barcode      varchar,
    p_equipment_id int   DEFAULT NULL,
    p_area_id      int   DEFAULT NULL,
    p_ok_quality   int[] DEFAULT NULL)
RETURNS TABLE(status text, message text, material_id int, recipe_id int,
              rim_size text, equipment_id int)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_cnt     int;
    v_mat_cnt int;
    v_prod    curing.o_production%ROWTYPE;
    v_sizes   text[];
    v_size    text;
    v_rim_st  text;
    v_run     text;
BEGIN
    SELECT count(*), count(DISTINCT o.material_id) INTO v_cnt, v_mat_cnt
    FROM   curing.o_production o
    WHERE  o.production_id = BTRIM(p_barcode);

    IF v_cnt = 0 THEN
        RETURN QUERY SELECT 'NG_BARCODE_NOT_FOUND', 'Barcode not found in curing production',
                            NULL::int, NULL::int, NULL::text, p_equipment_id;
        RETURN;
    END IF;
    IF v_mat_cnt > 1 THEN
        RETURN QUERY SELECT 'NG_DUPLICATE_BARCODE',
                            'Barcode recorded with ' || v_mat_cnt || ' different materials',
                            NULL::int, NULL::int, NULL::text, p_equipment_id;
        RETURN;
    END IF;

    SELECT * INTO v_prod
    FROM   curing.o_production o
    WHERE  o.production_id = BTRIM(p_barcode)
    ORDER  BY o.dtandtime DESC, o.id DESC
    LIMIT  1;

    IF p_ok_quality IS NOT NULL AND NOT (v_prod.quality_status = ANY (p_ok_quality)) THEN
        RETURN QUERY SELECT 'NG_QUALITY_HOLD', 'quality_status ' || v_prod.quality_status || ' is not routable',
                            v_prod.material_id, v_prod.recipe_id, NULL::text, p_equipment_id;
        RETURN;
    END IF;

    SELECT array_agg(DISTINCT master.fn_rim_key(m.rim_size)) INTO v_sizes
    FROM   master.material_size_lookup m
    WHERE  m.material_id = v_prod.material_id
      AND  master.fn_rim_key(m.rim_size) IS NOT NULL
      AND  (p_area_id IS NULL OR m.area_id = p_area_id OR m.area_id IS NULL);

    IF v_sizes IS NULL THEN
        RETURN QUERY SELECT 'NG_NO_MATERIAL_SIZE', 'No rim size mapped for material',
                            v_prod.material_id, v_prod.recipe_id, NULL::text, p_equipment_id;
        RETURN;
    END IF;
    IF cardinality(v_sizes) > 1 THEN
        RETURN QUERY SELECT 'NG_AMBIGUOUS_SIZE', 'Multiple rim sizes: ' || array_to_string(v_sizes, ','),
                            v_prod.material_id, v_prod.recipe_id, NULL::text, p_equipment_id;
        RETURN;
    END IF;
    v_size := v_sizes[1];

    v_rim_st := master.fn_rim_status(v_size, p_area_id);
    IF v_rim_st <> 'ACTIVE' THEN
        RETURN QUERY SELECT 'NG_RIM_' || CASE v_rim_st WHEN 'MISSING' THEN 'NOT_IN_MASTER' ELSE v_rim_st END,
                            'Rim ' || v_size || ' is ' || lower(v_rim_st) || ' in rim_master',
                            v_prod.material_id, v_prod.recipe_id, v_size, p_equipment_id;
        RETURN;
    END IF;

    IF p_equipment_id IS NOT NULL THEN
        SELECT master.fn_rim_key(r.rim_size) INTO v_run
        FROM   master.runningsize_lookup r
        WHERE  r.equipment_id = p_equipment_id;

        IF v_run IS NULL THEN
            RETURN QUERY SELECT 'NG_NO_RUNNING_SIZE', 'Equipment has no running rim size',
                                v_prod.material_id, v_prod.recipe_id, v_size, p_equipment_id;
        ELSIF v_run <> v_size THEN
            RETURN QUERY SELECT 'NG_SIZE_MISMATCH', 'Tire needs ' || v_size || ', equipment running ' || v_run,
                                v_prod.material_id, v_prod.recipe_id, v_size, p_equipment_id;
        ELSE
            RETURN QUERY SELECT 'OK', 'Rim size matched',
                                v_prod.material_id, v_prod.recipe_id, v_size, p_equipment_id;
        END IF;
        RETURN;
    END IF;

    RETURN QUERY
        SELECT 'OK', 'Eligible equipment', v_prod.material_id, v_prod.recipe_id, v_size, r.equipment_id
        FROM   master.runningsize_lookup r
        WHERE  master.fn_rim_key(r.rim_size) = v_size
        ORDER  BY r.equipment_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'NG_NO_EQUIPMENT_RUNNING', 'No equipment is running rim ' || v_size,
                            v_prod.material_id, v_prod.recipe_id, v_size, NULL::int;
    END IF;
END $$;
