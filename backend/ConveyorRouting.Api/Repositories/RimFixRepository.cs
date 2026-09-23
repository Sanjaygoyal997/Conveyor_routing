using System.Collections.Generic;
using System.Linq;
using ConveyorRouting.Api.Data;
using ConveyorRouting.Api.Interfaces.ICommon;
using ConveyorRouting.Api.Interfaces.IRepository;
using ConveyorRouting.Api.Models;
using Microsoft.Extensions.Options;
using Npgsql;

namespace ConveyorRouting.Api.Repositories
{
    /// <summary>
    /// Master-data fixes. Each fix runs in one transaction together with a row in
    /// master.rim_validation_audit (before/after as JSON). Rims are picked from
    /// master.rim_master (active only) and written as rim_id (default) or name.
    /// The conveyor reads these same tables, so a fix applies to the next scanned tire.
    /// </summary>
    public class RimFixRepository : IRimFixRepository
    {
        private readonly IDbOperations _db;
        private readonly RimValidationSettings _settings;

        public RimFixRepository(IDbOperations db, IOptions<RimValidationSettings> settings)
        {
            _db = db;
            _settings = settings.Value;
        }

        // ---- helpers -----------------------------------------------------------
        private static Dictionary<string, object> One(List<Dictionary<string, object>> rows) => rows.FirstOrDefault();

        private void Audit(NpgsqlConnection c, NpgsqlTransaction t, string user, string action, string table, string rowRef,
                           object before, object after)
        {
            _db.Rows(c, t, @"INSERT INTO master.rim_validation_audit (user_name, action, table_name, row_ref, before, after)
                             VALUES (@u, @a, @t, @r, @b, @af)",
                Sql.Text("u", user), Sql.Text("a", action), Sql.Text("t", table), Sql.Text("r", rowRef),
                Sql.Jsonb("b", before), Sql.Jsonb("af", after));
        }

        /// <summary>The rim_master row if it is active and usable in the area.</summary>
        private Dictionary<string, object> ActiveRim(NpgsqlConnection c, NpgsqlTransaction t, int rimId, int? areaId)
        {
            var rim = One(_db.Rows(c, t, "SELECT rim_id, name, isactive, local_area_id FROM master.rim_master WHERE rim_id = @id",
                Sql.Int("id", rimId)));
            if (rim == null) throw new FixException(404, $"rim_id {rimId} not found in rim_master");
            if (!(rim["isactive"] is bool active && active))
                throw new FixException(409, $"Rim {rim["name"]} is inactive in rim_master; reactivate it first");
            if (areaId != null && rim["local_area_id"] != null && (int)rim["local_area_id"] != areaId)
                throw new FixException(409, $"Rim {rim["name"]} belongs to area {rim["local_area_id"]}, not {areaId}");
            return rim;
        }

        private string RimValue(Dictionary<string, object> rim) =>
            _settings.RimSizeValue == "name" ? (string)rim["name"] : rim["rim_id"].ToString();

        private static void RejectNone(Dictionary<string, object> rim)
        {
            if (((rim["name"] as string) ?? "").Trim().ToUpperInvariant() == "NONE")
                throw new FixException(409, "Rim None means 'equipment not available' and can't be mapped to a material");
        }

        // ---- material_size_lookup ------------------------------------------------
        public (string message, int id) AddMaterialRim(MaterialRimIn body, string user) =>
            _db.InTransaction((c, t) =>
            {
                var rim = ActiveRim(c, t, body.Rim_Id, body.Area_Id);
                RejectNone(rim);
                var exists = One(_db.Rows(c, t, @"SELECT id FROM master.material_size_lookup
                                                  WHERE material_id = @m AND area_id IS NOT DISTINCT FROM @a
                                                    AND master.fn_rim_name(rim_size) = master.fn_rim_name(@v)",
                    Sql.Int("m", body.Material_Id), Sql.Int("a", body.Area_Id), Sql.Text("v", RimValue(rim))));
                if (exists != null)
                    throw new FixException(409, $"Material {body.Material_Id} is already mapped to rim {rim["name"]} (id {exists["id"]})");
                var row = One(_db.Rows(c, t, @"INSERT INTO master.material_size_lookup (material_id, rim_size, area_id, created_by, dtandtime)
                                               VALUES (@m, @v, @a, @u, now())
                                               RETURNING id, to_jsonb(material_size_lookup.*) AS after",
                    Sql.Int("m", body.Material_Id), Sql.Text("v", RimValue(rim)), Sql.Int("a", body.Area_Id), Sql.Text("u", user)));
                Audit(c, t, user, "map_rim", "material_size_lookup", $"id={row["id"]}", null, row["after"]);
                return ($"Material {body.Material_Id} now accepts rim {rim["name"]}", (int)row["id"]);
            });

        public string RemoveMaterialRim(int rowId, string user) =>
            _db.InTransaction((c, t) =>
            {
                var row = One(_db.Rows(c, t, @"DELETE FROM master.material_size_lookup t WHERE t.id = @id
                                               RETURNING t.material_id, master.fn_rim_name(t.rim_size) AS rim_name, to_jsonb(t.*) AS before",
                    Sql.Int("id", rowId)));
                if (row == null) throw new FixException(404, $"Mapping id {rowId} not found");
                Audit(c, t, user, "unmap_rim", "material_size_lookup", $"id={rowId}", row["before"], null);
                return $"Removed rim {row["rim_name"]} from material {row["material_id"]}";
            });

