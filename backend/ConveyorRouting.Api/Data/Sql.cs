using System;
using System.Linq;
using ConveyorRouting.Api.Models;
using Npgsql;
using NpgsqlTypes;

namespace ConveyorRouting.Api.Data
{
    /// <summary>Typed parameter helpers (all SQL is parameterised).</summary>
    public static class Sql
    {
        public static NpgsqlParameter Int(string name, int? value) =>
            new NpgsqlParameter(name, NpgsqlDbType.Integer) { Value = (object)value ?? DBNull.Value };

        public static NpgsqlParameter Text(string name, string value) =>
            new NpgsqlParameter(name, NpgsqlDbType.Text) { Value = (object)value ?? DBNull.Value };

        public static NpgsqlParameter Bool(string name, bool value) =>
            new NpgsqlParameter(name, NpgsqlDbType.Boolean) { Value = value };

        public static NpgsqlParameter IntArray(string name, int[] value) =>
            new NpgsqlParameter(name, NpgsqlDbType.Array | NpgsqlDbType.Integer) { Value = (object)value ?? DBNull.Value };

        public static NpgsqlParameter Jsonb(string name, object value) =>
            new NpgsqlParameter(name, NpgsqlDbType.Jsonb)
            { Value = value == null ? (object)DBNull.Value : Newtonsoft.Json.JsonConvert.SerializeObject(value) };

        /// <summary>"1, 2,3" -> [1,2,3]; blank -> null (no filter).</summary>
        public static int[] IntList(string value, string name)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            try
            {
                return value.Split(',').Select(v => v.Trim()).Where(v => v.Length > 0).Select(int.Parse).ToArray();
            }
            catch (FormatException)
            {
                throw new FixException(422, $"{name} must be a comma-separated list of integers");
            }
        }

        /// <summary>The WIP window/filter arguments of the fn_wip_* / fn_machine_* functions.</summary>
        public const string WipArgs = @"
            p_from           => (now() - make_interval(hours => @hours))::timestamp,
            p_to             => now()::timestamp,
            p_wip_states     => @wip_states,
            p_ok_quality     => @ok_quality,
            p_area_id        => COALESCE(@area_id, master.fn_area_id('DBM')),
            p_exclude_at_dbm => @exclude_at_dbm";

        public static NpgsqlParameter[] WipParams(WipFilter f)
        {
            if (f.Hours < 1 || f.Hours > 24 * 31) throw new FixException(422, "hours must be between 1 and 744");
            return new[]
            {
                Int("hours", f.Hours),
                IntArray("wip_states", IntList(f.Wip_States, "wip_states")),
                IntArray("ok_quality", IntList(f.Ok_Quality, "ok_quality")),
                Int("area_id", f.Area_Id),
                Bool("exclude_at_dbm", f.Exclude_At_Dbm),
            };
        }
    }
}
