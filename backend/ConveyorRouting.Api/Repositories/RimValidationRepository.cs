using System.Collections.Generic;
using System.Linq;
using ConveyorRouting.Api.Data;
using ConveyorRouting.Api.Interfaces.ICommon;
using ConveyorRouting.Api.Interfaces.IRepository;
using ConveyorRouting.Api.Models;

namespace ConveyorRouting.Api.Repositories
{
    /// <summary>Read side: calls the master.fn_* validation functions (sql/*.sql) and lookups.</summary>
    public class RimValidationRepository : IRimValidationRepository
    {
        private readonly IDbOperations _db;

        public RimValidationRepository(IDbOperations db)
        {
            _db = db;
        }

        public Dictionary<string, object> Health() =>
            _db.Query("SELECT now()::timestamp AS db_time, current_database() AS database").First();

        public List<Dictionary<string, object>> WipReadiness(WipFilter f) =>
            _db.Query($"SELECT * FROM master.fn_wip_rim_readiness({Sql.WipArgs})", Sql.WipParams(f));

        public List<Dictionary<string, object>> WipDemand(WipFilter f) =>
            _db.Query($"SELECT * FROM master.fn_wip_rim_demand({Sql.WipArgs})", Sql.WipParams(f));

        public List<Dictionary<string, object>> WipMachines(WipFilter f) =>
            _db.Query($"SELECT * FROM master.fn_machine_rim_check({Sql.WipArgs})", Sql.WipParams(f));

        public List<Dictionary<string, object>> Gaps(int hours, int? areaId) =>
            _db.Query(@"SELECT * FROM master.fn_rim_master_data_gaps(
                            p_from    => (now() - make_interval(hours => @hours))::timestamp,
                            p_to      => now()::timestamp,
                            p_area_id => COALESCE(@area_id, master.fn_area_id('DBM')))",
                Sql.Int("hours", hours), Sql.Int("area_id", areaId));

        public List<Dictionary<string, object>> Areas() =>
            _db.Query(@"SELECT a.local_area_id, a.name, a.description,
                               a.local_area_id = master.fn_area_id('DBM') AS is_default
                        FROM   master.area_master a
                        WHERE  EXISTS (SELECT 1 FROM master.rim_master rm WHERE rm.local_area_id = a.local_area_id)
                        ORDER  BY a.local_area_id");

        public List<Dictionary<string, object>> RunningSizes(int? areaId, int hours) =>
            _db.Query(@"SELECT r.equipment_id, r.rim_size, master.fn_rim_name(r.rim_size) AS rim_name,
                               (SELECT a.name FROM master.area_master a
                                WHERE  a.local_area_id = master.fn_rim_area(r.rim_size)) AS rim_area,
                               CASE master.fn_rim_name(r.rim_size)
                                    WHEN 'NONE'         THEN 'NOT AVAILABLE'
                                    WHEN 'UNIVERSALRIM' THEN 'UNIVERSAL'
                                    ELSE master.fn_rim_status(r.rim_size, @area_id) END AS rim_master_status,
                               r.created_by, r.dtandtime
                        FROM   master.runningsize_lookup r
                        UNION ALL
                        SELECT DISTINCT d.equipment_id, NULL, NULL, 'DBM', 'NOT SET', NULL, NULL::timestamp
                        FROM   dbm.o_production d
                        WHERE  d.dtandtime >= (now() - make_interval(hours => @hours))::timestamp
                          AND  d.equipment_id IS NOT NULL
                          AND  NOT EXISTS (SELECT 1 FROM master.runningsize_lookup r WHERE r.equipment_id = d.equipment_id)
                        ORDER  BY 1",
                Sql.Int("area_id", areaId), Sql.Int("hours", hours));

        public List<Dictionary<string, object>> DbmMachines(int days) =>
            _db.Query(@"WITH seen AS (
                            SELECT d.equipment_id, max(d.dtandtime) AS last_balanced, count(*) AS tires_balanced
                            FROM   dbm.o_production d
                            WHERE  d.dtandtime >= (now() - make_interval(days => @days))::timestamp
                              AND  d.equipment_id IS NOT NULL
                            GROUP  BY d.equipment_id),
                        run AS (
                            SELECT r.equipment_id, r.rim_size, master.fn_rim_name(r.rim_size) AS rim_name,
                                   master.fn_rim_area(r.rim_size) AS rim_area
                            FROM   master.runningsize_lookup r)
                        SELECT COALESCE(r.equipment_id, s.equipment_id) AS equipment_id,
                               r.rim_size, r.rim_name,
                               CASE WHEN r.rim_name IS NULL          THEN 'NOT SET'
                                    WHEN r.rim_name = 'NONE'         THEN 'NOT AVAILABLE'
                                    WHEN r.rim_name = 'UNIVERSALRIM' THEN 'UNIVERSAL'
                                    WHEN r.rim_area IS DISTINCT FROM master.fn_area_id('DBM') AND r.rim_area IS NOT NULL
                                                                     THEN 'WRONG AREA'
                                    ELSE master.fn_rim_status(r.rim_size) END AS rim_status,
                               s.last_balanced, COALESCE(s.tires_balanced, 0) AS tires_balanced
                        FROM   run r
                        FULL   JOIN seen s ON s.equipment_id = r.equipment_id
                        WHERE  s.equipment_id IS NOT NULL
                           OR  r.rim_area IS NULL
                           OR  r.rim_area = master.fn_area_id('DBM')
                        ORDER  BY 1",
                Sql.Int("days", days));

