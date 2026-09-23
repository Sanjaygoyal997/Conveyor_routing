using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using ConveyorRouting.Api.Interfaces.IRepository;
using ConveyorRouting.Api.Interfaces.IServices;
using ConveyorRouting.Api.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ConveyorRouting.Api.Services
{
    /// <summary>
    /// Master-data fixes. Writes are off unless RimValidation:AllowWrites is true; every change must
    /// name the operator (X-User) and, when RimValidation:AdminToken is set, send it as X-Admin-Token.
    /// Each change runs in one transaction with a row in master.rim_validation_audit.
    /// </summary>
    public class RimFixService : IRimFixService
    {
        private readonly IRimFixRepository _repo;
        private readonly RimValidationSettings _settings;
        private readonly ILogger<RimFixService> _log;

        public RimFixService(IRimFixRepository repo, IOptions<RimValidationSettings> settings, ILogger<RimFixService> log)
        {
            _repo = repo;
            _settings = settings.Value;
            _log = log;
        }

        /// <summary>Authorise a write and return the operator name.</summary>
        private string Operator(string user, string adminToken)
        {
            if (!_settings.AllowWrites)
                throw new FixException(403, "Editing is switched off on this server (set RimValidation:AllowWrites=true)");
            if (!string.IsNullOrEmpty(_settings.AdminToken) &&
                !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(adminToken ?? ""),
                                                         Encoding.UTF8.GetBytes(_settings.AdminToken)))
                throw new FixException(401, "Admin token is missing or wrong");
            user = (user ?? "").Trim();
            if (user.Length == 0 || user.Length > 50)
                throw new FixException(422, "Enter your name (1-50 characters) before making changes");
            return user;
        }

        private OEMResponse Write(string user, string adminToken, Func<string, object> work) =>
            ServiceCall.Run(_log, () => work(Operator(user, adminToken)));

        private static Dictionary<string, object> Done(string message) =>
            new Dictionary<string, object> { ["ok"] = true, ["message"] = message };

        public OEMResponse AddMaterialRim(MaterialRimIn body, string user, string adminToken) =>
            Write(user, adminToken, u =>
            {
                if (body == null) throw new FixException(422, "Request body is required");
                var (message, id) = _repo.AddMaterialRim(body, u);
                var d = Done(message);
                d["id"] = id;
                return d;
            });

        public OEMResponse RemoveMaterialRim(int rowId, string user, string adminToken) =>
            Write(user, adminToken, u => Done(_repo.RemoveMaterialRim(rowId, u)));

        public OEMResponse SetMaterialRimArea(int rowId, AreaIn body, string user, string adminToken) =>
            Write(user, adminToken, u =>
            {
                if (body == null) throw new FixException(422, "Request body is required");
                return Done(_repo.SetMaterialRimArea(rowId, body.Area_Id, u));
            });

        public OEMResponse ChangeMaterialRim(int rowId, RimIn body, string user, string adminToken) =>
            Write(user, adminToken, u =>
            {
                if (body == null) throw new FixException(422, "Request body is required");
                return Done(_repo.ChangeMaterialRim(rowId, body.Rim_Id, u));
            });

        public OEMResponse DedupeMaterialRim(DedupeIn body, string user, string adminToken) =>
            Write(user, adminToken, u =>
            {
                if (body == null || string.IsNullOrWhiteSpace(body.Rim_Size) || body.Rim_Size.Length > 50)
                    throw new FixException(422, "rim_size is required (1-50 characters)");
                return Done(_repo.DedupeMaterialRim(body, u));
            });

        public OEMResponse SetRunningRim(int equipmentId, RimIn body, string user, string adminToken) =>
            Write(user, adminToken, u =>
            {
                if (body == null) throw new FixException(422, "Request body is required");
                return Done(_repo.SetRunningRim(equipmentId, body.Rim_Id, u));
            });

        public OEMResponse ActivateRim(int rimId, string user, string adminToken) =>
            Write(user, adminToken, u => Done(_repo.ActivateRim(rimId, u)));
    }
}
