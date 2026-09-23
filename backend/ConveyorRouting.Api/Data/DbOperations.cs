using System;
using System.Collections.Generic;
using ConveyorRouting.Api.Interfaces.ICommon;
using ConveyorRouting.Api.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using Newtonsoft.Json.Linq;
using Npgsql;

namespace ConveyorRouting.Api.Data
{
    public class DbOperations : IDbOperations
    {
        // Connection string comes from appsettings (ConnectionStrings:SmartMes), never from code.
        private readonly string _connectionString;
        private readonly int _timeoutSeconds;

        public DbOperations(IConfiguration configuration, IOptions<RimValidationSettings> settings)
        {
            _connectionString = configuration.GetConnectionString("SmartMes");
            _timeoutSeconds = settings.Value.StatementTimeoutSeconds;
        }

        private NpgsqlConnection OpenConnection()
        {
            var connection = new NpgsqlConnection(_connectionString);
            connection.Open();
            return connection;
        }

        public List<Dictionary<string, object>> Query(string sql, params NpgsqlParameter[] parameters)
        {
            using (var connection = OpenConnection())
            using (var tx = connection.BeginTransaction())
            {
                using (var ro = new NpgsqlCommand("SET TRANSACTION READ ONLY", connection, tx))
                    ro.ExecuteNonQuery();
                var rows = Rows(connection, tx, sql, parameters);
                tx.Commit();
                return rows;
            }
        }

        public T InTransaction<T>(Func<NpgsqlConnection, NpgsqlTransaction, T> work)
        {
            using (var connection = OpenConnection())
            using (var tx = connection.BeginTransaction())
            {
                var result = work(connection, tx);
                tx.Commit();
                return result;
            }
        }

        public List<Dictionary<string, object>> Rows(NpgsqlConnection conn, NpgsqlTransaction tx, string sql, params NpgsqlParameter[] parameters)
        {
            var rows = new List<Dictionary<string, object>>();
            using (var cmd = new NpgsqlCommand(sql, conn, tx) { CommandTimeout = _timeoutSeconds })
            {
                if (parameters != null) cmd.Parameters.AddRange(parameters);
                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        var row = new Dictionary<string, object>();
                        for (int i = 0; i < reader.FieldCount; i++)
                        {
                            object value = reader.IsDBNull(i) ? null : reader.GetValue(i);
                            var type = reader.GetDataTypeName(i);
                            // json/jsonb come back as text: return them as JSON objects
                            if (value is string s && (type == "jsonb" || type == "json"))
                                value = JToken.Parse(s);
                            row[reader.GetName(i)] = value;
                        }
                        rows.Add(row);
                    }
                }
            }
            return rows;
        }
    }
}
