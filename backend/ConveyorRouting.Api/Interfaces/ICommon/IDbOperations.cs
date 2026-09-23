using System;
using System.Collections.Generic;
using Npgsql;

namespace ConveyorRouting.Api.Interfaces.ICommon
{
    public interface IDbOperations
    {
        /// <summary>Run one query in a read-only transaction; rows as column -> value.</summary>
        List<Dictionary<string, object>> Query(string sql, params NpgsqlParameter[] parameters);

        /// <summary>Run work in one read-write transaction; any exception rolls everything back.</summary>
        T InTransaction<T>(Func<NpgsqlConnection, NpgsqlTransaction, T> work);

        List<Dictionary<string, object>> Rows(NpgsqlConnection conn, NpgsqlTransaction tx, string sql, params NpgsqlParameter[] parameters);
    }
}
