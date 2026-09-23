using System.Collections.Generic;
using ConveyorRouting.Api.Interfaces.IRepository;
using ConveyorRouting.Api.Interfaces.IServices;
using ConveyorRouting.Api.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ConveyorRouting.Api.Services
{
    public class RimValidationService : IRimValidationService
    {
        private readonly IRimValidationRepository _repo;
        private readonly RimValidationSettings _settings;
        private readonly ILogger<RimValidationService> _log;

        public RimValidationService(IRimValidationRepository repo, IOptions<RimValidationSettings> settings,
                                    ILogger<RimValidationService> log)
        {
            _repo = repo;
            _settings = settings.Value;
            _log = log;
        }

        private OEMResponse Run(System.Func<object> work) => ServiceCall.Run(_log, work);

        public OEMResponse Health() => Run(() =>
        {
            var h = _repo.Health();
            h["ok"] = true;
            return h;
        });

        public OEMResponse Config() => Run(() => new Dictionary<string, object>
        {
            ["writes_enabled"] = _settings.AllowWrites,
            ["token_required"] = !string.IsNullOrEmpty(_settings.AdminToken),
            ["rim_size_value"] = _settings.RimSizeValue,
        });

        public OEMResponse WipReadiness(WipFilter f) => Run(() => _repo.WipReadiness(f));
        public OEMResponse WipDemand(WipFilter f) => Run(() => _repo.WipDemand(f));
        public OEMResponse WipMachines(WipFilter f) => Run(() => _repo.WipMachines(f));

        public OEMResponse Gaps(int hours, int? areaId) => Run(() =>
        {
            CheckHours(hours);
            return _repo.Gaps(hours, areaId);
        });

        public OEMResponse Areas() => Run(() => _repo.Areas());

        public OEMResponse RunningSizes(int? areaId, int hours) => Run(() =>
        {
            CheckHours(hours);
            return _repo.RunningSizes(areaId, hours);
        });

        public OEMResponse DbmMachines(int days) => Run(() =>
        {
            if (days < 1 || days > 366) throw new FixException(422, "days must be between 1 and 366");
            return _repo.DbmMachines(days);
        });

        public OEMResponse Rims() => Run(() => _repo.Rims());
        public OEMResponse MaterialMapping(int materialId) => Run(() => _repo.MaterialMapping(materialId));

        public OEMResponse Audit(int limit) => Run(() =>
        {
            if (limit < 1 || limit > 1000) throw new FixException(422, "limit must be between 1 and 1000");
            return _repo.Audit(limit);
        });

        public OEMResponse Barcode(string barcode, int? equipmentId, int? areaId, string okQuality) => Run(() =>
        {
            barcode = (barcode ?? "").Trim();
            if (barcode.Length == 0 || barcode.Length > 150) throw new FixException(422, "Invalid barcode");
            return _repo.Barcode(barcode, equipmentId, areaId, okQuality);
        });

        private static void CheckHours(int hours)
        {
            if (hours < 1 || hours > 24 * 31) throw new FixException(422, "hours must be between 1 and 744");
        }
    }
}
