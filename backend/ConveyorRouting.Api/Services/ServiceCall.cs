using System;
using ConveyorRouting.Api.Models;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace ConveyorRouting.Api.Services
{
    /// <summary>Runs a service call and turns the outcome into an OEMResponse with the matching status code.</summary>
    internal static class ServiceCall
    {
        public static OEMResponse Run(ILogger log, Func<object> work, string message = "Success")
        {
            try
            {
                return OEMResponse.Ok(work(), message);
            }
            catch (FixException ex)
            {
                return OEMResponse.Fail(ex.StatusCode, ex.Message);
            }
            catch (PostgresException ex)
            {
                log.LogError(ex, "Database error");
                return OEMResponse.Fail(500, $"Database error: {ex.SqlState}: {ex.MessageText}");
            }
            catch (NpgsqlException ex)
            {
                log.LogError(ex, "Database error");
                return OEMResponse.Fail(500, $"Database error: {ex.Message}");
            }
        }
    }
}
