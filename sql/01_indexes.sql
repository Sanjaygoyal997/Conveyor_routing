-- Barcode lookups hit curing.o_production by production_id, which is not
-- indexed. Run outside a transaction (CONCURRENTLY does not block production
-- inserts).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_o_production_production_id
    ON curing.o_production (production_id);

CREATE INDEX IF NOT EXISTS idx_material_size_lookup_material_id
    ON master.material_size_lookup (material_id);