        public string SetMaterialRimArea(int rowId, int areaId, string user) =>
            _db.InTransaction((c, t) =>
            {
                var before = One(_db.Rows(c, t, "SELECT to_jsonb(t.*) AS j FROM master.material_size_lookup t WHERE t.id = @id FOR UPDATE",
                    Sql.Int("id", rowId)));
                if (before == null) throw new FixException(404, $"Mapping id {rowId} not found");
                var row = One(_db.Rows(c, t, @"UPDATE master.material_size_lookup t SET area_id = @a WHERE t.id = @id
                                               RETURNING to_jsonb(t.*) AS after",
                    Sql.Int("a", areaId), Sql.Int("id", rowId)));
                Audit(c, t, user, "set_area", "material_size_lookup", $"id={rowId}", before["j"], row["after"]);
                return $"Mapping {rowId} set to area {areaId}";
            });

        public string ChangeMaterialRim(int rowId, int rimId, string user) =>
            _db.InTransaction((c, t) =>
            {
                var row = One(_db.Rows(c, t, @"SELECT t.id, t.material_id, t.area_id, master.fn_rim_name(t.rim_size) AS rim_name, to_jsonb(t.*) AS j
                                               FROM master.material_size_lookup t WHERE t.id = @id FOR UPDATE",
                    Sql.Int("id", rowId)));
                if (row == null) throw new FixException(404, $"Mapping id {rowId} not found");
                var rim = ActiveRim(c, t, rimId, row["area_id"] as int?);
                RejectNone(rim);
                var clash = One(_db.Rows(c, t, @"SELECT id FROM master.material_size_lookup
                                                 WHERE material_id = @m AND area_id IS NOT DISTINCT FROM @a AND id <> @id
                                                   AND master.fn_rim_name(rim_size) = master.fn_rim_name(@v)",
                    Sql.Int("m", (int)row["material_id"]), Sql.Int("a", row["area_id"] as int?), Sql.Int("id", rowId), Sql.Text("v", RimValue(rim))));
                if (clash != null)
                    throw new FixException(409, $"Material {row["material_id"]} is already mapped to rim {rim["name"]} (id {clash["id"]})");
                var after = One(_db.Rows(c, t, @"UPDATE master.material_size_lookup t SET rim_size = @v, created_by = @u, dtandtime = now()
                                                 WHERE t.id = @id RETURNING to_jsonb(t.*) AS j",
                    Sql.Text("v", RimValue(rim)), Sql.Text("u", user), Sql.Int("id", rowId)));
                Audit(c, t, user, "change_rim", "material_size_lookup", $"id={rowId}", row["j"], after["j"]);
                return $"Material {row["material_id"]}: rim {row["rim_name"]} changed to {rim["name"]}";
            });

        public string DedupeMaterialRim(DedupeIn body, string user) =>
            _db.InTransaction((c, t) =>
            {
                var rows = _db.Rows(c, t, @"DELETE FROM master.material_size_lookup t
                                            WHERE  t.material_id = @m AND t.area_id IS NOT DISTINCT FROM @a
                                              AND  master.fn_rim_name(t.rim_size) = master.fn_rim_name(@r)
                                              AND  t.id > (SELECT min(k.id) FROM master.material_size_lookup k
                                                           WHERE k.material_id = @m AND k.area_id IS NOT DISTINCT FROM @a
                                                             AND master.fn_rim_name(k.rim_size) = master.fn_rim_name(@r))
                                            RETURNING t.id, to_jsonb(t.*) AS before",
                    Sql.Int("m", body.Material_Id), Sql.Int("a", body.Area_Id), Sql.Text("r", body.Rim_Size));
                foreach (var r in rows)
                    Audit(c, t, user, "dedupe", "material_size_lookup", $"id={r["id"]}", r["before"], null);
                return $"Removed {rows.Count} duplicate row(s)";
            });

        // ---- runningsize_lookup (DBM running rim) ---------------------------------
        public string SetRunningRim(int equipmentId, int rimId, string user) =>
            _db.InTransaction((c, t) =>
            {
                var rim = ActiveRim(c, t, rimId, null);
                var before = One(_db.Rows(c, t, "SELECT to_jsonb(t.*) AS j FROM master.runningsize_lookup t WHERE t.equipment_id = @e FOR UPDATE",
                    Sql.Int("e", equipmentId)));
                var row = One(_db.Rows(c, t, @"INSERT INTO master.runningsize_lookup AS t (equipment_id, rim_size, created_by, dtandtime)
                                               VALUES (@e, @v, @u, now())
                                               ON CONFLICT (equipment_id) DO UPDATE
                                                   SET rim_size = EXCLUDED.rim_size, created_by = EXCLUDED.created_by, dtandtime = EXCLUDED.dtandtime
                                               RETURNING to_jsonb(t.*) AS after",
                    Sql.Int("e", equipmentId), Sql.Text("v", RimValue(rim)), Sql.Text("u", user)));
                Audit(c, t, user, "set_running_rim", "runningsize_lookup", $"equipment_id={equipmentId}", before?["j"], row["after"]);
                return $"Equipment {equipmentId} now running rim {rim["name"]}";
            });

        // ---- rim_master -----------------------------------------------------------
        public string ActivateRim(int rimId, string user) =>
            _db.InTransaction((c, t) =>
            {
                var before = One(_db.Rows(c, t, "SELECT to_jsonb(t.*) AS j FROM master.rim_master t WHERE t.rim_id = @id FOR UPDATE",
                    Sql.Int("id", rimId)));
                if (before == null) throw new FixException(404, $"rim_id {rimId} not found in rim_master");
                var row = One(_db.Rows(c, t, "UPDATE master.rim_master t SET isactive = true WHERE t.rim_id = @id RETURNING t.name, to_jsonb(t.*) AS after",
                    Sql.Int("id", rimId)));
                Audit(c, t, user, "activate_rim", "rim_master", $"rim_id={rimId}", before["j"], row["after"]);
                return $"Rim {row["name"]} is active again";
            });
    }
}