        public List<Dictionary<string, object>> Rims() =>
            _db.Query(@"SELECT rim_id, name, master.fn_rim_key(name) AS rim_key, isactive, local_area_id, description,
                               (SELECT a.name FROM master.area_master a WHERE a.local_area_id = rim_master.local_area_id) AS area_name
                        FROM   master.rim_master
                        ORDER  BY isactive DESC NULLS LAST, master.fn_rim_key(name), rim_id");

        public List<Dictionary<string, object>> MaterialMapping(int materialId) =>
            _db.Query(@"SELECT m.id, m.material_id, m.rim_size, master.fn_rim_name(m.rim_size) AS rim_name,
                               m.area_id, m.created_by, m.dtandtime,
                               master.fn_rim_status(m.rim_size) AS rim_master_status,
                               (SELECT rm.rim_id FROM master.rim_master rm
                                WHERE  rm.rim_id::text = master.fn_rim_key(m.rim_size)
                                   OR  master.fn_rim_key(rm.name) = master.fn_rim_key(m.rim_size)
                                ORDER  BY (rm.rim_id::text = master.fn_rim_key(m.rim_size)) DESC,
                                          (rm.local_area_id IS NOT DISTINCT FROM m.area_id) DESC, rm.rim_id LIMIT 1) AS rim_id,
                               (SELECT array_agg(r.equipment_id ORDER BY r.equipment_id)
                                FROM   master.runningsize_lookup r
                                WHERE  master.fn_rim_name(r.rim_size) = master.fn_rim_name(m.rim_size)
                                  AND  master.fn_rim_name(r.rim_size) <> 'NONE') AS equipment_running
                        FROM   master.material_size_lookup m
                        WHERE  m.material_id = @material_id
                        ORDER  BY m.id",
                Sql.Int("material_id", materialId));

        public List<Dictionary<string, object>> Audit(int limit) =>
            _db.Query(@"SELECT id, dtandtime, user_name, action, table_name, row_ref, before, after
                        FROM   master.rim_validation_audit
                        ORDER  BY id DESC LIMIT @limit",
                Sql.Int("limit", limit));

        public Dictionary<string, object> Barcode(string barcode, int? equipmentId, int? areaId, string okQuality)
        {
            var quality = Sql.IntList(okQuality, "ok_quality");
            return new Dictionary<string, object>
            {
                ["validation"] = _db.Query(@"SELECT * FROM master.fn_validate_tire_barcode(
                                                 @barcode, @equipment_id, COALESCE(@area_id, master.fn_area_id('DBM')), @ok_quality)",
                    Sql.Text("barcode", barcode), Sql.Int("equipment_id", equipmentId), Sql.Int("area_id", areaId),
                    Sql.IntArray("ok_quality", quality)),
                ["curing"] = _db.Query(@"SELECT o.dtandtime, o.equipment_id, o.recipe_id, o.material_id, o.mould_code, o.side,
                                                o.quality_status, o.state
                                         FROM   curing.o_production o
                                         WHERE  o.production_id = @barcode
                                         ORDER  BY o.dtandtime DESC LIMIT 10",
                    Sql.Text("barcode", barcode)),
                ["dbm"] = _db.Query(@"SELECT d.dtandtime, d.equipment_id, d.model, d.code, d.total_rank, d.ro_total
                                      FROM   dbm.o_production d
                                      WHERE  d.barcode = @barcode
                                      ORDER  BY d.dtandtime DESC LIMIT 10",
                    Sql.Text("barcode", barcode)),
            };
        }
    }
}
