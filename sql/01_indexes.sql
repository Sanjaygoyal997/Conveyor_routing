-- Indexes the checks rely on. Run outside a transaction (CONCURRENTLY does not
-- block production inserts). Skip one if the plant already has an index on the
-- same column under another name.

-- barcode check: curing record by barcode
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_o_production_production_id
    ON curing.o_production (production_id);

-- WIP window: curing records of the last N hours
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_o_production_dtandtime
    ON curing.o_production (dtandtime);

-- "already at DBM?" (WIP excludes balanced tires) and the barcode's DBM history
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dbm_o_production_barcode
    ON dbm.o_production (barcode);

-- DBM machines seen in the window (gap report, machine check, DBM list)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dbm_o_production_dtandtime
    ON dbm.o_production (dtandtime);

CREATE INDEX IF NOT EXISTS idx_material_size_lookup_material_id
    ON master.material_size_lookup (material_id);
